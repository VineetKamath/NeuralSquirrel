import weatherJson from "./data/weather.json";

interface WeatherJson {
  source: string;
  startUTC: number;
  hours: number;
  temp: number[];
  precip: number[];
  snowfall: number[];
  snowDepth: number[];
  cloud: number[];
  wind: number[];
  gust: number[];
  humidity: number[];
}

const W = weatherJson as unknown as WeatherJson;
const HOUR = 3600_000;
const YEAR = 365 * 24 * HOUR;

export interface WeatherSample {
  tempC: number;
  precipMm: number;
  snowfallCm: number;
  snowDepthM: number;
  cloud: number;
  windKmh: number;
  gustKmh: number;
  humidity: number;
}

export const WEATHER_SOURCE = W.source;
export const WEATHER_RANGE = { start: W.startUTC, end: W.startUTC + W.hours * HOUR };

function index(utcMs: number) {
  let t = utcMs;
  // outside the recorded window: reuse the same time of year
  while (t >= WEATHER_RANGE.end) t -= YEAR;
  while (t < WEATHER_RANGE.start) t += YEAR;
  const h = (t - W.startUTC) / HOUR;
  const i = Math.max(0, Math.min(W.hours - 2, Math.floor(h)));
  return { i, f: Math.min(1, Math.max(0, h - i)) };
}

const lerp = (arr: number[], i: number, f: number) => arr[i] * (1 - f) + arr[i + 1] * f;

/** real hourly weather for Central Park, interpolated */
export function weatherAt(utcMs: number): WeatherSample {
  const { i, f } = index(utcMs);
  return {
    tempC: lerp(W.temp, i, f),
    precipMm: lerp(W.precip, i, f),
    snowfallCm: lerp(W.snowfall, i, f),
    snowDepthM: lerp(W.snowDepth, i, f),
    cloud: lerp(W.cloud, i, f),
    windKmh: lerp(W.wind, i, f),
    gustKmh: lerp(W.gust, i, f),
    humidity: lerp(W.humidity, i, f),
  };
}

/** precipitation accumulated over the previous N hours (mm) */
export function precipitationWindow(utcMs: number, hours: number) {
  const { i } = index(utcMs);
  let s = 0;
  for (let k = Math.max(0, i - hours); k <= i; k++) s += W.precip[k];
  return s;
}

/** daily summary for journal entries */
export function daySummary(utcDayStart: number) {
  const { i } = index(utcDayStart);
  let min = Infinity;
  let max = -Infinity;
  let precip = 0;
  let snow = 0;
  let depth = 0;
  let gust = 0;
  for (let k = i; k < Math.min(W.hours, i + 24); k++) {
    min = Math.min(min, W.temp[k]);
    max = Math.max(max, W.temp[k]);
    precip += W.precip[k];
    snow += W.snowfall[k];
    depth = Math.max(depth, W.snowDepth[k]);
    gust = Math.max(gust, W.gust[k]);
  }
  return { min, max, precip, snow, depth, gust };
}

/** a compact series for charts: daily min/max/precip for the whole record */
export function dailySeries() {
  const days = Math.floor(W.hours / 24);
  const out: { day: number; utc: number; min: number; max: number; precip: number; snow: number }[] = [];
  for (let d = 0; d < days; d++) {
    const s = daySummary(W.startUTC + d * 24 * HOUR);
    out.push({ day: d, utc: W.startUTC + d * 24 * HOUR, min: s.min, max: s.max, precip: s.precip, snow: s.depth });
  }
  return out;
}
