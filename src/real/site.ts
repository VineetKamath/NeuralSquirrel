import siteJson from "./data/site.json";
import { SITE } from "./siteConfig";
import { ValueNoise } from "@/utils/rng";

type Pt = [number, number];

interface SiteJson {
  meta: { fetchedAt: string };
  elevation: { res: number; count: number; min: number; max: number; data: number[] };
  water: Pt[][];
  woods: Pt[][];
  grass: Pt[][];
  scrub: Pt[][];
  rocks: Pt[][];
  buildings: { poly: Pt[]; name?: string }[];
  paths: { kind: string; bridge: boolean; pts: Pt[] }[];
  streams: Pt[][];
  names: { name: string; kind: string; x: number; z: number }[];
}

export const LAND = { LAWN: 0, WOOD: 1, WATER: 2, ROCK: 3, BUILDING: 4, SCRUB: 5 } as const;

export interface WaterBody {
  id: string;
  name: string;
  kind: "lake" | "pond" | "stream";
  level: number;
  poly: Pt[];
  area: number;
  center: { x: number; z: number };
}

/**
 * Real-world site model: terrain (USGS elevation via AWS Terrain Tiles) and
 * land cover, water, paths and buildings from OpenStreetMap, rasterised at 1 m.
 */
export class SiteModel {
  readonly raw: SiteJson;
  readonly size = SITE.size;
  readonly half = SITE.size / 2;
  readonly n = SITE.size; // 1 m cells
  readonly land: Uint8Array;
  readonly bridge: Uint8Array;
  readonly pathDist: Float32Array;
  readonly waterDist: Float32Array;
  readonly nearestWater: Int32Array;
  readonly waterId: Int8Array;
  readonly waterBodies: WaterBody[] = [];
  readonly baseElevation: number;
  private elev: Float32Array;
  private elevCount: number;
  private elevRes: number;
  private noise = new ValueNoise(20181006);
  private heightCache: Float32Array;

  constructor() {
    this.raw = siteJson as unknown as SiteJson;
    const e = this.raw.elevation;
    this.elev = Float32Array.from(e.data);
    this.elevCount = e.count;
    this.elevRes = e.res;
    const n = this.n;
    this.land = new Uint8Array(n * n);
    this.bridge = new Uint8Array(n * n);
    this.waterId = new Int8Array(n * n).fill(-1);

    // land cover, in priority order
    for (const p of this.raw.woods) this.fill(p, LAND.WOOD);
    for (const p of this.raw.scrub) this.fill(p, LAND.SCRUB);
    for (const p of this.raw.grass) this.fill(p, LAND.LAWN);
    for (const p of this.raw.rocks) this.fill(p, LAND.ROCK);
    for (const b of this.raw.buildings) this.fill(b.poly, LAND.BUILDING);

    // water bodies
    const named = this.raw.names;
    this.raw.water.forEach((poly, i) => {
      const c = centroid(poly);
      const area = Math.abs(polyArea(poly));
      const nm = named.filter((x) => x.kind === "water").sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
      const body: WaterBody = {
        id: `water-${i}`,
        name: nm && Math.hypot(nm.x - c.x, nm.z - c.z) < Math.sqrt(area) ? nm.name.toUpperCase() : area > 3000 ? "THE LAKE" : "POND",
        kind: area > 20000 ? "lake" : "pond",
        level: 0,
        poly,
        area,
        center: c,
      };
      this.waterBodies.push(body);
      this.fill(poly, LAND.WATER, i);
    });
    this.raw.streams.forEach((line, i) => {
      const id = this.waterBodies.length;
      this.waterBodies.push({ id: `stream-${i}`, name: "THE GILL", kind: "stream", level: 0, poly: line, area: 0, center: centroid(line) });
      this.stampLine(line, 0.9, (k) => {
        if (this.land[k] !== LAND.BUILDING) {
          this.land[k] = LAND.WATER;
          this.waterId[k] = id;
        }
      });
    });
    // bridges are walkable decks over water
    for (const p of this.raw.paths) if (p.bridge) this.stampLine(p.pts, 1.6, (k) => (this.bridge[k] = 1));

    // water surface levels from the elevation model (lower decile inside each body)
    const samples: number[][] = this.waterBodies.map(() => []);
    for (let k = 0; k < n * n; k++) {
      const id = this.waterId[k];
      if (id < 0) continue;
      const x = (k % n) - this.half + 0.5;
      const z = Math.floor(k / n) - this.half + 0.5;
      samples[id].push(this.dem(x, z));
    }
    const allWater = samples.flat().sort((a, b) => a - b);
    this.baseElevation = allWater.length ? allWater[Math.floor(allWater.length * 0.1)] : this.raw.elevation.min;
    this.waterBodies.forEach((b, i) => {
      const s = samples[i].sort((a, c) => a - c);
      b.level = (s.length ? s[Math.floor(s.length * (b.kind === "stream" ? 0.5 : 0.1))] : this.baseElevation) - this.baseElevation;
    });

    this.pathDist = this.distanceField((k) => false, true);
    const { dist, nearest } = this.nearestField((k) => this.land[k] === LAND.WATER);
    this.waterDist = dist;
    this.nearestWater = nearest;

    // cached terrain heights at cell centres
    this.heightCache = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        this.heightCache[j * (n + 1) + i] = this.computeHeight(i - this.half, j - this.half);
      }
    }
  }

  // ───────────── rasterisation helpers ─────────────

  private idx(x: number, z: number) {
    const i = Math.floor(x + this.half);
    const j = Math.floor(z + this.half);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  private fill(poly: Pt[], value: number, waterIndex = -1) {
    const n = this.n;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of poly) {
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    const j0 = Math.max(0, Math.floor(minZ + this.half));
    const j1 = Math.min(n - 1, Math.ceil(maxZ + this.half));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const zc = j - this.half + 0.5;
      xs.length = 0;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [xa, za] = poly[a];
        const [xb, zb] = poly[b];
        if ((za > zc) !== (zb > zc)) xs.push(xa + ((zc - za) / (zb - za)) * (xb - xa));
      }
      xs.sort((p, q) => p - q);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const i0 = Math.max(0, Math.ceil(xs[s] + this.half - 0.5));
        const i1 = Math.min(n - 1, Math.floor(xs[s + 1] + this.half - 0.5));
        for (let i = i0; i <= i1; i++) {
          const k = j * n + i;
          this.land[k] = value;
          if (waterIndex >= 0) this.waterId[k] = waterIndex;
        }
      }
    }
  }

  private stampLine(pts: Pt[], radius: number, fn: (k: number) => void) {
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s];
      const [bx, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / 0.5));
      for (let t = 0; t <= steps; t++) {
        const x = ax + ((bx - ax) * t) / steps;
        const z = az + ((bz - az) * t) / steps;
        for (let dz = -radius; dz <= radius; dz += 0.5) {
          for (let dx = -radius; dx <= radius; dx += 0.5) {
            if (dx * dx + dz * dz > radius * radius) continue;
            const k = this.idx(x + dx, z + dz);
            if (k >= 0) fn(k);
          }
        }
      }
    }
  }

  /** exact distance to the nearest path segment (capped at 12 m) */
  private distanceField(_unused: (k: number) => boolean, paths: boolean) {
    const n = this.n;
    const out = new Float32Array(n * n).fill(12);
    if (!paths) return out;
    for (const p of this.raw.paths) {
      if (p.kind === "secondary" || p.kind === "service") continue;
      const pts = p.pts;
      for (let s = 0; s < pts.length - 1; s++) {
        const [ax, az] = pts[s];
        const [bx, bz] = pts[s + 1];
        const minX = Math.floor(Math.min(ax, bx) - 12 + this.half);
        const maxX = Math.ceil(Math.max(ax, bx) + 12 + this.half);
        const minZ = Math.floor(Math.min(az, bz) - 12 + this.half);
        const maxZ = Math.ceil(Math.max(az, bz) + 12 + this.half);
        const dx = bx - ax;
        const dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        for (let j = Math.max(0, minZ); j <= Math.min(n - 1, maxZ); j++) {
          for (let i = Math.max(0, minX); i <= Math.min(n - 1, maxX); i++) {
            const x = i - this.half + 0.5;
            const z = j - this.half + 0.5;
            let t = ((x - ax) * dx + (z - az) * dz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
            const k = j * n + i;
            if (d < out[k]) out[k] = d;
          }
        }
      }
    }
    return out;
  }

  /** approximate Euclidean distance + nearest seed index (two-pass propagation) */
  private nearestField(isSeed: (k: number) => boolean) {
    const n = this.n;
    const nearest = new Int32Array(n * n).fill(-1);
    const dist = new Float32Array(n * n).fill(1e9);
    for (let k = 0; k < n * n; k++) {
      if (isSeed(k)) {
        nearest[k] = k;
        dist[k] = 0;
      }
    }
    const relax = (k: number, nk: number) => {
      const s = nearest[nk];
      if (s < 0) return;
      const d = Math.hypot((k % n) - (s % n), Math.floor(k / n) - Math.floor(s / n));
      if (d < dist[k]) {
        dist[k] = d;
        nearest[k] = s;
      }
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const k = j * n + i;
          if (i > 0) relax(k, k - 1);
          if (j > 0) {
            relax(k, k - n);
            if (i > 0) relax(k, k - n - 1);
            if (i < n - 1) relax(k, k - n + 1);
          }
        }
      }
      for (let j = n - 1; j >= 0; j--) {
        for (let i = n - 1; i >= 0; i--) {
          const k = j * n + i;
          if (i < n - 1) relax(k, k + 1);
          if (j < n - 1) {
            relax(k, k + n);
            if (i < n - 1) relax(k, k + n + 1);
            if (i > 0) relax(k, k + n - 1);
          }
        }
      }
    }
    return { dist, nearest };
  }

  // ───────────── sampling ─────────────

  /** raw digital elevation (m above sea level), bilinear */
  dem(x: number, z: number) {
    const c = this.elevCount;
    const fx = Math.min(c - 1.001, Math.max(0, (x + this.half) / this.elevRes));
    const fz = Math.min(c - 1.001, Math.max(0, (z + this.half) / this.elevRes));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const ax = fx - i;
    const az = fz - j;
    const e = this.elev;
    const a = e[j * c + i];
    const b = e[j * c + i + 1];
    const d = e[(j + 1) * c + i];
    const f = e[(j + 1) * c + i + 1];
    return (a * (1 - ax) + b * ax) * (1 - az) + (d * (1 - ax) + f * ax) * az;
  }

  private computeHeight(x: number, z: number) {
    const k = this.idx(Math.min(this.half - 0.01, x), Math.min(this.half - 0.01, z));
    let h = this.dem(x, z) - this.baseElevation;
    if (k < 0) return h;
    const wd = this.waterDist[k];
    const id = this.waterId[k];
    if (id >= 0) {
      const body = this.waterBodies[id];
      if (body.kind === "stream") return Math.min(h, body.level) - 0.35;
      // distance to shore inside the water body
      return body.level - 0.25 - Math.min(2.4, this.shoreDistance(x, z) * 0.11);
    }
    // natural microrelief on land, and banks just above nearby water
    h += (this.noise.fbm(x * 0.12, z * 0.12, 3) - 0.5) * 0.5;
    if (wd < 4) {
      const s = this.nearestWater[k];
      const wid = s >= 0 ? this.waterId[s] : -1;
      const level = wid >= 0 ? this.waterBodies[wid].level : 0;
      h = Math.max(h, level + 0.12 + wd * 0.06);
    }
    return h;
  }

  private shoreDistance(x: number, z: number) {
    // search outward for land (bounded)
    for (let r = 1; r < 40; r += 1) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const k = this.idx(x + Math.cos(ang) * r, z + Math.sin(ang) * r);
        if (k >= 0 && this.land[k] !== LAND.WATER) return r;
      }
    }
    return 40;
  }

  /** terrain height in local metres (lake surface ≈ 0) */
  height(x: number, z: number) {
    const n = this.n;
    const fx = Math.min(n - 0.001, Math.max(0, x + this.half));
    const fz = Math.min(n - 0.001, Math.max(0, z + this.half));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const ax = fx - i;
    const az = fz - j;
    const c = this.heightCache;
    const w = n + 1;
    return (c[j * w + i] * (1 - ax) + c[j * w + i + 1] * ax) * (1 - az) + (c[(j + 1) * w + i] * (1 - ax) + c[(j + 1) * w + i + 1] * ax) * az;
  }

  landAt(x: number, z: number) {
    const k = this.idx(x, z);
    return k < 0 ? LAND.LAWN : this.land[k];
  }

  isWater(x: number, z: number) {
    const k = this.idx(x, z);
    return k >= 0 && this.land[k] === LAND.WATER && !this.bridge[k];
  }

  isBlocked(x: number, z: number) {
    const k = this.idx(x, z);
    if (k < 0) return true;
    if (this.bridge[k]) return false;
    if (this.land[k] === LAND.WATER) {
      // a narrow stream can be hopped across; open water cannot
      const id = this.waterId[k];
      return !(id >= 0 && this.waterBodies[id]?.kind === "stream");
    }
    return this.land[k] === LAND.BUILDING;
  }

  onBridge(x: number, z: number) {
    const k = this.idx(x, z);
    return k >= 0 && this.bridge[k] === 1;
  }

  pathFactor(x: number, z: number) {
    const k = this.idx(x, z);
    if (k < 0) return 0;
    const d = this.pathDist[k];
    return d < 1.1 ? 1 : d < 2.2 ? 1 - (d - 1.1) / 1.1 : 0;
  }

  distToPath(x: number, z: number) {
    const k = this.idx(x, z);
    return k < 0 ? 12 : this.pathDist[k];
  }

  distToWater(x: number, z: number) {
    const k = this.idx(x, z);
    return k < 0 ? 999 : this.waterDist[k];
  }

  /** nearest drinkable edge point (on land, just beside water) */
  nearestWaterEdge(x: number, z: number, maxDist: number) {
    const k = this.idx(x, z);
    if (k < 0) return null;
    const d = this.waterDist[k];
    if (d > maxDist) return null;
    const s = this.nearestWater[k];
    if (s < 0) return null;
    const wx = (s % this.n) - this.half + 0.5;
    const wz = Math.floor(s / this.n) - this.half + 0.5;
    const len = Math.hypot(x - wx, z - wz) || 1;
    const ex = wx + ((x - wx) / len) * 0.9;
    const ez = wz + ((z - wz) / len) * 0.9;
    return { x: ex, z: ez, distance: d, body: this.waterBodies[this.waterId[s]] };
  }

  shoreFactor(x: number, z: number) {
    const k = this.idx(x, z);
    if (k < 0) return 0;
    if (this.land[k] === LAND.WATER) return 1;
    const d = this.waterDist[k];
    return d < 3 ? 1 - d / 3 : 0;
  }

  waterLevelAt(x: number, z: number) {
    const k = this.idx(x, z);
    if (k < 0) return -99;
    const s = this.land[k] === LAND.WATER ? k : this.nearestWater[k];
    if (s < 0) return -99;
    return this.waterBodies[this.waterId[s]]?.level ?? 0;
  }
}

function centroid(pts: Pt[]) {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return { x: x / pts.length, z: z / pts.length };
}

function polyArea(pts: Pt[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

let instance: SiteModel | null = null;
export function getSite() {
  if (!instance) instance = new SiteModel();
  return instance;
}

export const SITE_META = {
  fetchedAt: (siteJson as unknown as SiteJson).meta.fetchedAt,
  names: (siteJson as unknown as SiteJson).names,
};
