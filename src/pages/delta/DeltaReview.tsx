import { useEffect, useMemo, useState } from "react";
import type { Bill, BillAmendmentOp, ProvisionDelta } from "../../types";
import type { ApprovalsState } from "../../lib/useApprovals";
import { BillPdfPane } from "../../components/delta/BillPdfPane";
import { AmendmentCard } from "../../components/delta/AmendmentCard";
import { exportActAsPdf } from "../../lib/actExport";

type Item = { delta: ProvisionDelta; op: BillAmendmentOp };

// The review surface: bill PDF left, one full-height amendment right. The user
// pages through amendments with ← / → (or arrow keys); approving doesn't collapse
// anything — it recolours the card's border. Amendments are a flat ordered list
// across every affected Act (Act order preserved); the current Act is shown in the
// pager bar, and export is gated per Act.
export function DeltaReview({
  bill,
  deltas,
  approvals,
  incomplete,
  incompleteReason,
  refreshing,
  onRecompute,
  toast,
}: {
  bill: Bill | null;
  deltas: ProvisionDelta[];
  approvals: ApprovalsState;
  incomplete: boolean;
  incompleteReason: "rate-limit" | "ai-error" | null;
  refreshing: boolean;
  onRecompute: () => void;
  toast: (msg: string) => void;
}) {
  const items = useMemo<Item[]>(
    () => deltas.flatMap((d) => d.operations.map((op) => ({ delta: d, op }))),
    [deltas],
  );

  const [idx, setIdx] = useState(0);
  const at = Math.min(idx, Math.max(0, items.length - 1));
  const go = (step: number) => setIdx(() => Math.max(0, Math.min(items.length - 1, at + step)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { setIdx((i) => Math.max(0, i - 1)); }
      else if (e.key === "ArrowRight") { setIdx((i) => Math.min(items.length - 1, i + 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length]);

  const cur = items[at];
  if (!cur) return null;

  const approved = approvals.isApproved(cur.op.key);
  const actApproved = cur.delta.operations.reduce((n, o) => n + (approvals.isApproved(o.key) ? 1 : 0), 0);
  const actAllApproved = cur.delta.operations.length > 0 && actApproved === cur.delta.operations.length;

  const onExport = (delta: ProvisionDelta) => {
    if (!exportActAsPdf(delta, bill)) toast("Allow pop-ups to export the PDF.");
  };

  return (
    <>
      {incomplete && (
        <div className="dr-banner" role="alert">
          <span>
            {incompleteReason === "rate-limit"
              ? "Interpretation is partial — the AI hit its rate limit."
              : "Interpretation is partial — an AI call failed."}{" "}
            Some amendments may be missing.
          </span>
          <button className="btn ghost sm" onClick={onRecompute} disabled={refreshing}>
            {refreshing ? "Recomputing…" : "Recompute"}
          </button>
        </div>
      )}
      <div className="dr-grid">
        <BillPdfPane bill={bill} />
        <div className="dr-pager">
          <div className="dr-pager-bar">
            <button className="dr-nav" onClick={() => go(-1)} disabled={at <= 0} title="Previous (←)">
              ←
            </button>
            <div className="dr-pager-pos">
              <span className="dr-pager-count">
                Amendment <b>{at + 1}</b> of {items.length}
              </span>
              <span className="dr-pager-act">
                {cur.delta.title} · {actApproved}/{cur.delta.operations.length} approved
              </span>
            </div>
            <button className="dr-nav" onClick={() => go(1)} disabled={at >= items.length - 1} title="Next (→)">
              →
            </button>
            <button
              className="btn primary sm dr-pager-export"
              disabled={!actAllApproved}
              title={actAllApproved ? `Export ${cur.delta.title} as a PDF` : "Approve every amendment in this Act first"}
              onClick={() => onExport(cur.delta)}
            >
              Export PDF
            </button>
          </div>
          <div className="dr-pager-body">
            <AmendmentCard
              key={cur.op.key}
              delta={cur.delta}
              op={cur.op}
              approved={approved}
              onApprove={(v) => approvals.setApproved([cur.op.key], v)}
            />
          </div>
        </div>
      </div>
    </>
  );
}
