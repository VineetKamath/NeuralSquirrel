"use client";

import { useLab } from "@/store/labStore";
import { PanelHeader } from "./PanelHeader";

const DRIVE_COLORS: Record<string, string> = {
  HUNGER: "#e8966a",
  THIRST: "#7fb7e8",
  ENERGY: "#8fe3c4",
  CURIOSITY: "#b69cf2",
  FEAR: "#ff5f4f",
  SAFETY: "#cfd8d4",
  CONFIDENCE: "#e8b36a",
};

export function DriveBar({ label, value, color, compact = false }: { label: string; value: number; color: string; compact?: boolean }) {
  const pctv = Math.round(value * 100);
  return (
    <div className={`grid grid-cols-[76px_1fr_34px] items-center gap-2 ${compact ? "h-[15px]" : "h-[17px]"}`}>
      <span className="mono text-[9.5px] tracking-[0.12em] text-[var(--color-mid)]">{label}</span>
      <div className="relative h-[4px] rounded-full bg-[rgba(190,210,205,0.06)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
          style={{ width: `${pctv}%`, background: `linear-gradient(90deg, ${color}33, ${color})`, boxShadow: `0 0 8px ${color}66` }}
        />
        {[25, 50, 75].map((t) => (
          <div key={t} className="absolute -top-[2px] h-[7px] w-px bg-[rgba(190,210,205,0.12)]" style={{ left: `${t}%` }} />
        ))}
      </div>
      <span className="mono tabular text-right text-[10.5px] text-[var(--color-bright)]">{pctv}%</span>
    </div>
  );
}

export function StatePanel() {
  const snap = useLab((s) => s.snap);
  if (!snap) return <section className="panel" />;
  const drives: [string, number][] = [
    ["HUNGER", snap.hunger],
    ["THIRST", snap.thirst],
    ["ENERGY", snap.energy],
    ["CURIOSITY", snap.curiosity],
    ["FEAR", snap.fear],
    ["SAFETY", snap.safety],
    ["CONFIDENCE", snap.confidence],
  ];
  const maxU = Math.max(0.01, ...snap.candidates.map((c) => Math.abs(c.total)));
  const urgent = snap.goalType === "FLEE" || snap.goalType === "HIDE";
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader index="02" title="CURRENT STATE" meta="MOTIVATION" right={snap.threatNear ? <span className="mono blink text-[9px] tracking-[0.16em] text-[var(--color-alert)]">THREAT · {snap.threatLabel}</span> : null} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-2">
        <div className="flex flex-col">
          {drives.map(([l, v]) => (
            <DriveBar key={l} label={l} value={v} color={DRIVE_COLORS[l]} compact />
          ))}
        </div>
        <div className="border-t border-[var(--color-line)] pt-1.5">
          <div className="label mb-0.5">CURRENT GOAL</div>
          <div className={`mono truncate text-[11.5px] tracking-[0.08em] ${urgent ? "text-[var(--color-alert)]" : "text-[var(--color-bright)]"}`}>
            {snap.goalType ?? "—"}
          </div>
          <div className="mono flex gap-3 truncate text-[9.5px] tracking-[0.08em] text-[var(--color-dim)]">
            <span className="truncate">{snap.goalLabel}</span>
            {snap.goalPhase && <span className="text-[var(--color-mid)]">{snap.goalPhase.toUpperCase()}</span>}
            {snap.goalTarget && <span className="tabular ml-auto text-[var(--color-mid)]">{snap.goalDistance.toFixed(1)} m</span>}
          </div>
        </div>
        <div className="min-h-0 border-t border-[var(--color-line)] pt-1.5">
          <div className="label mb-1 flex justify-between">
            <span>ACTION UTILITIES</span>
            <span>U + Q</span>
          </div>
          {snap.candidates.slice(0, 5).map((c, i) => (
            <div key={c.type + i} className="grid h-[14px] grid-cols-[112px_1fr_38px] items-center gap-2">
              <span className={`mono truncate text-[9px] tracking-[0.06em] ${i === 0 ? "text-[var(--color-text)]" : "text-[var(--color-dim)]"}`}>{c.type}</span>
              <div className="relative h-[2px] bg-[rgba(190,210,205,0.05)]">
                <div
                  className="absolute inset-y-0 left-0"
                  style={{ width: `${Math.max(0, (c.total / maxU) * 100)}%`, background: i === 0 ? "var(--color-signal)" : "rgba(190,210,205,0.35)" }}
                />
              </div>
              <span className="mono tabular text-right text-[9.5px] text-[var(--color-mid)]">{c.total.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
