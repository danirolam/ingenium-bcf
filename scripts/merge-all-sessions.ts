// Merges the cross-session bill index (data/all-sessions.json) into the
// committed snapshot as lightweight Bill records. Existing bills (the rich 45-1
// set) are never overwritten — only sessions/bills we don't already have are
// added. Run with:  npx tsx scripts/merge-all-sessions.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derivePracticeAreas } from "../src/lib/practiceAreas.js";
import type { Bill } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const billsFile = path.join(root, "server", "data", "bills.json");
const indexFile = path.join(root, "data", "all-sessions.json");

const CURRENT = "45-1";

const bills = JSON.parse(await fs.readFile(billsFile, "utf-8")) as Bill[];
const index = JSON.parse(await fs.readFile(indexFile, "utf-8")) as {
  records: Array<{
    session: string;
    number: string;
    title: string;
    introduced: string | null;
    legisinfoId: number | null;
    becameLaw: boolean;
  }>;
};

const have = new Set(bills.map((b) => `${b.session ?? ""}|${b.billNumber}`));
let added = 0;

for (const r of index.records) {
  const key = `${r.session}|${r.number}`;
  if (have.has(key)) continue;
  have.add(key);
  const isCurrent = r.session === CURRENT;
  const light: Bill = {
    id: `op-${r.session}-${r.number}`,
    billNumber: r.number,
    title: r.title,
    status: r.becameLaw
      ? "Became law"
      : isCurrent
        ? "In progress"
        : "Did not become law",
    legislativeMomentum: r.becameLaw ? "in_force" : isCurrent ? "active" : "early",
    session: r.session,
    sourceUrl: `https://www.parl.ca/legisinfo/en/bill/${r.session}/${r.number.toLowerCase()}`,
    uploadedAt: r.introduced
      ? `${r.introduced}T00:00:00.000Z`
      : "2001-01-01T00:00:00.000Z",
    rawJson: {
      source: "openparliament",
      legisinfoId: r.legisinfoId,
      introduced: r.introduced,
      becameLaw: r.becameLaw,
    },
    clauses: [],
    practiceAreas: derivePracticeAreas({ title: r.title }),
    introducedDate: r.introduced ?? undefined,
    latestActivity: r.becameLaw
      ? "Received royal assent"
      : r.introduced
        ? `Introduced ${r.introduced}`
        : undefined,
  };
  bills.push(light);
  added += 1;
}

await fs.writeFile(billsFile, `${JSON.stringify(bills, null, 2)}\n`, "utf-8");

const bySession: Record<string, number> = {};
for (const b of bills)
  bySession[b.session ?? "?"] = (bySession[b.session ?? "?"] ?? 0) + 1;
console.log(`total bills: ${bills.length} (added ${added} cross-session records)`);
console.log("sessions:", Object.keys(bySession).sort().join(", "));
console.log("counts:", JSON.stringify(bySession));
