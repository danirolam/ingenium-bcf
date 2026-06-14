/**
 * EVAL runner — drives the KEYED local server and grades stages 3–4 against the
 * lawyer gold. Prereqs: `npx tsx eval/seed-eval.ts` has run, and a keyed server is
 * up (`npm run dev`, ANTHROPIC_API_KEY set). Then, from the repo root:
 *
 *   npx tsx eval/run-eval.ts            # default base http://localhost:8787
 *   EVAL_BASE_URL=http://localhost:8787 npx tsx eval/run-eval.ts
 *
 * What it does:
 *   1. Stage-3 matrix — POST /api/client-impact/scan for each of the 7 eval clients
 *      × all 5 scan-ready bills. The client→bill pairing is NOT used here (it is
 *      revealed only at step 2), so bill selection is itself under test.
 *   2. Stage-4 brief — reveals each client's assigned bill (from eval/gold) and
 *      POST /api/client-impact/analyze for that one pair.
 *   3. Writes eval/out/INDEX.md (band·score matrix + per-pair checklist + the
 *      success criteria) and eval/out/<clientId>__<billNumber>.md (our brief vs the
 *      lawyer's gold, side by side).
 *
 * The 0–100 score is stripped from every API response by design; for a SHARP matrix
 * the runner reads it OFFLINE from server/data/clientScans.json (file id === the
 * ScanView id). That is an offline analysis aid — the product's no-score-leak API
 * contract is untouched.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_BILLS } from "./fixtures/bill-deltas.js";
import { EVAL_CLIENTS } from "./fixtures/clients.js";
import type { ClientImpactAnalysis } from "../src/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "server", "data");
const SCANS_FILE = path.join(DATA, "clientScans.json");
const OUT_DIR = path.join(HERE, "out");
const GOLD_FILE = path.join(HERE, "gold", "profiles.json");

const BASE = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const SCAN_TIMEOUT_MS = 60_000;
const ANALYZE_TIMEOUT_MS = 300_000; // > the server's per-call cap; chunked briefs can take minutes

type Band = "low" | "medium" | "high" | "critical";
const BAND_RANK: Record<Band, number> = { low: 0, medium: 1, high: 2, critical: 3 };

interface ScanView {
  id: string;
  clientId: string;
  billId: string;
  band: Band;
  rationale: string;
  topAreas: string[];
  source: string;
  scannedAt: string;
  hasBrief: boolean;
  analysisId?: string;
}
interface GoldProfile {
  assignedBill: { billId: string; billNumber: string };
  impactAssessment: string;
  bcfServices: string;
  negativeControl?: boolean; // graded by criterion 2 (stays low), not criterion 1 (top bill)
}
interface ScanRecord {
  id: string;
  score?: number;
}

// ── http ──
async function postJson<T>(pathname: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(
      `POST ${pathname} failed to reach ${BASE} (${(err as Error).message}). ` +
        `Is the keyed server running?  npm run dev`,
    );
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${pathname} → ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function readScores(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const rows = JSON.parse(await fs.readFile(SCANS_FILE, "utf-8")) as ScanRecord[];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r && typeof r.id === "string" && typeof r.score === "number") map.set(r.id, r.score);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
  return map;
}

// ── markdown helpers ──
const nameById = new Map(EVAL_CLIENTS.map((c) => [c.id, c.name]));
const cell = (assigned: boolean, band: Band | "ERR", score: number | undefined) =>
  `${assigned ? "✅ " : ""}${band}${score === undefined ? "" : ` · ${score}`}`;

function renderBrief(a: ClientImpactAnalysis): string {
  const adaptations = (a.requiredAdaptations ?? [])
    .map((r, i) => `${i + 1}. **${r.area}** — *issue:* ${r.currentIssue}\n   *do:* ${r.recommendation}\n   *why:* ${r.reason}`)
    .join("\n");
  const cited = (a.relevantClientText ?? [])
    .map((t) => `- **[${t.source}]** "${t.excerpt}"\n  → ${t.issue}`)
    .join("\n");
  const questions = (a.lawyerVerificationQuestions ?? []).map((q) => `- ${q}`).join("\n");
  return [
    `- **Affected:** ${a.affected} | **Impact:** ${a.impactLevel} | **Urgency:** ${a.urgency} | **Confidence:** ${a.confidence}`,
    `- **Human review required:** ${a.humanReviewRequired}${a.humanReviewReason ? ` — ${a.humanReviewReason}` : ""}`,
    `- **Timing:** ${a.timing}`,
    `- **Why it affects the client:** ${a.whyItAffectsClient}`,
    `- **Affected client areas:** ${(a.affectedClientAreas ?? []).join("; ") || "—"}`,
    ``,
    `#### Required adaptations`,
    adaptations || "_none_",
    ``,
    `#### Relevant client text cited`,
    cited || "_none_",
    ``,
    `#### Lawyer verification questions`,
    questions || "_none_",
    ``,
    `#### Email draft`,
    `**Subject:** ${a.emailDraft?.subject ?? "—"}`,
    ``,
    a.emailDraft?.body ?? "—",
  ].join("\n");
}

function renderGold(g: GoldProfile): string {
  return [`#### Impact assessment`, g.impactAssessment, ``, `#### BCF's services`, g.bcfServices].join("\n");
}

// ── main ──
async function main(): Promise<void> {
  const gold = JSON.parse(await fs.readFile(GOLD_FILE, "utf-8")) as Record<string, GoldProfile>;
  await fs.mkdir(OUT_DIR, { recursive: true });

  const pairKey = (clientId: string, billId: string) => `${clientId}|${billId}`;
  const scans = new Map<string, ScanView | "ERR">();

  // ── Phase 1: scan matrix (7 clients × 5 bills), sequential to respect rate limits ──
  console.log(`[eval run] base=${BASE}`);
  console.log(`[eval run] Phase 1 — scanning ${EVAL_CLIENTS.length} clients × ${EVAL_BILLS.length} bills…`);
  for (const client of EVAL_CLIENTS) {
    for (const bill of EVAL_BILLS) {
      try {
        const { scan } = await postJson<{ scan: ScanView }>(
          "/api/client-impact/scan",
          { clientId: client.id, billId: bill.billId },
          SCAN_TIMEOUT_MS,
        );
        scans.set(pairKey(client.id, bill.billId), scan);
        process.stdout.write(`  ${client.id} × ${bill.billNumber} → ${scan.band}\n`);
      } catch (err) {
        scans.set(pairKey(client.id, bill.billId), "ERR");
        process.stdout.write(`  ${client.id} × ${bill.billNumber} → ERROR: ${(err as Error).message}\n`);
      }
    }
  }

  const scores = await readScores(); // raw 0–100, read offline after the scans landed

  // ── Phase 2: stage-4 brief per assigned pair (pairing revealed here only) ──
  console.log(`[eval run] Phase 2 — generating ${EVAL_CLIENTS.length} briefs (assigned pairs)…`);
  const briefs = new Map<string, ClientImpactAnalysis | { error: string }>();
  for (const client of EVAL_CLIENTS) {
    const g = gold[client.id];
    if (!g) {
      briefs.set(client.id, { error: "no gold profile" });
      continue;
    }
    try {
      const { analysis } = await postJson<{ analysis: ClientImpactAnalysis }>(
        "/api/client-impact/analyze",
        { clientId: client.id, billId: g.assignedBill.billId },
        ANALYZE_TIMEOUT_MS,
      );
      // The email draft is deferred to APPROVAL — approve the brief so the email
      // gets generated, then use the saved analysis (now carrying emailDraft).
      const approved = await postJson<ClientImpactAnalysis>(
        `/api/client-impact/${analysis.id}/save`,
        {},
        ANALYZE_TIMEOUT_MS,
      );
      briefs.set(client.id, approved);
      console.log(
        `  ${client.id} × ${g.assignedBill.billNumber} → ${approved.impactLevel} (${approved.affected}); ` +
          `email ${approved.emailDraft?.body ? "drafted" : "MISSING"}`,
      );
    } catch (err) {
      briefs.set(client.id, { error: (err as Error).message });
      console.log(`  ${client.id} × ${g.assignedBill.billNumber} → ERROR: ${(err as Error).message}`);
    }
  }

  // ── Phase 3: write artifacts ──
  // INDEX.md — matrix
  const header = `| Client | ${EVAL_BILLS.map((b) => b.billNumber).join(" | ")} |`;
  const sep = `|${" --- |".repeat(EVAL_BILLS.length + 1)}`;
  const rows = EVAL_CLIENTS.map((client) => {
    const assignedBillId = gold[client.id]?.assignedBill.billId;
    const cells = EVAL_BILLS.map((bill) => {
      const s = scans.get(pairKey(client.id, bill.billId));
      if (!s || s === "ERR") return cell(assignedBillId === bill.billId, "ERR", undefined);
      return cell(assignedBillId === bill.billId, s.band, scores.get(s.id));
    });
    return `| ${client.name} | ${cells.join(" | ")} |`;
  });

  // ── success criteria (computed to assist the human reader) ──
  // Raw score (or band rank, if a score is missing) for one client × bill; null
  // when that scan errored.
  const scoreFor = (clientId: string, billId: string): number | null => {
    const s = scans.get(pairKey(clientId, billId));
    if (!s || s === "ERR") return null;
    return scores.get(s.id) ?? BAND_RANK[s.band];
  };

  // Criterion 1 (bill selection): the assigned bill must be the SOLE top scorer.
  // A tie does NOT pass (otherwise the first column would win by array position),
  // and the negative control is excluded — it is graded only by criterion 2.
  const topCheck = EVAL_CLIENTS.filter((c) => !gold[c.id]?.negativeControl).map((client) => {
    const g = gold[client.id];
    const assignedBillId = g?.assignedBill.billId;
    const scored = EVAL_BILLS.map((bill) => ({ billId: bill.billId, v: scoreFor(client.id, bill.billId) })).filter(
      (x): x is { billId: string; v: number } => x.v !== null,
    );
    const max = scored.length ? Math.max(...scored.map((x) => x.v)) : -1;
    const winners = scored.filter((x) => x.v === max).map((x) => x.billId);
    const pass = winners.length === 1 && winners[0] === assignedBillId;
    const verdict = pass
      ? "is the sole top-scoring bill"
      : winners.length > 1
        ? `ties for top (${winners.length}-way) — not a clean win`
        : "is NOT the top-scoring bill";
    return `- [${pass ? "x" : " "}] **${client.name}** — assigned ${g?.assignedBill.billNumber} ${verdict}`;
  });

  // Criterion 2 (negative control): each control client must stay LOW on all 5 bills.
  const controlChecks = EVAL_CLIENTS.filter((c) => gold[c.id]?.negativeControl).map((client) => {
    const bands = EVAL_BILLS.map((bill) => {
      const s = scans.get(pairKey(client.id, bill.billId));
      return `${bill.billNumber}=${!s || s === "ERR" ? "ERR" : s.band}`;
    });
    const low = EVAL_BILLS.every((bill) => {
      const s = scans.get(pairKey(client.id, bill.billId));
      return s && s !== "ERR" && s.band === "low";
    });
    return `- [${low ? "x" : " "}] **${client.name}** stays low across all 5 bills: ${bands.join(", ")}`;
  });

  const index = [
    `# Eval results — stage-3 scan matrix + stage-4 briefs`,
    ``,
    `Generated ${new Date().toISOString()} against \`${BASE}\`.`,
    `Bands come from the scan API; raw 0–100 scores are read offline from \`clientScans.json\`.`,
    `Bands: low \`<25\` · medium \`25–49\` · high \`50–74\` · critical \`75–100\`. ✅ = lawyer-assigned bill.`,
    ``,
    `## Scan matrix — band · score`,
    ``,
    header,
    sep,
    ...rows,
    ``,
    `## Success criteria`,
    ``,
    `**1. Each non-control client's assigned bill is its sole top-scoring bill** (bill selection works):`,
    ...topCheck,
    ``,
    `**2. Negative control stays LOW across all 5 bills** (no false positives):`,
    ...controlChecks,
    ``,
    `## Per-pair side-by-sides (assigned bill) — check each by hand`,
    ``,
    ...EVAL_CLIENTS.map((client) => {
      const g = gold[client.id];
      return `### ${client.name} × ${g?.assignedBill.billNumber}\n- [ ] Right Act(s) named? · [ ] Direction (benefit/obligation) correct? · [ ] Magnitude plausible? · [ ] Services aligned? · [ ] Conditional, non-advisory tone?\n  → see \`${client.id}__${g?.assignedBill.billNumber}.md\``;
    }),
    ``,
  ].join("\n");
  await fs.writeFile(path.join(OUT_DIR, "INDEX.md"), index, "utf-8");
  let filesWritten = 1;

  // per-pair side-by-sides
  for (const client of EVAL_CLIENTS) {
    const g = gold[client.id];
    if (!g) continue;
    const billNumber = g.assignedBill.billNumber;
    const bill = EVAL_BILLS.find((b) => b.billId === g.assignedBill.billId);
    const s = scans.get(pairKey(client.id, g.assignedBill.billId));
    const scanLine =
      !s || s === "ERR"
        ? "_scan errored_"
        : `**${s.band}**${scores.get(s.id) === undefined ? "" : ` (raw ${scores.get(s.id)})`} — ${s.rationale}`;
    const brief = briefs.get(client.id);
    const ourSide =
      brief && !("error" in brief) ? renderBrief(brief) : `_brief errored: ${(brief as { error: string })?.error ?? "unknown"}_`;

    const md = [
      `# ${client.name} × ${billNumber}`,
      `**${bill?.title ?? billNumber}**`,
      ``,
      `Lawyer-assigned bill: **${billNumber}**. Our stage-3 scan: ${scanLine}`,
      ``,
      `---`,
      ``,
      `## Our brief (stage 4)`,
      ``,
      ourSide,
      ``,
      `---`,
      ``,
      `## Lawyer gold`,
      ``,
      renderGold(g),
      ``,
    ].join("\n");
    await fs.writeFile(path.join(OUT_DIR, `${client.id}__${billNumber}.md`), md, "utf-8");
    filesWritten++;
  }

  console.log(`[eval run] done. Wrote ${filesWritten} files to eval/out/. Start at eval/out/INDEX.md`);
}

main().catch((err) => {
  console.error("[eval run] failed:", err);
  process.exitCode = 1;
});
