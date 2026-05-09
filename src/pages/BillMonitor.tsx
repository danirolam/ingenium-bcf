import { useEffect, useMemo, useRef, useState } from "react";
import type { Nav } from "../App";
import { MomentumBadge } from "../components/badges";
import { PageHeader } from "../components/PageHeader";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { Sparkline } from "../components/Sparkline";
import { StatsRibbon } from "../components/StatsRibbon";
import { api } from "../lib/api";
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

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function activitySeries(id: string, n = 6): number[] {
  let x = hashSeed(id) || 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out.push(4 + (x % 16) + i * 0.4);
  }
  return out;
}

export function BillMonitor({ nav }: { nav: Nav }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.bills.list().then(setBills).catch(console.error);
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
      const lv = await api.bills.extractDelta(bill.id);
      nav.go("delta", { lawVersionId: lv.id });
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

  const visibleBills = useMemo(() => {
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
        sub="Federal and provincial legislation tracked here. Upload a bill JSON to ingest, normalize, and queue it for legal-delta review."
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={onUpload}
              style={{ display: "none" }}
            />
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {busy ? "Working…" : "+ Upload bill JSON"}
            </button>
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
              <input
                type="text"
                placeholder="Search bills by number or title…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="btn-key">/</span>
            </div>
          </div>
        </div>

        {bills.length === 0 ? (
          <div className="rd-empty">
            Inbox empty. Upload a LEGISinfo bill JSON, or seed the demo via{" "}
            <code
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 2,
                padding: "1px 6px",
                color: "var(--ink-2)",
              }}
            >
              npm run seed
            </code>
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
                    <th style={{ width: 110 }}>Bill</th>
                    <th>Title</th>
                    <th style={{ width: 160 }}>Status</th>
                    <th style={{ width: 140 }}>Momentum</th>
                    <th style={{ width: 80 }}>Activity</th>
                    <th style={{ width: 220 }}>Latest movement</th>
                    <th style={{ width: 130 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBills.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div className="billno tnum">{b.billNumber}</div>
                      </td>
                      <td>
                        <div className="billtitle">{b.title}</div>
                        {b.session && (
                          <div className="meta">Session {b.session}</div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: 13 }}>{b.status}</div>
                      </td>
                      <td>
                        <MomentumBadge value={b.legislativeMomentum} />
                      </td>
                      <td>
                        <Sparkline values={activitySeries(b.id)} />
                      </td>
                      <td>
                        <div className="meta">
                          {b.latestActivity ?? "—"}
                        </div>
                        <div className="meta tnum" style={{ marginTop: 2 }}>
                          {new Date(b.uploadedAt).toLocaleString()}
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn sm"
                          disabled={busy}
                          onClick={() => openDelta(b)}
                        >
                          Open Delta →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
