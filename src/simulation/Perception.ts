import type { FoodSource, Landmark, Threat, Vector3, WaterSource, WorldObject } from "@/types";
import { clamp, dist2D } from "@/utils/math";
import type { WorldModel } from "./WorldModel";

export interface PerceivedFood {
  food: FoodSource;
  distance: number;
}
export interface PerceivedThreat {
  threat: Threat;
  distance: number;
  proximity: number;
}
export interface PerceivedWater {
  water: WaterSource;
  /** distance to the edge */
  distance: number;
  edge: Vector3;
}
export interface PerceivedObject {
  object: WorldObject;
  distance: number;
  salience: number;
}
export interface PerceivedRival {
  id: string;
  position: Vector3;
  distance: number;
  carrying: boolean;
  caching: boolean;
}

export interface RivalView {
  id: string;
  position: Vector3;
  carrying: boolean;
  caching: boolean;
  alive: boolean;
}

export interface PerceptionResult {
  visionRange: number;
  foods: PerceivedFood[];
  threats: PerceivedThreat[];
  water: PerceivedWater[];
  novelObjects: PerceivedObject[];
  landmarks: Landmark[];
  rivals: PerceivedRival[];
  salience: number;
  threatLevel: number;
  novelty: number;
}

export interface PerceptionParams {
  position: Vector3;
  vigilance: number;
  observing: boolean;
  sleeping: boolean;
  climbHeight: number;
  investigating: boolean;
  investigated: Set<string>;
  knownFoodIds: Set<string>;
  rivals?: RivalView[];
  selfId?: string;
}

const INTERESTING = new Set(["oak", "log", "stump", "rock", "bush", "mushroom", "bench"]);

/** PERCEPTION region: gathers nearby stimuli, attenuated by light, weather and state. */
export function perceive(world: WorldModel, p: PerceptionParams): PerceptionResult {
  const pos = p.position;
  const vis = world.visibility;
  const visionRange =
    (13 + p.vigilance * 7) * vis * (p.observing ? 1.45 : 1) * (p.sleeping ? 0.35 : 1) * (p.climbHeight > 1 ? 1.35 : 1);

  const foods: PerceivedFood[] = [];
  for (const f of world.state.foodSources) {
    if (f.amount < 1) continue;
    if (Math.abs(f.position.x - pos.x) > 40 || Math.abs(f.position.z - pos.z) > 40) continue;
    const d = dist2D(f.position, pos);
    let r = visionRange * 0.52 * f.visibility;
    // squirrels locate buried food by smell, including under snow
    if (f.hidden || world.snowHides(f)) r = p.investigating ? 3.4 : 1.5;
    if (p.knownFoodIds.has(f.id)) r = Math.max(r, f.hidden ? 3.2 : r * 1.2);
    if (d < r) foods.push({ food: f, distance: d });
  }
  foods.sort((a, b) => a.distance - b.distance);

  const threats: PerceivedThreat[] = [];
  let threatLevel = 0;
  for (const t of world.state.threats) {
    if (!t.active) continue;
    const d = dist2D(t.position, pos);
    let range = 0;
    if (t.kind === "dog") {
      range = visionRange * 1.4;
      if (t.state === "chase") range = Math.max(range, 26);
    } else {
      range = t.state === "dive" ? 35 : (26 + p.vigilance * 10) * (0.5 + world.daylight * 0.5);
    }
    if (p.sleeping) range *= 0.5;
    if (d < range) {
      const danger = t.kind === "dog" ? (t.state === "chase" ? 1 : 0.55) : t.state === "dive" ? 1 : 0.7;
      const proximity = clamp((1 - d / (range + 1)) * 0.6 + danger * 0.55);
      threats.push({ threat: t, distance: d, proximity });
      threatLevel = Math.max(threatLevel, proximity);
    }
  }

  const water: PerceivedWater[] = [];
  const site = world.terrain.site;
  // open water is seen from afar, running water and the lake shore can also be heard
  const edge = site.nearestWaterEdge(pos.x, pos.z, p.sleeping ? visionRange : Math.max(visionRange * 1.6, 40));
  if (edge) {
    const body = world.state.waterSources.find((w) => w.name === edge.body?.name && w.kind !== "puddle") ??
      world.state.waterSources.find((w) => w.kind !== "puddle");
    if (body) water.push({ water: body, distance: edge.distance, edge: { x: edge.x, y: world.terrain.height(edge.x, edge.z), z: edge.z } });
  }
  for (const w of world.state.waterSources) {
    if (w.kind !== "puddle" || w.amount < 0.05) continue;
    const d = Math.max(0, dist2D(w.position, pos) - w.radius);
    if (d < visionRange * 0.6) {
      const dc = dist2D(w.position, pos) || 1;
      const k = (w.radius + 0.3) / dc;
      water.push({ water: w, distance: d, edge: { x: w.position.x + (pos.x - w.position.x) * k, y: w.position.y, z: w.position.z + (pos.z - w.position.z) * k } });
    }
  }

  const novelObjects: PerceivedObject[] = [];
  let novelty = 0;
  const objRange = visionRange * 0.85;
  for (const o of world.objectsNear(pos.x, pos.z, objRange)) {
    if (!INTERESTING.has(o.kind) || o.fallen || p.investigated.has(o.id)) continue;
    if (Math.abs(o.position.x - pos.x) > objRange || Math.abs(o.position.z - pos.z) > objRange) continue;
    const d = dist2D(o.position, pos);
    if (d > objRange) continue;
    const size = o.kind === "mushroom" ? 0.55 : o.kind === "oak" ? 0.7 : o.kind === "log" || o.kind === "stump" ? 0.9 : o.kind === "bench" ? 0.6 : 0.5;
    const salience = clamp(size * (1 - d / (objRange + 1)) + (o.landmarkId ? 0.25 : 0));
    novelObjects.push({ object: o, distance: d, salience });
    novelty = Math.max(novelty, salience);
  }
  novelObjects.sort((a, b) => b.salience - a.salience);
  if (novelObjects.length > 6) novelObjects.length = 6;

  const landmarks = world.state.landmarks.filter((l) => dist2D(l.position, pos) < visionRange * 1.3 + l.radius);

  const rivals: PerceivedRival[] = [];
  for (const r of p.rivals ?? []) {
    if (!r.alive || r.id === p.selfId) continue;
    const d = dist2D(r.position, pos);
    if (d < visionRange * 1.1) rivals.push({ id: r.id, position: r.position, distance: d, carrying: r.carrying, caching: r.caching });
  }
  rivals.sort((a, b) => a.distance - b.distance);

  const salience = clamp(foods.length * 0.25 + threats.length * 0.5 + novelty * 0.5 + water.length * 0.1 + rivals.length * 0.15);

  return { visionRange, foods, threats, water, novelObjects, landmarks, rivals, salience, threatLevel, novelty };
}
