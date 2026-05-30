import { Fragment, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRightFromBracket,
  faChevronRight,
  faCircleQuestion,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { PageId } from "../App";
import { WORKFLOW_STEPS, activeStepIndex } from "../lib/workflow";
import { Tooltip } from "./Tooltip";

// The workspace top rail. It does three jobs at once: shows where you are
// (breadcrumb), shows the whole pipeline as a left-to-right flow (numbered
// stages joined by chevrons), and explains every part on hover. The "?" opens
// a guide that spells the flow out in full.
export function WorkflowNav({
  page,
  setPage,
  onExit,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  onExit?: () => void;
}) {
  const activeIndex = activeStepIndex(page);
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

  return (
    <header className="shell-bar">
      <div className="shell-crumbs">
        <Tooltip title="BCF · Ingenium" body="Return to the overview." placement="bottom">
          <button type="button" className="shell-brand" onClick={onExit}>
            <span className="shell-mark" aria-hidden="true" />
            <span className="shell-brand-name">BCF</span>
          </button>
        </Tooltip>
        <FontAwesomeIcon
          icon={faChevronRight}
          className="shell-crumb-sep"
          aria-hidden="true"
        />
        <Tooltip
          title="Workspace overview"
          body="The command center — pipeline status and where to start."
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

      <nav className="shell-flow" aria-label="Workflow stages">
        {WORKFLOW_STEPS.map((s, i) => {
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
                  onClick={() => setPage(s.id)}
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
                Ingenium turns a federal bill into a client-ready memo in four
                stages. Click any stage to jump to it.
              </p>
              <ol className="shell-help-steps">
                {WORKFLOW_STEPS.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPage(s.id);
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
