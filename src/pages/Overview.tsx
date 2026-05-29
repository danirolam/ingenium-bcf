import { Fragment, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import type { Bill, Client, LawVersion, LegislativeMomentum } from "../types";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { InfoHint } from "../components/InfoHint";
import { MomentumBadge } from "../components/badges";
import { WORKFLOW_STEPS } from "../lib/workflow";

const MOMENTUM_ROWS: { key: LegislativeMomentum; label: string }[] = [
  { key: "advanced", label: "Late stage" },
  { key: "active", label: "Active" },
  { key: "early", label: "Early" },
  { key: "passed", label: "Passed" },
  { key: "in_force", label: "In force" },
];

export function Overview({ nav }: { nav: Nav }) {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [lawVersions, setLawVersions] = useState<LawVersion[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      api.bills.list(),
      api.lawVersions.list(),
      api.clients.list(),
    ]).then((res) => {
      if (cancelled) return;
      const [b, l, c] = res;
      setBills(b.status === "fulfilled" ? b.value : []);
      if (l.status === "fulfilled") setLawVersions(l.value);
      if (c.status === "fulfilled") setClients(c.value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = bills === null;
  const b = bills ?? [];

  const isActive = (x: Bill) =>
    x.legislativeMomentum === "active" || x.legislativeMomentum === "advanced";
  const total = b.length;
  const active = b.filter(isActive).length;
  const passed = b.filter(
    (x) =>
      x.legislativeMomentum === "passed" || x.legislativeMomentum === "in_force",
  ).length;
  const royalAssent = b.filter((x) => x.royalAssentDate).length;
  const approved = lawVersions.filter((v) => v.humanApproved).length;
  const pendingDeltas = lawVersions.length - approved;
  const industries = new Set(
    clients.map((c) => c.industry).filter(Boolean),
  ).size;

  // Per-stage headline metric, keyed by workflow step id.
  const metric: Record<string, { value: number; unit: string; sub: string }> = {
    monitor: {
      value: total,
      unit: "bills tracked",
      sub: `${active} active · ${passed} passed`,
    },
    delta: {
      value: lawVersions.length,
      unit: "legal deltas",
      sub: `${approved} approved · ${pendingDeltas} in review`,
    },
    scanner: {
      value: clients.length,
      unit: "clients monitored",
      sub: industries ? `${industries} industries` : "across the book",
    },
    impact: {
      value: approved,
      unit: "approved & ready",
      sub: `to brief ${clients.length} clients`,
    },
  };

  // Momentum breakdown for the portfolio panel.
  const momentumCounts = MOMENTUM_ROWS.map((r) => ({
    ...r,
    count: b.filter((x) => x.legislativeMomentum === r.key).length,
  }));
  const momentumMax = Math.max(1, ...momentumCounts.map((m) => m.count));

  // Top practice areas by bill count.
  const practiceTally = new Map<string, number>();
  for (const bill of b)
    for (const p of bill.practiceAreas ?? [])
      practiceTally.set(p, (practiceTally.get(p) ?? 0) + 1);
  const topPractices = [...practiceTally.entries()]
    .sort((a, c) => c[1] - a[1])
    .slice(0, 5);

  // Bills worth attention first: late-stage, then active.
  const movers = [...b]
    .filter(isActive)
    .sort(
      (x, y) =>
        (x.legislativeMomentum === "advanced" ? 0 : 1) -
        (y.legislativeMomentum === "advanced" ? 0 : 1),
    )
    .slice(0, 6);

  const fmt = (v: number) => (loading ? "—" : String(v));

  return (
    <div className="ov">
      <PageHeader
        title="Workspace overview"
        hint={{
          title: "Workspace overview",
          body: "The command center. Pipeline status at a glance and one click into any stage of the work — from tracking a bill to briefing a client.",
        }}
        sub="Turn federal legislative change into clear, client-specific advice — in four stages."
      />
      <div className="body ov-body">
        <section className="ov-intro">
          <h1 className="ov-intro-title">
            Turn any federal bill into client-ready advice.
          </h1>
          <p className="ov-intro-sub">
            Track all {fmt(total)} federal bills, see exactly what each one
            changes in law, match it to your clients, and produce the
            counsel-approved memo — in the four steps below.
          </p>
          <div className="ov-intro-actions">
            <button className="btn primary" onClick={() => nav.go("monitor")}>
              Browse all bills
              <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
            <span className="ov-intro-metaline">
              45th Parliament · 1st Session · {fmt(royalAssent)} received royal
              assent
            </span>
          </div>
        </section>

        <section className="ov-sec">
          <div className="ov-sec-head">
            <h2>The workflow</h2>
            <InfoHint
              title="The workflow"
              body="Each stage hands its output to the next: a tracked bill becomes a reviewed legal delta, which is scanned against clients, which becomes a counsel-approved brief. Click any stage to open it."
            />
            <span className="ov-sec-note">Click a stage to open it</span>
          </div>

          <div className="ov-pipe">
            {WORKFLOW_STEPS.map((s, i) => {
              const m = metric[s.id];
              return (
                <Fragment key={s.id}>
                  {i > 0 && (
                    <span className="ov-pipe-arrow" aria-hidden="true">
                      <FontAwesomeIcon icon={faArrowRight} />
                    </span>
                  )}
                  <button
                    type="button"
                    className="ov-stage"
                    onClick={() => nav.go(s.id)}
                  >
                    <div className="ov-stage-head">
                      <span className="ov-stage-num">{s.num}</span>
                      <span className="ov-stage-icon">
                        <FontAwesomeIcon icon={s.icon} aria-hidden="true" />
                      </span>
                    </div>
                    <div className="ov-stage-metric">
                      <span className="ov-stage-value tnum">{fmt(m.value)}</span>
                      <span className="ov-stage-unit">{m.unit}</span>
                    </div>
                    <div className="ov-stage-name">{s.label}</div>
                    <div className="ov-stage-purpose">{s.purpose}</div>
                    <div className="ov-stage-foot">
                      <span className="ov-stage-sub tnum">{m.sub}</span>
                      <span className="ov-stage-cta">
                        Open
                        <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                      </span>
                    </div>
                  </button>
                </Fragment>
              );
            })}
          </div>
        </section>

        <div className="ov-cols">
          <section className="ov-panel">
            <div className="ov-sec-head">
              <h2>Bills gaining momentum</h2>
              <InfoHint
                title="Bills gaining momentum"
                body="Late-stage and active bills move fastest and carry the most client risk. Open one to read its full path, then send it to legal-delta review."
              />
              <button
                type="button"
                className="ov-seeall"
                onClick={() => nav.go("monitor")}
              >
                All bills
                <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
              </button>
            </div>
            {loading ? (
              <div className="ov-loading">Loading…</div>
            ) : movers.length === 0 ? (
              <div className="ov-loading">No active bills right now.</div>
            ) : (
              <table className="ov-table">
                <tbody>
                  {movers.map((bill) => (
                    <tr
                      key={bill.id}
                      onClick={() => nav.go("bill", { billId: bill.id })}
                    >
                      <td className="ov-t-bill tnum">{bill.billNumber}</td>
                      <td className="ov-t-title">
                        {bill.shortTitle || bill.title}
                      </td>
                      <td className="ov-t-mom">
                        <MomentumBadge value={bill.legislativeMomentum} />
                      </td>
                      <td className="ov-t-arrow">
                        <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="ov-panel">
            <div className="ov-sec-head">
              <h2>Portfolio</h2>
              <InfoHint
                title="Portfolio"
                body="How the tracked bills break down by legislative momentum and by the BCF practice groups they touch."
              />
            </div>
            <div className="ov-block-label">By momentum</div>
            <div className="ov-bars">
              {momentumCounts.map((m) => (
                <div className="ov-bar-row" key={m.key}>
                  <span className="ov-bar-label">{m.label}</span>
                  <span className="ov-bar-track">
                    <span
                      className={`ov-bar-fill momentum-${m.key}`}
                      style={{ width: `${(m.count / momentumMax) * 100}%` }}
                    />
                  </span>
                  <span className="ov-bar-count tnum">{fmt(m.count)}</span>
                </div>
              ))}
            </div>
            <div className="ov-block-label">Top practice groups</div>
            <div className="ov-prac">
              {topPractices.map(([label, count]) => (
                <button
                  type="button"
                  key={label}
                  className="ov-prac-row"
                  onClick={() => nav.go("monitor")}
                >
                  <span className="ov-prac-name">{label}</span>
                  <span className="ov-prac-count tnum">{count}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
