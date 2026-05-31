import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faEnvelope,
  faFileArrowDown,
  faFileLines,
  faFloppyDisk,
  faPaperPlane,
  faScaleBalanced,
  faShieldHalved,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
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
import { downloadDoc, esc } from "../lib/export";
import type { Bill, Client, ClientImpactAnalysis } from "../types";

export function ClientImpactAnalysisPage({ nav }: { nav: Nav }) {
  const [analysis, setAnalysis] = useState<ClientImpactAnalysis | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    why: true,
    adaptations: true,
    review: true,
    evidence: false,
    email: false,
    source: false,
  });

  const { clientId, billId } = nav.params;

  useEffect(() => {
    if (!clientId || !billId) return;
    let cancelled = false;
    (async () => {
      const [c, b, a] = await Promise.all([
        api.clients.get(clientId).catch(() => null),
        api.bills.get(billId).catch(() => null),
        api.clientImpact.byPair(clientId, billId).catch(() => null),
      ]);
      if (cancelled) return;
      setClient(c);
      setBill(b);
      setAnalysis(a);
    })().catch((err) => {
      console.error(err);
      nav.toast(`Could not load brief: ${err.message ?? err}`);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, billId]);

  // Acts the bill touches — used in place of the old law-version's baseLawTitle.
  const affectedActs = useMemo(() => {
    if (!bill) return [] as string[];
    const acts = new Set<string>();
    for (const clause of bill.clauses ?? []) {
      for (const act of clause.targetActs ?? []) {
        if (act?.trim()) acts.add(act.trim());
      }
    }
    if (bill.statuteCitation?.trim()) acts.add(bill.statuteCitation.trim());
    return [...acts];
  }, [bill]);

  async function generate() {
    if (!clientId || !billId) return;
    setBusy(true);
    try {
      const { analysis: a, email } = await api.clientImpact.analyze(
        clientId,
        billId,
      );
      setAnalysis(a);
      nav.toast(
        email.simulated
          ? "Brief generated · Email simulated."
          : "Brief generated · Email sent.",
      );
    } catch (err: any) {
      nav.toast(`Could not generate brief: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  if (!analysis) {
    // A client+bill pair is addressed but no brief exists yet → offer to generate
    // it here, so the URL is directly actionable. No pair → point back to scan.
    const hasPair = Boolean(clientId && billId);
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Client Brief"]}
          title="Client Brief"
          sub={
            hasPair
              ? `No brief yet for ${client?.name ?? "this client"} on ${bill?.billNumber ?? "this bill"}.`
              : "Pick a client and a bill in Client Scan to generate a brief."
          }
          actions={
            hasPair ? (
              <button className="btn primary" disabled={busy} onClick={generate}>
                {busy ? "Generating…" : "Generate brief"}
              </button>
            ) : undefined
          }
        />
        <div className="body">
          <div className="rd-empty">
            {hasPair ? (
              <>
                No brief has been generated for{" "}
                <b>{client?.name ?? "this client"}</b> on{" "}
                <b>{bill?.billNumber ?? "this bill"}</b> yet. Click{" "}
                <b>Generate brief</b> to create one.
              </>
            ) : (
              <>
                No brief loaded. Open <b>Client Scan</b>, pick a client and a
                bill, and click <b>Analyze client impact</b>.
              </>
            )}
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

  function downloadBrief() {
    if (!analysis) return;
    const a = analysis;
    const recs = (a.requiredAdaptations ?? [])
      .map(
        (r) =>
          `<h3>${esc(r.area)}</h3><p><b>Issue:</b> ${esc(r.currentIssue)}</p><p><b>Recommendation:</b> ${esc(r.recommendation)}</p><p class="doc-meta">${esc(r.reason)}</p>`,
      )
      .join("");
    const questions = (a.lawyerVerificationQuestions ?? [])
      .map((q) => `<li>${esc(q)}</li>`)
      .join("");
    const body = `
      <div class="doc-label">Privileged &amp; confidential · Counsel work product</div>
      <h1>Client exposure brief — ${esc(client?.name ?? "Client")}</h1>
      <p class="doc-meta">${esc(bill?.billNumber ?? "")} — ${esc(bill?.title ?? "")}${
        affectedActs.length ? ` · affecting ${esc(affectedActs.join(", "))}` : ""
      }</p>
      <h2>Assessment</h2>
      <p><b>Affected:</b> ${esc(a.affected)} &nbsp;·&nbsp; <b>Impact:</b> ${esc(a.impactLevel)} &nbsp;·&nbsp; <b>Urgency:</b> ${esc(a.urgency)} &nbsp;·&nbsp; <b>Timing:</b> ${esc(a.timing)}</p>
      <p>${esc(a.whyItAffectsClient)}</p>
      ${recs ? `<h2>Recommended actions</h2>${recs}` : ""}
      ${questions ? `<h2>For counsel to verify</h2><ul>${questions}</ul>` : ""}
      ${
        a.emailDraft
          ? `<h2>Draft client note</h2><p><b>Subject:</b> ${esc(a.emailDraft.subject)}</p><blockquote>${esc(a.emailDraft.body).replace(/\n/g, "<br/>")}</blockquote>`
          : ""
      }
      <div class="doc-foot">Prepared with Ingenium for BCF. Counsel review required before sending.</div>`;
    const slug = (client?.name ?? "client").replace(/\W+/g, "-").toLowerCase();
    downloadDoc(
      `brief-${slug}-${(bill?.billNumber ?? "bill").toLowerCase()}.doc`,
      `Client brief — ${client?.name ?? "Client"}`,
      body,
    );
    nav.toast("Brief downloaded (opens in Word; save as PDF from there).");
  }

  const requiredAdaptations = analysis.requiredAdaptations ?? [];
  const affectedClientAreas = analysis.affectedClientAreas ?? [];
  const relevantClientText = analysis.relevantClientText ?? [];
  const lawyerVerificationQuestions = analysis.lawyerVerificationQuestions ?? [];
  const totalRecs = requiredAdaptations.length;
  const totalRecsPad = String(totalRecs).padStart(2, "0");
  const toggleSection = (id: string) => {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));
  };

  return (
    <>
      <PageHeader
        crumbs={[
          "Workspace",
          "Client Brief",
          client?.name ?? "Brief",
        ]}
        title={`Client Brief — ${client?.name ?? "…"}`}
        sub={
          bill
            ? `Brief for ${bill.billNumber} — ${bill.title}.`
            : undefined
        }
        actions={
          <>
            <button className="btn" onClick={downloadBrief}>
              <FontAwesomeIcon icon={faFileArrowDown} aria-hidden="true" />
              Download brief
            </button>
            <button className="btn" disabled={busy} onClick={emailLawyer}>
              <FontAwesomeIcon icon={faEnvelope} aria-hidden="true" />
              Email lawyer
            </button>
            <button
              className="btn primary"
              disabled={busy || analysis.saved}
              onClick={save}
            >
              <FontAwesomeIcon icon={faFloppyDisk} aria-hidden="true" />
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
                <FontAwesomeIcon icon={faScaleBalanced} aria-hidden="true" />
                <div className="card-title" data-toc data-toc-depth="1" data-toc-title="Summary">
                  Summary
                </div>
              </div>
              <div className="card-sub">
                {client?.name ?? "-"} · {bill?.billNumber ?? "-"}
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
              icon={<FontAwesomeIcon icon={faShieldHalved} aria-hidden="true" />}
              title="Why it matters"
              summary={`${affectedClientAreas.length || 1} client area${affectedClientAreas.length === 1 ? "" : "s"} flagged`}
            >
              <div className="rich-text-card">
                <div>{analysis.whyItAffectsClient}</div>
                {affectedClientAreas.length > 0 && (
                  <div className="chip-row">
                    {affectedClientAreas.map((a) => (
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
              icon={<FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" />}
              title="Recommended adaptations"
              summary={`${totalRecs} action${totalRecs === 1 ? "" : "s"} proposed`}
            >
              {requiredAdaptations.map((r, i) => {
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

            {relevantClientText.length > 0 && (
              <InsightSection
                id="evidence"
                open={openSections.evidence}
                onToggle={toggleSection}
                icon={<FontAwesomeIcon icon={faFileLines} aria-hidden="true" />}
                title="Relevant client text"
                summary={`${relevantClientText.length} evidence excerpt${relevantClientText.length === 1 ? "" : "s"}`}
              >
                {relevantClientText.map((r, i) => (
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
                icon={<FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />}
                title="Lawyer review"
                summary={`${lawyerVerificationQuestions.length} verification question${lawyerVerificationQuestions.length === 1 ? "" : "s"}`}
                tone="warning"
              >
                <Alert variant="warning" appearance="light" className="analysis-alert flat-alert">
                  <AlertIcon>
                    <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
                  </AlertIcon>
                  <AlertContent>
                    <AlertTitle data-toc data-toc-depth="2">Review before sending</AlertTitle>
                    <AlertDescription>
                    <div>
                      {analysis.humanReviewReason ?? "This analysis needs lawyer verification before action."}
                    </div>
                    <ul className="review-question-list">
                      {lawyerVerificationQuestions.map((q, i) => (
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
              icon={<FontAwesomeIcon icon={faEnvelope} aria-hidden="true" />}
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
              icon={<FontAwesomeIcon icon={faFileLines} aria-hidden="true" />}
              title="Source bill"
              summary={`${bill?.billNumber ?? "Bill"} · ${affectedActs.join(", ") || "Acts pending"}`}
            >
              <div className="kv kv-card">
                <div className="k">Bill</div>
                <div className="v">{bill?.billNumber} — {bill?.title}</div>
                <div className="k">Status</div>
                <div className="v">{bill?.status}</div>
                <div className="k">Acts amended</div>
                <div className="v">{affectedActs.join(", ") || "—"}</div>
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
          <FontAwesomeIcon icon={faChevronDown} className={open ? "open" : ""} aria-hidden="true" />
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
