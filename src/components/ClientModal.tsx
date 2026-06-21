import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { updateClient } from "../lib/clientScan";
import type { Client } from "../types";

// Create/edit client modal - create posts a new client, edit pre-fills and PUTs.
// Shared by the law-first scanner (Stage 3) and the client-first exposure board
// so the client profile (the inputs every scan is measured against) is captured
// identically in both entry points.
export function ClientModal({
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
