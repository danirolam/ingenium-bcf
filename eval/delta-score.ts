/**
 * Stage-2 fidelity scorer — PURE and dependency-free (imports nothing from
 * `server/`, honoring the eval leakage contract). Scores a generated
 * `ProvisionDelta[]` (what the real pipeline emits) against the hand-authored
 * gold in `fixtures/bill-deltas.ts`, op by op.
 *
 * Why the matcher is STRUCTURAL, not exact-anchor: the gold and the pipeline can
 * represent the same change at different granularities and both be correct. A
 * bill that says "Paragraphs 5(1)(b) to (c) are replaced, and 5(1)(h) is
 * replaced" is faithfully ONE coarse op in the gold (anchor "5(1)") but TWO
 * precise ops in the pipeline (anchors "5(1)(b)", "5(1)(h)"). Penalizing the
 * pipeline for being MORE precise would make the metric lie. So a gold op counts
 * as **placed** when gen ops in its structural neighborhood (the same section
 * subtree — equal / ancestor / descendant by path) collectively reproduce its
 * text. This credits split and merge, while a genuinely misplaced op (e.g. a
 * definition appended with anchor=null) or a spurious Act still fails.
 *
 * Three signals, because they fail differently:
 *   • placementRecall — gold ops whose text the pipeline produced in the right
 *     structural place (granularity-tolerant). The headline quality number.
 *   • contentRecall   — gold ops whose text appears ANYWHERE in the Act
 *     (anchor-agnostic). High content + low placement ⇒ a placement/parse bug.
 *   • precision       — gen ops that contributed to a placed gold op, over ALL
 *     gen ops INCLUDING ops in spurious Acts the bill only references. Low
 *     precision ⇒ the pipeline is amending/emitting things it shouldn't.
 */

// ── loose structural mirrors of the real types (no server import) ──
export interface OpLike {
  key?: string;
  clause?: string;
  op?: string; // add | replace | amend | repeal
  anchor?: string | null;
  newLabel?: string | null;
  newText?: string | null;
  anchorFound?: boolean;
  instruction?: string;
  producedRowIndices?: number[];
}
export interface RowLike {
  status?: string;
  label?: string;
  after?: { label?: string; text?: string; marginalNote?: string | null } | null;
  before?: { label?: string; text?: string } | null;
}
export interface DeltaLike {
  slug: string;
  title?: string;
  citation?: string;
  source?: string; // bill-xml | ai-assisted | ai
  operations?: OpLike[];
  rows?: RowLike[];
  incomplete?: boolean;
}

// ── text helpers ──
const tokenize = (s: string): string[] =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);

/** Jaccard token overlap — a forgiving similarity for near-verbatim text. */
export function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Fraction of `want`'s tokens present in `have` — used for structural coverage. */
function tokenRecall(want: string, have: string): number {
  const W = new Set(tokenize(want));
  if (!W.size) return 1;
  const H = new Set(tokenize(have));
  let hit = 0;
  for (const t of W) if (H.has(t)) hit++;
  return hit / W.size;
}

/** Normalize an anchor for exact comparison (mirrors the engine's `normLabel`). */
export function normAnchor(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(sub)?sections?\b|\bparagraphs?\b/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/** Parse an anchor into normalized path segments, e.g. "Subsection 5(1)(b)" →
 *  ["5","1","b"], "136.1" → ["136.1"], null → []. Path-aware so "7" is NOT a
 *  prefix of "70". */
export function anchorPath(s: string | null | undefined): string[] {
  const raw = (s ?? "")
    .toLowerCase()
    .replace(/\b(sub)?sections?\b|\bparagraphs?\b|\bsubparagraphs?\b|\bclauses?\b/g, " ")
    .trim();
  if (!raw) return [];
  const segs: string[] = [];
  const head = raw.match(/^[0-9]+(?:\.[0-9]+)*[a-z]?/);
  let rest = raw;
  if (head) {
    segs.push(head[0].replace(/\s+/g, ""));
    rest = raw.slice(head[0].length);
  }
  for (const g of rest.match(/\(([^)]+)\)/g) ?? []) segs.push(g.replace(/[()\s]/g, ""));
  return segs;
}

const prefixEq = (a: string[], b: string[]) => a.length <= b.length && a.every((x, i) => x === b[i]);
/** Same section subtree: one path is an ancestor/descendant of (or equal to) the other. */
const neighbor = (a: string[], b: string[]) =>
  a.length > 0 && b.length > 0 && (prefixEq(a, b) || prefixEq(b, a));

/** The operative "after" text of an op: prefer produced rows (the deterministic
 *  path omits newText), else the op's own newText. */
export function afterTextOf(op: OpLike, delta: DeltaLike): string {
  const idxs = op?.producedRowIndices;
  if (Array.isArray(idxs) && idxs.length) {
    const t = idxs
      .map((i) => delta?.rows?.[i]?.after?.text ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    if (t) return t;
  }
  return (op?.newText ?? "").trim();
}

/** The new/changed provision label this op produced, for display + miss reports. */
export function labelOf(op: OpLike, delta: DeltaLike): string | null {
  const i = op?.producedRowIndices?.[0];
  if (typeof i === "number") {
    const r = delta?.rows?.[i];
    return r?.after?.label ?? r?.before?.label ?? null;
  }
  return op?.newLabel ?? null;
}

const PLACE_COVERAGE = 0.8; // gold op "placed"/"content" if (neighborhood / any) gen text reproduces ≥80% of its tokens

export interface GoldOpView {
  anchor: string | null;
  op?: string;
  label: string | null;
  text: string;
  placed: boolean;
  coverage: number;
  exactAnchor: boolean;
  content: boolean;
  // representative gen op in the neighborhood (best text overlap):
  genAnchor: string | null;
  genOp?: string;
  opTypeOk: boolean;
  grounded: boolean;
  fidelity: number;
  genText: string;
}
export interface SpuriousOp {
  anchor: string | null;
  op?: string;
  anchorFound?: boolean;
}
export interface SlugScore {
  slug: string;
  title?: string;
  inGen: boolean;
  genSource?: string;
  goldOps: number;
  genOps: number;
  placed: number;
  exactAnchored: number;
  contentMatched: number;
  opTypeOk: number;
  grounded: number;
  textFidelitySum: number;
  contributingGen: number;
  golds: GoldOpView[];
  spuriousGen: SpuriousOp[]; // gen ops in this Act that placed no gold op
}
export interface BillScore {
  billId: string;
  billNumber: string;
  goldSlugs: number;
  genSlugs: number;
  slugCoverage: number;
  spuriousSlugs: string[]; // gen Acts with no gold counterpart (over-inclusion)
  spuriousGenOps: number;
  // raw counts (for correct micro-averaging)
  goldOps: number;
  genOps: number; // includes spurious-Act ops
  placed: number;
  contentMatched: number;
  contributingGen: number;
  opTypeOk: number;
  grounded: number;
  exactAnchored: number;
  textFidelitySum: number;
  // rates
  placementRecall: number;
  contentRecall: number;
  precision: number;
  exactAnchorRate: number;
  opTypeAccuracy: number;
  groundingRate: number;
  meanTextFidelity: number;
  aiIncomplete: boolean;
  perSlug: SlugScore[];
}

export function scoreBill(
  billId: string,
  billNumber: string,
  gold: DeltaLike[],
  gen: DeltaLike[],
  aiIncomplete = false,
): BillScore {
  const genBySlug = new Map(gen.map((d) => [d.slug, d] as const));
  const goldSlugSet = new Set(gold.map((g) => g.slug));
  const perSlug: SlugScore[] = [];

  for (const gd of gold) {
    const gx = genBySlug.get(gd.slug);
    const goldOpsArr = gd.operations ?? [];
    const genViews = gx
      ? (gx.operations ?? []).map((o) => ({
          op: o,
          anchor: o.anchor ?? null,
          optype: o.op,
          anchorFound: o.anchorFound,
          text: afterTextOf(o, gx),
          path: anchorPath(o.anchor),
        }))
      : [];

    const allGenText = genViews.map((v) => v.text).join(" ");
    const contributing = new Set<OpLike>();
    const golds: GoldOpView[] = [];

    for (const go of goldOpsArr) {
      const gp = anchorPath(go.anchor);
      const goldText = afterTextOf(go, gd);
      const neigh = genViews.filter((v) => neighbor(gp, v.path));
      const coverage = tokenRecall(goldText, neigh.map((v) => v.text).join(" "));
      const placed = gp.length > 0 && coverage >= PLACE_COVERAGE;
      // content = same bar, but anchor-agnostic (text present ANYWHERE in the Act).
      // A superset of `placed`, so content>placement on an op ⇒ misplacement.
      const content = tokenRecall(goldText, allGenText) >= PLACE_COVERAGE;

      let best: (typeof genViews)[number] | null = null;
      let bestJ = -1;
      for (const v of neigh) {
        const j = jaccard(goldText, v.text);
        if (j > bestJ) {
          bestJ = j;
          best = v;
        }
      }
      const exactAnchor =
        normAnchor(go.anchor) !== "" && genViews.some((v) => normAnchor(v.anchor) === normAnchor(go.anchor));

      if (placed) for (const v of neigh) contributing.add(v.op);

      golds.push({
        anchor: go.anchor ?? null,
        op: go.op,
        label: labelOf(go, gd),
        text: goldText,
        placed,
        coverage,
        exactAnchor,
        content,
        genAnchor: best?.anchor ?? null,
        genOp: best?.optype,
        opTypeOk: !!best && (go.op ?? "") === (best.optype ?? ""),
        grounded: !!best && best.anchorFound === true,
        fidelity: best ? Math.max(0, bestJ) : 0,
        genText: best?.text ?? "",
      });
    }

    const placedGolds = golds.filter((g) => g.placed);
    perSlug.push({
      slug: gd.slug,
      title: gd.title,
      inGen: !!gx,
      genSource: gx?.source,
      goldOps: goldOpsArr.length,
      genOps: genViews.length,
      placed: placedGolds.length,
      exactAnchored: golds.filter((g) => g.exactAnchor).length,
      contentMatched: golds.filter((g) => g.content).length,
      opTypeOk: placedGolds.filter((g) => g.opTypeOk).length,
      grounded: placedGolds.filter((g) => g.grounded).length,
      textFidelitySum: placedGolds.reduce((n, g) => n + g.fidelity, 0),
      contributingGen: contributing.size,
      golds,
      spuriousGen: genViews
        .filter((v) => !contributing.has(v.op))
        .map((v) => ({ anchor: v.anchor, op: v.optype, anchorFound: v.anchorFound })),
    });
  }

  const spuriousSlugs = gen.filter((d) => !goldSlugSet.has(d.slug)).map((d) => d.slug);
  const spuriousGenOps = gen
    .filter((d) => !goldSlugSet.has(d.slug))
    .reduce((n, d) => n + (d.operations?.length ?? 0), 0);

  const sum = (f: (s: SlugScore) => number) => perSlug.reduce((n, s) => n + f(s), 0);
  const goldOps = sum((s) => s.goldOps);
  const genOps = sum((s) => s.genOps) + spuriousGenOps;
  const placed = sum((s) => s.placed);
  const contentMatched = sum((s) => s.contentMatched);
  const contributingGen = sum((s) => s.contributingGen);
  const opTypeOk = sum((s) => s.opTypeOk);
  const grounded = sum((s) => s.grounded);
  const exactAnchored = sum((s) => s.exactAnchored);
  const textFidelitySum = sum((s) => s.textFidelitySum);
  const genSlugsPresent = gold.filter((g) => genBySlug.has(g.slug)).length;

  return {
    billId,
    billNumber,
    goldSlugs: gold.length,
    genSlugs: gen.length,
    slugCoverage: gold.length ? genSlugsPresent / gold.length : 1,
    spuriousSlugs,
    spuriousGenOps,
    goldOps,
    genOps,
    placed,
    contentMatched,
    contributingGen,
    opTypeOk,
    grounded,
    exactAnchored,
    textFidelitySum,
    placementRecall: goldOps ? placed / goldOps : 0,
    contentRecall: goldOps ? contentMatched / goldOps : 0,
    precision: genOps ? contributingGen / genOps : 0,
    exactAnchorRate: goldOps ? exactAnchored / goldOps : 0,
    opTypeAccuracy: placed ? opTypeOk / placed : 0,
    groundingRate: placed ? grounded / placed : 0,
    meanTextFidelity: placed ? textFidelitySum / placed : 0,
    aiIncomplete,
    perSlug,
  };
}

export interface Aggregate {
  bills: number;
  goldOps: number;
  genOps: number;
  placementRecall: number;
  contentRecall: number;
  precision: number;
  opTypeAccuracy: number;
  groundingRate: number;
  meanTextFidelity: number;
  slugCoverage: number;
}

/** Micro-average across bills (weighted by op/slug counts, not by bill). */
export function aggregate(scores: BillScore[]): Aggregate {
  const sum = (f: (b: BillScore) => number) => scores.reduce((n, b) => n + f(b), 0);
  const goldOps = sum((b) => b.goldOps);
  const genOps = sum((b) => b.genOps);
  const placed = sum((b) => b.placed);
  const goldSlugs = sum((b) => b.goldSlugs);
  const coveredSlugs = sum((b) => b.slugCoverage * b.goldSlugs);
  return {
    bills: scores.length,
    goldOps,
    genOps,
    placementRecall: goldOps ? placed / goldOps : 0,
    contentRecall: goldOps ? sum((b) => b.contentMatched) / goldOps : 0,
    precision: genOps ? sum((b) => b.contributingGen) / genOps : 0,
    opTypeAccuracy: placed ? sum((b) => b.opTypeOk) / placed : 0,
    groundingRate: placed ? sum((b) => b.grounded) / placed : 0,
    meanTextFidelity: placed ? sum((b) => b.textFidelitySum) / placed : 0,
    slugCoverage: goldSlugs ? coveredSlugs / goldSlugs : 1,
  };
}
