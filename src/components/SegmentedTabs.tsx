import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface SegmentedItem {
  value: string;
  label: string;
  count?: number;
}

export function SegmentedTabs({
  items,
  value,
  onChange,
}: {
  items: SegmentedItem[];
  value: string;
  onChange: (v: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [ribbon, setRibbon] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const measure = useCallback(() => {
    const idx = items.findIndex((i) => i.value === value);
    const list = listRef.current;
    const btn = btnRefs.current[idx];
    if (!list || !btn) return;
    const listRect = list.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setRibbon({
      left: btnRect.left - listRect.left,
      width: btnRect.width,
    });
  }, [items, value]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  function onKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const idx = items.findIndex((i) => i.value === value);
    if (idx < 0) return;
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft")
      next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    onChange(items[next].value);
    btnRefs.current[next]?.focus();
  }

  return (
    <div className="seg">
      <ul
        ref={listRef}
        className="seg-list"
        role="tablist"
        onKeyDown={onKeyDown}
      >
        {items.map((it, i) => {
          const active = it.value === value;
          return (
            <li key={it.value} className="seg-item">
              <button
                ref={(el) => {
                  btnRefs.current[i] = el;
                }}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={`seg-btn${active ? " is-active" : ""}`}
                onClick={() => onChange(it.value)}
                type="button"
              >
                <span className="seg-label">{it.label}</span>
                {typeof it.count === "number" && (
                  <span className="seg-count tnum">{it.count}</span>
                )}
              </button>
            </li>
          );
        })}
        <span
          className="seg-ribbon"
          aria-hidden="true"
          style={{
            left: ribbon.left,
            width: ribbon.width,
            transition: reduceMotion
              ? "none"
              : "left 180ms ease, width 180ms ease",
          }}
        />
      </ul>
    </div>
  );
}
