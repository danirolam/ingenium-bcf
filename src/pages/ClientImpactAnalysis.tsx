import { useEffect, useState } from "react";
import type { Nav } from "../App";
import {
  AffectedBadge,
  ReviewBadge,
} from "../components/badges";
import { ImpactScale } from "../components/ImpactScale";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import type { Client, ClientImpactAnalysis, LawVersion } from "../types";

export function ClientImpactAnalysisPage({ nav }: { nav: Nav }) {
  const [analysis, setAnalysis] = useState<ClientImpactAnalysis | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [lv, setLv] = useState<LawVersion | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = nav.params.id;
    if (!id) return;
    api.clientImpact.get(id).then(async (a) => {
      setAnalysis(a);
      const [c, l] = await Promise.all([
        api.clients.get(a.clientId).catch(() => null),
        api.lawVersions.get(a.lawVersionId).catch(() => null),
      ]);
      setClient(c);
      setLv(l);
    });
  }, [nav.params.id]);

  if (!analysis) {
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Client Impact Analysis"]}
          title="Client Impact Analysis"
          sub="Run an analysis from the Client-Law Scanner to see results here."
        />
        <div className="body">
          <div className="rd-empty">
            No analysis loaded. Open the Client-Law Scanner and click <b>Analyze
            client impact</b>.
          </div>
        </div>
      </>
    );
  }

  async function save() {
    if (!analysis) return;
    setBusy(true);
    try {
      const updated = await api.clientImpact.save(analysis.id);
      setAnalysis(updated);
      nav.toast("Analysis saved to matter history.");
    } finally {
      setBusy(false);
    }
  }

  async function emailLawyer() {
    if (!analysis) return;
    setBusy(true);
    try {
      const { email } = await api.clientImpact.emailLawyer(analysis.id);
      nav.toast(email.simulated ? "Email simulated." : "Email sent to lawyer.");
    } finally {
      setBusy(false);
    }
  }

  const totalRecs = analysis.requiredAdaptations.length;
  const totalRecsPad = String(totalRecs).padStart(2, "0");

  return (
    <>
      <PageHeader
        crumbs={[
          "Workspace",
          "Client Impact Analysis",
          client?.name ?? "Analysis",
        ]}
        title={`Client Impact — ${client?.name ?? "…"}`}
        sub={
          lv
            ? `Updated law from ${lv.sourceBillNumber} — ${lv.sourceBillTitle}.`
            : undefined
        }
        actions={
          <>
            <button className="btn" disabled={busy} onClick={emailLawyer}>
              Email lawyer
            </button>
            <button
              className="btn primary"
              disabled={busy || analysis.saved}
              onClick={save}
            >
              {analysis.saved ? "Saved ✓" : "Save analysis"}
            </button>
          </>
        }
      />
      <div className="body">
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h">
            <div>
              <div className="card-title" data-toc data-toc-depth="1" data-toc-title="Summary">
                Summary
              </div>
              <div className="card-sub">
                {client?.name ?? "—"} · {lv?.sourceBillNumber ?? "—"}
              </div>
            </div>
            <ReviewBadge required={analysis.humanReviewRequired} />
          </div>
          <div className="cia-summary-top">
            <SummaryCell
              label="Affected"
              value={<AffectedBadge value={analysis.affected} />}
            />
            <SummaryCell
              label="Timing"
              value={<div className="cia-timing">{analysis.timing}</div>}
            />
          </div>
          <div className="cia-summary-scale">
            <ImpactScale
              level={analysis.impactLevel}
              urgency={analysis.urgency}
            />
          </div>
        </div>

        <div className="two-pane">
          <div className="right-panel" style={{ gap: 18 }}>
            <div className="card">
              <div className="card-h"><div className="card-title" data-toc data-toc-depth="2">Why it matters</div></div>
              <div style={{ padding: "14px 18px 18px", fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
                <div>{analysis.whyItAffectsClient}</div>
                {analysis.affectedClientAreas.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                    {analysis.affectedClientAreas.map((a) => (
                      <span key={a} className="badge outline">{a}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-h"><div className="card-title" data-toc data-toc-depth="2">Recommended adaptations</div></div>
              {analysis.requiredAdaptations.map((r, i) => {
                const num = String(i + 1).padStart(2, "0");
                return (
                  <div className="rec" key={i}>
                    <div className="cia-rec-num">
                      {num} / {totalRecsPad}
                    </div>
                    <div className="rec-h">
                      <div className="rec-title">{r.area}</div>
                    </div>
                    <div className="rec-detail"><b>Current issue:</b> {r.currentIssue}</div>
                    <div className="rec-detail"><b>Recommended action:</b> {r.recommendation}</div>
                    <div className="match-rationale" style={{ marginTop: 8 }}>
                      <b style={{ color: "var(--ink-2)" }}>Reason:</b> {r.reason}
                    </div>
                  </div>
                );
              })}
            </div>

            {analysis.relevantClientText.length > 0 && (
              <div className="card">
                <div className="card-h"><div className="card-title" data-toc data-toc-depth="2">Relevant client text</div></div>
                {analysis.relevantClientText.map((r, i) => (
                  <div className="rec" key={i}>
                    <div className="rec-h">
                      <span className="badge outline dim">{r.source}</span>
                    </div>
                    <div
                      className="match-excerpt"
                      style={{ fontStyle: "italic" }}
                    >
                      "{r.excerpt}"
                    </div>
                    <div className="match-rationale">
                      <b style={{ color: "var(--ink-2)" }}>Issue:</b> {r.issue}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="right-panel">
            {analysis.humanReviewRequired && (
              <div className="card" style={{ borderColor: "#e3c884" }}>
                <div className="card-h" style={{ background: "var(--high-bg)" }}>
                  <div className="card-title" data-toc data-toc-depth="2" style={{ color: "var(--high)" }}>Lawyer review</div>
                </div>
                <div style={{ padding: "12px 16px 16px" }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 10, lineHeight: 1.5 }}>
                    {analysis.humanReviewReason ?? "This analysis needs lawyer verification before action."}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
                    {analysis.lawyerVerificationQuestions.map((q, i) => (
                      <li key={i} style={{ marginBottom: 6 }}>{q}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-h"><div className="card-title" data-toc data-toc-depth="2">Email draft</div></div>
              <div style={{ padding: "12px 16px 16px" }}>
                <div className="kv" style={{ padding: 0, marginBottom: 10 }}>
                  <div className="k">Subject</div>
                  <div className="v">{analysis.emailDraft.subject}</div>
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--serif)", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6, margin: 0 }}>
{analysis.emailDraft.body}
                </pre>
              </div>
            </div>

            <div className="card">
              <div className="card-h"><div className="card-title" data-toc data-toc-depth="2">Source law version</div></div>
              <div className="kv" style={{ padding: "14px 16px" }}>
                <div className="k">Bill</div>
                <div className="v">{lv?.sourceBillNumber} — {lv?.sourceBillTitle}</div>
                <div className="k">Status</div>
                <div className="v">{lv?.sourceBillStatus}</div>
                <div className="k">Sections</div>
                <div className="v">{lv?.affectedSections.join(", ")}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryCell({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}
