import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { AmendmentFailure, Bill, BillAmendmentOp, ProvisionDelta } from "../../types";
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
  failures,
  approvals,
  incomplete,
  incompleteReason,
  refreshing,
  onRecompute,
  toast,
}: {
  bill: Bill | null;
  deltas: ProvisionDelta[];
  failures: AmendmentFailure[];
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
  const [showFails, setShowFails] = useState(false);
  // Acts already exported this session — the chip dims to "done" but stays clickable.
  const [exported, setExported] = useState<Set<string>>(new Set());
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

  // A fresh delta resets the export tray (recompute clears approvals anyway).
  useEffect(() => { setExported(new Set()); }, [deltas]);

  const cur = items[at];
  if (!cur) return null;

  const approved = approvals.isApproved(cur.op.key);
  // Bill-wide progress for the header (every amendment across every Act).
  const billApproved = items.reduce((n, it) => n + (approvals.isApproved(it.op.key) ? 1 : 0), 0);
  // An Act becomes exportable once every one of its amendments is approved; each
  // ready Act gets its own chip in the export tray, exported on a single click
  // (so the browser never blocks it as a duplicate pop-up).
  const actReady = (d: ProvisionDelta) =>
    d.operations.length > 0 && d.operations.every((o) => approvals.isApproved(o.key));
  const readyActs = deltas.filter(actReady);

  const exportOne = (d: ProvisionDelta) => {
    if (exportActAsPdf(d, bill)) setExported((s) => new Set(s).add(d.slug));
    else toast("Allow pop-ups to export the PDF.");
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
      {failures.length > 0 && (
        <div className="dr-fails">
          <button className="dr-fails-bar" onClick={() => setShowFails((v) => !v)} aria-expanded={showFails}>
            <span className="dr-fails-ic">⚠</span>
            <span>
              {failures.length} amendment{failures.length === 1 ? "" : "s"} couldn’t be located — verify against the bill PDF
            </span>
            <span className="dr-fails-chev">{showFails ? "▾" : "▸"}</span>
          </button>
          {showFails && (
            <ul className="dr-fails-list">
              {failures.map((f, i) => (
                <li key={i}>
                  <span className="dr-fails-clause">cl {f.clause}</span>
                  <span className="dr-fails-instr">{f.instruction}</span>
                  <span className="dr-fails-reason">{f.reason}</span>
                </li>
              ))}
            </ul>
          )}
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
            <div className="dr-pager-left">
              <div className="dr-nav-group">
                <button className="dr-nav" onClick={() => go(-1)} disabled={at <= 0} title="Previous (←)">←</button>
                <button className="dr-nav" onClick={() => go(1)} disabled={at >= items.length - 1} title="Next (→)">→</button>
              </div>
              <span className="dr-pager-count">
                Amendment <b>{at + 1}</b> of {items.length}
              </span>
            </div>

            <div className="dr-pager-title">
              {cur.delta.title}
              {cur.delta.outdated && (
                <span className="dr-outdated" title="This Act's text predates the current format. Re-ingest pending.">
                  ⚠ outdated
                </span>
              )}
            </div>

            <div className="dr-pager-right">
              <span className="dr-pager-approved">
                <b>{billApproved}</b>/{items.length} approved
              </span>
              {cur.delta.actUrl && (
                <a className="dr-pager-actpdf" href={cur.delta.actUrl} target="_blank" rel="noreferrer" title="Official Act PDF (Justice Laws)">
                  official PDF ↗
                </a>
              )}
            </div>
          </div>

          {readyActs.length > 0 && (
            <div className="dr-export-tray">
              <span className="dr-export-tray-label">Export</span>
              {readyActs.map((d) => {
                const done = exported.has(d.slug);
                return (
                  <button
                    key={d.slug}
                    className={`dr-export-chip${done ? " is-done" : ""}`}
                    title={done ? `Re-export ${d.title}` : `Export ${d.title} as a PDF`}
                    onClick={() => exportOne(d)}
                  >
                    <span className="dr-export-chip-ic" aria-hidden="true">{done ? "✓" : "⬇"}</span>
                    {d.title}
                  </button>
                );
              })}
            </div>
          )}

          <div className="dr-pager-body">
            <AmendmentCard
              key={cur.op.key}
              delta={cur.delta}
              op={cur.op}
              approved={approved}
              onApprove={(v) => {
                approvals.setApproved([cur.op.key], v);
                if (v) go(1); // approving advances to the next amendment
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
