import { useState } from "react";
import type { Client } from "../types";

export function ClientSelector({
  clients,
  activeId,
  onSelect,
}: {
  clients: Client[];
  activeId?: string;
  onSelect: (c: Client) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="card">
      <div className="card-h">
        <div className="card-title">Clients</div>
        <span className="badge outline dim">{clients.length}</span>
      </div>
      <div
        style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}
      >
        <div className="search">
          <span className="muted">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients"
          />
        </div>
      </div>
      <div className="client-list">
        {filtered.length === 0 && (
          <div style={{ padding: 18 }} className="muted">
            No clients yet.
          </div>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`client-row ${activeId === c.id ? "active" : ""}`}
            onClick={() => onSelect(c)}
          >
            <div className="nm">{c.name}</div>
            <div className="meta">
              {c.industry}
              {c.jurisdictions.length > 0 && ` · ${c.jurisdictions.join(", ")}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
