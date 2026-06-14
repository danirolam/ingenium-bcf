import { Tooltip } from "./Tooltip";

type Level = "low" | "medium" | "high" | "critical";

const LEVELS: Level[] = ["low", "medium", "high", "critical"];
const LEVEL_TOKEN: Record<Level, string> = {
  low: "var(--low)",
  medium: "var(--med)",
  high: "var(--high)",
  critical: "var(--crit)",
};

export function ImpactScale({ level }: { level: Level }) {
  const idx = LEVELS.indexOf(level);
  // Center of the active segment as a percentage across the 4-segment bar.
  const markerPct = (idx + 0.5) * (100 / 4);

  return (
    <div className="is-wrap">
      <div className="is-label">
        Impact level{" "}
        <Tooltip
          title="How impact level is set"
          body="The brief agent sets it (low / medium / high / critical) from the bill's counsel-approved changes and this client's profile — by how materially the changes would affect the client's obligations and operations. When the analysis spans several provision batches, the highest severity wins. (Distinct from the stage-3 scan band, a 0–100 relevance score.)"
        >
          <span
            data-testid="impact-level-info"
            aria-label="How impact level is computed"
            tabIndex={0}
            style={{ cursor: "help", opacity: 0.6, fontSize: "0.85em" }}
          >
            ⓘ
          </span>
        </Tooltip>
      </div>

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

    </div>
  );
}
