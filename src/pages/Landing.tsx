import { useState } from "react";
import { Search, Menu, X, Pause, ArrowUpRight } from "lucide-react";

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="lp">
      {/* ───────── Navbar (BCF-minimal: logo + 2 circle buttons) ───────── */}
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

      {/* ───────── Slide-down menu drawer ───────── */}
      {menuOpen && (
        <div className="lp-drawer" role="dialog" aria-label="Navigation">
          <div className="lp-drawer-inner">
            <nav>
              <a href="#expertise" onClick={() => setMenuOpen(false)}>
                Expertise
              </a>
              <a href="#workflow" onClick={() => setMenuOpen(false)}>
                Workflow
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
              <a href="#about" onClick={() => setMenuOpen(false)}>
                About
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

        {/* Floating circular video. Falls back to /hero.avif as the
            poster image if /hero-circle.mp4 isn't present yet. */}
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

        {/* Bottom-left cookie icon (decorative, BCF cue) */}
        <button className="lp-hero-cookie" aria-label="Privacy preferences">
          <span aria-hidden="true">◔</span>
        </button>

        {/* Bottom-right pause-video chrome (decorative, BCF cue) */}
        <button className="lp-hero-pause" aria-label="Pause the video">
          <Pause size={12} strokeWidth={2} fill="currentColor" />
          <span>Pause the video</span>
        </button>
      </section>

      {/* ───────── Story (Apple-clean single block) ───────── */}
      <section id="about" className="lp-story">
        <div className="lp-story-inner">
          <div className="lp-story-eyebrow">Built by Injenium for BCF</div>
          <h2 className="lp-story-h">
            Federal bill intelligence,
            <br />
            built for Canadian counsel.
          </h2>
          <p className="lp-story-p">
            Injenium ingests every federal bill, extracts the statutory delta
            against the current Act, and matches it to your client portfolio —
            turning a week of triage into a memo before the committee rises.
          </p>
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
