// Stage-4 entry — the brief-library drill-down rendered by ClientImpactAnalysis
// when no (client, bill) pair is addressed. Step 1 lists the bills that have at
// least one generated brief; step 2 lists that bill's briefed clients; picking
// a client navigates to the pair URL (/clients/:clientId/bills/:billId). The
// bill selection is internal state only — the URL stays /brief until a brief
// is opened.
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faBookOpen } from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import { fetchBriefIndex, type BriefIndexBill } from "../lib/clientScan";
import "../styles/briefpicker.css";

// Same compact timestamp helper the scanner uses (copied, not imported —
// pages/components keep their tiny helpers local).
function fmtWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function BriefPicker({ nav }: { nav: Nav }) {
  const [bills, setBills] = useState<BriefIndexBill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchBriefIndex(ac.signal)
      .then((index) => {
        if (!ac.signal.aborted) setBills(index);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        nav.toast(`Could not load the brief library: ${msg}`);
      })
      .finally(() => {
        // Loaded even on failure so the empty state shows instead of a
        // forever "Loading…".
        if (!ac.signal.aborted) setLoaded(true);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = selectedBillId
    ? (bills.find((b) => b.billId === selectedBillId) ?? null)
    : null;

  function openBrief(clientId: string, billId: string) {
    nav.go("impact", { clientId, billId });
  }

  return (
    <div className="card">
      <div className="card-h">
        <div className="card-title-row">
          <FontAwesomeIcon icon={faBookOpen} aria-hidden="true" />
          <div className="card-title">Brief library</div>
        </div>
        {loaded && !selected && bills.length > 0 && (
          <span className="bp-count">({bills.length})</span>
        )}
      </div>
      <div className="card-pad">
        {/* ── Step 1: bills with at least one brief ── */}
        {!selected && (
          <>
            {!loaded && (
              <div className="empty-small">Loading brief library…</div>
            )}
            {loaded && bills.length === 0 && (
              <div className="rd-empty" data-testid="briefs-empty">
                No briefs yet — run a scan in Client scan (stage 3) and analyze
                a client.
                <div className="bp-empty-cta">
                  <button className="btn" onClick={() => nav.go("scanner")}>
                    Open Client scan
                    <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
            {loaded && bills.length > 0 && (
              <div className="bp-bill-grid" data-testid="brief-bill-list">
                {bills.map((b) => (
                  <div
                    key={b.billId}
                    className="card bp-bill-card"
                    data-testid="brief-bill-card"
                    data-bill-id={b.billId}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedBillId(b.billId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedBillId(b.billId);
                      }
                    }}
                  >
                    <div className="bp-bill-top">
                      <span className="bp-bill-num">{b.billNumber}</span>
                      <span className="bp-brief-pill">
                        {b.briefCount} brief{b.briefCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="bp-bill-title">
                      {b.shortTitle || b.title}
                    </div>
                    <div className="bp-bill-foot">
                      <span>{b.status}</span>
                      {fmtWhen(b.latestAt) && (
                        <span>Latest {fmtWhen(b.latestAt)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Step 2: the selected bill's briefed clients ── */}
        {selected && (
          <>
            <div className="bp-step-head">
              <button
                className="btn ghost sm bp-back"
                data-testid="brief-back"
                onClick={() => setSelectedBillId(null)}
              >
                ← All bills
              </button>
              <div className="bp-bill-line">
                <span className="bp-bill-num">{selected.billNumber}</span>
                <span className="bp-bill-line-title">
                  {selected.shortTitle || selected.title}
                </span>
              </div>
              <div className="bp-bill-line-meta">
                {selected.status} · {selected.briefCount} brief
                {selected.briefCount === 1 ? "" : "s"}
                {fmtWhen(selected.latestAt) &&
                  ` · latest ${fmtWhen(selected.latestAt)}`}
              </div>
            </div>
            <div className="bp-client-list" data-testid="brief-client-list">
              {selected.clients.map((cl) => (
                <div
                  key={cl.clientId}
                  className="bp-client-card"
                  data-testid="brief-client-card"
                  data-client-id={cl.clientId}
                  role="button"
                  tabIndex={0}
                  onClick={() => openBrief(cl.clientId, selected.billId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openBrief(cl.clientId, selected.billId);
                    }
                  }}
                >
                  <span className="bp-client-name">{cl.name}</span>
                  {cl.band && (
                    <span
                      className={`bp-band is-${cl.band}`}
                      data-band={cl.band}
                    >
                      {cl.band}
                    </span>
                  )}
                  <span className="bp-client-when">
                    {fmtWhen(cl.createdAt)}
                  </span>
                  <FontAwesomeIcon
                    icon={faArrowRight}
                    className="bp-client-go"
                    aria-hidden="true"
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
