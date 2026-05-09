import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  FileText,
  GitCompareArrows,
  Menu,
  X,
} from "lucide-react";

const WORKFLOW = [
  {
    title: "Retrieve the bill",
    text: "Start from Parliament bill data, normalize the metadata, and keep the bill text beside its source record.",
    icon: FileText,
  },
  {
    title: "Review the legal delta",
    text: "Compare proposed amendments against the relevant law text before approving anything for client use.",
    icon: GitCompareArrows,
  },
  {
    title: "Match client exposure",
    text: "Use the approved law version to generate a client-specific impact review from known client materials.",
    icon: BriefcaseBusiness,
  },
];

const PRACTICES = [
  { num: "01", name: "Privacy & Data", note: "Consent, disclosure, AI governance" },
  { num: "02", name: "Health & Life Sciences", note: "Health records, product regulation, care delivery" },
  { num: "03", name: "Financial Services", note: "Compliance, reporting, consumer obligations" },
  { num: "04", name: "Agriculture & Food", note: "Feeds, fertilizers, seeds, pest control, food law" },
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
              <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              className="lp-circle"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? (
                <X size={18} strokeWidth={1.75} />
              ) : (
                <Menu size={18} strokeWidth={1.75} />
              )}
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
        <div
          className="lp-hero-bg"
          style={{ backgroundImage: "url(/hero.avif)" }}
          aria-hidden="true"
        />
        <div className="lp-hero-shade" aria-hidden="true" />
        <div className="lp-hero-inner">
          <div className="lp-eyebrow">Federal bill intelligence for BCF matters</div>
          <h1 className="lp-h1">
            From bill text to client-ready legal impact.
          </h1>
          <p className="lp-hero-copy">
            A focused workspace for retrieving bills, reviewing proposed legal
            changes, and turning approved deltas into client-specific analysis.
          </p>
          <div className="lp-hero-actions">
            <button className="lp-primary" onClick={onLaunch}>
              Open workspace
              <ArrowUpRight size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <a className="lp-secondary" href="#workflow">
              See workflow
              <ArrowRight size={17} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <section id="workflow" className="lp-workflow">
        <div className="lp-section-inner">
          <div className="lp-section-eyebrow">Workflow</div>
          <h2 className="lp-h2">Built around the review path we can prove.</h2>
          <div className="lp-workflow-grid">
            {WORKFLOW.map((item) => (
              <article className="lp-workflow-card" key={item.title}>
                <div className="lp-workflow-icon">
                  <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
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
            <CheckCircle2 size={22} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div>
            <div className="lp-section-eyebrow">Review standard</div>
            <h2 className="lp-review-title">
              AI helps structure the work. Counsel approves the law.
            </h2>
            <p className="lp-review-copy">
              The product is intentionally built around human approval: the
              updated law is reviewed before it is used for client impact
              analysis.
            </p>
            <button className="lp-primary" onClick={onLaunch}>
              Continue to review
              <ArrowUpRight size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-l">
            <span className="lp-brand-dot lp-brand-dot-sm" aria-hidden="true" />
            <span>
              Built by <b>Injenium</b> for <b>BCF</b>
            </span>
          </div>
          <div className="lp-footer-r">
            <a href="https://github.com/Lil-Chen05/project-injenium">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
