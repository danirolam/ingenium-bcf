// Fetches and parses the full text of every bill in a session. For each bill it
// reads the cached LEGISinfo metadata.json, takes the latest Publication, opens
// that publication's DocumentViewer page (which embeds the structured bill XML
// link), downloads the XML, and parses it into ordered sections (clause label,
// marginal-note heading, target Acts, text). Writes bill.xml + bill.normalized.
// json per bill. Concurrent worker pool with retries.
//
//   node --use-system-ca scripts/fetch-bill-texts.mjs
//   flags: --session 45-1  --concurrency 6  --limit N  --force  --only NUMBER
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const argOf = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
};
const session = argOf("--session", "45-1");
const concurrency = Number(argOf("--concurrency", "6"));
const limit = process.argv.includes("--limit")
  ? Number(argOf("--limit", "0"))
  : null;
const only = process.argv.includes("--only") ? argOf("--only", "") : null;
const force = process.argv.includes("--force");
const baseDir = path.join("data", "bills", session);
const UA = "project-injenium (legislative research; contact dev@bcf.example)";

const dirs = (await readdir(baseDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((n) => (only ? n === only : true));

const work = [];
let noPublication = 0;
for (const number of dirs) {
  const dir = path.join(baseDir, number);
  let meta;
  try {
    meta = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8"));
  } catch {
    continue;
  }
  const pubs = Array.isArray(meta.Publications) ? meta.Publications : [];
  if (!pubs.length) {
    noPublication += 1;
    continue;
  }
  if (!force) {
    try {
      const norm = JSON.parse(
        await readFile(path.join(dir, "bill.normalized.json"), "utf8"),
      );
      if (Array.isArray(norm.sections) && norm.sections.length > 0) continue;
    } catch {
      /* needs fetch */
    }
  }
  const latest = pubs[pubs.length - 1];
  work.push({
    number,
    dir,
    pubId: latest.PublicationId,
    pubType: latest.PublicationTypeNameEn ?? latest.PublicationTypeName ?? null,
  });
}

const queue = limit ? work.slice(0, limit) : work;
console.log(
  `bills: ${dirs.length}  no publication: ${noPublication}  to fetch: ${queue.length}`,
);

let done = 0;
let ok = 0;
const failures = [];
let cursor = 0;
async function runner() {
  while (cursor < queue.length) {
    const item = queue[cursor++];
    try {
      const r = await retrieveText(item);
      ok += 1;
      console.log(`[${++done}/${queue.length}] ${item.number}: ${r.sections} sections, ${r.chars} chars`);
    } catch (e) {
      failures.push({ number: item.number, error: String(e?.message ?? e) });
      console.warn(`[${++done}/${queue.length}] ${item.number}: FAIL ${e?.message ?? e}`);
    }
  }
}
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length || 1) }, runner),
);
console.log(`\ndone. ok=${ok} fail=${failures.length}`);
if (failures.length) console.log(JSON.stringify(failures.slice(0, 30), null, 2));

async function retrieveText({ number, dir, pubId, pubType }) {
  const documentViewerUrl = `https://www.parl.ca/DocumentViewer/en/${pubId}`;
  const html = await fetchText(documentViewerUrl);
  const xmlPath = extractXmlLink(html);
  if (!xmlPath) throw new Error("no XML link in DocumentViewer");
  const xmlUrl = absoluteParlUrl(xmlPath);
  const xml = await fetchText(xmlUrl);
  const normalized = normalizeBillXml(xml, {
    session,
    number,
    sourceUrl: xmlUrl,
    documentViewerUrl,
    publicationType: pubType,
    stage: pubType,
  });
  await writeFile(path.join(dir, "bill.xml"), xml);
  await writeFile(
    path.join(dir, "bill.normalized.json"),
    `${JSON.stringify(normalized, null, 2)}\n`,
  );
  return { sections: normalized.sections.length, chars: normalized.fullText.length };
}

// Prefer the English structured bill XML under /Content/Bills/.
function extractXmlLink(html) {
  const all = [...html.matchAll(/\/Content\/Bills\/[^"'\s<>]+?\.xml/gi)].map(
    (m) => m[0],
  );
  if (all.length) return all.find((u) => /_E\.xml$/i.test(u)) ?? all[0];
  const any = html.match(/[^"'\s>]+\.xml/i);
  return any ? any[0] : null;
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
      targetActs: [
        ...new Set(
          [
            ...body.matchAll(
              /<XRefExternal[^>]*reference-type="act"[^>]*>([\s\S]*?)<\/XRefExternal>/gi,
            ),
          ]
            .map((m) => textContent(m[1]))
            .filter(Boolean),
        ),
      ],
      hasAmendedText: /<AmendedText\b/i.test(body),
    });
  }
  return { ...source, title, shortTitle, sponsor, fullText, sections };
}

function firstText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? textContent(match[1]) : "";
}
function textContent(xml) {
  return decodeEntities(
    xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
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
    .replace(/&#8217;/g, "’")
    .replace(/&#8212;/g, "—")
    .replace(/&#39;/g, "'");
}
function absoluteParlUrl(url) {
  if (url.startsWith("http")) return url;
  return `https://www.parl.ca${url.startsWith("/") ? "" : "/"}${url}`;
}
async function fetchText(url, tries = 3) {
  let lastErr;
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (a < tries) await new Promise((r) => setTimeout(r, 500 * a));
    }
  }
  throw lastErr;
}
