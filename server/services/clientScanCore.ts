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

/** One Act's counsel-approved operations, flattened for the scan prompt. */
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

/** One row of the scan-ready bill list (bills with ≥1 approved op). */
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

/** Detail payload for one scan-ready bill. */
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

/** An op excluded from the AI calls (volume cap) — surfaced for coverage. */
export interface DroppedOp {
  key: string;
  anchor: string | null;
  actTitle: string;
  reason: "chunk-cap";
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
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9à-öø-ÿ]+/)
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

function asClientText(v: unknown): AnalysisBody["relevantClientText"] {
  if (!Array.isArray(v)) return [];
  const out: AnalysisBody["relevantClientText"] = [];
  for (const it of v) {
    if (!isRecord(it)) continue; // drop malformed entries
    const item = { source: asStr(it.source), excerpt: asStr(it.excerpt), issue: asStr(it.issue) };
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
    emailDraft: { subject: asStr(emailRec?.subject), body: asStr(emailRec?.body) },
    confidence,
    // Conservative: anything other than an explicit boolean means "review it".
    humanReviewRequired:
      typeof rec?.humanReviewRequired === "boolean" ? rec.humanReviewRequired : true,
    humanReviewReason:
      typeof rec?.humanReviewReason === "string" ? rec.humanReviewReason : null,
  };
}

// ── Coverage ──────────────────────────────────────────────────────────────────

/** A lawyer-facing note naming the ops that were never sent to the model. */
export function coverageNote(
  analyzedCount: number,
  dropped: DroppedOp[],
): string | null {
  void analyzedCount; // part of the stable API; the note names only the gaps
  if (dropped.length === 0) return null;
  const list = dropped.map((d) => `${d.anchor ?? d.key} (${d.actTitle})`).join(", ");
  return `Not analyzed (volume cap): ${list} — review these provisions manually.`;
}
