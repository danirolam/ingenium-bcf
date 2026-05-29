import { useEffect, useState } from "react";
import type { PageId } from "../App";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBriefcase,
  faCodeCompare,
  faFileLines,
  faMagnifyingGlassChart,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { api } from "../lib/api";

type SidebarItem = {
  id: PageId;
  num: string;
  label: string;
  description: string;
  icon: IconDefinition;
};

const ITEMS: SidebarItem[] = [
  {
    id: "monitor",
    num: "01",
    label: "Bill Monitor",
    icon: faFileLines,
    description: "Retrieve and normalize bill records before they enter legal review.",
  },
  {
    id: "delta",
    num: "02",
    label: "Delta Workspace",
    icon: faCodeCompare,
    description: "Compare proposed amendments against current law, Act by Act.",
  },
  {
    id: "scanner",
    num: "03",
    label: "Client-Law Scanner",
    icon: faMagnifyingGlassChart,
    description: "Pair approved law versions with client materials for impact screening.",
  },
  {
    id: "impact",
    num: "04",
    label: "Client Impact Analysis",
    icon: faBriefcase,
    description: "Review client-specific exposure, actions, timelines, and recommendations.",
  },
];

export function Sidebar({
  page,
  setPage,
  onExit,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  onExit?: () => void;
}) {
  const [tallies, setTallies] = useState<Record<PageId, number | null>>({
    monitor: null,
    delta: null,
    scanner: null,
    impact: null,
  });

  useEffect(() => {
    Promise.all([
      api.bills.list().catch(() => []),
      api.lawVersions.list().catch(() => []),
      api.clients.list().catch(() => []),
    ])
      .then(([bills, lvs, clients]) => {
        const approved = lvs.filter(
          (lv) => lv.humanApproved && !lv.baseLawId.startsWith("unregistered:"),
        ).length;
        setTallies({
          monitor: bills.length,
          delta: lvs.length,
          scanner: approved * clients.length,
          impact: approved,
        });
      })
      .catch(() => {});
  }, [page]);

  return (
    <aside className="sb">
      <button
        type="button"
        className="sb-brand sb-brand-button"
        onClick={onExit}
        aria-label="Back to landing page"
      >
        <div className="sb-mark" aria-hidden="true" />
        <div>
          <div className="sb-name">BCF</div>
          <div className="sb-subname">by <span>Ingenium</span></div>
        </div>
        <FontAwesomeIcon
          icon={faArrowLeft}
          className="sb-back-arrow"
          aria-hidden="true"
        />
      </button>

      <div className="sb-section">Workspaces</div>
      <nav className="sb-nav">
        {ITEMS.map((it) => {
          const t = tallies[it.id];
          return (
            <button
              key={it.id}
              className={page === it.id ? "active" : ""}
              onClick={() => setPage(it.id)}
            >
              <FontAwesomeIcon icon={it.icon} className="sb-icon" aria-hidden="true" />
              <span className="sb-num">{it.num}</span>
              <span className="sb-label">{it.label}</span>
              {typeof t === "number" && t > 0 && (
                <span className="sb-tag">{t}</span>
              )}
              <span className="sb-help" role="tooltip">{it.description}</span>
            </button>
          );
        })}
      </nav>

      <div className="sb-foot">
        <div className="sb-user">
          <div className="sb-avatar">MT</div>
          <div>
            <div className="sb-user-name">Maude Tremblay</div>
            <div className="sb-user-role">Senior Counsel · Privacy</div>
          </div>
        </div>
        <div className="sb-build">BCF · Ingenium build</div>
      </div>
    </aside>
  );
}
