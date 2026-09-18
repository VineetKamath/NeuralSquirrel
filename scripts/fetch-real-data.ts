/**
 * Fetches real-world data for the study site and writes compact JSON into src/real/data.
 * Run once with network access:  npm run data:fetch
 *
 * Sources
 *  - Elevation: AWS Terrain Tiles (Terrarium encoding; USGS 3DEP in this area)
 *  - Map features: OpenStreetMap via the Overpass API (© OpenStreetMap contributors, ODbL)
 *  - Weather: Open-Meteo historical archive (ERA5 reanalysis), hourly, 2018-10-01 … 2019-06-30
 *  - Squirrels: 2018 Central Park Squirrel Census, NYC Open Data (dataset vfnx-vebw)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { SITE, lonLatToLocal, siteBBox } from "../src/real/siteConfig";

const OUT = join(process.cwd(), "src", "real", "data");
mkdirSync(OUT, { recursive: true });
const UA = "SquirrelLab/0.2 (research visualisation prototype)";

async function get(url: string, init?: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) } });
    if (res.ok) return res;
    console.warn(`  ${res.status} for ${url.slice(0, 80)}… retrying`);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw new Error(`failed: ${url}`);
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

// ───────────────────────────── elevation ─────────────────────────────
async function elevation() {
  console.log("elevation…");
  const z = 15;
  const bb = siteBBox(10);
  const n = 2 ** z;
  const tx = (lon: number) => ((lon + 180) / 360) * n;
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  };
  const x0 = Math.floor(tx(bb.west));
  const x1 = Math.floor(tx(bb.east));
  const y0 = Math.floor(ty(bb.north));
  const y1 = Math.floor(ty(bb.south));
  const tiles = new Map<string, PNG>();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const res = await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { headers: { Accept: "image/png" } });
      tiles.set(`${x}/${y}`, PNG.sync.read(Buffer.from(await res.arrayBuffer())));
    }
  }
  const sample = (lon: number, lat: number) => {
    const fx = tx(lon);
    const fy = ty(lat);
    const px = (fx - Math.floor(fx)) * 256 - 0.5;
    const py = (fy - Math.floor(fy)) * 256 - 0.5;
    const read = (tileX: number, tileY: number, ix: number, iy: number): number => {
      let X = tileX;
      let Y = tileY;
      if (ix < 0) {
        X--;
        ix += 256;
      } else if (ix > 255) {
        X++;
        ix -= 256;
      }
      if (iy < 0) {
        Y--;
        iy += 256;
      } else if (iy > 255) {
        Y++;
        iy -= 256;
      }
      const t = tiles.get(`${X}/${Y}`) ?? tiles.get(`${tileX}/${tileY}`)!;
      const k = (Math.min(255, Math.max(0, iy)) * 256 + Math.min(255, Math.max(0, ix))) * 4;
      return t.data[k] * 256 + t.data[k + 1] + t.data[k + 2] / 256 - 32768;
    };
    const tX = Math.floor(fx);
    const tY = Math.floor(fy);
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const ax = px - ix;
    const ay = py - iy;
    const a = read(tX, tY, ix, iy);
    const b = read(tX, tY, ix + 1, iy);
    const c = read(tX, tY, ix, iy + 1);
    const d = read(tX, tY, ix + 1, iy + 1);
    return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
  };
  const res = 2;
  const count = SITE.size / res + 1;
  const data: number[] = [];
  const mPerLon = 111320 * Math.cos((SITE.centerLat * Math.PI) / 180);
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const x = -SITE.size / 2 + i * res;
      const zz = -SITE.size / 2 + j * res;
      const lon = SITE.centerLon + x / mPerLon;
      const lat = SITE.centerLat - zz / 111320;
      data.push(r1(sample(lon, lat)));
    }
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  console.log(`  ${tiles.size} tiles, ${count}×${count} samples, ${min.toFixed(1)}–${max.toFixed(1)} m`);
  return { res, count, min, max, data };
}

// ───────────────────────────── OpenStreetMap ─────────────────────────────
type LL = { lat: number; lon: number };
type Pt = [number, number];

function toLocal(g: LL[]): Pt[] {
  return g.map((p) => {
    const l = lonLatToLocal(p.lon, p.lat);
    return [r1(l.x), r1(l.z)];
  });
}

/** join way fragments into closed rings */
function assembleRings(parts: Pt[][]): Pt[][] {
  const rings: Pt[][] = [];
  const pool = parts.map((p) => p.slice());
  const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 0.2 && Math.abs(a[1] - b[1]) < 0.2;
  while (pool.length) {
    let ring = pool.shift()!;
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const end = ring[ring.length - 1];
        if (same(end, p[0])) ring = ring.concat(p.slice(1));
        else if (same(end, p[p.length - 1])) ring = ring.concat(p.slice().reverse().slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

async function osm() {
  console.log("openstreetmap…");
  const bb = siteBBox(60);
  const b = `${bb.south},${bb.west},${bb.north},${bb.east}`;
  const q = `[out:json][timeout:90];(
    way["natural"="water"](${b});relation["natural"="water"](${b});
    way["water"](${b});way["waterway"](${b});
    way["highway"](${b});
    way["natural"="wood"](${b});relation["natural"="wood"](${b});
    way["landuse"~"grass|forest|meadow"](${b});way["leisure"="garden"](${b});
    way["natural"~"bare_rock|scrub|grassland"](${b});node["natural"~"rock|stone|peak"](${b});
    way["building"](${b});node["tourism"](${b});way["tourism"](${b});
  );out geom;`;
  let res: Response | null = null;
  for (const ep of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]) {
    try {
      res = await get(ep, {
        method: "POST",
        body: new URLSearchParams({ data: q }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      break;
    } catch (e) {
      console.warn("  endpoint failed", ep);
    }
  }
  if (!res) throw new Error("all overpass endpoints failed");
  const json = (await res.json()) as { elements: { type: string; id: number; tags?: Record<string, string>; geometry?: LL[]; lat?: number; lon?: number; members?: { role: string; geometry?: LL[] }[] }[] };
  const out = {
    water: [] as Pt[][],
    woods: [] as Pt[][],
    grass: [] as Pt[][],
    scrub: [] as Pt[][],
    rocks: [] as Pt[][],
    buildings: [] as { poly: Pt[]; name?: string }[],
    paths: [] as { kind: string; bridge: boolean; pts: Pt[] }[],
    streams: [] as Pt[][],
    names: [] as { name: string; kind: string; x: number; z: number }[],
  };
  const seenNames = new Set<string>();
  const centroid = (pts: Pt[]) => {
    let x = 0;
    let z = 0;
    for (const p of pts) {
      x += p[0];
      z += p[1];
    }
    return { x: r1(x / pts.length), z: r1(z / pts.length) };
  };
  for (const e of json.elements) {
    const t = e.tags ?? {};
    let polys: Pt[][] = [];
    if (e.type === "way" && e.geometry) polys = [toLocal(e.geometry)];
    if (e.type === "relation" && e.members) {
      polys = assembleRings(e.members.filter((m) => m.role !== "inner" && m.geometry).map((m) => toLocal(m.geometry!)));
    }
    const closed = (p: Pt[]) => p.length > 3;
    if (t.highway) {
      if (e.type === "way" && polys[0]) out.paths.push({ kind: t.highway, bridge: t.bridge === "yes", pts: polys[0] });
    } else if (t.natural === "water" || t.water) {
      polys.filter(closed).forEach((p) => out.water.push(p));
    } else if (t.waterway) {
      if (polys[0]) out.streams.push(polys[0]);
    } else if (t.natural === "wood" || t.landuse === "forest") {
      polys.filter(closed).forEach((p) => out.woods.push(p));
    } else if (t.landuse === "grass" || t.landuse === "meadow" || t.natural === "grassland" || t.leisure === "garden") {
      polys.filter(closed).forEach((p) => out.grass.push(p));
    } else if (t.natural === "scrub") {
      polys.filter(closed).forEach((p) => out.scrub.push(p));
    } else if (t.natural === "bare_rock") {
      polys.filter(closed).forEach((p) => out.rocks.push(p));
    } else if (t.building) {
      if (polys[0]) out.buildings.push({ poly: polys[0], name: t.name });
    }
    if (t.name && !seenNames.has(t.name) && !t.highway) {
      let pos: { x: number; z: number } | null = null;
      if (e.type === "node" && e.lat !== undefined && e.lon !== undefined) {
        const l = lonLatToLocal(e.lon, e.lat);
        pos = { x: r1(l.x), z: r1(l.z) };
      } else if (polys[0]) pos = centroid(polys[0]);
      if (pos && Math.abs(pos.x) < SITE.size / 2 && Math.abs(pos.z) < SITE.size / 2) {
        seenNames.add(t.name);
        out.names.push({ name: t.name, kind: t.natural ?? t.building ?? t.leisure ?? t.tourism ?? t.man_made ?? "place", ...pos });
      }
    }
  }
  console.log(
    `  water ${out.water.length}, woods ${out.woods.length}, grass ${out.grass.length}, rocks ${out.rocks.length}, buildings ${out.buildings.length}, paths ${out.paths.length}, names ${out.names.map((n) => n.name).join(", ")}`
  );
  return out;
}

// ───────────────────────────── weather ─────────────────────────────
async function weather() {
  console.log("weather…");
  const vars = ["temperature_2m", "precipitation", "snowfall", "snow_depth", "cloud_cover", "wind_speed_10m", "wind_gusts_10m", "relative_humidity_2m"];
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${SITE.centerLat}&longitude=${SITE.centerLon}&start_date=2018-10-01&end_date=2019-06-30&hourly=${vars.join(",")}&timezone=GMT`;
  const json = (await (await get(url)).json()) as { hourly: Record<string, (number | null)[]> & { time: string[] } };
  const h = json.hourly;
  const clean = (arr: (number | null)[], f: (v: number) => number) => arr.map((v) => f(v ?? 0));
  const out = {
    source: "Open-Meteo historical weather archive (ERA5), hourly, UTC",
    startUTC: Date.parse(h.time[0] + ":00Z"),
    hours: h.time.length,
    temp: clean(h.temperature_2m, r1),
    precip: clean(h.precipitation, r1),
    snowfall: clean(h.snowfall, r1),
    snowDepth: clean(h.snow_depth, r2),
    cloud: clean(h.cloud_cover, Math.round),
    wind: clean(h.wind_speed_10m, Math.round),
    gust: clean(h.wind_gusts_10m, Math.round),
    humidity: clean(h.relative_humidity_2m, Math.round),
  };
  console.log(`  ${out.hours} hours, temp ${Math.min(...out.temp)}…${Math.max(...out.temp)} °C, max gust ${Math.max(...out.gust)} km/h`);
  return out;
}

// ───────────────────────────── squirrel census ─────────────────────────────
async function census() {
  console.log("squirrel census…");
  const rows = (await (await get("https://data.cityofnewyork.us/resource/vfnx-vebw.json?$limit=5000")).json()) as Record<string, unknown>[];
  const flags = ["running", "chasing", "climbing", "eating", "foraging", "kuks", "quaas", "moans", "tail_flags", "tail_twitches", "approaches", "indifferent", "runs_from"];
  const count = (list: Record<string, unknown>[], key: string) => list.filter((r) => r[key] === true).length;
  const summarize = (list: Record<string, unknown>[]) => {
    const n = list.length;
    const o: Record<string, number> = { n };
    for (const f of flags) o[f] = r2(count(list, f) / Math.max(1, n));
    o.aboveGround = r2(list.filter((r) => r.location === "Above Ground").length / Math.max(1, n));
    return o;
  };
  const fur: Record<string, number> = {};
  const age: Record<string, number> = {};
  for (const r of rows) {
    const f = (r.primary_fur_color as string) ?? "Unknown";
    fur[f] = (fur[f] ?? 0) + 1;
    const a = (r.age as string) ?? "Unknown";
    age[a] = (age[a] ?? 0) + 1;
  }
  const half = SITE.size / 2;
  const sightings = rows
    .map((r) => {
      const l = lonLatToLocal(Number(r.x), Number(r.y));
      const b = (k: string) => (r[k] === true ? 1 : 0);
      return {
        id: r.unique_squirrel_id as string,
        x: r1(l.x),
        z: r1(l.z),
        shift: r.shift as string,
        date: r.date as string,
        fur: (r.primary_fur_color as string) ?? "",
        age: (r.age as string) ?? "",
        above: r.location === "Above Ground" ? 1 : 0,
        run: b("running"),
        chase: b("chasing"),
        climb: b("climbing"),
        eat: b("eating"),
        forage: b("foraging"),
        alarm: b("kuks") || b("quaas") || b("moans") ? 1 : 0,
        approach: b("approaches"),
        flee: b("runs_from"),
        note: ((r.other_activities as string) ?? "").slice(0, 60),
      };
    })
    .filter((s) => Math.abs(s.x) < half && Math.abs(s.z) < half);
  const out = {
    source: "2018 Central Park Squirrel Census, NYC Open Data (vfnx-vebw)",
    total: rows.length,
    park: summarize(rows),
    am: summarize(rows.filter((r) => r.shift === "AM")),
    pm: summarize(rows.filter((r) => r.shift === "PM")),
    fur,
    age,
    sitePresent: sightings.length,
    sightings,
  };
  console.log(`  ${rows.length} sightings park-wide, ${sightings.length} inside the site window`);
  return out;
}

async function main() {
  const [elev, map, wx, cen] = [await elevation(), await osm(), await weather(), await census()];
  const meta = { site: SITE, fetchedAt: new Date().toISOString() };
  writeFileSync(join(OUT, "site.json"), JSON.stringify({ meta, elevation: elev, ...map }));
  writeFileSync(join(OUT, "weather.json"), JSON.stringify(wx));
  writeFileSync(join(OUT, "census.json"), JSON.stringify(cen));
  console.log("done →", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
