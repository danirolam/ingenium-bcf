// Stage-2 entry — the delta library, rendered by DeltaWorkspace when no bill is
// addressed. A flat, newest-first list of every bill that already has a GENERATED
// provision delta, with an Approved / Needs-review tag, filterable by Category
// and Status and searchable by text, paginated 16 at a time. The symmetric
// mirror of the Stage-4 brief library (BriefPicker). Clicking an entry opens the
// delta at /bills/:billId/delta. "New delta" opens a picker over amending bills.
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faCodeCompare,
  faMagnifyingGlass,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import type { DeltaIndexEntry, LegislativeMomentum } from "../types";
import { api } from "../lib/api";
import { MomentumBadge } from "./badges";
import { PageHeader } from "./PageHeader";
import { NewDeltaPicker } from "./NewDeltaPicker";
import "../styles/deltalibrary.css";

const PAGE_SIZE = 16;

const MOMENTUM_LABEL: Record<LegislativeMomentum, string> = {
  early: "Early",
  active: "Active",
  advanced: "Advanced",
  passed: "Passed",
  in_force: "In force",
};
// Stable severity order for the Status dropdown.
const MOMENTUM_ORDER: LegislativeMomentum[] = [
  "early",
  "active",
  "advanced",
  "passed",
  "in_force",
];

// Same compact timestamp helper the other libraries use (kept local).
function fmtWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function DeltaLibrary({ nav }: { nav: Nav }) {
  const [entries, setEntries] = useState<DeltaIndexEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [category, setCategory] = useState(""); // "" = all
  const [status, setStatus] = useState(""); // "" = all
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    api.bills
      .deltas(ac.signal)
      .then((index) => {
        if (!ac.signal.aborted) setEntries(index);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        nav.toast(`Could not load the delta library: ${msg}`);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoaded(true);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dropdown options derive from the data itself — no extra endpoint.
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const e of entries) for (const p of e.practiceAreas ?? []) seen.add(p);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [entries]);
  const statusOptions = useMemo(() => {
    const seen = new Set<LegislativeMomentum>();
    for (const e of entries) seen.add(e.momentum);
    return MOMENTUM_ORDER.filter((m) => seen.has(m));
  }, [entries]);

  // Filters combine (AND); the server's newest-first order is preserved.
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (!category || (e.practiceAreas ?? []).includes(category)) &&
          (!status || e.momentum === status) &&
          (!q ||
            e.billNumber.toLowerCase().includes(q) ||
            e.billTitle.toLowerCase().includes(q) ||
            e.actTitles.some((t) => t.toLowerCase().includes(q))),
      ),
    [entries, category, status, q],
  );

  // Any filter/search change resets to the first page.
  useEffect(() => {
    setPage(0);
  }, [category, status, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE);

  function open(e: DeltaIndexEntry) {
    nav.go("delta", { billId: e.billId });
  }

  return (
    <>
      <PageHeader
        title="Legal delta"
        hint={{
          title: "Delta library",
          body: "Stage 2 of 4. Every delta Ingenium has generated — the change each bill makes to existing law. Open one to review and approve it, or start a new delta from any amending bill.",
        }}
        sub="Every delta you've generated — open one to review and approve, or start a new delta."
        actions={
          <button
            className="btn primary"
            data-testid="new-delta-btn"
            onClick={() => setPickerOpen(true)}
          >
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            New delta
          </button>
        }
      />
      <div className="body">
        <div className="card">
          <div className="card-h">
            <div className="card-title-row">
              <FontAwesomeIcon icon={faCodeCompare} aria-hidden="true" />
              <div className="card-title">Delta library</div>
              {loaded && entries.length > 0 && (
                <span className="dl-count">
                  (
                  {filtered.length === entries.length
                    ? entries.length
                    : `${filtered.length} of ${entries.length}`}
                  )
                </span>
              )}
            </div>
          </div>
          <div className="card-pad" data-testid="delta-library">
            {!loaded && <div className="empty-small">Loading delta library…</div>}

            {loaded && entries.length === 0 && (
              <div className="rd-empty" data-testid="deltas-empty">
                No deltas generated yet — pick a bill and Ingenium will compute the
                changes it makes to existing law.
                <div className="dl-empty-cta">
                  <button
                    className="btn"
                    data-testid="new-delta-cta"
                    onClick={() => setPickerOpen(true)}
                  >
                    Generate your first delta
                    <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {loaded && entries.length > 0 && (
              <>
                <div className="dl-filters">
                  <label className="dl-filter">
                    <span className="dl-filter-label">Category</span>
                    <select
                      data-testid="delta-filter-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="">All categories</option>
                      {categoryOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="dl-filter">
                    <span className="dl-filter-label">Status</span>
                    <select
                      data-testid="delta-filter-status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">All statuses</option>
                      {statusOptions.map((m) => (
                        <option key={m} value={m}>
                          {MOMENTUM_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="dl-search">
                    <FontAwesomeIcon
                      icon={faMagnifyingGlass}
                      className="dl-search-icon"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      data-testid="delta-search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by bill number, title, or Act"
                      aria-label="Search generated deltas"
                    />
                  </div>
                </div>

                {filtered.length === 0 && (
                  <div className="empty-small">No deltas match these filters.</div>
                )}

                {filtered.length > 0 && (
                  <>
                    <div className="dl-entry-list" data-testid="delta-entry-list">
                      {pageItems.map((e) => {
                        const allApproved =
                          e.opCount > 0 && e.approvedOpCount === e.opCount;
                        const someApproved = e.approvedOpCount > 0 && !allApproved;
                        return (
                          <div
                            key={e.billId}
                            className="dl-entry"
                            data-testid="delta-entry"
                            data-bill-id={e.billId}
                            role="button"
                            tabIndex={0}
                            onClick={() => open(e)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                open(e);
                              }
                            }}
                          >
                            <div className="dl-entry-main">
                              <span className="dl-bill-num">{e.billNumber}</span>
                              <span className="dl-entry-title">
                                {e.billShortTitle || e.billTitle}
                              </span>
                              <span className="dl-entry-acts">
                                {e.actTitles.join(", ")}
                              </span>
                            </div>
                            <div className="dl-entry-meta">
                              <span
                                className="dl-summary"
                                title="provisions added / changed / repealed"
                              >
                                <span className="dl-add">+{e.summary.added}</span>
                                <span className="dl-chg">~{e.summary.changed}</span>
                                <span className="dl-del">−{e.summary.repealed}</span>
                              </span>
                              <MomentumBadge value={e.momentum} />
                              {allApproved ? (
                                <span
                                  className="dl-tag dl-approved"
                                  data-testid="delta-tag-approved"
                                >
                                  Approved
                                </span>
                              ) : someApproved ? (
                                <span
                                  className="dl-tag dl-partial"
                                  data-testid="delta-tag-review"
                                >
                                  {e.approvedOpCount}/{e.opCount} approved
                                </span>
                              ) : (
                                <span
                                  className="dl-tag dl-review"
                                  data-testid="delta-tag-review"
                                >
                                  Needs review
                                </span>
                              )}
                              <span className="dl-entry-when">
                                {fmtWhen(e.generatedAt)}
                              </span>
                              <FontAwesomeIcon
                                icon={faArrowRight}
                                className="dl-entry-go"
                                aria-hidden="true"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {filtered.length > PAGE_SIZE && (
                      <div className="dl-pager">
                        <button
                          className="btn ghost sm"
                          data-testid="delta-page-prev"
                          disabled={safePage === 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                        >
                          Prev
                        </button>
                        <span className="dl-page-status" data-testid="delta-page-status">
                          {rangeStart}–{rangeEnd} of {filtered.length}
                        </span>
                        <button
                          className="btn ghost sm"
                          data-testid="delta-page-next"
                          disabled={safePage >= pageCount - 1}
                          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {pickerOpen && (
        <NewDeltaPicker nav={nav} onClose={() => setPickerOpen(false)} />
      )}
    </>
  );
}
