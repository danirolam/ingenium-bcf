import { useLayoutEffect, useRef, useState } from "react";
import type { ActProvision, BillAmendmentOp, ProvisionDelta, ProvisionDiffRow } from "../../types";
import { ProvisionBlock } from "./ProvisionBlock";
import { SplitRow } from "./SplitRow";
import { provDepthOf, type Step } from "./provisionShape";

// Rows shown above/below the change to start, and how many more each "expand"
// reveals (GitHub-style context unfolding).
const BASE = 10;
const STEP = 10;

const provOf = (r: ProvisionDiffRow): ActProvision | undefined => r.after ?? r.before;

// The label a path composes to, e.g. [30,(1)] → "30(1)".
const pathToLabel = (steps: Step[]) =>
  steps.map((s) => (s.kind === "section" || s.kind === "definition" ? s.label : `(${s.label})`)).join("");

const isAncestorPath = (anc: Step[], full: Step[]) =>
  anc.length > 0 && anc.length < full.length && anc.every((s, i) => s.label === full[i].label);

const sameLabel = (a?: string, b?: string) =>
  !!a && (a ?? "").toLowerCase().replace(/\s+/g, "") === (b ?? "").toLowerCase().replace(/\s+/g, "");

// A structured "replace" splices the new provision in and drops the old, so the
// diff carries them as an adjacent added + repealed pair. Collapse that pair back
// into one `changed` row so the side-by-side word-diff highlights only what
// actually changed (CanLII style) instead of repainting both halves wholesale.
type WindowRow = { key: string; row: ProvisionDiffRow; focus: boolean };
function pairReplacements(
  items: { i: number; row: ProvisionDiffRow }[],
  produced: Set<number>,
): WindowRow[] {
  const out: WindowRow[] = [];
  for (let k = 0; k < items.length; k++) {
    const a = items[k];
    const b = items[k + 1];
    const isPair =
      b &&
      ((a.row.status === "added" && b.row.status === "repealed") ||
        (a.row.status === "repealed" && b.row.status === "added"));
    if (isPair) {
      const added = a.row.status === "added" ? a.row : b.row;
      const repealed = a.row.status === "repealed" ? a.row : b.row;
      if (added.after && repealed.before && sameLabel(added.after.label, repealed.before.label)) {
        out.push({
          key: `pair-${a.i}`,
          row: { status: "changed", label: added.after.label, before: repealed.before, after: added.after },
          focus: produced.has(a.i) || produced.has(b.i),
        });
        k++; // consume the partner row
        continue;
      }
    }
    out.push({ key: String(a.i), row: a.row, focus: produced.has(a.i) });
  }
  return out;
}

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
  let start = firstIdx;
  let end = firstIdx;
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

// Where an amendment lands in the Act: a side-by-side (current | as-amended)
// window around the produced rows, with the section/subsection it nests under
// pinned at the top. Context unfolds 10 rows at a time in either direction.
export function ProvisionDiff({ delta, op }: { delta: ProvisionDelta; op: BillAmendmentOp }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(0);
  const [down, setDown] = useState(0);
  // Remember scroll metrics across an upward expand so the viewport doesn't jump
  // when rows are prepended.
  const pending = useRef<{ top: number; height: number } | null>(null);

  // Centre the focus rows under the pinned header on mount / amendment change.
  useLayoutEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const f = c.querySelector<HTMLElement>(".dr-srow.is-focus");
    const head = c.querySelector<HTMLElement>(".dr-diff-head");
    if (f) c.scrollTop = Math.max(0, f.offsetTop - (head?.offsetHeight ?? 0) - 8);
  }, [op.key]);

  // Keep the viewport anchored when revealing rows above.
  useLayoutEffect(() => {
    const c = scrollRef.current;
    if (c && pending.current) {
      c.scrollTop = pending.current.top + (c.scrollHeight - pending.current.height);
      pending.current = null;
    }
  }, [up]);

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
  const lastIdx = Math.max(...op.producedRowIndices);
  const lo = Math.max(0, firstIdx - BASE - up);
  const hi = Math.min(delta.rows.length - 1, lastIdx + BASE + down);
  const { headers, usedIdx } = ancestorRows(delta.rows, firstIdx);

  // Normalize indentation across the pinned ancestors + the window together.
  let baseDepth = Infinity;
  for (const a of headers) {
    const p = provOf(a);
    if (p) baseDepth = Math.min(baseDepth, provDepthOf(p));
  }
  for (let i = lo; i <= hi; i++) {
    const r = delta.rows[i];
    const p = r ? provOf(r) : undefined;
    if (p) baseDepth = Math.min(baseDepth, provDepthOf(p));
  }
  if (!Number.isFinite(baseDepth)) baseDepth = 0;

  const items: { i: number; row: ProvisionDiffRow }[] = [];
  for (let i = lo; i <= hi; i++) {
    const row = delta.rows[i];
    if (row && !usedIdx.has(i)) items.push({ i, row });
  }
  const windowRows = pairReplacements(items, produced).map((w) => (
    <SplitRow key={w.key} row={w.row} focus={w.focus} baseDepth={baseDepth} />
  ));

  const moreAbove = lo > 0;
  const moreBelow = hi < delta.rows.length - 1;
  const addedAtEnd = produced.has(delta.rows.length - 1);

  const expandUp = () => {
    const c = scrollRef.current;
    if (c) pending.current = { top: c.scrollTop, height: c.scrollHeight };
    setUp((u) => u + STEP);
  };

  return (
    <div className="dr-diff" ref={scrollRef}>
      <div className="dr-diff-head">
        <div className="dr-diff-cols">
          <span>Current</span>
          <span>As amended</span>
        </div>
        {headers.length > 0 && (
          <div className="dr-diff-anc">
            {headers.map((a, k) => (
              <ProvisionBlock key={`anc-${k}`} row={a} baseDepth={baseDepth} />
            ))}
          </div>
        )}
      </div>

      {moreAbove && (
        <button className="dr-expand" onClick={expandUp} title="Reveal more context above">
          <span className="dr-expand-ic">↑</span> Show {Math.min(STEP, lo)} more above
        </button>
      )}

      <div className="dr-split">{windowRows}</div>

      {moreBelow && (
        <button className="dr-expand" onClick={() => setDown((d) => d + STEP)} title="Reveal more context below">
          <span className="dr-expand-ic">↓</span> Show {Math.min(STEP, delta.rows.length - 1 - hi)} more below
        </button>
      )}

      {addedAtEnd && <div className="dr-diff-end">end of Act</div>}
    </div>
  );
}
