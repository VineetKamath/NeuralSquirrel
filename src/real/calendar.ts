import { DAY_LENGTH } from "@/simulation/constants";
import { SITE } from "./siteConfig";

const DAY_MS = 86400000;

/** simulated seconds → real UTC timestamp on the experiment calendar */
export function simToUTC(simTime: number, startUTC = SITE.startUTC) {
  return startUTC + (simTime / DAY_LENGTH) * DAY_MS;
}

function nthSunday(year: number, month: number, n: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (7 - first.getUTCDay()) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** US Eastern time offset in hours (EDT −4 / EST −5) using the US DST rule since 2007 */
export function easternOffset(utcMs: number) {
  const y = new Date(utcMs).getUTCFullYear();
  const dstStart = Date.UTC(y, 2, nthSunday(y, 2, 2), 7); // 2:00 EST = 07:00 UTC
  const dstEnd = Date.UTC(y, 10, nthSunday(y, 10, 1), 6); // 2:00 EDT = 06:00 UTC
  return utcMs >= dstStart && utcMs < dstEnd ? -4 : -5;
}

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export interface LocalTime {
  utc: number;
  offset: number;
  year: number;
  month: number;
  date: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
  hourFloat: number;
  dayOfYear: number;
  tz: "EDT" | "EST";
}

export function localTime(utcMs: number): LocalTime {
  const offset = easternOffset(utcMs);
  const d = new Date(utcMs + offset * 3600000);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const second = d.getUTCSeconds();
  return {
    utc: utcMs,
    offset,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour,
    minute,
    second,
    hourFloat: hour + minute / 60 + second / 3600,
    dayOfYear: Math.floor((d.getTime() - start) / DAY_MS) + 1,
    tz: offset === -4 ? "EDT" : "EST",
  };
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function formatDate(t: LocalTime) {
  return `${DAYS[t.weekday]} ${p2(t.date)} ${MONTHS[t.month]} ${t.year}`;
}

export function formatClock(t: LocalTime, seconds = false) {
  return seconds ? `${p2(t.hour)}:${p2(t.minute)}:${p2(t.second)}` : `${p2(t.hour)}:${p2(t.minute)}`;
}

export type Season = "autumn" | "winter" | "spring" | "summer";

/** meteorological season with a smooth phenology signal for leaves */
export function seasonOf(t: LocalTime): Season {
  const m = t.month;
  if (m >= 8 && m <= 10) return "autumn";
  if (m === 11 || m <= 1) return "winter";
  if (m >= 2 && m <= 4) return "spring";
  return "summer";
}

/**
 * Deciduous canopy state for New York City (approximate phenology):
 * leaves colour from mid-October, fall by late November, bud-break mid April, full by mid May.
 */
export function canopyState(t: LocalTime) {
  const d = t.dayOfYear;
  let leaf = 1;
  let colour = 0;
  if (d >= 288 && d < 334) {
    colour = Math.min(1, (d - 288) / 22);
    leaf = 1 - Math.max(0, (d - 305) / 29);
  } else if (d >= 334 || d < 102) {
    leaf = 0;
    colour = 1;
  } else if (d >= 102 && d < 135) {
    leaf = (d - 102) / 33;
    colour = 0;
  }
  return { leaf: Math.max(0, Math.min(1, leaf)), colour };
}

export function isWeekend(t: LocalTime) {
  return t.weekday === 0 || t.weekday === 6;
}
