import { useMemo } from "react";
import type { Bill } from "../types";

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
      <div className="bm-cell">
        <div className="stat-l">Tracked</div>
        <div className="stat-v tnum">{stats.total}</div>
      </div>

      <div className="bm-cell">
        <div className="stat-l">Active</div>
        <div className="stat-v tnum">{stats.activeLate}</div>
      </div>

      <div className="bm-cell">
        <div className="stat-l">Royal assent</div>
        <div className="stat-v tnum">{stats.highImpact}</div>
      </div>

      <div className="bm-cell">
        <div className="stat-l">Last ingest</div>
        <div className="stat-v tnum">
          {stats.recencyDays === null ? "—" : `${stats.recencyDays}d`}
        </div>
      </div>
    </div>
  );
}
