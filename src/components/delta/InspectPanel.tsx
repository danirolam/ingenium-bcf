import { useState } from "react";
import type { LocatorStep, LocatorTrace } from "../../types";

// A floating panel that replays the AI's work for each amendment — every tool it
// called against the Act and the placement it confirmed. Wired off the captured
// locator trace; great for showing how the engine reasons.
export function InspectPanel({ traces, onClose }: { traces: LocatorTrace[]; onClose: () => void }) {
  const tools = traces.reduce((n, t) => n + t.steps.filter((s) => s.kind === "tool").length, 0);
  return (
    <div className="insp-overlay" role="dialog" aria-label="Inspect AI steps">
      <div className="insp-backdrop" onClick={onClose} />
      <aside className="insp-panel">
        <div className="insp-head">
          <div>
            <div className="insp-title">Inspect · how the AI located each change</div>
            <div className="insp-sub">
              {traces.length} amendment{traces.length === 1 ? "" : "s"} · {tools} tool call{tools === 1 ? "" : "s"} against the Act
            </div>
          </div>
          <button className="insp-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="insp-body">
          {traces.length === 0 ? (
            <div className="insp-empty">No trace captured yet — hit Recompute to watch the AI navigate the Act.</div>
          ) : (
            traces.map((t, i) => <TraceCard key={`${t.clause}-${i}`} trace={t} defaultOpen={i === 0} />)
          )}
        </div>
      </aside>
    </div>
  );
}

function TraceCard({ trace, defaultOpen }: { trace: LocatorTrace; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const failed = /couldn't locate|error/i.test(trace.outcome);
  return (
    <div className={`insp-card${failed ? " is-fail" : ""}`}>
      <button className="insp-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="insp-card-chev">{open ? "▾" : "▸"}</span>
        <span className="insp-card-clause">cl {trace.clause}</span>
        <span className="insp-card-instr">{trace.instruction}</span>
        <span className="insp-card-meta">{trace.hops} hop{trace.hops === 1 ? "" : "s"} · {trace.seconds}s</span>
      </button>
      {open && (
        <div className="insp-steps">
          {trace.steps.map((s, i) => <Step key={i} s={s} />)}
          <div className={`insp-outcome${failed ? " is-fail" : ""}`}>{failed ? "✗" : "→"} {trace.outcome}</div>
        </div>
      )}
    </div>
  );
}

function Step({ s }: { s: LocatorStep }) {
  if (s.kind === "decision") {
    return (
      <div className="insp-step is-decision">
        <span className="insp-step-ic">✓</span>
        <span className="insp-step-text">{s.text}</span>
      </div>
    );
  }
  return (
    <div className="insp-step is-tool">
      <div className="insp-step-call">
        <span className="insp-step-ic">⛭</span>
        <b>{s.name}</b>
        {s.arg ? <span className="insp-step-arg">{s.arg}</span> : null}
      </div>
      {s.result && <div className="insp-step-result">{s.result}</div>}
    </div>
  );
}
