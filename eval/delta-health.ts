/**
 * Stage-2 HEALTH scorer — PURE, no gold, no server import. Where `delta-score.ts`
 * grades the 5 hand-authored gold bills precisely, this scores the REAL pipeline's
 * output on ANY bill using only proxy signals derivable from the delta response —
 * so we can measure "does the deterministic XML→delta actually work?" across the
 * ~150 real bills that have clause text, with no gold to author.
 *
 * The signals map directly to the failure classes we hunt in Slice 2b:
 *   - grounding rate  — ops with anchorFound=true (anchor resolved to a real provision)
 *   - null-anchor rate — ops with anchor=null (an unparsed instruction form → appended)
 *   - path mix        — bill-xml (deterministic) / ai-assisted (scalpel) / ai (Path-B fallback)
 *   - changed rows    — the diff actually produced changes (not all-unchanged / empty)
 *   - acts / errors   — target Acts resolved vs. "no structured text" misses
 * A bill is bucketed by its dominant symptom so the worst forms surface immediately.
 */
import type { DeltaLike, OpLike } from "./delta-score.js";

export type HealthBucket =
  | "healthy"
  | "low-grounding"
  | "null-anchors"
  | "fell-to-pathB"
  | "oversized"
  | "empty"
  | "no-delta";

export interface BillHealth {
  billNumber: string;
  billId: string;
  clauseCount: number;
  acts: number; // resolved Acts (deltas produced)
  ops: number;
  grounded: number; // anchorFound === true
  nullAnchor: number; // anchor == null
  unresolved: number; // anchorFound === false (anchor given but not found)
  pathBillXml: number; // deltas with source "bill-xml"
  pathAssisted: number; // "ai-assisted" (scalpel)
  pathB: number; // "ai" (agentic fallback)
  changedRows: number;
  totalRows: number;
  errors: string[];
  aiIncomplete: boolean;
  groundingRate: number; // grounded / ops
  nullAnchorRate: number; // nullAnchor / ops
  bucket: HealthBucket;
}

const srcCount = (deltas: DeltaLike[], src: string) => deltas.filter((d) => d.source === src).length;

export function scoreHealth(
  billNumber: string,
  billId: string,
  clauseCount: number,
  deltas: DeltaLike[],
  errors: string[] = [],
  aiIncomplete = false,
): BillHealth {
  const ops: OpLike[] = deltas.flatMap((d) => d.operations ?? []);
  const rows = deltas.flatMap((d) => d.rows ?? []);
  const grounded = ops.filter((o) => o.anchorFound === true).length;
  const nullAnchor = ops.filter((o) => (o.anchor ?? null) === null).length;
  const unresolved = ops.filter((o) => o.anchorFound === false).length;
  const pathBillXml = srcCount(deltas, "bill-xml");
  const pathAssisted = srcCount(deltas, "ai-assisted");
  const pathB = srcCount(deltas, "ai");
  const changedRows = rows.filter((r) => r.status && r.status !== "unchanged").length;

  const groundingRate = ops.length ? grounded / ops.length : 0;
  const nullAnchorRate = ops.length ? nullAnchor / ops.length : 0;

  // Bucket by dominant symptom (worst first). Path-B dominance means the
  // deterministic parser found nothing structured for that bill.
  let bucket: HealthBucket;
  if (deltas.length === 0) bucket = "no-delta";
  else if (ops.length === 0 || changedRows === 0) bucket = "empty";
  else if (pathBillXml === 0 && pathAssisted === 0 && pathB > 0) bucket = "fell-to-pathB";
  else if (nullAnchorRate > 0.2) bucket = "null-anchors";
  else if (groundingRate < 0.8) bucket = "low-grounding";
  else bucket = "healthy";

  return {
    billNumber,
    billId,
    clauseCount,
    acts: deltas.length,
    ops: ops.length,
    grounded,
    nullAnchor,
    unresolved,
    pathBillXml,
    pathAssisted,
    pathB,
    changedRows,
    totalRows: rows.length,
    errors,
    aiIncomplete,
    groundingRate,
    nullAnchorRate,
    bucket,
  };
}

export interface HealthAggregate {
  bills: number;
  withDelta: number; // bills that produced at least one Act delta
  totalOps: number;
  groundingRate: number; // micro-averaged over all ops
  nullAnchorRate: number;
  unresolvedRate: number;
  bucketCounts: Record<HealthBucket, number>;
  pathBills: { billXml: number; assisted: number; pathB: number }; // bills touching each path
  incompleteBills: number;
}

const EMPTY_BUCKETS = (): Record<HealthBucket, number> => ({
  healthy: 0,
  "low-grounding": 0,
  "null-anchors": 0,
  "fell-to-pathB": 0,
  oversized: 0,
  empty: 0,
  "no-delta": 0,
});

/** A bill whose delta response was too large to parse/score — not a parse failure
 *  but a route-payload scaling issue (the route returns the WHOLE Act as rows). */
export function oversizedHealth(
  billNumber: string,
  billId: string,
  clauseCount: number,
  bytes: number,
): BillHealth {
  return {
    billNumber,
    billId,
    clauseCount,
    acts: 0,
    ops: 0,
    grounded: 0,
    nullAnchor: 0,
    unresolved: 0,
    pathBillXml: 0,
    pathAssisted: 0,
    pathB: 0,
    changedRows: 0,
    totalRows: 0,
    errors: [`response ${Math.round(bytes / 1e6)}MB — Act too large to score (route returns whole Act as rows)`],
    aiIncomplete: false,
    groundingRate: 0,
    nullAnchorRate: 0,
    bucket: "oversized",
  };
}

export function aggregateHealth(items: BillHealth[]): HealthAggregate {
  const sum = (f: (b: BillHealth) => number) => items.reduce((n, b) => n + f(b), 0);
  const totalOps = sum((b) => b.ops);
  const bucketCounts = EMPTY_BUCKETS();
  for (const b of items) bucketCounts[b.bucket]++;
  return {
    bills: items.length,
    withDelta: items.filter((b) => b.acts > 0).length,
    totalOps,
    groundingRate: totalOps ? sum((b) => b.grounded) / totalOps : 0,
    nullAnchorRate: totalOps ? sum((b) => b.nullAnchor) / totalOps : 0,
    unresolvedRate: totalOps ? sum((b) => b.unresolved) / totalOps : 0,
    bucketCounts,
    pathBills: {
      billXml: items.filter((b) => b.pathBillXml > 0).length,
      assisted: items.filter((b) => b.pathAssisted > 0).length,
      pathB: items.filter((b) => b.pathB > 0).length,
    },
    incompleteBills: items.filter((b) => b.aiIncomplete).length,
  };
}

/** Rank worst-first for the report: no-delta/empty/pathB/null-anchors/low-grounding before healthy,
 *  then by grounding ascending. */
const BUCKET_RANK: Record<HealthBucket, number> = {
  "no-delta": 0,
  oversized: 1,
  empty: 2,
  "fell-to-pathB": 3,
  "null-anchors": 4,
  "low-grounding": 5,
  healthy: 6,
};
export function worstFirst(items: BillHealth[]): BillHealth[] {
  return [...items].sort(
    (a, b) => BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] || a.groundingRate - b.groundingRate,
  );
}
