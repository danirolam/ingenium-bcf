export function ConfidenceMeter({
  value,
  label = "Confidence",
}: {
  value: number;
  label?: string;
}) {
  // Clamp to [0,1] so a malformed value can't spill the bar.
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const tone = v >= 0.8 ? "high" : v >= 0.55 ? "med" : "low";
  return (
    <div className={`conf ${tone}`}>
      <div className="conf-row">
        <span className="conf-label">{label}</span>
        <span className="conf-label">{(v * 100).toFixed(0)}%</span>
      </div>
      <div className="conf-bar">
        <div className="conf-fill" style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  );
}
