import { useState } from "react";
import { DiffViewer } from "./DiffViewer";
import { PageHeader } from "./PageHeader";
import type { Bill, ProvisionDelta } from "../types";

// Where this delta came from: cache, deterministic bill-XML parse, or AI-assisted.
function sourceBadge(cached: boolean, deltas: ProvisionDelta[]): { label: string; cls: string } {
  if (cached) return { label: "⚡ Cached", cls: "is-cached" };
  const usedAi = deltas.some((d) => d.source === "ai" || d.source === "ai-assisted");
  return usedAi
    ? { label: "✨ AI-assisted", cls: "is-ai" }
    : { label: "📄 From bill text", cls: "is-parsed" };
}

function actDisplayName(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "");
}

// The bill itself — its official PDF, proxied through our backend so it embeds.
function BillColumn({ bill }: { bill: Bill | null }) {
  if (!bill) return null;
  return (
    <aside className="pd-bill-col">
      <div className="pd-bill-head">
        <span>{bill.billNumber} — official bill</span>
        {bill.sourceUrl && (
          <a href={bill.sourceUrl} target="_blank" rel="noreferrer" className="pd-bill-ext">
            parl.ca ↗
          </a>
        )}
      </div>
      <iframe
        className="pd-bill-pdf"
        src={`/api/bills/${bill.id}/pdf`}
        title={`${bill.billNumber} PDF`}
      />
    </aside>
  );
}

export function ProvisionDeltaView({
  bill,
  deltas,
  cached = false,
  refreshing = false,
  onRefresh,
}: {
  bill: Bill | null;
  deltas: ProvisionDelta[];
  cached?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const [showBill, setShowBill] = useState(false);
  const badge = sourceBadge(cached, deltas);

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Legal delta", bill?.billNumber ?? "Bill"]}
        title={`Legal delta — ${bill?.billNumber ?? ""}`}
        sub={bill?.title}
        actions={
          <div className="pd-source">
            <span className={`pd-source-badge ${badge.cls}`}>{badge.label}</span>
            <button className="btn ghost sm" onClick={() => setShowBill((v) => !v)}>
              {showBill ? "Hide bill" : "Show bill"}
            </button>
            {onRefresh && (
              <button className="btn ghost sm" disabled={refreshing} onClick={onRefresh}>
                {refreshing ? "Recomputing…" : "Recompute"}
              </button>
            )}
          </div>
        }
      />
      <div className={`body pd-layout ${showBill ? "with-bill" : ""}`}>
        <div className="pd-main">
          {deltas.map((d) => {
            const unverified = d.operations.filter((o) => !o.anchorFound);
            return (
              <div className="card pd-act" key={d.slug}>
                <div className="pd-act-head">
                  <div className="pd-act-title">
                    <b>{actDisplayName(d.title)}</b> <span className="pd-cite">{d.citation}</span>
                  </div>
                  <div className="pd-counts">
                    <span className="add">+{d.summary.added}</span>
                    <span className="chg">~{d.summary.changed}</span>
                    <span className="del">−{d.summary.repealed}</span>
                  </div>
                </div>

                {unverified.length > 0 && (
                  <div className="pd-warn">
                    {unverified.length} amendment{unverified.length === 1 ? "" : "s"} referenced a
                    provision not found in the current Act — counsel review needed.
                  </div>
                )}

                {d.oldText && d.newText ? (
                  <DiffViewer
                    actName={actDisplayName(d.title)}
                    actCitation={d.citation}
                    oldText={d.oldText}
                    newText={d.newText}
                    versionALabel={`Current — ${actDisplayName(d.title)}`}
                    versionBLabel={`Proposed by ${bill?.billNumber ?? "the bill"}`}
                  />
                ) : (
                  <div className="pd-empty">No diff text available for this Act.</div>
                )}
              </div>
            );
          })}
        </div>

        {showBill && <BillColumn bill={bill} />}
      </div>
    </>
  );
}
