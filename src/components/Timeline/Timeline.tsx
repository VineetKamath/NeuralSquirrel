"use client";

import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import { clockString, simClock, pad } from "@/utils/format";

const CAT_COLOR: Record<string, string> = {
  discovery: "#e8b36a",
  memory: "#8fe3c4",
  danger: "#ff5f4f",
  learning: "#b69cf2",
  behavior: "#cfd8d4",
  environment: "#5b6663",
  reward: "#7fb7e8",
  neural: "#78f0c8",
  social: "#e07ab0",
};

export function Timeline() {
  const events = useLab((s) => s.events);
  const viewMemory = useLab((s) => s.viewMemory);
  const list = events.slice().reverse();
  const majors = useLab((s) => s.snap?.milestones ?? 0);
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader index="05" title="BEHAVIOR TIMELINE" meta={`${events.length} EVENTS · ${majors} MILESTONES`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {list.map((e, i) => {
          const c = simClock(e.time);
          return (
            <div
              key={e.id}
              className={`mono grid grid-cols-[34px_58px_8px_1fr] items-start gap-2 py-[2px] text-[10px] leading-[1.45] ${i === 0 ? "text-[var(--color-bright)]" : ""}`}
              style={{ opacity: Math.max(0.45, 1 - i * 0.015) }}
            >
              <span className="tabular text-[var(--color-dim)]">D{pad(c.day)}</span>
              <span className="tabular text-[var(--color-mid)]">{clockString(e.time)}</span>
              <span className="mt-[6px] h-[4px] w-[4px]" style={{ background: CAT_COLOR[e.category] ?? "#5b6663" }} />
              <span className={`min-w-0 ${e.major ? "text-[var(--color-bright)]" : "text-[var(--color-text)]"}`}>
                {e.major && <span className="mr-1.5 text-[var(--color-signal)]">◆ {e.title}</span>}
                <span className={e.major ? "text-[var(--color-mid)]" : ""}>{e.text}</span>
                {e.location && (
                  <button
                    className="ml-2 text-[9px] tracking-[0.1em] text-[var(--color-dim)] hover:text-[var(--color-signal)]"
                    title="Replay this moment on the map"
                    onClick={() => useLab.setState({ mode: "ecology", cinematic: false, replay: { time: e.time, x: e.location!.x, z: e.location!.z, label: e.title ?? e.text } })}
                  >
                    [▶ REPLAY]
                  </button>
                )}
                {e.memoryId && (
                  <button className="ml-2 text-[9px] tracking-[0.1em] text-[var(--color-dim)] hover:text-[var(--color-signal)]" onClick={() => viewMemory(e.memoryId!)}>
                    [{e.memoryId}]
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
