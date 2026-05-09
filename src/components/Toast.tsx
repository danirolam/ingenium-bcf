import { useEffect } from "react";

export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 3500);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div className="rd-toast">
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--ok)",
          boxShadow: "0 0 0 3px rgba(52, 211, 153, 0.18)",
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1 }}>{message}</span>
      <kbd
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.04em",
          color: "var(--ink-4)",
          border: "1px solid var(--border-2)",
          borderRadius: 4,
          padding: "1px 5px",
          background: "transparent",
        }}
      >
        Esc
      </kbd>
    </div>
  );
}
