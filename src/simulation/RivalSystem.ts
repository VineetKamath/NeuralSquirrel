import type { AnimationState, FoodSource, Vector3 } from "@/types";
import { angleTo, clamp, dampAngle, dist2D } from "@/utils/math";
import { range, type RNG } from "@/utils/rng";
import { activityCentres, sampleFur } from "@/real/census";
import { DAY_LENGTH, SPEED, WORLD_HALF } from "./constants";
import type { WorldModel } from "./WorldModel";

export type RivalMode = "forage" | "eat" | "cache" | "retrieve" | "pilfer" | "rest" | "chase" | "flee" | "perch";

export interface Rival {
  id: string;
  name: string;
  fur: "Gray" | "Cinnamon" | "Black";
  position: Vector3;
  home: { x: number; z: number };
  homeTreeId: string;
  anim: AnimationState;
  mode: RivalMode;
  target: Vector3 | null;
  targetId?: string;
  timer: number;
  hunger: number;
  boldness: number;
  carrying: boolean;
  caching: boolean;
  alive: boolean;
  /** cache locations this squirrel saw others make (observational spatial memory) */
  observed: { id: string; x: number; z: number; t: number }[];
  ownCaches: string[];
  censusMembers: number;
  stats: { eaten: number; cached: number; pilfered: number; chases: number };
}

export interface SubjectInfo {
  id: string;
  position: Vector3;
  climbHeight: number;
  caching: boolean;
  nearFood: boolean;
}

export interface RivalInteraction {
  kind: "chase-subject" | "pilfer" | "observed-subject-caching";
  rivalId: string;
  foodId?: string;
  position: Vector3;
}

/**
 * Resident gray squirrels. Their activity centres are k-means clusters of the
 * real 2018 census sightings inside the site. They forage, scatter-hoard,
 * pilfer caches they have seen being made, chase conspecifics and rest in dreys.
 */
export class RivalSystem {
  rivals: Rival[] = [];
  interactions: RivalInteraction[] = [];

  constructor(private world: WorldModel, private rng: RNG, count = 6) {
    // census activity centres; the residents nearest the subject's nest are its neighbours
    const home = world.state.home;
    const centres = activityCentres(count + 6, rng)
      .sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))
      .slice(0, count);
    const names = ["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08"];
    centres.forEach((c, i) => {
      const tree = world.state.objects
        .filter((o) => o.climbable && !o.fallen)
        .sort((a, b) => Math.hypot(a.position.x - c.x, a.position.z - c.z) - Math.hypot(b.position.x - c.x, b.position.z - c.z))[0];
      const home = tree ? { x: tree.position.x, z: tree.position.z } : { x: c.x, z: c.z };
      const p = { x: home.x + range(rng, -3, 3), y: 0, z: home.z + range(rng, -3, 3) };
      p.y = world.surfaceHeight(p.x, p.z);
      this.rivals.push({
        id: `rival-${i + 1}`,
        name: names[i] ?? `R-${i + 1}`,
        fur: sampleFur(rng),
        position: p,
        home,
        homeTreeId: tree?.id ?? "",
        anim: { pose: "stand", gaitPhase: 0, speed: 0, heading: rng() * 6.28, headYaw: 0, headPitch: 0, tailFlick: 0, climbHeight: 0, hidden: false, carrying: false, calling: 0 },
        mode: "forage",
        target: null,
        timer: 0,
        hunger: range(rng, 0.2, 0.5),
        boldness: range(rng, 0.2, 0.9),
        carrying: false,
        caching: false,
        alive: true,
        observed: [],
        ownCaches: [],
        censusMembers: c.members,
        stats: { eaten: 0, cached: 0, pilfered: 0, chases: 0 },
      });
    });
  }

  views() {
    return this.rivals.map((r) => ({ id: r.id, position: r.position, carrying: r.carrying, caching: r.caching, alive: r.alive, climbHeight: r.anim.climbHeight, underCover: r.anim.hidden, resting: r.anim.pose === "sleep" }));
  }

  private move(r: Rival, target: Vector3, speed: number, dt: number) {
    const w = this.world;
    const a = r.anim;
    if (a.climbHeight > 0) {
      a.climbHeight = Math.max(0, a.climbHeight - SPEED.climb * 1.6 * dt);
      a.pose = "climb";
      a.speed = SPEED.climb;
      return false;
    }
    const d = dist2D(r.position, target);
    if (d < 0.8) {
      a.speed = 0;
      return true;
    }
    a.heading = dampAngle(a.heading, angleTo(r.position, target) + Math.sin(this.world.state.time * 1.7 + r.home.x) * 0.25, 6, dt);
    let v = speed;
    if (speed >= SPEED.hop) v *= 0.6 + 0.85 * Math.max(0, Math.sin(a.gaitPhase * Math.PI * 2));
    const step = Math.min(v * dt, d);
    let nx = r.position.x + Math.sin(a.heading) * step;
    let nz = r.position.z + Math.cos(a.heading) * step;
    for (const o of w.obstaclesNear(nx, nz)) {
      const od = Math.hypot(nx - o.position.x, nz - o.position.z);
      const rad = o.radius + 0.18;
      if (od < rad && od > 1e-4) {
        nx = o.position.x + ((nx - o.position.x) / od) * rad;
        nz = o.position.z + ((nz - o.position.z) / od) * rad;
      }
    }
    if (w.terrain.isBlocked(nx, nz)) {
      nx = r.position.x;
      nz = r.position.z;
      a.heading += 1.3;
    }
    r.position.x = clamp(nx, -WORLD_HALF + 3, WORLD_HALF - 3);
    r.position.z = clamp(nz, -WORLD_HALF + 3, WORLD_HALF - 3);
    r.position.y = w.surfaceHeight(r.position.x, r.position.z);
    a.speed = step / dt;
    a.pose = speed >= SPEED.hop ? "run" : "walk";
    a.gaitPhase += dt * (1.2 + a.speed * 1.35);
    return false;
  }

  private nearestFood(r: Rival, radius: number, filter: (f: FoodSource) => boolean) {
    let best: FoodSource | null = null;
    let bd = radius;
    for (const f of this.world.state.foodSources) {
      if (f.amount < 1 || !filter(f)) continue;
      if (Math.abs(f.position.x - r.position.x) > radius || Math.abs(f.position.z - r.position.z) > radius) continue;
      const d = dist2D(f.position, r.position);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  update(dt: number, subject: SubjectInfo | null) {
    const w = this.world;
    const env = w.state.env;
    const hour = w.hourFloat;
    const doy = w.local.dayOfYear;
    const cachingSeason = doy > 255 && doy < 335;
    for (const r of this.rivals) {
      if (!r.alive) continue;
      const a = r.anim;
      a.tailFlick = Math.max(0, a.tailFlick - dt * 1.5);
      a.calling = Math.max(0, a.calling - dt * 0.8);
      r.hunger = clamp(r.hunger + (dt / DAY_LENGTH) * (1 + Math.max(0, 10 - env.tempC) * 0.025));
      r.timer -= dt;

      // predators
      const threat = w.state.threats.find((t) => t.active && dist2D(t.position, r.position) < (t.kind === "hawk" ? 26 : 14));
      if (threat && r.mode !== "flee" && a.climbHeight < 0.5) {
        r.mode = "flee";
        const tree = w.nearestCover(r.position, 14, true);
        r.target = tree ? { ...tree.position } : { x: r.home.x, y: 0, z: r.home.z };
        r.targetId = tree?.id;
        a.tailFlick = 1;
        a.calling = 1;
        r.timer = 12;
      }

      const night = w.isNight || env.tempC < -8 || env.precipMm > 4;
      if (night && r.mode !== "rest" && r.mode !== "flee") {
        r.mode = "rest";
        r.target = { x: r.home.x, y: 0, z: r.home.z };
      }

      switch (r.mode) {
        case "rest": {
          if (a.climbHeight <= 0 && !this.move(r, r.target ?? { x: r.home.x, y: 0, z: r.home.z }, SPEED.hop, dt)) break;
          a.climbHeight = Math.min(8, a.climbHeight + SPEED.climb * 2 * dt);
          a.pose = a.climbHeight >= 8 ? "sleep" : "climb";
          a.hidden = a.climbHeight >= 8;
          a.speed = a.climbHeight >= 8 ? 0 : SPEED.climb;
          if (!night && hour > 7) {
            a.hidden = false;
            r.mode = "forage";
            r.target = null;
          }
          break;
        }
        case "flee": {
          if (a.climbHeight > 0 || (r.target && this.move(r, r.target, SPEED.flee, dt))) {
            a.climbHeight = Math.min(4, a.climbHeight + SPEED.climb * 2 * dt);
            a.pose = "climb";
            a.speed = 0;
          }
          if (r.timer <= 0) r.mode = "forage";
          break;
        }
        case "perch": {
          a.climbHeight = Math.min(3.5, a.climbHeight + SPEED.climb * 2 * dt);
          a.pose = "climb";
          a.speed = 0;
          a.headYaw = Math.sin(w.state.time * 1.2) * 0.8;
          if (r.timer <= 0) r.mode = "forage";
          break;
        }
        case "chase": {
          if (!subject || r.timer <= 0 || subject.climbHeight > 0.5) {
            r.mode = "forage";
            break;
          }
          this.move(r, subject.position, SPEED.run * 1.05, dt);
          a.tailFlick = Math.max(a.tailFlick, 0.7);
          if (dist2D(subject.position, r.position) < 0.9) r.timer = 0;
          break;
        }
        case "eat": {
          a.pose = "eat";
          a.speed = 0;
          if (r.timer <= 0) {
            const f = w.state.foodSources.find((x) => x.id === r.targetId);
            if (f && f.amount >= 1) {
              if (cachingSeason && r.hunger < 0.35 && f.kind === "acorn" && this.rng() < 0.6) {
                w.consumeFood(f.id);
                r.carrying = true;
                a.carrying = true;
                r.mode = "cache";
                const ang = this.rng() * Math.PI * 2;
                const dist = range(this.rng, 5, 25);
                r.target = { x: clamp(r.home.x + Math.cos(ang) * dist, -190, 190), y: 0, z: clamp(r.home.z + Math.sin(ang) * dist, -190, 190) };
                break;
              }
              w.consumeFood(f.id);
              r.hunger = clamp(r.hunger - f.nutrition);
              r.stats.eaten++;
              if (f.kind === "cache" && f.owner !== r.id) {
                f.pilferedBy = r.id;
                r.stats.pilfered++;
                this.interactions.push({ kind: "pilfer", rivalId: r.id, foodId: f.id, position: { ...f.position } });
              }
              r.timer = 2.6;
              if (r.hunger < 0.1 || f.amount < 1) r.mode = "forage";
            } else r.mode = "forage";
          }
          break;
        }
        case "cache": {
          if (!r.target) {
            r.mode = "forage";
            break;
          }
          r.caching = dist2D(r.position, r.target) < 1.5;
          if (w.terrain.isBlocked(r.target.x, r.target.z)) r.target = { x: r.home.x, y: 0, z: r.home.z };
          if (this.move(r, r.target, SPEED.hop, dt)) {
            a.pose = "dig";
            if (r.timer <= 0) r.timer = 2.4;
            if (r.timer < 0.1) {
              const cache = w.buryCache({ ...r.position }, r.id);
              r.ownCaches.push(cache.id);
              if (r.ownCaches.length > 100) r.ownCaches.shift();
              if (r.ownCaches.length > 200) r.ownCaches.shift();
              r.stats.cached++;
              r.carrying = false;
              a.carrying = false;
              r.caching = false;
              r.mode = "forage";
              r.target = null;
              // other squirrels nearby may have watched
              for (const o of this.rivals) {
                if (o !== r && o.alive && dist2D(o.position, r.position) < 14) o.observed.push({ id: cache.id, x: cache.position.x, z: cache.position.z, t: w.state.time });
              }
            }
          }
          break;
        }
        case "pilfer":
        case "retrieve": {
          const f = w.state.foodSources.find((x) => x.id === r.targetId);
          if (!f || f.amount < 1) {
            r.mode = "forage";
            break;
          }
          if (this.move(r, f.position, SPEED.hop, dt)) {
            r.mode = "eat";
            r.timer = 2.2;
            a.pose = "dig";
          }
          break;
        }
        default: {
          // forage
          r.caching = false;
          if (r.timer > 0 && r.target) {
            if (this.move(r, r.target, r.hunger > 0.6 ? SPEED.hop : SPEED.walk * 1.4, dt)) {
              r.timer = Math.min(r.timer, 1);
              a.pose = this.rng() < 0.5 ? "sniff" : "alert";
            }
            break;
          }
          // choose a new foraging objective
          r.timer = range(this.rng, 4, 14);
          r.observed = r.observed.filter((o) => w.state.time - o.t < DAY_LENGTH * 3);
          const seen = r.observed.find((o) => w.state.foodSources.some((f) => f.id === o.id && f.amount >= 1));
          if (seen && r.hunger > 0.3 && this.rng() < 0.4) {
            r.mode = "pilfer";
            r.targetId = seen.id;
            r.observed = r.observed.filter((o) => o !== seen);
            break;
          }
          if (!cachingSeason && r.hunger > 0.4 && r.ownCaches.length && this.rng() < 0.6) {
            const id = r.ownCaches[Math.floor(this.rng() * r.ownCaches.length)];
            if (w.state.foodSources.some((f) => f.id === id && f.amount >= 1)) {
              r.mode = "retrieve";
              r.targetId = id;
              break;
            }
          }
          if (r.hunger > 0.25 && w.buriedAt(r.position.x, r.position.z) > 0.2) {
            const nut = w.sniffBuried(r.position.x, r.position.z, dt, 0.9);
            if (nut) {
              r.target = { ...nut.position };
              r.targetId = nut.id;
              r.mode = "eat";
              r.timer = 2.6;
              break;
            }
          }
          const food = this.nearestFood(r, 18, (f) => (f.kind !== "cache" || f.owner === r.id || f.owner === "population" || this.rng() < 0.15) && !f.toxic);
          if (food && (r.hunger > 0.15 || cachingSeason)) {
            r.target = { ...food.position };
            r.targetId = food.id;
            if (dist2D(food.position, r.position) < 1.2) {
              r.mode = "eat";
              r.timer = 2.6;
            }
            break;
          }
          if (this.rng() < 0.15) {
            const tree = w.nearestCover(r.position, 10, true);
            if (tree) {
              r.mode = "perch";
              r.timer = range(this.rng, 6, 18);
              break;
            }
          }
          const ang = this.rng() * Math.PI * 2;
          const d = range(this.rng, 4, 22);
          const tx = clamp(r.home.x + Math.cos(ang) * d, -190, 190);
          const tz = clamp(r.home.z + Math.sin(ang) * d, -190, 190);
          if (!w.terrain.isBlocked(tx, tz)) r.target = { x: tx, y: 0, z: tz };
          break;
        }
      }

      // subject interactions
      if (subject && r.mode !== "rest" && r.mode !== "flee") {
        const d = dist2D(subject.position, r.position);
        if (subject.caching && d < 14) {
          r.observed.push({ id: "pending", x: subject.position.x, z: subject.position.z, t: w.state.time });
          this.interactions.push({ kind: "observed-subject-caching", rivalId: r.id, position: { ...subject.position } });
        }
        if (d < 6 && subject.nearFood && subject.climbHeight < 0.4 && r.mode !== "chase" && this.rng() < dt * r.boldness * 0.8) {
          r.mode = "chase";
          r.timer = range(this.rng, 2.5, 5);
          r.stats.chases++;
          this.interactions.push({ kind: "chase-subject", rivalId: r.id, position: { ...r.position } });
        }
      }
    }
    // resolve "pending" observations to the actual cache the subject made
    for (const r of this.rivals) {
      for (const o of r.observed) {
        if (o.id !== "pending") continue;
        const c = w.state.foodSources.find((f) => f.owner === "subject" && f.amount >= 1 && Math.hypot(f.position.x - o.x, f.position.z - o.z) < 2.5);
        o.id = c ? c.id : "none";
      }
      r.observed = r.observed.filter((o) => o.id !== "none" && o.id !== "pending");
    }
  }

  toJSON() {
    return { rivals: this.rivals.map((r) => ({ ...r, observed: r.observed.slice(), ownCaches: r.ownCaches.slice() })), rng: this.rng.getState() };
  }

  load(data: Rival[] | { rivals: Rival[]; rng: number }) {
    if (Array.isArray(data)) this.rivals = data;
    else {
      this.rivals = data.rivals;
      this.rng.setState(data.rng);
    }
  }
}
