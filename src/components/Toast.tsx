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
      <span className="rd-toast-pip" />
      <span className="rd-toast-message">{message}</span>
      <kbd className="rd-toast-kbd">
        Esc
      </kbd>
    </div>
  );
}
