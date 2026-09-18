"use client";

import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import type { HistorySample } from "@/types";

function Spark({ data, k, color }: { data: HistorySample[]; k: keyof HistorySample; color: string }) {
  const pts = data.slice(-80);
  if (pts.length < 2) return <svg className="h-[18px] w-full" />;
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (pts.length - 1)) * 100).toFixed(2)},${(18 - Math.min(1, Number(p[k])) * 16 - 1).toFixed(2)}`)
    .join(" ");
  return (
    <svg className="h-[18px] w-full" viewBox="0 0 100 18" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function level(v: number) {
  return v > 0.66 ? "HIGH" : v > 0.38 ? "MODERATE" : "LOW";
}

export function LearningPanel() {
  const snap = useLab((s) => s.snap);
  const history = useLab((s) => s.history);
  const profile = useLab((s) => s.profile);
  if (!snap) return <section className="panel" />;
  const first = history[0];
  const metrics: { label: string; key: keyof HistorySample; value: number; color: string }[] = [
    { label: "FOOD DISCOVERY", key: "foodEfficiency", value: snap.metrics.foodEfficiency, color: "#e8b36a" },
    { label: "NAVIGATION", key: "navigationEfficiency", value: snap.metrics.navigationEfficiency, color: "#7fb7e8" },
    { label: "DANGER AVOIDANCE", key: "dangerAvoidance", value: snap.metrics.dangerAvoidance, color: "#ff8a70" },
    { label: "MEMORY ACCURACY", key: "memoryAccuracy", value: snap.metrics.memoryAccuracy, color: "#8fe3c4" },
  ];
  const traits: [string, number][] = profile
    ? [
        ["EXPLORATION", profile.exploration],
        ["RISK", profile.risk],
        ["FOOD PRIORITY", profile.foodPriority],
        ["MEMORY", profile.memory],
        ["VIGILANCE", profile.vigilance],
        ["HOARDING", profile.hoarding],
      ]
    : [];
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader index="04" title="LEARNING" meta={`DAY ${String(snap.day).padStart(2, "0")} · Q-STATES ${snap.qStates}`} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3">
        {metrics.map((m) => {
          const start = first ? Number(first[m.key]) : m.value;
          const delta = m.value - start;
          return (
            <div key={m.label} className="min-w-0">
              <div className="label truncate !text-[8.5px]">{m.label}</div>
              <div className="flex items-baseline gap-1.5">
                <span className="mono tabular text-[17px] leading-[1.2] text-[var(--color-bright)]">{Math.round(m.value * 100)}%</span>
                <span className={`mono tabular text-[9px] ${delta >= 0 ? "text-[var(--color-signal)]" : "text-[var(--color-alert)]"}`}>
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta * 100))}
                </span>
              </div>
              <Spark data={history} k={m.key} color={m.color} />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 min-h-0 flex-1 overflow-hidden border-t border-[var(--color-line)] px-3 pt-1.5">
        <div className="label mb-1 flex justify-between">
          <span>BEHAVIORAL PROFILE</span>
          <span className="!text-[8px]">EMERGENT · NOT A VALIDATED TRAIT MODEL</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          {traits.map(([l, v]) => (
            <div key={l} className="mono flex h-[14px] items-center justify-between text-[9.5px] tracking-[0.08em]">
              <span className="text-[var(--color-dim)]">{l}</span>
              <span className={v > 0.66 ? "text-[var(--color-bright)]" : v > 0.38 ? "text-[var(--color-mid)]" : "text-[var(--color-dim)]"}>{level(v)}</span>
            </div>
          ))}
        </div>
        {profile && <div className="mono mt-1 truncate text-[9px] tracking-[0.06em] text-[var(--color-mid)]">› {profile.summary.join(" · ")}</div>}
      </div>
    </section>
  );
}
