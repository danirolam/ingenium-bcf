import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faMagnifyingGlass,
  faUpload,
} from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import { MomentumBadge } from "../components/badges";
import { PageHeader } from "../components/PageHeader";
import { InfoHint } from "../components/InfoHint";
import { Tooltip } from "../components/Tooltip";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { StatsRibbon } from "../components/StatsRibbon";
import { api } from "../lib/api";
import { PRACTICE_AREAS } from "../lib/practiceAreas";
import type { Bill, LegislativeMomentum } from "../types";

type FilterValue = "all" | "active" | "late" | "assent" | "defeated";

function matchesFilter(b: Bill, f: FilterValue): boolean {
  const m: LegislativeMomentum = b.legislativeMomentum;
  switch (f) {
    case "all":
      return true;
    case "active":
      return m === "active" || m === "advanced";
    case "late":
      return m === "advanced";
    case "assent":
      return m === "passed" || m === "in_force";
    case "defeated":
      return false;
  }
}

export function BillMonitor({ nav }: { nav: Nav }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [query, setQuery] = useState("");
  const [practice, setPractice] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.bills
      .list()
      .then((b) => {
        if (!cancelled) setBills(b);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled)
          nav.toast(
            `Could not load bills: ${err.message ?? err}. Is the api server running on :8787?`,
          );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const { bill, email } = await api.bills.upload(raw);
      setBills((b) => [bill, ...b.filter((x) => x.id !== bill.id)]);
      nav.toast(
        email.simulated ? "Bill uploaded · Email simulated." : "Bill uploaded · Email sent.",
      );
    } catch (err: any) {
      nav.toast(`Upload failed: ${err.message ?? err}`);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function openDelta(bill: Bill) {
    setBusy(true);
    try {
      const result = await api.bills.extractDelta(bill.id).catch(() => null);
      if (result?.errors?.length) nav.toast(result.errors[0]);
      nav.go("delta", { billId: bill.id });
    } catch (err: any) {
      nav.toast(`Could not open delta: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    return {
      all: bills.length,
      active: bills.filter((b) => matchesFilter(b, "active")).length,
      late: bills.filter((b) => matchesFilter(b, "late")).length,
      assent: bills.filter((b) => matchesFilter(b, "assent")).length,
      defeated: 0,
    };
  }, [bills]);

  const billsByMomentumQuery = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bills
      .filter((b) => matchesFilter(b, filter))
      .filter((b) => {
        if (!q) return true;
        return (
          b.billNumber.toLowerCase().includes(q) ||
          b.title.toLowerCase().includes(q)
        );
      });
  }, [bills, filter, query]);

  const practiceCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of billsByMomentumQuery)
      for (const p of b.practiceAreas ?? []) m[p] = (m[p] ?? 0) + 1;
    return m;
  }, [billsByMomentumQuery]);

  // Show a pill for every practice with a bill in the current view, plus the
  // active one even if a momentum/search change just emptied it.
  const practiceItems = useMemo(
    () =>
      PRACTICE_AREAS.filter(
        (p) => (practiceCounts[p.label] ?? 0) > 0 || p.label === practice,
      ),
    [practiceCounts, practice],
  );

  const matchingBills = useMemo(() => {
    if (practice === "all") return billsByMomentumQuery;
    return billsByMomentumQuery.filter((b) =>
      (b.practiceAreas ?? []).includes(practice),
    );
  }, [billsByMomentumQuery, practice]);

  const [pageSize, setPageSize] = useState(50);
  // Reset cap when any filter / query changes
  useEffect(() => {
    setPageSize(50);
  }, [filter, query, practice]);
  const visibleBills = useMemo(
    () => matchingBills.slice(0, pageSize),
    [matchingBills, pageSize],
  );
  const hiddenCount = Math.max(0, matchingBills.length - visibleBills.length);

  const tabItems = [
    { value: "all", label: "All", count: counts.all },
    { value: "active", label: "Active", count: counts.active },
    { value: "late", label: "Late stage", count: counts.late },
    { value: "assent", label: "Royal assent", count: counts.assent },
    { value: "defeated", label: "Defeated", count: counts.defeated },
  ];

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Bill Monitor"]}
        title="Bill Monitor"
        hint={{
          title: "Bill Monitor",
          body: "Stage 1 of 4. Every federal bill the firm tracks, filterable by practice group and momentum. Open any bill to read its full path through Parliament, then send it on to legal-delta review.",
        }}
        sub="Federal and provincial legislation tracked here. Upload a bill JSON to ingest, normalize, and queue it for legal-delta review."
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={onUpload}
              hidden
            />
            <Tooltip
              placement="bottom"
              title="Upload a bill"
              body="Add a LEGISinfo bill JSON. Ingenium normalizes it, tags its practice areas, and queues it for legal-delta review."
            >
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <FontAwesomeIcon icon={faUpload} aria-hidden="true" />
                {busy ? "Working..." : "Upload bill JSON"}
              </button>
            </Tooltip>
          </>
        }
      />
      <div className="body">
        <StatsRibbon bills={bills} />

        <div className="bm-toolbar">
          <div className="bm-toolbar-left">
            <SegmentedTabs
              items={tabItems}
              value={filter}
              onChange={(v) => setFilter(v as FilterValue)}
            />
          </div>
          <div className="bm-toolbar-right">
            <div className="search">
              <FontAwesomeIcon icon={faMagnifyingGlass} className="search-icon" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search bills by number or title"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="btn-key">/</span>
            </div>
          </div>
        </div>

        {bills.length > 0 && (
          <div className="bm-practice-filter">
            <span className="bm-practice-label">
              Practice
              <InfoHint
                title="Practice filter"
                body="Narrow the docket to one BCF practice group. Bills are tagged automatically from their title and subject, so a bill can appear under more than one group."
              />
            </span>
            <div className="bm-practice-pills">
              <button
                type="button"
                className={`bm-pill${practice === "all" ? " is-active" : ""}`}
                onClick={() => setPractice("all")}
              >
                All practices
                <span className="bm-pill-count tnum">
                  {billsByMomentumQuery.length}
                </span>
              </button>
              {practiceItems.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`bm-pill${practice === p.label ? " is-active" : ""}`}
                  onClick={() =>
                    setPractice(practice === p.label ? "all" : p.label)
                  }
                >
                  {p.label}
                  <span className="bm-pill-count tnum">
                    {practiceCounts[p.label] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {bills.length === 0 ? (
          <div className="rd-empty">
            Inbox empty. Upload a LEGISinfo bill JSON, or seed the demo via{" "}
            <code className="inline-code">npm run seed</code>
            .
          </div>
        ) : filter === "defeated" || visibleBills.length === 0 ? (
          <div className="card">
            <div className="bm-empty-inline">
              {filter === "defeated"
                ? "No defeated bills in this session."
                : "No bills match the current filter."}
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="col-bill">Bill</th>
                    <th>Title</th>
                    <th className="col-status">Status</th>
                    <th className="col-momentum">Momentum</th>
                    <th className="col-movement">Latest movement</th>
                    <th className="col-action"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBills.map((b) => (
                    <tr
                      key={b.id}
                      onClick={() => nav.go("bill", { billId: b.id })}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <div className="billno tnum">{b.billNumber}</div>
                      </td>
                      <td>
                        <div className="billtitle">{b.title}</div>
                        {b.session && (
                          <div className="meta">Session {b.session}</div>
                        )}
                        {(b.practiceAreas?.length ?? 0) > 0 && (
                          <div className="bm-tag-row">
                            {b.practiceAreas.map((p) => (
                              <span key={p} className="badge outline dim bm-tag">
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="table-status">{b.status}</div>
                      </td>
                      <td>
                        <MomentumBadge value={b.legislativeMomentum} />
                      </td>
                      <td>
                        <div className="meta">
                          {b.latestActivity ?? "-"}
                        </div>
                        <div className="meta tnum meta-spaced">
                          {new Date(b.uploadedAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="table-action-cell">
                        <button
                          className="btn sm"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDelta(b);
                          }}
                        >
                          Open Delta
                          <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hiddenCount > 0 && (
              <div className="bm-more-row">
                <span className="bm-more-info tnum">
                  Showing {visibleBills.length} of {matchingBills.length}
                </span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setPageSize((n) => n + 50)}
                >
                  Load 50 more
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
