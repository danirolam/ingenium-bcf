import { useLayoutEffect, useRef } from "react";

// A floating panel showing this run's server logs verbatim — every back-and-forth
// the locator had with the Act, line for line. During a recompute it STREAMS: each
// step appears as the AI makes it (good for a demo). Plain text otherwise.
export function InspectPanel({
  logs,
  streaming = false,
  onClose,
}: {
  logs: string[];
  /** A recompute is in flight — lines are still arriving. */
  streaming?: boolean;
  onClose: () => void;
}) {
  // Pin to the newest line as it streams in.
  const logRef = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="insp-overlay" role="dialog" aria-label="Inspect server logs">
      <div className="insp-backdrop" onClick={onClose} />
      <aside className="insp-panel">
        <div className="insp-head">
          <div>
            <div className="insp-title">
              Inspect · run log
              {streaming && <span className="insp-live">● live</span>}
            </div>
            <div className="insp-sub">
              {streaming
                ? `${logs.length} step${logs.length === 1 ? "" : "s"} so far — the AI is working…`
                : `${logs.length} line${logs.length === 1 ? "" : "s"} — every AI step, verbatim`}
            </div>
          </div>
          <button className="insp-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <pre className="insp-log" ref={logRef}>
          {logs.length === 0
            ? streaming
              ? "Waiting for the AI's first step…"
              : "No log captured yet — hit Recompute to generate one."
            : logs.join("\n")}
        </pre>
      </aside>
    </div>
  );
}
