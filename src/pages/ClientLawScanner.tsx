import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileCheck2, Plus, Sparkles } from "lucide-react";
import type { Nav } from "../App";
import { ClientSelector } from "../components/ClientSelector";
import { LawPickerGrid } from "../components/LawPickerGrid";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import type { Client, LawVersion } from "../types";

export function ClientLawScanner({ nav }: { nav: Nav }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [lvs, setLvs] = useState<LawVersion[]>([]);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [activeLvId, setActiveLvId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    Promise.all([api.clients.list(), api.lawVersions.list()]).then(
      ([cs, ls]) => {
        setClients(cs);
        setLvs(ls);
        if (!activeClient && cs.length > 0) setActiveClient(cs[0]);
        const approved = ls.filter(
          (lv) => lv.humanApproved && !lv.baseLawId.startsWith("unregistered:"),
        );
        if (!activeLvId && approved.length > 0) setActiveLvId(approved[0].id);
      },
    );
  }, []);

  const approvedLvs = useMemo(
    () => lvs.filter((lv) => lv.humanApproved && !lv.baseLawId.startsWith("unregistered:")),
    [lvs],
  );
  const activeLv = approvedLvs.find((lv) => lv.id === activeLvId) ?? null;

  async function analyze() {
    if (!activeClient || !activeLv) return;
    setBusy(true);
    try {
      const { analysis, email } = await api.clientImpact.analyze(
        activeClient.id,
        activeLv.id,
      );
      nav.toast(
        email.simulated
          ? "Analysis ready · Email simulated."
          : "Analysis ready · Email sent.",
      );
      nav.go("impact", { id: analysis.id });
    } catch (err: any) {
      nav.toast(`Analysis failed: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Client-Law Scanner"]}
        title="Client-Law Scanner"
        sub="Pair an approved updated law with a client to generate a client-specific impact analysis."
        actions={
          <button className="btn primary" onClick={() => setShowNew(true)}>
            <Plus size={16} strokeWidth={1.9} aria-hidden="true" />
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
                  <FileCheck2 size={16} strokeWidth={1.8} aria-hidden="true" />
                  <div className="card-title">Approved laws ready for matching</div>
                </div>
                <span className="cs-count">({approvedLvs.length})</span>
              </div>
              <div className="card-pad">
                <LawPickerGrid
                  lawVersions={approvedLvs}
                  activeId={activeLvId}
                  onSelect={setActiveLvId}
                />
              </div>
            </div>

            <div className="card">
              <div className="card-h">
                <div className="card-title-row">
                  <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
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
                      <div className="v">{activeClient.jurisdictions.join(", ")}</div>
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

                <div className="actions-row">
                  <button
                    className="btn primary"
                    disabled={busy || !activeClient || !activeLv}
                    onClick={analyze}
                  >
                    {busy ? "Analyzing..." : "Analyze client impact"}
                    <ArrowRight size={15} strokeWidth={1.9} aria-hidden="true" />
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

  async function submit() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const c = await api.clients.create(form as any);
      onCreated(c);
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
              placeholder="Corebloom Health AI Inc."
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
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Add client"}
          </button>
        </div>
      </div>
    </div>
  );
}
