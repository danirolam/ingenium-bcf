import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faCircleCheck,
  faEnvelope,
  faPaperPlane,
  faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import { PageHeader } from "../components/PageHeader";
import {
  composeConsolidatedDraft,
  fetchConsolidated,
  sendConsolidatedEmail,
  type ComposedEmail,
  type ConsolidatedItem,
  type ConsolidatedResponse,
  type ScanBand,
} from "../lib/clientScan";
import { setActiveClientId, setViewMode } from "../lib/viewMode";
import "../styles/clientwatch.css";

const BAND_LABEL: Record<ScanBand, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};
const IMPACT_LABEL: Record<ConsolidatedItem["impactLevel"], string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Client-first, post-approval: gather every human-approved bill affecting one
// client and fold them into a single client-facing email. The preview is the
// exact text that gets sent (the server forwards it verbatim), so what counsel
// reads here is what the client receives.
export function ClientConsolidated({ nav }: { nav: Nav }) {
  const clientId = nav.params.clientId ?? "";

  const [resp, setResp] = useState<ConsolidatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<ComposedEmail>({ subject: "", body: "" });
  const [edited, setEdited] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Pin the rail's orientation and remember the client.
  useEffect(() => setViewMode("client-first"), []);
  useEffect(() => {
    if (clientId) setActiveClientId(clientId);
  }, [clientId]);

  // ── Load the client's approved bills ──
  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setSentNote(null);
    fetchConsolidated(clientId, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return;
        setResp(r);
        setSelected(new Set(r.items.map((i) => i.billId)));
        setDraft(composeConsolidatedDraft(r.client.name, r.items));
        setEdited(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        nav.toast(`Could not load approved bills: ${msg}`);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const selectedItems = useMemo(
    () => (resp ? resp.items.filter((i) => selected.has(i.billId)) : []),
    [resp, selected],
  );

  // Recompose whenever the selection changes, unless counsel has hand-edited the
  // draft (their edits win until they reset or change the selection again).
  useEffect(() => {
    if (!resp || edited) return;
    setDraft(composeConsolidatedDraft(resp.client.name, selectedItems));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItems, resp]);

  function toggle(billId: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(billId)) next.delete(billId);
      else next.add(billId);
      return next;
    });
    setEdited(false); // selection drives the draft again
    setSentNote(null);
  }

  function resetDraft() {
    if (!resp) return;
    setDraft(composeConsolidatedDraft(resp.client.name, selectedItems));
    setEdited(false);
  }

  async function send() {
    if (!clientId || selectedItems.length === 0 || sending) return;
    if (!draft.subject.trim() || !draft.body.trim()) {
      nav.toast("The email needs a subject and a body before it can be sent.");
      return;
    }
    setSending(true);
    setSentNote(null);
    try {
      const r = await sendConsolidatedEmail({
        clientId,
        billIds: selectedItems.map((i) => i.billId),
        email: draft,
      });
      if (!mountedRef.current) return;
      const how = r.result?.sent
        ? "sent"
        : r.result?.simulated
          ? "simulated (no email key configured)"
          : "queued";
      setSentNote(
        `Consolidated email ${how}, covering ${r.billNumbers.join(", ")}.`,
      );
      nav.toast(`Consolidated client email ${how}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      nav.toast(`Could not send the email: ${msg}`);
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }

  const clientName = resp?.client.name ?? "Client";
  const hasItems = (resp?.items.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Client Watch", clientName, "Consolidated brief"]}
        title="Consolidated client brief"
        sub="Every human-approved bill affecting this client, gathered into one email. Pick which bills to include, review the draft, and send a single briefing."
        hint={{
          title: "One email, every approved bill",
          body: "This pulls together the bills you have already reviewed and approved for this client. Choose which to include, edit the draft if needed, and send one consolidated email instead of one per bill.",
        }}
        actions={
          <button
            className="btn ghost"
            data-testid="consolidated-back"
            onClick={() => nav.go("watch", clientId ? { clientId } : {})}
          >
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
            Back to exposure
          </button>
        }
      />
      <div className="body">
        {!clientId && (
          <div className="rd-empty">
            Pick a client first. Open Client Watch, choose a client, then come
            back to consolidate its approved bills.
          </div>
        )}

        {clientId && loading && (
          <div className="cc-grid">
            <div className="card">
              <div className="card-pad">
                <div className="cw-rows" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <div className="cw-row cw-skel-row" key={i}>
                      <div className="cw-skel cw-skel-title" />
                      <div className="cw-skel cw-skel-sub" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-pad">
                <div className="cw-skel" style={{ height: 320 }} />
              </div>
            </div>
          </div>
        )}

        {clientId && !loading && !hasItems && (
          <div className="rd-empty" data-testid="consolidated-empty">
            No approved bills for {clientName} yet. Approve a bill's brief in
            Stage 4 and it will appear here, ready to consolidate.
            <div style={{ marginTop: 14 }}>
              <button
                className="btn primary"
                onClick={() => nav.go("watch", { clientId })}
              >
                Go to exposure
              </button>
            </div>
          </div>
        )}

        {clientId && !loading && hasItems && (
          <div className="cc-grid">
            {/* ── Approved bills to include ── */}
            <div className="card">
              <div className="card-h">
                <div className="card-title-row">
                  <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
                  <div className="card-title">Approved bills</div>
                </div>
                <span className="cs-count">
                  {selectedItems.length}/{resp?.items.length ?? 0} included
                </span>
              </div>
              <div className="card-pad">
                <div className="cc-list" data-testid="consolidated-list">
                  {resp?.items.map((it) => {
                    const on = selected.has(it.billId);
                    return (
                      <label
                        key={it.billId}
                        className={`cc-row${on ? "" : " off"}`}
                        data-testid="consolidated-row"
                        data-bill-id={it.billId}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(it.billId)}
                          aria-label={`Include ${it.billNumber}`}
                        />
                        <div className="cc-row-main">
                          <div className="cc-row-head">
                            <span className="cw-bill-num tnum">{it.billNumber}</span>
                            <span className={`cs-band is-${it.band ?? bandFor(it.impactLevel)}`}>
                              {BAND_LABEL[it.band ?? bandFor(it.impactLevel)]}
                            </span>
                            <span className="cc-impact">
                              {IMPACT_LABEL[it.impactLevel]} impact
                            </span>
                          </div>
                          <div className="cc-row-title">
                            {it.billShortTitle || it.billTitle}
                          </div>
                          {it.whyItAffectsClient && (
                            <div className="cc-row-why">{it.whyItAffectsClient}</div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Consolidated email preview ── */}
            <div className="card">
              <div className="card-h">
                <div className="card-title-row">
                  <FontAwesomeIcon icon={faEnvelope} aria-hidden="true" />
                  <div className="card-title">Consolidated email</div>
                </div>
                {edited && (
                  <button className="btn ghost sm" onClick={resetDraft} title="Reset to the generated draft">
                    <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
                    Reset draft
                  </button>
                )}
              </div>
              <div className="card-pad cc-preview">
                {selectedItems.length === 0 ? (
                  <div className="empty-small">
                    Select at least one approved bill to draft the email.
                  </div>
                ) : (
                  <>
                    <div className="rd-field">
                      <label htmlFor="cc-subject">Subject</label>
                      <input
                        id="cc-subject"
                        data-testid="consolidated-subject"
                        value={draft.subject}
                        onChange={(e) => {
                          setDraft((d) => ({ ...d, subject: e.target.value }));
                          setEdited(true);
                        }}
                      />
                    </div>
                    <div className="rd-field">
                      <label htmlFor="cc-body">Body</label>
                      <textarea
                        id="cc-body"
                        className="cc-body"
                        data-testid="consolidated-body"
                        value={draft.body}
                        onChange={(e) => {
                          setDraft((d) => ({ ...d, body: e.target.value }));
                          setEdited(true);
                        }}
                      />
                    </div>
                    <div className="cc-actions">
                      <button
                        className="btn primary"
                        data-testid="consolidated-send"
                        disabled={sending}
                        onClick={() => void send()}
                      >
                        <FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" />
                        {sending
                          ? "Sending…"
                          : `Send to client (${selectedItems.length} ${
                              selectedItems.length === 1 ? "bill" : "bills"
                            })`}
                      </button>
                      {sentNote && (
                        <span className="cc-sent" data-testid="consolidated-sent">
                          <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />{" "}
                          {sentNote}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// A bill that was approved but never fast-scanned has no band; fall back to its
// brief's impact level so the chip still reflects severity.
function bandFor(impact: ConsolidatedItem["impactLevel"]): ScanBand {
  return impact;
}
