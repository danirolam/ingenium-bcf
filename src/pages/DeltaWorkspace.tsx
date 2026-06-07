import { useEffect, useState } from "react";
import type { Nav } from "../App";
import type { Bill } from "../types";
import { MomentumBadge } from "../components/badges";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
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

  if (!billId) return <BillChooser nav={nav} />;

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

function BillChooser({ nav }: { nav: Nav }) {
  const [bills, setBills] = useState<Bill[]>([]);
  useEffect(() => {
    const ac = new AbortController();
    api.bills.list(ac.signal).then(setBills).catch(() => {});
    return () => ac.abort();
  }, []);

  const candidates = bills.filter((b) => /\bamend/i.test(b.title)).slice(0, 24);

  return (
    <>
      <PageHeader
        title="Legal delta"
        sub="Choose a bill to review the changes it makes to existing law."
      />
      <div className="body">
        <div className="card" style={{ padding: "22px 24px" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>Pick a bill to review</h3>
          {candidates.length === 0 ? (
            <div className="rd-empty">Loading bills…</div>
          ) : (
            <div className="dr-pick">
              {candidates.map((b) => (
                <button key={b.id} className="dr-pick-item" onClick={() => nav.go("delta", { billId: b.id })}>
                  <span className="dr-pick-top">
                    <span className="tnum dr-pick-num">{b.billNumber}</span>
                    <MomentumBadge value={b.legislativeMomentum} />
                  </span>
                  <span className="dr-pick-title">{b.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
