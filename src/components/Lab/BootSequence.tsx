"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { pad, realDateString } from "@/utils/format";
import { SITE } from "@/real/siteConfig";
import type { ExperimentSnapshot } from "@/simulation/Experiment";
import { DAY_LENGTH } from "@/simulation/constants";

const SYSTEMS = ["STUDY SITE · CENTRAL PARK", "WEATHER RECORD · ERA5", "SQUIRREL CENSUS · 2018", "SPIKING NETWORK · 846", "MEMORY · PLACE CELLS", "MOTOR SYSTEM"];

export type BootChoice = "new" | "resume";

function ago(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} MIN AGO`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} H AGO`;
  return `${Math.round(h / 24)} DAYS AGO`;
}

export function BootSequence({
  experimentNumber,
  seed,
  sceneReady,
  saved,
  onDone,
}: {
  experimentNumber: number;
  seed: number;
  sceneReady: boolean;
  saved: ExperimentSnapshot | null | undefined;
  onDone: (choice: BootChoice) => void;
}) {
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = [400, 900, 1400, 2000, 2300, 2600, 2900, 3200, 3500, 3900];
    schedule.forEach((ms, i) => timers.push(setTimeout(() => setStep(i + 1), ms)));
    return () => timers.forEach(clearTimeout);
  }, []);

  const ready = step >= 10 && sceneReady && saved !== undefined;

  const finish = (choice: BootChoice) => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => onDone(choice), 1300);
  };

  // with a saved experiment, wait for a choice (auto-resume after a countdown); otherwise start
  useEffect(() => {
    if (!ready || leaving) return;
    if (!saved) {
      const t = setTimeout(() => finish("new"), 700);
      return () => clearTimeout(t);
    }
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, saved, leaving]);

  useEffect(() => {
    if (saved && ready && countdown <= 0) finish("resume");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  return (
    <motion.div
      key="boot"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#030404]"
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: leaving ? 1.2 : 0.2, ease: "easeInOut" }}
      style={{ pointerEvents: leaving ? "none" : "auto" }}
      onClick={() => {
        if (ready && !saved) finish("new");
      }}
    >
      <div className="mono w-[min(520px,90vw)] text-[12px] leading-[1.9] tracking-[0.18em] text-[#b9c4c0]">
        <Line show={step >= 1} className="text-[15px] tracking-[0.42em] text-[#eef4f1]">
          SQUIRREL LAB
        </Line>
        <Line show={step >= 2} className="text-[#6e7a76]">
          ARTIFICIAL ANIMAL RESEARCH UNIT · SUBJECT: NUT
        </Line>
        <div className="h-4" />
        <Line show={step >= 3}>
          THE RAMBLE · CENTRAL PARK · NEW YORK <span className="text-[#56615d]">· {SITE.centerLat.toFixed(4)}°N {Math.abs(SITE.centerLon).toFixed(4)}°W</span>
        </Line>
        <Line show={step >= 3} className="text-[#6e7a76]">
          FIELD SEASON BEGINS {realDateString(0)}
        </Line>
        <div className="h-3" />
        {SYSTEMS.map((s, i) => (
          <Line key={s} show={step >= 4 + i}>
            <span className="text-[#8c9894]">{s}</span>
            <span className="text-[#39413e]"> {".".repeat(Math.max(2, 28 - s.length))} </span>
            <span className="text-[#8fe3c4]">READY</span>
          </Line>
        ))}
        <div className="h-4" />
        {!ready ? (
          <Line show={step >= 10} className="text-[#6e7a76]">
            COMPILING ENVIRONMENT<span className="blink">_</span>
          </Line>
        ) : saved ? (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="border border-[rgba(190,210,205,0.18)] p-3">
            <div className="text-[10px] tracking-[0.2em] text-[#6e7a76]">SAVED EXPERIMENT FOUND · {ago(Date.now() - saved.savedAt)}</div>
            <div className="mt-1 text-[#eef4f1]">
              EXPERIMENT {pad(saved.number)} · DAY {Math.floor(saved.world.state.time / DAY_LENGTH) + 1} · GEN {saved.agent.state.generation}
            </div>
            <div className="text-[10.5px] text-[#8c9894]">
              {realDateString(saved.world.state.time)} · SEED {saved.seed}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn !text-[var(--color-signal)]" data-active onClick={() => finish("resume")}>
                ▶ RESUME ({Math.max(0, countdown)})
              </button>
              <button className="btn" onClick={() => finish("new")}>
                NEW EXPERIMENT {pad(experimentNumber)} · SEED {seed}
              </button>
            </div>
          </motion.div>
        ) : (
          <Line show className="text-[#eef4f1] tracking-[0.3em]">
            SUBJECT READY
          </Line>
        )}
      </div>
    </motion.div>
  );
}

function Line({ show, children, className = "" }: { show: boolean; children: React.ReactNode; className?: string }) {
  return (
    <motion.div initial={false} animate={{ opacity: show ? 1 : 0, x: show ? 0 : -4 }} transition={{ duration: 0.25 }} className={className}>
      {children}
    </motion.div>
  );
}
