"use client";

import { useEffect, useRef, useState } from "react";
import {
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Github,
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

function Mark({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "w-5 h-5 rounded-[6px] text-[9px]" : "w-6 h-6 rounded-[7px] text-[10.5px]";
  return (
    <span
      className={`${box} bg-[#1d1d1f] text-white grid place-items-center font-semibold select-none`}
      aria-hidden="true"
    >
      In
    </span>
  );
}

const NAV = [
  { id: "impact", label: "Impact" },
  { id: "workflow", label: "How it works" },
  { id: "faq", label: "FAQ" },
];

const METRICS = [
  { label: "Bills tracked", value: "5694", desc: "across 16 sessions of Parliament" },
  { label: "With full text", value: "160", desc: "current session, clause by clause" },
  { label: "Practice groups", value: "9", desc: "mapped automatically" },
  { label: "Consolidated Acts", value: "964", desc: "the full federal statute book" },
];

const CAPS: { title: string; desc: string }[] = [
  { title: "Monitor", desc: "Every federal bill, tracked by practice area and momentum." },
  { title: "Legal delta", desc: "See exactly which sections of which Acts a bill changes." },
  { title: "Client scan", desc: "Match each change against a client's operations and contracts." },
  { title: "Client brief", desc: "Produce a counsel-approved exposure memo, ready to send." },
];

const FAQS = [
  {
    q: "Where does the legislative data come from?",
    a: "Every bill is sourced from Parliament's LEGISinfo and the published bill text on parl.ca, from first reading through royal assent, with committee stages and recorded divisions. The official source is one click away on each bill.",
  },
  {
    q: "What does “legal delta” mean?",
    a: "The precise change a bill makes to existing law: the sections it adds, repeals, or replaces in each consolidated Act, shown side by side so counsel can review the exact wording before it informs client work.",
  },
  {
    q: "How are bills matched to our clients?",
    a: "Approved deltas are scanned against each client's operations, policies, and contracts to flag who is exposed, how, and how urgently, turning a statutory change into a client-specific assessment.",
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
          heroRef.current.style.transform = `translateY(${(y * 0.06).toFixed(1)}px)`;
        if (mockRef.current)
          mockRef.current.style.transform = `rotateX(${Math.max(0, 5 - y * 0.02).toFixed(2)}deg)`;
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
    <div className="lp relative min-h-screen bg-white text-[#1d1d1f] overflow-x-hidden">
      <header className="fixed top-0 inset-x-0 z-40 bg-white/80 backdrop-blur-xl border-b border-black/[0.08]">
        <div className="max-w-[1080px] mx-auto px-5 md:px-6">
          <div className="flex items-center h-12 gap-3">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight hover:opacity-70 transition-opacity"
            >
              <Mark />
              Ingenium
            </button>
            <nav className="hidden md:flex items-center gap-7 ml-8">
              {NAV.map((n) => (
                <button
                  key={n.id}
                  onClick={() => go(n.id)}
                  className="text-[13px] text-[#424245] hover:text-black transition-colors"
                >
                  {n.label}
                </button>
              ))}
            </nav>
            <div className="ml-auto hidden md:flex items-center">
              <button
                onClick={onLaunch}
                className="text-[13px] font-medium text-white bg-[#1d1d1f] hover:bg-black px-4 h-8 rounded-full transition-colors inline-flex items-center gap-1.5"
              >
                Open workspace <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
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
        <div className="fixed inset-0 bg-white/95 backdrop-blur-md z-50 flex flex-col items-start justify-end pb-20 px-8 gap-6">
          <button
            onClick={() => setMenuOpen(false)}
            className="absolute top-3 right-5 p-2 hover:bg-black/[0.04] rounded-lg"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className="text-4xl font-semibold tracking-tight hover:text-[#0066cc] transition-colors"
            >
              {n.label}
            </button>
          ))}
          <button
            onClick={() => {
              setMenuOpen(false);
              onLaunch();
            }}
            className="text-4xl font-semibold tracking-tight hover:text-[#0066cc] transition-colors"
          >
            Workspace
          </button>
        </div>
      )}

      {/* HERO — Montréal, softened to white at the base */}
      <section
        className={`hero-section relative min-h-screen flex flex-col items-center justify-start px-5 pt-24 md:pt-28 pb-20 transition-transform duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${
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
              className="text-[13px] md:text-sm font-medium text-[#424245] mb-6 stagger-reveal"
              style={{ animationDelay: "0ms" }}
            >
              Legislative intelligence for BCF
            </div>
            <h1 className="font-semibold text-balance leading-[1.04]">
              <span
                className="block text-5xl md:text-[76px] tracking-[-0.02em] stagger-reveal"
                style={{ animationDelay: "60ms" }}
              >
                Every federal bill,
              </span>
              <span
                className="block text-5xl md:text-[76px] tracking-[-0.02em] stagger-reveal"
                style={{ animationDelay: "150ms" }}
              >
                translated to client-ready advice.
              </span>
            </h1>
            <p
              className="text-[#424245] text-[17px] md:text-[19px] max-w-[620px] mx-auto mt-7 leading-relaxed stagger-reveal"
              style={{ animationDelay: "240ms" }}
            >
              Ingenium follows each bill through Parliament, pinpoints the exact
              statutory change, and turns it into clear, client-specific exposure,
              reviewed and approved by counsel.
            </p>
            <div
              className="flex items-center justify-center gap-6 mt-9 stagger-reveal"
              style={{ animationDelay: "330ms" }}
            >
              <button
                onClick={onLaunch}
                className="text-sm font-medium text-white bg-[#1d1d1f] hover:bg-black px-6 py-3 rounded-full transition-colors inline-flex items-center gap-2"
              >
                Open workspace <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => go("workflow")}
                className="text-sm font-medium text-[#0066cc] hover:underline underline-offset-4 inline-flex items-center gap-0.5"
              >
                See how it works <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="mt-6 md:mt-10" style={{ perspective: "1200px" }}>
            <div className="dashboard-image" style={{ animationDelay: "420ms" }}>
              <div ref={mockRef} style={{ transform: "rotateX(5deg)", transformStyle: "preserve-3d" }}>
                <DashboardMock />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* METRICS — black band */}
      <section id="impact" className="relative py-16 md:py-24 px-5 animate-on-scroll bg-black text-white">
        <div className="max-w-[1120px] w-full mx-auto">
          <h2 className="text-[32px] md:text-[48px] font-semibold tracking-[-0.02em] mb-4 text-center text-balance leading-[1.08]">
            The whole federal docket, <span className="grad-blue">in one place.</span>
          </h2>
          <p className="text-[#a1a1a6] text-[15px] md:text-[17px] mb-10 text-center max-w-[620px] mx-auto leading-relaxed">
            Tracked from the source, parsed to the clause, and tied to the clients it touches.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-x-16 md:gap-y-10 max-w-[820px] mx-auto">
            {METRICS.map((m, i) => (
              <div key={i} className="p-6 md:p-8 text-center border-t border-white/10">
                <div className="text-[13px] font-medium text-[#a1a1a6] mb-3">{m.label}</div>
                <div className="text-[52px] md:text-[68px] leading-none font-semibold tracking-[-0.02em]">
                  <AnimatedCounter value={m.value} />
                </div>
                <div className="text-[13px] text-[#a1a1a6] mt-3">{m.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — four quiet columns */}
      <section id="workflow" className="relative py-16 md:py-24 px-5 animate-on-scroll bg-white">
        <div className="max-w-[1080px] w-full mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-[32px] md:text-[44px] font-semibold tracking-[-0.02em] text-balance leading-[1.08]">
              From a bill to a client memo, in four moves.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-10">
            {CAPS.map((c, i) => (
              <div key={i} className="border-t border-[#d2d2d7] pt-6">
                <div className="text-[13px] font-medium text-[#86868b] mb-3">Step {i + 1}</div>
                <h3 className="text-[19px] font-semibold tracking-tight mb-2">{c.title}</h3>
                <p className="text-[14px] text-[#6e6e73] leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-[13px] text-[#86868b] mt-12">
            Source-linked to Parliament &amp; Justice Canada throughout.
          </p>
        </div>
      </section>

      {/* FAQ — hairline accordion */}
      <section id="faq" className="relative py-16 md:py-24 px-5 animate-on-scroll bg-[#f5f5f7]">
        <div className="max-w-[760px] w-full mx-auto">
          <h2 className="text-[32px] md:text-[44px] font-semibold tracking-[-0.02em] mb-10 text-center text-balance leading-[1.08]">
            Everything counsel asks.
          </h2>
          <div>
            {FAQS.map((f, i) => (
              <div key={i} className="border-b border-[#d2d2d7]">
                <button
                  onClick={() => setFaq(faq === i ? null : i)}
                  className="w-full flex items-center justify-between py-6 text-left group"
                >
                  <span className="text-base md:text-[17px] font-medium pr-4 group-hover:text-[#0066cc] transition-colors">
                    {f.q}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 flex-shrink-0 text-[#86868b] transition-transform ${
                      faq === i ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ${
                    faq === i ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <p className="pb-6 text-[15px] text-[#6e6e73] leading-relaxed max-w-[640px]">{f.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — quiet black band */}
      <section className="relative py-16 md:py-24 px-5 animate-on-scroll bg-black text-white">
        <div className="max-w-[800px] w-full mx-auto text-center">
          <h2 className="text-[36px] md:text-[56px] font-semibold tracking-[-0.02em] mb-6 text-balance leading-[1.06]">
            Open the workspace.
          </h2>
          <p className="text-[#a1a1a6] text-base md:text-lg mb-10 leading-relaxed max-w-[560px] mx-auto">
            Track the docket, read the deltas, brief the clients. Start now.
          </p>
          <button
            onClick={onLaunch}
            className="text-sm font-medium text-[#1d1d1f] bg-white hover:bg-[#f5f5f7] px-7 py-3.5 rounded-full transition-colors inline-flex items-center gap-2"
          >
            Open workspace <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative px-5 bg-white border-t border-black/[0.06] py-12">
        <div className="max-w-[1080px] w-full mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-10">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
                <Mark size="sm" />
                Ingenium
              </div>
              <p className="text-[13px] text-[#6e6e73] leading-relaxed max-w-[280px]">
                Turning federal legislative change into clear, client-specific advice. Built for BCF.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="text-[13px] font-semibold text-[#1d1d1f] mb-1">Product</div>
              <button onClick={() => go("workflow")} className="text-[13px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors text-left">How it works</button>
              <button onClick={() => go("impact")} className="text-[13px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors text-left">Coverage</button>
              <button onClick={onLaunch} className="text-[13px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors text-left">Workspace</button>
            </div>
            <div className="flex flex-col gap-3">
              <div className="text-[13px] font-semibold text-[#1d1d1f] mb-1">Sources</div>
              <a href="https://www.parl.ca/legisinfo/en" target="_blank" rel="noreferrer" className="text-[13px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors">LEGISinfo</a>
              <a href="https://laws-lois.justice.gc.ca" target="_blank" rel="noreferrer" className="text-[13px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors">Justice Canada</a>
              <a href="https://github.com/Lil-Chen05/project-injenium" target="_blank" rel="noreferrer" className="text-[13px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors inline-flex items-center gap-2"><Github className="w-3.5 h-3.5" /> GitHub</a>
            </div>
          </div>
          <div className="border-t border-black/[0.06] pt-7 flex flex-col md:flex-row justify-between items-center gap-3 text-[13px] text-[#6e6e73]">
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
    <div className="rounded-[18px] overflow-hidden border border-black/[0.08] bg-white shadow-[0_30px_90px_-30px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-3 h-12 px-4 bg-[#fafafa] border-b border-black/[0.06]">
        <span className="flex items-center gap-2 font-semibold text-[13px] tracking-tight">
          <span className="w-[18px] h-[18px] rounded-[5px] bg-[#1d1d1f] text-white grid place-items-center text-[8px] font-semibold">In</span>
          Ingenium
        </span>
        <div className="hidden sm:flex items-center gap-1.5 ml-2 text-[11.5px] text-[#6e6e73] overflow-hidden">
          {["Monitor", "Legal delta", "Client scan", "Client brief"].map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[#d2d2d7]">›</span>}
              <span className={`px-2.5 py-1.5 rounded-full ${i === 0 ? "bg-black/[0.05] text-[#1d1d1f] font-medium" : ""}`}>
                {s}
              </span>
            </span>
          ))}
        </div>
        <span className="ml-auto w-[26px] h-[26px] rounded-full bg-[#e8e8ed] border border-black/[0.06] grid place-items-center text-[10px] font-semibold text-[#424245]">U1</span>
      </div>
      <div className="p-4 bg-white">
        <div className="text-[12px] font-medium text-[#86868b] mb-3">
          Federal docket · 5,694 bills · 16 sessions
        </div>
        <div className="grid grid-cols-4 gap-2.5 mb-3">
          {[
            { v: "5,694", l: "Bills tracked", on: true },
            { v: "10", l: "Legal deltas", on: false },
            { v: "3", l: "Clients", on: false },
            { v: "5", l: "Ready", on: false },
          ].map((c) => (
            <div key={c.l} className={`rounded-[12px] border p-3 ${c.on ? "border-[#1d1d1f]/30 bg-[#fafafa]" : "border-[#e8e8ed] bg-[#fafafa]"}`}>
              <div className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">{c.v}</div>
              <div className="text-[11px] text-[#6e6e73] mt-0.5">{c.l}</div>
            </div>
          ))}
        </div>
        <div className="rounded-[12px] border border-[#e8e8ed] overflow-hidden">
          {[
            { bill: "C-11", title: "An Act to amend the National Defence Act", pill: "Passed", tone: "text-[#1a7f37] border-[#1a7f37]/30 bg-[#1a7f37]/[0.08]" },
            { bill: "C-30", title: "Spring economic update implementation", pill: "Active", tone: "text-[#0066cc] border-[#0071e3]/30 bg-[#0071e3]/[0.08]" },
            { bill: "S-233", title: "Criminal Code (health and first responders)", pill: "Passed", tone: "text-[#1a7f37] border-[#1a7f37]/30 bg-[#1a7f37]/[0.08]" },
            { bill: "C-27", title: "Digital Charter Implementation Act", pill: "In committee", tone: "text-[#a05a00] border-[#a05a00]/30 bg-[#a05a00]/[0.08]" },
          ].map((r, i) => (
            <div key={r.bill} className={`grid grid-cols-[52px_1fr_auto] gap-3 items-center px-3 py-2.5 text-[11.5px] ${i > 0 ? "border-t border-[#f0f0f2]" : ""}`}>
              <span className="font-semibold text-[#0066cc]">{r.bill}</span>
              <span className="text-[#424245] truncate">{r.title}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${r.tone}`}>{r.pill}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
