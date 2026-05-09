import { ArrowUpRight } from "lucide-react";
import { InfiniteSlider } from "@/components/ui/infinite-slider";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { Sparkles } from "@/components/ui/sparkles";

const TRUSTED_BY = [
  "Stikeman Elliott",
  "Borden Ladner Gervais",
  "Davies Ward",
  "McCarthy Tétrault",
  "Norton Rose Fulbright",
  "Osler Hoskin",
  "Blake, Cassels & Graydon",
  "Fasken Martineau",
];

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="landing">
      {/* ───────── Navbar ───────── */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-brand">
            <span className="lp-monogram">In</span>
            <span className="lp-wordmark">Injenium</span>
          </div>
          <nav className="lp-nav-links">
            <a href="#product">Product</a>
            <a href="#trusted">Trusted by</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#docs">Docs</a>
          </nav>
          <div className="lp-nav-actions">
            <button className="lp-link" onClick={onLaunch}>
              Sign in
            </button>
            <button className="lp-cta" onClick={onLaunch}>
              <span>Launch workspace</span>
              <ArrowUpRight size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>

      {/* ───────── Hero ───────── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-eyebrow">
            <span className="lp-pip" />
            <span>Now monitoring the 45-1 Parliament</span>
          </div>
          <h1 className="lp-h1">
            Federal bills,{" "}
            <em>read,</em> matched, and explained{" "}
            <em>against your client portfolio.</em>
          </h1>
          <p className="lp-sub">
            Injenium ingests every Canadian federal bill, extracts the
            statutory delta, and tells you{" "}
            <span className="lp-sub-em">which clients it actually moves</span>{" "}
            — with citations, timing, and a draft memo.
          </p>
          <div className="lp-cta-row">
            <button className="lp-cta lp-cta-lg" onClick={onLaunch}>
              <span>Open workspace</span>
              <ArrowUpRight size={16} strokeWidth={1.75} />
            </button>
            <button className="lp-link lp-link-lg">
              <span>Watch a 90-second tour</span>
            </button>
          </div>
        </div>

        {/* Sparkles + soft halo backdrop */}
        <div className="lp-hero-fx">
          <div className="lp-hero-halo" />
          <div className="lp-hero-curve" />
          <Sparkles
            density={900}
            size={1.4}
            color="#f5f1ec"
            className="lp-sparkles"
          />
        </div>
      </section>

      {/* ───────── Trusted by ───────── */}
      <section id="trusted" className="lp-trusted">
        <div className="lp-trusted-label">
          Built for counsel at full-service Canadian firms
        </div>
        <div className="lp-slider-wrap">
          <InfiniteSlider
            className="flex h-full w-full items-center"
            duration={45}
            gap={64}
          >
            {TRUSTED_BY.map((name) => (
              <div key={name} className="lp-logo">
                {name}
              </div>
            ))}
          </InfiniteSlider>
          <ProgressiveBlur
            className="pointer-events-none absolute left-0 top-0 h-full w-[180px]"
            direction="left"
            blurIntensity={1}
          />
          <ProgressiveBlur
            className="pointer-events-none absolute right-0 top-0 h-full w-[180px]"
            direction="right"
            blurIntensity={1}
          />
        </div>
      </section>

      {/* ───────── How it works (three editorial columns) ───────── */}
      <section id="how" className="lp-how">
        <div className="lp-how-head">
          <div className="lp-section-eyebrow">§ 02 · The workflow</div>
          <h2 className="lp-h2">
            From <em>LEGISinfo</em> JSON to a drafted client memo —
            in under a minute.
          </h2>
        </div>
        <div className="lp-how-grid">
          <article>
            <div className="lp-how-num">01</div>
            <h3>Ingest</h3>
            <p>
              Drop a LEGISinfo bill JSON. We normalize sponsors, stages,
              dates, and the proposed statutory text.
            </p>
          </article>
          <article>
            <div className="lp-how-num">02</div>
            <h3>Extract</h3>
            <p>
              Gemini 2.5 reads the bill against the current Act and produces
              a clean before/after delta with section anchors.
            </p>
          </article>
          <article>
            <div className="lp-how-num">03</div>
            <h3>Match</h3>
            <p>
              Each approved delta is run against your client portfolio.
              You get a per-client impact memo, ready to send.
            </p>
          </article>
        </div>
      </section>

      {/* ───────── Footer CTA ───────── */}
      <section className="lp-foot-cta">
        <h2 className="lp-h2">
          Stop reading bills line by line.{" "}
          <em>Have them read to you.</em>
        </h2>
        <button className="lp-cta lp-cta-lg" onClick={onLaunch}>
          <span>Open workspace</span>
          <ArrowUpRight size={16} strokeWidth={1.75} />
        </button>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-l">
          <span className="lp-monogram">In</span>
          <span>Injenium · Built at the McGill AI × Law Hackathon, 2026</span>
        </div>
        <div className="lp-footer-r">
          <a href="#privacy">Privacy</a>
          <a href="#terms">Terms</a>
          <a href="https://github.com/Lil-Chen05/project-injenium">GitHub</a>
        </div>
      </footer>
    </div>
  );
}
