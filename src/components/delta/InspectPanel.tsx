// A floating panel showing this run's server logs verbatim — every back-and-forth
// the locator had with the Act, line for line. Plain text; good for a demo.
export function InspectPanel({ logs, onClose }: { logs: string[]; onClose: () => void }) {
  return (
    <div className="insp-overlay" role="dialog" aria-label="Inspect server logs">
      <div className="insp-backdrop" onClick={onClose} />
      <aside className="insp-panel">
        <div className="insp-head">
          <div>
            <div className="insp-title">Inspect · run log</div>
            <div className="insp-sub">{logs.length} line{logs.length === 1 ? "" : "s"} — every AI step, verbatim</div>
          </div>
          <button className="insp-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <pre className="insp-log">
          {logs.length === 0 ? "No log captured yet — hit Recompute to generate one." : logs.join("\n")}
        </pre>
      </aside>
    </div>
  );
}
