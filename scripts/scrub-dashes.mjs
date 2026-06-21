// One-time (and re-runnable) scrub of em/en dashes from the committed data
// snapshot and the on-disk delta seed, so no machine-written dash ever reaches
// the UI. Mirrors humanizeDashes() in server/services/clientScanCore.ts: a
// spaced connector becomes a comma, a tight dash between words/numbers becomes a
// hyphen (so "Canada—United Kingdom" reads "Canada-United Kingdom" and "0–100"
// reads "0-100"), and anything left becomes a comma.
//
// Dashes only ever appear inside JSON string values (structural JSON is ASCII),
// so a raw-text replace is safe and preserves each file's formatting exactly.
//
//   node scripts/scrub-dashes.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  "server/data/bills.json",
  "server/data/lawVersions.json",
  "server/data/clients.json",
  "server/data/provisionDeltas.json", // gitignored on-disk seed (ships in the bundle)
  "server/data/clientImpactAnalyses.json",
];

// Figure dash, en, em, horizontal bar, minus sign. Plain + nb hyphen kept.
const DASH = "‒-―−";
function tidy(s) {
  return s
    .replace(new RegExp(`\\s+[${DASH}]\\s+`, "g"), ", ")
    .replace(new RegExp(`([A-Za-z0-9)])[${DASH}]([A-Za-z0-9(])`, "g"), "$1-$2")
    .replace(new RegExp(`[${DASH}]`, "g"), ", ")
    .replace(/ +([,.;:])/g, "$1")
    .replace(/,\s*,/g, ",");
}

let total = 0;
for (const rel of TARGETS) {
  const p = path.join(root, rel);
  if (!existsSync(p)) {
    console.log(`- ${rel} (absent, skipped)`);
    continue;
  }
  const before = readFileSync(p, "utf8");
  const dashRe = new RegExp(`[${DASH}]`, "g");
  const dashes = (before.match(dashRe) || []).length;
  if (dashes === 0) {
    console.log(`- ${rel}: already clean`);
    continue;
  }
  const after = tidy(before);
  // Sanity: the result must still parse as JSON.
  JSON.parse(after);
  writeFileSync(p, after, "utf8");
  const left = (after.match(dashRe) || []).length;
  total += dashes - left;
  console.log(`- ${rel}: cleaned ${dashes - left} dashes (${left} left)`);
}
console.log(`Done. ${total} dashes removed.`);
