import { mkdir, readFile, writeFile } from "node:fs/promises";

const registry = JSON.parse(await readFile("data/laws/registry.json", "utf8"));
const laws = registry.laws;

const args = process.argv.slice(2);
const slugs = args.includes("--all")
  ? Object.keys(laws)
  : args.length
    ? args
    : ["food-and-drugs-act"];

for (const slug of slugs) {
  const law = laws[slug];
  if (!law) throw new Error(`Unknown law slug: ${slug}`);

  const xml = await fetchText(law.source.xmlUrl);
  const normalized = normalizeLawXml(xml, law);
  const dir = law.currentPath;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/current.xml`, xml);
  await writeFile(`${dir}/current.normalized.json`, `${JSON.stringify(normalized, null, 2)}\n`);
  await writeFile(`${dir}/source.json`, `${JSON.stringify({ ...law, fetchedAt: new Date().toISOString() }, null, 2)}\n`);

  console.log(`retrieved ${law.title}`);
  console.log(`sections: ${normalized.sections.length}`);
}

function normalizeLawXml(xml, law) {
  const sections = [];
  const sectionPattern = /<Section\b([^>]*)>([\s\S]*?)<\/Section>/gi;
  for (const match of xml.matchAll(sectionPattern)) {
    const body = match[2] || "";
    const label = firstText(body, "Label");
    if (!label) continue;
    sections.push({
      label,
      marginalNote: firstText(body, "MarginalNote"),
      text: textContent(body)
    });
  }
  return {
    ...law,
    normalizedAt: new Date().toISOString(),
    fullText: textContent(xml),
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

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "project-Injenium-hackathon-prototype" }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}
