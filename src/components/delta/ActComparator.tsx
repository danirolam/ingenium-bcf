import { useEffect, useMemo, useRef, useState } from "react";
import type { BillAmendmentOp, ProvisionDelta } from "../../types";
import type { ApprovalsState } from "../../lib/useApprovals";
import { SplitRow } from "./SplitRow";
import { ProvisionBlock } from "./ProvisionBlock";
import { ancestorRows, segmentDelta, type ChangeSegment, type GapSegment } from "./deltaWindow";

// CanLII-style continuous comparator: the whole Act in document order, two
// columns (current | as amended). Runs of unchanged provisions collapse into a
// "N unchanged provisions" bar (expandable); changes render with SplitRow's
// word-level diff. A sticky "Change X of N" bar jumps between changes; each
// change carries an inline approve + a "Bill says" toggle (the per-op review the
// pager used to host), so the approval gate is unchanged.

const EDGE = 2; // unchanged rows kept beside a change before collapsing
const COLLAPSE_MIN = 2 * EDGE + 1; // gaps this short render in full

const OP_LABEL: Record<BillAmendmentOp["op"], string> = {
  add: "Add",
  replace: "Replace",
  repeal: "Repeal",
  amend: "Amend",
};

export function ActComparator({
  deltas,
  approvals,
}: {
  deltas: ProvisionDelta[];
  approvals: ApprovalsState;
}) {
  const segmented = useMemo(() => deltas.map((d) => ({ delta: d, segs: segmentDelta(d) })), [deltas]);
  const changeCount = useMemo(
    () => segmented.reduce((n, { segs }) => n + segs.filter((s) => s.kind === "change").length, 0),
    [segmented],
  );

  const [cur, setCur] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const changeRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const goTo = (n: number) => {
    const idx = Math.max(0, Math.min(changeCount - 1, n));
    setCur(idx);
    changeRefs.current.get(idx)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") goTo(cur - 1);
      else if (e.key === "ArrowRight") goTo(cur + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, changeCount]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const renderGap = (delta: ProvisionDelta, seg: GapSegment, key: string) => {
    const rows = delta.rows;
    const idxs = seg.indices;
    const open = expanded.has(key);
    if (idxs.length <= COLLAPSE_MIN || open) {
      return (
        <div className="dr-cmp-gap" key={key}>
          {idxs.map((i) => <SplitRow key={i} row={rows[i]} />)}
          {open && idxs.length > COLLAPSE_MIN && (
            <button className="dr-cmp-fold" onClick={() => toggle(key)}>
              ⌃ Collapse {idxs.length} unchanged provisions
            </button>
          )}
        </div>
      );
    }
    const top = idxs.slice(0, EDGE);
    const bottom = idxs.slice(-EDGE);
    return (
      <div className="dr-cmp-gap" key={key}>
        {top.map((i) => <SplitRow key={i} row={rows[i]} />)}
        <button className="dr-cmp-fold" onClick={() => toggle(key)}>
          ⌄ {idxs.length - 2 * EDGE} unchanged provisions — show
        </button>
        {bottom.map((i) => <SplitRow key={i} row={rows[i]} />)}
      </div>
    );
  };

  const renderChange = (delta: ProvisionDelta, seg: ChangeSegment, key: string, no: number) => {
    const rows = delta.rows;
    const { headers } = ancestorRows(rows, seg.indices[0]);
    const ops = seg.ops;
    const allApproved = ops.length > 0 && ops.every((o) => approvals.isApproved(o.key));
    const kinds = Array.from(new Set(ops.map((o) => o.op)));
    const anchors = ops.map((o) => o.anchor ?? "(new)").join(", ") || "(new section)";
    const says = ops.map((o) => o.instruction || o.note || "").filter(Boolean);

    return (
      <div
        className={`dr-cmp-change${allApproved ? " is-approved" : ""}`}
        key={key}
        ref={(el) => {
          if (el) changeRefs.current.set(no, el);
        }}
      >
        <div className="dr-cmp-change-head">
          {(kinds.length ? kinds : (["amend"] as const)).map((k) => (
            <span key={k} className={`dr-op is-${k}`}>{OP_LABEL[k]}</span>
          ))}
          <span className="dr-cmp-change-anchor">{anchors}</span>
          {ops.some((o) => !o.anchorFound) && (
            <span className="dr-card-warn" title="Anchor not verified against the Act">⚠</span>
          )}
          <span className="dr-cmp-change-actions">
            {says.length > 0 && <SaysToggle says={says} />}
            {ops.length > 0 && (
              <button
                className={allApproved ? "btn ghost sm" : "btn primary sm"}
                onClick={() => approvals.setApproved(ops.map((o) => o.key), !allApproved)}
              >
                {allApproved ? "✓ Approved" : "Approve"}
              </button>
            )}
          </span>
        </div>
        {headers.length > 0 && (
          <div className="dr-cmp-anc">
            {headers.map((h, k) => <ProvisionBlock key={k} row={h} />)}
          </div>
        )}
        <div className="dr-cmp-rows">
          {seg.indices.map((i) => <SplitRow key={i} row={rows[i]} focus />)}
        </div>
      </div>
    );
  };

  let no = -1; // running change index, in render (= document) order
  return (
    <div className="dr-cmp">
      <div className="dr-cmp-nav">
        <span className="dr-cmp-nav-pos">
          {changeCount ? (
            <>
              Change <b>{cur + 1}</b> of {changeCount}
            </>
          ) : (
            "No changes"
          )}
        </span>
        <button className="dr-nav" onClick={() => goTo(cur - 1)} disabled={cur <= 0} title="Previous change (←)">
          ↑
        </button>
        <button
          className="dr-nav"
          onClick={() => goTo(cur + 1)}
          disabled={cur >= changeCount - 1}
          title="Next change (→)"
        >
          ↓
        </button>
        <span className="dr-cmp-cols">
          <span>Current</span>
          <span>As amended</span>
        </span>
      </div>

      <div className="dr-cmp-body">
        {segmented.map(({ delta, segs }) => {
          const approved = delta.operations.reduce((n, o) => n + (approvals.isApproved(o.key) ? 1 : 0), 0);
          return (
            <section className="dr-cmp-act" key={delta.slug}>
              <div className="dr-cmp-act-head">
                <span className="dr-cmp-act-title">{delta.title}</span>
                <span className="dr-cmp-act-cite">{delta.citation}</span>
                <span className="dr-cmp-act-approved">
                  {approved}/{delta.operations.length} approved
                </span>
              </div>
              {segs.map((seg, si) =>
                seg.kind === "gap"
                  ? renderGap(delta, seg, `${delta.slug}:g${si}`)
                  : renderChange(delta, seg, `${delta.slug}:c${si}`, (no += 1)),
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SaysToggle({ says }: { says: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="dr-cmp-says-btn" onClick={() => setOpen((o) => !o)} title="What the bill says">
        {open ? "Hide bill text" : "Bill says"}
      </button>
      {open && (
        <div className="dr-cmp-says">
          {says.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>
      )}
    </>
  );
}
