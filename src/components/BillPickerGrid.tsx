import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import type { Bill } from "../types";
import { MomentumBadge } from "./badges";

// A searchable, single-select bill browser. Used in the Client Scan stage to
// pair any bill with a client. Mirrors LawPickerGrid's card styling so the two
// pickers feel consistent.
export function BillPickerGrid({
  bills,
  activeId,
  onSelect,
  limit = 60,
}: {
  bills: Bill[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Cap the rendered list so a 5k-bill store stays snappy; search narrows it. */
  limit?: number;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bills;
    return bills.filter(
      (b) =>
        b.billNumber.toLowerCase().includes(q) ||
        b.title.toLowerCase().includes(q),
    );
  }, [bills, query]);

  const shown = filtered.slice(0, limit);
  const hiddenCount = filtered.length - shown.length;

  return (
    <div className="bpg">
      <div className="bpg-search">
        <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bills by number or title…"
          aria-label="Search bills"
        />
      </div>

      {shown.length === 0 ? (
        <div className="lpg-empty">No bills match “{query}”.</div>
      ) : (
        <div className="lpg-grid bpg-grid">
          {shown.map((b) => {
            const isActive = b.id === activeId;
            return (
              <div
                key={b.id}
                className={`card lpg-card ${isActive ? "active" : ""}`}
                onClick={() => onSelect(b.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(b.id);
                  }
                }}
              >
                {isActive && <span className="lpg-selected">✓ Selected</span>}
                <div className="lpg-top">
                  <span className="lpg-bill">{b.billNumber}</span>
                  {!isActive && <MomentumBadge value={b.legislativeMomentum} />}
                </div>
                <div className="lpg-title">{b.title}</div>
                <div className="lpg-foot">{b.status}</div>
              </div>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="bpg-more">
          +{hiddenCount} more — refine your search to narrow the list.
        </div>
      )}
    </div>
  );
}
