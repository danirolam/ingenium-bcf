import { Search, ArrowUpRight } from "lucide-react";

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="lp">
      {/* ───────── Navbar ───────── */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a className="lp-brand" href="#" onClick={(e) => e.preventDefault()}>
            <span className="lp-monogram-dot" aria-hidden="true" />
            <span className="lp-wordmark">Injenium</span>
          </a>

          <nav className="lp-nav-links" aria-label="Primary">
            <a href="#expertise">Expertise</a>
            <a href="#workflow">Workflow</a>
            <a href="#thought">Thought leadership</a>
            <a href="#firm">The firm</a>
          </nav>

          <div className="lp-nav-actions">
            <a className="lp-lang" href="#fr">
              Français
            </a>
            <button className="lp-pill" onClick={onLaunch}>
              Launch
            </button>
            <button className="lp-icon" aria-label="Search">
              <Search size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>

      {/* ───────── Hero ───────── */}
      <section className="lp-hero">
        <div
          className="lp-hero-bg"
          style={{ backgroundImage: "url(/hero.avif)" }}
          aria-hidden="true"
        />
        <div className="lp-hero-shade" aria-hidden="true" />

        <div className="lp-hero-inner">
          <h1 className="lp-h1">
            <span>From insight.</span>
            <span>To impact.</span>
          </h1>

          <p className="lp-sub">
            Federal bill intelligence for Canadian counsel. Read every
            bill, match it to your portfolio, deliver a memo before the
            committee rises.
          </p>

          <div className="lp-cta-row">
            <button className="lp-pill lp-pill-lg" onClick={onLaunch}>
              <span>Open the workspace</span>
              <ArrowUpRight size={16} strokeWidth={1.75} />
            </button>
            <a className="lp-link" href="#workflow">
              How it works
            </a>
          </div>
        </div>

        <div className="lp-hero-foot">
          <span className="lp-hero-tick" />
          <span>Now monitoring the 45-1 Parliament · live</span>
        </div>
      </section>

      {/* ───────── Workflow ───────── */}
      <section id="workflow" className="lp-section">
        <div className="lp-section-inner">
          <div className="lp-section-head">
            <div className="lp-section-eyebrow">Workflow</div>
            <h2 className="lp-h2">
              Three steps from a freshly tabled bill to a client-ready memo.
            </h2>
          </div>

          <div className="lp-steps">
            <article>
              <div className="lp-step-num">01</div>
              <h3>Ingest</h3>
              <p>
                Drop a LEGISinfo bill JSON. Sponsors, stages, dates, and the
                proposed text are normalized into a single record.
              </p>
            </article>
            <article>
              <div className="lp-step-num">02</div>
              <h3>Extract</h3>
              <p>
                The bill is read against the current Act and a clean
                before/after delta is produced, with section anchors and
                ambiguity flags for review.
              </p>
            </article>
            <article>
              <div className="lp-step-num">03</div>
              <h3>Match</h3>
              <p>
                Each approved delta is run against your client portfolio.
                Counsel gets a per-client impact memo, ready to send.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ───────── Expertise (BCF-style three-up text grid) ───────── */}
      <section id="expertise" className="lp-section lp-section-tinted">
        <div className="lp-section-inner">
          <div className="lp-section-head">
            <div className="lp-section-eyebrow">Expertise</div>
            <h2 className="lp-h2">
              Built for the regulated practices that move first.
            </h2>
          </div>

          <ul className="lp-expertise">
            <li>
              <span className="lp-exp-num">01</span>
              <span className="lp-exp-name">Privacy &amp; Data</span>
              <span className="lp-exp-note">CPPA, AIDA, PIPEDA</span>
            </li>
            <li>
              <span className="lp-exp-num">02</span>
              <span className="lp-exp-name">Health &amp; Life Sciences</span>
              <span className="lp-exp-note">Food &amp; Drugs Act, FCA</span>
            </li>
            <li>
              <span className="lp-exp-num">03</span>
              <span className="lp-exp-name">Financial Services</span>
              <span className="lp-exp-note">Bank Act, PCMLTFA</span>
            </li>
            <li>
              <span className="lp-exp-num">04</span>
              <span className="lp-exp-name">Energy &amp; Resources</span>
              <span className="lp-exp-note">CEAA, IAA, federal review</span>
            </li>
            <li>
              <span className="lp-exp-num">05</span>
              <span className="lp-exp-name">Telecom &amp; Tech</span>
              <span className="lp-exp-note">Telecommunications Act</span>
            </li>
            <li>
              <span className="lp-exp-num">06</span>
              <span className="lp-exp-name">Tax &amp; Customs</span>
              <span className="lp-exp-note">ITA, Excise Tax Act</span>
            </li>
          </ul>
        </div>
      </section>

      {/* ───────── Foot CTA ───────── */}
      <section className="lp-section lp-foot-cta">
        <div className="lp-section-inner">
          <h2 className="lp-h2">
            Stop reading bills line by line. Have them read to you.
          </h2>
          <button className="lp-pill lp-pill-lg" onClick={onLaunch}>
            <span>Open the workspace</span>
            <ArrowUpRight size={16} strokeWidth={1.75} />
          </button>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-monogram-dot" aria-hidden="true" />
            <span>Injenium · Built at the McGill AI × Law Hackathon, 2026</span>
          </div>
          <div className="lp-footer-links">
            <a href="#privacy">Privacy</a>
            <a href="#terms">Terms</a>
            <a href="https://github.com/Lil-Chen05/project-injenium">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
