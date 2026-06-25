import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faCircleCheck,
  faCodeCompare,
  faEnvelope,
  faMagnifyingGlass,
  faPen,
  faPlus,
  faShieldHalved,
  faTrash,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import { ClientModal } from "../components/ClientModal";
import { MomentumBadge } from "../components/badges";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import {
  deleteClient,
  fetchClientExposure,
  type ExposureRow,
  type ScanBand,
} from "../lib/clientScan";
import { setActiveClientId, setViewMode } from "../lib/viewMode";
import type { Client, LegislativeMomentum } from "../types";
import "../styles/clientwatch.css";

const BANDS: ScanBand[] = ["critical", "high", "medium", "low"];
const BAND_LABEL: Record<ScanBand, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Per-client cache of the ranked exposure, so the board restores instantly on a
// return visit (and survives a cold serverless instance) while the fresh ranking
// loads. The hidden score is never part of these rows.
const cacheKey = (clientId: string) => `ingenium.watch.exposure.${clientId}`;
function readCache(clientId: string): ExposureRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(cacheKey(clientId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeCache(clientId: string, rows: ExposureRow[]): void {
  if (typeof window === "undefined" || !rows.length) return;
  try {
    window.localStorage.setItem(cacheKey(clientId), JSON.stringify(rows));
  } catch {
    /* storage full / disabled */
  }
}

// Client-first entry (the "By client" orientation). Pick one client and the
// whole current-session docket is ranked by how dangerous each bill is to them.
// Drill into a bill to read and approve its legal delta (Stage 2), then brief
// and email the client (Stage 4) — the same shared stages the bill-first scanner
// feeds, entered from the client end.
export function ClientWatch({ nav }: { nav: Nav }) {
  const clientId = nav.params.clientId ?? "";

  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [rows, setRows] = useState<ExposureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [openRationaleId, setOpenRationaleId] = useState<string | null>(null);

  const [clientQuery, setClientQuery] = useState("");
  const [billQuery, setBillQuery] = useState("");
  const [modal, setModal] = useState<
    null | { mode: "create" } | { mode: "edit"; client: Client }
  >(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Client-first page: pin the rail's orientation and remember the client, so
  // leaving for the delta/brief and coming back lands you right here.
  useEffect(() => setViewMode("client-first"), []);
  useEffect(() => {
    if (clientId) setActiveClientId(clientId);
  }, [clientId]);

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  // ── Clients ──
  useEffect(() => {
    const ac = new AbortController();
    api.clients
      .list()
      .then((cs) => {
        if (!ac.signal.aborted) setClients(cs);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        nav.toast(`Could not load clients: ${msg}`);
      })
      .finally(() => {
        if (!ac.signal.aborted) setClientsLoaded(true);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ranked exposure for the selected client ──
  useEffect(() => {
    setOpenRationaleId(null);
    if (!clientId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    const cached = readCache(clientId);
    setRows(cached); // instant restore (empty until the first load completes)
    setLoading(true);
    fetchClientExposure(clientId, ac.signal)
      .then((fresh) => {
        if (ac.signal.aborted) return;
        writeCache(clientId, fresh);
        setRows(fresh);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        nav.toast(`Could not rank the docket: ${msg}`);
        if (!cached.length) setRows([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // ── Client selection / search ──
  const clientQ = clientQuery.trim().toLowerCase();
  const visibleClients = [...clients]
    .filter(
      (c) =>
        !clientQ ||
        c.name.toLowerCase().includes(clientQ) ||
        (c.industry ?? "").toLowerCase().includes(clientQ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  function selectClient(id: string) {
    if (id === clientId) return;
    nav.go("watch", { clientId: id });
  }

  function onModalSaved(c: Client, mode: "create" | "edit") {
    setModal(null);
    if (mode === "create") {
      setClients((arr) => [c, ...arr]);
      nav.toast("Client added.");
      nav.go("watch", { clientId: c.id });
    } else {
      setClients((arr) => arr.map((x) => (x.id === c.id ? c : x)));
      nav.toast("Client updated.");
    }
  }

  async function confirmDelete(id: string) {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteClient(id);
      if (!mountedRef.current) return;
      setClients((arr) => arr.filter((c) => c.id !== id));
      setConfirmDeleteId(null);
      nav.toast("Client deleted, and its stored briefs were removed.");
      if (id === clientId) nav.go("watch");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      nav.toast(`Delete failed: ${msg}`);
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  }

  // ── Board ──
  const billQ = billQuery.trim().toLowerCase();
  const visibleRows = billQ
    ? rows.filter(
        (r) =>
          r.billNumber.toLowerCase().includes(billQ) ||
          r.title.toLowerCase().includes(billQ) ||
          (r.shortTitle?.toLowerCase().includes(billQ) ?? false) ||
          r.actTitles.some((t) => t.toLowerCase().includes(billQ)),
      )
    : rows;

  // Band tally across the whole ranked docket — the client's exposure headline.
  const bandCounts = useMemo(() => {
    const counts: Record<ScanBand, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of rows) counts[r.band] += 1;
    return counts;
  }, [rows]);

  // How many of this client's bills already have a counsel-approved brief — the
  // ones that can be folded into one consolidated client email.
  const approvedCount = useMemo(() => rows.filter((r) => r.approved).length, [rows]);

  function toggleRationale(billId: string) {
    setOpenRationaleId((cur) => (cur === billId ? null : billId));
  }

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Client Watch"]}
        title="Client Watch"
        sub="Pick a client and the whole current-session docket is ranked by how dangerous each bill is to them. Open a bill to review its legal delta, then brief and email the client."
        hint={{
          title: "Client-first: exposure",
          body: "Choose a client to see every current-session bill ordered by how dangerous it is to them, with the reason and the Acts each touches. Open a bill to read and approve its delta, then brief and email the client.",
        }}
        actions={
          <button
            className="btn primary"
            data-testid="new-client-button"
            onClick={() => setModal({ mode: "create" })}
          >
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            New client
          </button>
        }
      />
      <div className="body">
        <div className="cw-grid">
          {/* ── Clients: single-select + manage ── */}
          <div className="card">
            <div className="card-h">
              <div className="card-title-row">
                <FontAwesomeIcon icon={faUsers} aria-hidden="true" />
                <div className="card-title">Clients</div>
              </div>
              <span className="cs-count">({clients.length})</span>
            </div>
            {clientsLoaded && clients.length > 0 && (
              <div className="client-search-wrap">
                <div className="search">
                  <FontAwesomeIcon
                    icon={faMagnifyingGlass}
                    className="search-icon"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    data-testid="client-search"
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                    placeholder="Search clients"
                    aria-label="Search clients"
                  />
                </div>
              </div>
            )}
            <div className="client-list" data-testid="client-list">
              {!clientsLoaded && <div className="empty-small">Loading clients…</div>}
              {clientsLoaded && clients.length === 0 && (
                <div className="empty-small">
                  No clients yet. Add one with “New client”.
                </div>
              )}
              {clientsLoaded && clients.length > 0 && visibleClients.length === 0 && (
                <div className="empty-small">No clients match “{clientQuery}”.</div>
              )}
              {visibleClients.map((c) => {
                const selected = c.id === clientId;
                const confirming = confirmDeleteId === c.id;
                return (
                  <div
                    key={c.id}
                    className={`client-row cw-client-row${selected ? " active" : ""}${confirming ? " confirming" : ""}`}
                    data-testid="client-row"
                    data-client-id={c.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={() => selectClient(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectClient(c.id);
                      }
                    }}
                  >
                    <div className="cs-client-main">
                      <span
                        className={`cw-client-dot${selected ? " on" : ""}`}
                        aria-hidden="true"
                      />
                      <div className="cs-client-info">
                        <div className="nm">{c.name}</div>
                        <div className="meta">
                          {c.industry || "-"}
                          {(c.jurisdictions?.length ?? 0) > 0 &&
                            ` · ${(c.jurisdictions ?? []).join(", ")}`}
                        </div>
                      </div>
                      <div className="cs-client-actions">
                        <button
                          className="cs-icon-btn"
                          data-testid="edit-client"
                          title="Edit client"
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ mode: "edit", client: c });
                          }}
                        >
                          <FontAwesomeIcon icon={faPen} aria-hidden="true" />
                        </button>
                        <button
                          className="cs-icon-btn danger"
                          data-testid="delete-client"
                          title="Delete client"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(confirming ? null : c.id);
                          }}
                        >
                          <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    {confirming && (
                      <div className="cs-confirm" onClick={(e) => e.stopPropagation()}>
                        <span>Delete {c.name}? Its stored briefs are removed too.</span>
                        <button
                          className="btn sm danger"
                          data-testid="confirm-delete-client"
                          disabled={deleting}
                          onClick={() => void confirmDelete(c.id)}
                        >
                          {deleting ? "Deleting…" : "Delete"}
                        </button>
                        <button
                          className="btn ghost sm"
                          disabled={deleting}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Exposure board ── */}
          <div className="card cw-board">
            <div className="card-h">
              <div className="card-title-row">
                <FontAwesomeIcon icon={faShieldHalved} aria-hidden="true" />
                <div className="card-title">
                  {selectedClient ? `Exposure · ${selectedClient.name}` : "Exposure"}
                </div>
              </div>
              <div className="cw-board-actions">
                {clientId && approvedCount > 0 && (
                  <button
                    className="btn primary sm"
                    data-testid="watch-consolidate"
                    title="Fold this client's approved bills into one email"
                    onClick={() => nav.go("consolidated", { clientId })}
                  >
                    <FontAwesomeIcon icon={faEnvelope} aria-hidden="true" />
                    Consolidate {approvedCount} approved
                  </button>
                )}
                {clientId && rows.length > 0 && (
                  <span className="cs-count">{rows.length} bills ranked</span>
                )}
              </div>
            </div>

            <div className="card-pad">
              {!clientId && (
                <div className="rd-empty" data-testid="watch-pick-client">
                  Select a client on the left to rank every current-session bill by
                  how dangerous it is to them.
                </div>
              )}

              {clientId && loading && rows.length === 0 && (
                <div className="cw-rows" aria-busy="true" data-testid="watch-loading">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div className="cw-row cw-skel-row" key={i}>
                      <div className="cw-skel cw-skel-title" />
                      <div className="cw-skel cw-skel-sub" />
                    </div>
                  ))}
                </div>
              )}

              {clientId && !loading && rows.length === 0 && (
                <div className="rd-empty" data-testid="watch-empty">
                  No current-session bills to rank for this client.
                </div>
              )}

              {clientId && rows.length > 0 && (
                <>
                  <div className="cw-summary" data-testid="watch-summary">
                    {BANDS.map((band) => (
                      <div key={band} className={`cw-stat is-${band}`}>
                        <span className="cw-stat-n tnum">{bandCounts[band]}</span>
                        <span className="cw-stat-l">{BAND_LABEL[band]}</span>
                      </div>
                    ))}
                    <div className="cw-stat is-meta">
                      <span className="cw-stat-n tnum">{rows.length}</span>
                      <span className="cw-stat-l">Bills</span>
                    </div>
                  </div>

                  <div className="bpg-search cw-search">
                    <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
                    <input
                      type="search"
                      data-testid="watch-bill-search"
                      value={billQuery}
                      onChange={(e) => setBillQuery(e.target.value)}
                      placeholder="Search bills by number, title, or Act…"
                      aria-label="Search bills"
                    />
                  </div>

                  {visibleRows.length === 0 ? (
                    <div className="empty-small">No bills match “{billQuery}”.</div>
                  ) : (
                    <div className="cw-rows" data-testid="watch-rows">
                      {visibleRows.map((r) => {
                        const open = openRationaleId === r.billId;
                        return (
                          <div
                            key={r.billId}
                            className="cw-row"
                            data-testid="watch-row"
                            data-bill-id={r.billId}
                            data-band={r.band}
                          >
                            <div className="cw-line">
                              <div className="cw-main">
                                <div className="cw-bill-head">
                                  <span className="cw-bill-num tnum">{r.billNumber}</span>
                                  {r.legislativeMomentum && (
                                    <MomentumBadge
                                      value={r.legislativeMomentum as LegislativeMomentum}
                                    />
                                  )}
                                  {r.approvedOpCount > 0 && (
                                    <span className="cw-approved-pill" title="Counsel has approved this bill's changes">
                                      <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
                                      {r.approvedOpCount} approved
                                    </span>
                                  )}
                                </div>
                                <div className="cw-bill-title">
                                  {r.shortTitle || r.title}
                                </div>
                                {r.actTitles.length > 0 && (
                                  <div className="cw-bill-acts">
                                    Amends: {r.actTitles.join(" · ")}
                                  </div>
                                )}
                                {r.practiceAreas.length > 0 && (
                                  <div className="cw-bill-tags">
                                    {r.practiceAreas.slice(0, 4).map((p) => (
                                      <span key={p} className="badge">
                                        {p}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="cw-assess">
                                <button
                                  className={`cs-band is-${r.band} cw-band-btn${open ? " open" : ""}`}
                                  data-testid="watch-band"
                                  data-band={r.band}
                                  aria-expanded={open}
                                  title="Why this rank?"
                                  onClick={() => toggleRationale(r.billId)}
                                >
                                  {r.band}
                                  <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
                                </button>
                              </div>

                              <div className="cw-actions">
                                <button
                                  className="btn ghost sm"
                                  data-testid="watch-view-changes"
                                  title="Read and approve this bill's legal delta"
                                  onClick={() => nav.go("delta", { billId: r.billId })}
                                >
                                  <FontAwesomeIcon icon={faCodeCompare} aria-hidden="true" />
                                  Changes
                                </button>
                                {r.hasBrief ? (
                                  <button
                                    className="btn primary sm"
                                    data-testid="watch-view-brief"
                                    onClick={() =>
                                      nav.go("impact", { clientId, billId: r.billId })
                                    }
                                  >
                                    {r.approved ? "View brief" : "Review brief"}
                                  </button>
                                ) : r.approvedOpCount > 0 ? (
                                  <button
                                    className="btn primary sm"
                                    data-testid="watch-brief"
                                    onClick={() =>
                                      nav.go("impact", { clientId, billId: r.billId })
                                    }
                                  >
                                    Brief client
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            {open && (
                              <div className="cs-rationale" data-testid="watch-rationale">
                                <div className="cs-rationale-text">{r.rationale}</div>
                                {r.topAreas.length > 0 && (
                                  <div className="cs-rationale-areas">
                                    {r.topAreas.map((area) => (
                                      <span key={area} className="cs-area-chip">
                                        {area}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="cs-rationale-meta">
                                  {r.source === "ai"
                                    ? "AI read of the approved changes"
                                    : "Heuristic match against the client profile"}
                                  {r.approvedOpCount === 0 &&
                                    " · open Changes to review and approve the delta"}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <ClientModal
          client={modal.mode === "edit" ? modal.client : null}
          onClose={() => setModal(null)}
          onSaved={onModalSaved}
        />
      )}
    </>
  );
}
