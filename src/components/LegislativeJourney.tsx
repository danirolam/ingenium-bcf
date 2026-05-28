import type { LegislativeMomentum } from "../types";

const STAGES = [
  "First reading",
  "Second reading",
  "Committee stage",
  "Report stage",
  "Third reading",
  "Royal assent",
] as const;

// Map momentum → highest-completed stage index (0-based, inclusive).
function highestCompleted(momentum: LegislativeMomentum): number {
  switch (momentum) {
    case "early":
      return 0;
    case "active":
      return 1;
    case "advanced":
      return 4;
    case "passed":
    case "in_force":
      return 5;
    default:
      return 0;
  }
}

// Try to find which stage matches the status text (case-insensitive).
function statusStageIndex(status: string): number | null {
  if (!status) return null;
  const s = status.toLowerCase();
  // Order matters — third reading must beat "reading" generic.
  if (s.includes("royal assent")) return 5;
  if (s.includes("third reading")) return 4;
  if (s.includes("report")) return 3;
  if (s.includes("committee")) return 2;
  if (s.includes("second reading")) return 1;
  if (s.includes("first reading")) return 0;
  return null;
}

export function LegislativeJourney({
  momentum,
  status,
  effectiveDate,
  comingIntoForceText,
}: {
  momentum: LegislativeMomentum;
  status: string;
  effectiveDate?: string | null;
  comingIntoForceText?: string | null;
}) {
  const completedTo = highestCompleted(momentum);
  const matched = statusStageIndex(status);
  // The "current" stage is the matched one if present, else the highest completed.
  const currentIdx = matched ?? completedTo;

  return (
    <div>
      <div className="lj-wrap">
        {STAGES.map((name, i) => {
          const isCurrent = i === currentIdx;
          const isDone = i <= completedTo && !isCurrent;
          const pipCls = isCurrent
            ? "lj-pip current"
            : isDone
              ? "lj-pip done"
              : "lj-pip";
          const nameCls = isCurrent
            ? "lj-name current"
            : isDone
              ? "lj-name done"
              : "lj-name";

          // Show royal assent date if it's the last stage and we have an effectiveDate.
          let date: string | null = null;
          if (i === 5 && (momentum === "passed" || momentum === "in_force")) {
            date = effectiveDate ?? comingIntoForceText ?? null;
          }

          return (
            <div className="lj-row" key={name}>
              <span className={pipCls} aria-hidden />
              <div>
                <div className={nameCls}>{name}</div>
                <div className="lj-date">{date ?? "—"}</div>
              </div>
              {isCurrent ? <span className="lj-pill">Current</span> : <span />}
            </div>
          );
        })}
      </div>
      {momentum === "in_force" && (
        <div className="lj-foot">
          <span className="lj-foot-pip" />
          In force
          {comingIntoForceText ? ` · ${comingIntoForceText}` : ""}
        </div>
      )}
    </div>
  );
}
