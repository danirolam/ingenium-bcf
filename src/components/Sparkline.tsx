import { Area, AreaChart, ResponsiveContainer } from "recharts";

type Tone = "accent" | "ok" | "high" | "crit";

const TONE_STROKE: Record<Tone, string> = {
  accent: "#0a0a0a",
  ok: "#2a7044",
  high: "#b8861a",
  crit: "#b54a2a",
};

const TONE_FILL: Record<Tone, string> = {
  accent: "#0a0a0a",
  ok: "#2a7044",
  high: "#b8861a",
  crit: "#b54a2a",
};

export function Sparkline({
  values,
  tone = "accent",
}: {
  values: number[];
  tone?: Tone;
}) {
  const data = values.map((v, i) => ({ i, v }));
  const stroke = TONE_STROKE[tone];
  const fill = TONE_FILL[tone];
  const gradientId = `spark-grad-${tone}`;

  return (
    <span className="spark" aria-hidden="true">
      <ResponsiveContainer width={60} height={18}>
        <AreaChart
          data={data}
          margin={{ top: 1, right: 0, bottom: 1, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fill} stopOpacity={0.35} />
              <stop offset="100%" stopColor={fill} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </span>
  );
}
