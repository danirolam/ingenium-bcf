type Level = "low" | "medium" | "high" | "critical";
type Urgency = "low" | "medium" | "high" | "immediate";

const LEVELS: Level[] = ["low", "medium", "high", "critical"];
const LEVEL_TOKEN: Record<Level, string> = {
  low: "var(--low)",
  medium: "var(--med)",
  high: "var(--high)",
  critical: "var(--crit)",
};

export function ImpactScale({
  level,
  urgency,
}: {
  level: Level;
  urgency: Urgency;
}) {
  const idx = LEVELS.indexOf(level);
  // Center of the active segment as a percentage across the 4-segment bar.
  const markerPct = (idx + 0.5) * (100 / 4);

  return (
    <div className="is-wrap">
      <div className="is-label">Impact level</div>

      <div className="is-track-wrap">
        <span
          className="is-marker"
          style={{
            left: `${markerPct}%`,
            color: LEVEL_TOKEN[level],
          }}
          aria-hidden
        >
          ▼
        </span>
        <div className="is-track" role="img" aria-label={`Impact level ${level}`}>
          {LEVELS.map((lv) => (
            <div
              key={lv}
              className={`is-seg s-${lv} ${lv === level ? "active" : ""}`}
            />
          ))}
        </div>
        <div className="is-labels">
          {LEVELS.map((lv) => (
            <span
              key={lv}
              className={`s-${lv} ${lv === level ? "active" : ""}`}
            >
              {lv}
            </span>
          ))}
        </div>
      </div>

      <div className={`is-urgency u-${urgency}`}>
        Urgency: {urgency}
      </div>
    </div>
  );
}
