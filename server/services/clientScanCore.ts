// Pure logic for the client-scan pipeline (stage 3): triage approved Act
// changes against a client's profile, pack them into request-sized chunks,
// serialize them for the model, and merge/normalize the per-chunk analyses.
//
// This file is intentionally dependency-free and deterministic — no fetch, no
// fs, no env, no clocks — so it can be unit-tested directly. All IO lives in
// clientScan.ts.
import type { Client, ClientImpactAnalysis } from "../../src/types.js";

export const TRIAGE_THRESHOLD_TOKENS = 12_000; // below: send everything, skip triage
export const CHUNK_TOKENS = 25_000; // per-call changes payload
export const MAX_CHUNKS = 6; // beyond → drop + name (coverage)
export const CLIENT_BLOCK_TOKENS = 8_000; // cap on client materials
export const estTokens = (s: string) => Math.ceil(s.length / 4); // rough chars→tokens

/**
 * One Act's counsel-approved operations, flattened for the scan prompt.
 * Wire type — mirrored in src/lib/clientScan.ts; keep in sync.
 */
export interface ApprovedActChange {
  slug: string;
  actTitle: string;
  citation: string;
  ops: {
    key: string;
    op: "add" | "replace" | "repeal" | "amend";
    anchor: string | null;
    instruction: string;
    beforeText?: string;
    afterText?: string;
    marginalNote?: string | null;
  }[];
}

/**
 * One row of the scan-ready bill list (bills with ≥1 approved op).
 * Wire type — mirrored in src/lib/clientScan.ts; keep in sync.
 */
export interface ScanReadyBill {
  billId: string;
  billNumber: string;
  title: string;
  shortTitle?: string;
  status: string;
  session?: string;
  approvedOpCount: number;
  actTitles: string[];
  computedAt: string;
}

/**
 * Detail payload for one scan-ready bill.
 * Wire type — mirrored in src/lib/clientScan.ts; keep in sync.
 */
export interface ScanReadyDetail {
  billId: string;
  approvedCount: number;
  changes: ApprovedActChange[];
}

/** The model-produced portion of an impact analysis (storage fields stamped later). */
export type AnalysisBody = Omit<
  ClientImpactAnalysis,
  "id" | "clientId" | "billId" | "saved" | "createdAt"
>;

/**
 * An op excluded from the AI calls — surfaced for coverage. "chunk-cap" means
 * the volume cap dropped it before any call; "ai-unavailable" means its chunk
 * was skipped because the AI was rate-limited, errored, or timed out.
 */
export interface DroppedOp {
  key: string;
  anchor: string | null;
  actTitle: string;
  reason: "chunk-cap" | "ai-unavailable";
}

// ── Client-relevance scoring ──────────────────────────────────────────────────

// Function words + ultra-generic legal/business filler that would make every
// Act look relevant to every client. Terms are ≥4 chars (shorter are skipped).
const STOPWORDS = new Set([
  "this", "that", "with", "from", "have", "will", "would", "should",
  "could", "shall", "must", "into", "such", "under", "upon", "each", "other",
  "than", "then", "there", "these", "those", "when", "where", "while", "about",
  "after", "before", "between", "during", "within", "without", "also", "being",
  "both", "does", "doing", "made", "make", "more", "most", "only", "over",
  "same", "some", "very", "what", "they", "their", "them", "been", "were",
  "which", "include", "includes", "including", "provide", "provides",
  "provided", "respect", "means", "year", "years", "section", "sections",
  "subsection", "subsections", "paragraph", "paragraphs", "amend", "amended",
  "amendment", "amendments", "following", "pursuant", "accordance",
  "applicable", "apply", "applies", "shown", "company", "client",
]);

function tokenize(s: string): string[] {
  // Latin-1 letters plus the œ/Œ ligature (U+0153/U+0152), which sits outside
  // the à-ÿ block but is common in French legal text (œuvre, cœur…).
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9à-öø-ÿœŒ]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

// First ~2k chars of each long client document keep term-building cheap while
// capturing the (front-loaded) substance of T&Cs/policies/operations.
const TERM_SOURCE_CLIP = 2_000;

function clientTerms(client: Client): Set<string> {
  const sources = [
    client.industry,
    (client.jurisdictions ?? []).join(" "),
    client.description,
    (client.termsAndConditions ?? "").slice(0, TERM_SOURCE_CLIP),
    (client.policies ?? "").slice(0, TERM_SOURCE_CLIP),
    (client.operations ?? "").slice(0, TERM_SOURCE_CLIP),
  ];
  const terms = new Set<string>();
  for (const src of sources) for (const w of tokenize(src ?? "")) terms.add(w);
  return terms;
}

/** Distinct client-term overlap with `text` — the relevance score. */
function scoreText(text: string, terms: Set<string>): number {
  let score = 0;
  const seen = new Set<string>();
  for (const w of tokenize(text)) {
    if (seen.has(w)) continue;
    seen.add(w);
    if (terms.has(w)) score++;
  }
  return score;
}

function changeScoreText(c: ApprovedActChange): string {
  return [
    c.actTitle,
    c.citation,
    ...c.ops.map((o) => `${o.marginalNote ?? ""} ${o.instruction}`),
  ].join(" ");
}

function opScoreText(c: { actTitle: string; citation: string }, op: ApprovedActChange["ops"][number]): string {
  return `${c.actTitle} ${c.citation} ${op.marginalNote ?? ""} ${op.instruction}`;
}

// ── Triage ────────────────────────────────────────────────────────────────────

/**
 * Keep only the Acts whose changes share vocabulary with the client. Small
 * payloads skip triage entirely; and as a recall safety net, if scoring would
 * drop everything (or drops nothing) the full set is returned unfiltered.
 * `triaged` is true only when filtering actually narrowed the set.
 */
export function triageChangesForClient(
  changes: ApprovedActChange[],
  client: Client,
): { relevant: ApprovedActChange[]; triaged: boolean } {
  const totalTokens = estTokens(serializeChanges(changes));
  if (totalTokens < TRIAGE_THRESHOLD_TOKENS) {
    return { relevant: changes, triaged: false };
  }
  const terms = clientTerms(client);
  const kept = changes.filter((c) => scoreText(changeScoreText(c), terms) > 0);
  if (kept.length === 0 || kept.length === changes.length) {
    // Recall safety: never let a lossy heuristic hide every change.
    return { relevant: changes, triaged: false };
  }
  return { relevant: kept, triaged: true };
}

// ── Chunking ──────────────────────────────────────────────────────────────────

// Last-resort truncation budget for a single op larger than a whole chunk.
const PATHOLOGICAL_OP_TOKENS = 2_000;

function headTail(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  const marker = `\n…[truncated ${s.length} chars]…\n`;
  if (maxChars <= marker.length + 8) return s.slice(0, Math.max(0, maxChars));
  const room = maxChars - marker.length;
  const head = Math.floor(room * 0.7);
  const tail = room - head;
  return `${s.slice(0, head)}${marker}${s.slice(-tail)}`;
}

/** Head+tail truncate a pathological op's text fields to ~PATHOLOGICAL_OP_TOKENS. */
function truncateOpText(
  op: ApprovedActChange["ops"][number],
): ApprovedActChange["ops"][number] {
  const budgetChars = PATHOLOGICAL_OP_TOKENS * 4;
  // Rough split: the instruction carries the "what", before/after carry the text.
  const instructionMax = Math.floor(budgetChars * 0.3);
  const textMax = Math.floor(budgetChars * 0.35);
  return {
    ...op,
    instruction: headTail(op.instruction ?? "", instructionMax),
    beforeText:
      op.beforeText !== undefined ? headTail(op.beforeText, textMax) : undefined,
    afterText:
      op.afterText !== undefined ? headTail(op.afterText, textMax) : undefined,
  };
}

interface FlatOp {
  act: { slug: string; actTitle: string; citation: string };
  op: ApprovedActChange["ops"][number];
  score: number;
  idx: number;
}

/** Re-group a packed run of ops under their Act headers (first-encounter order). */
function groupUnderActs(items: FlatOp[]): ApprovedActChange[] {
  const bySlug = new Map<string, ApprovedActChange>();
  const out: ApprovedActChange[] = [];
  for (const it of items) {
    let g = bySlug.get(it.act.slug);
    if (!g) {
      g = {
        slug: it.act.slug,
        actTitle: it.act.actTitle,
        citation: it.act.citation,
        ops: [],
      };
      bySlug.set(it.act.slug, g);
      out.push(g);
    }
    g.ops.push(it.op);
  }
  return out;
}

/**
 * Rank individual ops by client relevance and pack them — at op boundaries,
 * never mid-text — into chunks of ≤ CHUNK_TOKENS, each op travelling with its
 * Act header. Ops that would need a chunk beyond MAX_CHUNKS are dropped (and
 * named, for coverage). A single op larger than a whole chunk is head+tail
 * truncated as a last resort rather than cut arbitrarily.
 */
export function chunkChanges(
  changes: ApprovedActChange[],
  client: Client,
): { chunks: ApprovedActChange[][]; dropped: DroppedOp[] } {
  const terms = clientTerms(client);
  const flat: FlatOp[] = [];
  let idx = 0;
  for (const c of changes) {
    const act = { slug: c.slug, actTitle: c.actTitle, citation: c.citation };
    for (const op of c.ops) {
      flat.push({ act, op, score: scoreText(opScoreText(act, op), terms), idx: idx++ });
    }
  }
  // Relevance order; original document order breaks ties (stable + deterministic).
  flat.sort((a, b) => b.score - a.score || a.idx - b.idx);

  const opTokens = (f: FlatOp) =>
    estTokens(
      `${actHeader(f.act)}\n\n${serializeOp(f.op)}`,
    );

  const chunks: FlatOp[][] = [];
  const dropped: DroppedOp[] = [];
  let cur: FlatOp[] = [];
  let curTok = 0;
  let dropping = false;

  for (const f0 of flat) {
    if (dropping) {
      dropped.push({ key: f0.op.key, anchor: f0.op.anchor, actTitle: f0.act.actTitle, reason: "chunk-cap" });
      continue;
    }
    let f = f0;
    let t = opTokens(f);
    if (t > CHUNK_TOKENS) {
      f = { ...f0, op: truncateOpText(f0.op) };
      t = opTokens(f);
    }
    if (cur.length > 0 && curTok + t > CHUNK_TOKENS) {
      chunks.push(cur);
      cur = [];
      curTok = 0;
      if (chunks.length >= MAX_CHUNKS) {
        dropping = true;
        dropped.push({ key: f.op.key, anchor: f.op.anchor, actTitle: f.act.actTitle, reason: "chunk-cap" });
        continue;
      }
    }
    cur.push(f);
    curTok += t;
  }
  if (cur.length > 0) chunks.push(cur);

  return { chunks: chunks.map(groupUnderActs), dropped };
}

// ── Serialization ─────────────────────────────────────────────────────────────

function actHeader(c: { actTitle: string; citation: string }): string {
  return `ACT: ${c.actTitle} (${c.citation})`;
}

function serializeOp(op: ApprovedActChange["ops"][number]): string {
  const lines = [
    `OP ${op.key} [${op.op}] anchor: ${op.anchor ?? "(none)"}${op.marginalNote ? ` — ${op.marginalNote}` : ""}`,
    `INSTRUCTION: ${op.instruction}`,
  ];
  if (op.beforeText !== undefined) lines.push(`BEFORE: ${op.beforeText}`);
  if (op.afterText !== undefined) lines.push(`AFTER: ${op.afterText}`);
  return lines.join("\n");
}

/** Stable, readable text form of a set of Act changes — what the model reads. */
export function serializeChanges(changes: ApprovedActChange[]): string {
  const parts: string[] = [];
  for (const c of changes) {
    parts.push(actHeader(c));
    for (const op of c.ops) parts.push(serializeOp(op));
  }
  return parts.join("\n\n");
}

// ── Client block ──────────────────────────────────────────────────────────────

/**
 * Render the client's profile + documents, capped at CLIENT_BLOCK_TOKENS.
 * When over budget, each over-long section is head+tail truncated to a fair
 * share (smaller sections keep their full text; their slack goes to the rest).
 */
export function buildClientBlock(client: Client): { text: string; truncated: boolean } {
  const header = [
    `NAME: ${client.name}`,
    `INDUSTRY: ${client.industry}`,
    `JURISDICTIONS: ${(client.jurisdictions ?? []).join(", ")}`,
  ].join("\n");

  const sections: { label: string; text: string }[] = [];
  if (client.description) sections.push({ label: "DESCRIPTION", text: client.description });
  if (client.termsAndConditions)
    sections.push({ label: "TERMS & CONDITIONS", text: client.termsAndConditions });
  if (client.policies) sections.push({ label: "POLICIES", text: client.policies });
  if (client.operations) sections.push({ label: "OPERATIONS", text: client.operations });

  const budgetChars = CLIENT_BLOCK_TOKENS * 4;
  const overheadPerSection = 32; // "\n\nLABEL:\n" framing, roughly
  let pool = Math.max(
    0,
    budgetChars - header.length - sections.length * overheadPerSection,
  );

  // Waterfill: settle the sections that fit an equal share, redistribute the
  // slack, and head+tail truncate whatever still doesn't fit.
  let truncated = false;
  const fitted = new Map<number, string>();
  let pending = sections.map((s, i) => ({ i, len: s.text.length }));
  while (pending.length > 0) {
    const share = Math.floor(pool / pending.length);
    const fits = pending.filter((p) => p.len <= share);
    if (fits.length === 0) {
      for (const p of pending) {
        fitted.set(p.i, headTail(sections[p.i].text, share));
        truncated = true;
      }
      break;
    }
    for (const p of fits) {
      fitted.set(p.i, sections[p.i].text);
      pool -= p.len;
    }
    pending = pending.filter((p) => p.len > share);
  }

  const text = [
    header,
    ...sections.map((s, i) => `${s.label}:\n${fitted.get(i) ?? ""}`),
  ].join("\n\n");
  return { text, truncated };
}

// ── Merging per-chunk analyses ────────────────────────────────────────────────

const AFFECTED_ORD: Record<AnalysisBody["affected"], number> = { no: 0, unclear: 1, yes: 2 };
const IMPACT_ORD: Record<AnalysisBody["impactLevel"], number> = { low: 0, medium: 1, high: 2, critical: 3 };
const URGENCY_ORD: Record<AnalysisBody["urgency"], number> = { low: 0, medium: 1, high: 2, immediate: 3 };

function maxBy<T extends string>(values: T[], ord: Record<T, number>): T {
  return values.reduce((best, v) => (ord[v] > ord[best] ? v : best), values[0]);
}

function dedupCI(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/**
 * Deterministically reduce ≥1 per-chunk analyses into one. Worst-case wins on
 * severity fields; text and lists union with dedup; confidence is the minimum.
 */
export function mergeAnalyses(parts: AnalysisBody[]): AnalysisBody {
  if (parts.length === 0) throw new Error("mergeAnalyses requires at least one part");
  // The highest-impact part (first on tie) anchors timing and the email draft.
  const primary = parts.reduce(
    (best, p) => (IMPACT_ORD[p.impactLevel] > IMPACT_ORD[best.impactLevel] ? p : best),
    parts[0],
  );

  const adaptations: AnalysisBody["requiredAdaptations"] = [];
  const seenAdapt = new Set<string>();
  for (const p of parts) {
    for (const a of p.requiredAdaptations) {
      const k = `${a.area.trim().toLowerCase()}|${a.recommendation.trim().toLowerCase()}`;
      if (seenAdapt.has(k)) continue;
      seenAdapt.add(k);
      adaptations.push(a);
    }
  }

  const clientText: AnalysisBody["relevantClientText"] = [];
  const seenExcerpt = new Set<string>();
  for (const p of parts) {
    for (const r of p.relevantClientText) {
      const k = r.excerpt.trim().toLowerCase();
      if (seenExcerpt.has(k)) continue;
      seenExcerpt.add(k);
      clientText.push(r);
    }
  }

  const reasons = dedupCI(
    parts.map((p) => p.humanReviewReason ?? "").filter(Boolean),
  );

  return {
    affected: maxBy(parts.map((p) => p.affected), AFFECTED_ORD),
    impactLevel: maxBy(parts.map((p) => p.impactLevel), IMPACT_ORD),
    urgency: maxBy(parts.map((p) => p.urgency), URGENCY_ORD),
    timing: primary.timing,
    whyItAffectsClient: parts
      .map((p) => p.whyItAffectsClient.trim())
      .filter(Boolean)
      .join("\n\n"),
    affectedClientAreas: dedupCI(parts.flatMap((p) => p.affectedClientAreas)),
    requiredAdaptations: adaptations,
    relevantClientText: clientText,
    lawyerVerificationQuestions: dedupCI(
      parts.flatMap((p) => p.lawyerVerificationQuestions),
    ).slice(0, 10),
    emailDraft: {
      subject: primary.emailDraft.subject,
      body:
        parts.length > 1
          ? `${primary.emailDraft.body}\n\nNote: this analysis covered ${parts.length} batches of approved amendments.`
          : primary.emailDraft.body,
    },
    confidence: Math.min(...parts.map((p) => p.confidence)),
    humanReviewRequired: parts.some((p) => p.humanReviewRequired),
    humanReviewReason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

// ── Normalization of raw model output ─────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

function asStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((it): it is string => typeof it === "string" && it.trim().length > 0);
}

function asAdaptations(v: unknown): AnalysisBody["requiredAdaptations"] {
  if (!Array.isArray(v)) return [];
  const out: AnalysisBody["requiredAdaptations"] = [];
  for (const it of v) {
    if (!isRecord(it)) continue; // drop malformed entries
    const item = {
      area: asStr(it.area),
      currentIssue: asStr(it.currentIssue),
      recommendation: asStr(it.recommendation),
      reason: asStr(it.reason),
    };
    if (!item.area && !item.currentIssue && !item.recommendation && !item.reason) continue;
    out.push(item);
  }
  return out;
}

// A misbehaving model can dump unbounded text into free-form fields; head+tail
// cap the big ones (client-text excerpts, the email body) at ~2k chars each.
const NORMALIZE_FIELD_MAX_CHARS = 2_000;

function asClientText(v: unknown): AnalysisBody["relevantClientText"] {
  if (!Array.isArray(v)) return [];
  const out: AnalysisBody["relevantClientText"] = [];
  for (const it of v) {
    if (!isRecord(it)) continue; // drop malformed entries
    const item = {
      source: asStr(it.source),
      excerpt: headTail(asStr(it.excerpt), NORMALIZE_FIELD_MAX_CHARS),
      issue: asStr(it.issue),
    };
    if (!item.source && !item.excerpt && !item.issue) continue;
    out.push(item);
  }
  return out;
}

/**
 * Coerce ANY value (null, arrays, strings, garbage) into a valid AnalysisBody.
 * Never throws. Garbage defaults are conservative: unclear/medium/medium,
 * confidence 0.5, humanReviewRequired true.
 */
export function normalizeAnalysis(raw: unknown): AnalysisBody {
  const rec = isRecord(raw) ? raw : undefined;

  const confidenceRaw = rec?.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : 0.5;

  const emailRec = isRecord(rec?.emailDraft) ? (rec?.emailDraft as Record<string, unknown>) : undefined;

  return {
    affected: oneOf(rec?.affected, ["yes", "no", "unclear"] as const, "unclear"),
    impactLevel: oneOf(rec?.impactLevel, ["low", "medium", "high", "critical"] as const, "medium"),
    urgency: oneOf(rec?.urgency, ["low", "medium", "high", "immediate"] as const, "medium"),
    timing: asStr(rec?.timing),
    whyItAffectsClient: asStr(rec?.whyItAffectsClient),
    affectedClientAreas: asStrArray(rec?.affectedClientAreas),
    requiredAdaptations: asAdaptations(rec?.requiredAdaptations),
    relevantClientText: asClientText(rec?.relevantClientText),
    lawyerVerificationQuestions: asStrArray(rec?.lawyerVerificationQuestions),
    emailDraft: {
      subject: asStr(emailRec?.subject),
      body: headTail(asStr(emailRec?.body), NORMALIZE_FIELD_MAX_CHARS),
    },
    confidence,
    // Conservative: anything other than an explicit boolean means "review it".
    humanReviewRequired:
      typeof rec?.humanReviewRequired === "boolean" ? rec.humanReviewRequired : true,
    humanReviewReason:
      typeof rec?.humanReviewReason === "string" ? rec.humanReviewReason : null,
  };
}

// ── Coverage ──────────────────────────────────────────────────────────────────

/**
 * A lawyer-facing note naming the ops that were never sent to the model,
 * grouped by WHY they were skipped — "volume cap" must never be claimed for
 * ops that were actually lost to a rate limit, error, or timeout.
 */
export function coverageNote(
  analyzedCount: number,
  dropped: DroppedOp[],
): string | null {
  void analyzedCount; // part of the stable API; the note names only the gaps
  if (dropped.length === 0) return null;
  const list = (ds: DroppedOp[]) =>
    ds.map((d) => `${d.anchor ?? d.key} (${d.actTitle})`).join(", ");
  const capped = dropped.filter((d) => d.reason === "chunk-cap");
  const unavailable = dropped.filter((d) => d.reason !== "chunk-cap");
  const sentences: string[] = [];
  if (capped.length > 0) sentences.push(`Not analyzed (volume cap): ${list(capped)}`);
  if (unavailable.length > 0) {
    sentences.push(
      `Not analyzed (AI unavailable — rate limit or error): ${list(unavailable)}`,
    );
  }
  return `${sentences.join(". ")} — review these provisions manually.`;
}

// ── Impact score (stage-3 scorer agent) ───────────────────────────────────────
//
// The fast first agent of the split stage 3: a per-(client, bill) impact SCORE.
// The numeric 0–100 score is backend-only (stored for ranking, stripped from
// every API response); clients see only the band, a one-line rationale and the
// top affected areas.

export const SCAN_BANDS = ["low", "medium", "high", "critical"] as const;
export type ScanBand = (typeof SCAN_BANDS)[number];

/** Bands the brief agent should lead with — scan first, analyze these pairs. */
export const ANALYZE_EMPHASIS_BANDS: ReadonlySet<ScanBand> = new Set([
  "high",
  "critical",
]);

/** The model/heuristic-produced portion of an impact scan (storage fields stamped later). */
export interface ScoreBody {
  score: number; // 0–100 integer — backend-only, never serialized to clients
  band: ScanBand;
  rationale: string;
  topAreas: string[];
}

/** Score → band: 0–24 low · 25–49 medium · 50–74 high · 75–100 critical. */
export function bandFromScore(score: number): ScanBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

const RATIONALE_MAX_CHARS = 400;
const TOP_AREAS_MAX = 3;

function capRationale(s: string): string {
  const t = s.trim();
  return t.length > RATIONALE_MAX_CHARS ? `${t.slice(0, RATIONALE_MAX_CHARS - 1)}…` : t;
}

/**
 * Coerce ANY value (null, arrays, strings, garbage) into a valid ScoreBody.
 * Never throws. The score becomes a finite integer clamped to [0,100]
 * (garbage/NaN → 0) and the band is ALWAYS recomputed from that score — the
 * model's claimed band is ignored, so score and band can never disagree.
 */
export function normalizeScore(raw: unknown): ScoreBody {
  const rec = isRecord(raw) ? raw : undefined;
  const scoreRaw = rec?.score;
  const n =
    typeof scoreRaw === "number"
      ? scoreRaw
      : typeof scoreRaw === "string" && scoreRaw.trim() !== ""
        ? Number(scoreRaw)
        : NaN;
  const score = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
  return {
    score,
    band: bandFromScore(score),
    rationale: capRationale(asStr(rec?.rationale)),
    topAreas: asStrArray(rec?.topAreas)
      .map((s) => s.trim())
      .slice(0, TOP_AREAS_MAX),
  };
}

// Heuristic tuning. An op only registers once it shares MORE than
// HEURISTIC_NOISE_FLOOR distinct substantive terms with the client (1–2 shared
// ≥4-char words is ambient legal English, not subject-matter overlap); its
// density then saturates at HEURISTIC_DENSITY_SATURATION effective hits. The
// summed per-op densities (the "overlap mass" W) map onto 0..90 through the
// saturating curve MAX·W/(W+HALF) — strictly increasing in W, so adding an
// overlapping op can never lower the score, and bounded below 90 because a
// keyless heuristic must never claim the certainty of a full critical (100)
// without AI.
const HEURISTIC_MAX_SCORE = 90;
const HEURISTIC_NOISE_FLOOR = 2; // distinct shared terms discounted as ambient noise
const HEURISTIC_DENSITY_SATURATION = 10; // effective hits at which an op is fully dense
const HEURISTIC_HALF_SCORE_MASS = 2; // overlap mass at which the curve crosses MAX/2

/**
 * Deterministic keyless fallback score: how many ops' text (Act title +
 * marginal note + instruction + before/after text) intersect the client's
 * documented term set, weighted by hit density. Same inputs ⇒ byte-identical
 * output (no IO, no clock, no randomness); more overlapping ops ⇒ score never
 * lower.
 */
export function heuristicScore(
  changes: ApprovedActChange[],
  client: Client,
  // Why the heuristic ran — counsel-facing prefix must not claim keylessness
  // when the cause was an AI failure with a key present.
  reason: "no AI key" | "AI unavailable" = "no AI key",
): ScoreBody {
  const prefix = `Heuristic (${reason})`;
  const terms = clientTerms(client);

  interface OpHit {
    hits: number; // distinct client terms in the op's text
    density: number; // 0..1 — noise-floored hits over the saturation point
    actTitle: string;
    marginalNote: string | null;
    idx: number;
  }
  const ops: OpHit[] = [];
  let idx = 0;
  for (const c of changes) {
    for (const op of c.ops) {
      const text = [
        c.actTitle,
        op.marginalNote ?? "",
        op.instruction,
        op.beforeText ?? "",
        op.afterText ?? "",
      ].join(" ");
      const hits = scoreText(text, terms);
      ops.push({
        hits,
        density: Math.min(
          1,
          Math.max(0, hits - HEURISTIC_NOISE_FLOOR) / HEURISTIC_DENSITY_SATURATION,
        ),
        actTitle: c.actTitle,
        marginalNote: op.marginalNote ?? null,
        idx: idx++,
      });
    }
  }

  const total = ops.length;
  if (total === 0) {
    return {
      score: 0,
      band: "low",
      rationale: capRationale(
        `${prefix}: no approved changes to assess for ${client.name}.`,
      ),
      topAreas: [],
    };
  }

  const hitOps = ops.filter((o) => o.density > 0);
  if (hitOps.length === 0) {
    return {
      score: 0,
      band: "low",
      rationale: capRationale(
        `${prefix}: 0 of ${total} approved changes intersect ${client.name}'s documented terms — no substantive vocabulary shared between the amendments and the client's profile or documents.`,
      ),
      topAreas: [],
    };
  }

  // Overlap mass → 0..HEURISTIC_MAX_SCORE (inclusive cap) through a saturating curve.
  const mass = hitOps.reduce((s, o) => s + o.density, 0);
  const score = Math.min(
    HEURISTIC_MAX_SCORE,
    Math.round((HEURISTIC_MAX_SCORE * mass) / (mass + HEURISTIC_HALF_SCORE_MASS)),
  );

  // Top areas from the strongest-hit ops: marginal note (the human-meaningful
  // "area") with its Act, falling back to the Act title. Deterministic order:
  // hits desc, original op order on ties; case-insensitive dedup.
  const ranked = [...hitOps].sort((a, b) => b.hits - a.hits || a.idx - b.idx);
  const topAreas: string[] = [];
  const seen = new Set<string>();
  for (const o of ranked) {
    const note = o.marginalNote?.trim();
    const label = note ? `${note} (${o.actTitle})` : o.actTitle;
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    topAreas.push(label);
    if (topAreas.length >= TOP_AREAS_MAX) break;
  }

  return {
    score,
    band: bandFromScore(score),
    rationale: capRationale(
      `${prefix}: ${hitOps.length} of ${total} approved changes intersect ${client.name}'s documented terms — strongest overlap: ${topAreas.join("; ")}.`,
    ),
    topAreas,
  };
}

// ── Prior-brief serialization (regen-as-revision) ────────────────────────────
// When a brief is REGENERATED, the previous brief travels to the agent as
// context so the new one is a revision, not a restart — and the reviewing
// lawyer's guidance can critique it ("the timeline is too vague") and be
// understood. Compact and defensive: tolerates partial/garbage records (old
// store entries) and caps the whole block so it never crowds the payload.
const PRIOR_BRIEF_MAX_CHARS = 6_000;

export function serializePriorBrief(prior: unknown): string {
  const p = (prior ?? {}) as Partial<ClientImpactAnalysis>;
  const s = (v: unknown, max: number) =>
    typeof v === "string" ? (v.length > max ? `${v.slice(0, max).trimEnd()}…` : v) : "";
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const lines: string[] = [];
  lines.push(
    `Verdict: affected=${s(p.affected, 12) || "?"} · impact=${s(p.impactLevel, 12) || "?"} · urgency=${s(p.urgency, 12) || "?"}`,
  );
  if (p.timing) lines.push(`Timing: ${s(p.timing, 300)}`);
  if (p.whyItAffectsClient) lines.push(`Why it affects the client: ${s(p.whyItAffectsClient, 1200)}`);
  const areas = list<string>(p.affectedClientAreas).filter((a) => typeof a === "string");
  if (areas.length) lines.push(`Affected areas: ${areas.slice(0, 6).join("; ")}`);
  const adapts = list<{ area?: string; recommendation?: string }>(p.requiredAdaptations)
    .filter((a) => a && typeof a === "object")
    .slice(0, 8);
  if (adapts.length) {
    lines.push("Recommended adaptations:");
    for (const a of adapts) lines.push(`- ${s(a.area, 80) || "(area)"}: ${s(a.recommendation, 240)}`);
  }
  const quotes = list<{ source?: string }>(p.relevantClientText).filter((q) => q && typeof q === "object");
  if (quotes.length) {
    lines.push(
      `Client-text citations: ${quotes.length} (sources: ${[...new Set(quotes.map((q) => s(q.source, 40)).filter(Boolean))].slice(0, 4).join(", ")})`,
    );
  }
  const questions = list<string>(p.lawyerVerificationQuestions).filter((q) => typeof q === "string");
  if (questions.length) {
    lines.push("Verification questions:");
    for (const q of questions.slice(0, 8)) lines.push(`- ${s(q, 200)}`);
  }
  if (p.humanReviewRequired) {
    lines.push(`Human review was required: ${s(p.humanReviewReason, 300) || "yes"}`);
  }

  const out = lines.join("\n");
  return out.length > PRIOR_BRIEF_MAX_CHARS
    ? `${out.slice(0, PRIOR_BRIEF_MAX_CHARS).trimEnd()}…`
    : out;
}

// ── Bill-status serialization (the brief agent's missing context) ────────────
// Without this the agent had NO idea where the bill stood in Parliament — it
// wrote thin "Timing" sections and presented proposed changes as certainties
// ("Health Canada will establish…"). Compact, never-throws, and always ends
// with the not-law caveat the tone rules depend on.
const BILL_STATUS_MAX_CHARS = 1_500;

export function serializeBillStatus(bill: unknown): string {
  const b = (bill ?? {}) as Record<string, unknown>;
  const s = (v: unknown, max = 160): string =>
    typeof v === "string" ? (v.length > max ? `${v.slice(0, max).trimEnd()}…` : v) : "";
  const day = (v: unknown): string => s(v, 40).slice(0, 10); // ISO date prefix

  const lines: string[] = [];
  const num = s(b.billNumber, 20) || "(unknown bill)";
  lines.push(`Bill ${num}: ${s(b.shortTitle) || s(b.title) || "(untitled)"}`);
  if (b.status) lines.push(`Current status: ${s(b.status)}`);
  if (b.legislativeMomentum) lines.push(`Momentum: ${s(b.legislativeMomentum, 20)}`);
  if (b.introducedDate) lines.push(`Introduced: ${day(b.introducedDate)}`);
  const ev = (b.latestEvent ?? null) as { name?: unknown; date?: unknown; chamber?: unknown } | null;
  if (ev && typeof ev === "object" && (ev.name || ev.date)) {
    lines.push(
      `Latest event: ${s(ev.name)}${ev.chamber ? ` (${s(ev.chamber, 30)})` : ""}${ev.date ? ` — ${day(ev.date)}` : ""}`,
    );
  }
  // The last few legislative-path entries show HOW FAST the bill is moving.
  const path = Array.isArray(b.legislativePath) ? b.legislativePath : [];
  const recent = path
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .slice(-3);
  if (recent.length > 0) {
    lines.push("Recent progress:");
    for (const p of recent) {
      lines.push(
        `- ${s(p.name, 60) || "(stage)"}${p.chamber ? ` (${s(p.chamber, 20)})` : ""}: ${s(p.state, 30) || "?"}${p.date ? ` — ${day(p.date)}` : ""}`,
      );
    }
  }
  lines.push(
    "This bill is NOT law. It may be amended, delayed or never receive royal assent — every change it makes is PROPOSED, not in force.",
  );

  const out = lines.join("\n");
  return out.length > BILL_STATUS_MAX_CHARS
    ? `${out.slice(0, BILL_STATUS_MAX_CHARS).trimEnd()}…`
    : out;
}
