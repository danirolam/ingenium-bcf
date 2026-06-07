import type { ProvisionDelta } from "../../types";
import type { ApprovalsState } from "../../lib/useApprovals";
import { AmendmentCard } from "./AmendmentCard";

// One amended Act: header (title, citation, change summary, per-Act progress)
// plus its amendment cards. The per-Act Export button is gated on every amendment
// in this Act being approved. One delta = one Act, so grouping is free.
export function ActGroup({
  delta,
  approvals,
  expand,
  onToggle,
  onApprove,
  onApproveAll,
  onExport,
}: {
  delta: ProvisionDelta;
  approvals: ApprovalsState;
  expand: Record<string, boolean>;
  onToggle: (key: string) => void;
  onApprove: (key: string, approved: boolean) => void;
  onApproveAll: (delta: ProvisionDelta) => void;
  onExport: (delta: ProvisionDelta) => void;
}) {
  const ops = delta.operations;
  const total = ops.length;
  const approvedCount = ops.reduce((n, op) => n + (approvals.isApproved(op.key) ? 1 : 0), 0);
  const allApproved = total > 0 && approvedCount === total;
  const { added, changed, repealed } = delta.summary;

  return (
    <section className="dr-act">
      <header className="dr-act-head">
        <div className="dr-act-id">
          <h3 className="dr-act-title">{delta.title}</h3>
          <span className="dr-act-cite">{delta.citation}</span>
        </div>
        <div className="dr-act-summary" aria-label="change summary">
          {added > 0 && <span className="dr-sum is-added">+{added}</span>}
          {changed > 0 && <span className="dr-sum is-changed">~{changed}</span>}
          {repealed > 0 && <span className="dr-sum is-repealed">−{repealed}</span>}
        </div>
        <div className="dr-act-actions">
          <span className="dr-progress">
            {approvedCount}/{total} approved
          </span>
          {!allApproved && total > 0 && (
            <button className="btn ghost sm" onClick={() => onApproveAll(delta)}>
              Approve all
            </button>
          )}
          <button
            className="btn primary sm"
            disabled={!allApproved}
            title={allApproved ? "Export the amended Act as a PDF" : "Approve every amendment first"}
            onClick={() => onExport(delta)}
          >
            Export PDF
          </button>
        </div>
      </header>

      <div className="dr-act-cards">
        {ops.map((op) => {
          const approved = approvals.isApproved(op.key);
          const open = expand[op.key] ?? !approved;
          return (
            <AmendmentCard
              key={op.key}
              delta={delta}
              op={op}
              approved={approved}
              open={open}
              onToggle={() => onToggle(op.key)}
              onApprove={(v) => onApprove(op.key, v)}
            />
          );
        })}
      </div>
    </section>
  );
}
