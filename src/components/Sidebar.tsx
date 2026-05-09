import type { PageId } from "../App";

const ITEMS: { id: PageId; num: string; label: string }[] = [
  { id: "monitor", num: "01", label: "Bill Monitor" },
  { id: "delta", num: "02", label: "Delta Workspace" },
  { id: "scanner", num: "03", label: "Client-Law Scanner" },
  { id: "impact", num: "04", label: "Client Impact Analysis" },
];

export function Sidebar({
  page,
  setPage,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
}) {
  return (
    <aside className="sb">
      <div className="sb-brand">
        <div className="sb-mark">Rd</div>
        <div>
          <div className="sb-name">
            <b>RegDelta</b>
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--sidebar-ink-2)",
              letterSpacing: "0.04em",
              marginTop: 2,
            }}
          >
            LEGISLATION INTELLIGENCE
          </div>
        </div>
      </div>

      <div className="sb-section">Workspaces</div>
      <nav className="sb-nav">
        {ITEMS.map((it) => (
          <button
            key={it.id}
            className={page === it.id ? "active" : ""}
            onClick={() => setPage(it.id)}
          >
            <span className="sb-num">{it.num}</span>
            <span>{it.label}</span>
          </button>
        ))}
      </nav>

      <div className="sb-foot">
        <div className="sb-user">
          <div className="sb-avatar">MT</div>
          <div>
            <div className="sb-user-name">Maude Tremblay</div>
            <div className="sb-user-role">Senior Counsel · Privacy</div>
          </div>
        </div>
        <div className="sb-build">RegDelta · MVP</div>
      </div>
    </aside>
  );
}
