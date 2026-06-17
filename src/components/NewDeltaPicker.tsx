// Stage-2 "New delta" picker - a modal over the amending bills (those whose
// title amends an Act), the way to START a delta for a bill that doesn't have
// one yet. Searchable + paginated 16 at a time. Picking a bill navigates to
// /bills/:billId/delta, where the delta generates and then joins the library.
// Rendered only by DeltaLibrary (which imports deltalibrary.css for the dl-* classes).
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faMagnifyingGlass,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import type { Bill } from "../types";
import { api } from "../lib/api";
import { MomentumBadge } from "./badges";

const PAGE_SIZE = 16;

export function NewDeltaPicker({
  nav,
  onClose,
}: {
  nav: Nav;
  onClose: () => void;
}) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    api.bills
      .list(ac.signal)
      .then((b) => {
        if (!ac.signal.aborted) setBills(b);
      })
      .catch(() => {})
      .finally(() => {
        if (!ac.signal.aborted) setLoaded(true);
      });
    return () => ac.abort();
  }, []);

  // Close on Escape.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const amending = useMemo(
    () => bills.filter((b) => /\bamend/i.test(b.title)),
    [bills],
  );
  const filtered = useMemo(
    () =>
      !q
        ? amending
        : amending.filter(
            (b) =>
              b.billNumber.toLowerCase().includes(q) ||
              b.title.toLowerCase().includes(q),
          ),
    [amending, q],
  );
  useEffect(() => {
    setPage(0);
  }, [q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE);

  function pick(b: Bill) {
    nav.go("delta", { billId: b.id });
  }

  return (
    <div className="dl-modal-overlay" onClick={onClose}>
      <div
        className="dl-modal"
        data-testid="new-delta-modal"
        role="dialog"
        aria-label="Pick a bill to start a new delta"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dl-modal-h">
          <div className="card-title">New delta: pick a bill</div>
          <button className="dl-modal-close" aria-label="Close" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
          </button>
        </div>

        <div className="dl-modal-search">
          <div className="dl-search">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="dl-search-icon"
              aria-hidden="true"
            />
            <input
              type="search"
              data-testid="new-delta-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search amending bills by number or title"
              aria-label="Search amending bills"
              autoFocus
            />
          </div>
        </div>

        <div className="dl-modal-body">
          {!loaded && <div className="empty-small">Loading bills…</div>}
          {loaded && filtered.length === 0 && (
            <div className="empty-small">No amending bills match.</div>
          )}
          {loaded && filtered.length > 0 && (
            <div className="dl-entry-list" data-testid="new-delta-list">
              {pageItems.map((b) => (
                <div
                  key={b.id}
                  className="dl-entry"
                  data-testid="new-delta-item"
                  data-bill-id={b.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => pick(b)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      pick(b);
                    }
                  }}
                >
                  <div className="dl-entry-main">
                    <span className="dl-bill-num">{b.billNumber}</span>
                    <span className="dl-entry-acts">{b.title}</span>
                  </div>
                  <div className="dl-entry-meta">
                    <MomentumBadge value={b.legislativeMomentum} />
                    <FontAwesomeIcon
                      icon={faArrowRight}
                      className="dl-entry-go"
                      aria-hidden="true"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="dl-pager">
            <button
              className="btn ghost sm"
              data-testid="new-delta-page-prev"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </button>
            <span className="dl-page-status" data-testid="new-delta-page-status">
              {rangeStart}–{rangeEnd} of {filtered.length}
            </span>
            <button
              className="btn ghost sm"
              data-testid="new-delta-page-next"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
