import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faBars,
  faBriefcase,
  faCircleCheck,
  faCodeCompare,
  faFileLines,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

const WORKFLOW: { title: string; text: string; icon: IconDefinition }[] = [
  {
    title: "Retrieve the bill",
    text: "Start from Parliament and Justice source data, normalize the record, and keep the bill text beside the source law.",
    icon: faFileLines,
  },
  {
    title: "Review the legal delta",
    text: "Compare every affected Act against the current consolidated law before approving it for client analysis.",
    icon: faCodeCompare,
  },
  {
    title: "Match client exposure",
    text: "Turn lawyer-approved deltas into client-specific exposure, recommendations, and next actions.",
    icon: faBriefcase,
  },
];

const PRACTICES = [
  { num: "01", name: "Business & M&A", note: "Corporate statutes, competition review, and trade agreements" },
  { num: "02", name: "Banking & Securities", note: "Financial institutions, securities, and payments oversight" },
  { num: "03", name: "Taxation", note: "Income and excise measures, tariffs, and fiscal updates" },
  { num: "04", name: "Labour & Employment", note: "Workplace standards, pay equity, and the Canada Labour Code" },
  { num: "05", name: "Privacy & Technology", note: "Personal information, telecom, and online obligations" },
  { num: "06", name: "Litigation & Regulatory", note: "Criminal Code, evidence, and regulatory offences" },
];

const PREVIEW_ROWS: { id: string; title: string; tag: string; level: string }[] = [
  { id: "C-27", title: "Digital Charter Implementation Act", tag: "Privacy", level: "crit" },
  { id: "C-59", title: "Fall Economic Statement Implementation Act", tag: "Tax", level: "high" },
  { id: "C-56", title: "Affordable Housing and Groceries Act", tag: "Business", level: "med" },
  { id: "S-202", title: "Food and Drugs Act amendment", tag: "Health", level: "ok" },
];

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a className="lp-brand" href="#" onClick={(e) => e.preventDefault()}>
            <span className="lp-brand-dot" aria-hidden="true" />
            <span className="lp-brand-text">BCF</span>
          </a>

          <div className="lp-nav-actions">
            <button className="lp-nav-link" onClick={onLaunch}>
              Workspace
              <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
            <button
              className="lp-circle"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <FontAwesomeIcon icon={menuOpen ? faXmark : faBars} />
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="lp-drawer" role="dialog" aria-label="Navigation">
          <div className="lp-drawer-inner">
            <nav>
              <a href="#workflow" onClick={() => setMenuOpen(false)}>
                Workflow
              </a>
              <a href="#practices" onClick={() => setMenuOpen(false)}>
                Practice focus
              </a>
              <a href="#review" onClick={() => setMenuOpen(false)}>
                Review standard
              </a>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMenuOpen(false);
                  onLaunch();
                }}
              >
                Workspace
              </a>
            </nav>
          </div>
        </div>
      )}

      <section className="lp-hero">
        <div className="lp-hero-glow" aria-hidden="true" />
        <div className="lp-hero-inner">
          <div className="lp-hero-text">
            <div className="lp-eyebrow">Built for BCF by Ingenium</div>
            <h1 className="lp-h1">
              Bill change intelligence, ready for client work.
            </h1>
            <p className="lp-hero-copy">
              A premium review workspace for retrieving bills, comparing affected
              federal Acts, approving legal deltas, and turning them into clear
              client impact analysis.
            </p>
            <div className="lp-hero-actions">
              <button className="lp-primary" onClick={onLaunch}>
                Open workspace
                <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
              </button>
              <a className="lp-secondary" href="#workflow">
                See workflow
                <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="lp-hero-preview" aria-hidden="true">
            <div className="lp-pv-frame">
              <div className="lp-pv-bar">
                <span className="lp-pv-dot" />
                <span className="lp-pv-dot" />
                <span className="lp-pv-dot" />
                <span className="lp-pv-tab">Bill Monitor · 162 bills</span>
              </div>
              <div className="lp-pv-body">
                <div className="lp-pv-row lp-pv-head">
                  <span>Bill</span>
                  <span>Title</span>
                  <span>Practice</span>
                </div>
                {PREVIEW_ROWS.map((r) => (
                  <div className="lp-pv-row" key={r.id}>
                    <span className="lp-pv-id">{r.id}</span>
                    <span className="lp-pv-title">{r.title}</span>
                    <span className="lp-pv-tagcell">
                      <span className={`lp-pv-dotlvl lvl-${r.level}`} />
                      {r.tag}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="lp-workflow">
        <div className="lp-section-inner">
          <div className="lp-section-eyebrow">Workflow</div>
          <h2 className="lp-h2">Built around source-backed legal review.</h2>
          <div className="lp-workflow-grid">
            {WORKFLOW.map((item) => (
              <article className="lp-workflow-card" key={item.title}>
                <div className="lp-workflow-icon">
                  <FontAwesomeIcon icon={item.icon} aria-hidden="true" />
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="practices" className="lp-practices">
        <div className="lp-section-inner">
          <div className="lp-section-eyebrow">Practice focus</div>
          <h2 className="lp-h2">Useful where statutory change meets client operations.</h2>
          <ul className="lp-practice-list">
            {PRACTICES.map((p) => (
              <li key={p.num}>
                <span className="lp-practice-num">{p.num}</span>
                <span className="lp-practice-name">{p.name}</span>
                <span className="lp-practice-note">{p.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="review" className="lp-review">
        <div className="lp-review-inner">
          <div className="lp-review-mark">
            <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
          </div>
          <div>
            <div className="lp-section-eyebrow">Review standard</div>
            <h2 className="lp-review-title">
              Every delta is structured for review. Counsel approves the law.
            </h2>
            <p className="lp-review-copy">
              The workspace is built around human approval: every updated Act is
              reviewed and signed off by counsel before it informs a single line
              of client impact analysis.
            </p>
            <button className="lp-primary" onClick={onLaunch}>
              Continue to review
              <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-l">
            <span className="lp-brand-dot lp-brand-dot-sm" aria-hidden="true" />
            <span>
              Built for <b>BCF</b> by <b>Ingenium</b>
            </span>
          </div>
          <div className="lp-footer-c">
            Source-linked to Parliament &amp; Justice Canada
          </div>
          <div className="lp-footer-r">
            <a href="https://github.com/Lil-Chen05/project-injenium">
              <FontAwesomeIcon icon={faGithub} aria-hidden="true" /> GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
