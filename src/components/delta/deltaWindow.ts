import type { ActProvision, BillAmendmentOp, ProvisionDelta, ProvisionDiffRow } from "../../types";
import type { Step } from "./provisionShape";

// Shared segmentation + ancestor logic for the continuous comparator (and the PDF
// export). Splits a delta's document-ordered rows into contiguous CHANGE runs
// (with the ops that produced them) and the unchanged GAPs between, and finds the
// section/subsection headers a change nests under.

const provOf = (r: ProvisionDiffRow): ActProvision | undefined => r.after ?? r.before;

const pathToLabel = (steps: Step[]) =>
  steps.map((s) => (s.kind === "section" || s.kind === "definition" ? s.label : `(${s.label})`)).join("");

const isAncestorPath = (anc: Step[], full: Step[]) =>
  anc.length > 0 && anc.length < full.length && anc.every((s, i) => s.label === full[i].label);

/** The ancestor chain (section/subsection headers) the change at `firstIdx` nests
 *  under - the real Act row when one exists in its section, else a synthesized
 *  header. (Moved verbatim from ProvisionDiff so the comparator pins headers the
 *  same way.) */
export function ancestorRows(
  rows: ProvisionDiffRow[],
  firstIdx: number,
): { headers: ProvisionDiffRow[]; usedIdx: Set<number> } {
  const target = provOf(rows[firstIdx])?.path as Step[] | undefined;
  if (!target || target.length <= 1) return { headers: [], usedIdx: new Set() };

  const sec = target[0].label;
  let start = firstIdx;
  let end = firstIdx;
  while (start > 0 && provOf(rows[start - 1])?.path?.[0]?.label === sec) start--;
  while (end < rows.length - 1 && provOf(rows[end + 1])?.path?.[0]?.label === sec) end++;

  const realByDepth = new Map<number, number>();
  for (let i = start; i <= end; i++) {
    const p = provOf(rows[i]);
    if (p?.path && isAncestorPath(p.path, target) && !realByDepth.has(p.path.length)) {
      realByDepth.set(p.path.length, i);
    }
  }

  const headers: ProvisionDiffRow[] = [];
  const usedIdx = new Set<number>();
  for (let depth = 1; depth < target.length; depth++) {
    const realIdx = realByDepth.get(depth);
    if (realIdx != null) {
      headers.push(rows[realIdx]);
      usedIdx.add(realIdx);
    } else {
      const prefix = target.slice(0, depth);
      const label = pathToLabel(prefix);
      headers.push({
        status: "unchanged",
        label,
        after: { id: `anc:${label}`, label, kind: prefix[depth - 1].kind, marginalNote: null, text: "", path: prefix },
      });
    }
  }
  return { headers, usedIdx };
}

export interface ChangeSegment {
  kind: "change";
  indices: number[];
  ops: BillAmendmentOp[];
}
export interface GapSegment {
  kind: "gap";
  indices: number[];
}
export type Segment = ChangeSegment | GapSegment;

/** Document-ordered rows → contiguous change runs (+ their ops) and unchanged
 *  gaps. The comparator renders changes with the word-diff and collapses gaps
 *  into "N unchanged provisions" (CanLII's "N identical paragraphs"). */
export function segmentDelta(delta: ProvisionDelta): Segment[] {
  const rows = delta.rows ?? [];
  const ops = delta.operations ?? [];
  const segs: Segment[] = [];
  let i = 0;
  while (i < rows.length) {
    const isChange = rows[i].status !== "unchanged";
    let j = i;
    while (j < rows.length && (rows[j].status !== "unchanged") === isChange) j++;
    const indices: number[] = [];
    for (let k = i; k < j; k++) indices.push(k);
    if (isChange) {
      const set = new Set(indices);
      segs.push({
        kind: "change",
        indices,
        ops: ops.filter((op) => (op.producedRowIndices ?? []).some((r) => set.has(r))),
      });
    } else {
      segs.push({ kind: "gap", indices });
    }
    i = j;
  }
  return segs;
}
