import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faScroll,
  faPlus,
  faScaleBalanced,
} from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import { ClientSelector } from "../components/ClientSelector";
import { BillPickerGrid } from "../components/BillPickerGrid";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import type { Bill, Client } from "../types";

export function ClientLawScanner({ nav }: { nav: Nav }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [activeBillId, setActiveBillId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    Promise.all([api.clients.list(), api.bills.list()])
      .then(([cs, bs]) => {
        setClients(cs);
        setBills(bs);
        if (!activeClient && cs.length > 0) setActiveClient(cs[0]);
      })
      .catch((err) => {
        console.error(err);
        nav.toast(`Could not load scanner data: ${err.message ?? err}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeBill = bills.find((b) => b.id === activeBillId) ?? null;

  async function analyze() {
    if (!activeClient || !activeBill) return;
    setBusy(true);
    try {
      const { email } = await api.clientImpact.analyze(
        activeClient.id,
        activeBill.id,
      );
      nav.toast(
        email.simulated
          ? "Analysis ready · Email simulated."
          : "Analysis ready · Email sent.",
      );
      nav.go("impact", { clientId: activeClient.id, billId: activeBill.id });
    } catch (err: any) {
      nav.toast(`Analysis failed: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Client Scan"]}
        title="Client Scan"
        sub="Pair a bill with a client to generate a client-specific impact brief."
        actions={
          <button className="btn primary" onClick={() => setShowNew(true)}>
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            New client
          </button>
        }
      />
      <div className="body">
        <div className="scanner-grid">
          <ClientSelector
            clients={clients}
            activeId={activeClient?.id}
            onSelect={setActiveClient}
          />

          <div className="scanner-stack">
            <div className="card">
              <div className="card-h">
                <div className="card-title-row">
                  <FontAwesomeIcon icon={faScroll} aria-hidden="true" />
                  <div className="card-title">Pick a bill to match</div>
                </div>
                <span className="cs-count">({bills.length})</span>
              </div>
              <div className="card-pad">
                <BillPickerGrid
                  bills={bills}
                  activeId={activeBillId}
                  onSelect={setActiveBillId}
                />
              </div>
            </div>

            <div className="card">
              <div className="card-h">
                <div className="card-title-row">
                  <FontAwesomeIcon icon={faScaleBalanced} aria-hidden="true" />
                  <div className="card-title">Generate client impact</div>
                </div>
              </div>
              <div className="scanner-card-body">
                <div>
                  <div className="section-label">
                    Client materials included in analysis
                  </div>
                  {activeClient ? (
                    <div className="kv kv-compact">
                      <div className="k">Client</div>
                      <div className="v">{activeClient.name}</div>
                      <div className="k">Industry</div>
                      <div className="v">{activeClient.industry}</div>
                      <div className="k">Jurisdictions</div>
                      <div className="v">{(activeClient.jurisdictions ?? []).join(", ") || "—"}</div>
                      <div className="k">T&amp;C</div>
                      <div className="v">{activeClient.termsAndConditions ? "Included" : "Not provided"}</div>
                      <div className="k">Policies</div>
                      <div className="v">{activeClient.policies ? "Included" : "Not provided"}</div>
                      <div className="k">Operations</div>
                      <div className="v">{activeClient.operations ? "Included" : "Not provided"}</div>
                    </div>
                  ) : (
                    <div className="empty-small">
                      Select a client from the list.
                    </div>
                  )}
                </div>

                <div className="hr" />

                <div className="kv kv-compact">
                  <div className="k">Bill</div>
                  <div className="v">
                    {activeBill
                      ? `${activeBill.billNumber} — ${activeBill.title}`
                      : "Select a bill above."}
                  </div>
                </div>

                <div className="hr" />

                <div className="actions-row">
                  <button
                    className="btn primary"
                    disabled={busy || !activeClient || !activeBill}
                    onClick={analyze}
                  >
                    {busy ? "Analyzing..." : "Analyze client impact"}
                    <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showNew && (
        <NewClientModal
          onClose={() => setShowNew(false)}
          onCreated={(c) => {
            setClients((arr) => [c, ...arr]);
            setActiveClient(c);
            setShowNew(false);
            nav.toast("Client added.");
          }}
        />
      )}
    </>
  );
}

function NewClientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: Client) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    industry: "",
    jurisdictions: "",
    description: "",
    termsAndConditions: "",
    policies: "",
    operations: "",
  });
  const [busy, setBusy] = useState(false);
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
    try {
      const c = await api.clients.create(form as unknown as Partial<Client>);
      onCreated(c);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Could not add client: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rd-modal-backdrop" onClick={onClose}>
      <div className="rd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rd-modal-h">New client</div>
        <div className="rd-modal-b">
          <div className="rd-field">
            <label>Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Corebloom Health Inc."
            />
          </div>
          <div className="modal-grid-2">
            <div className="rd-field">
              <label>Industry</label>
              <input
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
            </div>
            <div className="rd-field">
              <label>Jurisdictions (comma-sep)</label>
              <input
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
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="rd-field">
            <label>Terms &amp; Conditions</label>
            <textarea
              value={form.termsAndConditions}
              onChange={(e) =>
                setForm({ ...form, termsAndConditions: e.target.value })
              }
            />
          </div>
          <div className="rd-field">
            <label>Policies</label>
            <textarea
              value={form.policies}
              onChange={(e) => setForm({ ...form, policies: e.target.value })}
            />
          </div>
          <div className="rd-field">
            <label>Operations</label>
            <textarea
              value={form.operations}
              onChange={(e) => setForm({ ...form, operations: e.target.value })}
            />
          </div>
        </div>
        <div className="rd-modal-f">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canSubmit} onClick={submit}>
            {busy ? "Saving…" : "Add client"}
          </button>
        </div>
      </div>
    </div>
  );
}
