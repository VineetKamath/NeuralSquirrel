"use client";

import type { ExperimentSnapshot } from "@/simulation/Experiment";
import { getExperiment } from "./runtime";
import { resumeFromSnapshot, useLab } from "./labStore";

/**
 * Server mode: a headless lab server (npm run lab:server) runs the experiment continuously for weeks.
 * The browser attaches to it, mirrors its state and re-synchronises periodically.
 */
export interface ServerStatus {
  seed: number;
  number: number;
  time: number;
  day: number;
  date: string;
  speed: number;
  running: boolean;
  generation: number;
  savedAt: number;
  uptime: number;
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

function setServer(patch: Partial<ReturnType<typeof useLab.getState>["server"]>) {
  const s = useLab.getState();
  useLab.setState({ server: { ...s.server, ...patch } });
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function serverStatus(url: string) {
  return fetchJSON<ServerStatus>(`${url.replace(/\/$/, "")}/api/status`);
}

async function pull(url: string) {
  const base = url.replace(/\/$/, "");
  const status = await serverStatus(base);
  const snap = await fetchJSON<ExperimentSnapshot>(`${base}/api/snapshot`);
  await resumeFromSnapshot(snap);
  useLab.setState({ speed: status.speed, running: status.running });
  setServer({ connected: true, status: `SYNCED · DAY ${status.day} · ${status.date}` });
  return status;
}

export async function connectServer(url: string) {
  setServer({ url, status: "CONNECTING…", connected: false });
  try {
    await pull(url);
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(async () => {
      const st = useLab.getState();
      if (!st.server.connected) return;
      try {
        const status = await serverStatus(st.server.url);
        const drift = Math.abs(status.time - getExperiment().time);
        if (drift > 20 || status.generation !== getExperiment().agent.state.generation) await pull(st.server.url);
        else setServer({ status: `LIVE · DAY ${status.day} · DRIFT ${drift.toFixed(1)} S` });
      } catch (e) {
        setServer({ status: `LOST · ${(e as Error).message}` });
      }
    }, 30000);
    return true;
  } catch (e) {
    setServer({ connected: false, status: `FAILED · ${(e as Error).message}` });
    return false;
  }
}

export function disconnectServer() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  setServer({ connected: false, status: "DISCONNECTED · RUNNING LOCALLY" });
}

/** forward local speed / pause changes to the server */
export async function pushControl(patch: { speed?: number; running?: boolean }) {
  const st = useLab.getState();
  if (!st.server.connected) return;
  try {
    await fetchJSON(`${st.server.url.replace(/\/$/, "")}/api/control`, { method: "POST", body: JSON.stringify(patch) });
  } catch {
    /* the next sync reports connection problems */
  }
}
