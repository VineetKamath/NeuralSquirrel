import type { LearnedLocation, Memory, MemoryType, Vector3, Landmark } from "@/types";
import { clamp, dist2D } from "@/utils/math";
import { gaussian, type RNG } from "@/utils/rng";
import { DAY_LENGTH, GRID_CELL, GRID_RES, WORLD_HALF } from "./constants";
import { b64ToF32, f32ToB64 } from "@/utils/b64";

export interface MemoryFormation {
  memory: Memory;
  isNew: boolean;
}

/**
 * Episodic + spatial memory.
 * - memories strengthen with use and decay without it
 * - locations are encoded with noise that shrinks as encoding precision improves
 * - a familiarity grid records explored territory; a path grid records travelled routes
 */
export class MemorySystem {
  memories: Memory[] = [];
  learnedLocations: LearnedLocation[] = [];
  familiarity = new Float32Array(GRID_RES * GRID_RES);
  pathUse = new Float32Array(GRID_RES * GRID_RES);
  danger = new Float32Array(GRID_RES * GRID_RES);
  /** skill: 0..1, how accurately new locations are encoded */
  encodingPrecision: number;
  forgotten: Memory[] = [];
  private counter = 0;
  private rng: RNG;
  private retention: number;
  private lastCell = -1;

  toJSON() {
    return {
      memories: this.memories,
      learnedLocations: this.learnedLocations,
      familiarity: f32ToB64(this.familiarity),
      pathUse: f32ToB64(this.pathUse),
      danger: f32ToB64(this.danger),
      encodingPrecision: this.encodingPrecision,
      counter: this.counter,
    };
  }

  load(o: ReturnType<MemorySystem["toJSON"]>) {
    this.memories = o.memories;
    this.learnedLocations = o.learnedLocations;
    this.familiarity.set(b64ToF32(o.familiarity));
    this.pathUse.set(b64ToF32(o.pathUse));
    this.danger.set(b64ToF32(o.danger));
    this.encodingPrecision = o.encodingPrecision;
    this.counter = o.counter;
  }

  constructor(rng: RNG, retention: number) {
    this.rng = rng;
    this.retention = retention;
    this.encodingPrecision = 0.15 + retention * 0.15;
  }

  static cellIndex(x: number, z: number) {
    const gx = clamp(Math.floor((x + WORLD_HALF) / GRID_CELL), 0, GRID_RES - 1);
    const gz = clamp(Math.floor((z + WORLD_HALF) / GRID_CELL), 0, GRID_RES - 1);
    return gz * GRID_RES + gx;
  }

  static cellCenter(i: number): Vector3 {
    const gx = i % GRID_RES;
    const gz = Math.floor(i / GRID_RES);
    return { x: gx * GRID_CELL - WORLD_HALF + GRID_CELL / 2, y: 0, z: gz * GRID_CELL - WORLD_HALF + GRID_CELL / 2 };
  }

  familiarityAt(x: number, z: number) {
    return this.familiarity[MemorySystem.cellIndex(x, z)];
  }

  dangerAt(x: number, z: number) {
    // sample with a small blur
    const gx = clamp(Math.floor((x + WORLD_HALF) / GRID_CELL), 0, GRID_RES - 1);
    const gz = clamp(Math.floor((z + WORLD_HALF) / GRID_CELL), 0, GRID_RES - 1);
    let sum = 0;
    let w = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ix = gx + dx;
        const iz = gz + dz;
        if (ix < 0 || iz < 0 || ix >= GRID_RES || iz >= GRID_RES) continue;
        const k = dx === 0 && dz === 0 ? 2 : 1;
        sum += this.danger[iz * GRID_RES + ix] * k;
        w += k;
      }
    }
    return sum / w;
  }

  /** mark cells within radius as perceived; returns number of newly explored cells */
  observeArea(pos: Vector3, radius: number, dt: number) {
    let fresh = 0;
    const r = Math.ceil(radius / GRID_CELL);
    const cx = Math.floor((pos.x + WORLD_HALF) / GRID_CELL);
    const cz = Math.floor((pos.z + WORLD_HALF) / GRID_CELL);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= GRID_RES || iz >= GRID_RES) continue;
        const d = Math.hypot(dx, dz) * GRID_CELL;
        if (d > radius) continue;
        const i = iz * GRID_RES + ix;
        const gain = (1 - d / radius) * dt * 0.9;
        if (this.familiarity[i] < 0.08 && this.familiarity[i] + gain >= 0.08) fresh++;
        this.familiarity[i] = Math.min(1, this.familiarity[i] + gain);
      }
    }
    return fresh;
  }

  recordStep(pos: Vector3, distance: number) {
    const i = MemorySystem.cellIndex(pos.x, pos.z);
    this.pathUse[i] = Math.min(10, this.pathUse[i] + distance * 0.05);
    const moved = i !== this.lastCell;
    this.lastCell = i;
    return moved;
  }

  private exploredCache = 0;
  private exploredStamp = -1;

  exploredFraction() {
    // counting 10k cells is costly; the value changes slowly, so refresh a few times per second of sim
    this.exploredStamp++;
    if (this.exploredStamp % 25 !== 0) return this.exploredCache;
    let n = 0;
    for (let i = 0; i < this.familiarity.length; i++) if (this.familiarity[i] > 0.08) n++;
    this.exploredCache = n / this.familiarity.length;
    return this.exploredCache;
  }

  markDanger(pos: Vector3, strength: number) {
    const r = 3;
    const cx = Math.floor((pos.x + WORLD_HALF) / GRID_CELL);
    const cz = Math.floor((pos.z + WORLD_HALF) / GRID_CELL);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= GRID_RES || iz >= GRID_RES) continue;
        const f = Math.max(0, 1 - Math.hypot(dx, dz) / (r + 0.5));
        const i = iz * GRID_RES + ix;
        this.danger[i] = Math.min(1, this.danger[i] + strength * f);
      }
    }
  }

  private encode(true_: Vector3, noiseScale: number): Vector3 {
    const sigma = (1 - this.encodingPrecision) * noiseScale;
    return { x: true_.x + gaussian(this.rng) * sigma, y: true_.y, z: true_.z + gaussian(this.rng) * sigma };
  }

  find(pred: (m: Memory) => boolean) {
    return this.memories.find(pred);
  }

  bySource(sourceId: string, type?: MemoryType) {
    return this.memories.find((m) => m.sourceId === sourceId && (!type || m.type === type));
  }

  near(pos: Vector3, radius: number, type?: MemoryType) {
    return this.memories.filter((m) => (!type || m.type === type) && dist2D(m.location, pos) < radius);
  }

  /** form a memory or reinforce an existing one for the same source */
  form(opts: {
    type: MemoryType;
    location: Vector3;
    label: string;
    importance: number;
    emotionalValue: number;
    time: number;
    sourceId?: string;
    subtype?: string;
    noise?: number;
  }): MemoryFormation {
    const existing = opts.sourceId
      ? this.bySource(opts.sourceId, opts.type)
      : this.memories.find((m) => m.type === opts.type && dist2D(m.location, opts.location) < 6);
    if (existing) {
      existing.importance = clamp(existing.importance + opts.importance * 0.35);
      existing.confidence = clamp(existing.confidence + 0.08);
      existing.emotionalValue = existing.emotionalValue * 0.7 + opts.emotionalValue * 0.3;
      // re-encoding pulls the stored location toward the truth
      existing.location.x += (opts.location.x - existing.location.x) * (0.35 + this.encodingPrecision * 0.5);
      existing.location.z += (opts.location.z - existing.location.z) * (0.35 + this.encodingPrecision * 0.5);
      existing.lastVisited = opts.time;
      return { memory: existing, isNew: false };
    }
    const m: Memory = {
      id: `M-${String(++this.counter).padStart(3, "0")}`,
      type: opts.type,
      location: this.encode(opts.location, opts.noise ?? 5),
      importance: clamp(opts.importance),
      confidence: clamp(0.25 + this.encodingPrecision * 0.4),
      timestamp: opts.time,
      emotionalValue: opts.emotionalValue,
      recallCount: 0,
      label: opts.label,
      sourceId: opts.sourceId,
      expectation: opts.type === "food" ? 0.75 : opts.subtype === "water" ? 0.95 : 0.5,
      lastVisited: opts.time,
      successCount: 0,
      failCount: 0,
      subtype: opts.subtype,
    };
    this.memories.push(m);
    if (m.type === "danger") this.markDanger(opts.location, Math.abs(opts.emotionalValue) * 0.7);
    return { memory: m, isNew: true };
  }

  recall(m: Memory, time: number) {
    m.recallCount++;
    m.importance = clamp(m.importance + 0.04);
    m.lastVisited = time;
  }

  /** outcome of acting on a memory */
  reinforce(m: Memory, success: boolean, trueLocation: Vector3 | null, learningRate: number) {
    if (success) {
      m.successCount++;
      m.confidence = clamp(m.confidence + 0.12 * (0.5 + learningRate));
      m.importance = clamp(m.importance + 0.1);
      m.expectation = clamp(m.expectation + (1 - m.expectation) * 0.35);
      this.encodingPrecision = clamp(this.encodingPrecision + 0.012 * (0.5 + learningRate), 0, 0.95);
    } else {
      m.failCount++;
      m.confidence = clamp(m.confidence - 0.08);
      m.expectation = clamp(m.expectation - m.expectation * 0.45);
      m.importance = clamp(m.importance - 0.06);
    }
    if (trueLocation) {
      m.location.x += (trueLocation.x - m.location.x) * 0.7;
      m.location.z += (trueLocation.z - m.location.z) * 0.7;
    }
  }

  /** decay: irrelevant memories fade, recalled ones are protected */
  decay(dt: number, time: number) {
    this.forgotten = [];
    const dayFrac = dt / DAY_LENGTH;
    const base = 0.55 * (1.2 - this.retention);
    for (const m of this.memories) {
      // scatter-hoarders retain cache locations for months; water and nest landmarks are also long-lived
      const durable = m.subtype === "cache" ? 8 : m.subtype === "water" || m.label === "NEST OAK" ? 5 : 1;
      const protection = (1 + m.recallCount * 0.45 + m.successCount * 0.6 + Math.abs(m.emotionalValue) * 1.5) * durable;
      m.importance -= (base * dayFrac) / protection;
      // expectations of depleted food slowly recover over time (resources regrow)
      if (m.type === "food") m.expectation = Math.min(0.85, m.expectation + dayFrac * 0.9);
    }
    const kept: Memory[] = [];
    for (const m of this.memories) {
      if (m.importance <= 0.03 && time - m.timestamp > DAY_LENGTH * 0.3) this.forgotten.push(m);
      else kept.push(m);
    }
    this.memories = kept;

    // slow fading of spatial maps
    const fade = 1 - dayFrac * 0.04 * (1.2 - this.retention);
    for (let i = 0; i < this.familiarity.length; i++) {
      this.familiarity[i] *= fade;
      this.pathUse[i] *= 1 - dayFrac * 0.25;
      this.danger[i] *= 1 - dayFrac * 0.18 * (1.2 - this.retention);
    }
  }

  visitLocations(pos: Vector3, landmarks: Landmark[], time: number): LearnedLocation | null {
    for (const lm of landmarks) {
      if (dist2D(lm.position, pos) > lm.radius + 3) continue;
      let loc = this.learnedLocations.find((l) => l.landmarkId === lm.id);
      if (!loc) {
        loc = {
          id: `L-${lm.id}`,
          name: lm.name,
          position: { ...lm.position },
          visits: 0,
          foodValue: 0,
          dangerValue: 0,
          lastVisit: -999,
          landmarkId: lm.id,
        };
        this.learnedLocations.push(loc);
      }
      if (time - loc.lastVisit > 25) {
        loc.visits++;
        loc.lastVisit = time;
        return loc;
      }
      loc.lastVisit = time;
      return null;
    }
    return null;
  }

  nearestLocation(pos: Vector3, radius = 14) {
    let best: LearnedLocation | null = null;
    let bd = radius;
    for (const l of this.learnedLocations) {
      const d = dist2D(l.position, pos);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  associateLocation(pos: Vector3, food: number, danger: number) {
    const loc = this.nearestLocation(pos, 16);
    if (!loc) return;
    loc.foodValue = clamp(loc.foodValue * 0.8 + food, -1, 1);
    loc.dangerValue = clamp(loc.dangerValue * 0.8 + danger, -1, 1);
  }

  /** valence of a location: combined food and danger associations */
  associations(pos: Vector3, radius = 10) {
    let food = 0;
    let danger = 0;
    for (const m of this.memories) {
      const d = dist2D(m.location, pos);
      if (d > radius) continue;
      const w = (1 - d / radius) * m.confidence;
      if (m.type === "food") food = Math.max(food, w * m.importance * (m.emotionalValue + 0.2));
      if (m.type === "danger") danger = Math.min(danger, -w * m.importance * Math.abs(m.emotionalValue));
    }
    danger = Math.min(danger, -this.dangerAt(pos.x, pos.z) * 0.6);
    return { food: clamp(food), danger: clamp(danger, -1, 0) };
  }

  averageStrength() {
    if (!this.memories.length) return 0;
    let s = 0;
    for (const m of this.memories) s += m.importance * m.confidence;
    return s / this.memories.length;
  }
}
