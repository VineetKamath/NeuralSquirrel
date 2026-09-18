"use client";

import { create } from "zustand";
import type {
  ActionType,
  BehavioralProfile,
  DaySummary,
  EnvironmentState,
  HistorySample,
  JournalEntry,
  LabEvent,
  LearnedLocation,
  LearningMetrics,
  Memory,
  Preference,
  RewardSignal,
  ThoughtEntry,
  Vector3,
  Weather,
} from "@/types";
import type { Experiment, LineageRecord } from "@/simulation/Experiment";
import { createExperiment, getExperiment, restoreExperiment } from "./runtime";
import { loadRecords, nextExperimentNumber, saveRecord, type ExperimentRecord } from "./persistence";
import { CURRENT_KEY, idbSet } from "./saveStore";
import { newSeed } from "@/utils/rng";
import { DAY_LENGTH, TIME_SCALES } from "@/simulation/constants";
import { COMPARABLE } from "@/real/census";
import { realDateString } from "@/utils/format";
import { LIVE } from "./liveMode";
import { detectQuality } from "@/utils/device";

export const SPEEDS = TIME_SCALES.map((t) => t.speed);

export type LabMode = "observe" | "neural" | "ecology";

export interface RivalSnap {
  id: string;
  name: string;
  fur: string;
  mode: string;
  alive: boolean;
  position: Vector3;
  cached: number;
  pilfered: number;
  eaten: number;
  distance: number;
  censusMembers: number;
}

export interface Snapshot {
  time: number;
  day: number;
  dateLabel: string;
  weather: Weather;
  env: EnvironmentState;
  daylight: number;
  hunger: number;
  thirst: number;
  energy: number;
  curiosity: number;
  fear: number;
  safety: number;
  health: number;
  warmth: number;
  confidence: number;
  exploration: number;
  alive: boolean;
  generation: number;
  fur: string;
  ageDays: number;
  inDrey: boolean;
  position: Vector3;
  piError: number;
  speed: number;
  heading: number;
  goalType: ActionType | null;
  goalLabel: string;
  goalPhase: string;
  goalTarget: Vector3 | null;
  goalDistance: number;
  memoryCount: number;
  knownLocations: number;
  activeNodes: number;
  synapses: number;
  development: number;
  metrics: LearningMetrics;
  navSkill: number;
  vigilance: number;
  audienceCaution: number;
  encodingPrecision: number;
  explored: number;
  qStates: number;
  qUpdates: number;
  decisionConfidence: number;
  candidates: { type: ActionType; label: string; total: number; q: number; neural: number; utility: number }[];
  memories: Memory[];
  locations: LearnedLocation[];
  preferences: Preference[];
  stats: {
    distance: number;
    foodEaten: number;
    discovered: number;
    encounters: number;
    contacts: number;
    escapes: number;
    recalls: number;
    recallSuccesses: number;
    caches: number;
    retrieved: number;
    pilfered: number;
    stolenFrom: number;
    chases: number;
    alarms: number;
    mistakes: number;
    decisions: number;
  };
  milestones: number;
  threatNear: boolean;
  threatLabel: string;
  visionRange: number;
  effectiveRate: number;
  foodPreference: Record<string, number>;
  objectFood: Record<string, number>;
  neural: {
    neurons: number;
    placeCells: number;
    spikesPerWindow: number;
    totalSpikes: number;
    dopamine: number;
    delta: number;
    value: number;
    learningEvents: number;
    replays: number;
    neuralWeight: number;
    popRates: Record<string, number>;
  };
  realism: number;
  censusSim: Record<string, number>;
  censusReal: Record<string, number>;
  censusSamples: number;
  calibrationBias: Record<string, number>;
  rivals: RivalSnap[];
  energyNeed: number;
}

interface LabState {
  booted: boolean;
  running: boolean;
  speed: number;
  experimentNumber: number;
  seed: number;
  version: number;
  mode: LabMode;

  cinematic: boolean;
  mapOpen: boolean;
  dataOpen: boolean;
  archiveOpen: boolean;
  journalOpen: boolean;
  settingsOpen: boolean;
  paletteOpen: boolean;
  overlays: boolean;
  audio: boolean;
  autoSlow: boolean;
  recording: boolean;
  recordStart: number;
  truthMap: boolean;
  autosave: boolean;
  catchUp: boolean;
  quality: "low" | "medium" | "high";
  lastSaved: number;
  catchingUp: { from: number; to: number; progress: number } | null;
  server: { url: string; connected: boolean; status: string };

  focusMemoryId: string | null;
  selectedNeuron: number | null;
  /** an event to replay on the ecology map (time-lapse around its time and place) */
  replay: { time: number; x: number; z: number; label: string } | null;
  discovery: LabEvent | null;
  discoveryQueue: LabEvent[];
  dayReport: JournalEntry | null;

  snap: Snapshot | null;
  events: LabEvent[];
  rewards: RewardSignal[];
  thoughts: ThoughtEntry[];
  history: HistorySample[];
  days: DaySummary[];
  journal: JournalEntry[];
  lineage: LineageRecord[];
  profile: BehavioralProfile | null;
  records: ExperimentRecord[];

  setBooted: () => void;
  toggleRunning: () => void;
  setRunning: (v: boolean) => void;
  setSpeed: (v: number) => void;
  setMode: (m: LabMode) => void;
  toggle: (
    key: "cinematic" | "mapOpen" | "dataOpen" | "archiveOpen" | "overlays" | "audio" | "autoSlow" | "truthMap" | "journalOpen" | "settingsOpen" | "paletteOpen" | "autosave" | "catchUp"
  ) => void;
  set: (patch: Partial<LabState>) => void;
  setRecording: (v: boolean) => void;
  viewMemory: (id: string | null) => void;
  selectNeuron: (id: number | null) => void;
  dismissDiscovery: () => void;
  newExperiment: (seed?: number) => void;
  resetExperiment: () => void;
  loadSnapshot: (exp: Experiment) => void;
  publish: (exp: Experiment) => void;
  publishSlow: (exp: Experiment) => void;
  persist: (exp: Experiment) => void;
  saveNow: (exp: Experiment) => Promise<boolean>;
}

function buildSnapshot(exp: Experiment): Snapshot {
  const { world, memory, learning, brain, motivation, decision, neural, calibration, rivals } = exp.ctx;
  const agent = exp.agent;
  const s = agent.state;
  const g = s.currentGoal;
  const per = agent.perception;
  const st = s.behaviorStats;
  const sortedMem = memory.memories
    .slice()
    .sort((a, b) => b.importance * (0.4 + b.confidence) - a.importance * (0.4 + a.confidence))
    .slice(0, 60)
    .map((m) => ({ ...m, location: { ...m.location } }));
  const threat = per?.threats[0];
  const sim = calibration.simulated("ALL");
  const real = calibration.real("ALL");
  return {
    time: world.state.time,
    day: world.day,
    dateLabel: realDateString(world.state.time),
    weather: world.state.weather,
    env: { ...world.state.env },
    daylight: world.daylight,
    hunger: s.hunger,
    thirst: s.thirst,
    energy: s.energy,
    curiosity: s.curiosity,
    fear: s.fear,
    safety: s.safety,
    health: s.health,
    warmth: s.warmth,
    confidence: s.confidence,
    exploration: motivation.drives(s).EXPLORATION,
    alive: s.alive,
    generation: s.generation,
    fur: s.fur,
    ageDays: (world.state.time - s.bornAt) / DAY_LENGTH,
    inDrey: agent.inDrey,
    position: { ...s.position },
    piError: Math.hypot(s.piError.x, s.piError.z),
    speed: s.anim.speed,
    heading: s.anim.heading,
    goalType: g?.type ?? null,
    goalLabel: s.alive ? (g?.label ?? "ORIENTING") : "NO VITAL SIGNS",
    goalPhase: g?.phase ?? "",
    goalTarget: g?.target ? { ...g.target } : null,
    goalDistance: g?.target ? Math.hypot(g.target.x - s.position.x, g.target.z - s.position.z) : 0,
    memoryCount: memory.memories.length,
    knownLocations: memory.learnedLocations.length,
    activeNodes: brain.activeCount(0.3),
    synapses: brain.synapses(memory.memories.length, learning.tableSize()) + neural.placeCount * 24,
    development: brain.development,
    metrics: { ...learning.metrics },
    navSkill: learning.navSkill,
    vigilance: learning.vigilance,
    audienceCaution: learning.audienceCaution,
    encodingPrecision: memory.encodingPrecision,
    explored: memory.exploredFraction(),
    qStates: learning.tableSize(),
    qUpdates: learning.updates,
    decisionConfidence: learning.decisionConfidence,
    candidates: decision.lastCandidates.slice(0, 7).map((c) => ({ type: c.type, label: c.label, total: c.total, q: c.q, neural: c.neural ?? 0, utility: c.utility })),
    memories: sortedMem,
    locations: memory.learnedLocations.map((l) => ({ ...l })),
    preferences: s.preferences.map((p) => ({ ...p })),
    stats: {
      distance: st.distanceTravelled,
      foodEaten: st.foodEaten,
      discovered: st.foodDiscovered,
      encounters: st.threatEncounters,
      contacts: st.contacts,
      escapes: st.escapes,
      recalls: st.memoryRecalls,
      recallSuccesses: st.recallSuccesses,
      caches: st.cachesMade,
      retrieved: st.cachesRetrieved,
      pilfered: st.cachesPilfered,
      stolenFrom: st.pilfersByRivals,
      chases: st.chases,
      alarms: st.alarmCalls,
      mistakes: st.mistakes,
      decisions: st.decisions,
    },
    milestones: exp.ctx.events.achieved.size,
    threatNear: !!threat,
    threatLabel: threat ? `${threat.threat.kind.toUpperCase()} · ${threat.distance.toFixed(1)} m` : "",
    visionRange: per?.visionRange ?? 0,
    effectiveRate: exp.effectiveRate,
    foodPreference: { ...learning.foodPreference },
    objectFood: { ...learning.objectFood },
    neural: {
      neurons: neural.N,
      placeCells: neural.placeCount,
      spikesPerWindow: neural.windowSpikes,
      totalSpikes: neural.totalSpikes,
      dopamine: neural.dopamine,
      delta: neural.delta,
      value: neural.valueNow,
      learningEvents: neural.learningEvents,
      replays: neural.replays.length,
      neuralWeight: (exp.ctx.decision as { neuralWeight?: (c: { neural: typeof neural }) => number }).neuralWeight?.({ neural } as never) ?? 0,
      popRates: { ...neural.popRate },
    },
    realism: calibration.realism(),
    censusSim: Object.fromEntries(COMPARABLE.map((c) => [c.key, sim[c.key]])),
    censusReal: Object.fromEntries(COMPARABLE.map((c) => [c.key, real[c.key]])),
    censusSamples: calibration.sampleCount(),
    calibrationBias: { ...calibration.bias },
    rivals: (rivals?.rivals ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      fur: r.fur,
      mode: r.mode,
      alive: r.alive,
      position: { ...r.position },
      cached: r.stats.cached,
      pilfered: r.stats.pilfered,
      eaten: r.stats.eaten,
      distance: Math.hypot(r.position.x - s.position.x, r.position.z - s.position.z),
      censusMembers: r.censusMembers,
    })),
    energyNeed: motivation.energyNeedToday,
  };
}

let lastEventId = 0;
let lastRewardId = 0;
let lastThoughtId = 0;
let lastJournal = 0;

const PREFS_KEY = "squirrel-lab:prefs:v2";
function loadPrefs(): Partial<LabState> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function savePrefs(s: LabState) {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ audio: s.audio, overlays: s.overlays, autoSlow: s.autoSlow, autosave: s.autosave, catchUp: s.catchUp, quality: s.quality, speed: s.speed, server: { url: s.server.url } })
    );
  } catch {
    /* ignore */
  }
}

const initialPrefs = typeof window !== "undefined" ? loadPrefs() : {};

export const useLab = create<LabState>((set, get) => ({
  booted: false,
  running: false,
  speed: 1,
  experimentNumber: 1,
  seed: 728491,
  version: 0,
  mode: "observe",

  cinematic: false,
  mapOpen: false,
  dataOpen: false,
  archiveOpen: false,
  journalOpen: false,
  settingsOpen: false,
  paletteOpen: false,
  overlays: true,
  audio: true,
  autoSlow: true,
  recording: false,
  recordStart: 0,
  truthMap: false,
  autosave: true,
  catchUp: true,
  quality: typeof window !== "undefined" ? detectQuality() : "high",
  lastSaved: 0,
  catchingUp: null,
  server: { url: "http://localhost:4317", connected: false, status: "" },

  focusMemoryId: null,
  selectedNeuron: null,
  replay: null,
  discovery: null,
  discoveryQueue: [],
  dayReport: null,

  snap: null,
  events: [],
  rewards: [],
  thoughts: [],
  history: [],
  days: [],
  journal: [],
  lineage: [],
  profile: null,
  records: [],
  ...initialPrefs,

  setBooted: () => set({ booted: true, running: true, records: loadRecords() }),
  toggleRunning: () => set((s) => ({ running: !s.running })),
  setRunning: (v) => set({ running: v }),
  setSpeed: (v) => {
    set({ speed: v });
    savePrefs(get());
  },
  setMode: (m) => set({ mode: m, cinematic: false }),
  toggle: (key) => {
    set((s) => ({ [key]: !s[key] }) as Partial<LabState>);
    savePrefs(get());
  },
  set: (patch) => {
    set(patch);
    savePrefs(get());
  },
  setRecording: (v) => set({ recording: v, recordStart: performance.now() }),
  viewMemory: (id) => set({ focusMemoryId: id, mapOpen: id ? true : get().mapOpen }),
  selectNeuron: (id) => {
    const exp = getExperiment();
    exp.ctx.neural.probeId = id ?? -1;
    set({ selectedNeuron: id });
  },
  dismissDiscovery: () =>
    set((s) => {
      const [next, ...rest] = s.discoveryQueue;
      return { discovery: next ?? null, discoveryQueue: rest };
    }),

  newExperiment: (seed) => {
    const prev = getExperiment();
    get().persist(prev);
    const number = Math.max(nextExperimentNumber(), get().experimentNumber + 1);
    const sd = seed ?? newSeed();
    const exp = createExperiment(sd, number);
    lastEventId = lastRewardId = lastThoughtId = lastJournal = 0;
    set((s) => ({
      experimentNumber: number,
      seed: sd,
      version: s.version + 1,
      events: [],
      rewards: [],
      thoughts: [],
      history: [],
      days: [],
      journal: [],
      lineage: [],
      discovery: null,
      discoveryQueue: [],
      dayReport: null,
      focusMemoryId: null,
      selectedNeuron: null,
      running: true,
      speed: 1,
    }));
    get().publish(exp);
    get().publishSlow(exp);
    void get().saveNow(exp);
  },

  resetExperiment: () => {
    const { seed, experimentNumber } = get();
    const exp = createExperiment(seed, experimentNumber);
    lastEventId = lastRewardId = lastThoughtId = lastJournal = 0;
    set((s) => ({
      version: s.version + 1,
      events: [],
      rewards: [],
      thoughts: [],
      history: [],
      days: [],
      journal: [],
      lineage: [],
      discovery: null,
      discoveryQueue: [],
      dayReport: null,
      focusMemoryId: null,
      running: true,
    }));
    get().publish(exp);
    get().publishSlow(exp);
  },

  loadSnapshot: (exp) => {
    lastEventId = exp.ctx.events.lastId;
    lastRewardId = exp.ctx.rewards.lastId;
    lastThoughtId = exp.ctx.brain.lastThoughtId;
    lastJournal = exp.journal.entries.length;
    set((s) => ({
      experimentNumber: exp.number,
      seed: exp.seed,
      version: s.version + 1,
      events: exp.ctx.events.log.slice(-160),
      discovery: null,
      discoveryQueue: [],
    }));
    get().publish(exp);
    get().publishSlow(exp);
  },

  publish: (exp) => {
    const { events, rewards, brain } = exp.ctx;
    const patch: Partial<LabState> = { snap: buildSnapshot(exp) };
    if (events.lastId !== lastEventId) {
      const fresh = events.log.filter((e) => e.id > lastEventId);
      lastEventId = events.lastId;
      patch.events = events.log.slice(-160);
      const majors = fresh.filter((e) => e.major);
      if (majors.length) {
        const st = get();
        const queue = [...st.discoveryQueue, ...majors].slice(-4);
        if (!st.discovery) patch.discovery = queue.shift() ?? null;
        patch.discoveryQueue = queue;
        if (st.autoSlow && st.speed > 5 && !LIVE) patch.speed = 2;
      }
    }
    if (rewards.lastId !== lastRewardId) {
      lastRewardId = rewards.lastId;
      patch.rewards = rewards.log.slice(-14);
    }
    if (brain.lastThoughtId !== lastThoughtId) {
      lastThoughtId = brain.lastThoughtId;
      patch.thoughts = brain.thoughts.slice(-14);
    }
    if (exp.journal.entries.length !== lastJournal) {
      lastJournal = exp.journal.entries.length;
      patch.journal = exp.journal.entries.slice();
      const latest = exp.journal.entries[exp.journal.entries.length - 1];
      if (latest && get().speed <= 10 && !get().cinematic) patch.dayReport = latest;
    }
    set(patch);
  },

  publishSlow: (exp) => {
    set({
      history: exp.metrics.history.slice(),
      days: exp.metrics.days.slice(),
      profile: exp.profile(),
      lineage: exp.lineage.slice(),
      journal: exp.journal.entries.slice(),
    });
  },

  persist: (exp) => {
    if (LIVE || exp.time < 20) return;
    const s = exp.agent.state;
    saveRecord({
      number: exp.number,
      seed: exp.seed,
      createdAt: Date.now() - Math.round(exp.time * 1000),
      updatedAt: Date.now(),
      simDays: exp.time / DAY_LENGTH,
      metrics: { ...exp.ctx.learning.metrics },
      profile: exp.profile(),
      days: exp.metrics.days.slice(-60),
      milestones: exp.ctx.events.achieved.size,
      memories: exp.ctx.memory.memories.length,
      foodEaten: s.behaviorStats.foodEaten,
      contacts: s.behaviorStats.contacts,
      distance: s.behaviorStats.distanceTravelled,
    });
    set({ records: loadRecords() });
  },

  saveNow: async (exp) => {
    const ok = await idbSet(CURRENT_KEY, exp.snapshot());
    if (ok) set({ lastSaved: Date.now() });
    return ok;
  },
}));

export async function resumeFromSnapshot(snap: Parameters<typeof restoreExperiment>[0]) {
  const exp = restoreExperiment(snap);
  useLab.getState().loadSnapshot(exp);
  return exp;
}
