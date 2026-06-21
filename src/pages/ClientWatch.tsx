import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faChevronDown,
  faCodeCompare,
  faMagnifyingGlass,
  faPen,
  faPlay,
  faPlus,
  faRotateRight,
  faShieldHalved,
  faSpinner,
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
  fetchScanReady,
  runScan as requestScan,
  type ExposureScanView,
  type ScanBand,
  type ScanReadyBill,
} from "../lib/clientScan";
import { setActiveClientId, setViewMode } from "../lib/viewMode";
import type { Client, LegislativeMomentum } from "../types";
import "../styles/clientwatch.css";

// Per-client scan cache. The server store lives in a serverless instance's
// /tmp, so a later request can land on an instance that never saw your scans
// and return []. We mirror the bands client-side so the board never blanks out
// when you navigate away and back; the server stays the source of truth when it
// actually has the data.
const scanCacheKey = (clientId: string) => `ingenium.watch.scans.${clientId}`;

function readScanCache(clientId: string): ExposureScanView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scanCacheKey(clientId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeScanCache(clientId: string, scans: ExposureScanView[]): void {
  if (typeof window === "undefined" || !scans.length) return;
  try {
    window.localStorage.setItem(scanCacheKey(clientId), JSON.stringify(scans));
  } catch {
    // storage full or disabled; the server copy still stands.
  }
}

/** Server rows win (ranked, fresh); cached rows the server has forgotten are
 *  kept so a cold instance can't blank the board. */
function mergeExposure(
  server: ExposureScanView[],
  cached: ExposureScanView[],
): ExposureScanView[] {
  const seen = new Set(server.map((s) => s.billId));
  return [...server, ...cached.filter((c) => !seen.has(c.billId))];
}

type WatchStatus = "idle" | "queued" | "scoring" | "scored" | "failed";

/** One bill row on the exposure board, keyed by billId (one scan per pair). */
interface WatchRow {
  billId: string;
  status: WatchStatus;
  scan?: ExposureScanView; // present once "scored"
  reason?: string; // why a scan failed
  analyzing?: boolean; // per-row brief generation in flight
  analyzeError?: string;
}

const BANDS: ScanBand[] = ["critical", "high", "medium", "low"];
const BAND_LABEL: Record<ScanBand, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

// How imminent a bill is, for ordering the not-yet-scanned tail (closer to law
// first). Scored rows are already ranked by the server's danger score.
const MOMENTUM_RANK: Record<string, number> = {
  in_force: 4,
  passed: 3,
  advanced: 2,
  active: 1,
  early: 0,
};
const momentumRank = (m?: string) => (m ? MOMENTUM_RANK[m] ?? 0 : 0);

function truncate(text: string, max = 200): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

function fmtWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Order the board: server-ranked scored rows first (danger desc), then the
// not-yet-scanned bills by imminence and the weight of their approved changes.
function buildRows(
  ready: ScanReadyBill[],
  exposure: ExposureScanView[],
): WatchRow[] {
  const readyById = new Map(ready.map((b) => [b.billId, b]));
  const scored: WatchRow[] = [];
  const scoredIds = new Set<string>();
  for (const e of exposure) {
    if (!readyById.has(e.billId) || scoredIds.has(e.billId)) continue;
    scored.push({ billId: e.billId, status: "scored", scan: e });
    scoredIds.add(e.billId);
  }
  const unscored: WatchRow[] = ready
    .filter((b) => !scoredIds.has(b.billId))
    .sort(
      (a, b) =>
        momentumRank(b.legislativeMomentum) - momentumRank(a.legislativeMomentum) ||
        b.approvedOpCount - a.approvedOpCount ||
        a.billNumber.localeCompare(b.billNumber),
    )
    .map((b) => ({ billId: b.billId, status: "idle" as const }));
  return [...scored, ...unscored];
}

// Client-first entry (the "By client" orientation). Pick one client, scan every
// counsel-approved bill against it, and rank the bills by how dangerous each is.
// Each row drills to the legal delta (Stage 2) and to the client's brief and
// email (Stage 4), the same shared stages the law-first scanner feeds.
export function ClientWatch({ nav }: { nav: Nav }) {
  const clientId = nav.params.clientId ?? "";

  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [readyBills, setReadyBills] = useState<ScanReadyBill[]>([]);
  const [readyLoaded, setReadyLoaded] = useState(false);

  const [rows, setRows] = useState<WatchRow[]>([]);
  const [exposureLoading, setExposureLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [openRationaleId, setOpenRationaleId] = useState<string | null>(null);

  const [clientQuery, setClientQuery] = useState("");
  const [billQuery, setBillQuery] = useState("");
  const [modal, setModal] = useState<
    null | { mode: "create" } | { mode: "edit"; client: Client }
  >(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Guards for the sequential scan loop: ignore completions after unmount,
  // after a newer run started, or after the user switched clients mid-scan.
  const mountedRef = useRef(true);
  const scanRunRef = useRef(0);
  const clientIdRef = useRef(clientId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    clientIdRef.current = clientId;
  }, [clientId]);

  // Client-first page: pin the rail's orientation, and remember the client so
  // leaving for the delta/brief and coming back lands you right here.
  useEffect(() => setViewMode("client-first"), []);
  useEffect(() => {
    if (clientId) setActiveClientId(clientId);
  }, [clientId]);

  const readyById = useMemo(
    () => new Map(readyBills.map((b) => [b.billId, b])),
    [readyBills],
  );
  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  // ── Initial data: the client book + the scan-ready shortlist ──
  useEffect(() => {
    const ac = new AbortController();
    Promise.all([api.clients.list(), fetchScanReady(ac.signal)])
      .then(([cs, ready]) => {
        setClients(cs);
        setReadyBills(ready);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        nav.toast(`Could not load watch data: ${msg}`);
      })
      .finally(() => {
        if (!ac.signal.aborted) {
          setClientsLoaded(true);
          setReadyLoaded(true);
        }
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── The selected client's exposure board (its persisted, ranked scans) ──
  // Switching clients retires any running scan and rebuilds the board.
  useEffect(() => {
    scanRunRef.current += 1;
    setScanning(false);
    setOpenRationaleId(null);
    setRows([]);
    if (!clientId || !readyLoaded) {
      setExposureLoading(false);
      return;
    }
    const ac = new AbortController();
    const runAtFetch = scanRunRef.current;
    setExposureLoading(true);
    // Instant restore from the client-side cache so the board never flashes
    // empty while the server answers (or if it has since forgotten the scans).
    const cached = readScanCache(clientId);
    if (cached.length) setRows(buildRows(readyBills, cached));
    fetchClientExposure(clientId, ac.signal)
      .then((exposure) => {
        if (ac.signal.aborted || scanRunRef.current !== runAtFetch) return;
        const merged = mergeExposure(exposure, cached);
        writeScanCache(clientId, merged);
        setRows(buildRows(readyBills, merged));
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        nav.toast(`Could not load exposure: ${msg}`);
        // Fall back to the cache (or the bare scan-ready list) so it stays usable.
        setRows(buildRows(readyBills, cached));
      })
      .finally(() => {
        if (!ac.signal.aborted) setExposureLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, readyLoaded, readyBills]);

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
    if (scanning) return;
    if (id === clientId) return;
    nav.go("watch", { clientId: id });
  }

  // ── Client CRUD ──
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
    if (scanning || deleting) return;
    setDeleting(true);
    try {
      await deleteClient(id);
      if (!mountedRef.current) return;
      setClients((arr) => arr.filter((c) => c.id !== id));
      setConfirmDeleteId(null);
      nav.toast("Client deleted · its stored briefs were removed.");
      if (id === clientId) nav.go("watch");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      nav.toast(`Delete failed: ${msg}`);
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  }

  // ── Scan board ──
  const patchRow = (billId: string, patch: Partial<WatchRow>) =>
    setRows((rs) => rs.map((r) => (r.billId === billId ? { ...r, ...patch } : r)));

  const billQ = billQuery.trim().toLowerCase();
  const visibleRows = billQ
    ? rows.filter((r) => {
        const b = readyById.get(r.billId);
        if (!b) return false;
        return (
          b.billNumber.toLowerCase().includes(billQ) ||
          b.title.toLowerCase().includes(billQ) ||
          (b.shortTitle?.toLowerCase().includes(billQ) ?? false) ||
          b.actTitles.some((t) => t.toLowerCase().includes(billQ))
        );
      })
    : rows;

  // Band tally across scored rows: the client's exposure headline.
  const bandCounts = useMemo(() => {
    const counts: Record<ScanBand, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    let scored = 0;
    for (const r of rows) {
      if (r.status === "scored" && r.scan) {
        counts[r.scan.band] += 1;
        scored += 1;
      }
    }
    return { counts, scored };
  }, [rows]);

  const pendingCount = rows.filter(
    (r) => r.status === "idle" || r.status === "failed",
  ).length;
  const canScan = !scanning && !!clientId && rows.length > 0;

  // Scan a set of bills sequentially against the selected client, snapshot-guarded.
  async function scanBills(billIds: string[]) {
    if (!clientId || billIds.length === 0) return;
    const cid = clientId;
    const runId = ++scanRunRef.current;
    const stale = () =>
      !mountedRef.current || scanRunRef.current !== runId || clientIdRef.current !== cid;

    setScanning(true);
    setScanProgress({ done: 0, total: billIds.length });
    setRows((rs) =>
      rs.map((r) =>
        billIds.includes(r.billId) ? { ...r, status: "queued", reason: undefined } : r,
      ),
    );

    let scored = 0;
    let failed = 0;
    for (let i = 0; i < billIds.length; i++) {
      const billId = billIds[i];
      if (stale()) return;
      setScanProgress({ done: i, total: billIds.length });
      patchRow(billId, { status: "scoring" });
      try {
        const { scan } = await requestScan(cid, billId);
        if (stale()) return;
        // runScan returns the no-`approved` view; default approved:false until a
        // brief exists (the exposure refresh below fills in the real flag).
        patchRow(billId, {
          status: "scored",
          scan: { ...scan, approved: false },
          reason: undefined,
        });
        scored += 1;
      } catch (err: unknown) {
        if (stale()) return;
        const msg = err instanceof Error ? err.message : String(err);
        patchRow(billId, { status: "failed", reason: truncate(msg, 140) });
        failed += 1;
      }
    }
    if (stale()) return;

    // Adopt the server's ranking (hidden score desc) + real approved flags;
    // keep any failed rows where they are. Always cache what we ended up with so
    // a later visit (or a cold serverless instance) keeps these bands.
    try {
      const exposure = await fetchClientExposure(cid);
      if (stale()) return;
      const merged = mergeExposure(exposure, readScanCache(cid));
      writeScanCache(cid, merged);
      setRows((prev) => {
        const failedIds = new Set(
          prev.filter((r) => r.status === "failed").map((r) => r.billId),
        );
        const rebuilt = buildRows(readyBills, merged);
        // Re-apply failures the exposure feed doesn't know about.
        const withFailures = rebuilt.map((r) =>
          failedIds.has(r.billId) && r.status !== "scored"
            ? { ...r, status: "failed" as const }
            : r,
        );
        return withFailures;
      });
    } catch {
      // Ranking refresh failed, so keep the local order, but still cache the
      // bands we scored so navigating away and back doesn't lose them.
      setRows((prev) => {
        writeScanCache(
          cid,
          prev.filter((r) => r.status === "scored" && r.scan).map((r) => r.scan!),
        );
        return prev;
      });
    }
    if (stale()) return;
    setScanning(false);
    setScanProgress(null);
    nav.toast(
      failed === 0
        ? `Scan complete · ${scored} assessed`
        : `Scan complete · ${scored} assessed · ${failed} failed`,
    );
  }

  function scanPending() {
    const targets = rows
      .filter((r) => r.status === "idle" || r.status === "failed")
      .map((r) => r.billId);
    void scanBills(targets.length > 0 ? targets : rows.map((r) => r.billId));
  }

  function rescanOne(billId: string) {
    if (scanning) return;
    void scanBills([billId]);
  }

  // Per-row brief generation (the slow ~30s agent). notify:true sends the ONE
  // counsel "Client Impact Ready" email. The client email is a later, deliberate
  // action from the brief page after approval.
  async function analyzeRow(billId: string) {
    if (!clientId) return;
    patchRow(billId, { analyzing: true, analyzeError: undefined });
    try {
      const { analysis } = await api.clientImpact.analyze(clientId, billId);
      if (!mountedRef.current || clientIdRef.current !== clientId) return;
      setRows((rs) => {
        const next = rs.map((r) =>
          r.billId === billId
            ? {
                ...r,
                analyzing: false,
                analyzeError: undefined,
                scan: r.scan
                  ? { ...r.scan, hasBrief: true, analysisId: analysis.id }
                  : r.scan,
              }
            : r,
        );
        // Keep the cache in step so "brief ready" survives a navigation.
        writeScanCache(
          clientId,
          next.filter((r) => r.status === "scored" && r.scan).map((r) => r.scan!),
        );
        return next;
      });
      nav.toast("Brief ready. Open it to review and email the client.");
    } catch (err: unknown) {
      if (!mountedRef.current || clientIdRef.current !== clientId) return;
      const msg = err instanceof Error ? err.message : String(err);
      patchRow(billId, { analyzing: false, analyzeError: truncate(msg, 140) });
    }
  }

  function toggleRationale(billId: string) {
    setOpenRationaleId((cur) => (cur === billId ? null : billId));
  }

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Client Watch"]}
        title="Client Watch"
        sub="Pick a client and rank every counsel-approved bill by how dangerous it is to them, then brief and email the client on each."
        hint={{
          title: "Client-first: exposure",
          body: "Choose a client, scan it against every bill whose changes counsel approved in stage 2, and work down the list, most dangerous first. Each bill opens its legal delta and the client's brief and email.",
        }}
        actions={
          <button
            className="btn primary"
            data-testid="new-client-button"
            disabled={scanning}
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
                          disabled={scanning}
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
                          disabled={scanning}
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
                          disabled={deleting || scanning}
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
                  {selectedClient
                    ? `Exposure · ${selectedClient.name}`
                    : "Exposure"}
                </div>
              </div>
              {clientId && (
                <button
                  className="btn primary sm"
                  data-testid="scan-all"
                  disabled={!canScan}
                  onClick={scanPending}
                  title="Score every approved bill against this client"
                >
                  <FontAwesomeIcon
                    icon={scanning ? faSpinner : faPlay}
                    spin={scanning}
                    aria-hidden="true"
                  />
                  {scanning
                    ? scanProgress
                      ? `Scanning ${Math.min(scanProgress.done + 1, scanProgress.total)}/${scanProgress.total}…`
                      : "Scanning…"
                    : pendingCount > 0
                      ? `Scan ${pendingCount} bill${pendingCount === 1 ? "" : "s"}`
                      : "Rescan all"}
                </button>
              )}
            </div>

            <div className="card-pad">
              {!clientId && (
                <div className="rd-empty" data-testid="watch-pick-client">
                  Select a client on the left to see every bill that could affect
                  them, ranked by exposure.
                </div>
              )}

              {clientId && !readyLoaded && (
                <div className="empty-small">Checking for approved bills…</div>
              )}
              {clientId && readyLoaded && readyBills.length === 0 && (
                <div className="rd-empty" data-testid="watch-no-bills">
                  No bills have approved changes yet. Complete stage 2 (Legal delta)
                  first.
                  <div className="cs-empty-cta">
                    <button className="btn" onClick={() => nav.go("delta")}>
                      Open Legal delta
                      <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}

              {clientId && readyLoaded && readyBills.length > 0 && (
                <>
                  {/* Exposure headline: the band tally for this client. */}
                  <div className="cw-summary" data-testid="watch-summary">
                    {BANDS.map((band) => (
                      <div key={band} className={`cw-stat is-${band}`}>
                        <span className="cw-stat-n tnum">
                          {bandCounts.counts[band]}
                        </span>
                        <span className="cw-stat-l">{BAND_LABEL[band]}</span>
                      </div>
                    ))}
                    <div className="cw-stat is-meta">
                      <span className="cw-stat-n tnum">
                        {bandCounts.scored}/{readyBills.length}
                      </span>
                      <span className="cw-stat-l">Assessed</span>
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

                  {exposureLoading && rows.length === 0 ? (
                    <div className="cw-rows" aria-busy="true" data-testid="watch-loading">
                      {[0, 1, 2, 3].map((i) => (
                        <div className="cw-row cw-skel-row" key={i}>
                          <div className="cw-skel cw-skel-title" />
                          <div className="cw-skel cw-skel-sub" />
                        </div>
                      ))}
                    </div>
                  ) : visibleRows.length === 0 ? (
                    <div className="empty-small">No bills match “{billQuery}”.</div>
                  ) : (
                    <div className="cw-rows" data-testid="watch-rows">
                      {visibleRows.map((r) => {
                        const b = readyById.get(r.billId);
                        if (!b) return null;
                        const scan = r.status === "scored" ? r.scan : undefined;
                        const open = openRationaleId === r.billId;
                        return (
                          <div
                            key={r.billId}
                            className="cw-row"
                            data-testid="watch-row"
                            data-bill-id={r.billId}
                            data-band={scan?.band ?? ""}
                          >
                            <div className="cw-line">
                              <div className="cw-main">
                                <div className="cw-bill-head">
                                  <span className="cw-bill-num tnum">
                                    {b.billNumber}
                                  </span>
                                  {b.legislativeMomentum && (
                                    <MomentumBadge
                                      value={
                                        b.legislativeMomentum as LegislativeMomentum
                                      }
                                    />
                                  )}
                                </div>
                                <div className="cw-bill-title">
                                  {b.shortTitle || b.title}
                                </div>
                                <div className="cw-bill-acts">
                                  Amends: {b.actTitles.join(" · ")}
                                </div>
                                {(b.practiceAreas?.length ?? 0) > 0 && (
                                  <div className="cw-bill-tags">
                                    {b.practiceAreas!.slice(0, 4).map((p) => (
                                      <span key={p} className="badge">
                                        {p}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="cw-assess">
                                {scan ? (
                                  <button
                                    className={`cs-band is-${scan.band} cw-band-btn${open ? " open" : ""}`}
                                    data-testid="watch-band"
                                    data-band={scan.band}
                                    aria-expanded={open}
                                    title="Why this band?"
                                    onClick={() => toggleRationale(r.billId)}
                                  >
                                    {scan.band}
                                    <FontAwesomeIcon
                                      icon={faChevronDown}
                                      aria-hidden="true"
                                    />
                                  </button>
                                ) : r.status === "scoring" || r.status === "queued" ? (
                                  <span
                                    className="cs-status is-scoring"
                                    data-testid="watch-status"
                                  >
                                    scoring
                                  </span>
                                ) : r.status === "failed" ? (
                                  <span
                                    className="cs-status is-failed"
                                    title={r.reason}
                                    data-testid="watch-status"
                                  >
                                    failed
                                  </span>
                                ) : (
                                  <span className="cw-unscored">Not assessed</span>
                                )}
                              </div>

                              <div className="cw-actions">
                                <button
                                  className="btn ghost sm"
                                  data-testid="watch-view-changes"
                                  title="See exactly what this bill changes"
                                  onClick={() =>
                                    nav.go("delta", { billId: r.billId })
                                  }
                                >
                                  <FontAwesomeIcon
                                    icon={faCodeCompare}
                                    aria-hidden="true"
                                  />
                                  Changes
                                </button>
                                {r.status === "idle" && (
                                  <button
                                    className="btn sm"
                                    data-testid="watch-scan-one"
                                    disabled={scanning}
                                    onClick={() => rescanOne(r.billId)}
                                  >
                                    Assess
                                  </button>
                                )}
                                {r.status === "failed" && (
                                  <button
                                    className="cs-retry"
                                    data-testid="watch-retry"
                                    disabled={scanning}
                                    onClick={() => rescanOne(r.billId)}
                                  >
                                    <FontAwesomeIcon
                                      icon={faRotateRight}
                                      aria-hidden="true"
                                    />
                                    Retry
                                  </button>
                                )}
                                {scan && scan.hasBrief && (
                                  <button
                                    className="btn primary sm"
                                    data-testid="watch-view-brief"
                                    onClick={() =>
                                      nav.go("impact", {
                                        clientId,
                                        billId: r.billId,
                                      })
                                    }
                                  >
                                    {scan.approved ? "View brief" : "Review brief"}
                                  </button>
                                )}
                                {scan && !scan.hasBrief && (
                                  <button
                                    className="btn primary sm"
                                    data-testid="watch-analyze"
                                    disabled={!!r.analyzing}
                                    onClick={() => void analyzeRow(r.billId)}
                                  >
                                    {r.analyzing ? "Briefing…" : "Brief client"}
                                  </button>
                                )}
                              </div>
                            </div>

                            {r.analyzeError && (
                              <div className="cs-analyze-error">
                                Brief failed: {r.analyzeError}
                              </div>
                            )}

                            {open && scan && (
                              <div className="cs-rationale" data-testid="watch-rationale">
                                <div className="cs-rationale-text">{scan.rationale}</div>
                                {scan.topAreas.length > 0 && (
                                  <div className="cs-rationale-areas">
                                    {scan.topAreas.map((area) => (
                                      <span key={area} className="cs-area-chip">
                                        {area}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="cs-rationale-meta">
                                  {scan.source === "ai" ? "AI triage" : "Heuristic triage"}
                                  {fmtWhen(scan.scannedAt) && ` · ${fmtWhen(scan.scannedAt)}`}
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
