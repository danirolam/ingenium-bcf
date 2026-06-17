import { useLayoutEffect, useRef, useState } from "react";
import type { ActProvision, BillAmendmentOp, ProvisionDelta, ProvisionDiffRow } from "../../types";
import { SplitRow } from "./SplitRow";
import { provDepthOf } from "./provisionShape";

// Rows shown above/below the change to start, and how many more each "expand"
// reveals (GitHub-style context unfolding).
const BASE = 10;
const STEP = 10;

const provOf = (r: ProvisionDiffRow): ActProvision | undefined => r.after ?? r.before;

const sameLabel = (a?: string, b?: string) =>
  !!a && (a ?? "").toLowerCase().replace(/\s+/g, "") === (b ?? "").toLowerCase().replace(/\s+/g, "");

// A structured "replace" splices the new provision in and drops the old, so the
// diff carries them as an adjacent added + repealed pair. Collapse that pair back
// into one `changed` row so the side-by-side word-diff highlights only what
// actually changed (CanLII style) instead of repainting both halves wholesale.
type WindowRow = { key: string; i: number; row: ProvisionDiffRow; focus: boolean };
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
          i: a.i,
          row: { status: "changed", label: added.after.label, before: repealed.before, after: added.after },
          focus: produced.has(a.i) || produced.has(b.i),
        });
        k++; // consume the partner row
        continue;
      }
    }
    out.push({ key: String(a.i), i: a.i, row: a.row, focus: produced.has(a.i) });
  }
  return out;
}

// The first row of the section a change lives in - so the section header + its
// subsection chapeau are always pulled into the window and shown inline, in
// document order, the way the Act prints them. (The change's path[0] is its
// section; walk back over rows sharing that section.)
function sectionTop(rows: ProvisionDiffRow[], firstIdx: number): number {
  const sec = provOf(rows[firstIdx])?.path?.[0]?.label;
  if (sec == null) return firstIdx;
  let i = firstIdx;
  while (i > 0 && provOf(rows[i - 1])?.path?.[0]?.label === sec) i--;
  return i;
}

// Where an amendment lands in the Act: a side-by-side (current | as-amended)
// window around the produced rows, showing the section/subsection it nests under
// inline above it. Context unfolds 10 rows at a time in either direction.
export function ProvisionDiff({ delta, op }: { delta: ProvisionDelta; op: BillAmendmentOp }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(0);
  const [down, setDown] = useState(0);
  // Remember scroll metrics across an upward expand so the viewport doesn't jump
  // when rows are prepended.
  const pending = useRef<{ top: number; height: number } | null>(null);

  // Produced-row bounds + the section the change lives in (firstIdx/secTop are read
  // by the mount-scroll effect below, so they're computed before any early return).
  const produced = new Set(op.producedRowIndices);
  const firstIdx = op.producedRowIndices.length ? Math.min(...op.producedRowIndices) : 0;
  const lastIdx = op.producedRowIndices.length ? Math.max(...op.producedRowIndices) : 0;
  const secTop = sectionTop(delta.rows, firstIdx);

  // On mount / amendment change, land the view on the section header (so the
  // change reads in its "5 (1) … (b)" context), as long as that header is within a
  // screenful of the change; otherwise fall back to the first focus row.
  useLayoutEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const head = c.querySelector<HTMLElement>(".dr-diff-head");
    const anchorIdx = firstIdx - secTop <= BASE ? secTop : firstIdx;
    const target =
      c.querySelector<HTMLElement>(`.dr-srow[data-ri="${anchorIdx}"]`) ??
      c.querySelector<HTMLElement>(".dr-srow.is-focus");
    if (target) c.scrollTop = Math.max(0, target.offsetTop - (head?.offsetHeight ?? 0) - 8);
  }, [op.key, firstIdx, secTop]);

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
        ingested Act. Verify against the bill PDF.
      </div>
    );
  }

  // The change's own section - its header + subsection chapeau are shown INLINE,
  // in document order, exactly as the Act prints them (so a paragraph change reads
  // "5 (1) The Governor in Council… (b) …", not a faint floating breadcrumb). The
  // window always reaches up to this section's first row; it never trims the normal
  // ±BASE context, so neighbouring changes above stay visible too.
  const lo = Math.max(0, Math.min(firstIdx - BASE, secTop) - up);
  const hi = Math.min(delta.rows.length - 1, lastIdx + BASE + down);

  // Normalize indentation so the shallowest row shown (the section) sits at the
  // left margin and its subsections/paragraphs nest under it.
  let baseDepth = Infinity;
  for (let i = lo; i <= hi; i++) {
    const r = delta.rows[i];
    const p = r ? provOf(r) : undefined;
    if (p) baseDepth = Math.min(baseDepth, provDepthOf(p));
  }
  if (!Number.isFinite(baseDepth)) baseDepth = 0;

  const items: { i: number; row: ProvisionDiffRow }[] = [];
  for (let i = lo; i <= hi; i++) {
    const row = delta.rows[i];
    if (row) items.push({ i, row });
  }
  // Render the rows, dropping a Part/Division heading in whenever it changes (the
  // big title the Act prints between sections). Seed from the row just above the
  // window so an unchanged heading isn't repeated at the top.
  const windowRows = pairReplacements(items, produced).map((w) => (
    <SplitRow
      key={w.key}
      rowIndex={w.i}
      row={w.row}
      focus={w.focus}
      // A change this amendment didn't produce (e.g. a neighbouring clause's added
      // §4.1) is dimmed, so the eye stays on the change being scrutinised.
      dim={w.row.status !== "unchanged" && !w.focus}
      baseDepth={baseDepth}
    />
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
