import { mkdir, readFile, writeFile } from "node:fs/promises";

const session = process.argv.includes("--session")
  ? process.argv[process.argv.indexOf("--session") + 1]
  : "45-1";
const source = process.argv.includes("--all")
  ? `data/normalized/bills.${session}.json`
  : `data/normalized/recommended-bills.${session}.json`;
const limitArg = process.argv.includes("--limit")
  ? Number(process.argv[process.argv.indexOf("--limit") + 1])
  : null;

const bills = JSON.parse(await readFile(source, "utf8"))
  .filter((bill) => bill.latestBillTextTypeId && bill.recommendation !== "archive")
  .slice(0, limitArg || undefined);

const manifest = {
  session,
  source,
  fetchedAt: new Date().toISOString(),
  count: 0,
  failures: [],
  bills: []
};

for (const bill of bills) {
  try {
    const result = await retrieveBill(bill);
    manifest.bills.push(result);
    manifest.count += 1;
    console.log(`retrieved ${bill.number} ${result.stage}`);
  } catch (error) {
    manifest.failures.push({ number: bill.number, message: error.message });
    console.warn(`failed ${bill.number}: ${error.message}`);
  }
}

await mkdir(`data/bills/${session}`, { recursive: true });
await writeFile(`data/bills/${session}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote data/bills/${session}/manifest.json`);

async function retrieveBill(bill) {
  const number = bill.number;
  const dir = `data/bills/${session}/${number}`;
  await mkdir(dir, { recursive: true });

  const detailUrl = `https://www.parl.ca/legisinfo/en/bill/${session}/${number.toLowerCase()}/json`;
  const detail = await fetchJson(detailUrl);
  const detailRecord = Array.isArray(detail) ? detail[0] : detail;

  const stages = await discoverStages(session, number);
  const selected = selectLatestStage(stages);
  if (!selected) throw new Error("no XML bill text found");

  const xmlUrl = absoluteParlUrl(selected.xmlUrl);
  const xml = await fetchText(xmlUrl);
  const normalized = normalizeBillXml(xml, { session, number, sourceUrl: xmlUrl, stage: selected.stage });

  await writeFile(`${dir}/metadata.json`, `${JSON.stringify(detailRecord, null, 2)}\n`);
  await writeFile(`${dir}/bill.xml`, xml);
  await writeFile(`${dir}/bill.normalized.json`, `${JSON.stringify(normalized, null, 2)}\n`);
  await writeFile(`${dir}/source.json`, `${JSON.stringify({
    session,
    number,
    detailUrl,
    documentViewerUrl: selected.documentViewerUrl,
    xmlUrl,
    stage: selected.stage,
    fetchedAt: new Date().toISOString()
  }, null, 2)}\n`);

  return {
    number,
    title: bill.title,
    stage: selected.stage,
    xmlUrl,
    sectionCount: normalized.sections.length,
    textLength: normalized.fullText.length
  };
}

async function discoverStages(session, number) {
  const knownStageCandidates = [
    "first-reading",
    "second-reading",
    "third-reading",
    "report-stage",
    "royal-assent"
  ];
  const firstReadingUrl = `https://www.parl.ca/DocumentViewer/en/${session}/bill/${number}/first-reading`;
  const html = await fetchText(firstReadingUrl);
  const stageLinks = new Set();
  const stagePattern = new RegExp(`/documentviewer/en/${escapeRegex(session)}/bill/${escapeRegex(number)}/([^"'\\s<>?#]+)`, "gi");

  for (const match of html.matchAll(stagePattern)) {
    stageLinks.add(match[1].toLowerCase());
  }
  for (const stage of knownStageCandidates) {
    stageLinks.add(stage);
  }

  const stages = [];
  for (const stage of stageLinks) {
    const documentViewerUrl = `https://www.parl.ca/DocumentViewer/en/${session}/bill/${number}/${stage}`;
    const stageHtml = await fetchTextOrNull(documentViewerUrl);
    if (!stageHtml) continue;
    const xmlMatch = stageHtml.match(/[^"'\s>]+\.xml/i);
    if (xmlMatch) {
      const xmlUrl = xmlMatch[0];
      stages.push({
        stage,
        documentViewerUrl,
        xmlUrl,
        version: billTextVersion(xmlUrl)
      });
    }
  }
  return stages;
}

function selectLatestStage(stages) {
  const priority = ["royal-assent", "third-reading", "second-reading", "first-reading"];
  return stages.sort((a, b) => {
    if (b.version !== a.version) return b.version - a.version;
    return stageRank(b.stage, priority) - stageRank(a.stage, priority);
  })[0] || null;
}

function stageRank(stage, priority) {
  const index = priority.indexOf(stage);
  return index === -1 ? 0 : priority.length - index;
}

function billTextVersion(url) {
  const match = url.match(/_([0-9]+)\/[^/]+\.xml$/i);
  return match ? Number(match[1]) : 0;
}

function normalizeBillXml(xml, source) {
  const fullText = textContent(xml);
  const title = firstText(xml, "LongTitle");
  const shortTitle = firstText(xml, "ShortTitle");
  const sponsor = firstText(xml, "BillSponsor");
  const sections = [];
  const sectionPattern = /<Section\b([^>]*)>([\s\S]*?)<\/Section>/gi;

  for (const match of xml.matchAll(sectionPattern)) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const label = firstText(body, "Label");
    if (!label) continue;
    sections.push({
      label,
      type: attrValue(attrs, "type"),
      marginalNote: firstText(body, "MarginalNote"),
      text: textContent(body),
      targetActs: [...new Set([...body.matchAll(/<XRefExternal[^>]*reference-type="act"[^>]*>([\s\S]*?)<\/XRefExternal>/gi)]
        .map((m) => textContent(m[1]))
        .filter(Boolean))],
      hasAmendedText: /<AmendedText\b/i.test(body)
    });
  }

  return {
    ...source,
    title,
    shortTitle,
    sponsor,
    fullText,
    sections
  };
}

function firstText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? textContent(match[1]) : "";
}

function textContent(xml) {
  return decodeEntities(xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function attrValue(attrs, name) {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? decodeEntities(match[1]) : null;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absoluteParlUrl(url) {
  if (url.startsWith("http")) return url;
  return `https://www.parl.ca${url.startsWith("/") ? "" : "/"}${url}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "project-Injenium-hackathon-prototype" }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

async function fetchTextOrNull(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "project-Injenium-hackathon-prototype" }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}
