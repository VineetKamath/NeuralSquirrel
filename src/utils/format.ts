import { DAY_LENGTH } from "@/simulation/constants";
import { formatDate, localTime, simToUTC } from "@/real/calendar";

/** experiment clock on the real calendar (US Eastern time at the site) */
export function simClock(time: number) {
  const t = localTime(simToUTC(time));
  const day = Math.floor(time / DAY_LENGTH) + 1;
  return { day, hour: t.hour, minute: t.minute, second: t.second, hourFloat: t.hourFloat, local: t };
}

export const pad = (n: number, l = 2) => String(Math.floor(n)).padStart(l, "0");

export function clockString(time: number, withSeconds = true) {
  const c = simClock(time);
  return withSeconds ? `${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}` : `${pad(c.hour)}:${pad(c.minute)}`;
}

export function dayString(time: number) {
  const c = simClock(time);
  return `DAY ${pad(c.day)} · ${pad(c.hour)}:${pad(c.minute)}`;
}

export function realDateString(time: number) {
  const c = simClock(time);
  return `${formatDate(c.local)} · ${pad(c.hour)}:${pad(c.minute)} ${c.local.tz}`;
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const signed = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
