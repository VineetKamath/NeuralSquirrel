import type { ActionType, Goal, GoalPurpose, Personality, SquirrelState, Vector3, WorldObject } from "@/types";
import { clamp, dist2D } from "@/utils/math";
import { gaussian, type RNG } from "@/utils/rng";
import type { LearningSystem } from "./LearningSystem";
import type { MemorySystem } from "./MemorySystem";
import type { PerceptionResult } from "./Perception";
import type { WorldModel } from "./WorldModel";
import { WORLD_HALF } from "./constants";
import type { NeuralBrain } from "./neural/NeuralBrain";
import type { CalibrationSystem } from "./CalibrationSystem";

export interface Candidate {
  type: ActionType;
  purpose: GoalPurpose;
  target: Vector3 | null;
  targetId?: string;
  memoryId?: string;
  threatId?: string;
  drive: number;
  targetValue: number;
  utility: number;
  q: number;
  /** contribution from striatal spiking votes */
  neural?: number;
  total: number;
  label: string;
  reason: string;
  /** set when a known danger changed the preferred option */
  avoidedDanger?: string;
}

export interface DecisionContext {
  s: SquirrelState;
  p: Personality;
  world: WorldModel;
  memory: MemorySystem;
  learning: LearningSystem;
  perception: PerceptionResult;
  rng: RNG;
  time: number;
  stateKey: string;
  current: Goal | null;
  lastObserve: number;
  searched: Map<string, number>;
  homeTree: WorldObject;
  habituation: number;
  dangerHere: number;
  neural?: NeuralBrain;
  calibration?: CalibrationSystem;
  lastPerch?: number;
  audienceCaution?: number;
  suppressed?: Map<string, number>;
}

export interface Selection {
  chosen: Candidate;
  probability: number;
  candidates: Candidate[];
  switchGoal: boolean;
  exploratory: boolean;
}

/**
 * The seam where a different "brain" can be plugged in. Any policy that can
 * propose scored candidates from a DecisionContext and choose between them
 * (e.g. a neural network or an LLM-backed planner) can replace DecisionSystem
 * without changes to the agent, world, memory or UI.
 */
export interface DecisionPolicy {
  lastCandidates: Candidate[];
  build(ctx: DecisionContext): Candidate[];
  select(ctx: DecisionContext, candidates: Candidate[]): Selection;
}

const COMMIT_BONUS = 0.22;

function routeDanger(memory: MemorySystem, from: Vector3, to: Vector3) {
  let max = 0;
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    max = Math.max(max, memory.dangerAt(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t));
  }
  return max;
}

function inBounds(p: Vector3) {
  return Math.abs(p.x) < WORLD_HALF - 8 && Math.abs(p.z) < WORLD_HALF - 8;
}

/**
 * DECISION region: builds candidate actions with utility scores from drives,
 * perception and memory, adds learned Q-values and noise, then selects.
 */
export class DecisionSystem implements DecisionPolicy {
  lastCandidates: Candidate[] = [];

  /** influence of striatal spiking votes grows as the network gains experience */
  neuralWeight(c: DecisionContext) {
    if (!c.neural) return 0;
    return 0.18 + 0.32 * clamp(c.neural.learningEvents / 1500);
  }

  /** the familiar range grows as territory is explored */
  private homeRange(c: DecisionContext) {
    return 16 + c.memory.exploredFraction() * 130 + c.p.boldness * 10 + c.s.curiosity * 6;
  }

  /** unmet needs with no remembered solution push the subject beyond familiar range */
  private desperation(c: DecisionContext) {
    const mems = c.memory.memories;
    const knowsWater = mems.some((m) => m.subtype === "water" && m.expectation > 0.2);
    const knowsFood = mems.some((m) => m.type === "food" && m.subtype !== "toxic" && m.expectation * m.confidence > 0.2);
    const water = knowsWater ? 0 : Math.max(0, c.s.thirst - 0.3) / 0.7;
    const food = knowsFood ? 0 : Math.max(0, c.s.hunger - 0.35) / 0.65;
    return { water, food, any: Math.max(water, food) };
  }

  /** drives gated by the circadian clock: gray squirrels are strictly diurnal */
  private driveUtility(type: ActionType, c: DecisionContext) {
    const base = this.baseDrive(type, c);
    if (type === "REST" || type === "FLEE" || type === "HIDE") return base;
    const env = c.world.state.env;
    const dark = c.world.isNight ? 1 : clamp((2 - env.sunElevation) / 6);
    if (dark <= 0) return base;
    // only acute need keeps a squirrel out of its drey after dark
    const need = clamp((Math.max(c.s.hunger, c.s.thirst) - 0.7) / 0.25);
    return base - dark * 1.1 * (1 - need);
  }

  private baseDrive(type: ActionType, c: DecisionContext) {
    const { s, p } = c;
    const h = s.hunger;
    const t = s.thirst;
    const e = s.energy;
    const f = s.fear;
    const cur = s.curiosity;
    const night = c.world.isNight ? 1 : 0;
    // civil dusk and dawn: gray squirrels retire around sunset and emerge after sunrise
    const dusk = night ? 1 : clamp((5 - c.world.state.env.sunElevation) / 9);
    const threat = c.perception.threatLevel;
    const bias = c.calibration?.bias;
    const env = c.world.state.env;
    const cold = clamp((6 - env.tempC) / 20);
    const foul = clamp(env.precipMm / 3);
    switch (type) {
      case "EAT":
        return 0.45 + 1.9 * h + (bias?.eating ?? 0) * 0.5;
      case "SEARCH_FOR_FOOD":
        return 1.15 * Math.pow(h, 1.2) - 0.5 * f - 0.2 * (1 - e) - 0.12 * night + (bias?.foraging ?? 0) * 0.8 - foul * 0.2;
      case "PERCH": {
        const recent = c.time - (c.lastPerch ?? -999) < 25 ? 0.5 : 0;
        return 0.08 + 0.3 * f + 0.25 * c.learning.vigilance + (bias?.aboveGround ?? 0) * 0.9 + (bias?.climbing ?? 0) * 0.6 - 0.35 * h - 0.3 * night - recent;
      }
      case "CHASE":
        return 0.05 + 0.6 * p.boldness - 0.6 * f + (bias?.chasing ?? 0) * 1.2 - 0.3 * (1 - e);
      case "RETURN_TO_MEMORY":
        return 0.12 - 0.35 * f - 0.1 * night;
      case "EXPLORE": {
        const need = this.desperation(c);
        return (
          0.85 * cur * (1 - 0.55 * c.habituation) - 0.85 * f - 0.45 * h * (1 - need.food) - 0.3 * t * (1 - need.water) - 0.35 * (1 - e) - 0.4 * night +
          need.water * 1.1 +
          need.food * 0.35
        );
      }
      case "INVESTIGATE":
        return 0.12 + 0.72 * cur - 0.6 * f - 0.25 * h - 0.2 * night;
      case "REST":
        // real squirrels sit out storms, heavy rain and hard frost in their dreys
        return 1.2 * Math.pow(1 - e, 1.6) + dusk * (1.15 + 0.3 * (1 - e)) + cold * 0.35 + foul * 0.45 - 0.45 * h * (1 - cold * 0.3) * (1 - dusk * 0.6) - 0.4 * t * (1 - dusk * 0.6) - 0.6 * threat;
      case "DRINK":
        return 0.2 + 1.4 * t;
      case "FLEE":
      case "HIDE":
        return 0.3 + 1.5 * f;
      case "OBSERVE": {
        const recent = c.time - c.lastObserve < 14 ? 0.6 : 0;
        return 0.1 + 0.45 * f * (1 - threat) + 0.3 * c.dangerHere * (0.5 + c.learning.vigilance) - 0.3 * h - recent;
      }
      case "STORE_FOOD":
        return 0.15 + 0.95 * p.hoarding * (1 - h) - 0.4 * f - 0.25 * night;
    }
  }

  build(c: DecisionContext): Candidate[] {
    const { s, perception, memory, learning, world } = c;
    const pos = s.position;
    const out: Candidate[] = [];
    const add = (cand: Omit<Candidate, "drive" | "utility" | "q" | "total">) => {
      const drive = this.driveUtility(cand.type, c);
      out.push({ ...cand, drive, utility: drive + cand.targetValue, q: 0, total: 0 });
    };

    // ── threats
    for (const pt of perception.threats) {
      const t = pt.threat;
      // flight initiation distance: a dog walking its route far away is watched, not fled from
      if (t.kind === "dog" && t.state !== "chase" && pt.distance > 14 + (1 - c.p.boldness) * 6) {
        add({
          type: "OBSERVE",
          purpose: "safety",
          target: null,
          targetValue: 0.25 * pt.proximity,
          label: "OBSERVE · DOG",
          reason: "Dog in view. Monitoring.",
        });
        continue;
      }
      const away = { x: pos.x - t.position.x, z: pos.z - t.position.z };
      const len = Math.hypot(away.x, away.z) || 1;
      let fx = away.x / len;
      let fz = away.z / len;
      const home = c.homeTree.position;
      const hd = dist2D(home, pos);
      if (hd > 3) {
        const hx = (home.x - pos.x) / hd;
        const hz = (home.z - pos.z) / hd;
        if (hx * fx + hz * fz > -0.2) {
          fx = fx * 0.6 + hx * 0.4;
          fz = fz * 0.6 + hz * 0.4;
        }
      }
      const fl = Math.hypot(fx, fz) || 1;
      // escape heading: the most direct "away" bearing whose route is open ground (no water or buildings)
      const baseAng = Math.atan2(fx / fl, fz / fl);
      let fleeTarget = { x: pos.x + (fx / fl) * 22, y: 0, z: pos.z + (fz / fl) * 22 };
      for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2]) {
        const a = baseAng + off;
        let open = true;
        for (let k = 4; k <= 22 && open; k += 6) {
          const x = pos.x + Math.sin(a) * k;
          const z = pos.z + Math.cos(a) * k;
          if (!inBounds({ x, y: 0, z }) || world.terrain.site.isBlocked(x, z)) open = false;
        }
        if (open) {
          fleeTarget = { x: pos.x + Math.sin(a) * 22, y: 0, z: pos.z + Math.cos(a) * 22 };
          break;
        }
      }
      add({
        type: "FLEE",
        purpose: "safety",
        target: fleeTarget,
        threatId: t.id,
        targetValue: pt.proximity * 0.8 + (t.kind === "dog" ? 0.1 : -0.3),
        label: `FLEE · ${t.kind.toUpperCase()}`,
        reason: "Threat detected. Increasing distance.",
      });
      const cover = world.nearestCover(pos, t.kind === "dog" ? 14 : 16, t.kind === "dog");
      if (cover) {
        const d = dist2D(cover.position, pos);
        add({
          type: "HIDE",
          purpose: "safety",
          target: { ...cover.position },
          targetId: cover.id,
          threatId: t.id,
          targetValue: pt.proximity * 0.8 + (t.kind === "hawk" ? 0.45 : 0.05) - d / 40,
          label: cover.climbable ? "HIDE · CLIMB TREE" : "HIDE · UNDER COVER",
          reason: cover.climbable ? "Climbable refuge within reach." : "Cover located.",
        });
      }
    }

    // ── food in reach / visible
    const reach = perception.foods.find((pf) => pf.distance < 1.7);
    if (reach && s.hunger > 0.1) {
      const pref = learning.preference(reach.food.label);
      add({
        type: "EAT",
        purpose: "food",
        target: { ...reach.food.position },
        targetId: reach.food.id,
        targetValue: pref * 0.9 + (reach.food.createdBySubject ? 0.05 : 0),
        label: `EAT · ${reach.food.label}`,
        reason: pref < -0.3 ? "Food associated with adverse outcome." : "Food within reach.",
      });
    }
    const doy = world.local.dayOfYear;
    const hoardSeason = doy > 250 && doy < 340;
    if (reach && reach.food.kind === "acorn" && reach.food.amount >= 2 && s.hunger < (hoardSeason ? 0.62 : 0.4) && !s.anim.carrying) {
      // audience effect: once caches have been stolen, caching in front of others is avoided
      const watchers = perception.rivals.filter((r) => r.distance < 14).length;
      const caution = c.audienceCaution ?? 0;
      // scatter-hoarding peaks in autumn as days shorten
      const season = hoardSeason ? 0.55 + (1 - Math.abs(doy - 300) / 50) * 0.3 : -0.1;
      add({
        type: "STORE_FOOD",
        purpose: "cache",
        target: { ...reach.food.position },
        targetId: reach.food.id,
        targetValue: season - watchers * caution * 0.5,
        label: "STORE FOOD · CACHE",
        reason: watchers && caution > 0.25 ? "Surplus food, but observed. Caching away from others." : "Surplus food. Caching for later.",
      });
    }
    const visible = perception.foods.find((pf) => pf.distance >= 1.7 && learning.preference(pf.food.label) > -0.35);
    if (visible) {
      const pref = learning.preference(visible.food.label);
      add({
        type: "SEARCH_FOR_FOOD",
        purpose: "food",
        target: { ...visible.food.position },
        targetId: visible.food.id,
        targetValue: 0.35 + pref * 0.35 - visible.distance / 80,
        label: `APPROACH · ${visible.food.label}`,
        reason: `Food probability: ${Math.round((0.7 + 0.29 * clamp(pref + 0.5)) * 100)}%.`,
      });
    } else {
      // search near objects with learned food associations
      let best: WorldObject | null = null;
      let bestScore = -Infinity;
      const need = this.desperation(c);
      const range = this.homeRange(c) * (1 + need.food * 1.5);
      for (const o of world.objectsNear(pos.x, pos.z, 40)) {
        if (o.kind === "mushroom" || o.kind === "pine" || o.kind === "birch" || o.kind === "lamp") continue;
        if (Math.abs(o.position.x - pos.x) > 40 || Math.abs(o.position.z - pos.z) > 40) continue;
        const d = dist2D(o.position, pos);
        if (d < 3 || d > 40) continue;
        const last = c.searched.get(o.id);
        if (last !== undefined && c.time - last < 240) continue;
        const assoc = learning.objectFood[o.kind];
        const score =
          assoc * (1 - memory.familiarityAt(o.position.x, o.position.z) * 0.35) -
          d / 70 -
          memory.dangerAt(o.position.x, o.position.z) * 0.9 * (1.25 - c.p.boldness) -
          Math.max(0, dist2D(o.position, c.homeTree.position) - range) / 12 +
          c.rng() * 0.12;
        if (score > bestScore) {
          bestScore = score;
          best = o;
        }
      }
      if (best) {
        add({
          type: "SEARCH_FOR_FOOD",
          purpose: "food",
          target: { ...best.position },
          targetId: best.id,
          targetValue: clamp(bestScore, -0.3, 0.6) * 0.35,
          label: `SEARCH · NEAR ${best.kind.toUpperCase()}`,
          reason: `Food likelihood near ${best.kind}: ${Math.round(learning.objectFood[best.kind] * 100)}%.`,
        });
      }
    }

    // ── water
    const water = perception.water.sort((a, b) => a.distance - b.distance)[0];
    if (water && s.thirst > 0.12) {
      add({
        type: "DRINK",
        purpose: "water",
        target: water.edge,
        targetId: water.water.id,
        targetValue: water.distance < 1 ? 0.1 : -water.distance / 50,
        label: `DRINK · ${water.water.name}`,
        reason: water.distance < 1 ? "Water within reach." : "Water source visible.",
      });
    }

    // ── memory-guided return
    let bestMem: Candidate | null = null;
    let bestRaw: { value: number; label: string } | null = null;
    for (const m of memory.memories) {
      if (m.type !== "food" && m.type !== "environment") continue;
      const until = c.suppressed?.get(m.id);
      if (until !== undefined && until > c.time) continue;
      // food already within reach is eaten, not travelled to
      if (reach && dist2D(m.location, reach.food.position) < 6) continue;
      const isWater = m.subtype === "water";
      if (m.type === "environment" && !isWater) continue;
      if (m.subtype === "toxic" || m.emotionalValue < -0.2) continue;
      const d = dist2D(m.location, pos);
      if (d < 4) continue;
      const need = isWater ? s.thirst : s.hunger;
      // lakes and streams do not run out: only puddles carry uncertain expectation
      const permanent = isWater && !m.label.includes("PUDDLE");
      const val = m.importance * (0.35 + 0.65 * m.confidence) * (permanent ? Math.max(0.95, m.expectation) : m.expectation) * (0.7 + 0.3 * clamp(m.emotionalValue));
      const distCost = (d / 110) * (0.35 + 0.65 * (1 - s.energy));
      const danger = routeDanger(memory, pos, m.location) * 1.4 * (1.25 - c.p.boldness);
      // hippocampal critic value at the remembered place (learned by the spiking network)
      const placeValue = c.neural ? clamp(c.neural.placeValue(m.location.x, m.location.z), -1, 1) * 0.25 : 0;
      // dehydration is urgent: rising thirst overrides the cost of a long trip to known water
      const urgency = isWater ? Math.max(0, need - 0.45) * 2.4 : 0;
      const raw = need * 2.2 * Math.pow(val, 0.7) - distCost + 0.05 + placeValue + urgency;
      const value = raw - danger;
      if (!bestRaw || raw > bestRaw.value) bestRaw = { value: raw, label: m.label };
      if (!bestMem || value > bestMem.targetValue) {
        bestMem = {
          type: "RETURN_TO_MEMORY",
          purpose: isWater ? "water" : m.subtype === "cache" ? "cache" : "food",
          target: { ...m.location },
          targetId: m.sourceId,
          memoryId: m.id,
          targetValue: value,
          drive: 0,
          utility: 0,
          q: 0,
          total: 0,
          label: `RETURN · ${m.label}`,
          reason: `Memory ${m.id} recalled · confidence ${Math.round(m.confidence * 100)}%.`,
        };
      }
    }
    if (bestMem && bestMem.purpose !== "water") {
      // known food makes blind searching less attractive
      for (const cand of out) {
        if (cand.type === "SEARCH_FOR_FOOD" && !cand.targetId?.startsWith("food")) {
          const k = Math.max(0, bestMem.targetValue) * 0.9;
          cand.targetValue -= k;
          cand.utility -= k;
        }
      }
    }
    if (bestMem) {
      if (bestRaw && bestRaw.label !== bestMem.label.replace("RETURN · ", "") && bestRaw.value > bestMem.targetValue + 0.2) {
        bestMem.avoidedDanger = bestRaw.label;
      }
      add(bestMem);
    }

    // ── exploration frontier
    {
      const exploreNeed = this.desperation(c);
      let bestT: Vector3 | null = null;
      let bestS = -Infinity;
      let rawBest = -Infinity;
      let avoided = false;
      for (let i = 0; i < 14; i++) {
        const a = c.rng() * Math.PI * 2;
        const r = 14 + c.rng() * 30;
        const tp = { x: pos.x + Math.sin(a) * r, y: 0, z: pos.z + Math.cos(a) * r };
        if (!inBounds(tp) || world.terrain.isWater(tp.x, tp.z)) continue;
        const unknown = 1 - memory.familiarityAt(tp.x, tp.z);
        const danger = Math.max(memory.dangerAt(tp.x, tp.z), routeDanger(memory, pos, tp) * 0.7);
        const beyond = Math.max(0, dist2D(tp, c.homeTree.position) - this.homeRange(c) * (1 + exploreNeed.any * 2));
        const raw = unknown - r / 120 - beyond / 18;
        const score = raw - danger * 1.8 * (1.25 - c.p.boldness);
        if (raw > rawBest) rawBest = raw;
        if (score > bestS) {
          bestS = score;
          bestT = tp;
          avoided = rawBest - score > 0.4;
        }
      }
      if (bestT) {
        add({
          type: "EXPLORE",
          purpose: "novelty",
          target: bestT,
          targetValue: bestS * 0.3,
          label: "EXPLORE · FRONTIER",
          reason:
            exploreNeed.water > 0.3
              ? "No known water source. Expanding search."
              : exploreNeed.food > 0.4
                ? "No reliable food memory. Widening range."
                : bestS > 0.5
                  ? "Unmapped region selected."
                  : "Exploring periphery of known territory.",
          avoidedDanger: avoided ? "unmapped region near danger" : undefined,
        });
      }
    }

    // ── investigate novel object
    const novel = perception.novelObjects[0];
    if (novel) {
      add({
        type: "INVESTIGATE",
        purpose: "novelty",
        target: { ...novel.object.position },
        targetId: novel.object.id,
        targetValue: novel.salience * 0.45 * s.curiosity + s.hunger * learning.objectFood[novel.object.kind] * 0.3 - novel.distance / 60,
        label: `INVESTIGATE · ${novel.object.kind.toUpperCase()}`,
        reason: "Unknown object detected.",
      });
    }

    // ── rest
    {
      const home = c.homeTree;
      const dHome = dist2D(home.position, pos);
      let spot: WorldObject = home;
      if (dHome > (world.isNight ? 120 : 40)) spot = world.nearestCover(pos, 25, true) ?? home;
      const d = dist2D(spot.position, pos);
      add({
        type: "REST",
        purpose: "rest",
        target: { ...spot.position },
        targetId: spot.id,
        targetValue: (spot === home ? 0.12 : 0) - d / 150 - c.dangerHere * 0.5,
        label: spot === home ? "REST · NEST DREY" : world.isNight ? "REST · SECONDARY DREY" : "REST · NEAREST TREE",
        reason: s.energy < 0.35 ? "Energy low. Selecting rest." : world.state.env.tempC < 0 ? "Freezing. Retreating to insulated drey." : "Returning to safe location.",
      });
    }

    // ── perch: climb to scan from height (squirrels spend much time above ground)
    {
      const tree = world.nearestCover(pos, 12, true);
      if (tree && s.anim.climbHeight < 0.5) {
        add({
          type: "PERCH",
          purpose: "safety",
          target: { ...tree.position },
          targetId: tree.id,
          targetValue: -dist2D(tree.position, pos) / 40,
          label: "PERCH · TREE",
          reason: "Climbing to survey surroundings.",
        });
      }
    }

    // ── chase a conspecific away from food
    const rival = perception.rivals[0];
    const guarding = memory.memories.some((m) => m.subtype === "cache" && rival && dist2D(m.location, rival.position) < 10);
    if (rival && rival.distance < 11 && (reach || guarding || perception.foods.some((f) => f.distance < 8))) {
      add({
        type: "CHASE",
        purpose: "social",
        target: { ...rival.position },
        targetId: rival.id,
        targetValue: 0.1 - rival.distance / 30,
        label: `CHASE · ${rival.id.toUpperCase()}`,
        reason: "Competitor near food. Displacing.",
      });
    }

    // ── observe
    add({
      type: "OBSERVE",
      purpose: "safety",
      target: null,
      targetValue: 0,
      label: "OBSERVE · SCAN",
      reason: c.dangerHere > 0.2 ? "Location associated with danger. Scanning." : "Scanning surroundings.",
    });

    return out;
  }

  select(c: DecisionContext, candidates: Candidate[]): Selection {
    const T = c.p.temperature * (1.15 - c.learning.confidence * 0.5);
    const qw = c.learning.qWeight;
    const kappa = this.neuralWeight(c);
    for (const cand of candidates) {
      cand.q = c.learning.value(c.stateKey, cand.type);
      cand.neural = c.neural ? c.neural.vote(cand.type) * kappa : 0;
      cand.total = cand.utility + qw * cand.q + cand.neural + gaussian(c.rng) * T * 0.35;
    }

    const current = c.current;
    let currentCand: Candidate | undefined;
    if (current) {
      currentCand = candidates.find((x) => x.type === current.type);
      if (currentCand) {
        // continue the current plan: keep its target rather than a freshly sampled one
        currentCand.target = current.target;
        currentCand.targetId = current.targetId;
        currentCand.memoryId = current.memoryId;
        currentCand.label = current.label;
        currentCand.total = currentCand.drive + current.score + qw * currentCand.q + (currentCand.neural ?? 0) + COMMIT_BONUS;
      } else {
        // executing plans persist even when no fresh candidate of that type exists
        const drive = this.driveUtility(current.type, c);
        currentCand = {
          type: current.type,
          purpose: current.purpose,
          target: current.target,
          targetId: current.targetId,
          memoryId: current.memoryId,
          drive,
          targetValue: current.score,
          utility: drive + current.score,
          q: c.learning.value(c.stateKey, current.type),
          total: 0,
          label: current.label,
          reason: "",
        };
        currentCand.total = currentCand.utility + qw * currentCand.q + COMMIT_BONUS;
        candidates.push(currentCand);
      }
    }

    // softmax sample
    const max = Math.max(...candidates.map((x) => x.total));
    const weights = candidates.map((x) => Math.exp((x.total - max) / Math.max(0.02, T)));
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = c.rng() * sum;
    let idx = 0;
    for (; idx < weights.length - 1; idx++) {
      r -= weights[idx];
      if (r <= 0) break;
    }
    let chosen = candidates[idx];
    let exploratory = false;
    const best = candidates.reduce((a, b) => (b.total > a.total ? b : a));
    if (chosen !== best) exploratory = true;
    // occasional deliberate sub-optimal choice
    const epsilon = 0.03 * (1 - c.learning.confidence);
    if (!current && c.rng() < epsilon) {
      const pool = candidates.filter((x) => x.type !== "FLEE" && x.type !== "HIDE");
      if (pool.length) {
        chosen = pool[Math.floor(c.rng() * pool.length)];
        exploratory = true;
      }
    }

    let switchGoal = !current;
    if (current && chosen !== currentCand) {
      const urgent = chosen.type === "FLEE" || chosen.type === "HIDE";
      const curTotal = currentCand ? currentCand.total : -Infinity;
      if (urgent && current.type !== "FLEE" && current.type !== "HIDE") switchGoal = chosen.total > curTotal - 0.1;
      else {
        // hysteresis: a freshly started plan is protected for a few seconds against marginal alternatives
        const age = c.time - current.startedAt;
        const margin = age < 8 ? 0.18 * (1 - age / 8) : 0;
        switchGoal = chosen.total > curTotal + margin;
      }
      if (!switchGoal && currentCand) chosen = currentCand;
    }

    this.lastCandidates = candidates.slice().sort((a, b) => b.total - a.total);
    return { chosen, probability: weights[candidates.indexOf(chosen)] / sum || 0, candidates, switchGoal, exploratory };
  }
}
