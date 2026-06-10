"use client";

import { useEffect, useRef, useState } from "react";
import {
  Menu,
  X,
  ChevronDown,
  ArrowRight,
  Binoculars,
  GitCompare,
  ScanSearch,
  FileSignature,
  Github,
  type LucideIcon,
} from "lucide-react";


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
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / 1100);
          const eased = 1 - Math.pow(1 - p, 3);
          setShown(Math.round(target * eased).toLocaleString("en-US") + suffix);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [value]);
  return <div ref={ref}>{shown}</div>;
}

const NAV = [
  { id: "impact", label: "Impact" },
  { id: "workflow", label: "How it works" },
  { id: "faq", label: "FAQ" },
];

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

const METRICS = [
  { label: "BILLS TRACKED", value: "5694", desc: "across 16 sessions of Parliament", c: "pink" },
  { label: "WITH FULL TEXT", value: "160", desc: "current session, clause by clause", c: "purple" },
  { label: "PRACTICE GROUPS", value: "9", desc: "mapped automatically", c: "pink" },
  { label: "STAGES TRACED", value: "6", desc: "first reading to royal assent", c: "purple" },
];

const CAPS: { title: string; desc: string; icon: LucideIcon }[] = [
  { title: "Monitor", desc: "Every federal bill, tracked by practice area and momentum.", icon: Binoculars },
  { title: "Legal delta", desc: "See exactly which sections of which Acts a bill changes.", icon: GitCompare },
  { title: "Client scan", desc: "Match each change against a client's operations and contracts.", icon: ScanSearch },
  { title: "Client brief", desc: "Produce a counsel-approved exposure memo, ready to send.", icon: FileSignature },
];

const FAQS = [
  {
    q: "Where does the legislative data come from?",
    a: "Every bill is sourced from Parliament's LEGISinfo and the published bill text on parl.ca — first reading through royal assent, with committee stages and recorded divisions. The official source is one click away on each bill.",
  },
  {
    q: "What does “legal delta” mean?",
    a: "The precise change a bill makes to existing law: the sections it adds, repeals, or replaces in each consolidated Act, shown side by side so counsel can review the exact wording before it informs client work.",
  },
  {
    q: "How are bills matched to our clients?",
    a: "Approved deltas are scanned against each client's operations, policies, and contracts to flag who is exposed, how, and how urgently — turning a statutory change into a client-specific assessment.",
  },
  {
    q: "Is anything sent to a client without review?",
    a: "No. Every updated Act and every client brief is structured for review and signed off by a lawyer before it leaves the building. Counsel approves the law, always.",
  },
];

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [faq, setFaq] = useState<number | null>(0);
  const obsRef = useRef<IntersectionObserver | null>(null);
  // Parallax targets — written to directly in a rAF-throttled scroll handler so
  // the hero drifts and the mock tilts with the scroll, with no React re-render.
  const heroRef = useRef<HTMLDivElement>(null);
  const mockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsLoaded(true);
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        if (heroRef.current)
          heroRef.current.style.transform = `translateY(${(y * 0.16).toFixed(1)}px)`;
        if (mockRef.current)
          mockRef.current.style.transform = `rotateX(${Math.max(0, 8 - y * 0.025).toFixed(2)}deg)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    // Sections reveal once as they enter the viewport — no per-scroll-frame work,
    // so scrolling stays smooth.
    obsRef.current = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => e.isIntersecting && e.target.classList.add("animate-in")),
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" },
    );
    document.querySelectorAll(".animate-on-scroll").forEach((el) => obsRef.current?.observe(el));
    // Safety net: never leave a section hidden if the observer doesn't fire.
    const safety = window.setTimeout(() => {
      document
        .querySelectorAll(".animate-on-scroll")
        .forEach((el) => el.classList.add("animate-in"));
    }, 1800);
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      clearTimeout(safety);
      obsRef.current?.disconnect();
    };
  }, []);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMenuOpen(false);
  };

  return (
    <div className="lp relative min-h-screen bg-white text-[#1f2328] overflow-x-hidden">
      <header className="fixed top-6 left-6 right-6 md:right-auto z-40 border border-black/10 backdrop-blur-md bg-white/80 rounded-[16px]">
        <div className="px-5">
          <div className="flex items-center gap-6 h-14">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="text-lg md:text-xl font-semibold font-mono tracking-tight hover:text-fuchsia-600 transition-colors"
            >
              Ingenium
            </button>
            <nav className="hidden md:flex items-center gap-7">
              {NAV.map((n) => (
                <button
                  key={n.id}
                  onClick={() => go(n.id)}
                  className="text-sm text-[#59636e] hover:text-[#1f2328] transition-colors"
                >
                  {n.label}
                </button>
              ))}
              <button
                onClick={onLaunch}
                className="text-sm text-[#59636e] hover:text-[#1f2328] transition-colors inline-flex items-center gap-1.5"
              >
                Workspace <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </nav>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="md:hidden ml-auto p-2 hover:bg-black/[0.04] rounded-lg transition-colors"
              aria-label="Menu"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 bg-white/95 backdrop-blur-md z-50 flex flex-col items-start justify-end pb-20 px-8 gap-7">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className="font-serif text-5xl font-light hover:text-fuchsia-600 transition-colors"
            >
              {n.label}
            </button>
          ))}
          <button
            onClick={() => {
              setMenuOpen(false);
              onLaunch();
            }}
            className="font-serif text-5xl font-light hover:text-fuchsia-600 transition-colors"
          >
            Workspace
          </button>
        </div>
      )}

      {/* HERO */}
      <section
        className={`hero-section relative min-h-screen flex flex-col items-center justify-center px-4 pt-28 pb-16 transition-transform duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${
          isLoaded ? "scale-100" : "scale-[1.02]"
        }`}
        style={{
          backgroundImage: "url('/montreal-view.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/85 to-white/30 pointer-events-none" />
        <div ref={heroRef} className="max-w-[1120px] w-full mx-auto relative z-10">
          <div className="text-center mb-10">
            <div
              className="inline-flex items-center gap-2 glass-pill px-4 py-2 rounded-full mb-7 text-xs md:text-sm text-[#59636e] stagger-reveal"
              style={{ animationDelay: "0ms" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />
              Legislative intelligence for BCF
            </div>
            <h1 className="font-serif font-light text-balance leading-[1.05]">
              <span
                className="block text-6xl md:text-8xl stagger-reveal"
                style={{ animationDelay: "60ms" }}
              >
                Every federal bill,
              </span>
              <span
                className="block text-6xl md:text-8xl stagger-reveal"
                style={{ animationDelay: "150ms" }}
              >
                translated to client-ready advice.
              </span>
            </h1>
            <p
              className="text-[#59636e] text-base md:text-lg max-w-[560px] mx-auto mt-8 leading-relaxed stagger-reveal"
              style={{ animationDelay: "240ms" }}
            >
              Ingenium follows each bill through Parliament, pinpoints the exact
              statutory change, and turns it into clear, client-specific exposure
              — reviewed and approved by counsel.
            </p>
            <div
              className="flex items-center justify-center gap-3 mt-9 stagger-reveal"
              style={{ animationDelay: "330ms" }}
            >
              <button
                onClick={onLaunch}
                className="glass-button px-7 py-3.5 text-sm rounded-full bg-black/[0.03] border border-black/15 hover:bg-black/[0.05] hover:border-black/25 transition-all inline-flex items-center gap-2"
              >
                Open workspace <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => go("workflow")}
                className="px-7 py-3.5 text-sm rounded-full text-[#59636e] hover:text-[#1f2328] border border-black/10 hover:border-black/20 transition-all"
              >
                See how it works
              </button>
            </div>
          </div>

          <div className="mt-10 md:mt-16" style={{ perspective: "1200px" }}>
            <div className="dashboard-image" style={{ animationDelay: "420ms" }}>
              <div ref={mockRef} style={{ transform: "rotateX(8deg)", transformStyle: "preserve-3d" }}>
                <DashboardMock />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <section className="relative py-10 border-y border-black/[0.06] bg-white overflow-hidden">
        <p className="text-center text-xs uppercase tracking-[0.2em] text-[#59636e] mb-7">
          Source-linked to Parliament &amp; Justice Canada
        </p>
        <div className="logo-marquee">
          <div className="logo-marquee-content">
            {[...PRACTICES, ...PRACTICES].map((p, i) => (
              <span
                key={i}
                className="px-8 flex-shrink-0 font-serif text-2xl text-[#59636e]/70 whitespace-nowrap"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* METRICS */}
      <section id="impact" className="relative py-24 md:py-32 px-4 animate-on-scroll">
        <div className="max-w-[1120px] w-full mx-auto">
          <h2 className="font-serif text-[32px] md:text-[48px] font-medium mb-4 text-center text-balance leading-[1.1]">
            The whole federal docket, <span className="terra-grad">in one place</span>
          </h2>
          <p className="text-[#59636e] text-sm md:text-base mb-14 text-center max-w-[600px] mx-auto leading-relaxed">
            Tracked from the source, parsed to the clause, and tied to the clients it touches.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 max-w-[800px] mx-auto">
            {METRICS.map((m, i) => (
              <div key={i} className="p-6 md:p-10 text-center border-t border-black/10">
                <div className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-[#59636e] mb-4 flex items-center justify-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      m.c === "pink" ? "bg-pink-400/70" : "bg-purple-400/70"
                    }`}
                  />
                  {m.label}
                </div>
                <div className="font-serif text-[52px] md:text-[72px] leading-none font-medium">
                  <AnimatedCounter value={m.value} />
                </div>
                <div className="text-[11px] md:text-xs text-[#59636e] mt-3">{m.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CAPABILITIES */}
      <section id="workflow" className="relative py-24 md:py-32 px-4 animate-on-scroll bg-white">
        <div className="max-w-[1120px] w-full mx-auto">
          <div className="text-center mb-14">
            <div className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-[#59636e] mb-5 flex items-center justify-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />
              HOW IT WORKS
            </div>
            <h2 className="font-serif text-[32px] md:text-[48px] font-medium text-balance leading-[1.1]">
              From a bill to a client memo, <span className="terra-grad">in four moves</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-black/[0.08] border border-black/10 rounded-[20px] overflow-hidden">
            {CAPS.map((c, i) => (
              <div key={i} className="bg-white p-7 hover:bg-black/[0.03] transition-colors">
                <div className="text-xs font-mono text-[#59636e] mb-5">0{i + 1}</div>
                <c.icon className="w-7 h-7 text-fuchsia-600 mb-5" strokeWidth={1.5} />
                <h3 className="text-lg font-medium mb-2">{c.title}</h3>
                <p className="text-sm text-[#59636e] leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative py-24 md:py-32 px-4 animate-on-scroll">
        <div className="max-w-[800px] w-full mx-auto">
          <h2 className="font-serif text-[32px] md:text-[48px] font-medium mb-12 text-center text-balance leading-[1.1]">
            Everything <span className="terra-grad">counsel asks</span>
          </h2>
          <div className="space-y-4">
            {FAQS.map((f, i) => (
              <div
                key={i}
                className="border border-black/10 rounded-xl overflow-hidden transition-all hover:border-black/20"
              >
                <button
                  onClick={() => setFaq(faq === i ? null : i)}
                  className="w-full flex items-center justify-between p-6 text-left"
                >
                  <span className="text-base md:text-lg font-medium pr-4">{f.q}</span>
                  <ChevronDown
                    className={`w-5 h-5 flex-shrink-0 text-[#59636e] transition-transform ${
                      faq === i ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ${
                    faq === i ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <p className="px-6 pb-6 text-sm md:text-base text-[#59636e] leading-relaxed">{f.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="relative py-28 md:py-40 px-4 animate-on-scroll overflow-hidden"
        style={{
          backgroundImage: "url('/earth-cta.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white via-white/80 to-white pointer-events-none" />
        <div className="max-w-[800px] w-full mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 glass-pill px-4 py-2 rounded-full mb-8 text-xs md:text-sm text-[#59636e]">
            <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />
            Ready when you are
          </div>
          <h2 className="font-serif text-[40px] md:text-[64px] font-medium mb-6 text-balance leading-[1.1]">
            Open the workspace
          </h2>
          <p className="text-[#59636e] text-base md:text-lg mb-10 leading-relaxed max-w-[560px] mx-auto">
            Track the docket, read the deltas, brief the clients — start now.
          </p>
          <button
            onClick={onLaunch}
            className="glass-button text-sm rounded-full bg-black/[0.03] border border-black/15 hover:bg-black/[0.06] hover:border-black/25 transition-all px-8 py-4 inline-flex items-center gap-2"
          >
            Open workspace <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative px-4 border-t border-black/[0.06] py-10">
        <div className="max-w-[1120px] w-full mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-10">
            <div className="flex flex-col gap-4">
              <div className="text-lg font-semibold font-mono">Ingenium</div>
              <p className="text-xs text-[#59636e] leading-relaxed max-w-[280px]">
                Turning federal legislative change into clear, client-specific advice. Built for BCF.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="text-xs uppercase tracking-[0.15em] text-[#1f2328] font-semibold mb-1">Product</div>
              <button onClick={() => go("workflow")} className="text-sm text-[#59636e] hover:text-[#1f2328] transition-colors text-left">How it works</button>
              <button onClick={() => go("impact")} className="text-sm text-[#59636e] hover:text-[#1f2328] transition-colors text-left">Coverage</button>
              <button onClick={onLaunch} className="text-sm text-[#59636e] hover:text-[#1f2328] transition-colors text-left">Workspace</button>
            </div>
            <div className="flex flex-col gap-3">
              <div className="text-xs uppercase tracking-[0.15em] text-[#1f2328] font-semibold mb-1">Sources</div>
              <a href="https://www.parl.ca/legisinfo/en" target="_blank" rel="noreferrer" className="text-sm text-[#59636e] hover:text-[#1f2328] transition-colors">LEGISinfo</a>
              <a href="https://laws-lois.justice.gc.ca" target="_blank" rel="noreferrer" className="text-sm text-[#59636e] hover:text-[#1f2328] transition-colors">Justice Canada</a>
              <a href="https://github.com/Lil-Chen05/project-injenium" target="_blank" rel="noreferrer" className="text-sm text-[#59636e] hover:text-[#1f2328] transition-colors inline-flex items-center gap-2"><Github className="w-4 h-4" /> GitHub</a>
            </div>
          </div>
          <div className="border-t border-black/[0.06] pt-8 flex flex-col md:flex-row justify-between items-center gap-3 text-xs text-[#59636e]">
            <div>© 2026 Ingenium · Built for BCF</div>
            <div>Montréal</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// A live, crafted miniature of our command-center — the hero product shot.
function DashboardMock() {
  return (
    <div className="rounded-[16px] overflow-hidden border border-black/15 bg-[#ffffff] shadow-[0_40px_120px_-30px_rgba(66,74,83,0.35)]">
      <div className="flex items-center gap-3 h-12 px-4 bg-[#f6f8fa] border-b border-black/10">
        <span className="flex items-center gap-2 font-bold text-[13px] tracking-wide">
          <span className="w-[18px] h-[18px] rounded-md bg-gradient-to-br from-[#1f883d] to-[#0969da]" />
          BCF
        </span>
        <div className="hidden sm:flex items-center gap-1.5 ml-2 text-[11.5px] text-[#59636e] overflow-hidden">
          {["Monitor", "Legal delta", "Client scan", "Client brief"].map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[#d1d9e0]">›</span>}
              <span className={`px-2.5 py-1.5 rounded-md ${i === 0 ? "bg-[#f6f8fa] text-[#1f2328]" : ""}`}>
                <span className="font-mono text-[10px] text-[#818b98]">0{i + 1}</span> {s}
              </span>
            </span>
          ))}
        </div>
        <span className="ml-auto w-[26px] h-[26px] rounded-md bg-gradient-to-br from-[#eaeef2] to-[#d1d9e0] border border-[#d1d9e0] grid place-items-center text-[10px] font-bold">U1</span>
      </div>
      <div className="p-4 bg-[#ffffff]">
        <div className="font-mono text-[10px] tracking-[0.08em] uppercase text-[#818b98] mb-3">
          Federal docket · 5,694 bills · 16 sessions
        </div>
        <div className="grid grid-cols-4 gap-2.5 mb-3">
          {[
            { n: "01", v: "5,694", l: "Bills tracked", on: true },
            { n: "02", v: "10", l: "Legal deltas", on: false },
            { n: "03", v: "3", l: "Clients", on: false },
            { n: "04", v: "5", l: "Ready", on: false },
          ].map((c) => (
            <div key={c.n} className={`rounded-[10px] border p-3 ${c.on ? "border-[#0969da]/60 bg-[#f6f8fa]" : "border-[#d1d9e0] bg-[#f6f8fa]"}`}>
              <div className="font-mono text-[10px] text-[#818b98]">{c.n}</div>
              <div className="text-[22px] font-bold tracking-tight text-[#1f2328] mt-1.5">{c.v}</div>
              <div className="text-[10.5px] text-[#59636e]">{c.l}</div>
            </div>
          ))}
        </div>
        <div className="rounded-[10px] border border-[#d1d9e0] overflow-hidden">
          {[
            { bill: "C-11", title: "An Act to amend the National Defence Act", pill: "Passed", tone: "text-[#1a7f37] border-[#1a7f37]/40 bg-[#1a7f37]/10" },
            { bill: "C-30", title: "Spring economic update implementation", pill: "Active", tone: "text-[#0969da] border-[#0969da]/40 bg-[#0969da]/10" },
            { bill: "S-233", title: "Criminal Code — health & first responders", pill: "Passed", tone: "text-[#1a7f37] border-[#1a7f37]/40 bg-[#1a7f37]/10" },
            { bill: "C-27", title: "Digital Charter Implementation Act", pill: "In committee", tone: "text-[#9a6700] border-[#9a6700]/40 bg-[#9a6700]/10" },
          ].map((r, i) => (
            <div key={r.bill} className={`grid grid-cols-[52px_1fr_auto] gap-3 items-center px-3 py-2.5 text-[11.5px] ${i > 0 ? "border-t border-[#eaeef2]" : ""}`}>
              <span className="font-mono font-semibold text-[#0969da]">{r.bill}</span>
              <span className="text-[#424a53] truncate">{r.title}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${r.tone}`}>{r.pill}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
