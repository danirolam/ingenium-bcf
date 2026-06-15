import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { Bill, ProvisionDelta } from "../../types";
import type { ApprovalsState } from "../../lib/useApprovals";
import { BillPdfPane } from "../../components/delta/BillPdfPane";
import { ActComparator } from "../../components/delta/ActComparator";
import { exportActAsPdf } from "../../lib/actExport";

const PDF_OPEN_KEY = "dr-pdf-open";

// The review surface: a continuous CanLII-style comparator (whole Act, unchanged
// runs collapsed, changes word-diffed, "Change X of N" navigator) with the
// official bill PDF in a collapsible side pane (hidden by default — counsel opens
// it when they want to check against the source). Export produces a changes-in-
// context redline once every amendment is approved.
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
  const [pdfOpen, setPdfOpen] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(PDF_OPEN_KEY) === "1",
  );
  const togglePdf = () =>
    setPdfOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(PDF_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  // Resizable PDF pane (only while open): default to a third of the viewport.
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
      setPdfPx(Math.max(300, Math.min(rect.width - 480, ev.clientX - rect.left)));
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

  const totalOps = deltas.reduce((n, d) => n + d.operations.length, 0);
  const allApproved =
    totalOps > 0 && deltas.every((d) => d.operations.every((o) => approvals.isApproved(o.key)));

  const onExport = () => {
    if (!exportActAsPdf(deltas, bill)) toast("Allow pop-ups to export the PDF.");
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

      <div
        className={`dr-grid${pdfOpen ? " is-pdf-open" : ""}`}
        ref={gridRef}
        style={{ "--pdf-w": `${pdfPx}px` } as CSSProperties}
      >
        {pdfOpen && (
          <>
            <BillPdfPane bill={bill} />
            <div
              className="dr-resizer"
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize"
              onMouseDown={startDrag}
            />
          </>
        )}

        <div className="dr-main">
          <div className="dr-main-bar">
            <button className="btn ghost sm" onClick={togglePdf}>
              {pdfOpen ? "Hide bill PDF" : "Show bill PDF"}
            </button>
            <button
              className="btn primary sm dr-main-export"
              disabled={!allApproved}
              title={allApproved ? "Export a changes-in-context PDF" : "Approve every amendment first"}
              onClick={onExport}
            >
              Export PDF
            </button>
          </div>
          <ActComparator deltas={deltas} approvals={approvals} />
        </div>
      </div>
    </>
  );
}
