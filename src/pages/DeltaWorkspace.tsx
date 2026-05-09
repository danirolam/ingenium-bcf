import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Scale,
  ShieldCheck,
} from "lucide-react";
import type { Nav } from "../App";
import { MomentumBadge, ReviewBadge } from "../components/badges";
import { ConfidenceMeter } from "../components/ConfidenceMeter";
import { DiffViewer } from "../components/DiffViewer";
import { LegislativeJourney } from "../components/LegislativeJourney";
import { PageHeader } from "../components/PageHeader";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from "../components/ui/alert-1";
import { GlowingButton } from "../components/ui/glowing-button";
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
    // Fallback: keep the demo anchored to the CPPA comparison instead of a
    // recently ingested unrelated bill that may not share the same base Act.
    api.lawVersions.list().then((all) => {
      const demoMatch = all.find((item) => item.sourceBillNumber === "C-27");
      if (demoMatch) setLv(demoMatch);
      else if (all.length > 0) setLv(all[0]);
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
            <button className="btn review-action" disabled={busy} onClick={flag}>
              <AlertTriangle size={16} strokeWidth={1.9} aria-hidden="true" />
              Needs review
            </button>
            <GlowingButton
              className="delta-approve"
              disabled={busy || lv.humanApproved}
              onClick={approve}
            >
              <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
              {lv.humanApproved ? "Approved" : "Approve updated law"}
            </GlowingButton>
          </>
        }
      />
      <div className="body delta-body">
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
                <div className="card-title-row">
                  <FileText size={16} strokeWidth={1.8} aria-hidden="true" />
                  <div className="card-title">Bill summary</div>
                </div>
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

              <div className="hr card-rule" />
              <div className="dw-journey-h">
                Legislative journey
              </div>
              <div className="dw-journey-wrap compact">
                <LegislativeJourney
                  momentum={lv.legislativeMomentum}
                  status={lv.sourceBillStatus}
                  effectiveDate={lv.effectiveDate}
                  comingIntoForceText={lv.comingIntoForceText}
                />
              </div>
            </div>

            <div className="card">
              <div className="card-h">
                <div className="card-title-row">
                  <Scale size={16} strokeWidth={1.8} aria-hidden="true" />
                  <div className="card-title">Legal delta</div>
                </div>
              </div>
              <div className="delta-card-body">
                <div className="delta-summary-text">{lv.deltaSummary}</div>
                <div className="delta-chip-row">
                  {lv.affectedSections.map((s) => (
                    <span key={s} className="badge outline">{s}</span>
                  ))}
                </div>
                <div className="delta-chip-row">
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
              <Alert variant="warning" appearance="light" className="dw-alert">
                <AlertIcon>
                  <AlertTriangle size={18} strokeWidth={2} aria-hidden="true" />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>Human review required</AlertTitle>
                  <AlertDescription>
                    {lv.humanReviewReason ?? "This delta needs lawyer verification before distribution."}
                  </AlertDescription>
                </AlertContent>
              </Alert>
            )}

            <div className="card">
              <button
                type="button"
                className="dw-tech-toggle"
                onClick={() => setTechOpen((v) => !v)}
                aria-expanded={techOpen}
              >
                <span className="card-title-row">
                  <ShieldCheck size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span>Technical details</span>
                </span>
                <span className={`dw-tech-caret ${techOpen ? "open" : ""}`}>
                  {techOpen ? "Collapse" : "Expand"}
                  <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                </span>
              </button>
              {techOpen && (
                <div className="dw-tech-body">
                  <ConfidenceMeter value={lv.confidence} label="Gemini extraction confidence" />
                  <div>
                    <div className="dw-detail-label">Detailed delta</div>
                    <div className="dw-detail-text">{lv.detailedDelta}</div>
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
