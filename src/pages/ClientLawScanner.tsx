import { useEffect, useMemo, useState } from "react";
import type { Nav } from "../App";
import { ClientSelector } from "../components/ClientSelector";
import { MomentumBadge } from "../components/badges";
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
        const approved = ls.filter((lv) => lv.humanApproved);
        if (!activeLvId && approved.length > 0) setActiveLvId(approved[0].id);
      },
    );
  }, []);

  const approvedLvs = useMemo(
    () =>
      lvs.filter(
        (lv) =>
          lv.humanApproved && !lv.baseLawId.startsWith("unregistered:"),
      ),
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
            + New client
          </button>
        }
      />
      <div className="body">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "280px minmax(0, 1fr)",
            gap: 18,
            alignItems: "start",
          }}
        >
          <ClientSelector
            clients={clients}
            activeId={activeClient?.id}
            onSelect={setActiveClient}
          />

          <div className="card">
            <div className="card-h">
              <div className="card-title">Run client impact analysis</div>
            </div>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
              <div className="rd-field">
                <label>Approved updated law</label>
                {approvedLvs.length === 0 ? (
                  <div className="note rd-amber" style={{ margin: 0 }}>
                    No approved law versions yet. Open a bill in the Delta Workspace
                    and click <b>Approve updated law</b> to make it selectable here.
                  </div>
                ) : (
                  <select
                    value={activeLvId}
                    onChange={(e) => setActiveLvId(e.target.value)}
                  >
                    {approvedLvs.map((lv) => (
                      <option key={lv.id} value={lv.id}>
                        {lv.sourceBillNumber} — {lv.baseLawTitle}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {activeLv && (
                <div className="kv" style={{ padding: 0 }}>
                  <div className="k">Bill</div>
                  <div className="v">
                    {activeLv.sourceBillNumber} — {activeLv.sourceBillTitle}
                  </div>
                  <div className="k">Momentum</div>
                  <div className="v">
                    <MomentumBadge value={activeLv.legislativeMomentum} />
                  </div>
                  <div className="k">Effective</div>
                  <div className="v">
                    {activeLv.effectiveDate ?? activeLv.comingIntoForceText ?? "—"}
                  </div>
                  <div className="k">Affected sections</div>
                  <div className="v">{activeLv.affectedSections.join(", ")}</div>
                </div>
              )}

              <div className="hr" />

              <div>
                <div
                  className="k"
                  style={{
                    fontSize: 11,
                    color: "var(--ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 8,
                  }}
                >
                  Client materials included in analysis
                </div>
                {activeClient ? (
                  <div className="kv" style={{ padding: 0 }}>
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
                  <div className="muted" style={{ fontSize: 13 }}>
                    Select a client from the list.
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  className="btn primary"
                  disabled={
                    busy || !activeClient || !activeLv || approvedLvs.length === 0
                  }
                  onClick={analyze}
                >
                  {busy ? "Analyzing…" : "Analyze client impact →"}
                </button>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
