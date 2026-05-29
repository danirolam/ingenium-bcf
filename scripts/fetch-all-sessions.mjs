// Pulls a lightweight index of EVERY bill across all parliamentary sessions
// from the OpenParliament API (the rich path/text/votes stay 45-1 only — full
// text for thousands of bills isn't feasible). Pages through /bills/, plus a
// second pass with law=True to mark which bills became law.
//
//   node --use-system-ca scripts/fetch-all-sessions.mjs
import { writeFile, mkdir } from "node:fs/promises";

const UA = "project-injenium (legislative research; contact dev@bcf.example)";
const BASE = "https://api.openparliament.ca";

async function fetchJson(url, tries = 4) {
  let lastErr;
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (a < tries) await new Promise((r) => setTimeout(r, 700 * a));
    }
  }
  throw lastErr;
}

async function fetchAll(query) {
  const out = [];
  let url = `${BASE}/bills/?format=json&limit=500${query}`;
  while (url) {
    const j = await fetchJson(url);
    out.push(...(j.objects ?? []));
    const next = j.pagination?.next_url;
    url = next ? (next.startsWith("http") ? next : `${BASE}${next}`) : null;
    process.stdout.write(`\r  ${out.length} fetched…`);
  }
  process.stdout.write("\n");
  return out;
}

console.log("Fetching all bills across sessions…");
const all = await fetchAll("");
console.log(`Total bills: ${all.length}`);

console.log("Fetching bills that became law…");
const laws = await fetchAll("&law=True");
const lawKeys = new Set(laws.map((b) => `${b.session}/${b.number}`));
console.log(`Became law: ${lawKeys.size}`);

const records = all.map((b) => ({
  session: b.session,
  number: b.number,
  title: b.name?.en ?? b.short_title?.en ?? b.number,
  introduced: b.introduced ?? null,
  legisinfoId: b.legisinfo_id ?? null,
  becameLaw: lawKeys.has(`${b.session}/${b.number}`),
}));

const sessions = [...new Set(records.map((r) => r.session))].sort();
await mkdir("data", { recursive: true });
await writeFile(
  "data/all-sessions.json",
  `${JSON.stringify({ fetchedAt: new Date().toISOString(), count: records.length, sessions, records }, null, 2)}\n`,
);
console.log(
  `Wrote data/all-sessions.json — ${records.length} bills across ${sessions.length} sessions (${sessions.join(", ")})`,
);
