/**
 * STAGE-2 FIDELITY EVAL — grades the REAL legal-delta pipeline against the gold.
 *
 * Unlike `run-eval.ts` (which grades stages 3-4 and *trusts* the seeded delta),
 * this runs the actual stage-1/2 pipeline on the 5 benchmark bills and scores its
 * output op-by-op against the hand-authored gold in `fixtures/bill-deltas.ts`.
 *
 * Prereq: a KEYED server is up (`npm run dev`, ANTHROPIC_API_KEY set). Then, from
 * the repo root:
 *
 *   npx tsx eval/run-delta-eval.ts            # default base http://localhost:8787
 *   EVAL_BASE_URL=http://localhost:8787 npx tsx eval/run-delta-eval.ts
 *   npx tsx eval/run-delta-eval.ts --selftest # score the gold against itself (no server) → must be 100%
 *
 * Per bill (C-273/233/250/251/259): POST /provision-delta?refresh=1, score the
 * response vs gold, dump the raw generated delta (delta__<bill>.gen.json, for
 * offline re-scoring), and write delta-INDEX.md + delta__<bill>.md.
 *
 * NON-DESTRUCTIVE: `?refresh=1` overwrites the bill's record in
 * provisionDeltas.json. We snapshot the 5 bills' records up front and restore
 * them on exit (even on error), so the seeded gold — which the stage-3/4 eval
 * depends on — is left exactly as found (it prints `faithful ✓`).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_BILLS } from "./fixtures/bill-deltas.js";
import { scoreBill, aggregate, type BillScore, type DeltaLike, type SlugScore } from "./delta-score.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "server", "data");
const DELTAS_FILE = path.join(DATA, "provisionDeltas.json");
const OUT_DIR = path.join(HERE, "out");

const BASE = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const DELTA_TIMEOUT_MS = 300_000; // interpretation over many Acts can take minutes

interface DeltaResponse {
  deltas?: DeltaLike[];
  errors?: string[];
  aiIncomplete?: boolean;
  aiIncompleteReason?: string | null;
}

// ── store snapshot/restore (atomic, mirrors seed-eval.ts) ──
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
  const tmp = `${DELTAS_FILE}.${process.pid}.delta-eval.tmp`;
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
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as DeltaResponse;
}

// ── markdown ──
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fx = (x: number) => x.toFixed(2);
const snip = (s: string, n = 140) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t || "—";
};

function renderSlug(s: SlugScore): string {
  const head =
    `### ${s.slug}${s.title ? ` — ${s.title}` : ""}  _(path: ${s.inGen ? s.genSource ?? "?" : "**NOT PRODUCED**"})_\n` +
    `gold ops: ${s.goldOps} · **placed: ${s.placed}** · content: ${s.contentMatched} · exact-anchor: ${s.exactAnchored} · ` +
    `gen ops: ${s.genOps} (contributing: ${s.contributingGen})`;

  const rows = s.golds.map((g) => {
    const placed = g.placed ? `✓ ${fx(g.coverage)}` : g.content ? "✗ misplaced" : "❌ MISS";
    const gen = g.placed || g.fidelity > 0 ? `\`${g.genAnchor ?? "—"}\`` : "—";
    const checks = g.placed ? `${g.opTypeOk ? "✓" : "✗"} · ${g.grounded ? "✓" : "✗"} · ${fx(g.fidelity)}` : "—";
    return `| \`${g.anchor ?? "—"}\`${g.label ? ` → ${g.label}` : ""} | ${g.op ?? "?"} | ${placed} | ${gen} | ${checks} |`;
  });

  const diffs = s.golds
    .filter((g) => !g.placed || g.fidelity < 0.8)
    .map(
      (g) =>
        `- **${g.anchor ?? "—"}${g.label ? ` (${g.label})` : ""}** [${g.op ?? "?"}] — ` +
        `${g.placed ? `placed, fidelity ${fx(g.fidelity)}` : g.content ? "**misplaced** (text produced elsewhere)" : "**not produced**"}\n` +
        `  - gold: ${snip(g.text)}\n` +
        `  - gen:  ${snip(g.genText)}`,
    );

  const spurious = s.spuriousGen.length
    ? `\n**Gen ops that placed nothing (${s.spuriousGen.length}):** ` +
      s.spuriousGen.map((o) => `\`${o.anchor ?? "null"}\`[${o.op ?? "?"}${o.anchorFound ? "" : ",✗ground"}]`).join(", ")
    : "";

  return [
    head,
    ``,
    `| gold anchor → label | op | placed (cov) | gen anchor | op·ground·fid |`,
    `| --- | --- | --- | --- | --- |`,
    ...rows,
    ``,
    diffs.length ? `**Divergences (unplaced or fidelity < 0.80):**` : `_all gold ops placed ≥ 0.80 fidelity_`,
    ...diffs,
    spurious,
    ``,
  ].join("\n");
}

interface Row {
  billNumber: string;
  score?: BillScore;
  error?: string;
  reason?: string | null;
}

function renderIndex(results: Row[]): string {
  const scored = results.filter((r): r is Row & { score: BillScore } => !!r.score);
  const agg = aggregate(scored.map((r) => r.score));

  const header = `| Bill | Acts (cov) | placement | content | precision | op-type | grounding | fidelity | notes |`;
  const sep = `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`;
  const rows = results.map((r) => {
    if (!r.score) return `| ${r.billNumber} | — | — | — | — | — | — | — | ⚠️ ${r.error} |`;
    const s = r.score;
    const notes: string[] = [];
    if (s.aiIncomplete) notes.push(`⚠️ incomplete${r.reason ? ` (${r.reason})` : ""}`);
    if (s.spuriousSlugs.length) notes.push(`⚠️ spurious Acts: ${s.spuriousSlugs.join(", ")} (${s.spuriousGenOps} ops)`);
    const fellToAi = s.perSlug.filter((ps) => ps.inGen && ps.genSource === "ai").map((ps) => ps.slug);
    if (fellToAi.length) notes.push(`Path B: ${fellToAi.join(", ")}`);
    const missingSlugs = s.perSlug.filter((ps) => !ps.inGen).map((ps) => ps.slug);
    if (missingSlugs.length) notes.push(`missing: ${missingSlugs.join(", ")}`);
    return (
      `| ${s.billNumber} | ${s.genSlugs}/${s.goldSlugs} (${pct(s.slugCoverage)}) | **${pct(s.placementRecall)}** | ` +
      `${pct(s.contentRecall)} | ${pct(s.precision)} | ${pct(s.opTypeAccuracy)} | ${pct(s.groundingRate)} | ` +
      `${fx(s.meanTextFidelity)} | ${notes.join("; ") || "—"} |`
    );
  });

  return [
    `# Stage-2 fidelity — generated delta vs gold`,
    ``,
    `Generated ${new Date().toISOString()} against \`${BASE}\`. The REAL pipeline was run on each`,
    `bill (\`?refresh=1\`) and scored op-by-op against \`eval/fixtures/bill-deltas.ts\`.`,
    ``,
    `**Metrics** — *placement*: gold ops the pipeline reproduced in the right structural place`,
    `(granularity-tolerant: split/merge OK) · *content*: gold ops whose text appears anywhere in the`,
    `Act · *precision*: gen ops that placed a gold op, over ALL gen ops incl. spurious Acts · *op-type*:`,
    `placed ops with the right add/replace/amend/repeal · *grounding*: placed ops with`,
    `\`anchorFound=true\` · *fidelity*: mean token-overlap of placed ops. High content + low placement`,
    `⇒ a placement/parse bug; low precision ⇒ over-inclusion (Acts only referenced, not amended).`,
    ``,
    header,
    sep,
    ...rows,
    `| **AGGREGATE** | ${pct(agg.slugCoverage)} | **${pct(agg.placementRecall)}** | **${pct(agg.contentRecall)}** | **${pct(agg.precision)}** | ${pct(agg.opTypeAccuracy)} | ${pct(agg.groundingRate)} | **${fx(agg.meanTextFidelity)}** | ${agg.goldOps} gold / ${agg.genOps} gen ops |`,
    ``,
    `Per-bill op-by-op side-by-sides: ${scored.map((r) => `\`delta__${r.billNumber}.md\``).join(" · ")}`,
    ``,
  ].join("\n");
}

async function writeArtifacts(results: Row[]): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "delta-INDEX.md"), renderIndex(results), "utf-8");
  let files = 1;
  for (const r of results) {
    if (!r.score) continue;
    const md = [
      `# ${r.billNumber} — stage-2 fidelity`,
      ``,
      `Scored against \`${BASE}\` on ${new Date().toISOString()}.`,
      r.score.aiIncomplete ? `\n> ⚠️ pipeline reported **incomplete**${r.reason ? ` (${r.reason})` : ""} — scores are on a partial result.\n` : ``,
      r.score.spuriousSlugs.length ? `\n> ⚠️ **spurious Acts** (only referenced, not amended): ${r.score.spuriousSlugs.join(", ")}\n` : ``,
      ``,
      ...r.score.perSlug.map(renderSlug),
    ].join("\n");
    await fs.writeFile(path.join(OUT_DIR, `delta__${r.billNumber}.md`), md, "utf-8");
    files++;
  }
  console.log(`[delta eval] wrote ${files} files to eval/out/. Start at eval/out/delta-INDEX.md`);
}

// ── main ──
async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // SELF-TEST: score the gold against a deep copy of itself (no server) → 100%.
  if (process.argv.includes("--selftest")) {
    let ok = true;
    for (const b of EVAL_BILLS) {
      const gold = b.delta.deltas as unknown as DeltaLike[];
      const copy = JSON.parse(JSON.stringify(gold)) as DeltaLike[];
      const s = scoreBill(b.billId, b.billNumber, gold, copy);
      const perfect =
        s.placementRecall === 1 &&
        s.contentRecall === 1 &&
        s.precision === 1 &&
        s.opTypeAccuracy === 1 &&
        s.groundingRate === 1 &&
        s.meanTextFidelity > 0.999 &&
        s.spuriousSlugs.length === 0;
      console.log(
        `  ${b.billNumber}: place=${pct(s.placementRecall)} content=${pct(s.contentRecall)} ` +
          `prec=${pct(s.precision)} op=${pct(s.opTypeAccuracy)} ground=${pct(s.groundingRate)} ` +
          `fid=${fx(s.meanTextFidelity)} ${perfect ? "✓" : "✗ NOT PERFECT"}`,
      );
      ok &&= perfect;
    }
    console.log(ok ? "[delta selftest] PASS — scorer reads gold==gold as 100%." : "[delta selftest] FAIL");
    process.exitCode = ok ? 0 : 1;
    return;
  }

  // OFFLINE RE-SCORE: re-score the dumped generated deltas (delta__*.gen.json)
  // from a prior run, without hitting the server — for iterating on the scorer.
  if (process.argv.includes("--rescore")) {
    const results: Row[] = [];
    for (const b of EVAL_BILLS) {
      try {
        const gen = JSON.parse(
          await fs.readFile(path.join(OUT_DIR, `delta__${b.billNumber}.gen.json`), "utf-8"),
        ) as DeltaLike[];
        const gold = b.delta.deltas as unknown as DeltaLike[];
        results.push({ billNumber: b.billNumber, score: scoreBill(b.billId, b.billNumber, gold, gen) });
      } catch (err) {
        results.push({ billNumber: b.billNumber, error: `no dump (${(err as Error).message}) — run without --rescore first` });
      }
    }
    await writeArtifacts(results);
    return;
  }

  console.log(`[delta eval] base=${BASE}`);

  // 1. Snapshot the 5 bills' delta records so we can restore them afterward.
  const billIds = new Set(EVAL_BILLS.map((b) => b.billId));
  const before = await readRecords();
  const snapshot = before.filter((r) => billIds.has(r.id));
  console.log(`[delta eval] snapshotted ${snapshot.length}/${EVAL_BILLS.length} existing delta records.`);

  const results: Row[] = [];
  try {
    for (const b of EVAL_BILLS) {
      process.stdout.write(`  ${b.billNumber} (${b.billId}) → refreshing… `);
      try {
        const resp = await refreshDelta(b.billId);
        const gen = (resp.deltas ?? []) as DeltaLike[];
        const gold = b.delta.deltas as unknown as DeltaLike[];
        const score = scoreBill(b.billId, b.billNumber, gold, gen, resp.aiIncomplete === true);
        results.push({ billNumber: b.billNumber, score, reason: resp.aiIncompleteReason ?? null });
        // dump raw generated delta for offline re-scoring while iterating on the scorer.
        await fs.writeFile(path.join(OUT_DIR, `delta__${b.billNumber}.gen.json`), JSON.stringify(gen, null, 2), "utf-8");
        console.log(
          `placement ${pct(score.placementRecall)} · content ${pct(score.contentRecall)} · ` +
            `precision ${pct(score.precision)}${resp.aiIncomplete ? " · ⚠️ incomplete" : ""}` +
            `${score.spuriousSlugs.length ? ` · ⚠️ +${score.spuriousSlugs.length} spurious Act(s)` : ""}`,
        );
      } catch (err) {
        results.push({ billNumber: b.billNumber, error: (err as Error).message });
        console.log(`ERROR: ${(err as Error).message}`);
      }
    }
  } finally {
    // 2. Restore: drop any refreshed versions of our 5 ids, re-add the originals.
    const current = await readRecords();
    await writeRecords([...current.filter((r) => !billIds.has(r.id)), ...snapshot]);
    const after = (await readRecords()).filter((r) => billIds.has(r.id));
    const faithful =
      after.length === snapshot.length &&
      JSON.stringify([...after].sort((a, b) => a.id.localeCompare(b.id))) ===
        JSON.stringify([...snapshot].sort((a, b) => a.id.localeCompare(b.id)));
    console.log(`[delta eval] restored gold records — ${faithful ? "faithful ✓" : "⚠️ MISMATCH, re-run eval/seed-eval.ts"}`);
  }

  // 3. Write artifacts.
  await writeArtifacts(results);
}

main().catch((err) => {
  console.error("[delta eval] failed:", err);
  process.exitCode = 1;
});
