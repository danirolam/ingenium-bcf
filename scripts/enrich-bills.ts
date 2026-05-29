// Folds the per-session sponsor + precise status (data/sessions-detail.json)
// into the snapshot's lightweight cross-session bills. The rich 45-1 bills
// (which already carry full sponsor/status/path) are left untouched.
//   npx tsx scripts/enrich-bills.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapMomentum } from "../server/services/billNormalizer.js";
import type { Bill } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const billsFile = path.join(root, "server", "data", "bills.json");
const detailFile = path.join(root, "data", "sessions-detail.json");

const bills = JSON.parse(await fs.readFile(billsFile, "utf-8")) as Bill[];
const { bills: detail } = JSON.parse(
  await fs.readFile(detailFile, "utf-8"),
) as {
  bills: Record<
    string,
    {
      sponsor: string | null;
      status: string | null;
      latestActivity: string | null;
      latestActivityDate: string | null;
      royalAssent: string | null;
      shortTitle: string | null;
      introduced: string | null;
      latestStage: string | null;
    }
  >;
};

let enriched = 0;
let withSponsor = 0;
for (const b of bills) {
  // Leave the rich 45-1 bills (full sponsor/status/path) alone.
  if (b.legislativePath && b.legislativePath.length) continue;
  const d = detail[`${b.session ?? ""}|${b.billNumber}`];
  if (!d) continue;
  if (d.status) b.status = d.status;
  if (d.shortTitle && !b.shortTitle) b.shortTitle = d.shortTitle;
  if (d.introduced && !b.introducedDate) b.introducedDate = d.introduced;
  if (d.royalAssent) b.royalAssentDate = d.royalAssent;
  if (d.latestActivity) b.latestActivity = d.latestActivity;
  if (d.sponsor) {
    b.sponsor = { name: d.sponsor };
    withSponsor += 1;
  }
  b.legislativeMomentum = mapMomentum(
    d.status ?? undefined,
    d.latestActivity ?? undefined,
    b.legislativeMomentum,
  );
  enriched += 1;
}

await fs.writeFile(billsFile, `${JSON.stringify(bills, null, 2)}\n`, "utf-8");
console.log(`Enriched ${enriched} cross-session bills (${withSponsor} with a named sponsor).`);
