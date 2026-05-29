import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBinoculars,
  faCodeCompare,
  faMagnifyingGlassChart,
  faFileSignature,
  faArrowRightFromBracket,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { PageId } from "../App";

type StepId = "monitor" | "delta" | "scanner" | "impact";

const STEPS: { id: StepId; num: string; label: string; desc: string; icon: IconDefinition }[] = [
  { id: "monitor", num: "01", label: "Monitor", desc: "Track every federal bill", icon: faBinoculars },
  { id: "delta", num: "02", label: "Legal delta", desc: "See what each bill changes", icon: faCodeCompare },
  { id: "scanner", num: "03", label: "Client scan", desc: "Match changes to clients", icon: faMagnifyingGlassChart },
  { id: "impact", num: "04", label: "Client brief", desc: "Draft the exposure memo", icon: faFileSignature },
];

// The product is a four-stage pipeline; the top rail makes that flow legible
// instead of presenting four interchangeable menu items. A bill-detail view is
// part of the Monitor stage, so it keeps step 01 lit.
export function WorkflowNav({
  page,
  setPage,
  onExit,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  onExit?: () => void;
}) {
  const activeId: StepId = page === "bill" ? "monitor" : (page as StepId);
  const activeIndex = STEPS.findIndex((s) => s.id === activeId);

  return (
    <header className="shell-bar">
      <button
        type="button"
        className="shell-brand"
        onClick={onExit}
        title="Back to overview"
      >
        <span className="shell-mark" aria-hidden="true" />
        <span className="shell-brand-text">
          <span className="shell-name">BCF</span>
          <span className="shell-sub">Legislative intelligence</span>
        </span>
      </button>

      <nav className="shell-flow" aria-label="Workflow stages">
        {STEPS.map((s, i) => {
          const active = i === activeIndex;
          const done = i < activeIndex;
          return (
            <button
              key={s.id}
              type="button"
              className={`shell-step${active ? " is-active" : ""}${done ? " is-done" : ""}`}
              onClick={() => setPage(s.id)}
              aria-current={active ? "page" : undefined}
            >
              <span className="shell-step-num">{s.num}</span>
              <span className="shell-step-text">
                <span className="shell-step-label">
                  <FontAwesomeIcon icon={s.icon} aria-hidden="true" />
                  {s.label}
                </span>
                <span className="shell-step-desc">{s.desc}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="shell-id">
        <div className="shell-user">
          <span className="shell-avatar" aria-hidden="true">
            MT
          </span>
          <span className="shell-user-text">
            <span className="shell-user-name">Maude Tremblay</span>
            <span className="shell-user-role">Senior Counsel · BCF</span>
          </span>
        </div>
        <button
          type="button"
          className="shell-exit"
          onClick={onExit}
          title="Exit to overview"
          aria-label="Exit to overview"
        >
          <FontAwesomeIcon icon={faArrowRightFromBracket} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
