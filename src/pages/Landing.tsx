import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faBars,
  faBinoculars,
  faCircleCheck,
  faCodeCompare,
  faFileSignature,
  faMagnifyingGlassChart,
  faScaleBalanced,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

// The four-stage pipeline, stated plainly. This is the answer to "what does it
// actually do" — it mirrors the in-app workflow rail one to one.
const PIPELINE: { num: string; name: string; text: string; icon: IconDefinition }[] = [
  {
    num: "01",
    name: "Monitor",
    text: "Every federal bill, tracked by practice area and legislative momentum.",
    icon: faBinoculars,
  },
  {
    num: "02",
    name: "Legal delta",
    text: "See exactly which sections of which Acts a bill amends, repeals, or adds.",
    icon: faCodeCompare,
  },
  {
    num: "03",
    name: "Client scan",
    text: "Match each change against a client's operations, policies, and contracts.",
    icon: faMagnifyingGlassChart,
  },
  {
    num: "04",
    name: "Client brief",
    text: "Produce a counsel-approved exposure memo, ready to send.",
    icon: faFileSignature,
  },
];

const PRACTICES: { name: string; note: string }[] = [
  { name: "Business & M&A", note: "CBCA, Competition Act, foreign investment, and trade agreements." },
  { name: "Banking & Securities", note: "Bank Act, securities, payments, and anti-money-laundering." },
  { name: "Taxation", note: "Income and excise measures, tariffs, and fiscal updates." },
  { name: "Intellectual Property", note: "Copyright, patent, trademark, and industrial design." },
  { name: "Labour & Employment", note: "Canada Labour Code, pay equity, and workplace standards." },
  { name: "Privacy & Technology", note: "Personal information, telecom, and online obligations." },
  { name: "Immigration", note: "Citizenship, foreign nationals, and permanent residency." },
  { name: "Health & Life Sciences", note: "Food and Drugs Act, therapeutic products, and cannabis." },
  { name: "Litigation & Regulatory", note: "Criminal Code, evidence, and regulatory offences." },
];

type JState = "done" | "active" | "pending";
type JStage = {
  name: string;
  state: JState;
  date?: string;
  division?: { yeas: number; nays: number };
};

// The hero signature: a bill's path through Parliament, the same shape the Bill
// Detail view renders from live LEGISinfo data. Illustrative figures.
const JOURNEY: { chamber: string; stages: JStage[] }[] = [
  {
    chamber: "House of Commons",
    stages: [
      { name: "First reading", state: "done", date: "Jun 16, 2022" },
      {
        name: "Second reading",
        state: "done",
        date: "Apr 24, 2023",
        division: { yeas: 177, nays: 142 },
      },
      { name: "Committee — INDU", state: "done", date: "Apr 18, 2024" },
      { name: "Report stage", state: "active", date: "In progress" },
      { name: "Third reading", state: "pending" },
    ],
  },
  {
    chamber: "Senate",
    stages: [{ name: "First reading", state: "pending" }],
  },
];

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a className="lp-brand" href="#" onClick={(e) => e.preventDefault()}>
            <span className="lp-mark" aria-hidden="true" />
            <span className="lp-brand-text">BCF</span>
            <span className="lp-brand-div" aria-hidden="true" />
            <span className="lp-brand-sub">Ingenium</span>
          </a>

          <nav className="lp-nav-mid" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#practices">Practice focus</a>
            <a href="#standard">Review standard</a>
          </nav>

          <div className="lp-nav-actions">
            <button className="lp-nav-link" onClick={onLaunch}>
              Open workspace
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
              <a href="#how" onClick={() => setMenuOpen(false)}>
                How it works
              </a>
              <a href="#practices" onClick={() => setMenuOpen(false)}>
                Practice focus
              </a>
              <a href="#standard" onClick={() => setMenuOpen(false)}>
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
                Open workspace
              </a>
            </nav>
          </div>
        </div>
      )}

      <section className="lp-hero">
        <div className="lp-hero-meta">
          <span>45th Parliament · 1st Session</span>
          <span className="lp-hero-meta-r">162 bills tracked · updated from LEGISinfo</span>
        </div>

        <div className="lp-hero-grid">
          <div className="lp-hero-text">
            <div className="lp-eyebrow">Legislative intelligence for BCF</div>
            <h1 className="lp-h1">
              Track every federal bill.
              <span className="lp-h1-2">Brief every client it touches.</span>
            </h1>
            <p className="lp-hero-copy">
              Ingenium follows each bill through Parliament, pinpoints the exact
              statutory change, and turns it into clear, client-specific exposure
              — reviewed and approved by counsel before it leaves the building.
            </p>
            <div className="lp-hero-actions">
              <button className="lp-primary" onClick={onLaunch}>
                Open workspace
                <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
              </button>
              <a className="lp-secondary" href="#how">
                How it works
              </a>
            </div>
            <div className="lp-hero-foot">
              Built for business-law practice · Federal &amp; Québec law
            </div>
          </div>

          <aside className="lp-journey" aria-hidden="true">
            <div className="lp-journey-head">
              <span className="lp-journey-bill">C-27</span>
              <span className="lp-journey-heading">
                <span className="lp-journey-name">
                  Digital Charter Implementation Act
                </span>
                <span className="lp-journey-tag">Privacy &amp; Technology</span>
              </span>
            </div>
            <div className="lp-journey-body">
              {JOURNEY.map((group) => (
                <div className="lp-jgroup" key={group.chamber}>
                  <div className="lp-jchamber">{group.chamber}</div>
                  <div className="lp-jstages">
                    {group.stages.map((s) => {
                      const total = s.division
                        ? s.division.yeas + s.division.nays
                        : 0;
                      const yeaPct = total
                        ? Math.round((s.division!.yeas / total) * 100)
                        : 0;
                      return (
                        <div className={`lp-jstage is-${s.state}`} key={s.name}>
                          <span className="lp-jdot" />
                          <span className="lp-jstage-name">{s.name}</span>
                          {s.date && (
                            <span className="lp-jstage-date">{s.date}</span>
                          )}
                          {s.division && (
                            <div className="lp-jvote">
                              <div className="lp-jvote-bar">
                                <span style={{ width: `${yeaPct}%` }} />
                              </div>
                              <span className="lp-jvote-nums">
                                <b>{s.division.yeas}</b> Yeas
                                <i>{s.division.nays}</i> Nays
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="lp-journey-foot">
              <FontAwesomeIcon icon={faScaleBalanced} aria-hidden="true" />
              Legislative path · House &amp; Senate stages with recorded divisions
            </div>
          </aside>
        </div>
      </section>

      <section id="how" className="lp-how">
        <div className="lp-section-inner">
          <div className="lp-section-head">
            <div className="lp-section-eyebrow">How it works</div>
            <h2 className="lp-h2">
              One line of work, from a bill to a client memo.
            </h2>
          </div>
          <ol className="lp-pipe">
            {PIPELINE.map((step) => (
              <li className="lp-pipe-step" key={step.num}>
                <div className="lp-pipe-node">
                  <span className="lp-pipe-num">{step.num}</span>
                </div>
                <div className="lp-pipe-body">
                  <h3>
                    <FontAwesomeIcon icon={step.icon} aria-hidden="true" />
                    {step.name}
                  </h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="practices" className="lp-practices">
        <div className="lp-section-inner">
          <div className="lp-section-head">
            <div className="lp-section-eyebrow">Practice focus</div>
            <h2 className="lp-h2">
              Tuned to the work BCF actually does.
            </h2>
          </div>
          <div className="lp-practice-grid">
            {PRACTICES.map((p, i) => (
              <article className="lp-practice" key={p.name}>
                <span className="lp-practice-num">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="lp-practice-name">{p.name}</h3>
                <p className="lp-practice-note">{p.note}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="standard" className="lp-standard">
        <div className="lp-standard-inner">
          <div className="lp-standard-mark">
            <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
          </div>
          <div className="lp-standard-text">
            <div className="lp-section-eyebrow">Review standard</div>
            <h2 className="lp-standard-title">
              Counsel approves the law. Always.
            </h2>
            <p className="lp-standard-copy">
              Every updated Act and every client brief is structured for review
              and signed off by a lawyer before it informs a single piece of
              advice. The workspace keeps the source — the bill text and the
              consolidated Act — one click away at every step.
            </p>
            <div className="lp-standard-points">
              <span>Source-linked to Parliament &amp; Justice Canada</span>
              <span>Deterministic legislative paths</span>
              <span>Human approval gates</span>
            </div>
            <button className="lp-primary" onClick={onLaunch}>
              Enter the workspace
              <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-l">
            <span className="lp-mark lp-mark-sm" aria-hidden="true" />
            <span>
              Built for <b>BCF</b> by <b>Ingenium</b>
            </span>
          </div>
          <div className="lp-footer-c">Montréal · Québec City</div>
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
