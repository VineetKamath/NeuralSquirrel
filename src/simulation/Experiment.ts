import type { BehavioralProfile, LabEvent, MilestoneId, Personality, SquirrelState } from "@/types";
import { clamp, dist2D } from "@/utils/math";
import { gaussian, mulberry32, range, type RNG } from "@/utils/rng";
import { Brain } from "./Brain";
import { DAY_LENGTH, FIXED_DT } from "./constants";
import { DecisionSystem } from "./DecisionSystem";
import { EventSystem } from "./EventSystem";
import { LearningSystem } from "./LearningSystem";
import { MemorySystem } from "./MemorySystem";
import { MetricsSystem } from "./MetricsSystem";
import { MotivationSystem } from "./MotivationSystem";
import { RewardSystem } from "./RewardSystem";
import { SquirrelAgent, type SimContext } from "./SquirrelAgent";
import { WorldModel } from "./WorldModel";
import { NeuralBrain } from "./neural/NeuralBrain";
import { CalibrationSystem } from "./CalibrationSystem";
import { RivalSystem } from "./RivalSystem";
import { JournalSystem, type DayStats } from "./JournalSystem";
import { sampleFur } from "@/real/census";
import { simToUTC } from "@/real/calendar";
import { b64ToF32, f32ToB64 } from "@/utils/b64";
import { captureScalars, restoreScalars } from "@/utils/scalars";

export function generatePersonality(seed: number): Personality {
  const rng = mulberry32(seed ^ 0x5bd1e995);
  return {
    boldness: range(rng, 0.2, 0.85),
    curiosityBase: range(rng, 0.45, 1),
    metabolism: range(rng, 0.85, 1.15),
    retention: range(rng, 0.3, 0.9),
    learningRate: range(rng, 0.14, 0.32),
    temperature: range(rng, 0.05, 0.13),
    vigilance: range(rng, 0.15, 0.55),
    hoarding: range(rng, 0.2, 0.9),
  };
}

export interface LineageRecord {
  generation: number;
  bornAt: number;
  diedAt: number | null;
  cause: string;
  fur: SquirrelState["fur"];
  personality: Personality;
  foodEaten: number;
  cachesMade: number;
  placeCells: number;
  daysAlive: number;
}

/** heritable traits: personality plus innate synaptic biases (instincts), never learned knowledge */
interface Genome {
  personality: Personality;
  innate: Float32Array;
  fur: SquirrelState["fur"];
}

const TRAIL_CAP = 24000;
const TRAIL_DT = 4;

const GENERATION_MILESTONES: MilestoneId[] = [
  "FIRST_FOOD",
  "FIRST_RETURN_TO_MEMORY",
  "FIRST_ESCAPE",
  "FIRST_CACHE",
  "FIRST_REPLAY",
  "PLACE_MAP_FORMED",
  "FIRST_SUCCESSFUL_ROUTE",
];

/**
 * An experiment: the real study site, a lineage of subjects, resident squirrels and predators.
 * Pure simulation; no rendering or framework code.
 */
export class Experiment {
  readonly seed: number;
  readonly number: number;
  personality: Personality;
  ctx: SimContext;
  agent: SquirrelAgent;
  readonly metrics: MetricsSystem;
  readonly journal = new JournalSystem();
  lineage: LineageRecord[] = [];
  genome: Genome;
  private accumulator = 0;
  private dayStart: DayStats;
  private deathTimer = -1;
  private lastDayIndex = 0;
  /** simulation seconds actually advanced per real second (for display) */
  effectiveRate = 1;
  /** wall-clock time of the last step (for offline catch-up) */
  lastWall = Date.now();
  /** subject trajectory sampled every TRAIL_DT sim seconds: [time, x, z, generation] (for the map time scrubber) */
  trail: Float32Array = new Float32Array(TRAIL_CAP * 4);
  trailCount = 0;
  private trailTimer = 0;

  constructor(seed: number, number: number) {
    this.seed = seed;
    this.number = number;
    this.personality = generatePersonality(seed);
    const rng = mulberry32(seed);
    const world = new WorldModel(seed);
    this.genome = { personality: this.personality, innate: new Float32Array(NeuralBrain.genomeSize).fill(1), fur: sampleFur(rng) };
    this.ctx = this.buildContext(world, rng, this.genome);
    this.agent = new SquirrelAgent(this.ctx, { fur: this.genome.fur, generation: 1 });
    this.metrics = new MetricsSystem();
    this.dayStart = this.snapshotDay();
    // the subject is a resident adult of this census location: it already knows its nearest water
    this.knowNearestWater("(RESIDENT)");
    this.ctx.events.add(0, `subject released at census sighting ${world.nestCensusId || "location"} · nest oak`, "environment");
  }

  private buildContext(world: WorldModel, rng: RNG, genome: Genome, previous?: SimContext): SimContext {
    const p = genome.personality;
    return {
      world,
      memory: new MemorySystem(rng, p.retention),
      learning: new LearningSystem(p, rng),
      rewards: new RewardSystem(),
      events: previous?.events ?? new EventSystem(),
      brain: new Brain(rng),
      motivation: new MotivationSystem(),
      decision: new DecisionSystem(),
      rng,
      personality: p,
      neural: new NeuralBrain(rng, genome.innate),
      calibration: previous?.calibration ?? new CalibrationSystem(),
      rivals: previous?.rivals ?? new RivalSystem(world, mulberry32(this.seed ^ 0x77), 6),
    };
  }

  get world() {
    return this.ctx.world;
  }

  get time() {
    return this.ctx.world.state.time;
  }

  get generation() {
    return this.agent.state.generation;
  }

  private snapshotDay(): DayStats {
    const s = this.agent.state;
    return {
      day: this.world.day,
      utcStart: simToUTC(this.time),
      generation: s.generation,
      foodEaten: s.behaviorStats.foodEaten,
      distance: s.behaviorStats.distanceTravelled,
      cachesMade: s.behaviorStats.cachesMade,
      cachesRetrieved: s.behaviorStats.cachesRetrieved,
      pilfered: s.behaviorStats.pilfersByRivals,
      encounters: s.behaviorStats.threatEncounters,
      contacts: s.behaviorStats.contacts,
      memories: 0,
      placeCells: this.ctx.neural.placeCount,
      newPlaceCells: 0,
      replays: this.ctx.neural.replays.length,
      explored: 0,
      radius: 0,
      health: s.health,
      realism: 0,
      events: [],
    };
  }

  private closeDay() {
    const s = this.agent.state;
    const a = this.dayStart;
    const b = this.snapshotDay();
    const lastEventId = this.ctx.events.log.find((e) => e.time >= (a.day - 1) * DAY_LENGTH)?.id ?? Infinity;
    const events = this.ctx.events.log.filter((e: LabEvent) => e.id >= lastEventId);
    this.journal.write({
      ...a,
      foodEaten: b.foodEaten - a.foodEaten,
      distance: b.distance - a.distance,
      cachesMade: b.cachesMade - a.cachesMade,
      cachesRetrieved: b.cachesRetrieved - a.cachesRetrieved,
      pilfered: b.pilfered - a.pilfered,
      encounters: b.encounters - a.encounters,
      contacts: b.contacts - a.contacts,
      memories: this.ctx.memory.memories.length,
      placeCells: this.ctx.neural.placeCount,
      newPlaceCells: this.ctx.neural.placeCount - a.placeCells,
      replays: this.ctx.neural.replays.filter((r) => r.time >= (a.day - 1) * DAY_LENGTH).length,
      explored: this.ctx.memory.exploredFraction(),
      radius: s.behaviorStats.maxRadius,
      health: s.health,
      realism: this.ctx.calibration.realism(),
      events,
    });
    this.ctx.calibration.calibrate();
    this.agent.onNewDay();
    this.dayStart = this.snapshotDay();
  }

  step(dt: number) {
    const { world, events, rivals } = this.ctx;
    const subjects = [this.agent.subjectView, ...(rivals?.views() ?? [])];
    const contacts = world.update(dt, subjects);
    for (const c of contacts) {
      if (c.targetId === "subject") this.agent.onContact(c);
      else {
        const r = rivals?.rivals.find((x) => x.id === c.targetId);
        if (r && c.kind === "hawk" && this.ctx.rng() < 0.35) {
          r.alive = false;
          events.add(world.state.time, `${r.name} was taken by a red-tailed hawk`, "danger", { location: { ...r.position } });
        }
      }
    }

    const s = this.agent.state;
    if (rivals) {
      const nearFood = (this.agent.perception?.foods[0]?.distance ?? 99) < 3;
      rivals.update(dt, s.alive ? { id: "subject", position: s.position, climbHeight: s.anim.climbHeight, caching: s.currentGoal?.type === "STORE_FOOD" && s.currentGoal.phase === "dig", nearFood } : null);
      for (const it of rivals.interactions) {
        if (it.kind === "chase-subject" && s.alive) {
          s.fear = clamp(s.fear + 0.25);
          this.ctx.calibration.noteFlag(world.state.time);
          this.ctx.rewards.emit(world.state.time, -0.12, "CHASED BY COMPETITOR");
          events.add(world.state.time, `chased by ${it.rivalId}`, "social", { location: it.position });
        } else if (it.kind === "pilfer") {
          const f = world.state.foodSources.find((x) => x.id === it.foodId);
          if (f?.owner === "subject") {
            s.behaviorStats.pilfersByRivals++;
            events.add(world.state.time, `${it.rivalId} dug up one of the subject's caches`, "social", { location: it.position });
          }
        }
      }
      rivals.interactions.length = 0;
      // replenish the resident population slowly (immigration)
      if (rivals.rivals.filter((r) => r.alive).length < 4 && this.ctx.rng() < dt / (DAY_LENGTH * 6)) {
        const dead = rivals.rivals.find((r) => !r.alive);
        if (dead) {
          dead.alive = true;
          dead.mode = "forage";
          dead.position = { x: dead.home.x, y: world.surfaceHeight(dead.home.x, dead.home.z), z: dead.home.z };
          events.add(world.state.time, `a new squirrel settled near ${dead.name}'s former range`, "social");
        }
      }
    }

    this.agent.update(dt);
    this.trailTimer += dt;
    if (this.trailTimer >= TRAIL_DT) {
      this.trailTimer = 0;
      this.pushTrail(world.state.time, s.position.x, s.position.z, s.generation);
    }
    if (s.alive) this.metrics.update(dt, this.agent, this.ctx);
    else this.handleDeath(dt);

    const dayIndex = Math.floor(world.state.time / DAY_LENGTH);
    if (dayIndex !== this.lastDayIndex) {
      this.lastDayIndex = dayIndex;
      this.closeDay();
    }

    if (world.notices.length) {
      for (const n of world.notices) {
        const cat = n.kind === "threat" ? "danger" : "environment";
        events.add(world.state.time, n.text, cat, { location: n.location });
        if (n.kind === "storm") {
          events.milestone("FIRST_STORM", world.state.time, n.text, "environment", {
            title: "STORM DAMAGE",
            detail: `Real wind gusts recorded over Central Park on this date (${Math.round(world.state.env.gustKmh)} km/h) brought down a tree. Memories tied to it are now wrong and must be relearned.`,
            metrics: [
              { label: "GUSTS", value: `${Math.round(world.state.env.gustKmh)} km/h` },
              { label: "TEMP", value: `${world.state.env.tempC.toFixed(1)} °C` },
            ],
            location: n.location,
          });
        }
        if (n.kind === "snow") {
          events.milestone("FIRST_SNOW", world.state.time, n.text, "environment", {
            title: "FIRST SNOW",
            detail: "Snow from the real weather record now covers the site. Surface food is hidden; buried caches can still be found by smell, so hoarded food becomes critical.",
            metrics: [
              { label: "TEMP", value: `${world.state.env.tempC.toFixed(1)} °C` },
              { label: "CACHES MADE", value: String(s.behaviorStats.cachesMade) },
            ],
          });
        }
      }
      world.notices.length = 0;
    }
  }

  private handleDeath(dt: number) {
    const { events, world } = this.ctx;
    const s = this.agent.state;
    if (this.deathTimer < 0) {
      this.deathTimer = 0;
      const cause = s.hunger >= 0.99 ? "starvation" : s.thirst >= 0.99 ? "dehydration" : s.warmth < 0.2 ? "exposure" : s.behaviorStats.contacts > 0 ? "predation injuries" : "unknown causes";
      const days = (world.state.time - s.bornAt) / DAY_LENGTH;
      this.lineage.push({
        generation: s.generation,
        bornAt: s.bornAt,
        diedAt: world.state.time,
        cause,
        fur: s.fur,
        personality: this.personality,
        foodEaten: s.behaviorStats.foodEaten,
        cachesMade: s.behaviorStats.cachesMade,
        placeCells: this.ctx.neural.placeCount,
        daysAlive: days,
      });
      events.reset(["SUBJECT_DIED"]);
      events.milestone("SUBJECT_DIED", world.state.time, `generation ${s.generation} subject died (${cause})`, "danger", {
        title: "SUBJECT DECEASED",
        detail: `Generation ${s.generation} died of ${cause} after ${days.toFixed(1)} days. Its learned knowledge — memories, place map and synaptic weights — is lost. Its instincts pass to the next generation with small mutations.`,
        metrics: [
          { label: "DAYS ALIVE", value: days.toFixed(1) },
          { label: "FOOD EATEN", value: String(s.behaviorStats.foodEaten) },
          { label: "PLACE CELLS", value: String(this.ctx.neural.placeCount) },
        ],
        location: { ...s.position },
      });
    }
    this.deathTimer += dt;
    if (this.deathTimer > 25) this.newGeneration();
  }

  /** offspring inherit mutated instincts and personality, but none of the parent's memories */
  private newGeneration() {
    const rng = this.ctx.rng;
    const parent = this.genome;
    const mut = (v: number, lo: number, hi: number) => clamp(v + gaussian(rng) * (hi - lo) * 0.08, lo, hi);
    const p = parent.personality;
    const child: Genome = {
      personality: {
        boldness: mut(p.boldness, 0.1, 0.95),
        curiosityBase: mut(p.curiosityBase, 0.3, 1),
        metabolism: mut(p.metabolism, 0.8, 1.2),
        retention: mut(p.retention, 0.2, 0.95),
        learningRate: mut(p.learningRate, 0.1, 0.4),
        temperature: mut(p.temperature, 0.04, 0.16),
        vigilance: mut(p.vigilance, 0.1, 0.7),
        hoarding: mut(p.hoarding, 0.1, 0.95),
      },
      innate: parent.innate.map((w) => clamp(w + gaussian(rng) * 0.08, 0.4, 1.8)),
      fur: rng() < 0.85 ? parent.fur : sampleFur(rng),
    };
    // survival-weighted selection: a parent that lived long passes its instincts more faithfully
    this.genome = child;
    this.personality = child.personality;
    const generation = this.agent.state.generation + 1;
    const prevCtx = this.ctx;
    // the successor is a yearling from the lineage's previous litter (gray squirrels emerge in spring and late summer,
    // never mid-winter). It already lives in this range: it knows the water, a few reliable feeding places,
    // and — as in documented territory bequeathal (Berteaux & Boutin 2000) — it takes over the parent's caches.
    const parentMem = prevCtx.memory.memories;
    const byUse = (a: { successCount: number; recallCount: number }, b: { successCount: number; recallCount: number }) =>
      b.successCount + b.recallCount - (a.successCount + a.recallCount);
    const food = parentMem.filter((m) => m.type === "food" && m.subtype !== "toxic" && m.subtype !== "cache").sort(byUse).slice(0, 6);
    const water = parentMem.filter((m) => m.subtype === "water" && !m.label.includes("PUDDLE")).sort(byUse).slice(0, 2);
    const parentHome = this.agent.homeTree.position;
    const parentCaches = this.world.state.foodSources.filter((f) => f.kind === "cache" && f.owner === "subject" && f.amount >= 1);
    this.ctx = this.buildContext(this.world, rng, child, prevCtx);
    this.agent = new SquirrelAgent(this.ctx, { fur: child.fur, generation });
    const mem = this.ctx.memory;
    for (const m of [...food, ...water]) {
      mem.form({ type: m.type, location: m.location, label: m.label.replace(" (KIN)", "") + " (KIN)", importance: 0.55, emotionalValue: 0.35, time: this.time, sourceId: m.sourceId, subtype: m.subtype, noise: 4 });
    }
    if (!water.length) this.knowNearestWater("(KIN)");
    const inherited = parentCaches.sort((a, b) => dist2D(a.position, parentHome) - dist2D(b.position, parentHome)).slice(0, 60);
    for (const f of inherited) {
      mem.form({ type: "food", location: f.position, label: "INHERITED CACHE", importance: 0.6, emotionalValue: 0.4, time: this.time, sourceId: f.id, subtype: "cache", noise: 2.5 });
    }
    // a yearling has foraged all autumn: it starts in fair condition
    const st = this.agent.state;
    st.hunger = 0.25;
    st.thirst = 0.15;
    st.energy = 0.9;
    this.metrics.resetForGeneration(this.agent);
    this.deathTimer = -1;
    this.ctx.events.reset(GENERATION_MILESTONES);
    this.ctx.events.milestone("NEW_GENERATION", this.time, `generation ${generation} emerged from the nest`, "behavior", {
      title: `GENERATION ${generation}`,
      detail: "A yearling from the lineage's previous litter takes over the range. It inherits mutated instincts (innate synaptic biases), temperament, the parent's caches and a little local knowledge, but its place map and learned values start empty.",
      metrics: [
        { label: "BOLDNESS", value: child.personality.boldness.toFixed(2) },
        { label: "HOARDING", value: child.personality.hoarding.toFixed(2) },
        { label: "FUR", value: child.fur.toUpperCase() },
        { label: "INHERITED CACHES", value: String(inherited.length) },
      ],
    });
    this.ctx.events.reset(["NEW_GENERATION"]);
    this.dayStart = this.snapshotDay();
  }

  /** advance by real elapsed seconds at a given speed multiplier; returns steps run */
  advance(realDt: number, speed: number, maxSteps = 240) {
    this.accumulator += Math.min(realDt, 0.1) * speed;
    // coarser steps and shorter neural windows at high time acceleration keep CPU cost bounded
    const dt = speed >= 50 ? FIXED_DT * 2 : FIXED_DT;
    this.agent.neuralWindowMs = speed >= 50 ? 20 : speed >= 10 ? 35 : 50;
    let steps = 0;
    while (this.accumulator >= dt && steps < maxSteps) {
      this.step(dt);
      this.accumulator -= dt;
      steps++;
    }
    if (steps >= maxSteps) this.accumulator = 0;
    const rate = realDt > 0 ? (steps * dt) / Math.min(realDt, 0.1) : speed;
    this.effectiveRate += (rate - this.effectiveRate) * 0.1;
    this.lastWall = Date.now();
    return steps;
  }

  /** run a block of simulated time as fast as possible (offline catch-up) */
  fastForward(simSeconds: number, budgetMs = 40) {
    const start = performance.now();
    const dt = FIXED_DT * 2;
    this.agent.neuralWindowMs = 20;
    let done = 0;
    while (done < simSeconds && performance.now() - start < budgetMs) {
      this.step(dt);
      done += dt;
    }
    this.lastWall = Date.now();
    return done;
  }

  private knowNearestWater(tag: string) {
    const home = this.agent.homeTree.position;
    const edge = this.world.terrain.site.nearestWaterEdge(home.x, home.z, 400);
    if (!edge) return;
    const src = this.world.state.waterSources.find((w) => w.name === edge.body?.name && w.kind !== "puddle");
    this.ctx.memory.form({
      type: "environment",
      location: { x: edge.x, y: 0, z: edge.z },
      label: `WATER · ${edge.body?.name ?? "LAKE"} ${tag}`,
      importance: 0.6,
      emotionalValue: 0.4,
      time: this.time,
      sourceId: src?.id,
      subtype: "water",
      noise: 3,
    });
  }

  /** objects whose scalar fields are saved generically */
  private stateful(): [string, object][] {
    const c = this.ctx;
    return [
      ["experiment", this],
      ["world", c.world],
      ["memory", c.memory],
      ["learning", c.learning],
      ["rewards", c.rewards],
      ["events", c.events],
      ["brain", c.brain],
      ["motivation", c.motivation],
      ["decision", c.decision],
      ["neural", c.neural],
      ["calibration", c.calibration],
      ["metrics", this.metrics],
      ["agent", this.agent],
    ];
  }

  private pushTrail(t: number, x: number, z: number, gen: number) {
    if (this.trailCount >= TRAIL_CAP) {
      // keep the full history at half resolution
      const half = Math.floor(TRAIL_CAP / 2);
      for (let i = 0; i < half; i++) this.trail.copyWithin(i * 4, i * 8, i * 8 + 4);
      this.trailCount = half;
    }
    const k = this.trailCount * 4;
    this.trail[k] = t;
    this.trail[k + 1] = x;
    this.trail[k + 2] = z;
    this.trail[k + 3] = gen;
    this.trailCount++;
  }

  profile(): BehavioralProfile {
    return this.metrics.profile(this.agent, this.ctx, this.personality);
  }

  // ─────────────────────────── persistence ───────────────────────────

  snapshot() {
    const c = this.ctx;
    return {
      version: 3,
      seed: this.seed,
      number: this.number,
      savedAt: Date.now(),
      rng: c.rng.getState(),
      personality: this.personality,
      genome: { personality: this.genome.personality, innate: Array.from(this.genome.innate), fur: this.genome.fur },
      world: { state: c.world.state, masting: c.world.masting, buried: f32ToB64(c.world.buried), rng: c.world.rngState() },
      memory: c.memory.toJSON(),
      learning: c.learning.toJSON(),
      rewards: c.rewards.toJSON(),
      events: c.events.toJSON(),
      brain: c.brain.toJSON(),
      neural: c.neural.toJSON(),
      calibration: c.calibration.toJSON(),
      rivals: c.rivals?.toJSON() ?? [],
      agent: this.agent.toJSON(),
      metrics: this.metrics.toJSON(),
      journal: this.journal.toJSON(),
      lineage: this.lineage,
      lastDayIndex: this.lastDayIndex,
      dayStart: { ...this.dayStart, events: [] },
      trail: f32ToB64(this.trail.subarray(0, this.trailCount * 4)),
      // every counter and timer of every subsystem, for an exact continuation
      scalars: Object.fromEntries(this.stateful().map(([k, o]) => [k, captureScalars(o)])),
    };
  }

  static restore(snap: ReturnType<Experiment["snapshot"]>) {
    const exp = new Experiment(snap.seed, snap.number);
    exp.genome = { personality: snap.genome.personality, innate: Float32Array.from(snap.genome.innate), fur: snap.genome.fur };
    exp.personality = snap.personality;
    if (snap.agent.state.generation > 1) {
      exp.ctx = exp.buildContext(exp.world, exp.ctx.rng, exp.genome, exp.ctx);
    }
    const c = exp.ctx;
    c.rng.setState(snap.rng);
    Object.assign(c.world.state, snap.world.state);
    c.world.masting = snap.world.masting;
    if (snap.world.buried) c.world.buried.set(b64ToF32(snap.world.buried));
    c.world.syncClock();
    // syncClock re-derives the environment; keep the smoothed weather exactly as saved
    const ws = snap.world.state;
    Object.assign(c.world.state, { rainAmount: ws.rainAmount, snowAmount: ws.snowAmount, fogAmount: ws.fogAmount, floodRise: ws.floodRise, weather: ws.weather, env: { ...ws.env } });
    c.world.buildGrids();
    c.world.benches = c.world.state.objects.filter((o) => o.kind === "bench");
    c.memory.load(snap.memory);
    c.learning.load(snap.learning);
    c.rewards.load(snap.rewards);
    c.events.load(snap.events);
    c.brain.load(snap.brain);
    c.neural.load(snap.neural);
    c.calibration.load(snap.calibration);
    c.rivals?.load(snap.rivals);
    exp.agent = new SquirrelAgent(c, { fur: snap.genome.fur, generation: snap.agent.state.generation });
    exp.agent.load(snap.agent);
    exp.metrics.load(snap.metrics);
    exp.journal.load(snap.journal);
    exp.lineage = snap.lineage;
    exp.lastDayIndex = snap.lastDayIndex;
    exp.dayStart = { ...snap.dayStart, events: [] };
    if (snap.scalars) for (const [k, o] of exp.stateful()) restoreScalars(o, snap.scalars[k] as Record<string, unknown>);
    if (snap.world.rng !== undefined) c.world.setRngState(snap.world.rng);
    c.rng.setState(snap.rng);
    if (snap.trail) {
      const tr = b64ToF32(snap.trail);
      exp.trailCount = Math.min(TRAIL_CAP, Math.floor(tr.length / 4));
      exp.trail.set(tr.subarray(0, exp.trailCount * 4));
    }
    // force an environment refresh on the next step
    c.world.state.foodVersion++;
    c.world.state.structureVersion++;
    return exp;
  }
}

export type ExperimentSnapshot = ReturnType<Experiment["snapshot"]>;
