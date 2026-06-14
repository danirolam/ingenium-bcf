import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faEnvelope,
  faFileArrowDown,
  faFileLines,
  faFloppyDisk,
  faPaperPlane,
  faRotateRight,
  faScaleBalanced,
  faShieldHalved,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import {
  AffectedBadge,
  ReviewBadge,
} from "../components/badges";
import { BriefPicker } from "../components/BriefPicker";
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
import { analyzeWithGuidance } from "../lib/clientScan";
import { downloadDoc, esc } from "../lib/export";
import type { Bill, Client, ClientImpactAnalysis } from "../types";

export function ClientImpactAnalysisPage({ nav }: { nav: Nav }) {
  const [analysis, setAnalysis] = useState<ClientImpactAnalysis | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [busy, setBusy] = useState(false);
  // Regenerate-with-instructions panel (only offered once a brief exists).
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenText, setRegenText] = useState("");
  const [regenBusy, setRegenBusy] = useState(false);
  // Counsel's answers to the brief's verification questions, keyed by index.
  // Transient like guidance — they ride the same regen channel, never stored.
  const [reviewAnswers, setReviewAnswers] = useState<Record<number, string>>({});
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
    // A different pair owns the page now — its regen draft AND its question
    // answers die with it (the page never unmounts across SPA navigation, so
    // stale answers would otherwise pair with the NEXT brief's questions).
    setRegenOpen(false);
    setRegenText("");
    setReviewAnswers({});
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
      // Same endpoint as before — routed through the guidance-capable helper
      // (no guidance here), so stage 4 has a single analyze entry point.
      const { analysis: a, email } = await analyzeWithGuidance(
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

  // No (client, bill) pair addressed → the brief-library picker owns the
  // content area: pick a bill, then a briefed client.
  if (!clientId || !billId) {
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Client Brief"]}
          title="Client Brief"
          sub="Browse generated briefs — pick a bill, then the client whose brief to open."
        />
        <div className="body">
          <BriefPicker nav={nav} />
        </div>
      </>
    );
  }

  if (!analysis) {
    // A client+bill pair is addressed but no brief exists yet → offer to
    // generate it here, so the URL is directly actionable.
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Client Brief"]}
          title="Client Brief"
          sub={`No brief yet for ${client?.name ?? "this client"} on ${bill?.billNumber ?? "this bill"}.`}
          actions={
            <button className="btn primary" disabled={busy} onClick={generate}>
              {busy ? "Generating…" : "Generate brief"}
            </button>
          }
        />
        <div className="body">
          <div className="rd-empty">
            No brief has been generated for{" "}
            <b>{client?.name ?? "this client"}</b> on{" "}
            <b>{bill?.billNumber ?? "this bill"}</b> yet. Click{" "}
            <b>Generate brief</b> to create one.
          </div>
        </div>
      </>
    );
  }

  // Counsel approval — repurposes the stored `saved` flag (and the existing
  // /save route). Approval is per-version: regenerating creates a fresh,
  // unapproved analysis, so the gate re-engages automatically.
  async function approve() {
    if (!analysis) return;
    setBusy(true);
    try {
      const updated = await api.clientImpact.save(analysis.id);
      setAnalysis(updated);
      nav.toast("Brief approved — client email drafted; email and download unlocked.");
    } finally {
      setBusy(false);
    }
  }

  async function emailLawyer() {
    // Defense-in-depth: the button is disabled pre-approval, but the gate
    // ("unapproved AI output cannot leave the building") must hold even if
    // this handler is ever reached another way.
    if (!analysis?.saved) return;
    setBusy(true);
    try {
      const { email } = await api.clientImpact.emailLawyer(analysis.id);
      nav.toast(email.simulated ? "Email simulated." : "Email sent to lawyer.");
    } finally {
      setBusy(false);
    }
  }

  // Regenerate the brief, optionally steered by reviewing-lawyer instructions
  // (transient — never persisted). An empty textarea is a plain regen.
  async function regenerate() {
    if (!clientId || !billId || regenBusy) return;
    setRegenBusy(true);
    try {
      const { analysis: fresh } = await analyzeWithGuidance(
        clientId,
        billId,
        regenText,
      );
      // Reload through the page's by-pair path; fall back to the response if
      // that cosmetic re-fetch fails (the regen itself already succeeded).
      const reloaded = await api.clientImpact
        .byPair(clientId, billId)
        .catch(() => fresh);
      setAnalysis(reloaded);
      setRegenOpen(false);
      setRegenText("");
      // The new version has NEW questions — typed answers no longer pair.
      setReviewAnswers({});
      nav.toast("Brief regenerated.");
    } catch (err: any) {
      // Keep the panel (and the typed guidance) so the lawyer can retry.
      nav.toast(`Could not regenerate brief: ${err.message ?? err}`);
    } finally {
      setRegenBusy(false);
    }
  }

  // Regenerate using counsel's ANSWERS to the brief's verification questions.
  // Same transient guidance channel as free-form feedback — each answer is
  // sent with its question's FULL TEXT so the agent reads the resolution in
  // context (the questions also reach it inside the PREVIOUS BRIEF block).
  async function regenerateWithAnswers() {
    if (!clientId || !billId || regenBusy || !analysis) return;
    const questions = analysis.lawyerVerificationQuestions ?? [];
    const pairs = questions
      .map((q, i) => ({ q, a: (reviewAnswers[i] ?? "").trim() }))
      .filter((p) => p.a.length > 0);
    if (pairs.length === 0) return;
    let composed =
      "COUNSEL ANSWERS TO THE BRIEF'S VERIFICATION QUESTIONS:\n" +
      pairs.map((p, i) => `Q${i + 1}: ${p.q}\nA${i + 1}: ${p.a}`).join("\n");
    if (composed.length > 2000) {
      // The guidance channel caps at 2000 chars server-side — truncate at a
      // pair boundary so no half-answer goes through, and say so.
      const header = "COUNSEL ANSWERS TO THE BRIEF'S VERIFICATION QUESTIONS:\n";
      let cut = header;
      for (let i = 0; i < pairs.length; i++) {
        const next = `Q${i + 1}: ${pairs[i].q}\nA${i + 1}: ${pairs[i].a}\n`;
        if (cut.length + next.length > 2000) break;
        cut += next;
      }
      if (cut === header) {
        // Even the first pair doesn't fit — don't fire an answer-less regen.
        nav.toast("That answer is too long for one regeneration — please shorten it.");
        return;
      }
      composed = cut.trimEnd();
      nav.toast("Answers exceed the feedback limit — sending the first answers that fit.");
    }
    setRegenBusy(true);
    try {
      const { analysis: fresh } = await analyzeWithGuidance(clientId, billId, composed);
      const reloaded = await api.clientImpact
        .byPair(clientId, billId)
        .catch(() => fresh);
      setAnalysis(reloaded);
      setReviewAnswers({});
      nav.toast("Brief regenerated with counsel's answers.");
    } catch (err: any) {
      // Keep the typed answers so the lawyer can retry.
      nav.toast(`Could not regenerate brief: ${err.message ?? err}`);
    } finally {
      setRegenBusy(false);
    }
  }

  function downloadBrief() {
    if (!analysis?.saved) return; // same gate as the disabled button
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
      <p><b>Affected:</b> ${esc(a.affected)} &nbsp;·&nbsp; <b>Impact:</b> ${esc(a.impactLevel)} &nbsp;·&nbsp; <b>Timing:</b> ${esc(a.timing)}</p>
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
            <button
              className="btn ghost"
              data-testid="regen-toggle"
              aria-expanded={regenOpen}
              disabled={regenBusy}
              onClick={() => setRegenOpen((open) => !open)}
            >
              <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
              Regenerate with feedback…
            </button>
            {/* Unapproved AI output cannot leave the building: download and
                email unlock only once counsel approves this version. */}
            <button
              className="btn"
              disabled={!analysis.saved}
              title={analysis.saved ? undefined : "Requires counsel approval"}
              onClick={downloadBrief}
            >
              <FontAwesomeIcon icon={faFileArrowDown} aria-hidden="true" />
              Download brief
            </button>
            <button
              className="btn"
              disabled={busy || !analysis.saved}
              title={analysis.saved ? undefined : "Requires counsel approval"}
              onClick={emailLawyer}
            >
              <FontAwesomeIcon icon={faEnvelope} aria-hidden="true" />
              Email lawyer
            </button>
            <button
              className="btn primary"
              data-testid="approve-brief"
              // regenBusy too: approving mid-regeneration would sign off the
              // OLD version while a new one is about to replace it.
              disabled={busy || regenBusy || analysis.saved}
              onClick={approve}
            >
              <FontAwesomeIcon icon={faFloppyDisk} aria-hidden="true" />
              {analysis.saved
                ? "Approved"
                : busy
                  ? "Generating email…"
                  : "Approve & generate email"}
            </button>
          </>
        }
      />
      <div className="body">
        {regenOpen && (
          /* Page-scoped CSS lives elsewhere, so this panel composes shared
             primitives (card / rd-field / actions-row) + two inline margins. */
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-h">
              <div className="card-title-row">
                <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
                <div className="card-title">Regenerate with feedback</div>
              </div>
              <div className="card-sub">
                The analyst revises THIS brief (it travels along as context) —
                your notes can be instructions or feedback on it. Not stored.
                Regenerating creates a new, unapproved version.
              </div>
            </div>
            <div className="card-pad">
              <div className="rd-field">
                <label>Feedback / instructions for the analyst (optional)</label>
                <textarea
                  data-testid="regen-context-input"
                  value={regenText}
                  disabled={regenBusy}
                  placeholder="e.g. “the timeline is too vague”, “focus on supplier obligations”, “drop the labelling section”…"
                  onChange={(e) => setRegenText(e.target.value)}
                />
              </div>
              <div className="actions-row" style={{ marginTop: 12 }}>
                <button
                  className="btn ghost"
                  disabled={regenBusy}
                  onClick={() => setRegenOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn primary"
                  data-testid="regen-brief"
                  disabled={regenBusy}
                  onClick={() => void regenerate()}
                >
                  {regenBusy ? "Regenerating…" : "Regenerate brief"}
                </button>
              </div>
            </div>
          </div>
        )}
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
            {analysis.saved ? (
              <span className="badge ok" data-testid="approved-badge">
                Counsel approved
              </span>
            ) : (
              <ReviewBadge required={analysis.humanReviewRequired} />
            )}
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
            <ImpactScale level={analysis.impactLevel} />
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
                        <li key={i}>
                          <div>{q}</div>
                          <textarea
                            className="review-answer-input"
                            data-testid="review-answer-input"
                            rows={2}
                            style={{ width: "100%", marginTop: 6 }}
                            value={reviewAnswers[i] ?? ""}
                            disabled={regenBusy}
                            placeholder="Counsel's answer (optional) — feeds the next regeneration"
                            onChange={(e) =>
                              setReviewAnswers((cur) => ({
                                ...cur,
                                [i]: e.target.value,
                              }))
                            }
                          />
                        </li>
                      ))}
                    </ul>
                    <div className="actions-row" style={{ marginTop: 10 }}>
                      <button
                        className="btn primary"
                        data-testid="regen-with-answers"
                        disabled={
                          regenBusy ||
                          !Object.values(reviewAnswers).some((a) => a.trim().length > 0)
                        }
                        onClick={() => void regenerateWithAnswers()}
                      >
                        <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
                        {regenBusy ? "Regenerating…" : "Regenerate with answers"}
                      </button>
                    </div>
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
              summary={
                analysis.emailDraft
                  ? analysis.emailDraft.subject
                  : "Generated when you approve the brief"
              }
            >
              <div className="email-card-body">
                {analysis.emailDraft ? (
                  <div data-testid="email-draft-content">
                    <div className="kv kv-compact kv-email">
                      <div className="k">Subject</div>
                      <div className="v">{analysis.emailDraft.subject}</div>
                    </div>
                    <pre className="email-draft">
{analysis.emailDraft.body}
                    </pre>
                  </div>
                ) : (
                  <p className="email-draft-pending" data-testid="email-draft-pending">
                    The client-facing email draft is generated when you{" "}
                    <b>approve</b> this brief (the <em>Approve &amp; generate email</em>{" "}
                    button above). Deferring it means regenerating the brief never spends
                    tokens on an email that would be discarded.
                  </p>
                )}
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
