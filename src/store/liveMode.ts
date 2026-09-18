"use client";

import type { ExperimentSnapshot } from "@/simulation/Experiment";
import { getExperiment } from "./runtime";
import { resumeFromSnapshot, useLab } from "./labStore";

/**
 * LIVE (spectator) build: one always-on lab server runs the experiment 24/7 and every visitor
 * mirrors it. Set NEXT_PUBLIC_LIVE=1 at build time. NEXT_PUBLIC_LIVE_SERVER points at the server;
 * empty means the same origin (the server also serves the site).
 */
export const LIVE = process.env.NEXT_PUBLIC_LIVE === "1";
const BASE = (process.env.NEXT_PUBLIC_LIVE_SERVER ?? "").replace(/\/$/, "");

interface LiveStatus {
  time: number;
  speed: number;
  running: boolean;
  generation: number;
  x: number;
  z: number;
  day: number;
  date: string;
  viewers: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
const viewerId = Math.random().toString(36).slice(2, 10);
let pulling = false;

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

function setServer(status: string, connected: boolean) {
  const s = useLab.getState();
  useLab.setState({ server: { ...s.server, url: BASE || "same origin", connected, status } });
}

/** download the server's current state and continue it locally (the simulation is deterministic) */
export async function pullLive() {
  if (pulling) return;
  pulling = true;
  try {
    const snap = await getJSON<ExperimentSnapshot>("/api/snapshot");
    const status = await getJSON<LiveStatus>(`/api/live?v=${viewerId}`);
    await resumeFromSnapshot(snap);
    useLab.setState({ speed: status.speed, running: status.running });
    setServer(`LIVE · ${status.viewers} WATCHING`, true);
  } finally {
    pulling = false;
  }
}

/**
 * Keep the local mirror in step: the browser advances the same deterministic simulation, and every
 * 15 s it compares time, generation and position with the server, re-downloading only on divergence.
 */
export function startLiveSync() {
  if (timer) return;
  timer = setInterval(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const st = await getJSON<LiveStatus>(`/api/live?v=${viewerId}`);
      const exp = getExperiment();
      const s = exp.agent.state;
      const drift = Math.abs(st.time - exp.time);
      const off = Math.hypot(st.x - s.position.x, st.z - s.position.z);
      useLab.setState({ speed: st.speed, running: st.running });
      if (drift > 4 + st.speed * 2 || st.generation !== s.generation || (drift < 2 && off > 3)) await pullLive();
      else setServer(`LIVE · ${st.viewers} WATCHING`, true);
    } catch {
      setServer("RECONNECTING…", false);
    }
  }, 15000);
  // a tab that was hidden fell behind: resync as soon as it is visible again
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void pullLive().catch(() => setServer("RECONNECTING…", false));
  });
}
