// Stage-4 entry — the brief library, rendered by ClientImpactAnalysis when no
// (client, bill) pair is addressed. A FLAT chronological list of every brief
// (latest per pair, newest first) with Approved / Needs review tags, filterable
// by bill and by client (combinable). Clicking an entry opens the brief at
// /clients/:clientId/bills/:billId; the URL stays /brief until then.
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faBookOpen } from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import { fetchBriefIndex, type BriefIndexEntry } from "../lib/clientScan";
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
  const [entries, setEntries] = useState<BriefIndexEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [billFilter, setBillFilter] = useState(""); // "" = all bills
  const [clientFilter, setClientFilter] = useState(""); // "" = all clients

  useEffect(() => {
    const ac = new AbortController();
    fetchBriefIndex(ac.signal)
      .then((index) => {
        if (!ac.signal.aborted) setEntries(index);
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

  // Dropdown options derive from the data itself — no extra endpoint.
  const billOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      if (!seen.has(e.billId)) {
        seen.set(e.billId, `${e.billNumber} — ${e.billShortTitle || e.billTitle}`);
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);
  const clientOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      if (!seen.has(e.clientId)) seen.set(e.clientId, e.clientName);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  // Filters combine (AND); the server's chronological order is preserved.
  const visible = entries.filter(
    (e) =>
      (!billFilter || e.billId === billFilter) &&
      (!clientFilter || e.clientId === clientFilter),
  );

  function openBrief(e: BriefIndexEntry) {
    nav.go("impact", { clientId: e.clientId, billId: e.billId });
  }

  return (
    <div className="card">
      <div className="card-h">
        <div className="card-title-row">
          <FontAwesomeIcon icon={faBookOpen} aria-hidden="true" />
          <div className="card-title">Brief library</div>
        </div>
        {loaded && entries.length > 0 && (
          <span className="bp-count">
            ({visible.length === entries.length ? entries.length : `${visible.length} of ${entries.length}`})
          </span>
        )}
      </div>
      <div className="card-pad">
        {!loaded && <div className="empty-small">Loading brief library…</div>}

        {loaded && entries.length === 0 && (
          <div className="rd-empty" data-testid="briefs-empty">
            No briefs yet — run a scan in Client scan (stage 3) and analyze a
            client.
            <div className="bp-empty-cta">
              <button className="btn" onClick={() => nav.go("scanner")}>
                Open Client scan
                <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {loaded && entries.length > 0 && (
          <>
            <div className="bp-filters">
              <label className="bp-filter">
                <span className="bp-filter-label">Bill</span>
                <select
                  data-testid="brief-filter-bill"
                  value={billFilter}
                  onChange={(e) => setBillFilter(e.target.value)}
                >
                  <option value="">All bills</option>
                  {billOptions.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="bp-filter">
                <span className="bp-filter-label">Client</span>
                <select
                  data-testid="brief-filter-client"
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                >
                  <option value="">All clients</option>
                  {clientOptions.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {visible.length === 0 && (
              <div className="empty-small">No briefs match these filters.</div>
            )}

            {visible.length > 0 && (
              <div className="bp-entry-list" data-testid="brief-entry-list">
                {visible.map((e) => (
                  <div
                    key={e.analysisId}
                    className="bp-entry"
                    data-testid="brief-entry"
                    data-analysis-id={e.analysisId}
                    data-bill-id={e.billId}
                    data-client-id={e.clientId}
                    role="button"
                    tabIndex={0}
                    onClick={() => openBrief(e)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        openBrief(e);
                      }
                    }}
                  >
                    <div className="bp-entry-main">
                      <span className="bp-bill-num">{e.billNumber}</span>
                      <span className="bp-entry-client">{e.clientName}</span>
                      <span className="bp-entry-title">
                        {e.billShortTitle || e.billTitle}
                      </span>
                    </div>
                    <div className="bp-entry-meta">
                      {e.band && (
                        <span className={`bp-band is-${e.band}`} data-band={e.band}>
                          {e.band}
                        </span>
                      )}
                      {e.approved ? (
                        <span className="bp-tag bp-approved" data-testid="brief-tag-approved">
                          Approved
                        </span>
                      ) : (
                        <span className="bp-tag bp-review" data-testid="brief-tag-review">
                          Needs review
                        </span>
                      )}
                      <span className="bp-entry-when">{fmtWhen(e.createdAt)}</span>
                      <FontAwesomeIcon
                        icon={faArrowRight}
                        className="bp-entry-go"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
