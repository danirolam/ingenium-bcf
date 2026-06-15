/**
 * STAGE-2 HEALTH EVAL — does the deterministic XML→delta actually work on REAL bills?
 *
 * Runs the real provision-delta pipeline over the bills that have clause text +
 * a textSourceUrl, and scores each result on proxy signals (no gold needed) —
 * grounding, null-anchors, path mix, changed-rows. Surfaces a worst-first board
 * and a failure taxonomy so the dominant breakage forms are obvious (→ Slice 2b).
 *
 * Acts resolve via the committed public Blob manifest, so this runs against a
 * local server with no extra setup. Prereq: a server is up (npm run dev / npm run
 * server). Run keyed to include the scalpel + Path-B fallback (flagged separately);
 * keyless isolates the pure deterministic structural parse.
 *
 *   npx tsx eval/run-delta-health.ts                       # all bills-with-text, clauses ≤ maxClauses
 *   npx tsx eval/run-delta-health.ts --registered-only     # only bills whose targetActs are registered
 *   npx tsx eval/run-delta-health.ts --max-clauses 120 --limit 30
 *   npx tsx eval/run-delta-health.ts --all                 # no caps (slow: includes 1000-clause bills)
 *   npx tsx eval/run-delta-health.ts --spot 8              # also dump 8 worst rendered deltas to eyeball
 *
 * NON-DESTRUCTIVE: snapshots every candidate's provisionDeltas record up front and
 * restores them on exit (even on error), so seeded gold / demo records are intact.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreHealth, oversizedHealth, aggregateHealth, worstFirst, type BillHealth } from "./delta-health.js";
import { afterTextOf, labelOf, type DeltaLike } from "./delta-score.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const DATA = path.join(REPO, "server", "data");
const BILLS_FILE = path.join(DATA, "bills.json");
const DELTAS_FILE = path.join(DATA, "provisionDeltas.json");
const REGISTRY_FILE = path.join(REPO, "data", "laws", "registry.json");
const OUT_DIR = path.join(HERE, "out");

const BASE = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const DELTA_TIMEOUT_MS = 300_000;

interface BillRec {
  id: string;
  billNumber?: string;
  title?: string;
  session?: string;
  textSourceUrl?: string;
  clauses?: { targetActs?: string[] }[];
}
interface DeltaResponse {
  deltas?: DeltaLike[];
  errors?: string[];
  aiIncomplete?: boolean;
  oversized?: boolean; // response too large to parse (route returns the whole Act as rows)
  bytes?: number;
}

// Beyond this the route is shipping the entire (huge) Act back as diff rows; don't
// JSON.parse it (a single multi-hundred-MB parse OOMs). Record it as a scaling finding.
const RESPONSE_CAP = 40_000_000;

const slugify = (s: string) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf-8")) as T;
}
async function readRecords(): Promise<{ id: string }[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(DELTAS_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}
async function writeRecords(items: unknown[]): Promise<void> {
  const tmp = `${DELTAS_FILE}.${process.pid}.health.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
  await fs.rename(tmp, DELTAS_FILE);
}

async function refreshDelta(billId: string): Promise<DeltaResponse> {
  const res = await fetch(`${BASE}/api/bills/${billId}/provision-delta?refresh=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(DELTA_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  if (text.length > RESPONSE_CAP) return { oversized: true, bytes: text.length };
  return JSON.parse(text) as DeltaResponse;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const snip = (s: string, n = 120) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t || "—";
};

interface Flags {
  maxClauses: number;
  limit: number;
  registeredOnly: boolean;
  all: boolean;
  spot: number;
}
function parseFlags(argv: string[]): Flags {
  const num = (flag: string, def: number) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
  };
  const all = argv.includes("--all");
  return {
    all,
    registeredOnly: argv.includes("--registered-only"),
    maxClauses: all ? Number.POSITIVE_INFINITY : num("--max-clauses", 250),
    limit: num("--limit", 0),
    spot: num("--spot", 0),
  };
}

async function selectCandidates(f: Flags): Promise<{ bill: BillRec; clauseCount: number }[]> {
  const bills = await readJson<BillRec[]>(BILLS_FILE);
  const reg = await readJson<any>(REGISTRY_FILE);
  const regSlugs = new Set(Object.keys(reg.laws ?? reg));

  let pool = (Array.isArray(bills) ? bills : []).filter(
    (b) => (b.clauses?.length ?? 0) > 0 && !!b.textSourceUrl,
  );
  if (f.registeredOnly) {
    pool = pool.filter((b) =>
      (b.clauses ?? []).some((c) => (c.targetActs ?? []).some((t) => regSlugs.has(slugify(t)))),
    );
  }
  pool = pool.filter((b) => (b.clauses?.length ?? 0) <= f.maxClauses);
  pool.sort((a, b) => (a.clauses?.length ?? 0) - (b.clauses?.length ?? 0));
  if (f.limit > 0) pool = pool.slice(0, f.limit);
  return pool.map((b) => ({ bill: b, clauseCount: b.clauses?.length ?? 0 }));
}

function renderIndex(items: BillHealth[]): string {
  const agg = aggregateHealth(items);
  const bc = agg.bucketCounts;
  const tax = [
    `| bucket | bills | meaning |`,
    `| --- | --- | --- |`,
    `| ❌ no-delta | ${bc["no-delta"]} | no Act resolved / not ingested |`,
    `| ⚠️ empty | ${bc.empty} | Act resolved but 0 ops or all-unchanged |`,
    `| ⚠️ fell-to-pathB | ${bc["fell-to-pathB"]} | deterministic parse found nothing → agentic fallback |`,
    `| ⚠️ oversized | ${bc.oversized} | Act too large — route returns the whole Act as rows (scaling) |`,
    `| ⚠️ null-anchors | ${bc["null-anchors"]} | >20% of ops have anchor=null (unparsed form → appended) |`,
    `| ⚠️ low-grounding | ${bc["low-grounding"]} | <80% of ops resolved their anchor in the Act |`,
    `| ✅ healthy | ${bc.healthy} | grounded, real diff, deterministic |`,
  ].join("\n");

  const rows = worstFirst(items).map((b) => {
    const tag =
      b.bucket === "healthy" ? "✅" : b.bucket === "no-delta" || b.bucket === "empty" ? "❌" : "⚠️";
    const paths = [b.pathBillXml && `xml×${b.pathBillXml}`, b.pathAssisted && `scalpel×${b.pathAssisted}`, b.pathB && `pathB×${b.pathB}`]
      .filter(Boolean)
      .join(" ");
    return (
      `| ${tag} ${b.billNumber ?? b.billId} | ${b.bucket} | ${b.clauseCount} | ${b.acts} | ${b.ops} | ` +
      `${b.ops ? pct(b.groundingRate) : "—"} | ${b.nullAnchor || ""} | ${b.changedRows}/${b.totalRows} | ${paths || "—"}` +
      `${b.aiIncomplete ? " ⚠️inc" : ""}${b.errors.length ? ` · ${snip(b.errors.join("; "), 60)}` : ""} |`
    );
  });

  return [
    `# Stage-2 health — real pipeline over bills-with-text`,
    ``,
    `Generated ${new Date().toISOString()} against \`${BASE}\`. No gold — proxy signals only.`,
    ``,
    `**Aggregate:** ${agg.bills} bills · ${agg.withDelta} produced a delta · ${agg.totalOps} ops · ` +
      `grounding **${pct(agg.groundingRate)}** · null-anchor **${pct(agg.nullAnchorRate)}** · ` +
      `unresolved ${pct(agg.unresolvedRate)} · bills touching: xml ${agg.pathBills.billXml}, ` +
      `scalpel ${agg.pathBills.assisted}, pathB ${agg.pathBills.pathB} · incomplete ${agg.incompleteBills}.`,
    ``,
    `## Failure taxonomy`,
    ``,
    tax,
    ``,
    `## Bills (worst first)`,
    ``,
    `| bill | bucket | clauses | acts | ops | grounding | null⌀ | changed/rows | paths |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...rows,
    ``,
  ].join("\n");
}

function renderSpot(billNumber: string, deltas: DeltaLike[]): string {
  const acts = deltas.map((d) => {
    const ops = (d.operations ?? [])
      .map((o) => {
        const lbl = labelOf(o, d);
        return `  - ${o.op ?? "?"} anchor=${JSON.stringify(o.anchor ?? null)} found=${o.anchorFound} → ${lbl ?? "?"}\n    ${snip(afterTextOf(o, d))}`;
      })
      .join("\n");
    return `### ${d.slug} _(source: ${d.source})_\n${ops || "_(no ops)_"}`;
  });
  return [`## ${billNumber}`, ...acts, ``].join("\n");
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const f = parseFlags(process.argv);
  const candidates = await selectCandidates(f);
  console.log(
    `[health] base=${BASE} · ${candidates.length} candidate bills ` +
      `(clauses≤${f.all ? "∞" : f.maxClauses}${f.registeredOnly ? ", registered-only" : ""}${f.limit ? `, limit ${f.limit}` : ""}).`,
  );
  if (!candidates.length) {
    console.log("[health] no candidates — nothing to do.");
    return;
  }

  const before = await readRecords(); // small (gold + demo); rewritten after every bill
  console.log(`[health] ${before.length} existing records (store reset after every bill to stay small).`);

  const items: BillHealth[] = [];
  const spots = new Map<string, string>();
  let i = 0;
  try {
    for (const { bill, clauseCount } of candidates) {
      i++;
      const label = bill.billNumber ?? bill.id;
      try {
        const resp = await refreshDelta(bill.id);
        let h: BillHealth;
        if (resp.oversized) {
          h = oversizedHealth(label, bill.id, clauseCount, resp.bytes ?? 0);
        } else {
          const deltas = resp.deltas ?? [];
          h = scoreHealth(label, bill.id, clauseCount, deltas, resp.errors ?? [], resp.aiIncomplete === true);
          if (f.spot > 0 && h.bucket !== "healthy" && deltas.length) spots.set(label, renderSpot(label, deltas));
        }
        items.push(h);
        console.log(
          `  [${i}/${candidates.length}] ${label} (${clauseCount}cl) → ${h.bucket} · ` +
            `${h.acts} acts · ${h.ops} ops · ground ${h.ops ? pct(h.groundingRate) : "—"}${h.nullAnchor ? ` · ${h.nullAnchor} null` : ""}`,
        );
      } catch (err) {
        items.push(scoreHealth(label, bill.id, clauseCount, [], [(err as Error).message], false));
        console.log(`  [${i}/${candidates.length}] ${label} → ERROR: ${(err as Error).message}`);
      } finally {
        // The route caches each refreshed delta (the WHOLE Act as rows). Overwrite the
        // store with the small original after EVERY bill — write-only, never re-parsing
        // the grown file — so neither the server's next upsert nor our restore can OOM,
        // and the run stays non-destructive.
        await writeRecords(before);
      }
    }
  } finally {
    await writeRecords(before);
    console.log(`[health] store restored to ${before.length} records ✓`);
  }

  await fs.writeFile(path.join(OUT_DIR, "health-INDEX.md"), renderIndex(items), "utf-8");
  let files = 1;
  if (f.spot > 0) {
    const spotted = worstFirst(items).filter((b) => spots.has(b.billNumber)).slice(0, f.spot);
    const md = [`# Health spot-check — ${spotted.length} worst bills (rendered ops)`, ``]
      .concat(spotted.map((b) => spots.get(b.billNumber) ?? ""))
      .join("\n");
    await fs.writeFile(path.join(OUT_DIR, "health-spot.md"), md, "utf-8");
    files++;
  }
  console.log(`[health] done. Wrote ${files} file(s) to eval/out/. Start at eval/out/health-INDEX.md`);
}

main().catch((err) => {
  console.error("[health] failed:", err);
  process.exitCode = 1;
});
