import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { Bill } from "../types";

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = Date.now() - t;
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function syntheticSeries(seed: number, n = 12): { i: number; v: number }[] {
  const data: { i: number; v: number }[] = [];
  let x = (seed % 97) + 13;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const v = 6 + ((x >> 8) % 18) + i * 0.6;
    data.push({ i, v });
  }
  return data;
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

  const series = useMemo(
    () => syntheticSeries(bills.length || 1, 12),
    [bills.length],
  );

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

      <div className="bm-cell bm-cell-spark">
        <div className="bm-cell-head">
          <div>
            <div className="stat-l">Last ingest</div>
            <div className="stat-v tnum">
              {stats.recencyDays === null ? "—" : `${stats.recencyDays}d`}
            </div>
          </div>
          <div className="bm-spark" aria-hidden="true">
            <ResponsiveContainer width="100%" height={40}>
              <AreaChart
                data={series}
                margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
              >
                <defs>
                  <linearGradient
                    id="bm-ribbon-grad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="#d4a017"
                      stopOpacity={0.45}
                    />
                    <stop
                      offset="100%"
                      stopColor="#d4a017"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="#d4a017"
                  strokeWidth={1.25}
                  fill="url(#bm-ribbon-grad)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
