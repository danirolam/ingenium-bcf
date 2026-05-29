// One-off maintenance: bake practiceAreas into the committed bills snapshot so
// production hydrates with the field already present. Safe to re-run.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePracticeAreas } from "../src/lib/practiceAreas.js";
import type { Bill } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "server", "data", "bills.json");

const bills = JSON.parse(await fs.readFile(file, "utf-8")) as Bill[];
const updated = bills.map((b) => ensurePracticeAreas(b));
await fs.writeFile(file, JSON.stringify(updated, null, 2), "utf-8");

const tally: Record<string, number> = {};
let untagged = 0;
for (const b of updated) {
  if (b.practiceAreas.length === 0) untagged++;
  for (const p of b.practiceAreas) tally[p] = (tally[p] ?? 0) + 1;
}
console.log(`bills: ${updated.length}, untagged: ${untagged}`);
console.log(
  Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n"),
);
