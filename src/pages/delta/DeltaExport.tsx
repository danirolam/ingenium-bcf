import type { Bill, ProvisionDelta } from "../../types";
import { ProvBlock } from "../../components/ProvisionDeltaView";
import { exportActPdf } from "../../lib/actExport";

function actName(t: string): string {
  return t.replace(/\s*\([^)]*\)\s*$/, "");
}

// Phase 3 — gated on full approval. One branded PDF per amended Act; a faded
// preview of the updated Act (amended provisions highlighted) sits above each
// export button.
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

  return (
    <div className="dex">
      {deltas.map((d) => {
        const after = (d.rows ?? []).filter((r) => r.status !== "repealed");
        return (
          <div className="dex-card" key={d.slug}>
            <div className="dex-card-h">
              <div>
                <b>{actName(d.title)}</b> <span className="pd-cite">{d.citation}</span>
                <div className="dex-sub">
                  as amended by {bill?.billNumber ?? "the bill"} · +{d.summary.added} ~{d.summary.changed} −
                  {d.summary.repealed}
                </div>
              </div>
              <button
                className="btn primary sm"
                onClick={() => {
                  const ok = exportActPdf(d, bill?.billNumber ?? "", bill?.title ?? "");
                  if (!ok) alert("Allow pop-ups for this site to export the PDF.");
                }}
              >
                Export PDF ⤓
              </button>
            </div>
            <div className="dex-preview">
              {after.slice(0, 8).map((r, i) => (
                <ProvBlock
                  key={i}
                  prov={(r.after ?? r.before)!}
                  variant={r.status === "added" || r.status === "changed" ? "changed" : "plain"}
                />
              ))}
            </div>
            {after.length > 8 && (
              <div className="dex-more">+{after.length - 8} more provisions in the exported PDF</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
