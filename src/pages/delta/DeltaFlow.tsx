import type { Bill, ProvisionDelta } from "../../types";
import { PageHeader } from "../../components/PageHeader";
import { DeltaPhaseNav, type DeltaPhase } from "../../components/delta/DeltaPhaseNav";
import { exportActPdf } from "../../lib/actExport";
import { DeltaApprove } from "./DeltaApprove";
import { DeltaExport } from "./DeltaExport";

// The focused two-phase flow (Review & approve → Export) for a grounded delta.
// A thin shell: header + phase nav + partial-result banner + the active phase.
// All delta state lives in DeltaWorkspace; this is presentational.
export function DeltaFlow({
  bill,
  deltas,
  cached,
  incomplete,
  refreshing,
  onRefresh,
  approvals,
  phase,
  onPhase,
}: {
  bill: Bill | null;
  deltas: ProvisionDelta[];
  cached: boolean;
  incomplete: "rate-limit" | "ai-error" | true | null;
  refreshing: boolean;
  onRefresh: () => void;
  approvals: { approved: Set<string>; set: (keys: string[], value: boolean) => void };
  phase: DeltaPhase;
  onPhase: (p: DeltaPhase) => void;
}) {
  const total = deltas.reduce((n, d) => n + (d.operations?.length ?? 0), 0);
  const done = approvals.approved.size;
  const allApproved = total > 0 && done >= total;

  // Export goes straight to the print dialog. One PDF per Act: a single-Act bill
  // prints immediately; multi-Act lands on per-Act buttons.
  const doExport = () => {
    if (!bill) return;
    if (deltas.length === 1) exportActPdf(deltas[0], bill.billNumber, bill.title);
    else onPhase("export");
  };

  const badge = cached
    ? "⚡ Cached"
    : deltas.some((d) => d.source === "ai" || d.source === "ai-assisted")
      ? "✨ AI-assisted"
      : "📄 From bill text";

  return (
    <div className="delta-flow">
      <PageHeader
        crumbs={["Workspace", "Legal delta", bill?.billNumber ?? "Bill"]}
        title={`Legal delta — ${bill?.billNumber ?? ""}`}
        sub={bill?.title}
        actions={
          <div className="pd-source">
            <span className="pd-source-badge">{badge}</span>
            <button className="btn ghost sm" disabled={refreshing} onClick={onRefresh}>
              {refreshing ? "Recomputing…" : "Recompute"}
            </button>
          </div>
        }
      />
      <DeltaPhaseNav
        phase={phase}
        onGo={(p) => (p === "export" ? doExport() : onPhase(p))}
        approved={{ done, total }}
        exportEnabled={allApproved}
      />
      {incomplete && (
        <div className="pd-incomplete" role="alert">
          <span className="pd-incomplete-icon">⚠</span>
          <span>
            {incomplete === "rate-limit"
              ? "Analysis incomplete — hit the AI rate limit. Showing what we have; "
              : "Analysis incomplete — an AI call failed. Showing what we have; "}
            re-run in a minute for the full delta.
          </span>
          <button className="btn ghost sm" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {phase === "approve" && (
        <DeltaApprove
          bill={bill}
          deltas={deltas}
          approved={approvals.approved}
          onSet={approvals.set}
          onExport={doExport}
        />
      )}
      {phase === "export" && (
        <DeltaExport bill={bill} deltas={deltas} allApproved={allApproved} onBack={() => onPhase("approve")} />
      )}
    </div>
  );
}
