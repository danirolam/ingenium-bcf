export function ConfidenceMeter({
  value,
  label = "Confidence",
}: {
  value: number;
  label?: string;
}) {
  const tone = value >= 0.8 ? "high" : value >= 0.55 ? "med" : "low";
  return (
    <div className={`conf ${tone}`}>
      <div className="conf-row">
        <span className="conf-label">{label}</span>
        <span className="conf-label">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="conf-bar">
        <div className="conf-fill" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}
