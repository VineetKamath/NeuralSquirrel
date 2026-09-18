"use client";

import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import { DAY_LENGTH } from "@/simulation/constants";

export const MEMORY_COLORS: Record<string, string> = {
  food: "#e8b36a",
  danger: "#ff5f4f",
  landmark: "#cfd8d4",
  environment: "#7fb7e8",
  navigation: "#8fe3c4",
  social: "#b69cf2",
};

function age(t: number) {
  if (t < 60) return `${Math.round(t)}s`;
  if (t < DAY_LENGTH) return `${Math.round(t / 20)}h`;
  return `${(t / DAY_LENGTH).toFixed(1)}d`;
}

export function MemoryPanel() {
  const snap = useLab((s) => s.snap);
  const viewMemory = useLab((s) => s.viewMemory);
  const focusId = useLab((s) => s.focusMemoryId);
  if (!snap) return <section className="panel" />;
  const mems = snap.memories;
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader
        index="03"
        title="MEMORY"
        meta={`${snap.memoryCount} TRACES · ${snap.knownLocations} LOCATIONS`}
        right={
          <button className="btn !px-1.5 !py-[3px] !text-[9px]" onClick={() => useLab.getState().toggle("mapOpen")}>
            MAP
          </button>
        }
      />
      <div className="mono grid grid-cols-[1fr_58px_26px_30px] gap-2 px-3 pb-1 text-[8.5px] tracking-[0.14em] text-[var(--color-dim)]">
        <span>TRACE</span>
        <span>STRENGTH</span>
        <span className="text-right">RC</span>
        <span className="text-right">AGE</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {mems.length === 0 && <div className="mono pt-4 text-center text-[10px] tracking-[0.14em] text-[var(--color-dim)]">NO MEMORIES ENCODED</div>}
        {mems.map((m) => {
          const strength = Math.min(1, m.importance * (0.4 + m.confidence));
          const color = MEMORY_COLORS[m.subtype === "water" ? "environment" : m.type];
          return (
            <button
              key={m.id}
              onClick={() => viewMemory(m.id)}
              className={`grid h-[19px] w-full grid-cols-[1fr_58px_26px_30px] items-center gap-2 text-left hover:bg-[rgba(255,255,255,0.025)] ${focusId === m.id ? "bg-[rgba(143,227,196,0.06)]" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: color, opacity: 0.35 + strength * 0.65, boxShadow: `0 0 ${4 + strength * 6}px ${color}` }} />
                <span className="mono truncate text-[10px] tracking-[0.04em] text-[var(--color-text)]" style={{ opacity: 0.5 + strength * 0.5 }}>
                  {m.label}
                </span>
                {m.subtype === "toxic" && <span className="mono text-[8px] text-[var(--color-alert)]">✕</span>}
              </span>
              <span className="relative h-[3px] bg-[rgba(190,210,205,0.07)]">
                <span className="absolute inset-y-0 left-0" style={{ width: `${strength * 100}%`, background: color }} />
              </span>
              <span className="mono tabular text-right text-[9.5px] text-[var(--color-mid)]">{m.recallCount}</span>
              <span className="mono tabular text-right text-[9.5px] text-[var(--color-dim)]">{age(snap.time - m.timestamp)}</span>
            </button>
          );
        })}
      </div>
      {snap.preferences.length > 0 && (
        <div className="border-t border-[var(--color-line)] px-3 py-1.5">
          <div className="label mb-0.5">PREFERENCES</div>
          <div className="mono flex flex-wrap gap-x-3 text-[9.5px] text-[var(--color-amber)]">
            {snap.preferences.map((p) => (
              <span key={p.id}>
                ◆ {p.label} <span className="text-[var(--color-dim)]">{Math.round(p.strength * 100)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
