import type { Bill, ProvisionDelta } from "../../types";
import { exportActPdf } from "../../lib/actExport";

function actName(t: string): string {
  return t.replace(/\s*\([^)]*\)\s*$/, "");
}

// Multi-Act export landing (single-Act bills print straight from the Approve
// bar). No preview — each button goes directly to the print dialog, one PDF
// per amended Act.
export function DeltaExport({
  bill,
  deltas,
  allApproved,
  onBack,
}: {
  bill: Bill | null;
  deltas: ProvisionDelta[];
  allApproved: boolean;
  onBack: () => void;
}) {
  if (!allApproved) {
    return (
      <div className="body">
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div className="rd-empty">Approve every placement before exporting the amended Act.</div>
          <button className="btn primary sm" style={{ marginTop: 14 }} onClick={onBack}>
            ← Back to approvals
          </button>
        </div>
      </div>
    );
  }

  const exportOne = (d: ProvisionDelta) => {
    const ok = exportActPdf(d, bill?.billNumber ?? "", bill?.title ?? "");
    if (!ok) alert("Allow pop-ups for this site to export the PDF.");
  };

  return (
    <div className="dex">
      {deltas.map((d) => (
        <div className="dex-row" key={d.slug}>
          <div>
            <b>{actName(d.title)}</b> <span className="pd-cite">{d.citation}</span>
            <div className="dex-sub">
              as amended by {bill?.billNumber ?? "the bill"} · +{d.summary.added} ~{d.summary.changed} −
              {d.summary.repealed}
            </div>
          </div>
          <button className="btn primary" onClick={() => exportOne(d)}>
            Export PDF ⤓
          </button>
        </div>
      ))}
    </div>
  );
}
