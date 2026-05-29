// Fetch the LEGISinfo per-bill detail record (the rich one carrying BillStages:
// House/Senate/RoyalAssent stages, committees, sittings, and recorded divisions)
// for every bill in the session and cache it as metadata.json. This is the
// source the snapshot builder reads to bake the legislative path into bills.json.
//
//   node --use-system-ca scripts/fetch-bill-metadata.mjs            # all bills
//   node --use-system-ca scripts/fetch-bill-metadata.mjs --limit 5  # smoke test
//   node --use-system-ca scripts/fetch-bill-metadata.mjs --session 45-1
import { mkdir, readFile, writeFile } from "node:fs/promises";

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
};

const session = arg("--session", "45-1");
const limit = arg("--limit") ? Number(arg("--limit")) : null;
const concurrency = arg("--concurrency") ? Number(arg("--concurrency")) : 8;

const listPath = `data/normalized/bills.${session}.json`;
const all = JSON.parse(await readFile(listPath, "utf8"));
const bills = (limit ? all.slice(0, limit) : all).filter((b) => b && b.number);

console.log(`fetching ${bills.length} bill detail records (session ${session}, concurrency ${concurrency})`);

const failures = [];
let done = 0;
let withPath = 0;

async function fetchDetail(number) {
  const url = `https://www.parl.ca/legisinfo/en/bill/${session}/${number.toLowerCase()}/json`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "project-injenium-legislative-monitor" },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      return Array.isArray(json) ? json[0] : json;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr;
}

async function handle(bill) {
  const number = bill.number;
  try {
    const detail = await fetchDetail(number);
    if (!detail) throw new Error("empty detail");
    const dir = `data/bills/${session}/${number}`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/metadata.json`, `${JSON.stringify(detail, null, 2)}\n`);
    const stages = detail?.BillStages;
    const stageCount =
      (stages?.HouseBillStages?.length ?? 0) +
      (stages?.SenateBillStages?.length ?? 0) +
      (stages?.RoyalAssent?.length ?? 0);
    if (stageCount > 0) withPath += 1;
    done += 1;
    console.log(`  [${done}/${bills.length}] ${number}  stages=${stageCount}  ${detail?.StatusNameEn ?? ""}`);
  } catch (err) {
    failures.push({ number, message: String(err?.message ?? err) });
    console.warn(`  ! ${number} failed: ${err?.message ?? err}`);
  }
}

// Simple fixed-size worker pool.
const queue = [...bills];
async function worker() {
  while (queue.length) {
    const bill = queue.shift();
    if (bill) await handle(bill);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

console.log(
  `\ndone: ${done}/${bills.length} written, ${withPath} with stage data, ${failures.length} failed`,
);
if (failures.length) console.log("failures:", JSON.stringify(failures, null, 2));
