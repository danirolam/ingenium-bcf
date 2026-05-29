import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faBars,
  faXmark,
  faChevronDown,
  faBinoculars,
  faCodeCompare,
  faMagnifyingGlassChart,
  faFileSignature,
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

const ROTATE = ["client advice", "legal deltas", "exposure memos", "clear action"];

const NAV = [
  { id: "impact", label: "Impact" },
  { id: "workflow", label: "How it works" },
  { id: "faq", label: "FAQ" },
];

const METRICS: { value: string; label: string; desc: string; pip: "v" | "b" }[] = [
  { value: "162", label: "Bills tracked", desc: "45th Parliament, 1st Session", pip: "v" },
  { value: "160", label: "With full text", desc: "parsed clause by clause", pip: "b" },
  { value: "9", label: "Practice groups", desc: "mapped automatically", pip: "v" },
  { value: "6", label: "Stages traced", desc: "first reading to assent", pip: "b" },
];

const CAPS: { num: string; title: string; text: string; icon: IconDefinition }[] = [
  { num: "01", title: "Monitor", text: "Every federal bill, tracked by practice area and momentum.", icon: faBinoculars },
  { num: "02", title: "Legal delta", text: "See exactly which sections of which Acts a bill changes.", icon: faCodeCompare },
  { num: "03", title: "Client scan", text: "Match each change against a client's operations and contracts.", icon: faMagnifyingGlassChart },
  { num: "04", title: "Client brief", text: "Produce a counsel-approved exposure memo, ready to send.", icon: faFileSignature },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Where does the legislative data come from?",
    a: "Every bill is sourced from Parliament's LEGISinfo and the published bill text on parl.ca — first reading through royal assent, with committee stages and recorded divisions. Nothing is invented; the official source is one click away on each bill.",
  },
  {
    q: "What does \"legal delta\" actually mean?",
    a: "A delta is the precise change a bill makes to existing law: the sections it adds, repeals, or replaces in each consolidated Act, shown side by side so counsel can review the exact wording before it informs client work.",
  },
  {
    q: "How are bills matched to our clients?",
    a: "Approved deltas are scanned against each client's operations, policies, and contracts to flag who is exposed, how, and how urgently — turning a statutory change into a concrete, client-specific assessment.",
  },
  {
    q: "Is anything sent to a client without review?",
    a: "No. Every updated Act and every client brief is structured for review and signed off by a lawyer before it leaves the building. Counsel approves the law, always.",
  },
  {
    q: "Which practice areas are covered?",
    a: "The docket is tagged across BCF's groups — Business & M&A, Banking & Securities, Taxation, IP, Labour & Employment, Privacy & Technology, Immigration, Health & Life Sciences, and Litigation & Regulatory.",
  },
];

function AnimatedCounter({ value }: { value: string }) {
  const [shown, setShown] = useState("0");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const target = Number.parseFloat(value.replace(/[^0-9.]/g, "")) || 0;
    const suffix = value.replace(/[0-9.,]/g, "");
    const obs = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        obs.disconnect();
        const start = performance.now();
        const dur = 1100;
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          setShown(Math.round(target * eased).toString() + suffix);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [value]);
  return (
    <div className="val" ref={ref}>
      {shown}
    </div>
  );
}

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [wi, setWi] = useState(0);
  const [wordOut, setWordOut] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);

  // Rotating headline word.
  useEffect(() => {
    const t = setInterval(() => {
      setWordOut(true);
      setTimeout(() => {
        setWi((i) => (i + 1) % ROTATE.length);
        setWordOut(false);
      }, 350);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  // Scroll reveal.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    document.querySelectorAll(".lp-reveal").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMenuOpen(false);
  };

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <button className="lp-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <span className="lp-mark" aria-hidden="true" />
            <span className="lp-brand-name">Ingenium</span>
          </button>
          <nav className="lp-nav-links">
            {NAV.map((n) => (
              <a key={n.id} onClick={() => go(n.id)}>
                {n.label}
              </a>
            ))}
          </nav>
          <button className="lp-nav-cta" onClick={onLaunch}>
            Open workspace
            <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
          </button>
          <button
            className="lp-burger"
            aria-label="Menu"
            onClick={() => setMenuOpen(true)}
          >
            <FontAwesomeIcon icon={faBars} />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="lp-menu" role="dialog" aria-label="Menu">
          <button className="lp-menu-close" aria-label="Close" onClick={() => setMenuOpen(false)}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
          {NAV.map((n) => (
            <a key={n.id} onClick={() => go(n.id)}>
              {n.label}
            </a>
          ))}
          <a
            onClick={() => {
              setMenuOpen(false);
              onLaunch();
            }}
          >
            Open workspace
          </a>
        </div>
      )}

      <section className="lp-hero">
        <div className="lp-aurora" aria-hidden="true" />
        <div className="lp-hero-inner">
          <span className="lp-eyebrow">
            <span className="pip" aria-hidden="true" />
            Legislative intelligence for BCF
          </span>
          <h1 className="lp-h1">
            Every federal bill,
            <br />
            translated into{" "}
            <span className={`lp-rotate grad${wordOut ? " out" : ""}`}>
              {ROTATE[wi]}
            </span>
          </h1>
          <p className="lp-sub">
            Ingenium follows each bill through Parliament, pinpoints the exact
            statutory change, and turns it into clear, client-specific exposure —
            reviewed and approved by counsel.
          </p>
          <div className="lp-hero-cta">
            <button className="lp-btn lp-btn-primary" onClick={onLaunch}>
              Open workspace
              <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
            <a className="lp-btn lp-btn-ghost" onClick={() => go("workflow")}>
              See how it works
            </a>
          </div>
        </div>

        <div className="lp-stage">
          <div className="lp-stage-glow" aria-hidden="true" />
          <DashboardMock />
        </div>
      </section>

      <section className="lp-marquee" aria-hidden="true">
        <div className="lp-marquee-label">
          Source-linked to Parliament &amp; Justice Canada
        </div>
        <div className="lp-marquee-track">
          <div className="lp-marquee-row">
            {[...PRACTICES, ...PRACTICES].map((p, i) => (
              <span className="lp-marquee-item" key={i}>
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="impact" className="lp-section lp-reveal">
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
          <span className="lp-kicker">
            <span className="pip" aria-hidden="true" />
            By the numbers
          </span>
          <h2 className="lp-h2">
            The whole federal docket, <span className="grad">in one place</span>
          </h2>
        </div>
        <div className="lp-metrics-grid">
          {METRICS.map((m) => (
            <div className="lp-metric" key={m.label}>
              <div className="lbl">
                <span className={`pip ${m.pip}`} aria-hidden="true" />
                {m.label}
              </div>
              <AnimatedCounter value={m.value} />
              <div className="desc">{m.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="workflow" className="lp-section lp-reveal">
        <div className="lp-cap-head">
          <span className="lp-kicker">
            <span className="pip" aria-hidden="true" />
            How it works
          </span>
          <h2 className="lp-h2">
            From a bill to a client memo, <span className="grad">in four moves</span>
          </h2>
          <p className="lp-lead" style={{ textAlign: "center" }}>
            One continuous line of work — each stage hands its result to the next.
          </p>
        </div>
        <div className="lp-cap-grid">
          {CAPS.map((c) => (
            <article className="lp-cap" key={c.num}>
              <div className="lp-cap-num">{c.num}</div>
              <div className="lp-cap-icon">
                <FontAwesomeIcon icon={c.icon} aria-hidden="true" />
              </div>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="faq" className="lp-section lp-reveal">
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
          <span className="lp-kicker">
            <span className="pip" aria-hidden="true" />
            Questions
          </span>
          <h2 className="lp-h2">
            Everything <span className="grad">counsel asks</span>
          </h2>
        </div>
        <div className="lp-faq-wrap">
          {FAQS.map((f, i) => (
            <div className={`lp-faq${faqOpen === i ? " open" : ""}`} key={i}>
              <button
                className="lp-faq-q"
                onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                aria-expanded={faqOpen === i}
              >
                {f.q}
                <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
              </button>
              <div className="lp-faq-a">
                <p>{f.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-cta lp-reveal">
        <div className="lp-cta-aurora" aria-hidden="true" />
        <div className="lp-cta-inner">
          <span className="lp-kicker">
            <span className="pip" aria-hidden="true" />
            Ready when you are
          </span>
          <h2 className="lp-h2">
            Open the <span className="grad">workspace</span>
          </h2>
          <p className="lp-lead" style={{ textAlign: "center" }}>
            Track the docket, read the deltas, brief the clients — start now.
          </p>
          <div style={{ marginTop: 30 }}>
            <button className="lp-btn lp-btn-primary" onClick={onLaunch}>
              Open workspace
              <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <button className="lp-brand" onClick={() => window.scrollTo({ top: 0 })}>
              <span className="lp-mark" aria-hidden="true" />
              <span className="lp-brand-name">Ingenium</span>
            </button>
            <p>
              Turning federal legislative change into clear, client-specific advice.
              Built for <b style={{ color: "var(--ink)" }}>BCF</b>.
            </p>
          </div>
          <div className="lp-footer-col">
            <h4>Product</h4>
            <a onClick={() => go("workflow")}>How it works</a>
            <a onClick={() => go("impact")}>Coverage</a>
            <a onClick={onLaunch}>Workspace</a>
          </div>
          <div className="lp-footer-col">
            <h4>Sources</h4>
            <a href="https://www.parl.ca/legisinfo/en" target="_blank" rel="noreferrer">LEGISinfo</a>
            <a href="https://laws-lois.justice.gc.ca" target="_blank" rel="noreferrer">Justice Canada</a>
            <a href="https://github.com/Lil-Chen05/project-injenium" target="_blank" rel="noreferrer">
              <FontAwesomeIcon icon={faGithub} aria-hidden="true" /> GitHub
            </a>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>© 2026 Ingenium · Built for BCF</span>
          <span>Montréal · Québec City</span>
        </div>
      </footer>
    </div>
  );
}

const PRACTICES = [
  "Business & M&A",
  "Banking & Securities",
  "Taxation",
  "Intellectual Property",
  "Labour & Employment",
  "Privacy & Technology",
  "Immigration",
  "Health & Life Sciences",
  "Litigation & Regulatory",
];

// A live, crafted miniature of our command-center overview — the landing's
// product shot, rendered rather than screenshotted so it stays crisp.
function DashboardMock() {
  return (
    <div className="lp-mock" aria-hidden="true">
      <div className="lp-mock-bar">
        <span className="lp-mock-brand">
          <span className="lp-mock-dot" />
          BCF
        </span>
        <div className="lp-mock-steps">
          <span className="lp-mock-step on">
            <span className="n">01</span> Monitor
          </span>
          <span className="lp-mock-sep">›</span>
          <span className="lp-mock-step">
            <span className="n">02</span> Legal delta
          </span>
          <span className="lp-mock-sep">›</span>
          <span className="lp-mock-step">
            <span className="n">03</span> Client scan
          </span>
          <span className="lp-mock-sep">›</span>
          <span className="lp-mock-step">
            <span className="n">04</span> Client brief
          </span>
        </div>
        <span className="lp-mock-avatar">MT</span>
      </div>
      <div className="lp-mock-body">
        <div className="lp-mock-meta">45th Parliament · 1st Session · 162 bills tracked</div>
        <div className="lp-mock-pipe">
          {[
            { n: "01", v: "162", l: "Bills tracked", on: true },
            { n: "02", v: "10", l: "Legal deltas", on: false },
            { n: "03", v: "3", l: "Clients", on: false },
            { n: "04", v: "5", l: "Ready to brief", on: false },
          ].map((c) => (
            <div className={`lp-mock-card${c.on ? " on" : ""}`} key={c.n}>
              <div className="n">{c.n}</div>
              <div className="v">{c.v}</div>
              <div className="l">{c.l}</div>
            </div>
          ))}
        </div>
        <div className="lp-mock-list">
          {[
            { bill: "C-11", title: "An Act to amend the National Defence Act", pill: "Passed", tone: "green" },
            { bill: "C-30", title: "Spring economic update implementation", pill: "Active", tone: "blue" },
            { bill: "S-233", title: "Criminal Code — health & first responders", pill: "Passed", tone: "green" },
            { bill: "C-27", title: "Digital Charter Implementation Act", pill: "In committee", tone: "amber" },
          ].map((r) => (
            <div className="lp-mock-row" key={r.bill}>
              <span className="bill">{r.bill}</span>
              <span className="title">{r.title}</span>
              <span className={`lp-mock-pill ${r.tone}`}>{r.pill}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
