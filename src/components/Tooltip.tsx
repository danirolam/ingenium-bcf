import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom";

// A small, dependency-free tooltip that renders into document.body so it is
// never clipped by a scroll container, supports keyboard focus as well as
// hover, and closes on Escape or scroll. Title + body read like a Blueprint /
// Primer hint rather than a bare label.
export function Tooltip({
  title,
  body,
  kbd,
  placement = "bottom",
  className = "tt-trigger",
  children,
}: {
  title?: ReactNode;
  body?: ReactNode;
  kbd?: string;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(
      Math.max(r.left + r.width / 2, 168),
      window.innerWidth - 168,
    );
    const top = placement === "top" ? r.top - 8 : r.bottom + 8;
    setCoords({ top, left });
    setOpen(true);
  }, [placement]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  if (!title && !body) return <>{children}</>;

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className={`tt-pop tt-${placement}`}
            style={{ top: coords.top, left: coords.left }}
          >
            {title && <span className="tt-title">{title}</span>}
            {body && <span className="tt-body">{body}</span>}
            {kbd && <span className="tt-kbd">{kbd}</span>}
          </span>,
          document.body,
        )}
    </span>
  );
}
