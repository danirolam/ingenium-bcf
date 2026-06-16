import { useEffect, useState } from "react";
import type { Nav } from "../App";
import { DeltaLibrary } from "../components/DeltaLibrary";
import { useApprovals } from "../lib/useApprovals";
import { useProvisionDelta } from "../lib/useProvisionDelta";
import { DeltaReview } from "./delta/DeltaReview";

// Orchestrator: resolve a bill, own its delta + approvals (the two data hooks),
// and render the full-height review. No bill → the Delta Library (browse every
// generated delta). The slim top bar carries the always-present Recompute and
// overall progress (both derived).
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
          {delta.refreshing && (
            <span className="dr-ai-chip" title="The AI is re-resolving this bill's amendments against the Act">
              <span className="dr-ai-dots" aria-hidden="true"><i /><i /><i /></span>
              computing with AI…
            </span>
          )}
          {delta.rateLimited > 0 && (
            <span
              className="dr-topbar-rl"
              title={`The AI hit its rate limit ${delta.rateLimited}× and automatically backed off + retried`}
            >
              ⏳ rate-limited ×{delta.rateLimited}
            </span>
          )}
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
        <DeltaLoading />
      ) : delta.deltas.length === 0 ? (
        <div className="dr-state">
          <p>
            No grounded delta for {delta.bill?.billNumber ?? "this bill"} — it creates a new Act,
            amends one we don’t track, or has no ingested text.
          </p>
          {delta.errors[0] && <p className="dr-state-err">{delta.errors[0]}</p>}
          {delta.failures.length > 0 && (
            <p className="dr-state-err">
              {delta.failures.length} amendment{delta.failures.length === 1 ? "" : "s"} couldn’t be
              located — verify against the bill PDF.
            </p>
          )}
        </div>
      ) : (
        <DeltaReview
          bill={delta.bill}
          deltas={delta.deltas}
          failures={delta.failures}
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

// First-load state: an animated "AI is working" indicator + a live elapsed timer,
// so a long run (the AI navigating the Act, backing off through rate limits) reads
// as "working", not "stuck".
function DeltaLoading() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="dr-state">
      <div className="dr-ai-working">
        <span className="dr-ai-dots" aria-hidden="true"><i /><i /><i /></span>
        <span>Resolving each amendment against the Act with AI… <b>{secs}s</b></span>
      </div>
      <p className="dr-state-sub">
        The AI reads the Act, locates every amendment by its citation path, and verifies each
        placement. Under heavy load it backs off and retries through rate limits, which can add time.
      </p>
    </div>
  );
}
