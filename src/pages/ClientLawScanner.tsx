import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faListCheck,
  faPen,
  faPlay,
  faPlus,
  faTrash,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import {
  deleteClient,
  fetchScanReady,
  fetchScanReadyDetail,
  updateClient,
  type ApprovedOpSummary,
  type ScanReadyBill,
  type ScanReadyDetail,
} from "../lib/clientScan";
import type { Client } from "../types";
import "../styles/clientscan.css";

const OP_LABEL: Record<ApprovedOpSummary["op"], string> = {
  add: "Add",
  replace: "Replace",
  repeal: "Repeal",
  amend: "Amend",
};

type ScanStatus = "queued" | "running" | "done" | "failed";

interface ScanRow {
  clientId: string;
  status: ScanStatus;
  reason?: string;
}

function truncate(text: string, max = 200): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

function fmtWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Stage 3 — bill-first batch scanner. Pick a bill whose amendments counsel
// approved in stage 2, select the clients to test it against, and run a
// sequential scan; every client gets its own impact brief (stage 4).
export function ClientLawScanner({ nav }: { nav: Nav }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [readyBills, setReadyBills] = useState<ScanReadyBill[]>([]);
  const [readyLoaded, setReadyLoaded] = useState(false);

  const [selectedBillId, setSelectedBillId] = useState("");
  const [detail, setDetail] = useState<ScanReadyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [modal, setModal] = useState<
    null | { mode: "create" } | { mode: "edit"; client: Client }
  >(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanBillId, setScanBillId] = useState("");
  const [scanRows, setScanRows] = useState<ScanRow[]>([]);

  // Guards for the sequential scan loop: ignore completions after unmount,
  // after a newer run started, or after the user switched bills mid-scan.
  const mountedRef = useRef(true);
  const scanRunRef = useRef(0);
  const selectedBillIdRef = useRef("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    selectedBillIdRef.current = selectedBillId;
  }, [selectedBillId]);

  // ── Initial data: clients + the scan-ready shortlist ──
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
        nav.toast(`Could not load scanner data: ${msg}`);
      })
      .finally(() => {
        // Mark loaded even on failure so the panes show their empty states
        // instead of a forever "Loading…".
        if (!ac.signal.aborted) {
          setClientsLoaded(true);
          setReadyLoaded(true);
        }
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedReady =
    readyBills.find((b) => b.billId === selectedBillId) ?? null;

  // ── Approved-changes detail for the selected ready bill ──
  useEffect(() => {
    setDetail(null);
    if (!selectedBillId || !readyBills.some((b) => b.billId === selectedBillId)) {
      // Early-out (e.g. switching ready → non-ready): clear any loading state
      // left by an aborted in-flight fetch, whose .finally skips it.
      setDetailLoading(false);
      return;
    }
    const ac = new AbortController();
    setDetailLoading(true);
    fetchScanReadyDetail(selectedBillId, ac.signal)
      .then((d) => {
        if (!ac.signal.aborted) setDetail(d);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        nav.toast(`Could not load approved changes: ${msg}`);
      })
      .finally(() => {
        if (!ac.signal.aborted) setDetailLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBillId, readyBills]);

  // Progress rows belong to the bill they were run against — switching bills
  // clears them and retires the run. Bumping scanRunRef makes the orphaned
  // loop PERMANENTLY stale: without it, switching away and back to the same
  // bill would let the old loop resume issuing analyze calls.
  useEffect(() => {
    if (scanRows.length > 0 && scanBillId && selectedBillId !== scanBillId) {
      scanRunRef.current += 1;
      setScanRows([]);
      setScanBillId("");
      setScanning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBillId]);

  // ── Client selection ──
  const allSelected =
    clients.length > 0 && clients.every((c) => selectedClientIds.has(c.id));

  function toggleClient(id: string) {
    if (scanning) return;
    setSelectedClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllClients() {
    if (scanning) return;
    setSelectedClientIds(
      allSelected ? new Set() : new Set(clients.map((c) => c.id)),
    );
  }

  // ── Client CRUD ──
  function onModalSaved(c: Client, mode: "create" | "edit") {
    setModal(null);
    if (mode === "create") {
      setClients((arr) => [c, ...arr]);
      setSelectedClientIds((prev) => {
        const next = new Set(prev);
        next.add(c.id);
        return next;
      });
      nav.toast("Client added.");
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
      setSelectedClientIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setConfirmDeleteId(null);
      nav.toast("Client deleted · its stored briefs were removed.");
      // Refresh from the server so the list reflects the cascade.
      api.clients
        .list()
        .then((cs) => {
          if (mountedRef.current) setClients(cs);
        })
        .catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      nav.toast(`Delete failed: ${msg}`);
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  }

  // ── The scan loop: sequential, snapshot-guarded ──
  const canRun = !scanning && !!selectedReady && selectedClientIds.size > 0;

  async function runScan() {
    if (!canRun || !selectedReady) return;
    const billId = selectedReady.billId;
    // Snapshot the selection in list order — edits during the run can't shift rows.
    const ids = clients
      .filter((c) => selectedClientIds.has(c.id))
      .map((c) => c.id);
    if (ids.length === 0) return;

    const runId = ++scanRunRef.current;
    const stale = () =>
      !mountedRef.current ||
      scanRunRef.current !== runId ||
      selectedBillIdRef.current !== billId;

    setScanning(true);
    setScanBillId(billId);
    setScanRows(ids.map((clientId) => ({ clientId, status: "queued" as const })));

    const setRow = (clientId: string, patch: Partial<ScanRow>) =>
      setScanRows((rows) =>
        rows.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)),
      );

    let done = 0;
    let failed = 0;
    for (const clientId of ids) {
      if (stale()) return;
      setRow(clientId, { status: "running" });
      try {
        await api.clientImpact.analyze(clientId, billId);
        if (stale()) return;
        setRow(clientId, { status: "done" });
        done += 1;
      } catch (err: unknown) {
        if (stale()) return;
        const msg = err instanceof Error ? err.message : String(err);
        setRow(clientId, { status: "failed", reason: truncate(msg, 140) });
        failed += 1;
      }
    }
    if (stale()) return;
    setScanning(false);
    nav.toast(
      failed === 0
        ? `Scan complete · ${done} brief${done === 1 ? "" : "s"} ready`
        : `Scan complete · ${done} brief${done === 1 ? "" : "s"} ready · ${failed} failed`,
    );
  }

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Client Scan"]}
        title="Client Scan"
        sub="Scan counsel-approved bill changes against your client base — every selected client gets an impact brief."
        hint={{
          title: "Stage 3 — Client scan",
          body: "Pick a bill whose amendments counsel approved in stage 2, select the clients to test it against, then run the scan. Each client gets its own impact brief.",
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
        <div className="scanner-grid">
          {/* ── Clients: multi-select + manage ── */}
          <div className="card">
            <div className="card-h">
              <div className="card-title-row">
                <FontAwesomeIcon icon={faUsers} aria-hidden="true" />
                <div className="card-title">Clients</div>
              </div>
              <button
                className="btn ghost sm"
                data-testid="select-all-clients"
                disabled={scanning || clients.length === 0}
                onClick={toggleAllClients}
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="client-list" data-testid="client-list">
              {!clientsLoaded && (
                <div className="empty-small">Loading clients…</div>
              )}
              {clientsLoaded && clients.length === 0 && (
                <div className="empty-small">
                  No clients yet — add one with “New client”.
                </div>
              )}
              {clients.map((c) => {
                const selected = selectedClientIds.has(c.id);
                const confirming = confirmDeleteId === c.id;
                return (
                  <div
                    key={c.id}
                    className={`client-row cs-client-row${selected ? " active" : ""}${confirming ? " confirming" : ""}`}
                    data-testid="client-row"
                    data-client-id={c.id}
                    onClick={() => toggleClient(c.id)}
                  >
                    <div className="cs-client-main">
                      <input
                        type="checkbox"
                        className="cs-client-check"
                        data-testid="client-checkbox"
                        checked={selected}
                        disabled={scanning}
                        aria-label={`Include ${c.name} in the scan`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleClient(c.id)}
                      />
                      <div className="cs-client-info">
                        <div className="nm">{c.name}</div>
                        <div className="meta">
                          {c.industry || "—"}
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
                      <div
                        className="cs-confirm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span>
                          Delete {c.name}? Its stored briefs are removed too.
                        </span>
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

          <div className="scanner-stack">
            {/* ── 1. Ready-to-scan bills ── */}
            <div className="card">
              <div className="card-h">
                <div className="card-title-row">
                  <FontAwesomeIcon icon={faListCheck} aria-hidden="true" />
                  <div className="card-title">Ready to scan</div>
                </div>
                <span className="cs-count">({readyBills.length})</span>
              </div>
              <div className="card-pad">
                {!readyLoaded && (
                  <div className="empty-small">
                    Checking for scan-ready bills…
                  </div>
                )}
                {readyLoaded && readyBills.length === 0 && (
                  <div className="rd-empty" data-testid="ready-empty">
                    No bills have approved changes yet — complete stage 2
                    (Legal delta) first.
                    <div className="cs-empty-cta">
                      <button className="btn" onClick={() => nav.go("delta")}>
                        Open Legal delta
                        <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
                {readyLoaded && readyBills.length > 0 && (
                  <div
                    className="lpg-grid bpg-grid"
                    data-testid="ready-bill-list"
                  >
                    {readyBills.map((b) => {
                      const isActive = b.billId === selectedBillId;
                      return (
                        <div
                          key={b.billId}
                          className={`card lpg-card cs-ready-card${isActive ? " active" : ""}`}
                          data-testid="ready-bill-card"
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
                          <div className="lpg-top">
                            <span className="lpg-bill">{b.billNumber}</span>
                            <span className="cs-ops-pill">
                              {b.approvedOpCount} approved change
                              {b.approvedOpCount === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="lpg-title">
                            {b.shortTitle || b.title}
                          </div>
                          <div className="cs-ready-acts">
                            Amends: {b.actTitles.join(" · ")}
                          </div>
                          <div className="cs-ready-foot">
                            <span>
                              {b.status}
                              {b.session ? ` · ${b.session}` : ""}
                            </span>
                            {fmtWhen(b.computedAt) && (
                              <span>Delta {fmtWhen(b.computedAt)}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── 2. Approved changes for the selected bill ── */}
            {selectedBillId && selectedReady && (
              <div className="card" data-testid="approved-summary">
                <div className="card-h">
                  <div className="card-title-row">
                    <FontAwesomeIcon icon={faListCheck} aria-hidden="true" />
                    <div className="card-title">
                      Approved changes — {selectedReady.billNumber}
                    </div>
                  </div>
                  <span className="cs-count">
                    ({detail?.approvedCount ?? selectedReady.approvedOpCount})
                  </span>
                </div>
                <div className="card-pad">
                  {detailLoading && (
                    <div className="empty-small">Loading approved changes…</div>
                  )}
                  {!detailLoading && detail && detail.changes.length === 0 && (
                    <div className="empty-small">
                      No approved changes resolved for this bill.
                    </div>
                  )}
                  {detail?.changes.map((change) => (
                    <div
                      key={change.slug}
                      className="cs-act"
                      data-testid="approved-act"
                      data-slug={change.slug}
                    >
                      <div className="cs-act-head">
                        <span className="cs-act-title">{change.actTitle}</span>
                        <span className="cs-act-citation">
                          {change.citation}
                        </span>
                      </div>
                      {change.ops.map((op) => (
                        <div
                          key={op.key}
                          className="cs-op"
                          data-testid="approved-op"
                          data-key={op.key}
                        >
                          <div className="cs-op-head">
                            <span className={`dr-op is-${op.op}`}>
                              {OP_LABEL[op.op]}
                            </span>
                            <span className="cs-op-anchor">
                              {op.anchor ??
                                (op.op === "add"
                                  ? "(new provision)"
                                  : "(unresolved location)")}
                            </span>
                            {op.marginalNote && (
                              <span className="cs-op-note">
                                {op.marginalNote}
                              </span>
                            )}
                          </div>
                          <div className="cs-op-instruction">
                            {op.instruction}
                          </div>
                          {(op.beforeText || op.afterText) && (
                            <div className="cs-op-diff">
                              {op.beforeText && (
                                <div className="cs-snippet is-before">
                                  <span className="cs-snippet-sign">−</span>
                                  <span className="cs-snippet-text">
                                    {truncate(op.beforeText)}
                                  </span>
                                </div>
                              )}
                              {op.afterText && (
                                <div className="cs-snippet is-after">
                                  <span className="cs-snippet-sign">+</span>
                                  <span className="cs-snippet-text">
                                    {truncate(op.afterText)}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* ── 3. Run the scan + live progress ── */}
            <div className="card">
              <div className="card-h">
                <div className="card-title-row">
                  <FontAwesomeIcon icon={faPlay} aria-hidden="true" />
                  <div className="card-title">Run scan</div>
                </div>
                {scanning && <span className="cs-count">scanning…</span>}
              </div>
              <div className="scanner-card-body">
                <div className="kv kv-compact">
                  <div className="k">Bill</div>
                  <div className="v">
                    {selectedReady
                      ? `${selectedReady.billNumber} — ${selectedReady.shortTitle || selectedReady.title}`
                      : "Select a ready bill above."}
                  </div>
                </div>
                <div className="actions-row">
                  <button
                    className="btn primary"
                    data-testid="run-scan"
                    disabled={!canRun}
                    onClick={() => void runScan()}
                  >
                    {scanning ? "Scanning…" : "Run scan"}
                    <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                  </button>
                </div>
                {scanRows.length > 0 && (
                  <div className="cs-scan-rows">
                    {scanRows.map((r) => {
                      const c = clients.find((x) => x.id === r.clientId);
                      return (
                        <div
                          key={r.clientId}
                          className="cs-scan-row"
                          data-testid="scan-row"
                          data-client-id={r.clientId}
                        >
                          <span className="cs-scan-client">
                            {c?.name ?? r.clientId}
                          </span>
                          {r.status === "failed" && r.reason && (
                            <span className="cs-scan-reason" title={r.reason}>
                              {r.reason}
                            </span>
                          )}
                          <span
                            className={`cs-status is-${r.status}`}
                            data-testid="scan-status"
                          >
                            {r.status}
                          </span>
                          {r.status === "done" && (
                            <button
                              className="btn ghost sm"
                              data-testid="view-brief"
                              onClick={() =>
                                nav.go("impact", {
                                  clientId: r.clientId,
                                  billId: scanBillId,
                                })
                              }
                            >
                              View brief
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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

// Create/edit modal — create posts a new client, edit pre-fills and PUTs.
function ClientModal({
  client,
  onClose,
  onSaved,
}: {
  client: Client | null;
  onClose: () => void;
  onSaved: (c: Client, mode: "create" | "edit") => void;
}) {
  const [form, setForm] = useState(() => ({
    name: client?.name ?? "",
    industry: client?.industry ?? "",
    jurisdictions: (client?.jurisdictions ?? []).join(", "),
    description: client?.description ?? "",
    termsAndConditions: client?.termsAndConditions ?? "",
    policies: client?.policies ?? "",
    operations: client?.operations ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canSubmit = form.name.trim().length > 0 && !busy;

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const payload: Partial<Client> = {
        name: form.name.trim(),
        industry: form.industry,
        jurisdictions: form.jurisdictions
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        description: form.description,
        termsAndConditions: form.termsAndConditions,
        policies: form.policies,
        operations: form.operations,
      };
      const saved = client
        ? await updateClient(client.id, payload)
        : await api.clients.create(payload);
      onSaved(saved, client ? "edit" : "create");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not save client: ${msg}`);
      setBusy(false);
    }
  }

  return (
    <div className="rd-modal-backdrop" onClick={onClose}>
      <div
        className="rd-modal"
        data-testid="client-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rd-modal-h">{client ? "Edit client" : "New client"}</div>
        <div className="rd-modal-b">
          <div className="rd-field">
            <label>Name</label>
            <input
              data-testid="client-name-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Corebloom Health Inc."
            />
          </div>
          <div className="modal-grid-2">
            <div className="rd-field">
              <label>Industry</label>
              <input
                data-testid="client-industry-input"
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
            </div>
            <div className="rd-field">
              <label>Jurisdictions (comma-sep)</label>
              <input
                data-testid="client-jurisdictions-input"
                value={form.jurisdictions}
                onChange={(e) =>
                  setForm({ ...form, jurisdictions: e.target.value })
                }
              />
            </div>
          </div>
          <div className="rd-field">
            <label>Description</label>
            <textarea
              data-testid="client-description-input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="rd-field">
            <label>Terms &amp; Conditions</label>
            <textarea
              data-testid="client-tc-input"
              value={form.termsAndConditions}
              onChange={(e) =>
                setForm({ ...form, termsAndConditions: e.target.value })
              }
            />
          </div>
          <div className="rd-field">
            <label>Policies</label>
            <textarea
              data-testid="client-policies-input"
              value={form.policies}
              onChange={(e) => setForm({ ...form, policies: e.target.value })}
            />
          </div>
          <div className="rd-field">
            <label>Operations</label>
            <textarea
              data-testid="client-operations-input"
              value={form.operations}
              onChange={(e) => setForm({ ...form, operations: e.target.value })}
            />
          </div>
          {error && <div className="cs-modal-error">{error}</div>}
        </div>
        <div className="rd-modal-f">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            data-testid="client-modal-save"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : client ? "Save changes" : "Add client"}
          </button>
        </div>
      </div>
    </div>
  );
}
