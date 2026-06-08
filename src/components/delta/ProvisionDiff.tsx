import { useLayoutEffect, useRef } from "react";
import type { ActProvision, BillAmendmentOp, ProvisionDelta, ProvisionDiffRow } from "../../types";
import { ProvisionBlock, provDepth } from "./ProvisionBlock";

// Surrounding provisions to render on each side of the produced rows. The preview
// is a fixed-height scroll region, so this can be generous.
const CONTEXT = 10;

type Step = { kind: string; label: string };
const provOf = (r: ProvisionDiffRow): ActProvision | undefined => r.after ?? r.before;

// The label a path composes to, e.g. [30,(1)] → "30(1)".
const pathToLabel = (steps: Step[]) =>
  steps.map((s) => (s.kind === "section" || s.kind === "definition" ? s.label : `(${s.label})`)).join("");

const isAncestorPath = (anc: Step[], full: Step[]) =>
  anc.length > 0 && anc.length < full.length && anc.every((s, i) => s.label === full[i].label);

// The ancestor chain of the produced provision (section, subsection, …), built
// from its path so it's always complete. Each level uses the real Act row (with
// its chapeau text) when one exists, or a synthesized header when it doesn't
// (e.g. a section whose text lives entirely in its subsections). Stored order is
// post-order, so a parent can sit anywhere in its section — we search the whole
// (bounded) section, not just backwards.
function ancestorRows(
  rows: ProvisionDiffRow[],
  firstIdx: number,
): { headers: ProvisionDiffRow[]; usedIdx: Set<number> } {
  const target = provOf(rows[firstIdx])?.path as Step[] | undefined;
  if (!target || target.length <= 1) return { headers: [], usedIdx: new Set() };

  const sec = target[0].label;
  let start = firstIdx, end = firstIdx;
  while (start > 0 && provOf(rows[start - 1])?.path?.[0]?.label === sec) start--;
  while (end < rows.length - 1 && provOf(rows[end + 1])?.path?.[0]?.label === sec) end++;

  const realByDepth = new Map<number, number>(); // depth → row index
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

// Where an amendment lands in the Act: a scrollable, document-order window around
// the produced rows (highlighted), with the section/subsection it nests under
// pinned at the top so the hierarchy is always visible. Indentation is normalized
// to the shallowest provision shown, so the tree reads correctly.
export function ProvisionDiff({
  delta,
  op,
}: {
  delta: ProvisionDelta;
  op: BillAmendmentOp;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const f = c.querySelector<HTMLElement>(".dr-prov.is-focus");
    const anc = c.querySelector<HTMLElement>(".dr-diff-anc");
    if (f) c.scrollTop = Math.max(0, f.offsetTop - (anc?.offsetHeight ?? 0) - 8);
  }, [op.key]);

  if (op.producedRowIndices.length === 0) {
    return (
      <div className="dr-diff-empty">
        No matching provision found in {delta.title}. The bill names{" "}
        <code>{op.anchor ?? "an unspecified location"}</code>, which we couldn't resolve in the
        ingested Act — verify against the bill PDF.
      </div>
    );
  }

  const produced = new Set(op.producedRowIndices);
  const firstIdx = Math.min(...op.producedRowIndices);
  const lo = Math.max(0, firstIdx - CONTEXT);
  const hi = Math.min(delta.rows.length - 1, Math.max(...op.producedRowIndices) + CONTEXT);
  const { headers, usedIdx } = ancestorRows(delta.rows, firstIdx);

  // Normalize indentation across the pinned ancestors + the window together.
  let baseDepth = Infinity;
  for (const a of headers) baseDepth = Math.min(baseDepth, provDepth(a));
  for (let i = lo; i <= hi; i++) if (delta.rows[i]) baseDepth = Math.min(baseDepth, provDepth(delta.rows[i]));
  if (!Number.isFinite(baseDepth)) baseDepth = 0;

  const windowRows = [];
  for (let i = lo; i <= hi; i++) {
    const row = delta.rows[i];
    if (row && !usedIdx.has(i)) {
      windowRows.push(<ProvisionBlock key={i} row={row} focus={produced.has(i)} baseDepth={baseDepth} />);
    }
  }

  // The amendment appended new text at the very end of the Act — mark the boundary.
  const addedAtEnd = produced.has(delta.rows.length - 1);

  return (
    <div className="dr-diff" ref={scrollRef}>
      {headers.length > 0 && (
        <div className="dr-diff-anc">
          {headers.map((a, k) => (
            <ProvisionBlock key={`anc-${k}`} row={a} baseDepth={baseDepth} />
          ))}
        </div>
      )}
      {windowRows}
      {addedAtEnd && <div className="dr-diff-end">end of Act</div>}
    </div>
  );
}
