import type { PageId } from "../App";
import {
  BriefcaseBusiness,
  FileText,
  GitCompareArrows,
  ScanSearch,
} from "lucide-react";

const ITEMS = [
  {
    id: "monitor",
    num: "01",
    label: "Bill Monitor",
    tally: "12",
    icon: FileText,
  },
  {
    id: "delta",
    num: "02",
    label: "Delta Workspace",
    tally: "3",
    icon: GitCompareArrows,
  },
  {
    id: "scanner",
    num: "03",
    label: "Client-Law Scanner",
    icon: ScanSearch,
  },
  {
    id: "impact",
    num: "04",
    label: "Client Impact Analysis",
    icon: BriefcaseBusiness,
  },
] as const;

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
        <div className="sb-mark" aria-hidden="true" />
        <div>
          <div className="sb-name">BCF</div>
          <div className="sb-subname">
            by <span>Injenium</span>
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
            <it.icon
              className="sb-icon"
              size={16}
              strokeWidth={1.8}
              aria-hidden="true"
            />
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
        <div className="sb-build">BCF · Injenium build</div>
      </div>
    </aside>
  );
}
