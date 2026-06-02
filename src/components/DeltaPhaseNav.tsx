import { Fragment } from "react";

// The three focused stages of the delta workflow. Each is a real URL
// (/bills/:id/delta/:phase) so the back/forward arrows move between them.
export type DeltaPhase = "approve" | "export";

const STEPS: { id: DeltaPhase; label: string }[] = [
  { id: "approve", label: "Review & approve" },
  { id: "export", label: "Export" },
];

export function DeltaPhaseNav({
  phase,
  onGo,
  approved,
  exportEnabled = true,
}: {
  phase: DeltaPhase;
  onGo: (p: DeltaPhase) => void;
  /** Approval progress, shown on the Approve step (e.g. 4/12). */
  approved?: { done: number; total: number };
  /** Export is gated until every placement is approved. */
  exportEnabled?: boolean;
}) {
  const idx = STEPS.findIndex((s) => s.id === phase);
  return (
    <nav className="dphase" aria-label="Delta workflow">
      {STEPS.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "todo";
        const locked = s.id === "export" && !exportEnabled;
        return (
          <Fragment key={s.id}>
            {i > 0 && <span className="dphase-sep" aria-hidden="true" />}
            <button
              type="button"
              className={`dphase-step is-${state}${locked ? " is-locked" : ""}`}
              disabled={locked}
              aria-current={state === "current" ? "step" : undefined}
              title={locked ? "Approve every placement first" : undefined}
              onClick={() => !locked && onGo(s.id)}
            >
              <span className="dphase-num">{i + 1}</span>
              <span className="dphase-label">{s.label}</span>
              {s.id === "approve" && approved && (
                <span className="dphase-count">
                  {approved.done}/{approved.total}
                </span>
              )}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
