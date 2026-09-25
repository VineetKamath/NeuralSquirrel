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
/** a diverged trajectory (float differences between browsers) is re-downloaded at most this often */
const DIVERGENCE_PULL_MS = 3 * 60000;
let lastPull = 0;

/** the server's clock, extrapolated locally so the mirror can step in lock-step between polls */
const clock = { time: 0, at: 0, speed: 1, running: true, known: false };

function setClock(st: LiveStatus, sentAt: number) {
  // the status was produced somewhere between sending and receiving: assume the midpoint
  const at = (sentAt + performance.now()) / 2;
  Object.assign(clock, { time: st.time, at, speed: st.speed, running: st.running, known: true });
}

/** where the server's simulation is now (sim seconds), or null before the first status */
export function liveTarget() {
  if (!clock.known) return null;
  if (!clock.running) return clock.time;
  return clock.time + ((performance.now() - clock.at) / 1000) * clock.speed;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

async function getStatus() {
  const sent = performance.now();
  const st = await getJSON<LiveStatus>(`/api/live?v=${viewerId}`);
  setClock(st, sent);
  useLab.setState({ speed: st.speed, running: st.running });
  return st;
}

function setServer(status: string, connected: boolean) {
  const s = useLab.getState();
  useLab.setState({ server: { ...s.server, url: BASE || "same origin", connected, status } });
}

/**
 * Download the server's current state and continue it locally (the simulation is deterministic).
 * A resync of the same experiment keeps the 3D world mounted, so it is a short hitch, not a reload.
 */
export async function pullLive() {
  if (pulling) return;
  pulling = true;
  lastPull = Date.now();
  try {
    const snap = await getJSON<ExperimentSnapshot>("/api/snapshot");
    const status = await getStatus();
    await resumeFromSnapshot(snap, true);
    setServer(`LIVE · ${status.viewers} WATCHING`, true);
  } finally {
    pulling = false;
  }
}

/** the mirror fell too far behind to step (e.g. a long-hidden tab): download instead of simulating the gap */
export function requestCatchUpPull() {
  if (pulling || Date.now() - lastPull < 10000) return;
  void pullLive().catch(() => setServer("RECONNECTING…", false));
}

/**
 * Keep the local mirror in step: the browser follows the server's clock (see liveTarget), and every
 * 15 s it compares generation and position with the server, re-downloading only on divergence.
 */
export function startLiveSync() {
  if (timer) return;
  const check = async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const st = await getStatus();
      const exp = getExperiment();
      const s = exp.agent.state;
      const drift = Math.abs(st.time - exp.time);
      const off = Math.hypot(st.x - s.position.x, st.z - s.position.z);
      const diverged = drift < 2 && off > 3 && Date.now() - lastPull > DIVERGENCE_PULL_MS;
      if (st.generation !== s.generation || diverged) await pullLive();
      else setServer(`LIVE · ${st.viewers} WATCHING`, true);
    } catch {
      setServer("RECONNECTING…", false);
    }
  };
  timer = setInterval(check, 15000);
  // a tab that was hidden fell behind: refresh the clock; the driver catches up or re-downloads
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
}
