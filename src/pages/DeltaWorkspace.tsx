import { useEffect, useState } from "react";
import type { Nav } from "../App";
import { MomentumBadge, ReviewBadge } from "../components/badges";
import { ConfidenceMeter } from "../components/ConfidenceMeter";
import { DiffViewer } from "../components/DiffViewer";
import { LegislativeJourney } from "../components/LegislativeJourney";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import type { LawVersion } from "../types";

export function DeltaWorkspace({ nav }: { nav: Nav }) {
  const [lv, setLv] = useState<LawVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [techOpen, setTechOpen] = useState(false);

  useEffect(() => {
    const id = nav.params.lawVersionId;
    if (id) {
      api.lawVersions.get(id).then(setLv).catch(console.error);
      return;
    }
    // Fallback: pick the most recent law version.
    api.lawVersions.list().then((all) => {
      if (all.length > 0) setLv(all[0]);
    });
  }, [nav.params.lawVersionId]);

  if (!lv) {
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Delta Workspace"]}
          title="Delta Workspace"
          sub="Open a bill from Bill Monitor to start reviewing the proposed legal delta."
        />
        <div className="body">
          <div className="rd-empty">No law version selected. Go to Bill Monitor and click Open Delta on a bill.</div>
        </div>
      </>
    );
  }

  async function approve() {
    if (!lv) return;
    setBusy(true);
    try {
      const updated = await api.lawVersions.approve(lv.id);
      setLv(updated);
      nav.toast("Updated law approved.");
    } finally {
      setBusy(false);
    }
  }

  async function flag() {
    if (!lv) return;
    setBusy(true);
    try {
      const updated = await api.lawVersions.needsReview(
        lv.id,
        "Flagged for manual review by counsel.",
      );
      setLv(updated);
      nav.toast("Flagged for manual review.");
    } finally {
      setBusy(false);
    }
  }

  const confidencePct = Math.round(lv.confidence * 100);

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Delta Workspace", lv.sourceBillNumber]}
        title={`Delta Workspace — ${lv.sourceBillNumber}`}
        sub="Compare statutory text before and after the proposed amendment. Approve before distributing to client matters."
        actions={
          <>
            <button className="btn" disabled={busy} onClick={flag}>
              Needs manual review
            </button>
            <button
              className="btn primary"
              disabled={busy || lv.humanApproved}
              onClick={approve}
            >
              {lv.humanApproved ? "Approved ✓" : "Approve updated law"}
            </button>
          </>
        }
      />
      <div className="body">
        <div className="delta-grid">
          <DiffViewer
            actName={lv.baseLawTitle.replace(/\s*\(.*\)\s*$/, "")}
            actCitation={`${lv.affectedSections.join(", ") || lv.baseLawTitle} · sourced from ${lv.sourceBillNumber}`}
            oldText={lv.oldText}
            newText={lv.updatedText}
            versionALabel={`Current — ${lv.baseLawTitle}`}
            versionBLabel={`Proposed by ${lv.sourceBillNumber}`}
          />

          <div className="right-panel">
            <div className="card">
              <div className="card-h">
                <div className="card-title">Bill summary</div>
                <ReviewBadge required={lv.humanReviewRequired} approved={lv.humanApproved} />
              </div>
              <div className="kv">
                <div className="k">Bill</div>
                <div className="v">{lv.sourceBillNumber} — {lv.sourceBillTitle}</div>
                <div className="k">Status</div>
                <div className="v">{lv.sourceBillStatus}</div>
                <div className="k">Momentum</div>
                <div className="v"><MomentumBadge value={lv.legislativeMomentum} /></div>
                <div className="k">Version</div>
                <div className="v">{lv.versionStatus.replace(/_/g, " ")}</div>
                <div className="k">Effective</div>
                <div className="v tnum">{lv.effectiveDate ?? "—"}</div>
                <div className="k">In force</div>
                <div className="v">{lv.comingIntoForceText ?? "—"}</div>
              </div>

              <div className="hr" style={{ margin: "0 16px" }} />
              <div className="dw-journey-h" style={{ paddingTop: 12 }}>
                Legislative journey
              </div>
              <div className="dw-journey-wrap" style={{ paddingTop: 0 }}>
                <LegislativeJourney
                  momentum={lv.legislativeMomentum}
                  status={lv.sourceBillStatus}
                  effectiveDate={lv.effectiveDate}
                  comingIntoForceText={lv.comingIntoForceText}
                />
              </div>
            </div>

            <div className="card">
              <div className="card-h"><div className="card-title">Legal delta</div></div>
              <div style={{ padding: "12px 16px 12px", fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>
                <div style={{ marginBottom: 10 }}>{lv.deltaSummary}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {lv.affectedSections.map((s) => (
                    <span key={s} className="badge outline">{s}</span>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {lv.changeTypes.map((t) => (
                    <span key={t} className="badge outline dim">{t}</span>
                  ))}
                </div>
              </div>
              <div className="dw-stable">
                Stable extraction · <span className="tnum">{confidencePct}%</span>
              </div>
            </div>

            {lv.humanReviewRequired && (
              <div className="card" style={{ borderColor: "#e3c884" }}>
                <div className="card-h" style={{ background: "var(--high-bg)" }}>
                  <div className="card-title" style={{ color: "var(--high)" }}>Human review required</div>
                </div>
                <div className="note" style={{ margin: 0, borderLeft: 0, background: "var(--high-bg)", color: "var(--high)" }}>
                  {lv.humanReviewReason ?? "This delta needs lawyer verification before distribution."}
                </div>
              </div>
            )}

            <div className="card" style={{ padding: 0 }}>
              <button
                type="button"
                className="dw-tech-toggle"
                onClick={() => setTechOpen((v) => !v)}
                aria-expanded={techOpen}
              >
                <span>Technical details</span>
                <span className="dw-tech-caret">
                  {techOpen ? "Collapse" : "Expand"}
                </span>
              </button>
              {techOpen && (
                <div className="dw-tech-body">
                  <ConfidenceMeter value={lv.confidence} label="Gemini extraction confidence" />
                  <div>
                    <div className="k" style={{ fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Detailed delta</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{lv.detailedDelta}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
