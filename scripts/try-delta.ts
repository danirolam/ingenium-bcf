// Prove the grounded amendment engine on one bill × Act.
//   npx tsx scripts/try-delta.ts C-265 food-and-drugs-act
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { interpretAmendments } from "../server/services/gemini.js";
import {
  applyAmendments,
  diffProvisions,
  diffSummary,
  type Provision,
} from "../server/services/amendmentEngine.js";
import { loadActProvisions } from "../server/services/lawProvisions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Minimal .env loader (the app does this too; no dotenv dep).
for (const line of (await fs.readFile(path.join(ROOT, ".env"), "utf8").catch(() => "")).split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const [billNumber, slug] = process.argv.slice(2);
const bills = JSON.parse(await fs.readFile(path.join(ROOT, "server/data/bills.json"), "utf8"));
const bill = bills.find((b: any) => b.billNumber === billNumber);
const act = await loadActProvisions(slug);
if (!act) { console.log(`No structured Act ingested for slug "${slug}".`); process.exit(1); }
const provisions: Provision[] = act.provisions;

console.log(`Bill ${billNumber} × ${act.title} — ${provisions.length} provisions, ${bill.clauses.length} clauses\n`);

const ai = await interpretAmendments({
  bill,
  actTitle: act.title,
  actLabels: provisions.map((p) => p.label),
});
if (!ai) { console.log("interpretAmendments returned null (no/invalid GEMINI key?)"); process.exit(1); }

const { after, verified } = applyAmendments(provisions, ai.operations);

console.log("OPERATIONS the AI extracted (anchor verified against the real Act):");
for (const v of verified) {
  console.log(
    `  ${v.anchorFound ? "✓" : "✗ ANCHOR NOT FOUND"}  clause ${v.clause}  ${v.op.toUpperCase()} ` +
    `${v.position ?? ""} ${v.anchor ?? "(new part)"}` +
    (v.newLabel ? ` → ${v.newLabel}${v.newMarginalNote ? ` "${v.newMarginalNote}"` : ""}` : ""),
  );
}

const rows = diffProvisions(provisions, after);
console.log("\nDIFF:", JSON.stringify(diffSummary(rows)));

const firstAdd = rows.find((r) => r.status === "added");
if (firstAdd?.after) {
  console.log(`\nSample ADDED provision  ${firstAdd.after.label} "${firstAdd.after.marginalNote ?? ""}":`);
  console.log("  " + firstAdd.after.text.slice(0, 240) + "…");
}
const firstChg = rows.find((r) => r.status === "changed");
if (firstChg?.before && firstChg?.after) {
  console.log(`\nSample CHANGED provision ${firstChg.label}:`);
  console.log("  BEFORE: " + firstChg.before.text.slice(0, 140) + "…");
  console.log("  AFTER:  " + firstChg.after.text.slice(0, 140) + "…");
}
