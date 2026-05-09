import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  Mail,
  Save,
  Scale,
  Send,
  ShieldCheck,
} from "lucide-react";
import type { Nav } from "../App";
import {
  AffectedBadge,
  ReviewBadge,
} from "../components/badges";
import { ImpactScale } from "../components/ImpactScale";
import { PageHeader } from "../components/PageHeader";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from "../components/ui/alert-1";
import { api } from "../lib/api";
import type { Client, ClientImpactAnalysis, LawVersion } from "../types";

export function ClientImpactAnalysisPage({ nav }: { nav: Nav }) {
  const [analysis, setAnalysis] = useState<ClientImpactAnalysis | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [lv, setLv] = useState<LawVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    why: true,
    adaptations: true,
    review: true,
    evidence: false,
    email: false,
    source: false,
  });

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
  const toggleSection = (id: string) => {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));
  };

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
              <Mail size={16} strokeWidth={1.9} aria-hidden="true" />
              Email lawyer
            </button>
            <button
              className="btn primary"
              disabled={busy || analysis.saved}
              onClick={save}
            >
              <Save size={16} strokeWidth={1.9} aria-hidden="true" />
              {analysis.saved ? "Saved" : "Save analysis"}
            </button>
          </>
        }
      />
      <div className="body">
        <div className="card impact-summary-card">
          <div className="card-h">
            <div>
              <div className="card-title-row">
                <Scale size={16} strokeWidth={1.8} aria-hidden="true" />
                <div className="card-title" data-toc data-toc-depth="1" data-toc-title="Summary">
                  Summary
                </div>
              </div>
              <div className="card-sub">
                {client?.name ?? "-"} · {lv?.sourceBillNumber ?? "-"}
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
          <div className="cia-brief">
            <div className="cia-brief-label">Executive read</div>
            <p>{analysis.whyItAffectsClient}</p>
          </div>
        </div>

        <div className="two-pane">
          <div className="analysis-stack">
            <InsightSection
              id="why"
              open={openSections.why}
              onToggle={toggleSection}
              icon={<ShieldCheck size={16} strokeWidth={1.8} aria-hidden="true" />}
              title="Why it matters"
              summary={`${analysis.affectedClientAreas.length || 1} client area${analysis.affectedClientAreas.length === 1 ? "" : "s"} flagged`}
            >
              <div className="rich-text-card">
                <div>{analysis.whyItAffectsClient}</div>
                {analysis.affectedClientAreas.length > 0 && (
                  <div className="chip-row">
                    {analysis.affectedClientAreas.map((a) => (
                      <span key={a} className="badge outline">{a}</span>
                    ))}
                  </div>
                )}
              </div>
            </InsightSection>

            <InsightSection
              id="adaptations"
              open={openSections.adaptations}
              onToggle={toggleSection}
              icon={<Send size={16} strokeWidth={1.8} aria-hidden="true" />}
              title="Recommended adaptations"
              summary={`${totalRecs} action${totalRecs === 1 ? "" : "s"} proposed`}
            >
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
                    <div className="match-rationale match-rationale-spaced">
                      <b>Reason:</b> {r.reason}
                    </div>
                  </div>
                );
              })}
            </InsightSection>

            {analysis.relevantClientText.length > 0 && (
              <InsightSection
                id="evidence"
                open={openSections.evidence}
                onToggle={toggleSection}
                icon={<FileText size={16} strokeWidth={1.8} aria-hidden="true" />}
                title="Relevant client text"
                summary={`${analysis.relevantClientText.length} evidence excerpt${analysis.relevantClientText.length === 1 ? "" : "s"}`}
              >
                {analysis.relevantClientText.map((r, i) => (
                  <div className="rec" key={i}>
                    <div className="rec-h">
                      <span className="badge outline dim">{r.source}</span>
                    </div>
                    <div className="match-excerpt quoted-excerpt">
                      &quot;{r.excerpt}&quot;
                    </div>
                    <div className="match-rationale">
                      <b>Issue:</b> {r.issue}
                    </div>
                  </div>
                ))}
              </InsightSection>
            )}
          </div>

          <div className="analysis-stack">
            {analysis.humanReviewRequired && (
              <InsightSection
                id="review"
                open={openSections.review}
                onToggle={toggleSection}
                icon={<AlertTriangle size={16} strokeWidth={1.9} aria-hidden="true" />}
                title="Lawyer review"
                summary={`${analysis.lawyerVerificationQuestions.length} verification question${analysis.lawyerVerificationQuestions.length === 1 ? "" : "s"}`}
                tone="warning"
              >
                <Alert variant="warning" appearance="light" className="analysis-alert flat-alert">
                  <AlertIcon>
                    <AlertTriangle size={18} strokeWidth={2} aria-hidden="true" />
                  </AlertIcon>
                  <AlertContent>
                    <AlertTitle data-toc data-toc-depth="2">Review before sending</AlertTitle>
                    <AlertDescription>
                    <div>
                      {analysis.humanReviewReason ?? "This analysis needs lawyer verification before action."}
                    </div>
                    <ul className="review-question-list">
                      {analysis.lawyerVerificationQuestions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                    </AlertDescription>
                  </AlertContent>
                </Alert>
              </InsightSection>
            )}

            <InsightSection
              id="email"
              open={openSections.email}
              onToggle={toggleSection}
              icon={<Mail size={16} strokeWidth={1.8} aria-hidden="true" />}
              title="Email draft"
              summary={analysis.emailDraft.subject}
            >
              <div className="email-card-body">
                <div className="kv kv-compact kv-email">
                  <div className="k">Subject</div>
                  <div className="v">{analysis.emailDraft.subject}</div>
                </div>
                <pre className="email-draft">
{analysis.emailDraft.body}
                </pre>
              </div>
            </InsightSection>

            <InsightSection
              id="source"
              open={openSections.source}
              onToggle={toggleSection}
              icon={<FileText size={16} strokeWidth={1.8} aria-hidden="true" />}
              title="Source law version"
              summary={`${lv?.sourceBillNumber ?? "Bill"} · ${lv?.affectedSections.join(", ") ?? "sections pending"}`}
            >
              <div className="kv kv-card">
                <div className="k">Bill</div>
                <div className="v">{lv?.sourceBillNumber} — {lv?.sourceBillTitle}</div>
                <div className="k">Status</div>
                <div className="v">{lv?.sourceBillStatus}</div>
                <div className="k">Sections</div>
                <div className="v">{lv?.affectedSections.join(", ")}</div>
              </div>
            </InsightSection>
          </div>
        </div>
      </div>
    </>
  );
}

function InsightSection({
  id,
  open,
  onToggle,
  icon,
  title,
  summary,
  tone,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: (id: string) => void;
  icon: React.ReactNode;
  title: string;
  summary?: React.ReactNode;
  tone?: "warning";
  children: React.ReactNode;
}) {
  return (
    <section className={`card cia-fold ${tone ? `cia-fold-${tone}` : ""}`}>
      <button
        type="button"
        className="cia-fold-trigger"
        onClick={() => onToggle(id)}
        aria-expanded={open}
      >
        <span className="card-title-row">
          {icon}
          <span className="card-title" data-toc data-toc-depth="2">{title}</span>
        </span>
        <span className="cia-fold-meta">
          {summary && <span className="cia-fold-summary">{summary}</span>}
          <ChevronDown className={open ? "open" : ""} size={15} strokeWidth={2} aria-hidden="true" />
        </span>
      </button>
      {open && <div className="cia-fold-body">{children}</div>}
    </section>
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
      <div className="summary-cell-label">
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}
