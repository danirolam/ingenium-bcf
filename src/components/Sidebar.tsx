import type { PageId } from "../App";

const ITEMS: { id: PageId; num: string; label: string; tally?: string }[] = [
  { id: "monitor", num: "01", label: "Bill Monitor", tally: "12" },
  { id: "delta", num: "02", label: "Delta Workspace", tally: "3" },
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
        <div className="sb-mark">In</div>
        <div>
          <div className="sb-name">
            <b>Injenium</b>
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: "0.06em",
              marginTop: 2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            45-1 · v0.1
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
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.tally && <span className="sb-tag">{it.tally}</span>}
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
        <div className="sb-build">Injenium / build 0d4d6f4</div>
      </div>
    </aside>
  );
}
