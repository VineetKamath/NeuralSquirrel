"use client";

import { memo, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import type { DaySummary, HistorySample } from "@/types";

interface Spec {
  key: keyof HistorySample;
  title: string;
  unit: "pct" | "m" | "n";
  max?: number;
}

const SPECS: Spec[] = [
  { key: "foodEfficiency", title: "FOOD EFFICIENCY", unit: "pct", max: 1 },
  { key: "navigationEfficiency", title: "SUCCESSFUL NAVIGATION", unit: "pct", max: 1 },
  { key: "dangerAvoidance", title: "DANGER AVOIDANCE", unit: "pct", max: 1 },
  { key: "memoryStrength", title: "MEMORY STRENGTH", unit: "pct", max: 1 },
  { key: "decisionConfidence", title: "DECISION CONFIDENCE", unit: "pct", max: 1 },
  { key: "restFraction", title: "TIME RESTING", unit: "pct", max: 1 },
  { key: "curiosity", title: "CURIOSITY", unit: "pct", max: 1 },
];

const fmt = (v: number, unit: Spec["unit"]) => (unit === "pct" ? `${Math.round(v * 100)}%` : unit === "m" ? `${v.toFixed(0)} m` : v.toFixed(0));

function TipBox({ active, payload, unit }: { active?: boolean; payload?: { payload: HistorySample; value: number }[]; unit: Spec["unit"] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="mono border border-[var(--color-line-strong)] bg-[#0a0c0d]/95 px-2 py-1 text-[9.5px] text-[var(--color-text)]">
      <div className="text-[var(--color-dim)]">DAY {p.payload.day.toFixed(2)}</div>
      <div className="tabular text-[var(--color-bright)]">{fmt(p.value, unit)}</div>
    </div>
  );
}

const MiniChart = memo(function MiniChart({ spec, data }: { spec: Spec; data: HistorySample[] }) {
  const last = data.length ? Number(data[data.length - 1][spec.key]) : 0;
  const first = data.length ? Number(data[0][spec.key]) : 0;
  const id = `g-${spec.key}`;
  return (
    <div className="flex min-h-0 min-w-0 flex-col border-l border-[var(--color-line)] pl-2">
      <div className="flex items-baseline justify-between gap-1">
        <span className="mono truncate text-[8.5px] tracking-[0.12em] text-[var(--color-dim)]">{spec.title}</span>
        <span className="mono tabular text-[10.5px] text-[var(--color-bright)]">{fmt(last, spec.unit)}</span>
      </div>
      <div className="mono tabular text-[8.5px] text-[var(--color-dim)]">
        from {fmt(first, spec.unit)}
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8fe3c4" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#8fe3c4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" type="number" domain={["dataMin", "dataMax"]} hide />
            <YAxis domain={[0, spec.max ?? "auto"]} hide />
            <Tooltip content={<TipBox unit={spec.unit} />} cursor={{ stroke: "rgba(207,216,212,0.25)", strokeWidth: 1 }} isAnimationActive={false} />
            <Area type="monotone" dataKey={spec.key as string} stroke="#8fe3c4" strokeWidth={1.5} fill={`url(#${id})`} isAnimationActive={false} dot={false} activeDot={{ r: 3, fill: "#8fe3c4", stroke: "#050607", strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

/** a bar of the radius chart: one day, or a run of days once the experiment is too long to draw them all */
type RadiusBar = DaySummary & { from: number };
const MAX_BARS = 160;

function radiusBars(days: DaySummary[], today: number, radiusNow: number | undefined): RadiusBar[] {
  const all: RadiusBar[] = days.map((d) => ({ ...d, from: d.day }));
  if (radiusNow !== undefined) all.push({ day: today, from: today, explorationRadius: radiusNow, foodEfficiency: 0, navigationEfficiency: 0, dangerAvoidance: 0, memoryAccuracy: 0, foodEaten: 0, distance: 0, restFraction: 0 });
  if (all.length <= MAX_BARS) return all;
  // the stored history keeps every day; only the drawing is binned (widest range, total food and distance per bin)
  const k = Math.ceil(all.length / MAX_BARS);
  const out: RadiusBar[] = [];
  for (let i = 0; i < all.length; i += k) {
    const run = all.slice(i, i + k);
    const last = run[run.length - 1];
    out.push({
      ...last,
      from: run[0].from,
      explorationRadius: Math.max(...run.map((d) => d.explorationRadius)),
      foodEaten: run.reduce((n, d) => n + d.foodEaten, 0),
      distance: run.reduce((n, d) => n + d.distance, 0),
    });
  }
  return out;
}

function RadiusTip({ active, payload }: { active?: boolean; payload?: { payload: RadiusBar }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const span = d.from !== d.day;
  return (
    <div className="mono border border-[var(--color-line-strong)] bg-[#0a0c0d]/95 px-2 py-1 text-[9.5px]">
      <div className="text-[var(--color-dim)]">{span ? `DAYS ${d.from}–${d.day}` : `DAY ${d.day}`}</div>
      <div className="tabular text-[var(--color-bright)]">{d.explorationRadius.toFixed(0)} m {span ? "widest radius" : "radius"}</div>
      <div className="tabular text-[var(--color-mid)]">{d.foodEaten} food · {d.distance.toFixed(0)} m travelled</div>
    </div>
  );
}

export function EvolutionCharts() {
  const history = useLab((s) => s.history);
  const days = useLab((s) => s.days);
  // only the day number, not the whole live snapshot: this panel redraws when its data changes
  const today = useLab((s) => s.snap?.day ?? 0);
  const radiusNow = history.length ? history[history.length - 1].explorationRadius : undefined;
  const radiusData = useMemo(() => radiusBars(days, today, radiusNow), [days, today, radiusNow]);
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader index="06" title="BEHAVIOR EVOLUTION" meta={`${history.length} HOURLY SAMPLES · ${days.length} DAYS CLOSED`} />
      {history.length < 2 ? (
        <div className="mono flex flex-1 items-center justify-center text-[10px] tracking-[0.16em] text-[var(--color-dim)]">
          COLLECTING OBSERVATIONS<span className="blink">_</span>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-2 gap-y-2 px-3 pb-2 sm:grid-cols-4">
          <div className="flex min-h-0 min-w-0 flex-col pl-0">
            <div className="flex items-baseline justify-between">
              <span className="mono text-[8.5px] tracking-[0.12em] text-[var(--color-dim)]">EXPLORATION RADIUS / DAY</span>
            </div>
            <div className="mono tabular text-[8.5px] text-[var(--color-dim)]">max distance from nest</div>
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={radiusData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
                  <XAxis dataKey="day" tick={{ fill: "#5b6663", fontSize: 8, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={{ stroke: "rgba(190,210,205,0.12)" }} height={12} interval="preserveStartEnd" />
                  <YAxis hide domain={[0, "auto"]} />
                  <Tooltip content={<RadiusTip />} cursor={{ fill: "rgba(207,216,212,0.05)" }} isAnimationActive={false} />
                  <Bar maxBarSize={14} dataKey="explorationRadius" fill="rgba(143,227,196,0.55)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {SPECS.map((s) => (
            <MiniChart key={s.key} spec={s} data={history} />
          ))}
        </div>
      )}
    </section>
  );
}
