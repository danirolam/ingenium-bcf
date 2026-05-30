import { useMemo } from "react";
import type { Bill } from "../types";
import { Tooltip } from "./Tooltip";

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = Date.now() - t;
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function StatsRibbon({ bills }: { bills: Bill[] }) {
  const stats = useMemo(() => {
    const total = bills.length;
    const activeLate = bills.filter(
      (b) =>
        b.legislativeMomentum === "active" ||
        b.legislativeMomentum === "advanced",
    ).length;
    const highImpact = bills.filter(
      (b) =>
        b.legislativeMomentum === "passed" ||
        b.legislativeMomentum === "in_force",
    ).length;

    let mostRecentMs = 0;
    for (const b of bills) {
      const t = Date.parse(b.uploadedAt);
      if (!Number.isNaN(t) && t > mostRecentMs) mostRecentMs = t;
    }
    const recencyDays =
      mostRecentMs > 0
        ? daysSince(new Date(mostRecentMs).toISOString())
        : null;

    return { total, activeLate, highImpact, recencyDays };
  }, [bills]);

  return (
    <div className="bm-ribbon">
      <Tooltip
        className="bm-cell"
        title="Bills in view"
        body="Every bill matching the current session and the filters above."
        placement="bottom"
      >
        <div className="stat-l">Tracked</div>
        <div className="stat-v tnum">{stats.total.toLocaleString("en-US")}</div>
      </Tooltip>

      <Tooltip
        className="bm-cell"
        title="Active"
        body="Bills currently moving through readings or committee study."
        placement="bottom"
      >
        <div className="stat-l">Active</div>
        <div className="stat-v tnum">{stats.activeLate.toLocaleString("en-US")}</div>
      </Tooltip>

      <Tooltip
        className="bm-cell"
        title="Royal assent"
        body="Bills that have received royal assent — now in force as law."
        placement="bottom"
      >
        <div className="stat-l">Royal assent</div>
        <div className="stat-v tnum">{stats.highImpact.toLocaleString("en-US")}</div>
      </Tooltip>

      <Tooltip
        className="bm-cell"
        title="Last ingest"
        body="Days since the most recent bill record was fetched from Parliament's LEGISinfo."
        placement="bottom"
      >
        <div className="stat-l">Last ingest</div>
        <div className="stat-v tnum">
          {stats.recencyDays === null ? "—" : `${stats.recencyDays}d`}
        </div>
      </Tooltip>
    </div>
  );
}
