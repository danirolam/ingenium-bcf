import type { Nav } from "../App";
import { DeltaLibrary } from "../components/DeltaLibrary";
import { useApprovals } from "../lib/useApprovals";
import { useProvisionDelta } from "../lib/useProvisionDelta";
import { DeltaReview } from "./delta/DeltaReview";

// Orchestrator: resolve a bill, own its delta + approvals (the two data hooks),
// and render the full-height review. No bill → a chooser. The slim top bar carries
// the always-present Recompute and overall progress (both derived).
export function DeltaWorkspace({ nav }: { nav: Nav }) {
  const billId = nav.params.billId ?? null;
  const delta = useProvisionDelta(billId);
  const approvals = useApprovals(billId);

  if (!billId) return <DeltaLibrary nav={nav} />;

  const allOps = delta.deltas.flatMap((d) => d.operations);
  const total = allOps.length;
  const done = allOps.reduce((n, op) => n + (approvals.isApproved(op.key) ? 1 : 0), 0);

  return (
    <div className="dr-page">
      <div className="dr-topbar">
        <button className="dr-topbar-back" onClick={() => nav.go("delta")} title="Choose another bill">
          ←
        </button>
        <div className="dr-topbar-id">
          <span className="dr-topbar-num tnum">{delta.bill?.billNumber ?? "Bill"}</span>
          <span className="dr-topbar-title">{delta.bill?.title ?? "Legal delta"}</span>
        </div>
        <div className="dr-topbar-actions">
          {total > 0 && (
            <span className="dr-topbar-progress">
              <b>{done}</b>/{total} approved
            </span>
          )}
          <button
            className="btn ghost sm"
            onClick={delta.recompute}
            disabled={delta.refreshing || delta.loading}
          >
            {delta.refreshing ? "Recomputing…" : "Recompute"}
          </button>
        </div>
      </div>

      {delta.loading ? (
        <div className="dr-state">Interpreting the bill against the Act…</div>
      ) : delta.deltas.length === 0 ? (
        <div className="dr-state">
          <p>
            No grounded delta for {delta.bill?.billNumber ?? "this bill"} — it creates a new Act,
            amends one we don’t track, or has no ingested text.
          </p>
          {delta.errors[0] && <p className="dr-state-err">{delta.errors[0]}</p>}
        </div>
      ) : (
        <DeltaReview
          bill={delta.bill}
          deltas={delta.deltas}
          approvals={approvals}
          incomplete={delta.incomplete}
          incompleteReason={delta.incompleteReason}
          refreshing={delta.refreshing}
          onRecompute={delta.recompute}
          toast={nav.toast}
        />
      )}
    </div>
  );
}
