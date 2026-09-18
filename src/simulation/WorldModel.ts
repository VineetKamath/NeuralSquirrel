import type {
  EnvironmentState,
  FoodSource,
  Landmark,
  ObjectKind,
  Threat,
  Vector3,
  WaterSource,
  Weather,
  WorldObject,
  WorldState,
} from "@/types";
import { mulberry32, range, type RNG } from "@/utils/rng";
import { clamp, dist2D, smoothstep, wrapAngle } from "@/utils/math";
import { DAY_LENGTH, GRID_CELL, GRID_RES, WORLD_HALF } from "./constants";
import { Terrain } from "./Terrain";
import { LAND } from "@/real/site";
import { SITE } from "@/real/siteConfig";
import { weatherAt, precipitationWindow } from "@/real/weather";
import { moonPosition, sunPosition } from "@/real/astronomy";
import { canopyState, isWeekend, localTime, simToUTC, type LocalTime } from "@/real/calendar";
import { CENSUS } from "@/real/census";

function cellOf(x: number, z: number) {
  const gx = clamp(Math.floor((x + WORLD_HALF) / GRID_CELL), 0, GRID_RES - 1);
  const gz = clamp(Math.floor((z + WORLD_HALF) / GRID_CELL), 0, GRID_RES - 1);
  return gz * GRID_RES + gx;
}

export interface SubjectView {
  position: Vector3;
  climbHeight: number;
  underCover: boolean;
  resting: boolean;
}

export interface ThreatContact {
  threatId: string;
  kind: Threat["kind"];
  targetId: string;
}

export interface WorldNotice {
  text: string;
  kind: "weather" | "food" | "threat" | "time" | "storm" | "snow";
  location?: Vector3;
}

const CELL = 10;
/** vegetation layout is fixed for the site, like a real forest; everything else varies by seed */
const SITE_VEGETATION_SEED = 20181006;

export class WorldModel {
  state: WorldState;
  terrain: Terrain;
  private rng: RNG;
  private obstacleGrid = new Map<number, WorldObject[]>();
  private coverGrid = new Map<number, WorldObject[]>();
  logs: WorldObject[] = [];
  benches: WorldObject[] = [];
  buried = new Float32Array(GRID_RES * GRID_RES);
  notices: WorldNotice[] = [];
  local: LocalTime;
  private lastLocalDay = -1;
  private lastHour = -1;
  private envTimer = 0;
  private idCounter = 0;
  masting: number;

  constructor(seed: number) {
    this.rng = mulberry32(seed ^ 0xa5a5a5);
    this.terrain = new Terrain();
    const utc = SITE.startUTC;
    this.local = localTime(utc);
    this.masting = range(this.rng, 0.7, 1.35);
    this.state = {
      seed,
      time: 0,
      weather: "clear",
      weatherTimer: 0,
      rainAmount: 0,
      fogAmount: 0.1,
      snowAmount: 0,
      env: this.emptyEnv(utc),
      objects: [],
      foodSources: [],
      waterSources: [],
      threats: [],
      landmarks: [],
      home: { x: 0, y: 0, z: 0 },
      paths: [],
      foodVersion: 0,
      structureVersion: 0,
      floodRise: 0,
    };
    this.generate();
    this.updateEnvironment(true);
    this.lastLocalDay = this.local.dayOfYear;
  }

  private emptyEnv(utc: number): EnvironmentState {
    return {
      utc,
      tempC: 10,
      precipMm: 0,
      snowDepthM: 0,
      windKmh: 5,
      gustKmh: 10,
      cloud: 30,
      humidity: 60,
      sunElevation: 10,
      sunAzimuth: 120,
      moonElevation: -10,
      moonAzimuth: 0,
      moonIllumination: 0.5,
      daylight: 1,
      leaf: 1,
      leafColour: 0,
      visitors: 0.3,
    };
  }

  // ───────────────────────────── generation ─────────────────────────────

  private uid(prefix: string) {
    return `${prefix}-${(this.idCounter++).toString(36)}`;
  }

  private ground(p: { x: number; z: number }): Vector3 {
    return { x: p.x, y: this.terrain.height(p.x, p.z), z: p.z };
  }

  private inBounds(x: number, z: number, margin = 4) {
    return Math.abs(x) < WORLD_HALF - margin && Math.abs(z) < WORLD_HALF - margin;
  }

  private addObject(kind: ObjectKind, p: { x: number; z: number }, rng: RNG, extra: Partial<WorldObject> = {}): WorldObject {
    const scale = extra.scale ?? 1;
    const defaults: Record<ObjectKind, { radius: number; height: number; cover: boolean; climbable: boolean }> = {
      oak: { radius: 0.62 * scale, height: 16 * scale, cover: true, climbable: true },
      pine: { radius: 0.36 * scale, height: 16 * scale, cover: true, climbable: true },
      birch: { radius: 0.3 * scale, height: 14 * scale, cover: true, climbable: true },
      bush: { radius: 1.2 * scale, height: 1.4 * scale, cover: true, climbable: false },
      rock: { radius: 1.0 * scale, height: 0.9 * scale, cover: false, climbable: false },
      log: { radius: 0.32 * scale, height: 0.7 * scale, cover: false, climbable: false },
      stump: { radius: 0.55 * scale, height: 0.9 * scale, cover: false, climbable: false },
      mushroom: { radius: 0.2, height: 0.2, cover: false, climbable: false },
      bench: { radius: 0.9, height: 0.9, cover: false, climbable: false },
      lamp: { radius: 0.15, height: 3.6, cover: false, climbable: false },
    };
    const d = defaults[kind];
    const obj: WorldObject = {
      id: this.uid(kind),
      kind,
      position: this.ground(p),
      radius: d.radius,
      height: d.height,
      rotation: rng() * Math.PI * 2,
      scale,
      variant: Math.floor(rng() * 4),
      cover: d.cover,
      climbable: d.climbable,
      deciduous: kind === "oak" || kind === "birch" || kind === "bush",
      ...extra,
    };
    obj.position = this.ground(obj.position);
    this.state.objects.push(obj);
    return obj;
  }

  private addLandmark(name: string, kind: Landmark["kind"], p: { x: number; z: number }, radius: number, obj?: WorldObject, real = true) {
    const lm: Landmark = { id: this.uid("lm"), name, kind, position: this.ground(p), radius, objectId: obj?.id, real };
    if (obj) obj.landmarkId = lm.id;
    this.state.landmarks.push(lm);
    return lm;
  }

  addFood(kind: FoodSource["kind"], p: { x: number; z: number }, amount: number, opts: Partial<FoodSource> = {}): FoodSource {
    const base: Record<FoodSource["kind"], { nutrition: number; visibility: number; regrow: number; label: string }> = {
      acorn: { nutrition: 0.15, visibility: 1, regrow: 0, label: "ACORNS" },
      berry: { nutrition: 0.05, visibility: 1.5, regrow: 0.5, label: "BERRIES" },
      mushroom: { nutrition: 0.06, visibility: 1.05, regrow: 0, label: "FUNGI" },
      cache: { nutrition: 0.16, visibility: 0.3, regrow: 0, label: "BURIED CACHE" },
      buds: { nutrition: 0.06, visibility: 1.1, regrow: 1.5, label: "TREE BUDS" },
      seeds: { nutrition: 0.05, visibility: 1.1, regrow: 0, label: "SAMARAS" },
      scraps: { nutrition: 0.14, visibility: 1.4, regrow: 0, label: "HUMAN FOOD" },
    };
    const b = base[kind];
    const f: FoodSource = {
      id: this.uid("food"),
      kind,
      position: this.ground(p),
      amount,
      maxAmount: amount,
      regrowRate: b.regrow,
      nutrition: b.nutrition,
      visibility: b.visibility,
      hidden: kind === "cache",
      toxic: false,
      createdBySubject: false,
      label: b.label,
      ...opts,
    };
    this.state.foodSources.push(f);
    this.state.foodVersion++;
    return f;
  }

  private spacingOk(grid: Map<number, WorldObject[]>, x: number, z: number, spacing: number) {
    const gx = Math.floor(x / 8);
    const gz = Math.floor(z / 8);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = grid.get((gx + dx) * 1000 + gz + dz);
        if (!list) continue;
        for (const o of list) if (Math.hypot(o.position.x - x, o.position.z - z) < spacing + o.radius * 0.5) return false;
      }
    }
    return true;
  }

  private addToGrid(grid: Map<number, WorldObject[]>, o: WorldObject) {
    const key = Math.floor(o.position.x / 8) * 1000 + Math.floor(o.position.z / 8);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(o);
  }

  private generate() {
    const site = this.terrain.site;
    const veg = mulberry32(SITE_VEGETATION_SEED);
    const rng = this.rng;
    const s = this.state;
    const placed = new Map<number, WorldObject[]>();

    const place = (kind: ObjectKind, x: number, z: number, spacing: number, r: RNG, extra: Partial<WorldObject> = {}) => {
      if (!this.inBounds(x, z)) return null;
      if (site.isBlocked(x, z) || site.distToWater(x, z) < 1.5) return null;
      if (site.distToPath(x, z) < (kind === "bench" || kind === "lamp" ? 0.6 : 1.9)) return null;
      if (!this.spacingOk(placed, x, z, spacing)) return null;
      const o = this.addObject(kind, { x, z }, r, extra);
      this.addToGrid(placed, o);
      return o;
    };

    // ── benches and lamps along the real path network (Central Park furniture)
    for (const path of site.raw.paths) {
      if (path.bridge || !(path.kind === "footway" || path.kind === "path" || path.kind === "pedestrian")) continue;
      let acc = veg() * 30;
      for (let i = 0; i < path.pts.length - 1; i++) {
        const [ax, az] = path.pts[i];
        const [bx, bz] = path.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const dirx = (bx - ax) / (len || 1);
        const dirz = (bz - az) / (len || 1);
        let t = 0;
        while (acc + (len - t) > 34) {
          t += 34 - acc;
          acc = 0;
          const side = veg() < 0.5 ? -1 : 1;
          const px = ax + dirx * t - dirz * side * 1.6;
          const pz = az + dirz * t + dirx * side * 1.6;
          const kind: ObjectKind = veg() < 0.55 ? "bench" : "lamp";
          const o = place(kind, px, pz, 3, veg, { rotation: Math.atan2(dirx, dirz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2) });
          if (o?.kind === "bench") this.benches.push(o);
        }
        acc += len - t;
      }
    }

    // ── trees: dense in real woodland polygons, scattered on lawns
    for (let z = -WORLD_HALF + 3; z < WORLD_HALF - 3; z += 3.2) {
      for (let x = -WORLD_HALF + 3; x < WORLD_HALF - 3; x += 3.2) {
        const jx = x + (veg() - 0.5) * 3;
        const jz = z + (veg() - 0.5) * 3;
        const land = site.landAt(jx, jz);
        let chance = 0;
        let spacing = 6;
        if (land === LAND.WOOD) {
          chance = 0.34;
          spacing = 6.3;
        } else if (land === LAND.LAWN) {
          chance = 0.05;
          spacing = 13;
        } else if (land === LAND.SCRUB) {
          chance = 0.12;
          spacing = 8;
        } else if (land === LAND.ROCK) {
          chance = 0.03;
          spacing = 9;
        }
        if (veg() > chance) continue;
        const r = veg();
        const kind: ObjectKind = land === LAND.WOOD ? (r < 0.52 ? "oak" : r < 0.84 ? "birch" : "pine") : r < 0.7 ? "oak" : "birch";
        const scale = kind === "oak" ? range(veg, 0.8, 1.25) : range(veg, 0.75, 1.15);
        const o = place(kind, jx, jz, spacing, veg, { scale });
        // individual oaks vary widely: many produce little in a given year, some produce heavily
        if (o?.kind === "oak") o.crop = rng() < 0.45 ? Math.round(range(rng, 12, 45) * this.masting * (0.4 + scale * 0.6)) : Math.round(range(rng, 0, 4));
      }
    }

    // ── understory, outcrops, deadwood
    for (let z = -WORLD_HALF + 2; z < WORLD_HALF - 2; z += 4.5) {
      for (let x = -WORLD_HALF + 2; x < WORLD_HALF - 2; x += 4.5) {
        const jx = x + (veg() - 0.5) * 4;
        const jz = z + (veg() - 0.5) * 4;
        const land = site.landAt(jx, jz);
        const r = veg();
        if (land === LAND.ROCK) {
          if (r < 0.45) place("rock", jx, jz, 1.4, veg, { scale: range(veg, 0.8, 2.4) });
        } else if (land === LAND.WOOD) {
          if (r < 0.15) place("bush", jx, jz, 2.2, veg, { scale: range(veg, 0.6, 1.25) });
          else if (r < 0.175) place("rock", jx, jz, 2, veg, { scale: range(veg, 0.5, 1.6) });
          else if (r < 0.19) place("log", jx, jz, 4, veg, { scale: range(veg, 0.8, 1.3), length: range(veg, 3, 8) });
          else if (r < 0.197) place("stump", jx, jz, 3, veg, { scale: range(veg, 0.7, 1.1) });
          else if (r < 0.205) {
            const c = place("mushroom", jx, jz, 1, veg, { variant: veg() < 0.35 ? 0 : 1 });
            if (c) for (let k = 0; k < 3; k++) this.addObject("mushroom", { x: jx + (veg() - 0.5), z: jz + (veg() - 0.5) }, veg, { variant: c.variant });
          }
        } else if (land === LAND.SCRUB) {
          if (r < 0.3) place("bush", jx, jz, 2, veg, { scale: range(veg, 0.7, 1.3) });
        } else if (land === LAND.LAWN && site.distToWater(jx, jz) < 6 && r < 0.12) {
          place("bush", jx, jz, 2.5, veg, { scale: range(veg, 0.7, 1.2) });
        }
      }
    }
    const bushes = s.objects.filter((o) => o.kind === "bush");
    bushes.forEach((b, i) => {
      if (i % 11 === 0) b.variant = 1; // fruiting shrubs
    });

    // ── real named places
    for (const nm of site.raw.names) {
      if (!this.inBounds(nm.x, nm.z, 6)) continue;
      const kind: Landmark["kind"] = nm.kind === "water" ? "water" : nm.kind === "bare_rock" ? "rock" : nm.kind === "attraction" ? "bridge" : nm.kind === "museum" ? "building" : "clearing";
      const pos = site.isBlocked(nm.x, nm.z) && kind !== "water" && kind !== "bridge" && kind !== "building" ? this.nearestLand(nm.x, nm.z) : { x: nm.x, z: nm.z };
      this.addLandmark(nm.name.toUpperCase(), kind, pos, kind === "water" ? 14 : 8);
    }
    for (const b of site.raw.buildings) {
      if (!b.name) continue;
      let cx = 0;
      let cz = 0;
      for (const p of b.poly) {
        cx += p[0];
        cz += p[1];
      }
      cx /= b.poly.length;
      cz /= b.poly.length;
      if (this.inBounds(cx, cz, 6) && !s.landmarks.some((l) => l.name === b.name!.toUpperCase())) this.addLandmark(b.name.toUpperCase(), "building", { x: cx, z: cz }, 10);
    }
    for (const body of site.waterBodies) {
      if (body.kind === "stream") continue;
      s.waterSources.push({
        id: body.id,
        kind: body.kind,
        name: body.name,
        position: { x: body.center.x, y: body.level, z: body.center.z },
        radius: Math.sqrt(body.area / Math.PI),
        amount: 1,
      });
    }
    const gill = site.waterBodies.filter((b) => b.kind === "stream");
    if (gill.length) {
      const g = gill[0];
      s.waterSources.push({ id: g.id, kind: "stream", name: "THE GILL", position: { x: g.center.x, y: g.level, z: g.center.z }, radius: 2, amount: 1 });
    }

    // ── nest: a real census sighting location in woodland, near an oak
    const woodSightings = CENSUS.sightings.filter(
      (c) => site.landAt(c.x, c.z) === LAND.WOOD && site.distToWater(c.x, c.z) > 12 && Math.abs(c.x) < 150 && Math.abs(c.z) < 150
    );
    const pool = woodSightings.length ? woodSightings : CENSUS.sightings;
    const origin = pool[Math.floor(rng() * pool.length)] ?? { x: 0, z: 0, id: "none" };
    let nest = s.objects
      .filter((o) => o.kind === "oak" && !o.fallen)
      .sort((a, b) => Math.hypot(a.position.x - origin.x, a.position.z - origin.z) - Math.hypot(b.position.x - origin.x, b.position.z - origin.z))[0];
    if (!nest || Math.hypot(nest.position.x - origin.x, nest.position.z - origin.z) > 14) {
      nest = this.addObject("oak", this.nearestLand(origin.x, origin.z), rng, { scale: 1.3 });
      this.addToGrid(placed, nest);
    }
    nest.scale = Math.max(nest.scale, 1.2);
    nest.radius = 0.62 * nest.scale;
    nest.crop = Math.max(nest.crop ?? 0, 30);
    this.addLandmark("NEST OAK", "tree", nest.position, 5, nest, false);
    s.home = { ...nest.position };
    this.nestCensusId = (origin as { id?: string }).id ?? "";

    // ── acorn crops on oaks and fruit on shrubs (amounts grow through the drop season)
    for (const o of s.objects) {
      if (o.kind === "oak" && (o.crop ?? 0) > 0) {
        const a = rng() * Math.PI * 2;
        this.addFood("acorn", { x: o.position.x + Math.cos(a) * 1.8, z: o.position.z + Math.sin(a) * 1.8 }, 0, {
          objectId: o.id,
          maxAmount: 30,
        });
      }
      if (o.kind === "bush" && o.variant === 1) {
        this.addFood("berry", { x: o.position.x, z: o.position.z + o.radius + 0.3 }, Math.floor(range(rng, 3, 7)), { objectId: o.id, maxAmount: 8 });
      }
    }
    // caches left by the resident population (they did not start with this subject)
    const woods = s.objects.filter((o) => o.kind === "oak" || o.kind === "birch");
    for (let i = 0; i < 40; i++) {
      const t = woods[Math.floor(rng() * woods.length)];
      if (!t) break;
      const a = rng() * Math.PI * 2;
      const r = 2 + rng() * 6;
      const p = { x: t.position.x + Math.cos(a) * r, z: t.position.z + Math.sin(a) * r };
      if (site.isBlocked(p.x, p.z)) continue;
      this.addFood("cache", p, 1 + Math.floor(rng() * 2), { owner: "resident", label: "BURIED CACHE" });
    }

    // ── threats: dogs walked on real paths, and red-tailed hawks
    const longPaths = site.raw.paths
      .filter((p) => !p.bridge && (p.kind === "footway" || p.kind === "path") && p.pts.length > 4)
      .map((p) => ({ p, d: Math.min(...p.pts.map(([x, z]) => Math.hypot(x - s.home.x, z - s.home.z))) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 14)
      .map((e) => e.p);
    for (let i = 0; i < 3; i++) {
      const p = longPaths[Math.floor(rng() * longPaths.length)] ?? longPaths[0];
      const route = (p?.pts ?? [[0, 0], [20, 20]]).map(([x, z]) => this.ground({ x, z }));
      s.threats.push({
        id: `dog-${i + 1}`,
        kind: "dog",
        position: { ...route[0] },
        heading: 0,
        speed: 0,
        state: "absent",
        stateTimer: 0,
        territoryCenter: { ...route[Math.floor(route.length / 2)] },
        territoryRadius: 30,
        target: { ...route[0] },
        stamina: 4,
        cooldown: 0,
        active: false,
        gait: 0,
        routeIndex: 0,
        route,
      });
    }
    s.threats.push({
      id: "hawk-1",
      kind: "hawk",
      position: { x: 0, y: 60, z: 0 },
      heading: 0,
      speed: 0,
      state: "absent",
      stateTimer: DAY_LENGTH * range(rng, 0.6, 1.4),
      territoryCenter: { x: 0, y: 0, z: 0 },
      territoryRadius: 60,
      target: { x: 0, y: 0, z: 0 },
      stamina: 0,
      cooldown: 0,
      active: false,
      gait: 0,
    });

    s.paths = site.raw.paths.filter((p) => !p.bridge).map((p) => p.pts.map(([x, z]) => ({ x, y: 0, z })));
    this.buildGrids();
  }

  nestCensusId = "";

  private nearestLand(x: number, z: number) {
    const site = this.terrain.site;
    for (let r = 0; r < 40; r += 1.5) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
        const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (!site.isBlocked(px, pz) && this.inBounds(px, pz, 6)) return { x: px, z: pz };
      }
    }
    return { x: 0, z: 0 };
  }

  buildGrids() {
    this.obstacleGrid.clear();
    this.coverGrid.clear();
    this.objectGrid.clear();
    this.logs = [];
    for (const o of this.state.objects) {
      if (!o.fallen) {
        const key = Math.floor(o.position.x / CELL) * 1000 + Math.floor(o.position.z / CELL);
        if (!this.objectGrid.has(key)) this.objectGrid.set(key, []);
        this.objectGrid.get(key)!.push(o);
      }
      if (o.kind === "log") {
        this.logs.push(o);
        continue;
      }
      if (o.kind === "mushroom" || o.fallen) continue;
      const reach = o.cover ? this.coverRadius(o, true) : o.radius;
      const minX = Math.floor((o.position.x - reach) / CELL);
      const maxX = Math.floor((o.position.x + reach) / CELL);
      const minZ = Math.floor((o.position.z - reach) / CELL);
      const maxZ = Math.floor((o.position.z + reach) / CELL);
      for (let gx = minX; gx <= maxX; gx++) {
        for (let gz = minZ; gz <= maxZ; gz++) {
          const key = gx * 1000 + gz;
          if (o.kind !== "bush" && o.kind !== "lamp") {
            if (!this.obstacleGrid.has(key)) this.obstacleGrid.set(key, []);
            this.obstacleGrid.get(key)!.push(o);
          }
          if (o.cover) {
            if (!this.coverGrid.has(key)) this.coverGrid.set(key, []);
            this.coverGrid.get(key)!.push(o);
          }
        }
      }
    }
  }

  /** canopy radius; deciduous trees lose most cover once leaves fall */
  coverRadius(o: WorldObject, max = false) {
    const leaf = max ? 1 : o.deciduous ? 0.3 + 0.7 * this.state.env.leaf : 1;
    if (o.kind === "oak") return 5.5 * o.scale * leaf;
    if (o.kind === "pine") return 2.6 * o.scale;
    if (o.kind === "birch") return 3 * o.scale * leaf;
    if (o.kind === "bush") return (o.radius + 0.2) * (0.5 + 0.5 * leaf);
    return 0;
  }

  private objectGrid = new Map<number, WorldObject[]>();

  /** all standing objects within roughly `radius` metres (grid lookup) */
  objectsNear(x: number, z: number, radius: number): WorldObject[] {
    const out: WorldObject[] = [];
    const r = Math.ceil(radius / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = this.objectGrid.get((cx + dx) * 1000 + cz + dz);
        if (list) for (const o of list) out.push(o);
      }
    }
    return out;
  }

  obstaclesNear(x: number, z: number): WorldObject[] {
    return this.obstacleGrid.get(Math.floor(x / CELL) * 1000 + Math.floor(z / CELL)) ?? [];
  }

  /** 0 = open sky, 1 = dense canopy */
  coverAt(x: number, z: number) {
    const list = this.coverGrid.get(Math.floor(x / CELL) * 1000 + Math.floor(z / CELL));
    if (!list) return 0;
    let best = 0;
    for (const o of list) {
      const r = this.coverRadius(o);
      if (r <= 0) continue;
      const d = Math.hypot(o.position.x - x, o.position.z - z);
      if (d < r) best = Math.max(best, o.kind === "bush" ? 1 : smoothstep(r, r * 0.4, d) * (o.deciduous ? 0.35 + 0.65 * this.state.env.leaf : 1));
    }
    return best;
  }

  nearestCover(p: Vector3, maxDist: number, climbableOnly = false): WorldObject | null {
    let best: WorldObject | null = null;
    let bd = maxDist;
    const r = Math.ceil(maxDist / CELL);
    const cx = Math.floor(p.x / CELL);
    const cz = Math.floor(p.z / CELL);
    const seen = new Set<string>();
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = this.coverGrid.get((cx + dx) * 1000 + cz + dz);
        if (!list) continue;
        for (const o of list) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          if (climbableOnly && !o.climbable) continue;
          const d = dist2D(o.position, p);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
      }
    }
    return best;
  }

  /** ground height including walkable logs and bridge decks */
  surfaceHeight(x: number, z: number) {
    const site = this.terrain.site;
    let h = this.terrain.height(x, z);
    if (site.onBridge(x, z)) h = Math.max(h, site.waterLevelAt(x, z) + 1.4);
    for (const l of this.logs) {
      if (Math.abs(l.position.x - x) > 8 || Math.abs(l.position.z - z) > 8) continue;
      const len = (l.length ?? 5) * 0.5;
      const ax = l.position.x + Math.sin(l.rotation) * len;
      const az = l.position.z + Math.cos(l.rotation) * len;
      const bx = l.position.x - Math.sin(l.rotation) * len;
      const bz = l.position.z - Math.cos(l.rotation) * len;
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2);
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      const r = l.radius * 1.15;
      if (d < r) h = Math.max(h, l.position.y + r * 0.7 + Math.sqrt(Math.max(0, r * r - d * d)));
    }
    return h;
  }

  // ───────────────────────────── time & environment ─────────────────────────────

  get utc() {
    return simToUTC(this.state.time);
  }

  get hourFloat() {
    return this.local.hourFloat;
  }

  /** experiment day number (1-based) */
  get day() {
    return Math.floor(this.state.time / DAY_LENGTH) + 1;
  }

  get daylight() {
    return this.state.env.daylight;
  }

  get isNight() {
    return this.state.env.sunElevation < -4;
  }

  get visibility() {
    const s = this.state;
    const moon = s.env.moonElevation > 0 ? s.env.moonIllumination * 0.15 : 0;
    return clamp((0.3 + moon + 0.7 * this.daylight) * (1 - s.fogAmount * 0.55) * (1 - s.rainAmount * 0.2) * (1 - s.snowAmount * 0.25), 0.2, 1);
  }

  /** re-derive the calendar after loading a saved state */
  syncClock() {
    this.updateEnvironment(true);
    this.lastLocalDay = this.local.dayOfYear;
    this.lastHour = Math.floor(this.local.hourFloat);
  }

  private updateEnvironment(force = false) {
    const s = this.state;
    const utc = this.utc;
    this.local = localTime(utc);
    const w = weatherAt(utc);
    const sun = sunPosition(utc, SITE.centerLat, SITE.centerLon);
    const moon = moonPosition(utc, SITE.centerLat, SITE.centerLon);
    const canopy = canopyState(this.local);
    const hour = this.local.hourFloat;
    const daytime = smoothstep(8, 10, hour) * (1 - smoothstep(17, 20, hour));
    const weekend = isWeekend(this.local) ? 1.6 : 1;
    const comfort = (0.35 + 0.65 * clamp((w.tempC + 2) / 16)) * (1 - clamp(w.precipMm / 1.5) * 0.8);
    const e = s.env;
    e.utc = utc;
    e.tempC = w.tempC;
    e.precipMm = w.precipMm;
    e.snowDepthM = w.snowDepthM;
    e.windKmh = w.windKmh;
    e.gustKmh = w.gustKmh;
    e.cloud = w.cloud;
    e.humidity = w.humidity;
    e.sunElevation = sun.elevation;
    e.sunAzimuth = sun.azimuth;
    e.moonElevation = moon.elevation;
    e.moonAzimuth = moon.azimuth;
    e.moonIllumination = moon.illumination;
    e.daylight = smoothstep(-6, 6, sun.elevation);
    e.leaf = canopy.leaf;
    e.leafColour = canopy.colour;
    e.visitors = clamp(daytime * weekend * (0.25 + 0.75 * comfort));

    const snowing = w.snowfallCm > 0.05;
    const raining = !snowing && w.precipMm > 0.15;
    let weather: Weather = "clear";
    if (w.gustKmh > 55 && (raining || snowing)) weather = "storm";
    else if (snowing) weather = "snow";
    else if (raining) weather = "rain";
    else if (w.humidity > 94 && w.windKmh < 10) weather = "fog";
    else if (w.cloud > 70) weather = "cloudy";
    if (weather !== s.weather && !force) {
      if (weather === "snow" || weather === "storm" || (weather === "rain" && s.weather !== "storm")) {
        this.notices.push({ text: `weather: ${weather} (${w.tempC.toFixed(1)} °C, gusts ${Math.round(w.gustKmh)} km/h)`, kind: weather === "snow" ? "snow" : weather === "storm" ? "storm" : "weather" });
      }
    }
    s.weather = weather;
    const k = force ? 1 : 0.15;
    s.rainAmount += ((raining || weather === "storm" ? clamp(w.precipMm / 2.5, 0.25, 1) : 0) - s.rainAmount) * k;
    s.snowAmount += ((snowing ? clamp(w.snowfallCm / 0.6, 0.3, 1) : 0) - s.snowAmount) * k;
    const mist = (1 - e.daylight) * 0.12 + (w.humidity > 90 ? (w.humidity - 90) / 10 : 0) * 0.5;
    s.fogAmount += ((weather === "fog" ? 0.85 : clamp(w.cloud / 100) * 0.18 + mist + s.rainAmount * 0.25 + s.snowAmount * 0.35) - s.fogAmount) * k;
    s.floodRise += (clamp(precipitationWindow(utc, 48) / 60) * 0.35 - s.floodRise) * k * 0.2;
  }

  // ───────────────────────────── update ─────────────────────────────

  update(dt: number, subjects: (SubjectView & { id: string })[]): ThreatContact[] {
    const s = this.state;
    s.time += dt;
    this.envTimer += dt;
    // environment every simulated minute
    if (this.envTimer >= DAY_LENGTH / 1440) {
      this.envTimer = 0;
      this.updateEnvironment();
      const hour = Math.floor(this.local.hourFloat);
      if (hour !== this.lastHour) {
        this.lastHour = hour;
        this.onHour();
      }
      if (this.local.dayOfYear !== this.lastLocalDay) {
        this.lastLocalDay = this.local.dayOfYear;
        this.onNewDay();
      }
    }
    this.updateFood(dt);
    const contacts: ThreatContact[] = [];
    for (const t of s.threats) {
      const c = t.kind === "dog" ? this.updateDog(t, dt, subjects) : this.updateHawk(t, dt, subjects);
      if (c) contacts.push(c);
    }
    return contacts;
  }

  private onHour() {
    const s = this.state;
    const rng = this.rng;
    const e = s.env;
    // visitors drop food near benches
    // Central Park visitors routinely hand out peanuts and bread, especially in cold months
    const winterBoost = this.local.dayOfYear > 320 || this.local.dayOfYear < 80 ? 1.6 : 1;
    const drops = e.visitors * this.benches.length * 0.05 * winterBoost;
    const dropCount = Math.floor(drops) + (rng() < drops % 1 ? 1 : 0);
    for (let i = 0; i < dropCount; i++) {
      const b = this.benches[Math.floor(rng() * this.benches.length)];
      if (!b) break;
      this.addFood("scraps", { x: b.position.x + (rng() - 0.5) * 3, z: b.position.z + (rng() - 0.5) * 3 }, 1 + Math.floor(rng() * 2), {
        expires: s.time + DAY_LENGTH * range(rng, 0.15, 0.35),
        label: rng() < 0.5 ? "PEANUTS (VISITOR)" : "BREAD (VISITOR)",
      });
    }
    // fungi fruit after soaking rain in mild weather
    if (precipitationWindow(e.utc, 48) > 8 && e.tempC > 5 && e.tempC < 24 && rng() < 0.25) {
      const woods = s.objects.filter((o) => o.kind === "log" || o.kind === "stump");
      const o = woods[Math.floor(rng() * woods.length)];
      if (o) {
        const toxic = rng() < 0.35;
        this.addFood("mushroom", { x: o.position.x + 1, z: o.position.z + 0.5 }, 2 + Math.floor(rng() * 3), {
          toxic,
          label: toxic ? "FUNGI (RED CAP)" : "FUNGI (BROWN CAP)",
          nutrition: toxic ? 0.02 : 0.06,
          expires: s.time + DAY_LENGTH * 4,
          objectId: o.id,
        });
      }
    }
    // puddles from real rainfall
    if (e.precipMm > 1 && s.waterSources.filter((w) => w.kind === "puddle").length < 8) {
      for (let k = 0; k < 20; k++) {
        const p = { x: range(rng, -180, 180), z: range(rng, -180, 180) };
        if (this.terrain.site.isBlocked(p.x, p.z) || this.terrain.site.distToPath(p.x, p.z) > 1.5) continue;
        s.waterSources.push({ id: this.uid("puddle"), kind: "puddle", name: "PUDDLE", position: this.ground(p), radius: range(rng, 0.6, 1.4), amount: 0.4 });
        s.foodVersion++;
        break;
      }
    }
    for (const w of s.waterSources) if (w.kind === "puddle") w.amount = clamp(w.amount + (e.precipMm > 0.3 ? 0.2 : -0.08 - Math.max(0, e.tempC) * 0.004));
    const before = s.waterSources.length;
    s.waterSources = s.waterSources.filter((w) => w.kind !== "puddle" || w.amount > 0.02);
    if (before !== s.waterSources.length) s.foodVersion++;

    // storms: strong real gusts can bring down a tree
    if (e.gustKmh > 62 && rng() < (e.gustKmh - 55) / 120) {
      const candidates = s.objects.filter((o) => (o.kind === "oak" || o.kind === "birch" || o.kind === "pine") && !o.fallen && !o.landmarkId);
      const tree = candidates[Math.floor(rng() * candidates.length)];
      if (tree) this.fellTree(tree);
    }
  }

  fellTree(tree: WorldObject) {
    const s = this.state;
    tree.fallen = true;
    const len = tree.height * 0.6;
    const dir = (s.env.windKmh > 0 ? 1 : 0) * this.rng() * Math.PI * 2;
    const cx = tree.position.x + Math.sin(dir) * len * 0.5;
    const cz = tree.position.z + Math.cos(dir) * len * 0.5;
    if (!this.terrain.site.isBlocked(cx, cz)) {
      this.addObject("log", { x: cx, z: cz }, this.rng, { rotation: dir, scale: Math.min(2.2, tree.scale * 1.6), length: len });
    }
    // its acorn crop is lost
    for (const f of s.foodSources) if (f.objectId === tree.id) f.amount = 0;
    s.structureVersion++;
    s.foodVersion++;
    this.buildGrids();
    this.notices.push({ text: `storm felled a ${tree.kind} (gusts ${Math.round(s.env.gustKmh)} km/h)`, kind: "storm", location: { ...tree.position } });
  }

  private onNewDay() {
    const s = this.state;
    const rng = this.rng;
    const doy = this.local.dayOfYear;
    // acorn drop season (approx. mid-September to mid-November, peaking mid-October)
    const drop = Math.exp(-(((doy - 288) / 16) ** 2)) * (doy > 250 && doy < 335 ? 1 : 0);
    // the resident population scatter-hoards the real acorn crop through autumn into a buried-nut
    // density field (tens of thousands of nuts across the site, as in a real park woodland)
    if (doy >= 255 && doy <= 345 && drop > 0.02) {
      for (const o of s.objects) {
        if (o.kind !== "oak" || o.fallen || !o.crop) continue;
        const nuts = o.crop * drop * 0.5;
        for (let k = 0; k < 4; k++) {
          const a = rng() * Math.PI * 2;
          const r = 3 + rng() * 32;
          const x = o.position.x + Math.cos(a) * r;
          const z = o.position.z + Math.sin(a) * r;
          if (this.terrain.site.isBlocked(x, z) || this.terrain.site.distToPath(x, z) < 1) continue;
          this.buried[cellOf(x, z)] += nuts / 4;
        }
      }
    }
    // recovery by the population, rot and germination
    const keep = doy > 345 || doy < 90 ? 0.99 : doy >= 90 && doy < 250 ? 0.95 : 0.997;
    for (let i = 0; i < this.buried.length; i++) this.buried[i] *= keep;
    for (const f of s.foodSources) {
      if (f.kind === "acorn") {
        const oak = s.objects.find((o) => o.id === f.objectId);
        if (oak && !oak.fallen) f.amount = Math.min(f.maxAmount, f.amount + (oak.crop ?? 0) * drop * 0.06);
        // removal by jays, mice, deer, the wider squirrel population, decay and germination
        f.amount *= doy > 335 || doy < 60 ? 0.85 : 0.9;
      } else if (f.kind === "berry") {
        f.amount = doy > 320 || doy < 200 ? f.amount * 0.8 : f.amount;
      } else if (f.kind === "cache" && f.owner === "resident" && rng() < 0.02) {
        f.amount = Math.max(0, f.amount - 1);
      }
    }
    // late winter buds and spring samaras
    if ((doy >= 15 && doy <= 115 || doy >= 350) && rng() < 0.7) {
      const trees = s.objects.filter((o) => (o.kind === "oak" || o.kind === "birch") && !o.fallen);
      for (let i = 0; i < 4; i++) {
        const t = trees[Math.floor(rng() * trees.length)];
        if (t && !s.foodSources.some((f) => f.objectId === t.id && f.kind === "buds")) {
          this.addFood("buds", { x: t.position.x + 0.9, z: t.position.z }, 4, { objectId: t.id, maxAmount: 6, expires: s.time + DAY_LENGTH * 20 });
        }
      }
    }
    if (doy >= 110 && doy <= 150 && rng() < 0.5) {
      const trees = s.objects.filter((o) => o.kind === "birch" && !o.fallen);
      const t = trees[Math.floor(rng() * trees.length)];
      if (t) this.addFood("seeds", { x: t.position.x + 1.5, z: t.position.z - 1 }, 6, { objectId: t.id, expires: s.time + DAY_LENGTH * 10 });
    }
    if (drop > 0.5 && rng() < 0.3) this.notices.push({ text: "acorn drop near peak across the woodland", kind: "food" });
    s.foodVersion++;
  }

  private updateFood(dt: number) {
    const s = this.state;
    let removed = false;
    for (const f of s.foodSources) {
      if (f.regrowRate > 0 && f.amount < f.maxAmount) f.amount = Math.min(f.maxAmount, f.amount + (f.regrowRate * dt) / DAY_LENGTH);
      if (f.expires !== undefined && s.time > f.expires) {
        f.amount = 0;
        removed = true;
      }
    }
    if (removed) {
      s.foodSources = s.foodSources.filter((f) => f.expires === undefined || s.time <= f.expires);
      s.foodVersion++;
    }
  }

  /** food visible on the surface is hidden under snow (caches are found by smell) */
  snowHides(f: FoodSource) {
    return this.state.env.snowDepthM > 0.03 && f.kind !== "cache" && f.kind !== "scraps" && f.kind !== "buds";
  }

  consumeFood(id: string, units = 1) {
    const f = this.state.foodSources.find((x) => x.id === id);
    if (!f || f.amount < 1) return null;
    f.amount -= units;
    this.state.foodVersion++;
    return f;
  }

  rngState() {
    return this.rng.getState();
  }

  setRngState(v: number) {
    this.rng.setState(v);
  }

  /** buried nuts per 4 × 4 m cell (population scatter-hoard) */
  buriedAt(x: number, z: number) {
    return this.buried[cellOf(x, z)];
  }

  /**
   * Olfactory search of the woodland floor: squirrels locate buried nuts by smell. The chance of a find
   * rises with local cache density; snow cover makes digging slower. A find becomes a real food item.
   */
  sniffBuried(x: number, z: number, dt: number, efficiency = 1): FoodSource | null {
    const k = cellOf(x, z);
    const density = this.buried[k];
    if (density < 0.2) return null;
    const snow = this.state.env.snowDepthM > 0.03 ? 0.6 : 1;
    const p = 1 - Math.exp(-density * 0.02 * dt * efficiency * snow);
    if (this.rng() >= p) return null;
    this.buried[k] = Math.max(0, density - 1);
    const a = this.rng() * Math.PI * 2;
    const f = this.addFood("cache", { x: x + Math.cos(a) * 0.5, z: z + Math.sin(a) * 0.5 }, 1, {
      owner: "population",
      label: "BURIED NUT",
      visibility: 0.35,
      nutrition: 0.16,
      expires: this.state.time + 90,
    });
    return f;
  }

  buryCache(p: Vector3, owner: string): FoodSource {
    const existing = this.state.foodSources.find((f) => f.kind === "cache" && f.owner === owner && dist2D(f.position, p) < 1.2);
    this.state.foodVersion++;
    if (existing) {
      existing.amount += 1;
      existing.maxAmount = Math.max(existing.maxAmount, existing.amount);
      return existing;
    }
    return this.addFood("cache", p, 1, {
      createdBySubject: owner === "subject",
      owner,
      label: owner === "subject" ? "SUBJECT CACHE" : "RIVAL CACHE",
      visibility: 0.25,
      nutrition: 0.16,
    });
  }

  // ───────────────────────────── predators ─────────────────────────────

  private moveThreat(t: Threat, target: Vector3, speed: number, dt: number) {
    const dx = target.x - t.position.x;
    const dz = target.z - t.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      t.speed = 0;
      return d;
    }
    const desired = Math.atan2(dx, dz);
    t.heading += clamp(wrapAngle(desired - t.heading), -dt * 4, dt * 4);
    const step = Math.min(d, speed * dt);
    let nx = t.position.x + Math.sin(t.heading) * step;
    let nz = t.position.z + Math.cos(t.heading) * step;
    for (const o of this.obstaclesNear(nx, nz)) {
      const od = Math.hypot(nx - o.position.x, nz - o.position.z);
      const r = o.radius + 0.45;
      if (od < r && od > 0.001) {
        nx = o.position.x + ((nx - o.position.x) / od) * r;
        nz = o.position.z + ((nz - o.position.z) / od) * r;
      }
    }
    if (this.terrain.isBlocked(nx, nz)) {
      nx = t.position.x;
      nz = t.position.z;
      t.heading += 1.2;
    }
    t.position.x = clamp(nx, -WORLD_HALF + 2, WORLD_HALF - 2);
    t.position.z = clamp(nz, -WORLD_HALF + 2, WORLD_HALF - 2);
    t.position.y = this.surfaceHeight(t.position.x, t.position.z);
    t.speed = step / dt;
    t.gait += t.speed * dt * 1.4;
    return d;
  }

  private nearestSubject(t: Threat, subjects: (SubjectView & { id: string })[], groundOnly: boolean) {
    let best: (SubjectView & { id: string }) | null = null;
    let bd = Infinity;
    for (const s of subjects) {
      if (groundOnly && s.climbHeight > 0.4) continue;
      const d = dist2D(t.position, s.position);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return { subject: best, distance: bd };
  }

  /** off-leash dog walked along a real path in early morning and evening */
  private updateDog(t: Threat, dt: number, subjects: (SubjectView & { id: string })[]): ThreatContact | null {
    const hour = this.local.hourFloat;
    const walkHours = (hour > 6.2 && hour < 9) || (hour > 19 && hour < 22.5);
    const route = t.route ?? [];
    if (t.state === "absent") {
      t.active = false;
      if (walkHours && route.length > 1 && this.rng() < dt * 0.02) {
        t.active = true;
        t.state = "patrol";
        t.routeIndex = 0;
        t.position = { ...route[0] };
      }
      return null;
    }
    const { subject, distance } = this.nearestSubject(t, subjects, true);
    switch (t.state) {
      case "patrol": {
        const target = route[t.routeIndex ?? 0];
        if (!target) {
          t.state = "absent";
          break;
        }
        const d = this.moveThreat(t, target, 1.5, dt);
        if (d < 1.2) {
          t.routeIndex = (t.routeIndex ?? 0) + 1;
          if ((t.routeIndex ?? 0) >= route.length) {
            t.state = "absent";
            t.active = false;
          }
        }
        if (subject && distance < 16) {
          t.state = "chase";
          t.stamina = 3.8;
          t.target = { ...subject.position };
        }
        break;
      }
      case "chase": {
        if (!subject) {
          t.state = "retreat";
          t.cooldown = 10;
          break;
        }
        this.moveThreat(t, subject.position, 7, dt);
        t.stamina -= dt;
        if (distance < 0.8) {
          t.state = "retreat";
          t.cooldown = 30;
          return { threatId: t.id, kind: "dog", targetId: subject.id };
        }
        if (t.stamina <= 0 || distance > 25) {
          t.state = "retreat";
          t.cooldown = 12;
        }
        break;
      }
      case "retreat": {
        t.cooldown -= dt;
        const target = route[t.routeIndex ?? 0] ?? route[0];
        if (target) this.moveThreat(t, target, 2.4, dt);
        if (t.cooldown <= 0) t.state = "patrol";
        break;
      }
      default:
        t.state = "patrol";
    }
    return null;
  }

  /** red-tailed hawk: soars in daylight, stoops on squirrels in the open */
  private updateHawk(t: Threat, dt: number, subjects: (SubjectView & { id: string })[]): ThreatContact | null {
    const rng = this.rng;
    const exposed = (s: SubjectView) => s.climbHeight < 0.4 && !s.underCover && this.coverAt(s.position.x, s.position.z) < 0.4;
    switch (t.state) {
      case "absent": {
        t.active = false;
        t.stateTimer -= dt;
        if (t.stateTimer <= 0) {
          if (this.daylight > 0.6 && this.state.rainAmount < 0.3 && this.state.env.windKmh < 45) {
            const anchor = (rng() < 0.55 ? subjects[0] : subjects[Math.floor(rng() * subjects.length)])?.position ?? { x: 0, y: 0, z: 0 };
            t.state = "circle";
            t.active = true;
            t.stateTimer = range(rng, 60, 110);
            t.territoryCenter = this.ground({ x: anchor.x + range(rng, -30, 30), z: anchor.z + range(rng, -30, 30) });
            t.heading = rng() * 6.28;
            t.position = { x: t.territoryCenter.x, y: t.territoryCenter.y + 60, z: t.territoryCenter.z };
            this.notices.push({ text: "red-tailed hawk soaring over the site", kind: "threat" });
          } else t.stateTimer = DAY_LENGTH * 0.08;
        }
        break;
      }
      case "circle": {
        t.stateTimer -= dt;
        const c = t.territoryCenter;
        const { subject } = this.nearestSubject(t, subjects, false);
        if (subject) {
          const toward = dist2D(c, subject.position);
          if (toward > 2) {
            c.x += ((subject.position.x - c.x) / toward) * dt * 0.8;
            c.z += ((subject.position.z - c.z) / toward) * dt * 0.8;
          }
        }
        t.heading += dt * 0.3;
        const radius = 18;
        const k = Math.min(1, dt * 1.1);
        t.position.x += (c.x + Math.sin(t.heading) * radius - t.position.x) * k;
        t.position.z += (c.z + Math.cos(t.heading) * radius - t.position.z) * k;
        t.position.y += (this.terrain.height(c.x, c.z) + 26 + Math.sin(t.heading * 2) * 2 - t.position.y) * k * 0.6;
        t.speed = radius * 0.3;
        t.gait += dt * 1.5;
        t.cooldown = Math.max(0, t.cooldown - dt);
        for (const s of subjects) {
          if (exposed(s) && dist2D(t.position, s.position) < 20 && t.cooldown <= 0) {
            t.state = "dive";
            t.target = { ...s.position };
            t.stamina = 3.2;
            break;
          }
        }
        if (t.stateTimer <= 0) {
          t.state = "absent";
          t.active = false;
          // leaf-off winter canopy makes the site more attractive to hunt
          t.stateTimer = DAY_LENGTH * range(rng, 0.5, 1.4) * (0.6 + this.state.env.leaf * 0.6);
        }
        break;
      }
      case "dive": {
        t.stamina -= dt;
        const { subject } = this.nearestSubject(t, subjects, false);
        const target = subject?.position ?? t.target;
        const dx = target.x - t.position.x;
        const dy = target.y + 0.3 - t.position.y;
        const dz = target.z - t.position.z;
        const dd = Math.hypot(dx, dy, dz);
        const sp = 15 * dt;
        t.heading = Math.atan2(dx, dz);
        if (dd > sp) {
          t.position.x += (dx / dd) * sp;
          t.position.y += (dy / dd) * sp;
          t.position.z += (dz / dd) * sp;
        }
        t.speed = 15;
        const isExposed = subject ? exposed(subject) : false;
        if (dd < 1.4 || t.stamina <= 0) {
          t.state = "circle";
          t.cooldown = 25;
          t.stateTimer = Math.min(t.stateTimer, 25);
          if (dd < 1.4 && isExposed && subject) return { threatId: t.id, kind: "hawk", targetId: subject.id };
        } else if (!isExposed && dd < 8) {
          t.state = "circle";
          t.cooldown = 15;
        }
        break;
      }
      default:
        t.state = "absent";
    }
    return null;
  }
}
