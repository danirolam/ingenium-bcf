import { Fragment, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRightFromBracket,
  faChevronRight,
  faCircleQuestion,
  faScroll,
  faUserShield,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { PageId } from "../App";
import {
  activeStepIndex,
  effectiveMode,
  entryPage,
  workflowSteps,
} from "../lib/workflow";
import { setViewMode, useViewMode, type ViewMode } from "../lib/viewMode";
import { Tooltip } from "./Tooltip";

// The workspace top rail. It does four jobs at once: shows where you are
// (breadcrumb), lets you flip the pipeline's orientation (the mode switch),
// shows the whole pipeline as a left-to-right flow (numbered stages joined by
// chevrons), and explains every part on hover. The "?" opens a guide that
// spells the current orientation out in full.
export function WorkflowNav({
  page,
  params,
  setPage,
  onExit,
}: {
  page: PageId;
  params: Record<string, string>;
  setPage: (p: PageId) => void;
  onExit?: () => void;
}) {
  const userMode = useViewMode();
  // The page you're on can force its orientation, so the visible steps always
  // match the page. Shared pages (delta, brief, overview) honor your choice.
  const mode = effectiveMode(userMode, page);
  const steps = workflowSteps(mode);
  const activeIndex = activeStepIndex(mode, page, params);

  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const onDown = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setHelpOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelpOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [helpOpen]);

  // Flip orientation: always persist the intent; navigate to the new pipeline's
  // start only when the orientation actually changes (so re-clicking the active
  // option never throws away your place).
  function pick(next: ViewMode) {
    setViewMode(next);
    if (next !== mode) setPage(entryPage(next));
  }

  const other: ViewMode = mode === "client-first" ? "law-first" : "client-first";

  return (
    <header className="shell-bar">
      <div className="shell-crumbs">
        <Tooltip title="Ingenium" body="Return to the overview." placement="bottom">
          <button type="button" className="shell-brand" onClick={onExit}>
            <span className="shell-mark" aria-hidden="true">
              In
            </span>
            <span className="shell-brand-name">Ingenium</span>
          </button>
        </Tooltip>
        <FontAwesomeIcon
          icon={faChevronRight}
          className="shell-crumb-sep"
          aria-hidden="true"
        />
        <Tooltip
          title="Workspace overview"
          body="The command center, with pipeline status and where to start."
          placement="bottom"
        >
          <button
            type="button"
            className={`shell-crumb${page === "overview" ? " is-current" : ""}`}
            onClick={() => setPage("overview")}
            aria-current={page === "overview" ? "page" : undefined}
          >
            Legislative workspace
          </button>
        </Tooltip>
      </div>

      {/* Orientation switch: which end of the same pipeline you work from. */}
      <div className="shell-mode" role="group" aria-label="Pipeline orientation">
        <Tooltip
          title="Work by bill"
          body="Start from a bill, find the clients it exposes, then brief them. The classic pipeline."
          placement="bottom"
        >
          <button
            type="button"
            className={`shell-mode-opt${mode === "law-first" ? " is-on" : ""}`}
            data-testid="mode-law-first"
            aria-pressed={mode === "law-first"}
            onClick={() => pick("law-first")}
          >
            <FontAwesomeIcon icon={faScroll} aria-hidden="true" />
            <span className="shell-mode-label">By bill</span>
          </button>
        </Tooltip>
        <Tooltip
          title="Work by client"
          body="Start from a client, rank every bill by how dangerous it is to them, then brief them on each. The reverse view."
          placement="bottom"
        >
          <button
            type="button"
            className={`shell-mode-opt${mode === "client-first" ? " is-on" : ""}`}
            data-testid="mode-client-first"
            aria-pressed={mode === "client-first"}
            onClick={() => pick("client-first")}
          >
            <FontAwesomeIcon icon={faUserShield} aria-hidden="true" />
            <span className="shell-mode-label">By client</span>
          </button>
        </Tooltip>
      </div>

      <nav className="shell-flow" aria-label="Workflow stages">
        {steps.map((s, i) => {
          const active = i === activeIndex;
          const done = i < activeIndex;
          return (
            <Fragment key={s.id}>
              {i > 0 && (
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className="shell-flow-sep"
                  aria-hidden="true"
                />
              )}
              <Tooltip
                placement="bottom"
                title={`${s.num} · ${s.label}`}
                body={
                  <>
                    {s.detail}
                    <span className="tt-produces">{s.produces}</span>
                  </>
                }
              >
                <button
                  type="button"
                  className={`shell-step${active ? " is-active" : ""}${done ? " is-done" : ""}`}
                  onClick={() => setPage(s.page)}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="shell-step-num">{s.num}</span>
                  <span className="shell-step-text">
                    <span className="shell-step-label">
                      <FontAwesomeIcon icon={s.icon} aria-hidden="true" />
                      {s.label}
                    </span>
                    <span className="shell-step-desc">{s.purpose}</span>
                  </span>
                </button>
              </Tooltip>
            </Fragment>
          );
        })}
      </nav>

      <div className="shell-id">
        <div className="shell-help" ref={helpRef}>
          <Tooltip
            title="How this works"
            body="The four stages, start to finish."
            placement="bottom"
          >
            <button
              type="button"
              className={`shell-help-btn${helpOpen ? " is-open" : ""}`}
              aria-expanded={helpOpen}
              aria-haspopup="dialog"
              onClick={() => setHelpOpen((v) => !v)}
            >
              <FontAwesomeIcon icon={faCircleQuestion} aria-hidden="true" />
            </button>
          </Tooltip>
          {helpOpen && (
            <div className="shell-help-pop" role="dialog" aria-label="How this works">
              <div className="shell-help-head">
                <span>How this works</span>
                <button
                  type="button"
                  className="shell-help-x"
                  onClick={() => setHelpOpen(false)}
                  aria-label="Close"
                >
                  <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
                </button>
              </div>
              <p className="shell-help-lead">
                {mode === "client-first"
                  ? "Ingenium ranks the bills that threaten a client and turns each into a client-ready memo, in four stages. Click any stage to jump to it."
                  : "Ingenium turns a Canadian bill into a client-ready memo in four stages. Click any stage to jump to it."}
              </p>
              <ol className="shell-help-steps">
                {steps.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPage(s.page);
                        setHelpOpen(false);
                      }}
                    >
                      <span className="shell-help-num">{s.num}</span>
                      <span className="shell-help-text">
                        <b>{s.label}</b>
                        {s.detail}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="shell-help-flip"
                onClick={() => {
                  pick(other);
                  setHelpOpen(false);
                }}
              >
                {mode === "client-first"
                  ? "Switch to work by bill instead"
                  : "Switch to work by client instead"}
                <FontAwesomeIcon icon={faArrowRightFromBracket} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <span className="shell-divider" aria-hidden="true" />

        <Tooltip
          title="user001"
          body="Signed-in workspace session · BCF"
          placement="bottom"
        >
          <div className="shell-user" tabIndex={0}>
            <span className="shell-avatar" aria-hidden="true">
              U1
            </span>
            <span className="shell-user-text">
              <span className="shell-user-name">user001</span>
              <span className="shell-user-role">BCF workspace</span>
            </span>
          </div>
        </Tooltip>

        <Tooltip
          title="Exit to overview"
          body="Leave the workspace and return to the landing overview."
          placement="bottom"
        >
          <button
            type="button"
            className="shell-exit"
            onClick={onExit}
            aria-label="Exit to overview"
          >
            <FontAwesomeIcon icon={faArrowRightFromBracket} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
