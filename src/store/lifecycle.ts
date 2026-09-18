"use client";

import { useEffect } from "react";
import type { ExperimentSnapshot } from "@/simulation/Experiment";
import { DAY_LENGTH } from "@/simulation/constants";
import { getExperiment } from "./runtime";
import { resumeFromSnapshot, useLab } from "./labStore";
import { CURRENT_KEY, idbDelete, idbGet } from "./saveStore";
import { LIVE } from "./liveMode";

/** longest offline gap that is simulated on resume (sim seconds) */
export const MAX_CATCH_UP = DAY_LENGTH * 30;

export async function loadSavedSnapshot(): Promise<ExperimentSnapshot | null> {
  const snap = await idbGet<ExperimentSnapshot>(CURRENT_KEY);
  return snap && snap.version === 3 ? snap : null;
}

export async function deleteSavedSnapshot() {
  await idbDelete(CURRENT_KEY);
}

/**
 * Resume a saved experiment. If catch-up is on, the time the tab was closed is simulated
 * (at the saved speed, capped at 30 days) in small slices so the page stays responsive.
 */
export async function resumeExperiment(snap: ExperimentSnapshot, speed: number, catchUp: boolean) {
  const exp = await resumeFromSnapshot(snap);
  if (!catchUp) return exp;
  const away = Math.max(0, (Date.now() - snap.savedAt) / 1000);
  const target = Math.min(MAX_CATCH_UP, away * speed);
  if (target < 1) return exp;
  const from = exp.time;
  const to = from + target;
  useLab.setState({ catchingUp: { from, to, progress: 0 } });
  await new Promise<void>((resolve) => {
    const slice = () => {
      const st = useLab.getState();
      if (!st.catchingUp) return resolve();
      exp.fastForward(Math.min(DAY_LENGTH / 4, to - exp.time), 28);
      st.publish(exp);
      const progress = (exp.time - from) / (to - from);
      if (exp.time >= to - 0.01) {
        useLab.setState({ catchingUp: null });
        st.publishSlow(exp);
        resolve();
      } else {
        useLab.setState({ catchingUp: { from, to, progress } });
        setTimeout(slice, 0);
      }
    };
    slice();
  });
  return exp;
}

/** autosave to IndexedDB every minute and whenever the tab is hidden or closed */
export function useAutosave() {
  const booted = useLab((s) => s.booted);
  const autosave = useLab((s) => s.autosave);
  useEffect(() => {
    if (LIVE || !booted || !autosave) return;
    const save = () => {
      const st = useLab.getState();
      if (st.catchingUp) return;
      void st.saveNow(getExperiment());
    };
    const t = setInterval(save, 60000);
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
    };
  }, [booted, autosave]);
}

/**
 * The render loop stops while the tab is hidden. This keeps the experiment running in the
 * background by stepping it from a timer, using wall-clock time so throttled timers don't lose time.
 */
export function useBackgroundDriver() {
  const booted = useLab((s) => s.booted);
  useEffect(() => {
    if (LIVE || !booted) return;
    let last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      if (document.visibilityState !== "hidden") return;
      const st = useLab.getState();
      if (!st.running || st.catchingUp) return;
      const exp = getExperiment();
      exp.fastForward(Math.min(MAX_CATCH_UP, dt * st.speed), 250);
    }, 1000);
    return () => clearInterval(t);
  }, [booted]);
}

export function downloadSnapshot() {
  const exp = getExperiment();
  const blob = new Blob([JSON.stringify(exp.snapshot())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `squirrel-lab-exp${String(exp.number).padStart(2, "0")}-day${exp.world.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function importSnapshotFile(file: File) {
  const text = await file.text();
  const snap = JSON.parse(text) as ExperimentSnapshot;
  if (snap.version !== 3) throw new Error("Unsupported snapshot version");
  const exp = await resumeFromSnapshot(snap);
  void useLab.getState().saveNow(exp);
  return exp;
}
