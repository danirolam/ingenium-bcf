// One-shot scraper of the Justice Laws "Consolidated Acts" index.
//
// Output: data/laws/master-registry.json — a slug → entry map mirroring
// data/laws/registry.json's shape, but covering every published federal Act.
// Run once (or whenever you want to refresh):
//
//   node --use-system-ca scripts/build-master-registry.mjs
//
// The server's lawFetcher consults this file to resolve targetActs from bill
// clauses to canonical Justice Laws XML URLs without manual data entry.

import { mkdir, writeFile } from "node:fs/promises";

const INDEX_URL = "https://laws-lois.justice.gc.ca/eng/acts/";
const OUT_PATH = "data/laws/master-registry.json";

const html = await fetchText(INDEX_URL);

// Match every internal Act link, e.g. /eng/acts/F-27/, /eng/acts/F-27/index.html,
// /eng/acts/F-27/FullText.html, /eng/acts/I-21.5/page-1.html, etc.
// We capture the chapter id (the directory after /eng/acts/).
const linkPattern =
  /<a\b[^>]*href="\/eng\/acts\/([^"\/]+?)\/(?:index\.html|FullText\.html|page-1\.html)?"[^>]*>([\s\S]*?)<\/a>/gi;

const seen = new Map();
for (const match of html.matchAll(linkPattern)) {
  const chapter = match[1];
  const rawTitle = textContent(match[2]);
  if (!rawTitle) continue;
  if (!isLikelyAct(rawTitle, chapter)) continue;
  if (seen.has(chapter)) continue;
  seen.set(chapter, { chapter, title: rawTitle });
}

// Pull citations out of the page when they sit beside the link in the same row.
// Citations look like "R.S.C., 1985, c. F-27" or "1992, c. 20" or "S.C. 2002, c. 1".
const citationByChapter = new Map();
const rowPattern =
  /<a\b[^>]*href="\/eng\/acts\/([^"\/]+?)\/[^"]*"[^>]*>[\s\S]*?<\/a>([\s\S]{0,400}?)(?=<a\b|<\/li>|<\/tr>|<br\s*\/?>)/gi;
for (const match of html.matchAll(rowPattern)) {
  const chapter = match[1];
  const tail = textContent(match[2]);
  const cite = extractCitation(tail);
  if (cite && !citationByChapter.has(chapter)) {
    citationByChapter.set(chapter, cite);
  }
}

const laws = {};
for (const { chapter, title } of seen.values()) {
  const slug = slugifyTitle(title);
  if (!slug) continue;
  if (laws[slug]) continue; // first wins on dupes
  const citation =
    citationByChapter.get(chapter) ?? defaultCitationForChapter(chapter);
  laws[slug] = {
    title,
    citation,
    jurisdiction: "Canada",
    level: "federal",
    chapter,
    currentPath: `data/laws/current/federal/${slug}`,
    source: {
      publisher: "Justice Laws Website",
      htmlUrl: `https://lois.justice.gc.ca/eng/acts/${chapter}/FullText.html`,
      xmlUrl: `https://lois.justice.gc.ca/eng/XML/${chapter}.xml`,
    },
  };
}

await mkdir("data/laws", { recursive: true });
await writeFile(
  OUT_PATH,
  `${JSON.stringify(
    {
      description:
        "Auto-generated mapping of federal Act title → Justice Laws XML URL. Source: scripts/build-master-registry.mjs over " +
        INDEX_URL,
      generatedAt: new Date().toISOString(),
      source: INDEX_URL,
      count: Object.keys(laws).length,
      laws,
    },
    null,
    2,
  )}\n`,
);

console.log(`wrote ${OUT_PATH}`);
console.log(`acts indexed: ${Object.keys(laws).length}`);

// ---------- helpers ----------

function isLikelyAct(title, chapter) {
  // Skip navigation / language toggle / index links that aren't actual Acts.
  if (!chapter.match(/^[A-Z0-9][A-Z0-9\-.]*$/i)) return false;
  if (title.length < 4) return false;
  if (/^(home|français|english|index|search|help|table)$/i.test(title.trim())) {
    return false;
  }
  return true;
}

function textContent(html) {
  return decodeEntities(
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractCitation(text) {
  const trimmed = text.trim();
  // R.S.C., 1985, c. F-27 ; R.S.C. 1985, c. F-27 ; S.C. 2002, c. 1 ; 1992, c. 20
  const patterns = [
    /\bR\.?S\.?C\.?,?\s*\d{4},?\s*c\.\s*[A-Z0-9\-.]+/i,
    /\bS\.?C\.?,?\s*\d{4},?\s*c\.\s*[A-Z0-9\-.]+/i,
    /\b\d{4},\s*c\.\s*[A-Z0-9\-.]+/i,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return m[0].replace(/\s+/g, " ");
  }
  return null;
}

function defaultCitationForChapter(chapter) {
  // Most R.S.C., 1985 chapters are like F-27, C-46, P-1, etc.
  if (/^[A-Z]+-\d/.test(chapter)) return `R.S.C., 1985, c. ${chapter}`;
  return `c. ${chapter}`;
}

function slugifyTitle(title) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "project-Injenium-hackathon-prototype" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}
