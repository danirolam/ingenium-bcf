import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
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

  // Resizable PDF pane: default to one third of the viewport; counsel can drag
  // the divider. Width lives in a CSS var so the responsive media query can still
  // collapse the two-pane grid on narrow screens.
  const gridRef = useRef<HTMLDivElement>(null);
  const [pdfPx, setPdfPx] = useState(() =>
    Math.round((typeof window !== "undefined" ? window.innerWidth : 1200) / 3),
  );
  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev: MouseEvent) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPdfPx(Math.max(300, Math.min(rect.width - 420, ev.clientX - rect.left)));
    };
    const up = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

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
      <div className="dr-grid" ref={gridRef} style={{ "--pdf-w": `${pdfPx}px` } as CSSProperties}>
        <BillPdfPane bill={bill} />
        <div
          className="dr-resizer"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          onMouseDown={startDrag}
        />
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
