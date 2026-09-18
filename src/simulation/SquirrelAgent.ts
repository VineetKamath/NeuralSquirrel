import {
  ACTIONS,
  type ActionType,
  type BehaviorStats,
  type FoodSource,
  type Goal,
  type Memory,
  type Personality,
  type SquirrelState,
  type Vector3,
  type WorldObject,
} from "@/types";
import { angleTo, clamp, clone, dampAngle, dist2D, wrapAngle } from "@/utils/math";
import { gaussian, type RNG } from "@/utils/rng";
import type { Brain } from "./Brain";
import { DECISION_INTERVAL, SPEED, WORLD_HALF } from "./constants";
import type { Candidate, DecisionPolicy } from "./DecisionSystem";
import type { EventSystem } from "./EventSystem";
import { LearningSystem } from "./LearningSystem";
import type { MemorySystem } from "./MemorySystem";
import type { ActivityLevel, MotivationSystem } from "./MotivationSystem";
import { perceive, type PerceptionResult } from "./Perception";
import type { RewardSystem } from "./RewardSystem";
import type { ThreatContact, WorldModel } from "./WorldModel";
import type { NeuralBrain, ReplayStep } from "./neural/NeuralBrain";
import type { CalibrationSystem } from "./CalibrationSystem";
import type { RivalSystem } from "./RivalSystem";

export interface SimContext {
  world: WorldModel;
  memory: MemorySystem;
  learning: LearningSystem;
  rewards: RewardSystem;
  events: EventSystem;
  brain: Brain;
  motivation: MotivationSystem;
  /** swappable policy: the simulated utility/Q-learning brain, or a learned model */
  decision: DecisionPolicy;
  rng: RNG;
  personality: Personality;
  /** spiking network (hippocampus, amygdala, hypothalamus, VTA, striatum) */
  neural: NeuralBrain;
  calibration: CalibrationSystem;
  rivals: RivalSystem | null;
}

export interface AgentOptions {
  fur: SquirrelState["fur"];
  generation: number;
}

const DREY_HEIGHT = 8.5;

interface Encounter {
  start: number;
  lastSeen: number;
  contact: boolean;
  kind: string;
}

const TIMEOUTS: Record<ActionType, number> = {
  SEARCH_FOR_FOOD: 55,
  EAT: 40,
  EXPLORE: 70,
  RETURN_TO_MEMORY: 90,
  INVESTIGATE: 45,
  REST: 400,
  FLEE: 25,
  HIDE: 70,
  DRINK: 45,
  OBSERVE: 4,
  STORE_FOOD: 70,
  PERCH: 40,
  CHASE: 10,
};

const DIRECTED = new Set<ActionType>(["RETURN_TO_MEMORY", "INVESTIGATE", "REST", "HIDE", "DRINK", "STORE_FOOD", "PERCH"]);

function emptyStats(): BehaviorStats {
  return {
    distanceTravelled: 0,
    foodEaten: 0,
    foodDiscovered: 0,
    waterDrinks: 0,
    threatEncounters: 0,
    contacts: 0,
    escapes: 0,
    memoryRecalls: 0,
    recallSuccesses: 0,
    cachesMade: 0,
    cachesRetrieved: 0,
    cachesPilfered: 0,
    pilfersByRivals: 0,
    chases: 0,
    alarmCalls: 0,
    investigations: 0,
    mistakes: 0,
    decisions: 0,
    actionTime: Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<ActionType, number>,
    actionCount: Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<ActionType, number>,
    maxRadius: 0,
  };
}

export class SquirrelAgent {
  state: SquirrelState;
  prevPosition: Vector3;
  homeTree: WorldObject;
  perception: PerceptionResult | null = null;
  investigated = new Set<string>();
  knownFoodIds = new Set<string>();
  searched = new Map<string, number>();
  lastObserve = -99;
  lastSelection: { probability: number; exploratory: boolean; candidates: Candidate[] } | null = null;

  private ctx: SimContext;
  private wander = 0;
  private goalCounter = 0;
  private thinkTimer = 0;
  private progressTimer = 0;
  private progressRef = Infinity;
  private stuckTime = 0;
  private pauseTimer = 0;
  private scanPhase = 0;
  private encounters = new Map<string, Encounter>();
  private excursion = { active: false, locations: [] as string[] };
  private destinationHistory: string[] = [];
  private eatHistory: string[] = [];
  private freshCells = 0;
  private climbAngle = 0;
  private memoryLocAtStart: Vector3 | null = null;
  private threatSeenDuringGoal = false;
  private lastMemoryRefresh = new Map<string, number>();
  private bootTimer = 0;
  private boutStart: number | null = null;
  /** today's trajectory in place-cell coordinates, for sleep replay */
  replayBuffer: ReplayStep[] = [];
  private lastPlace = -1;
  private replayTimer = 0;
  lastPerch = -999;
  private dreyNight = false;

  constructor(ctx: SimContext, options: AgentOptions = { fur: "Gray", generation: 1 }) {
    this.ctx = ctx;
    const { world, rng } = ctx;
    const home = world.state.objects.find((o) => o.landmarkId && world.state.landmarks.find((l) => l.id === o.landmarkId)?.name === "NEST OAK")!;
    this.homeTree = home;
    const a = rng() * Math.PI * 2;
    const start = { x: home.position.x + Math.sin(a) * 2.8, y: 0, z: home.position.z + Math.cos(a) * 2.8 };
    start.y = world.surfaceHeight(start.x, start.z);
    this.prevPosition = clone(start);
    this.state = {
      position: start,
      velocity: { x: 0, y: 0, z: 0 },
      hunger: 0.3 + rng() * 0.08,
      thirst: 0.22 + rng() * 0.08,
      energy: 0.82,
      curiosity: 0.55 + ctx.personality.curiosityBase * 0.2,
      fear: 0.12,
      safety: 0.8,
      health: 1,
      warmth: 0.8,
      piError: { x: 0, z: 0 },
      alive: true,
      generation: options.generation,
      bornAt: world.state.time,
      fur: options.fur,
      confidence: 0.2,
      currentGoal: null,
      memories: ctx.memory.memories,
      preferences: [],
      learnedLocations: ctx.memory.learnedLocations,
      behaviorStats: emptyStats(),
      anim: {
        pose: "stand",
        gaitPhase: 0,
        speed: 0,
        heading: a + Math.PI,
        headYaw: 0,
        headPitch: 0,
        tailFlick: 0,
        climbHeight: 0,
        hidden: false,
        carrying: false,
        calling: 0,
      },
      injuredTimer: 0,
    };
  }

  /** where the subject believes it is: true position plus path-integration error */
  get believed() {
    const s = this.state;
    return { x: s.position.x + s.piError.x, y: s.position.y, z: s.position.z + s.piError.z };
  }

  private fleeRetries = 0;

  get inDrey() {
    const a = this.state.anim;
    // home drey, or one of the secondary dreys squirrels keep across their range
    return a.climbTreeId !== null && a.climbHeight > 5.5 && this.state.currentGoal?.type === "REST";
  }

  private get time() {
    return this.ctx.world.state.time;
  }

  get subjectView() {
    const s = this.state;
    return {
      id: "subject",
      position: s.position,
      climbHeight: s.anim.climbHeight,
      underCover: s.anim.hidden,
      resting: s.anim.pose === "sleep",
    };
  }

  stateKey() {
    const s = this.state;
    const knowsFood = this.ctx.memory.memories.some((m) => m.type === "food" && m.expectation * m.confidence > 0.22);
    return LearningSystem.stateKey(s.hunger, s.energy, s.fear, knowsFood, (this.perception?.threats.length ?? 0) > 0);
  }

  // ─────────────────────────────── main loop ───────────────────────────────

  update(dt: number) {
    const s = this.state;
    this.prevPosition.x = s.position.x;
    this.prevPosition.y = s.position.y;
    this.prevPosition.z = s.position.z;
    if (!s.alive) {
      s.anim.speed = 0;
      s.anim.pose = "sleep";
      return;
    }
    this.bootTimer += dt;
    if (s.injuredTimer > 0) s.injuredTimer -= dt;
    s.anim.tailFlick = Math.max(0, s.anim.tailFlick - dt * 1.5);
    // spontaneous tail twitches, more frequent when wary (calibrated against census tail twitch rate)
    const cal = this.ctx.calibration;
    const twitchRate = (0.012 + s.fear * 0.12) * (1 + cal.bias.tail_twitches * 4);
    if (this.ctx.rng() < dt * twitchRate && s.anim.pose !== "sleep") {
      s.anim.tailFlick = Math.max(s.anim.tailFlick, 0.35);
      cal.noteTwitch(this.time);
    }
    s.anim.calling = Math.max(0, s.anim.calling - dt * 0.7);

    if (this.bootTimer < 7) {
      // initial orientation: stillness, then scanning the environment
      s.anim.speed = 0;
      s.anim.pose = this.bootTimer < 2.5 ? "stand" : "alert";
      s.anim.headYaw = this.bootTimer < 2.5 ? 0 : Math.sin((this.bootTimer - 2.5) * 1.4) * 0.9;
    } else if (s.currentGoal) {
      s.behaviorStats.actionTime[s.currentGoal.type] += dt;
      this.execute(s.currentGoal, dt);
    } else {
      s.anim.speed = 0;
      s.anim.pose = s.fear > 0.4 ? "alert" : "stand";
    }

    s.anim.gaitPhase += dt * (s.anim.speed > 0.05 ? 1.2 + s.anim.speed * 1.35 : 0);
    const moved = dist2D(s.position, this.prevPosition);
    s.velocity.x = (s.position.x - this.prevPosition.x) / dt;
    s.velocity.z = (s.position.z - this.prevPosition.z) / dt;
    s.behaviorStats.distanceTravelled += moved;
    if (moved > 0) {
      this.ctx.memory.recordStep(s.position, moved);
      // path integration drift grows with distance travelled, less with navigation skill
      const drift = moved * 0.018 * (1.1 - this.ctx.learning.navSkill);
      s.piError.x += gaussian(this.ctx.rng) * drift;
      s.piError.z += gaussian(this.ctx.rng) * drift;
    }
    this.ctx.calibration.observe(dt, s, this.time, this.ctx.world.hourFloat, this.ctx.world.state.env.sunElevation);
    const r = dist2D(s.position, this.homeTree.position);
    if (r > s.behaviorStats.maxRadius) s.behaviorStats.maxRadius = r;

    this.thinkTimer += dt;
    if (this.thinkTimer >= DECISION_INTERVAL) {
      this.think(this.thinkTimer);
      this.thinkTimer = 0;
    }
  }

  private activity(): ActivityLevel {
    const a = this.state.anim;
    if (a.pose === "sleep") return "sleep";
    if (a.pose === "climb" && a.speed > 0.1) return "climb";
    if (a.speed > 3) return "run";
    if (a.speed > 0.3) return "walk";
    if (a.pose === "sit" || a.pose === "eat" || a.pose === "drink") return "rest";
    return "idle";
  }

  private think(dt: number) {
    const { world, memory, learning, motivation, decision, brain, rewards, personality } = this.ctx;
    const s = this.state;
    const goal = s.currentGoal;

    this.perception = perceive(world, {
      position: s.position,
      vigilance: learning.vigilance,
      observing: s.anim.pose === "alert" || s.anim.climbHeight > 1,
      sleeping: s.anim.pose === "sleep",
      climbHeight: s.anim.climbHeight,
      investigating: s.anim.pose === "sniff" || goal?.type === "INVESTIGATE",
      investigated: this.investigated,
      knownFoodIds: this.knownFoodIds,
      rivals: this.ctx.rivals?.views(),
    });
    const per = this.perception;

    this.processPerception(per, dt);

    const dangerHere = memory.dangerAt(s.position.x, s.position.z);
    const env = world.state.env;
    motivation.update(s, personality, dt, {
      activity: this.activity(),
      night: world.isNight,
      raining: world.state.rainAmount > 0.5,
      dangerHere,
      threatLevel: per.threatLevel,
      novelty: per.novelty,
      explored: memory.exploredFraction(),
      cover: s.anim.climbHeight > 1 || s.anim.hidden ? 1 : world.coverAt(s.position.x, s.position.z),
      tempC: env.tempC,
      inDrey: this.inDrey,
      snow: env.snowDepthM > 0.02,
    });
    this.runNeural(dt, per, dangerHere);
    if (s.health <= 0) {
      s.alive = false;
      return;
    }
    memory.decay(dt, this.time);
    s.memories = memory.memories;
    for (const f of memory.forgotten) {
      if (f.type !== "environment" || f.subtype) this.ctx.events.add(this.time, `memory decayed: ${f.label.toLowerCase()}`, "memory");
      this.ctx.events.milestone("FIRST_FORGETTING", this.time, "first memory lost to decay", "memory", {
        title: "MEMORY DECAY OBSERVED",
        detail: `Memory ${f.id} (${f.label}) fell below retention threshold after ${f.recallCount} recalls and was discarded. Unused information is not retained indefinitely.`,
        metrics: [
          { label: "RECALLS", value: String(f.recallCount) },
          { label: "RETENTION", value: `${Math.round(personality.retention * 100)}%` },
        ],
        location: f.location,
      });
    }
    learning.decay(dt / 480);
    rewards.decay(dt);

    if (this.boutStart === null && s.hunger > 0.32) this.boutStart = this.time;
    if (s.hunger > 0.85) rewards.silent(-0.02 * dt);
    if (s.hunger > 0.9) brain.think(this.time, "Energy reserves critical. Food priority maximal.", "alert", 20);
    else if (s.energy < 0.25) brain.think(this.time, "Energy low.", "info", 20);

    if (this.bootTimer >= 7) this.decide(dangerHere);

    this.updateBrain(dt, per);
    s.confidence = learning.confidence;
  }

  private decide(dangerHere: number) {
    const { world, memory, learning, decision, motivation, personality, rng } = this.ctx;
    const s = this.state;
    const ctx = {
      s,
      p: personality,
      world,
      memory,
      learning,
      perception: this.perception!,
      rng,
      time: this.time,
      stateKey: this.stateKey(),
      current: s.currentGoal,
      lastObserve: this.lastObserve,
      searched: this.searched,
      homeTree: this.homeTree,
      habituation: motivation.habituation,
      dangerHere,
      neural: this.ctx.neural,
      calibration: this.ctx.calibration,
      lastPerch: this.lastPerch,
      audienceCaution: learning.audienceCaution,
      suppressed: this.suppressed,
    };
    const cands = decision.build(ctx);
    const sel = decision.select(ctx, cands);
    this.lastSelection = { probability: sel.probability, exploratory: sel.exploratory, candidates: decision.lastCandidates };
    if (sel.switchGoal) {
      if (s.currentGoal) this.endGoal("interrupted");
      this.startGoal(sel.chosen, sel.exploratory, sel.probability);
    }
  }

  // ─────────────────────────────── spiking network ───────────────────────────────

  private runNeural(dt: number, per: PerceptionResult, dangerHere: number) {
    const { neural, rewards, world, events, brain } = this.ctx;
    const s = this.state;
    const b = this.believed;
    const heading = s.anim.heading;
    const bearing = (p: Vector3 | undefined) => (p ? wrapAngle(angleTo(s.position, p) - heading) : null);
    const food = per.foods[0];
    const threat = per.threats[0];
    const water = per.water[0];
    const rival = per.rivals[0];
    const windowMs = this.neuralWindowMs;
    const reward = rewards.takeWindowReward();
    const before = neural.placeCount;
    const { place } = neural.runWindow(
      {
        believed: { x: b.x, z: b.z },
        heading,
        foodBearing: bearing(food?.food.position),
        foodSalience: food ? clamp(1.2 - food.distance / 12) : 0,
        threatBearing: bearing(threat?.threat.position),
        threatLevel: per.threatLevel,
        waterBearing: bearing(water?.edge),
        waterSalience: water ? clamp(1 - water.distance / 40) * s.thirst : 0,
        rivalBearing: bearing(rival?.position),
        rivalSalience: rival ? clamp(1 - rival.distance / 15) : 0,
        novelty: per.novelty,
        curiosity: s.curiosity,
        hunger: s.hunger,
        thirst: s.thirst,
        fatigue: 1 - s.energy,
        cold: clamp((8 - world.state.env.tempC) / 20) * (this.inDrey ? 0.2 : 1),
        fear: s.fear,
        dangerHere,
        motor: clamp(s.anim.speed / 4.5),
        executing: s.currentGoal?.type ?? null,
        sleeping: s.anim.pose === "sleep",
      },
      windowMs,
      Math.max(0, dt * 1000 - windowMs),
      reward,
      this.time
    );
    if (neural.placeCount > before && neural.placeCount % 40 === 0) {
      events.add(this.time, `neurogenesis: ${neural.placeCount} place cells`, "neural");
    }
    if (neural.placeCount >= 60) {
      events.milestone("PLACE_MAP_FORMED", this.time, "hippocampal place map formed", "neural", {
        title: "PLACE MAP FORMED",
        detail: `${neural.placeCount} place cells now tile the explored area. Each fires when the subject believes it is inside its field, forming the substrate for the value map learned by dopamine signals.`,
        metrics: [
          { label: "PLACE CELLS", value: String(neural.placeCount) },
          { label: "EXPLORED", value: `${Math.round(this.ctx.memory.exploredFraction() * 100)}%` },
        ],
      });
    }
    if (Math.abs(neural.delta) > 0.4) brain.think(this.time, neural.delta > 0 ? `Dopamine burst · RPE +${neural.delta.toFixed(2)}` : `Dopamine dip · RPE ${neural.delta.toFixed(2)}`, "decision", 8);
    // trajectory for sleep replay
    if (place >= 0 && place !== this.lastPlace && s.anim.pose !== "sleep") {
      this.lastPlace = place;
      this.replayBuffer.push({ place, action: s.currentGoal ? ACTIONS.indexOf(s.currentGoal.type) : -1, reward: 0, x: s.position.x, z: s.position.z });
      if (this.replayBuffer.length > 1500) this.replayBuffer.shift();
    }
    if (reward !== 0 && this.replayBuffer.length) this.replayBuffer[this.replayBuffer.length - 1].reward += reward;
  }

  /** window length adapts to simulation speed to bound cost */
  neuralWindowMs = 50;

  /** sleep: replay the most rewarding recent trajectories in reverse */
  private sleepReplay() {
    const { neural, events, brain } = this.ctx;
    const buf = this.replayBuffer;
    let best = -1;
    let bestR = 0.15;
    for (let i = 0; i < buf.length; i++) {
      if (Math.abs(buf[i].reward) > bestR) {
        bestR = Math.abs(buf[i].reward);
        best = i;
      }
    }
    if (best < 0) return;
    const seq = buf.slice(Math.max(0, best - 18), best + 1);
    buf[best].reward *= 0.3; // replayed memories lose priority
    const ev = neural.replay(seq, this.time);
    if (!ev) return;
    brain.stimulate("MEMORY", 1.2);
    brain.stimulate("REWARD", 0.6);
    brain.think(this.time, `Sharp-wave ripple · replaying ${ev.length}-step route`, "memory", 10);
    events.add(this.time, `sleep replay of a ${ev.reward > 0 ? "rewarded" : "punished"} route (${ev.length} places)`, "neural");
    events.milestone("FIRST_REPLAY", this.time, "first hippocampal replay during sleep", "neural", {
      title: "REPLAY DURING SLEEP",
      detail: `While asleep, place cells reactivated a ${ev.length}-step trajectory in reverse, time-compressed like a sharp-wave ripple. The dopamine-gated value map and action synapses were updated offline, without the subject moving.`,
      metrics: [
        { label: "SEQUENCE", value: `${ev.length} PLACES` },
        { label: "REWARD", value: ev.reward.toFixed(2) },
        { label: "MEAN TD ERROR", value: ev.meanDelta.toFixed(3) },
      ],
      location: seq[seq.length - 1] ? { x: seq[seq.length - 1].x, y: 0, z: seq[seq.length - 1].z } : undefined,
    });
  }

  /** a new day: yesterday's trajectory is no longer replayed */
  onNewDay() {
    this.replayBuffer = this.replayBuffer.slice(-200);
    if (this.ctx.learning.audienceCaution > 0) this.ctx.learning.audienceCaution *= 0.97;
  }

  // ─────────────────────────────── perception ───────────────────────────────

  private processPerception(per: PerceptionResult, dt: number) {
    const { memory, rewards, events, brain, learning, world } = this.ctx;
    const s = this.state;
    const t = this.time;

    const fresh = memory.observeArea(s.position, per.visionRange * 0.65, dt);
    if (fresh > 0) {
      this.freshCells += fresh;
      s.curiosity = clamp(s.curiosity - fresh * 0.01);
      rewards.silent(fresh * 0.012);
    }

    // food
    for (const pf of per.foods) {
      const f = pf.food;
      if (!this.knownFoodIds.has(f.id)) {
        this.knownFoodIds.add(f.id);
        if (f.createdBySubject) continue;
        s.behaviorStats.foodDiscovered++;
        const obj = f.objectId ? world.state.objects.find((o) => o.id === f.objectId) : undefined;
        const lm = obj?.landmarkId ? world.state.landmarks.find((l) => l.id === obj.landmarkId) : undefined;
        const label = lm ? `${f.label} · ${lm.name}` : f.label;
        const { memory: m, isNew } = memory.form({
          type: "food",
          location: { x: f.position.x + s.piError.x, y: f.position.y, z: f.position.z + s.piError.z },
          label,
          importance: f.hidden ? 0.85 : 0.55,
          emotionalValue: 0.5,
          time: t,
          sourceId: f.id,
          subtype: f.kind,
          noise: 6,
        });
        rewards.emit(t, f.hidden ? 0.92 : 0.8, f.hidden ? "HIDDEN CACHE DISCOVERED" : "FOOD DISCOVERED");
        brain.cascade(["VISION", "MEMORY", "HUNGER", "DECISION"], 0.9);
        brain.stimulate("REWARD", 0.8);
        brain.think(t, f.hidden ? "Concealed food detected by scent." : `Food detected: ${f.label.toLowerCase()}.`, "alert", 2);
        brain.think(t, `Food probability: ${Math.round(80 + rngLike(f.id) * 18)}%.`, "decision", 2);
        if (obj) learning.foodAssociation(obj.kind, true);
        events.add(t, `discovered ${f.label.toLowerCase()}`, "discovery", { location: f.position });
        if (isNew) events.add(t, `formed spatial memory ${m.id}`, "memory", { memoryId: m.id });
        const d = dist2D(f.position, this.homeTree.position);
        events.milestone("FIRST_FOOD", t, "first food source discovered", "discovery", {
          title: "FIRST FOOD SOURCE",
          detail: `Subject located ${f.label.toLowerCase()} ${d.toFixed(1)} m from the nest tree without guidance. A spatial memory was encoded at the location.`,
          metrics: [
            { label: "DISTANCE FROM NEST", value: `${d.toFixed(1)} m` },
            { label: "ENCODING PRECISION", value: `${Math.round(memory.encodingPrecision * 100)}%` },
          ],
          memoryId: m.id,
          location: f.position,
        });
        if (f.hidden) {
          events.milestone("FIRST_CACHE_RETRIEVAL", t, "hidden cache discovered", "discovery", {
            title: "HIDDEN CACHE DISCOVERED",
            detail: `Subject detected a concealed food cache (${f.amount | 0} units) by close inspection. The location was not visible from a distance.`,
            metrics: [{ label: "CACHE SIZE", value: `${f.amount | 0} UNITS` }],
            memoryId: m.id,
            location: f.position,
          });
        }
        this.firstMemory(m);
      } else if (pf.distance < 6) {
        const m = memory.bySource(f.id, "food");
        const last = this.lastMemoryRefresh.get(f.id) ?? -999;
        if (m && t - last > 30) {
          this.lastMemoryRefresh.set(f.id, t);
          memory.form({ type: "food", location: f.position, label: m.label, importance: 0.1, emotionalValue: m.emotionalValue, time: t, sourceId: f.id });
          m.expectation = clamp(m.expectation + 0.2);
          brain.stimulate("MEMORY", 0.5);
          brain.think(t, "Previous food found here.", "memory", 15);
        }
      }
    }

    // water
    for (const pw of per.water) {
      const existing = memory.bySource(pw.water.id, "environment");
      if (!existing) {
        const { memory: m } = memory.form({
          type: "environment",
          location: pw.edge,
          label: `WATER · ${pw.water.name}`,
          importance: pw.water.kind === "puddle" ? 0.3 : 0.65,
          emotionalValue: 0.4,
          time: t,
          sourceId: pw.water.id,
          subtype: "water",
          noise: 3,
        });
        rewards.emit(t, 0.35, "WATER SOURCE FOUND");
        brain.cascade(["VISION", "MEMORY", "DECISION"], 0.6);
        events.add(t, `located ${pw.water.kind === "puddle" ? "rain puddle" : pw.water.name.toLowerCase()}`, "discovery", { memoryId: m.id, location: pw.edge });
        this.firstMemory(m);
      }
    }

    // threats
    const seen = new Set<string>();
    for (const pt of per.threats) {
      const th = pt.threat;
      seen.add(th.id);
      let enc = this.encounters.get(th.id);
      if (!enc) {
        enc = { start: t, lastSeen: t, contact: false, kind: th.kind };
        this.encounters.set(th.id, enc);
        s.behaviorStats.threatEncounters++;
        this.threatSeenDuringGoal = true;
        const ground = th.kind === "dog";
        const label = ground ? "THREAT · DOG" : "PREDATOR · RED-TAILED HAWK";
        const { memory: m } = memory.form({
          type: "danger",
          location: ground ? th.position : s.position,
          label,
          importance: 0.7,
          emotionalValue: ground ? -0.6 : -0.45,
          time: t,
          noise: 4,
        });
        if (ground) memory.markDanger(th.position, 0.25);
        rewards.emit(t, -0.35, "THREAT ENCOUNTER");
        brain.cascade(["VISION", "FEAR", "DECISION", "MOTOR"], 1);
        // alarm calls as defined in the census: quaas for ground predators, moans for aerial ones
        const call = ground ? "QUAA" : "MOAN";
        brain.think(t, `Threat detected · alarm call (${call.toLowerCase()})`, "alert", 2);
        s.anim.tailFlick = 1;
        s.anim.calling = 1;
        s.behaviorStats.alarmCalls++;
        this.ctx.calibration.noteAlarm(t);
        events.add(t, ground ? "detected a dog · quaa alarm call" : "detected a hawk · moan alarm call", "danger", { memoryId: m.id, location: th.position });
        events.milestone("FIRST_DANGER", t, "first predator encounter", "danger", {
          title: "FIRST THREAT ENCOUNTER",
          detail: `${ground ? "A dog" : "A red-tailed hawk"} came within ${pt.distance.toFixed(1)} m. The subject gave a ${call.toLowerCase()} alarm call and flagged its tail; fear rose and a danger association was stored at the location.`,
          metrics: [
            { label: "DETECTION RANGE", value: `${pt.distance.toFixed(1)} m` },
            { label: "FEAR", value: `${Math.round(s.fear * 100)}%` },
          ],
          memoryId: m.id,
          location: th.position,
        });
        this.firstMemory(m);
      } else {
        enc.lastSeen = t;
      }
      if (s.curiosity > 0.4 && s.fear > s.curiosity) brain.think(t, "Risk exceeds curiosity.", "decision", 12);
    }
    for (const [id, enc] of this.encounters) {
      if (seen.has(id) || t - enc.lastSeen < 8) continue;
      this.encounters.delete(id);
      learning.threatOutcome(enc.contact);
      if (!enc.contact) {
        learning.ema("dangerAvoidance", 1, 0.15);
        s.behaviorStats.escapes++;
        events.add(t, "avoided predator", "danger");
        events.milestone("FIRST_ESCAPE", t, "first successful escape", "danger", {
          title: "FIRST ESCAPE",
          detail: `Subject evaded a ${enc.kind === "dog" ? "dog" : "hawk"} without contact. Encounter duration ${(t - enc.start).toFixed(0)} s. Vigilance increased.`,
          metrics: [
            { label: "VIGILANCE", value: `${Math.round(learning.vigilance * 100)}%` },
            { label: "DANGER AVOIDANCE", value: `${Math.round(learning.metrics.dangerAvoidance * 100)}%` },
          ],
        });
      }
    }

    // other squirrels
    for (const r of per.rivals) {
      if (r.distance > 10) continue;
      const existing = memory.memories.find((m) => m.type === "social" && m.sourceId === r.id);
      if (!existing) {
        memory.form({ type: "social", location: r.position, label: `CONSPECIFIC · ${r.id.toUpperCase()}`, importance: 0.3, emotionalValue: -0.1, time: t, sourceId: r.id, noise: 3 });
        events.add(t, `encountered another squirrel (${r.id})`, "social");
      }
      if (r.caching) brain.think(t, "Observed a conspecific caching.", "memory", 20);
      // close encounters with other squirrels provoke chirpy "kuk" calls and tail flagging
      if (r.distance < 4 && this.ctx.rng() < dt * 0.03) {
        this.ctx.calibration.noteAlarm(t);
        s.anim.tailFlick = Math.max(s.anim.tailFlick, 0.6);
        s.anim.calling = Math.max(s.anim.calling, 0.6);
        brain.think(t, "Kuk call · conspecific nearby.", "info", 30);
      }
    }

    // landmarks and locations
    for (const lm of per.landmarks) {
      // visual landmarks re-anchor the path-integration estimate
      if (dist2D(lm.position, s.position) < 14) {
        s.piError.x *= 0.6;
        s.piError.z *= 0.6;
      }
      if (memory.bySource(lm.id, "landmark")) continue;
      if (dist2D(lm.position, s.position) > per.visionRange * 0.9 + lm.radius) continue;
      const { memory: m } = memory.form({
        type: "landmark",
        location: lm.position,
        label: lm.name,
        importance: lm.name === "NEST OAK" ? 0.9 : 0.4,
        emotionalValue: lm.name === "NEST OAK" ? 0.5 : 0.1,
        time: t,
        sourceId: lm.id,
        noise: 2,
      });
      if (lm.name !== "NEST OAK") {
        rewards.emit(t, 0.19, "NEW LANDMARK");
        events.add(t, `mapped landmark: ${lm.name.toLowerCase()}`, "memory", { memoryId: m.id, location: lm.position });
        this.firstMemory(m);
      }
      brain.stimulate("MEMORY", 0.6);
    }
    const visited = memory.visitLocations(s.position, world.state.landmarks, t);
    if (visited) {
      if (visited.visits > 1) {
        brain.think(t, "Location recognized.", "memory", 20);
        brain.stimulate("MEMORY", 0.5);
      }
      if (this.excursion.active && visited.name !== "NEST OAK" && !this.excursion.locations.includes(visited.name)) {
        this.excursion.locations.push(visited.name);
      }
    }

    if (per.novelObjects[0] && per.novelObjects[0].salience > 0.45) {
      brain.think(t, "Unknown object detected.", "info", 25);
      brain.stimulate("CURIOSITY", 0.3);
    }

    // excursion loops
    const dHome = dist2D(s.position, this.homeTree.position);
    if (!this.excursion.active && dHome > 22) this.excursion = { active: true, locations: [] };
    if (this.excursion.active && dHome < 6) {
      if (this.excursion.locations.length >= 2) {
        const route = ["NEST OAK", ...this.excursion.locations, "NEST OAK"].join(" → ");
        events.add(t, `completed exploration loop (${this.excursion.locations.length} sites)`, "behavior");
        events.milestone("FIRST_EXPLORATION_LOOP", t, "first closed exploration loop", "behavior", {
          title: "EXPLORATION LOOP DETECTED",
          detail: `Subject left the nest, visited ${this.excursion.locations.length} distinct locations and returned without external guidance.\n${route}`,
          metrics: [{ label: "SITES VISITED", value: String(this.excursion.locations.length) }],
          location: this.homeTree.position,
        });
      }
      this.excursion.active = false;
    }
  }

  private firstMemory(m: Memory) {
    this.ctx.events.milestone("FIRST_MEMORY", this.time, "first memory formed", "memory", {
      title: "FIRST MEMORY FORMED",
      detail: `Memory ${m.id} encoded: ${m.label}. Type ${m.type.toUpperCase()}. Stored location contains positional error proportional to encoding precision.`,
      metrics: [
        { label: "CONFIDENCE", value: `${Math.round(m.confidence * 100)}%` },
        { label: "IMPORTANCE", value: m.importance.toFixed(2) },
      ],
      memoryId: m.id,
      location: m.location,
    });
  }

  onContact(c: ThreatContact) {
    const { memory, rewards, events, brain, learning } = this.ctx;
    const s = this.state;
    const t = this.time;
    s.behaviorStats.contacts++;
    s.injuredTimer = 5;
    s.energy = clamp(s.energy - 0.25);
    s.health = clamp(s.health - (c.kind === "hawk" ? 0.55 : 0.3) * (0.7 + this.ctx.rng() * 0.6));
    s.fear = 1;
    s.anim.tailFlick = 1;
    const enc = this.encounters.get(c.threatId);
    if (enc) enc.contact = true;
    else this.encounters.set(c.threatId, { start: t, lastSeen: t, contact: true, kind: c.kind });
    learning.ema("dangerAvoidance", 0, 0.2);
    const { memory: m } = memory.form({
      type: "danger",
      location: s.position,
      label: c.kind === "dog" ? "ATTACK · DOG" : "ATTACK · HAWK",
      importance: 0.95,
      emotionalValue: -1,
      time: t,
      noise: 2,
    });
    memory.markDanger(s.position, c.kind === "dog" ? 0.9 : 0.35);
    memory.associateLocation(s.position, 0, -0.8);
    rewards.emit(t, -1, "PREDATOR CONTACT");
    brain.cascade(["FEAR", "MEMORY", "DECISION", "MOTOR"], 1.3);
    brain.think(t, "Physical contact with predator.", "alert", 1);
    brain.think(t, "Danger association encoded.", "memory", 1);
    events.add(t, `predator contact (${c.kind})`, "danger", {
      major: !events.has("FIRST_DANGER"),
      title: "PREDATOR CONTACT",
      detail: "Subject was reached by a predator and escaped with an energy penalty. The location is now strongly associated with danger.",
      memoryId: m.id,
      location: s.position,
    });
    // reflexive escape
    if (s.currentGoal) this.endGoal("fail");
    const threat = this.ctx.world.state.threats.find((x) => x.id === c.threatId);
    const away = threat ? angleTo(threat.position, s.position) : s.anim.heading;
    const target = {
      x: clamp(s.position.x + Math.sin(away) * 20, -WORLD_HALF + 6, WORLD_HALF - 6),
      y: 0,
      z: clamp(s.position.z + Math.cos(away) * 20, -WORLD_HALF + 6, WORLD_HALF - 6),
    };
    this.startGoal(
      {
        type: "FLEE",
        purpose: "safety",
        target,
        threatId: c.threatId,
        drive: 1,
        targetValue: 1,
        utility: 2,
        q: 0,
        total: 2,
        label: "FLEE · REFLEX",
        reason: "Escape reflex.",
      },
      false,
      1
    );
  }

  // ─────────────────────────────── goals ───────────────────────────────

  private recentStarts: { label: string; t: number }[] = [];
  /** memories temporarily ignored after repeated fruitless attempts (frustration) */
  suppressed = new Map<string, number>();

  private startGoal(c: Candidate, exploratory: boolean, probability: number) {
    const { memory, events, brain, learning, rewards } = this.ctx;
    const s = this.state;
    const t = this.time;
    rewards.takeGoalReward();
    this.recentStarts.push({ label: c.label, t });
    this.recentStarts = this.recentStarts.filter((r) => t - r.t < 60);
    if (c.type !== "EAT" && c.type !== "REST" && this.recentStarts.filter((r) => r.label === c.label).length >= 4) {
      if (c.memoryId) this.suppressed.set(c.memoryId, t + 150);
      if (c.targetId) this.searched.set(c.targetId, t);
      brain.think(t, "Repeated attempt without outcome. Giving up on this target.", "decision", 20);
      this.recentStarts = [];
    }
    this.fleeRetries = 0;
    const goal: Goal = {
      id: ++this.goalCounter,
      type: c.type,
      purpose: c.purpose,
      target: c.target ? clone(c.target) : null,
      targetId: c.targetId,
      memoryId: c.memoryId,
      threatId: c.threatId,
      startedAt: t,
      timeout: c.type === "OBSERVE" ? 2.5 + this.ctx.rng() * 2 : TIMEOUTS[c.type],
      phase: "travel",
      phaseTimer: 0,
      stateKey: this.stateKey(),
      score: c.targetValue,
      rewardAccum: 0,
      startPos: clone(s.position),
      pathLength: 0,
      directed: DIRECTED.has(c.type) || (c.type === "SEARCH_FOR_FOOD" && !!c.targetId?.startsWith("food")),
      label: c.label,
    };
    s.currentGoal = goal;
    s.behaviorStats.decisions++;
    s.behaviorStats.actionCount[c.type]++;
    this.progressRef = Infinity;
    this.progressTimer = 0;
    this.stuckTime = 0;
    this.freshCells = 0;
    this.threatSeenDuringGoal = false;
    this.memoryLocAtStart = null;
    learning.decisionConfidence += (probability - learning.decisionConfidence) * 0.08;

    brain.stimulate("DECISION", 0.75);
    if (c.reason) brain.think(t, c.reason, c.type === "FLEE" || c.type === "HIDE" ? "alert" : "decision", 4);
    if (exploratory && c.type !== "FLEE") brain.think(t, "Low-probability option selected.", "decision", 30);

    if (c.type === "OBSERVE") this.lastObserve = t;
    if (c.type === "PERCH") this.lastPerch = t;
    if (c.type === "REST") brain.think(t, s.energy < 0.4 ? "Selecting rest." : "Returning to safe location.", "decision", 15);

    if (c.memoryId) {
      const m = memory.memories.find((x) => x.id === c.memoryId);
      if (m) {
        memory.recall(m, t);
        s.behaviorStats.memoryRecalls++;
        this.memoryLocAtStart = clone(m.location);
        brain.cascade(["MEMORY", "NAVIGATION", "DECISION", "MOTOR"], 0.8);
        const assoc = memory.associations(m.location, 12);
        if (assoc.danger < -0.1 && assoc.food > 0.1) {
          events.milestone("MEMORY_RECALL", t, "returning to a location with mixed associations", "memory", {
            title: "MEMORY RECALL",
            detail: `Subject is returning to a location previously associated with both food and danger. Expected value outweighed learned risk.`,
            metrics: [
              { label: "FOOD", value: `+${assoc.food.toFixed(2)}` },
              { label: "DANGER", value: `−${Math.abs(assoc.danger).toFixed(2)}` },
              { label: "CONFIDENCE", value: `${Math.round(m.confidence * 100)}%` },
            ],
            memoryId: m.id,
            location: m.location,
          });
        }
      }
    }

    if (c.avoidedDanger) {
      learning.ema("dangerAvoidance", 0.9, 0.05);
      events.add(t, "route adjusted to avoid danger zone", "learning");
      brain.think(t, "Known danger on route. Alternative selected.", "memory", 20);
      brain.stimulate("FEAR", 0.3);
      events.milestone("AVOIDANCE_LEARNED", t, "learned avoidance of danger zone", "learning", {
        title: "AVOIDANCE BEHAVIOR DETECTED",
        detail: `Subject rejected a higher-value option (${c.avoidedDanger.toLowerCase()}) because its route crossed a location associated with danger. No rule for this was programmed; it follows from stored danger associations.`,
        metrics: [
          { label: "DANGER AVOIDANCE", value: `${Math.round(learning.metrics.dangerAvoidance * 100)}%` },
          { label: "DANGER MEMORIES", value: String(memory.memories.filter((m) => m.type === "danger").length) },
        ],
      });
    }

    // preference detection from repeated destinations
    if (goal.directed && goal.target && (c.type === "RETURN_TO_MEMORY" || c.type === "SEARCH_FOR_FOOD")) {
      const loc = memory.nearestLocation(goal.target, 14);
      if (loc && memory.learnedLocations.length >= 3) {
        this.destinationHistory.push(loc.name);
        if (this.destinationHistory.length > 10) this.destinationHistory.shift();
        this.checkPreference(loc.name, "location");
      }
    }
  }

  private checkPreference(name: string, kind: "location" | "food") {
    const { events, brain } = this.ctx;
    const s = this.state;
    const hist = kind === "location" ? this.destinationHistory.slice(-8) : this.eatHistory.slice(-10);
    const count = hist.filter((h) => h === name).length;
    if (hist.length < (kind === "location" ? 8 : 10)) return;
    const threshold = kind === "location" ? 4 : 6;
    if (name === "NEST OAK" && kind === "location") return;
    if (count < threshold) return;
    const existing = s.preferences.find((p) => p.label === name);
    if (existing) {
      existing.strength = clamp(count / hist.length);
      return;
    }
    s.preferences.push({ id: `P-${s.preferences.length + 1}`, label: name, kind, strength: count / hist.length, detectedAt: this.time });
    brain.stimulate("MEMORY", 0.6);
    brain.stimulate("DECISION", 0.6);
    const text = kind === "location" ? `preference formed: ${name.toLowerCase()}` : `food preference: ${name.toLowerCase()}`;
    const major = !events.has("FIRST_PREFERENCE");
    events.add(this.time, text, "behavior", { major: false });
    events.milestone("FIRST_PREFERENCE", this.time, "behavioral preference detected", "behavior", {
      title: "BEHAVIORAL PREFERENCE DETECTED",
      detail:
        kind === "location"
          ? `Subject selected ${name} as destination in ${count} of the last ${hist.length} directed trips, over other known locations.`
          : `Subject consumed ${name.toLowerCase()} in ${count} of the last ${hist.length} feeding bouts despite alternatives.`,
      metrics: [
        { label: "SELECTION RATE", value: `${Math.round((count / hist.length) * 100)}%` },
        { label: "KNOWN ALTERNATIVES", value: String(Math.max(0, this.ctx.memory.learnedLocations.length - 1)) },
      ],
    });
    void major;
  }

  private endGoal(outcome: "success" | "fail" | "interrupted") {
    const { learning, rewards, memory } = this.ctx;
    const s = this.state;
    const g = s.currentGoal;
    if (!g) return;
    if (outcome === "fail" && g.type !== "FLEE") rewards.silent(-0.05);
    const reward = rewards.takeGoalReward();
    learning.update({ stateKey: g.stateKey, action: g.type, reward, nextStateKey: this.stateKey() });

    if (g.directed && outcome !== "interrupted" && g.type !== "REST") {
      const straight = dist2D(g.startPos, s.position);
      if (straight > 6) {
        const straightness = clamp(straight / Math.max(straight, g.pathLength));
        const duration = this.time - g.startedAt;
        const expected = straight / SPEED.hop + 3;
        const timeEff = clamp(expected / Math.max(expected, duration));
        learning.ema("navigationEfficiency", outcome === "success" ? Math.pow(straightness, 2) * (0.35 + 0.65 * timeEff) : 0.05, 0.1);
        learning.navigationOutcome(outcome === "success", straightness);
        if (outcome === "success" && straightness > 0.8) {
          this.ctx.events.milestone("FIRST_SUCCESSFUL_ROUTE", this.time, "first efficient route", "learning", {
            title: "EFFICIENT ROUTE EXECUTED",
            detail: `Subject reached a remembered destination ${straight.toFixed(1)} m away along a near-direct path.`,
            metrics: [
              { label: "PATH STRAIGHTNESS", value: `${Math.round(straightness * 100)}%` },
              { label: "NAVIGATION SKILL", value: `${Math.round(learning.navSkill * 100)}%` },
            ],
          });
        }
      }
    }
    if (g.type === "HIDE" || g.type === "REST") s.anim.hidden = false;
    if (s.anim.carrying && g.type === "STORE_FOOD" && outcome !== "success") s.anim.carrying = false;
    void memory;
    s.currentGoal = null;
  }

  // ─────────────────────────────── motor ───────────────────────────────

  /** returns true while descending from a tree */
  private descend(dt: number) {
    const a = this.state.anim;
    if (a.climbHeight <= 0) return false;
    a.climbHeight = Math.max(0, a.climbHeight - SPEED.climb * 1.6 * dt);
    a.pose = "climb";
    a.speed = SPEED.climb;
    a.heading = this.climbAngle + Math.PI;
    this.placeOnTree();
    if (a.climbHeight <= 0) {
      a.climbTreeId = undefined;
      a.pose = "stand";
      // step away from the trunk
      const s = this.state;
      s.position.y = this.ctx.world.surfaceHeight(s.position.x, s.position.z);
    }
    return true;
  }

  private sniffTimer = 0;

  /** while foraging on the ground, buried nuts are found by smell; returns true when one is found */
  private sniffForBuried(dt: number) {
    const s = this.state;
    if (s.anim.climbHeight > 0.2 || s.hunger < 0.2) return false;
    this.sniffTimer += dt;
    if (this.sniffTimer < 0.5) return false;
    const step = this.sniffTimer;
    this.sniffTimer = 0;
    const found = this.ctx.world.sniffBuried(s.position.x, s.position.z, step, 0.8 + this.ctx.learning.navSkill * 0.4);
    if (!found) return false;
    const { brain, events, rewards } = this.ctx;
    brain.cascade(["VISION", "MEMORY", "REWARD"], 0.5);
    brain.think(this.time, "Scent of a buried nut. Digging.", "decision", 6);
    rewards.emit(this.time, 0.2, "BURIED NUT SMELLED");
    s.behaviorStats.foodDiscovered++;
    if (this.ctx.rng() < 0.15) events.add(this.time, "dug up a buried nut by smell", "discovery", { location: { ...found.position } });
    this.endGoal("success");
    return true;
  }

  private placeOnTree() {
    const a = this.state.anim;
    const tree = this.ctx.world.state.objects.find((o) => o.id === a.climbTreeId);
    if (!tree) return;
    const r = tree.radius * (1 - a.climbHeight * 0.015) + 0.1;
    const s = this.state;
    s.position.x = tree.position.x + Math.sin(this.climbAngle) * r;
    s.position.z = tree.position.z + Math.cos(this.climbAngle) * r;
    s.position.y = tree.position.y + a.climbHeight;
  }

  private travel(target: Vector3, speed: number, dt: number, arrive: number): "arrived" | "moving" | "stuck" {
    const { world, learning, rng } = this.ctx;
    const s = this.state;
    const a = s.anim;
    if (this.descend(dt)) return "moving";

    const dx = target.x - s.position.x;
    const dz = target.z - s.position.z;
    const d = Math.hypot(dx, dz);
    if (d < arrive) {
      a.speed = 0;
      return "arrived";
    }

    // navigation imprecision: an Ornstein–Uhlenbeck wander that shrinks with skill
    this.wander += (gaussian(rng) * 2.4 - this.wander * 1.1) * dt;
    const noise = this.wander * (1 - learning.navSkill) * 0.95 * Math.min(1, d / 5);
    let desired = Math.atan2(dx, dz) + noise;

    // obstacle avoidance
    const hx = Math.sin(a.heading);
    const hz = Math.cos(a.heading);
    let steer = 0;
    for (const o of world.obstaclesNear(s.position.x + hx * 1.5, s.position.z + hz * 1.5)) {
      const ox = o.position.x - s.position.x;
      const oz = o.position.z - s.position.z;
      const ahead = ox * hx + oz * hz;
      if (ahead < 0 || ahead > 3.2 + o.radius) continue;
      const lateral = ox * hz - oz * hx;
      const clearance = o.radius + 0.5;
      if (Math.abs(lateral) < clearance && Math.hypot(ox, oz) < d) {
        steer += (lateral > 0 ? 1 : -1) * (1 - Math.abs(lateral) / clearance) * 1.4;
      }
    }
    desired -= steer;
    a.heading = dampAngle(a.heading, desired, 7, dt);

    // bounding gait for fast movement
    let v = speed;
    if (speed >= SPEED.hop) v *= 0.6 + 0.85 * Math.max(0, Math.sin(a.gaitPhase * Math.PI * 2));
    if (s.injuredTimer > 0) v *= 1.1;
    if (s.energy < 0.12) v *= 0.6;
    const step = Math.min(v * dt, d);
    let nx = s.position.x + Math.sin(a.heading) * step;
    let nz = s.position.z + Math.cos(a.heading) * step;

    for (const o of world.obstaclesNear(nx, nz)) {
      const od = Math.hypot(nx - o.position.x, nz - o.position.z);
      const r = o.radius + 0.18;
      if (od < r && od > 1e-4) {
        nx = o.position.x + ((nx - o.position.x) / od) * r;
        nz = o.position.z + ((nz - o.position.z) / od) * r;
      }
    }
    if (world.terrain.isBlocked(nx, nz)) {
      nx = s.position.x;
      nz = s.position.z;
      this.wander += (rng() < 0.5 ? -1 : 1) * 1.5;
    }
    nx = clamp(nx, -WORLD_HALF + 3, WORLD_HALF - 3);
    nz = clamp(nz, -WORLD_HALF + 3, WORLD_HALF - 3);
    const moved = Math.hypot(nx - s.position.x, nz - s.position.z);
    s.position.x = nx;
    s.position.z = nz;
    s.position.y = world.surfaceHeight(nx, nz);
    if (s.currentGoal) s.currentGoal.pathLength += moved;
    a.speed = moved / dt;
    a.pose = speed >= SPEED.hop ? "run" : "walk";
    a.headYaw *= 0.9;

    // progress / stuck detection
    this.progressTimer += dt;
    if (this.progressTimer > 2) {
      if (d > this.progressRef - 0.6) {
        this.stuckTime += this.progressTimer;
        this.wander += (rng() < 0.5 ? -1 : 1) * 2.5;
      } else this.stuckTime = Math.max(0, this.stuckTime - 1);
      this.progressRef = d;
      this.progressTimer = 0;
    }
    if (this.stuckTime > 9) return "stuck";
    return "moving";
  }

  private idle(pose: SquirrelState["anim"]["pose"], dt: number) {
    const a = this.state.anim;
    if (this.descend(dt)) return false;
    a.speed = 0;
    a.pose = pose;
    this.scanPhase += dt;
    if (pose === "alert" || pose === "sit") a.headYaw = Math.sin(this.scanPhase * 1.3) * 0.8 + Math.sin(this.scanPhase * 3.1) * 0.15;
    else a.headYaw *= 0.9;
    return true;
  }

  /** squirrel-like stop-and-go: brief scanning pauses during open movement */
  private microPause(dt: number) {
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      this.idle(this.ctx.rng() < 0.002 ? "sniff" : this.state.anim.pose === "sniff" ? "sniff" : "alert", dt);
      return true;
    }
    if (this.state.anim.climbHeight <= 0 && this.ctx.rng() < dt * 0.22) {
      this.pauseTimer = 0.6 + this.ctx.rng() * 1.6;
      this.state.anim.pose = this.ctx.rng() < 0.4 ? "sniff" : "alert";
      return true;
    }
    return false;
  }

  private food(id?: string): FoodSource | undefined {
    return id ? this.ctx.world.state.foodSources.find((f) => f.id === id) : undefined;
  }

  // ─────────────────────────────── execution ───────────────────────────────

  private execute(g: Goal, dt: number) {
    const { world, memory, rewards, events, brain, learning, rng } = this.ctx;
    const s = this.state;
    const t = this.time;
    const elapsed = t - g.startedAt;
    g.phaseTimer += dt;
    s.anim.hidden = false;

    if (elapsed > g.timeout && g.type !== "REST") {
      if (g.type === "OBSERVE") {
        if (this.threatSeenDuringGoal) rewards.emit(t, 0.2, "EARLY THREAT DETECTION");
        this.endGoal("success");
      } else {
        rewards.emit(t, -0.2, "GOAL TIMEOUT");
        brain.think(t, "Goal not reached. Re-evaluating.", "decision", 10);
        this.endGoal("fail");
      }
      return;
    }
    const hopSpeed = s.energy < 0.25 ? SPEED.walk * 1.3 : SPEED.hop;

    switch (g.type) {
      case "EXPLORE": {
        if (this.microPause(dt)) return;
        const r = this.travel(g.target!, s.curiosity > 0.7 ? hopSpeed : SPEED.walk * 1.4, dt, 2);
        if (r === "arrived") {
          if (this.freshCells > 3) rewards.emit(t, clamp(this.freshCells * 0.03, 0.08, 0.4), "TERRITORY EXPANDED");
          this.endGoal("success");
        } else if (r === "stuck") {
          rewards.emit(t, -0.15, "NAVIGATION FAILURE");
          this.endGoal("fail");
        }
        return;
      }

      case "SEARCH_FOR_FOOD": {
        const per = this.perception;
        if (g.phase !== "approach" && this.sniffForBuried(dt)) return;
        const visible = per?.foods.find((pf) => learning.preference(pf.food.label) > -0.35);
        if (visible && g.targetId !== visible.food.id && g.phase !== "approach") {
          g.targetId = visible.food.id;
          g.target = clone(visible.food.position);
          g.phase = "approach";
          g.label = `APPROACH · ${visible.food.label}`;
        }
        const targetFood = g.targetId?.startsWith("food") ? this.food(g.targetId) : undefined;
        if (g.phase === "sniff") {
          this.idle("sniff", dt);
          if (g.phaseTimer > 2) {
            const obj = world.state.objects.find((o) => o.id === g.targetId);
            if (obj) {
              this.searched.set(obj.id, t);
              learning.foodAssociation(obj.kind, false);
            }
            rewards.emit(t, -0.08, "SEARCH UNSUCCESSFUL");
            this.endGoal("fail");
          }
          return;
        }
        if (g.phase !== "approach" && this.microPause(dt)) return;
        const r = this.travel(g.target!, s.hunger > 0.6 ? SPEED.run : hopSpeed, dt, targetFood ? 1.1 : 2.4);
        if (r === "arrived") {
          if (targetFood) {
            if (targetFood.amount >= 1) this.endGoal("success");
            else {
              rewards.emit(t, -0.1, "FOOD DEPLETED");
              this.endGoal("fail");
            }
          } else {
            g.phase = "sniff";
            g.phaseTimer = 0;
          }
        } else if (r === "stuck") this.endGoal("fail");
        return;
      }

      case "RETURN_TO_MEMORY": {
        const m = memory.memories.find((x) => x.id === g.memoryId);
        if (!m) {
          brain.think(t, "Memory trace lost.", "memory", 10);
          this.endGoal("fail");
          return;
        }
        const isWater = m.subtype === "water";
        if (g.phase === "travel") {
          const r = this.travel(g.target!, s.hunger > 0.7 || s.thirst > 0.7 ? SPEED.run : hopSpeed, dt, 1.6);
          if (r === "arrived") {
            g.phase = "search";
            g.phaseTimer = 0;
            brain.think(t, "Arrived at remembered location. Searching.", "memory", 5);
          } else if (r === "stuck") {
            rewards.emit(t, -0.25, "LOST");
            this.endGoal("fail");
          }
          return;
        }
        if (g.phase === "search") {
          if (!isWater && this.sniffForBuried(dt)) return;
          // spiral sniffing around the remembered point
          const ang = g.phaseTimer * 1.6;
          const rad = 0.6 + g.phaseTimer * 0.45;
          const probe = { x: m.location.x + Math.sin(ang) * rad, y: 0, z: m.location.z + Math.cos(ang) * rad };
          if (g.phaseTimer % 1.2 < 0.5) this.idle("sniff", dt);
          else this.travel(probe, SPEED.walk, dt, 0.3);

          let foundPos: Vector3 | null = null;
          let sourceFood: FoodSource | undefined;
          if (isWater) {
            const w = world.state.waterSources.find((x) => x.id === m.sourceId);
            const near = w?.kind === "puddle" ? dist2D(w.position, s.position) < w.radius + 3 : world.terrain.site.distToWater(s.position.x, s.position.z) < 4;
            if (w && near && (w.kind !== "puddle" || w.amount > 0.05)) foundPos = m.location;
          } else {
            sourceFood = this.food(m.sourceId);
            if (sourceFood && sourceFood.amount >= 1 && dist2D(sourceFood.position, s.position) < (sourceFood.hidden ? 3.8 : 5.5)) {
              foundPos = sourceFood.position;
            }
          }
          if (foundPos) {
            const locError = dist2D(this.memoryLocAtStart ?? m.location, foundPos);
            memory.reinforce(m, true, isWater ? null : foundPos, learning.alpha);
            s.behaviorStats.recallSuccesses++;
            learning.ema("memoryAccuracy", clamp(1.05 - locError / 9), 0.12);
            rewards.emit(t, 0.4, "ROUTE SUCCESS");
            rewards.emit(t, 0.25, "MEMORY CONFIRMED");
            brain.cascade(["MEMORY", "REWARD", "DECISION"], 0.9);
            brain.think(t, "Location recognized. Expectation confirmed.", "memory", 3);
            memory.associateLocation(foundPos, 0.3, 0);
            const assoc = memory.associations(foundPos, 12);
            events.add(t, `returned to ${m.label.toLowerCase()}`, "memory", { memoryId: m.id, location: foundPos });
            events.milestone("FIRST_RETURN_TO_MEMORY", t, "first return to remembered location", "memory", {
              title: "NEW BEHAVIOR DETECTED",
              detail: `The subject returned to a previously successful ${isWater ? "water" : "food"} location without external guidance.`,
              metrics: [
                { label: "MEMORY CONFIDENCE", value: `${Math.round(m.confidence * 100)}%` },
                { label: "LOCATION ERROR", value: `${locError.toFixed(1)} m` },
                { label: "FOOD", value: `+${assoc.food.toFixed(2)}` },
                { label: "DANGER", value: assoc.danger < 0 ? `−${Math.abs(assoc.danger).toFixed(2)}` : "0.00" },
              ],
              memoryId: m.id,
              location: foundPos,
            });
            if (sourceFood?.createdBySubject) {
              s.behaviorStats.cachesRetrieved++;
              events.add(t, "retrieved self-made cache", "memory", {
                major: s.behaviorStats.cachesRetrieved === 1,
                title: "CACHE RETRIEVAL",
                detail: `The subject located food it buried ${((t - m.timestamp) / 480).toFixed(1)} days earlier. The cache is not visible; retrieval relied on spatial memory.`,
                metrics: [
                  { label: "TIME SINCE CACHING", value: `${((t - m.timestamp) / 60).toFixed(1)} MIN` },
                  { label: "LOCATION ERROR", value: `${locError.toFixed(1)} m` },
                ],
                memoryId: m.id,
                location: foundPos,
              });
            }
            if (isWater) this.endGoal("success");
            else {
              g.phase = "approach";
              g.target = clone(foundPos);
            }
            return;
          }
          if (g.phaseTimer > 7.5) {
            const exists = !isWater && sourceFood && dist2D(sourceFood.position, m.location) < 8;
            if (sourceFood?.createdBySubject && sourceFood.pilferedBy) {
              // someone dug up this cache: learn to avoid caching in front of an audience
              s.behaviorStats.cachesPilfered++;
              learning.audienceCaution = clamp(learning.audienceCaution + 0.18 * (0.5 + learning.alpha));
              rewards.emit(t, -0.6, "CACHE PILFERED");
              brain.think(t, "Cache emptied by another squirrel.", "alert", 3);
              brain.stimulate("FEAR", 0.4);
              events.add(t, `found ${m.label.toLowerCase()} dug up (${sourceFood.pilferedBy})`, "social", { memoryId: m.id, location: sourceFood.position });
              events.milestone("FIRST_PILFER", t, "a cache was stolen", "social", {
                title: "CACHE PILFERED",
                detail: `The subject returned to ${m.label.toLowerCase()} and found it dug up by another squirrel (${sourceFood.pilferedBy}). Caches made while others watched are at higher risk; the subject's caution about audiences increased.`,
                metrics: [
                  { label: "AUDIENCE CAUTION", value: `${Math.round(learning.audienceCaution * 100)}%` },
                  { label: "CACHES LOST", value: String(s.behaviorStats.cachesPilfered) },
                ],
                memoryId: m.id,
                location: sourceFood.position,
              });
            }
            memory.reinforce(m, false, exists && sourceFood ? sourceFood.position : null, learning.alpha);
            learning.ema("memoryAccuracy", exists ? 0.45 : 0.05, 0.1);
            rewards.emit(t, -0.3, "EXPECTATION VIOLATED");
            brain.think(t, isWater ? "Water absent. Updating memory." : "Expected food absent. Updating memory.", "memory", 3);
            brain.stimulate("MEMORY", 0.7);
            events.add(t, `memory mismatch at ${m.label.toLowerCase()}`, "memory", { memoryId: m.id });
            this.endGoal("fail");
          }
          return;
        }
        if (g.phase === "approach") {
          const r = this.travel(g.target!, SPEED.walk * 1.5, dt, 1);
          if (r !== "moving") this.endGoal("success");
        }
        return;
      }

      case "INVESTIGATE": {
        const obj = world.state.objects.find((o) => o.id === g.targetId);
        if (!obj) {
          this.endGoal("fail");
          return;
        }
        if (g.phase === "travel") {
          if (this.microPause(dt)) return;
          const r = this.travel(g.target!, SPEED.walk * 1.6, dt, obj.radius + 1);
          if (r === "arrived") {
            g.phase = "sniff";
            g.phaseTimer = 0;
            s.anim.heading = angleTo(s.position, obj.position);
          } else if (r === "stuck") this.endGoal("fail");
          return;
        }
        this.idle(g.phaseTimer % 2 < 1.2 ? "sniff" : "alert", dt);
        if (g.phaseTimer > 2.8) {
          this.investigated.add(obj.id);
          s.behaviorStats.investigations++;
          s.curiosity = clamp(s.curiosity - 0.13);
          const lm = obj.landmarkId ? world.state.landmarks.find((l) => l.id === obj.landmarkId) : undefined;
          memory.form({
            type: lm ? "landmark" : "environment",
            location: obj.position,
            label: lm ? lm.name : `${obj.kind.toUpperCase()} · INSPECTED`,
            importance: lm ? 0.45 : 0.18,
            emotionalValue: 0.05,
            time: t,
            sourceId: lm ? lm.id : obj.id,
            noise: 2,
          });
          const hiddenNear = world.state.foodSources.some((f) => f.objectId === obj.id && f.amount >= 1);
          learning.foodAssociation(obj.kind, hiddenNear);
          rewards.emit(t, 0.1, "NOVELTY RESOLVED");
          brain.stimulate("CURIOSITY", 0.4);
          events.add(t, `investigated ${obj.kind}${lm ? ` (${lm.name.toLowerCase()})` : ""}`, "behavior");
          this.endGoal("success");
        }
        return;
      }

      case "EAT": {
        const f = this.food(g.targetId);
        if (!f || f.amount < 1) {
          this.endGoal(g.phase === "eat" ? "success" : "fail");
          return;
        }
        if (g.phase === "travel") {
          const r = this.travel(f.position, SPEED.walk, dt, 0.8);
          if (r !== "moving") {
            g.phase = "eat";
            g.phaseTimer = 0;
            s.anim.heading = angleTo(s.position, f.position);
          }
          return;
        }
        this.idle("eat", dt);
        // handling time: opening an acorn takes about a minute of real time (compressed with the 480 s day)
        const handling = (f.kind === "acorn" || f.kind === "cache" ? 10 : f.kind === "scraps" ? 7 : 5) * (1 + (this.ctx.calibration.bias.eating ?? 0));
        if (g.phaseTimer > Math.max(3, handling)) {
          g.phaseTimer = 0;
          world.consumeFood(f.id);
          const before = s.hunger;
          const m = memory.bySource(f.id, "food");
          this.eatHistory.push(f.label);
          if (this.eatHistory.length > 12) this.eatHistory.shift();
          if (f.toxic) {
            s.hunger = clamp(s.hunger - 0.03);
            s.energy = clamp(s.energy - 0.14);
            s.behaviorStats.mistakes++;
            rewards.emit(t, -0.75, "ADVERSE REACTION");
            learning.foodOutcome(f.label, -1);
            brain.cascade(["REWARD", "MEMORY", "HUNGER"], 1);
            brain.think(t, "Adverse reaction. Food marked as harmful.", "alert", 2);
            if (m) {
              m.subtype = "toxic";
              m.emotionalValue = -0.8;
            }
            events.add(t, `ate ${f.label.toLowerCase()} — adverse reaction`, "learning");
            events.milestone("FIRST_MISTAKE", t, "first feeding mistake", "learning", {
              title: "ERROR RECORDED",
              detail: `Subject consumed ${f.label.toLowerCase()} and experienced an adverse reaction. The food type is now associated with negative value.`,
              metrics: [
                { label: "REWARD", value: "−0.75" },
                { label: "PREFERENCE", value: learning.preference(f.label).toFixed(2) },
              ],
              memoryId: m?.id,
              location: f.position,
            });
            this.endGoal("fail");
            return;
          }
          s.hunger = clamp(s.hunger - f.nutrition);
          // fruit and fungi carry some moisture
          // food moisture: fresh acorns are ~40% water, fruit and fungi more
          s.thirst = clamp(s.thirst - (f.kind === "berry" ? 0.07 : f.kind === "mushroom" ? 0.04 : f.kind === "acorn" || f.kind === "cache" || f.kind === "buds" ? 0.03 : 0.015));
          s.energy = clamp(s.energy + 0.02);
          s.behaviorStats.foodEaten++;
          if (this.boutStart !== null) {
            // food discovery efficiency: how quickly a foraging bout ends in food
            learning.ema("foodEfficiency", clamp(1.2 - (t - this.boutStart) / 85), 0.14);
            this.boutStart = null;
          }
          rewards.emit(t, 0.15 + 0.5 * before, "FOOD CONSUMED");
          learning.foodOutcome(f.label, 0.4 + before * 0.6);
          brain.cascade(["HUNGER", "REWARD", "MEMORY"], 0.6);
          if (m) {
            m.emotionalValue = clamp(m.emotionalValue + 0.08);
            m.importance = clamp(m.importance + 0.05);
          }
          memory.associateLocation(f.position, 0.15, 0);
          events.add(t, `consumed ${f.label.toLowerCase()}`, "reward");
          this.checkPreference(f.label, "food");
          if (s.hunger < 0.08 || f.amount < 1) this.endGoal("success");
        }
        return;
      }

      case "DRINK": {
        if (g.phase === "travel") {
          const r = this.travel(g.target!, s.thirst > 0.7 ? SPEED.run : hopSpeed, dt, 0.7);
          if (r === "arrived") {
            g.phase = "drink";
            g.phaseTimer = 0;
            const w = world.state.waterSources.find((x) => x.id === g.targetId);
            if (w) s.anim.heading = angleTo(s.position, w.position);
          } else if (r === "stuck") this.endGoal("fail");
          return;
        }
        this.idle("drink", dt);
        if (g.phaseTimer > 3.4) {
          const before = s.thirst;
          s.thirst = clamp(s.thirst - 0.85);
          s.behaviorStats.waterDrinks++;
          rewards.emit(t, 0.15 + 0.45 * before, "WATER");
          brain.cascade(["REWARD", "MEMORY"], 0.5);
          const m = memory.bySource(g.targetId ?? "", "environment");
          if (m) {
            m.importance = clamp(m.importance + 0.08);
            m.confidence = clamp(m.confidence + 0.05);
          }
          events.add(t, "drank water", "reward");
          this.endGoal("success");
        }
        return;
      }

      case "REST": {
        const tree = world.state.objects.find((o) => o.id === g.targetId) ?? this.homeTree;
        const isNest = tree.id === this.homeTree.id;
        if (g.phase === "travel") {
          const a = angleTo(tree.position, s.position);
          const off = isNest ? tree.radius + 0.35 : tree.radius + 0.55;
          const spot = { x: tree.position.x + Math.sin(a) * off, y: 0, z: tree.position.z + Math.cos(a) * off };
          const r = this.travel(spot, hopSpeed, dt, 0.5);
          if (r === "arrived" || r === "stuck") {
            // squirrels sleep in leaf nests (dreys) high in the tree; they keep secondary dreys across their range
            const toDrey = isNest || world.isNight || world.state.env.sunElevation < 4 || world.state.env.tempC < 0;
            g.phase = toDrey ? "climb" : "sleep";
            g.phaseTimer = 0;
            if (toDrey) {
              this.climbAngle = angleTo(tree.position, s.position);
              s.anim.climbTreeId = tree.id;
            }
            events.add(t, world.isNight ? "entered sleep" : "resting", "behavior");
          }
          return;
        }
        if (g.phase === "climb") {
          const a = s.anim;
          const dreyHeight = isNest ? DREY_HEIGHT : Math.max(6, Math.min(DREY_HEIGHT, tree.height * 0.65));
          a.climbHeight = Math.min(a.climbHeight + SPEED.climb * 2.2 * dt, dreyHeight);
          a.pose = "climb";
          a.speed = SPEED.climb;
          a.heading = this.climbAngle;
          this.placeOnTree();
          if (a.climbHeight >= dreyHeight) {
            g.phase = "sleep";
            g.phaseTimer = 0;
            brain.think(t, "Entered drey.", "info", 30);
          }
          return;
        }
        if (s.anim.climbHeight > 0) {
          s.anim.pose = "sleep";
          s.anim.speed = 0;
          this.placeOnTree();
        } else this.idle("sleep", dt);
        s.anim.hidden = true;
        rewards.silent(dt * 0.002 * (1 - s.energy));
        // offline consolidation: replay rewarding routes during sleep
        this.replayTimer += dt;
        if (this.replayTimer > 22) {
          this.replayTimer = 0;
          this.sleepReplay();
        }
        const night = world.isNight;
        const foul = world.state.env.precipMm > 2 || world.state.env.tempC < -10;
        const wake =
          (!night && !foul && s.energy > 0.93) ||
          (!night && foul && s.hunger > 0.55) ||
          // diurnal: only real need breaks the night in the drey
          (s.hunger > (night ? 0.94 : 0.8) && s.energy > (night ? 0.6 : 0.3)) ||
          (s.thirst > (night ? 0.95 : 0.85) && s.energy > (night ? 0.6 : 0.3)) ||
          (this.perception?.threatLevel ?? 0) > 0.35;
        if (wake) {
          rewards.emit(t, 0.12, "ENERGY RESTORED");
          this.endGoal("success");
        }
        return;
      }

      case "FLEE": {
        const threat = world.state.threats.find((x) => x.id === g.threatId);
        if (s.anim.climbHeight > 0.5) {
          // already in a tree
          this.idle("climb", dt);
          s.anim.pose = "climb";
          if (!this.perception?.threats.length && g.phaseTimer > 4) this.endGoal("success");
          return;
        }
        const retarget = (spread: number) => {
          const base = threat ? angleTo(threat.position, s.position) : s.anim.heading;
          for (let k = 0; k < 8; k++) {
            const away = base + (rng() - 0.5) * spread;
            const x = clamp(s.position.x + Math.sin(away) * 18, -WORLD_HALF + 6, WORLD_HALF - 6);
            const z = clamp(s.position.z + Math.cos(away) * 18, -WORLD_HALF + 6, WORLD_HALF - 6);
            if (!world.terrain.site.isBlocked(x, z) && !world.terrain.site.isBlocked((x + s.position.x) / 2, (z + s.position.z) / 2)) {
              g.target = { x, y: 0, z };
              return;
            }
          }
        };
        if (threat && g.phaseTimer > 1.2) {
          g.phaseTimer = 0;
          retarget(0.6);
        }
        s.anim.tailFlick = Math.max(s.anim.tailFlick, 0.6);
        let r = this.travel(g.target!, SPEED.flee, dt, 1.5);
        if (r === "stuck" && this.fleeRetries < 3) {
          // blocked by water or a wall: veer and keep running rather than giving up
          this.fleeRetries++;
          retarget(Math.PI * 1.4);
          r = "moving";
        }
        const seen = this.perception?.threats.some((p) => p.threat.id === g.threatId);
        const dist = threat ? dist2D(threat.position, s.position) : 99;
        const safeDist = threat?.kind === "dog" && threat.state !== "chase" ? 24 : 32;
        if ((!seen && elapsed > 3) || (dist > safeDist && elapsed > 1.5) || (threat && (threat.state === "retreat" || threat.state === "absent") && elapsed > 2)) {
          rewards.emit(t, 0.55, "ESCAPED THREAT");
          brain.think(t, "Threat distance increasing. Fear subsiding.", "info", 8);
          this.endGoal("success");
        } else if (r === "stuck") this.endGoal("fail");
        return;
      }

      case "HIDE": {
        const cover = world.state.objects.find((o) => o.id === g.targetId);
        if (!cover) {
          this.endGoal("fail");
          return;
        }
        if (g.phase === "travel") {
          const approach = cover.climbable ? cover.radius + 0.4 : 0.3;
          const r = this.travel(cover.position, SPEED.flee, dt, approach);
          if (r === "arrived") {
            g.phase = cover.climbable ? "climb" : "wait";
            g.phaseTimer = 0;
            if (cover.climbable) {
              this.climbAngle = angleTo(cover.position, s.position);
              s.anim.climbTreeId = cover.id;
              brain.think(t, "Climbing to refuge.", "decision", 3);
            }
          } else if (r === "stuck") this.endGoal("fail");
          return;
        }
        if (g.phase === "climb") {
          const a = s.anim;
          a.climbHeight = Math.min(a.climbHeight + SPEED.climb * 2.2 * dt, 3.6);
          a.pose = "climb";
          a.speed = SPEED.climb;
          a.heading = this.climbAngle;
          this.placeOnTree();
          if (a.climbHeight >= 3.6) {
            g.phase = "wait";
            g.phaseTimer = 0;
          }
          return;
        }
        // wait
        if (cover.climbable && s.anim.climbHeight > 0) {
          s.anim.pose = "climb";
          s.anim.speed = 0;
          this.scanPhase += dt;
          s.anim.headYaw = Math.sin(this.scanPhase * 1.1) * 0.7;
          this.placeOnTree();
        } else {
          this.idle("sit", dt);
          s.anim.hidden = true;
        }
        const threatVisible = (this.perception?.threats.length ?? 0) > 0;
        if (!threatVisible && s.fear < 0.4 && g.phaseTimer > 5) {
          rewards.emit(t, 0.45, "REFUGE SUCCESSFUL");
          events.add(t, cover.climbable ? "sheltered in tree" : "sheltered under cover", "danger");
          this.endGoal("success");
        }
        return;
      }

      case "OBSERVE": {
        this.idle("alert", dt);
        if (this.perception?.threats.length) this.threatSeenDuringGoal = true;
        s.fear = clamp(s.fear - dt * 0.01);
        if (rng() < dt * 0.4) s.anim.tailFlick = Math.max(s.anim.tailFlick, 0.3);
        return;
      }

      case "PERCH": {
        const tree = world.state.objects.find((o) => o.id === g.targetId);
        if (!tree) {
          this.endGoal("fail");
          return;
        }
        if (g.phase === "travel") {
          const r = this.travel(tree.position, hopSpeed, dt, tree.radius + 0.4);
          if (r === "arrived") {
            g.phase = "climb";
            g.phaseTimer = 0;
            this.climbAngle = angleTo(tree.position, s.position);
            s.anim.climbTreeId = tree.id;
            g.score = 2.5 + rng() * 4;
          } else if (r === "stuck") this.endGoal("fail");
          return;
        }
        const a = s.anim;
        if (g.phase === "climb") {
          a.climbHeight = Math.min(a.climbHeight + SPEED.climb * 2 * dt, g.score > 0 ? Math.min(6, g.score) : 3);
          a.pose = "climb";
          a.speed = SPEED.climb;
          a.heading = this.climbAngle;
          this.placeOnTree();
          if (a.climbHeight >= Math.min(6, g.score)) {
            g.phase = "scan";
            g.phaseTimer = 0;
          }
          return;
        }
        a.pose = "climb";
        a.speed = 0;
        this.scanPhase += dt;
        a.headYaw = Math.sin(this.scanPhase * 1.2) * 0.8;
        this.placeOnTree();
        if (rng() < dt * 0.3) a.tailFlick = Math.max(a.tailFlick, 0.25);
        if (this.perception?.threats.length) this.threatSeenDuringGoal = true;
        if (g.phaseTimer > 6 + (g.id % 5) * 2) {
          rewards.silent(0.03);
          this.endGoal("success");
        }
        return;
      }

      case "CHASE": {
        const rival = this.ctx.rivals?.rivals.find((r) => r.id === g.targetId);
        if (!rival || !rival.alive || g.phaseTimer > 7 || rival.anim.climbHeight > 1) {
          if (rival && dist2D(rival.position, s.position) > 6) {
            rewards.emit(t, 0.15, "COMPETITOR DISPLACED");
            this.endGoal("success");
          } else this.endGoal("fail");
          return;
        }
        if (g.phaseTimer < dt * 1.5) {
          s.behaviorStats.chases++;
          events.milestone("FIRST_CHASE", t, "first chase of a competitor", "social", {
            title: "COMPETITIVE CHASE",
            detail: `The subject chased another squirrel (${rival.id}) away from a food patch. Chasing was recorded in about 9% of squirrels in the 2018 census.`,
            metrics: [{ label: "RIVAL", value: rival.id.toUpperCase() }],
          });
        }
        s.anim.tailFlick = Math.max(s.anim.tailFlick, 0.8);
        const r = this.travel(rival.position, SPEED.run * 1.05, dt, 0.8);
        if (r === "stuck") this.endGoal("fail");
        return;
      }

      case "STORE_FOOD": {
        if (g.phase === "travel") {
          const f = this.food(g.targetId);
          if (!f || f.amount < 1) {
            this.endGoal("fail");
            return;
          }
          const r = this.travel(f.position, SPEED.walk, dt, 0.8);
          if (r !== "moving") {
            g.phase = "pickup";
            g.phaseTimer = 0;
          }
          return;
        }
        if (g.phase === "pickup") {
          this.idle("eat", dt);
          if (g.phaseTimer > 2.5) {
            const f = world.consumeFood(g.targetId!);
            if (!f) {
              this.endGoal("fail");
              return;
            }
            s.anim.carrying = true;
            g.phase = "carry";
            g.phaseTimer = 0;
            g.target = this.cacheSite();
            brain.think(t, "Transporting food to cache site.", "decision", 5);
          }
          return;
        }
        if (g.phase === "carry") {
          const r = this.travel(g.target!, hopSpeed, dt, 0.6);
          if (r !== "moving") {
            g.phase = "dig";
            g.phaseTimer = 0;
          }
          return;
        }
        this.idle("dig", dt);
        if (g.phaseTimer > 5) {
          const watchers = this.perception?.rivals.filter((r) => r.distance < 14).length ?? 0;
          const cache = world.buryCache(s.position, "subject");
          if (watchers > 0) brain.think(t, `Cache made under observation (${watchers}).`, "alert", 10);
          else if (learning.audienceCaution > 0.3) {
            events.milestone("CACHE_PROTECTION", t, "cached out of sight of competitors", "learning", {
              title: "CACHE PROTECTION BEHAVIOR",
              detail: "After losing caches to other squirrels, the subject carried food out of their view before burying it. Grey squirrels are reported to adjust caching when observed by conspecifics.",
              metrics: [
                { label: "AUDIENCE CAUTION", value: `${Math.round(learning.audienceCaution * 100)}%` },
                { label: "CACHES LOST", value: String(s.behaviorStats.cachesPilfered) },
              ],
              location: cache.position,
            });
          }
          this.knownFoodIds.add(cache.id);
          s.anim.carrying = false;
          s.behaviorStats.cachesMade++;
          const { memory: m } = memory.form({
            type: "food",
            location: cache.position,
            label: `CACHE ${String(s.behaviorStats.cachesMade).padStart(2, "0")}`,
            importance: 0.75,
            emotionalValue: 0.45,
            time: t,
            sourceId: cache.id,
            subtype: "cache",
            noise: 3,
          });
          rewards.emit(t, 0.2, "FOOD CACHED");
          brain.cascade(["MEMORY", "REWARD"], 0.8);
          brain.think(t, "Cache location encoded.", "memory", 3);
          events.add(t, `buried food (${m.label.toLowerCase()})`, "behavior", { memoryId: m.id, location: cache.position });
          events.milestone("FIRST_CACHE", t, "first food cache created", "behavior", {
            title: "CACHING BEHAVIOR EMERGED",
            detail: `With hunger low and surplus food available, the subject carried an acorn ${dist2D(g.startPos, cache.position).toFixed(1)} m and buried it. The cache location was committed to memory.`,
            metrics: [
              { label: "HUNGER", value: `${Math.round(s.hunger * 100)}%` },
              { label: "MEMORY", value: m.id },
            ],
            memoryId: m.id,
            location: cache.position,
          });
          this.endGoal("success");
        }
        return;
      }
    }
  }

  private cacheSite(): Vector3 {
    const { world, memory, rng, learning } = this.ctx;
    const s = this.state;
    const nearHome = dist2D(s.position, this.homeTree.position) < 40;
    const origin = nearHome ? this.homeTree.position : s.position;
    const watchers = this.perception?.rivals ?? [];
    let best: Vector3 = { ...s.position };
    let bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const r = nearHome ? 4 + rng() * 12 : 3 + rng() * 8;
      const p = { x: origin.x + Math.sin(a) * r, y: 0, z: origin.z + Math.cos(a) * r };
      if (world.terrain.isBlocked(p.x, p.z) || Math.abs(p.x) > WORLD_HALF - 6 || Math.abs(p.z) > WORLD_HALF - 6) continue;
      if (world.terrain.site.distToPath(p.x, p.z) < 1.5) continue;
      if (world.obstaclesNear(p.x, p.z).some((o) => dist2D(o.position, p) < o.radius + 0.4)) continue;
      // learned caution: prefer sites far from any watching squirrel
      const audience = watchers.reduce((acc, w) => acc + Math.max(0, 1 - dist2D(w.position, p) / 16), 0);
      const score = -memory.dangerAt(p.x, p.z) * 2 + memory.familiarityAt(p.x, p.z) * 0.3 + rng() * 0.3 - audience * learning.audienceCaution * 3;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  // ─────────────────────────────── persistence ───────────────────────────────

  toJSON() {
    return {
      state: { ...this.state, memories: [], learnedLocations: [] },
      investigated: Array.from(this.investigated),
      knownFoodIds: Array.from(this.knownFoodIds),
      searched: Array.from(this.searched.entries()),
      lastObserve: this.lastObserve,
      lastPerch: this.lastPerch,
      wander: this.wander,
      goalCounter: this.goalCounter,
      encounters: Array.from(this.encounters.entries()),
      excursion: this.excursion,
      destinationHistory: this.destinationHistory,
      eatHistory: this.eatHistory,
      climbAngle: this.climbAngle,
      bootTimer: this.bootTimer,
      boutStart: this.boutStart,
      replayBuffer: this.replayBuffer.slice(),
      homeTreeId: this.homeTree.id,
      // transient control state, so a restored agent continues exactly (live spectator mirrors)
      dyn: {
        prevPosition: this.prevPosition,
        thinkTimer: this.thinkTimer,
        progressTimer: this.progressTimer,
        progressRef: Number.isFinite(this.progressRef) ? this.progressRef : null,
        stuckTime: this.stuckTime,
        pauseTimer: this.pauseTimer,
        scanPhase: this.scanPhase,
        freshCells: this.freshCells,
        memoryLocAtStart: this.memoryLocAtStart,
        threatSeenDuringGoal: this.threatSeenDuringGoal,
        lastMemoryRefresh: Array.from(this.lastMemoryRefresh.entries()),
        lastPlace: this.lastPlace,
        replayTimer: this.replayTimer,
        dreyNight: this.dreyNight,
        fleeRetries: this.fleeRetries,
        recentStarts: this.recentStarts,
        sniffTimer: this.sniffTimer,
        suppressed: Array.from(this.suppressed.entries()),
        perception: this.perception
          ? {
              visionRange: this.perception.visionRange,
              foods: this.perception.foods.map((f) => ({ id: f.food.id, distance: f.distance })),
              threats: this.perception.threats.map((t) => ({ id: t.threat.id, distance: t.distance, proximity: t.proximity })),
              water: this.perception.water.map((w) => ({ id: w.water.id, distance: w.distance, edge: w.edge })),
              novelObjects: this.perception.novelObjects.map((o) => ({ id: o.object.id, distance: o.distance, salience: o.salience })),
              landmarks: this.perception.landmarks.map((l) => l.id),
              rivals: this.perception.rivals,
              salience: this.perception.salience,
              threatLevel: this.perception.threatLevel,
              novelty: this.perception.novelty,
            }
          : null,
      },
    };
  }

  load(o: ReturnType<SquirrelAgent["toJSON"]>) {
    const { memory, world } = this.ctx;
    this.state = { ...o.state, memories: memory.memories, learnedLocations: memory.learnedLocations };
    this.prevPosition = clone(this.state.position);
    this.investigated = new Set(o.investigated);
    this.knownFoodIds = new Set(o.knownFoodIds);
    this.searched = new Map(o.searched);
    this.lastObserve = o.lastObserve;
    this.lastPerch = o.lastPerch;
    this.wander = o.wander;
    this.goalCounter = o.goalCounter;
    this.encounters = new Map(o.encounters);
    this.excursion = o.excursion;
    this.destinationHistory = o.destinationHistory;
    this.eatHistory = o.eatHistory;
    this.climbAngle = o.climbAngle;
    this.bootTimer = o.bootTimer;
    this.boutStart = o.boutStart;
    this.replayBuffer = o.replayBuffer;
    const tree = world.state.objects.find((x) => x.id === o.homeTreeId);
    if (tree) this.homeTree = tree;
    const d = o.dyn;
    if (d) {
      this.prevPosition = clone(d.prevPosition);
      this.thinkTimer = d.thinkTimer;
      this.progressTimer = d.progressTimer;
      this.progressRef = d.progressRef ?? Infinity;
      this.stuckTime = d.stuckTime;
      this.pauseTimer = d.pauseTimer;
      this.scanPhase = d.scanPhase;
      this.freshCells = d.freshCells;
      this.memoryLocAtStart = d.memoryLocAtStart;
      this.threatSeenDuringGoal = d.threatSeenDuringGoal;
      this.lastMemoryRefresh = new Map(d.lastMemoryRefresh);
      this.lastPlace = d.lastPlace;
      this.replayTimer = d.replayTimer;
      this.dreyNight = d.dreyNight;
      this.fleeRetries = d.fleeRetries;
      this.recentStarts = d.recentStarts;
      this.sniffTimer = d.sniffTimer;
      this.suppressed = new Map(d.suppressed);
      const p = d.perception;
      if (p) {
        // re-link perceived items to the restored world objects by id
        const ws = world.state;
        const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
        const foods = byId(ws.foodSources);
        const threats = byId(ws.threats);
        const waters = byId(ws.waterSources);
        const objects = byId(ws.objects);
        const landmarks = byId(ws.landmarks);
        this.perception = {
          visionRange: p.visionRange,
          foods: p.foods.filter((f) => foods.has(f.id)).map((f) => ({ food: foods.get(f.id)!, distance: f.distance })),
          threats: p.threats.filter((t) => threats.has(t.id)).map((t) => ({ threat: threats.get(t.id)!, distance: t.distance, proximity: t.proximity })),
          water: p.water.filter((w) => waters.has(w.id)).map((w) => ({ water: waters.get(w.id)!, distance: w.distance, edge: w.edge })),
          novelObjects: p.novelObjects.filter((n) => objects.has(n.id)).map((n) => ({ object: objects.get(n.id)!, distance: n.distance, salience: n.salience })),
          landmarks: p.landmarks.filter((id) => landmarks.has(id)).map((id) => landmarks.get(id)!),
          rivals: p.rivals,
          salience: p.salience,
          threatLevel: p.threatLevel,
          novelty: p.novelty,
        };
      }
    }
  }

  // ─────────────────────────────── brain ───────────────────────────────

  private updateBrain(dt: number, per: PerceptionResult) {
    const { brain, rewards } = this.ctx;
    const s = this.state;
    const g = s.currentGoal;
    const moving = s.anim.speed > 0.2;
    // region activity is taken from the spiking network's population firing rates
    const nr = this.ctx.neural.regionRate;
    const mix = (neural: number, behavioural: number) => clamp(neural * 0.75 + behavioural * 0.25);
    brain.update(
      dt,
      {
        vision: mix(nr.VISION, 0.12 + per.salience * 0.55),
        memory: mix(nr.MEMORY, 0.06 + (g?.memoryId ? 0.45 : 0)),
        fear: mix(nr.FEAR, s.fear),
        hunger: mix(nr.HUNGER, Math.max(s.hunger, s.thirst * 0.85)),
        curiosity: mix(nr.CURIOSITY, s.curiosity * (0.45 + per.novelty * 0.55)),
        navigation: mix(nr.NAVIGATION, moving ? (g?.directed ? 0.55 : 0.3) : 0.05),
        decision: mix(nr.DECISION, 0.1 + (1 - (this.lastSelection?.probability ?? 0.5)) * 0.35),
        motor: mix(nr.MOTOR, clamp(s.anim.speed / 4.5 + (s.anim.pose === "eat" || s.anim.pose === "dig" ? 0.35 : 0))),
        reward: mix(nr.REWARD, Math.abs(rewards.recent) * 0.8),
      },
      Math.abs(rewards.recent)
    );
  }
}

function rngLike(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return h / 1000;
}

export { wrapAngle };
