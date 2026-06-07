import { useState } from "react";
import type { Bill, ProvisionDelta } from "../../types";
import type { ApprovalsState } from "../../lib/useApprovals";
import { BillPdfPane } from "../../components/delta/BillPdfPane";
import { ActGroup } from "../../components/delta/ActGroup";
import { exportActAsPdf } from "../../lib/actExport";

// The review surface: bill PDF left, scrollable Act-grouped cards right. Owns the
// per-card expand override (local UI only); approval state and the delta are
// passed in. A card's open state defaults to "expanded until approved"; approving
// (or approve-all) clears the override so it collapses, while clicking the header
// sets an explicit override.
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
  const [expand, setExpand] = useState<Record<string, boolean>>({});

  const toggle = (key: string) =>
    setExpand((p) => ({ ...p, [key]: !(p[key] ?? !approvals.isApproved(key)) }));

  const clearOverrides = (keys: string[]) =>
    setExpand((p) => {
      let touched = false;
      const next = { ...p };
      for (const k of keys) if (k in next) { delete next[k]; touched = true; }
      return touched ? next : p;
    });

  const approve = (key: string, value: boolean) => {
    approvals.setApproved([key], value);
    clearOverrides([key]); // fall back to default (collapse on approve, expand on undo)
  };

  const approveAll = (delta: ProvisionDelta) => {
    const keys = delta.operations.map((o) => o.key);
    approvals.setApproved(keys, true);
    clearOverrides(keys);
  };

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
        <div className="dr-list">
          {deltas.map((delta) => (
            <ActGroup
              key={delta.slug}
              delta={delta}
              approvals={approvals}
              expand={expand}
              onToggle={toggle}
              onApprove={approve}
              onApproveAll={approveAll}
              onExport={onExport}
            />
          ))}
        </div>
      </div>
    </>
  );
}
