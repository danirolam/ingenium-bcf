// Pulls real sponsor + precise status + latest activity for EVERY bill, using
// LEGISinfo's bulk per-session JSON (one call per session — polite + fast,
// vs thousands of per-bill calls). Keyed by session|billNumber.
//
//   node --use-system-ca scripts/fetch-sessions-detail.mjs
import { writeFile, mkdir } from "node:fs/promises";

const UA = "project-injenium (legislative research; contact dev@bcf.example)";
const SESSIONS = [
  "37-1", "37-2", "37-3", "38-1", "39-1", "39-2", "40-1", "40-2",
  "40-3", "41-1", "41-2", "42-1", "43-1", "43-2", "44-1", "45-1",
];

const out = {};
let total = 0;

for (const s of SESSIONS) {
  try {
    const res = await fetch(
      `https://www.parl.ca/legisinfo/en/bills/json?parlsession=${s}`,
      { headers: { "user-agent": UA } },
    );
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.objects ?? []);
    for (const b of list) {
      const num =
        b.BillNumberFormatted ??
        `${b.BillNumberPrefix ?? ""}-${b.BillNumber ?? ""}`;
      out[`${s}|${num}`] = {
        sponsor: b.SponsorEn || null,
        status: b.CurrentStatusEn || null,
        latestActivity: b.LatestActivityEn || null,
        latestActivityDate: b.LatestActivityDateTime || null,
        royalAssent: b.ReceivedRoyalAssentDateTime || null,
        shortTitle: b.ShortTitleEn || null,
        introduced:
          b.PassedHouseFirstReadingDateTime ||
          b.PassedSenateFirstReadingDateTime ||
          null,
        latestStage: b.LatestCompletedMajorStageEn || null,
      };
    }
    total += list.length;
    console.log(`${s}: ${list.length} bills`);
  } catch (e) {
    console.warn(`${s}: FAILED — ${e?.message ?? e}`);
  }
}

await mkdir("data", { recursive: true });
await writeFile(
  "data/sessions-detail.json",
  `${JSON.stringify({ fetchedAt: new Date().toISOString(), count: total, bills: out }, null, 2)}\n`,
);
console.log(`Wrote data/sessions-detail.json — ${Object.keys(out).length} bills enriched`);
