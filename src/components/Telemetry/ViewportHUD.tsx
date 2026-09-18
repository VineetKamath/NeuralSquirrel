"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLab } from "@/store/labStore";
import { frameStats } from "@/store/runtime";
import { clockString, dayString, pad, subjectTitle } from "@/utils/format";
import { cinematicState } from "@/components/World/cinematicState";
import { MapView } from "@/components/Map/MapView";

function Corners() {
  const c = "absolute h-4 w-4 border-[rgba(207,216,212,0.35)]";
  return (
    <>
      <div className={`${c} left-3 top-3 border-l border-t`} />
      <div className={`${c} right-3 top-3 border-r border-t`} />
      <div className={`${c} bottom-3 left-3 border-b border-l`} />
      <div className={`${c} bottom-3 right-3 border-b border-r`} />
    </>
  );
}

function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((v) => v + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function RecIndicator() {
  const recording = useLab((s) => s.recording);
  const start = useLab((s) => s.recordStart);
  useTicker(500);
  if (!recording) return null;
  const secs = Math.floor((performance.now() - start) / 1000);
  return (
    <div className="mono flex items-center gap-2 text-[11px] tracking-[0.2em] text-[var(--color-bright)]">
      <span className="blink h-2 w-2 rounded-full bg-[var(--color-alert)]" />
      REC <span className="tabular">{pad(Math.floor(secs / 60))}:{pad(secs % 60)}</span>
    </div>
  );
}

function ThoughtStream({ max = 6 }: { max?: number }) {
  const thoughts = useLab((s) => s.thoughts);
  const list = thoughts.slice(-max);
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="label !text-[8.5px] !text-[var(--color-mid)]">INTERNAL STATE</div>
      <AnimatePresence initial={false}>
        {list.map((t, i) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 0.35 + ((i + 1) / list.length) * 0.65, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className={`mono text-[10.5px] tracking-[0.03em] ${
              t.level === "alert" ? "text-[#ff8a7a]" : t.level === "memory" ? "text-[#f0c68a]" : t.level === "decision" ? "text-[#a8ecd2]" : "text-[var(--color-text)]"
            }`}
            style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
          >
            <span className="tabular mr-2 text-[var(--color-dim)]">{clockString(t.time)}</span>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function RewardFeed() {
  const rewards = useLab((s) => s.rewards);
  const list = rewards.slice(-6).reverse();
  return (
    <div className="flex flex-col items-end gap-[3px]">
      <div className="label !text-[8.5px] !text-[var(--color-mid)]">REWARD SIGNALS</div>
      {list.map((r, i) => (
        <motion.div
          key={r.id}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: Math.max(0.3, 1 - i * 0.15), y: 0 }}
          className="mono flex gap-3 text-[10.5px]"
          style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
        >
          <span className={`tabular ${r.value >= 0 ? "text-[var(--color-signal)]" : "text-[var(--color-alert)]"}`}>
            {r.value >= 0 ? "+" : "−"}
            {Math.abs(r.value).toFixed(2)}
          </span>
          <span className="w-[170px] truncate text-right tracking-[0.1em] text-[var(--color-text)]">{r.label}</span>
        </motion.div>
      ))}
    </div>
  );
}

export function ViewportHUD({ compact = false }: { compact?: boolean }) {
  const snap = useLab((s) => s.snap);
  const cinematic = useLab((s) => s.cinematic);
  const n = useLab((s) => s.experimentNumber);
  const events = useLab((s) => s.events);
  const running = useLab((s) => s.running);
  const speed = useLab((s) => s.speed);
  useTicker(1000);
  if (!snap) return null;
  const lastMajor = [...events].reverse().find((e) => e.major && snap.time - e.time < 40);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* vignette and grain */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)" }} />
      <div
        className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />

      <AnimatePresence>
        {cinematic && (
          <>
            <motion.div key="lb-top" className="absolute inset-x-0 top-0 bg-black" initial={{ height: 0 }} animate={{ height: "7%" }} exit={{ height: 0 }} transition={{ duration: 0.8 }} />
            <motion.div key="lb-bot" className="absolute inset-x-0 bottom-0 bg-black" initial={{ height: 0 }} animate={{ height: "7%" }} exit={{ height: 0 }} transition={{ duration: 0.8 }} />
          </>
        )}
      </AnimatePresence>

      <Corners />

      {cinematic ? (
        <>
          <div className="absolute left-7 top-[calc(7%+14px)]">
            <div className="mono text-[14px] tracking-[0.36em] text-[var(--color-bright)]">{subjectTitle(snap.generation)}</div>
            <div className="mono mt-0.5 text-[10px] tracking-[0.28em] text-[var(--color-mid)]">SQUIRREL LAB · EXPERIMENT {pad(n)}</div>
            <div className="mono tabular mt-3 text-[10px] tracking-[0.2em] text-[var(--color-text)]">{dayString(snap.time)}</div>
          </div>
          <div className="absolute right-7 top-[calc(7%+14px)] flex flex-col items-end gap-1">
            <RecIndicator />
            <div className="mono text-[9px] tracking-[0.24em] text-[var(--color-dim)]">CAM · {cinematicState.shot}</div>
          </div>
          <div className="absolute bottom-[calc(7%+16px)] left-7 max-w-[46%]">
            <AnimatePresence mode="wait">
              {lastMajor ? (
                <motion.div key={lastMajor.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
                  <div className="mono text-[12px] tracking-[0.3em] text-[var(--color-signal)]">{lastMajor.title}</div>
                  <div className="mono mt-1 text-[10px] tracking-[0.08em] text-[var(--color-text)]">{lastMajor.text}</div>
                </motion.div>
              ) : (
                <motion.div key="goal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="mono text-[10px] tracking-[0.26em] text-[var(--color-mid)]">{snap.goalType ?? "ORIENTING"}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="absolute bottom-[calc(7%+16px)] right-7 text-right">
            <div className="mono tabular text-[9.5px] tracking-[0.16em] text-[var(--color-dim)]">
              MEM {snap.memoryCount} · SYN {snap.synapses.toLocaleString()} · FEAR {Math.round(snap.fear * 100)}%
            </div>
          </div>
        </>
      ) : compact ? (
        <div className="absolute left-4 top-3">
          <div className="mono text-[8.5px] tracking-[0.2em] text-[var(--color-mid)]">
            <span className="text-[var(--color-signal)]">{subjectTitle(snap.generation)}</span> · LIVE FEED · {snap.dateLabel}
          </div>
          <div className={`mono mt-0.5 text-[11px] tracking-[0.14em] ${snap.goalType === "FLEE" || snap.goalType === "HIDE" ? "text-[var(--color-alert)]" : "text-[var(--color-bright)]"}`} style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
            {snap.goalLabel}
          </div>
          <RecIndicator />
        </div>
      ) : (
        <>
          <div className="absolute left-6 top-5">
            <div className="mono text-[12px] tracking-[0.3em] text-[var(--color-signal)]" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
              {subjectTitle(snap.generation)}
            </div>
            <div className="mono mt-0.5 text-[9px] tracking-[0.22em] text-[var(--color-mid)]">SUBJECT S-{pad(n)} · GEN {snap.generation} · SCIURUS CAROLINENSIS · {snap.fur.toUpperCase()}</div>
            <div className={`mono mt-1 text-[13px] tracking-[0.16em] ${snap.goalType === "FLEE" || snap.goalType === "HIDE" ? "text-[var(--color-alert)]" : "text-[var(--color-bright)]"}`} style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
              {snap.goalLabel}
            </div>
            {snap.threatNear && <div className="mono blink mt-1 text-[10px] tracking-[0.2em] text-[var(--color-alert)]">▲ THREAT {snap.threatLabel}</div>}
            {!running && <div className="mono mt-1 text-[10px] tracking-[0.24em] text-[var(--color-amber)]">Ⅱ OBSERVATION PAUSED</div>}
            {snap.daylight < 0.2 && (
              <div className="mono mt-1 text-[9.5px] tracking-[0.24em] text-[var(--color-mid)]">
                ◐ NIGHT · MOON {Math.round(snap.env.moonIllumination * 100)}%{snap.env.moonElevation < 0 ? " (SET)" : ""}
              </div>
            )}
            {snap.inDrey && <div className="mono mt-1 text-[9.5px] tracking-[0.24em] text-[var(--color-amber)]">⌂ IN DREY · ASLEEP</div>}
            {!snap.alive && <div className="mono mt-1 text-[10px] tracking-[0.24em] text-[var(--color-alert)]">✕ SUBJECT DECEASED · SUCCESSOR EMERGING</div>}
          </div>
          <div className="mono tabular absolute right-6 top-5 text-right text-[9.5px] leading-[1.6] tracking-[0.12em] text-[var(--color-mid)]" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>
            <RecIndicator />
            <div>
              X {snap.position.x.toFixed(2)} · Z {snap.position.z.toFixed(2)} · Y {snap.position.y.toFixed(2)}
            </div>
            <div>
              HDG {(((snap.heading * 180) / Math.PI + 360) % 360).toFixed(0).padStart(3, "0")}° · V {snap.speed.toFixed(2)} m/s
            </div>
            <div>VISION {snap.visionRange.toFixed(1)} m · HEALTH {Math.round(snap.health * 100)}%</div>
            <div>
              {snap.env.tempC.toFixed(1)} °C · WIND {Math.round(snap.env.windKmh)} km/h{snap.env.snowDepthM > 0.01 ? ` · SNOW ${Math.round(snap.env.snowDepthM * 100)} cm` : ""}
            </div>
            <div>
              {speed}× · {frameStats.fps.toFixed(0)} FPS
            </div>
          </div>
          <div className="absolute bottom-5 left-6 max-w-[48%]">
            <ThoughtStream />
          </div>
          <div className="absolute bottom-[172px] right-6">
            <RewardFeed />
          </div>
          <div className="pointer-events-auto absolute bottom-5 right-6 h-[140px] w-[140px] overflow-hidden rounded-full border border-[var(--color-line-strong)] opacity-90 shadow-[0_0_24px_rgba(0,0,0,0.8)]" title="Open the ecology map">
            <MapView compact initialLayers={["memories", "caches", "rivals", "predators", "trail"]} />
          </div>
        </>
      )}
    </div>
  );
}
