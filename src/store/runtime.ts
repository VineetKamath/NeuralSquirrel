import { Experiment, type ExperimentSnapshot } from "@/simulation/Experiment";

/**
 * The live simulation lives outside React. Renderers read it directly every frame;
 * the UI receives throttled snapshots through the Zustand store.
 */
let current: Experiment | null = null;
const listeners = new Set<(e: Experiment) => void>();

export function getExperiment(): Experiment {
  if (!current) current = new Experiment(728491, 1);
  return current;
}

export function setExperiment(exp: Experiment) {
  current = exp;
  listeners.forEach((l) => l(exp));
  return exp;
}

export function createExperiment(seed: number, number: number) {
  return setExperiment(new Experiment(seed, number));
}

/** `soft`: a resync of the same experiment; the current world is regenerated in place so the 3D scene is kept */
export function restoreExperiment(snap: ExperimentSnapshot, soft = false) {
  const reuse = soft && current && current.seed === snap.seed && current.number === snap.number ? current.world : undefined;
  return setExperiment(Experiment.restore(snap, reuse));
}

export function onExperimentChange(fn: (e: Experiment) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** real-time frame statistics shared between the canvas and HUD */
export const frameStats = { fps: 60, steps: 0, lastFrame: 0 };
