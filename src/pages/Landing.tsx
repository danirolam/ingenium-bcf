import { useState } from "react";
import { Search, Menu, X, Pause, ArrowUpRight, ArrowRight } from "lucide-react";

const PRACTICES = [
  { num: "01", name: "Privacy & Data", note: "CPPA · AIDA · PIPEDA" },
  { num: "02", name: "Health & Life Sciences", note: "Food & Drugs Act · FCA" },
  { num: "03", name: "Financial Services", note: "Bank Act · PCMLTFA" },
  { num: "04", name: "Energy & Resources", note: "CEAA · IAA" },
  { num: "05", name: "Telecom & Tech", note: "Telecommunications Act" },
  { num: "06", name: "Tax & Customs", note: "ITA · Excise Tax Act" },
];

const STATS = [
  { v: "847", l: "Bills monitored", note: "45-1 session, live" },
  { v: "12", l: "Acts tracked", note: "Hand-curated by counsel" },
  { v: "3.4×", l: "Faster triage", note: "Vs. paralegal baseline" },
  { v: "< 60s", l: "Bill → memo", note: "End-to-end median" },
];

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="lp">
      {/* ───────── Navbar ───────── */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a className="lp-brand" href="#" onClick={(e) => e.preventDefault()}>
            <span className="lp-brand-dot" aria-hidden="true" />
            <span className="lp-brand-text">BCF</span>
          </a>

          <div className="lp-nav-actions">
            <button className="lp-circle" aria-label="Search">
              <Search size={18} strokeWidth={1.75} />
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
              <a href="#practices" onClick={() => setMenuOpen(false)}>
                Practice areas
              </a>
              <a href="#workflow" onClick={() => setMenuOpen(false)}>
                Workflow
              </a>
              <a href="#principle" onClick={() => setMenuOpen(false)}>
                Principle
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
            <div className="lp-drawer-foot">
              <span>Built by Injenium</span>
              <span>for BCF</span>
            </div>
          </div>
        </div>
      )}

      {/* ───────── Hero ───────── */}
      <section className="lp-hero">
        <div
          className="lp-hero-bg"
          style={{ backgroundImage: "url(/hero.avif)" }}
          aria-hidden="true"
        />
        <div className="lp-hero-shade" aria-hidden="true" />

        <div className="lp-hero-orb" aria-hidden="true">
          <video
            className="lp-hero-orb-media"
            autoPlay
            muted
            loop
            playsInline
            poster="/hero.avif"
          >
            <source src="/hero-circle.mp4" type="video/mp4" />
            <source src="/hero-circle.webm" type="video/webm" />
          </video>
        </div>

        <div className="lp-hero-inner">
          <h1 className="lp-h1">
            <span>From insight.</span>
            <span>To impact.</span>
          </h1>
        </div>

        <button className="lp-hero-cookie" aria-label="Privacy preferences">
          <span aria-hidden="true">◔</span>
        </button>

        <button className="lp-hero-pause" aria-label="Pause the video">
          <Pause size={12} strokeWidth={2} fill="currentColor" />
          <span>Pause the video</span>
        </button>
      </section>

      {/* ───────── Stats strip — anchors the hero, signals scale ───────── */}
      <section className="lp-stats">
        <div className="lp-stats-inner">
          {STATS.map((s) => (
            <div className="lp-stat" key={s.l}>
              <div className="lp-stat-v">{s.v}</div>
              <div className="lp-stat-l">{s.l}</div>
              <div className="lp-stat-note">{s.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Story ───────── */}
      <section id="about" className="lp-story">
        <div className="lp-story-inner">
          <div className="lp-story-eyebrow">Built by Injenium for BCF</div>
          <h2 className="lp-story-h">
            Federal bill intelligence,
            <br />
            built for Canadian counsel.
          </h2>
          <p className="lp-story-p">
            Bills don't wait for anyone — and reading them line by line is
            how a quiet committee amendment ends up sitting in your client's
            inbox six months from now. Injenium reads every bill the moment
            it's tabled, extracts the delta against the current Act, and
            matches it to the client portfolios you actually care about.
          </p>
          <button className="lp-story-cta" onClick={onLaunch}>
            <span>Open the workspace</span>
            <ArrowUpRight size={18} strokeWidth={1.75} />
          </button>
        </div>
      </section>

      {/* ───────── Practice areas — BCF-style numbered list ───────── */}
      <section id="practices" className="lp-practices">
        <div className="lp-practices-inner">
          <div className="lp-section-eyebrow">Practice areas</div>
          <h2 className="lp-h2">
            Tuned for the regulated practices that move first.
          </h2>
          <ul className="lp-practice-list">
            {PRACTICES.map((p) => (
              <li key={p.num}>
                <span className="lp-practice-num">{p.num}</span>
                <span className="lp-practice-name">{p.name}</span>
                <span className="lp-practice-note">{p.note}</span>
                <ArrowRight
                  className="lp-practice-arr"
                  size={18}
                  strokeWidth={1.5}
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ───────── Editorial principle / quote ───────── */}
      <section id="principle" className="lp-principle">
        <div className="lp-principle-inner">
          <div className="lp-section-eyebrow">A working principle</div>
          <blockquote className="lp-quote">
            The job of counsel is not to read every bill. It's to act on the
            three that move every client.
          </blockquote>
          <div className="lp-quote-attr">
            <span className="lp-brand-dot lp-brand-dot-sm" aria-hidden="true" />
            <span>BCF · Privacy &amp; Data practice</span>
          </div>
        </div>
      </section>

      {/* ───────── Foot CTA ───────── */}
      <section className="lp-foot-cta">
        <div className="lp-foot-cta-inner">
          <h2 className="lp-h2">
            Ready when the next bill is tabled.
          </h2>
          <button className="lp-story-cta" onClick={onLaunch}>
            <span>Open the workspace</span>
            <ArrowUpRight size={18} strokeWidth={1.75} />
          </button>
        </div>
      </section>

      {/* ───────── Footer ───────── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-l">
            <span className="lp-brand-dot lp-brand-dot-sm" aria-hidden="true" />
            <span>
              Built by <b>Injenium</b> for <b>BCF</b> · McGill AI × Law
              Hackathon, 2026
            </span>
          </div>
          <div className="lp-footer-r">
            <a href="#privacy">Privacy</a>
            <a href="#terms">Terms</a>
            <a href="https://github.com/Lil-Chen05/project-injenium">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
