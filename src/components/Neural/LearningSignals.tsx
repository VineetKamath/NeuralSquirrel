"use client";

import { useEffect, useRef } from "react";
import { useLab } from "@/store/labStore";
import { getExperiment } from "@/store/runtime";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import { clockString, dayString } from "@/utils/format";

/**
 * Where a decision comes from: each candidate action's total split into its sources —
 * hand-free drive/utility, learned Q value and the spiking striatum's vote — plus the dopamine
 * (TD error) trace that trains the network and the log of offline replays during sleep.
 */
export function DecisionSources({ index = "N5" }: { index?: string }) {
  const cands = useLab((s) => s.snap?.candidates ?? []);
  const weight = useLab((s) => s.snap?.neural.neuralWeight ?? 0);
  const max = Math.max(0.2, ...cands.map((c) => Math.abs(c.utility) + Math.abs(c.q) + Math.abs(c.neural)));
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader index={index} title="DECISION SOURCES" meta="UTILITY · Q · SPIKING VOTE" right={<span className="mono tabular text-[9px] text-[var(--color-mid)]">κ {weight.toFixed(2)}</span>} />
      <div className="flex min-h-0 flex-1 flex-col gap-[5px] overflow-y-auto px-3 pb-2">
        {cands.slice(0, 7).map((c, i) => {
          const parts = [
            { v: c.utility, col: "#cfd8d4" },
            { v: c.q, col: "#e8b36a" },
            { v: c.neural, col: "#8fe3c4" },
          ];
          return (
            <div key={c.label + i}>
              <div className="flex items-baseline justify-between">
                <span className={`mono truncate text-[9.5px] tracking-[0.06em] ${i === 0 ? "text-[var(--color-bright)]" : "text-[var(--color-mid)]"}`}>{c.label}</span>
                <span className="mono tabular text-[9.5px] text-[var(--color-text)]">{c.total.toFixed(2)}</span>
              </div>
              <div className="relative mt-[2px] flex h-[5px] bg-[rgba(190,210,205,0.04)]">
                {parts.map((p, k) =>
                  p.v > 0 ? <div key={k} style={{ width: `${(p.v / max) * 100}%`, background: p.col, opacity: i === 0 ? 0.95 : 0.55 }} /> : null
                )}
              </div>
              {parts.some((p) => p.v < 0) && (
                <div className="relative flex h-[3px] justify-end">
                  {parts.map((p, k) =>
                    p.v < 0 ? <div key={k} style={{ width: `${(-p.v / max) * 100}%`, background: "#ff5f4f", opacity: 0.5 }} /> : null
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="mono mt-auto flex gap-3 pt-1 text-[8.5px] tracking-[0.1em] text-[var(--color-dim)]">
          <span>
            <span className="text-[#cfd8d4]">■</span> DRIVE + TARGET
          </span>
          <span>
            <span className="text-[#e8b36a]">■</span> Q-LEARNING
          </span>
          <span>
            <span className="text-[#8fe3c4]">■</span> STRIATAL SPIKES
          </span>
        </div>
      </div>
    </section>
  );
}

export function DopaminePanel({ index = "N6" }: { index?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snap = useLab((s) => s.snap?.neural);
  const history = useRef<{ d: number; v: number; da: number }[]>([]);

  useEffect(() => {
    if (!snap) return;
    history.current.push({ d: snap.delta, v: snap.value, da: snap.dopamine });
    if (history.current.length > 240) history.current.shift();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(r.width * dpr);
    canvas.height = Math.floor(r.height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width;
    const h = r.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(190,210,205,0.1)";
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    const hist = history.current;
    const line = (key: "d" | "v" | "da", col: string, gain: number) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      hist.forEach((p, i) => {
        const x = (i / 239) * w;
        const y = h / 2 - Math.max(-1, Math.min(1, p[key] * gain)) * (h / 2 - 4);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    line("v", "rgba(232,179,106,0.7)", 1.5);
    line("da", "rgba(143,227,196,0.9)", 1);
    line("d", "#ff9c8c", 3);
  }, [snap]);

  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader
        index={index}
        title="DOPAMINE · TD ERROR"
        meta="ACTOR-CRITIC"
        right={
          snap ? (
            <span className="mono tabular text-[9px] text-[var(--color-mid)]">
              δ {snap.delta >= 0 ? "+" : "−"}
              {Math.abs(snap.delta).toFixed(3)} · V {snap.value.toFixed(2)}
            </span>
          ) : null
        }
      />
      <div className="relative min-h-0 flex-1 px-3">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
      <div className="mono flex gap-3 px-3 pb-1.5 text-[8.5px] tracking-[0.1em] text-[var(--color-dim)]">
        <span>
          <span className="text-[#ff9c8c]">—</span> δ PREDICTION ERROR
        </span>
        <span>
          <span className="text-[#8fe3c4]">—</span> VTA DOPAMINE
        </span>
        <span>
          <span className="text-[#e8b36a]">—</span> CRITIC VALUE
        </span>
      </div>
    </section>
  );
}

export function ReplayLog({ index = "N7" }: { index?: string }) {
  useLab((s) => s.snap?.neural.replays);
  const replays = getExperiment().ctx.neural.replays.slice(-40).reverse();
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader index={index} title="SLEEP REPLAY" meta="HIPPOCAMPAL SHARP-WAVE RIPPLES" right={<span className="mono tabular text-[9px] text-[var(--color-mid)]">{replays.length ? `${getExperiment().ctx.neural.replays.length} TOTAL` : "NONE YET"}</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {replays.length === 0 && (
          <div className="mono py-4 text-center text-[9.5px] tracking-[0.12em] text-[var(--color-dim)]">
            REWARDED ROUTES ARE REPLAYED IN REVERSE DURING SLEEP
          </div>
        )}
        {replays.map((r, i) => (
          <div key={i} className="grid grid-cols-[92px_1fr_60px] items-center gap-2 border-b border-[var(--color-line)] py-[3px]">
            <span className="mono tabular text-[9px] text-[var(--color-dim)]">
              {dayString(r.time).replace("DAY ", "D")} {clockString(r.time, false)}
            </span>
            <ReplayPath path={r.path} />
            <span className="mono tabular text-right text-[9px] text-[var(--color-text)]">
              {r.length} steps
              <br />
              <span className={r.meanDelta >= 0 ? "text-[var(--color-signal)]" : "text-[var(--color-alert)]"}>δ {r.meanDelta.toFixed(3)}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReplayPath({ path }: { path: { x: number; z: number }[] }) {
  if (path.length < 2) return <div />;
  const xs = path.map((p) => p.x);
  const zs = path.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const span = Math.max(4, maxX - minX, maxZ - minZ);
  const pts = path.map((p) => `${((p.x - minX) / span) * 90 + 5},${((p.z - minZ) / span) * 20 + 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" className="h-[24px] w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="#b69cf2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <circle cx={((path[0].x - minX) / span) * 90 + 5} cy={((path[0].z - minZ) / span) * 20 + 2} r="1.5" fill="#8fe3c4" />
    </svg>
  );
}
