// Core type definitions for the Squirrel Lab simulation.
// Simulation types are renderer-agnostic: plain objects only, no three.js.

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export type Weather = "clear" | "cloudy" | "rain" | "fog" | "snow" | "storm";

export type ObjectKind = "oak" | "pine" | "birch" | "bush" | "rock" | "log" | "stump" | "mushroom" | "bench" | "lamp";

export interface WorldObject {
  id: string;
  kind: ObjectKind;
  position: Vector3;
  /** collision / footprint radius */
  radius: number;
  height: number;
  rotation: number;
  scale: number;
  variant: number;
  /** provides cover from aerial threats */
  cover: boolean;
  climbable: boolean;
  /** for logs: length along rotation axis */
  length?: number;
  /** name if this object is a landmark */
  landmarkId?: string;
  /** deciduous trees lose their cover value in winter */
  deciduous?: boolean;
  /** acorn crop size for oaks (masting varies between trees) */
  crop?: number;
  /** set when a storm has brought the tree down */
  fallen?: boolean;
}

export type FoodKind = "acorn" | "berry" | "mushroom" | "cache" | "buds" | "seeds" | "scraps";

export interface FoodSource {
  id: string;
  kind: FoodKind;
  position: Vector3;
  amount: number;
  maxAmount: number;
  /** units regrown per simulated day */
  regrowRate: number;
  nutrition: number;
  /** perception radius multiplier (hidden caches are low) */
  visibility: number;
  /** requires active investigation to detect */
  hidden: boolean;
  toxic: boolean;
  createdBySubject: boolean;
  /** caches: which squirrel buried it ("subject", rival id, or "resident") */
  owner?: string;
  objectId?: string;
  label: string;
  /** simulated time after which the source disappears (scraps, fungi) */
  expires?: number;
  /** set when another squirrel dug up this cache */
  pilferedBy?: string;
}

export interface WaterSource {
  id: string;
  kind: "lake" | "pond" | "stream" | "puddle";
  name: string;
  position: Vector3;
  radius: number;
  amount: number;
}

export type ThreatKind = "dog" | "hawk";
export type ThreatState = "rest" | "patrol" | "stalk" | "chase" | "circle" | "dive" | "retreat" | "absent";

export interface Threat {
  id: string;
  kind: ThreatKind;
  position: Vector3;
  heading: number;
  speed: number;
  state: ThreatState;
  stateTimer: number;
  territoryCenter: Vector3;
  territoryRadius: number;
  target: Vector3;
  stamina: number;
  cooldown: number;
  /** visible in world */
  active: boolean;
  gait: number;
  /** dog: index along its walking route */
  routeIndex?: number;
  route?: Vector3[];
}

export interface Landmark {
  id: string;
  name: string;
  kind: "tree" | "rock" | "water" | "log" | "clearing" | "den" | "mushrooms" | "stump" | "building" | "bridge";
  position: Vector3;
  radius: number;
  objectId?: string;
  real?: boolean;
}

export interface EnvironmentState {
  utc: number;
  tempC: number;
  precipMm: number;
  snowDepthM: number;
  windKmh: number;
  gustKmh: number;
  cloud: number;
  humidity: number;
  sunElevation: number;
  sunAzimuth: number;
  moonElevation: number;
  moonAzimuth: number;
  moonIllumination: number;
  daylight: number;
  leaf: number;
  leafColour: number;
  visitors: number;
}

export interface WorldState {
  seed: number;
  /** simulated seconds since experiment start */
  time: number;
  weather: Weather;
  weatherTimer: number;
  rainAmount: number;
  fogAmount: number;
  snowAmount: number;
  env: EnvironmentState;
  objects: WorldObject[];
  foodSources: FoodSource[];
  waterSources: WaterSource[];
  threats: Threat[];
  landmarks: Landmark[];
  home: Vector3;
  paths: Vector3[][];
  /** increments whenever food/water visuals need refresh */
  foodVersion: number;
  /** increments when static structure changes (a tree falls) */
  structureVersion: number;
  floodRise: number;
}

export type ActionType =
  | "SEARCH_FOR_FOOD"
  | "EAT"
  | "EXPLORE"
  | "RETURN_TO_MEMORY"
  | "INVESTIGATE"
  | "REST"
  | "FLEE"
  | "HIDE"
  | "DRINK"
  | "OBSERVE"
  | "STORE_FOOD"
  | "PERCH"
  | "CHASE";

export const ACTIONS: ActionType[] = [
  "SEARCH_FOR_FOOD",
  "EAT",
  "EXPLORE",
  "RETURN_TO_MEMORY",
  "INVESTIGATE",
  "REST",
  "FLEE",
  "HIDE",
  "DRINK",
  "OBSERVE",
  "STORE_FOOD",
  "PERCH",
  "CHASE",
];

export type GoalPurpose = "food" | "water" | "safety" | "cache" | "novelty" | "rest" | "social" | "none";

export interface Goal {
  id: number;
  type: ActionType;
  purpose: GoalPurpose;
  target: Vector3 | null;
  targetId?: string;
  memoryId?: string;
  threatId?: string;
  startedAt: number;
  timeout: number;
  phase: string;
  phaseTimer: number;
  stateKey: string;
  score: number;
  rewardAccum: number;
  startPos: Vector3;
  pathLength: number;
  /** true when heading to a destination (counts toward navigation stats) */
  directed: boolean;
  label: string;
  carrying?: boolean;
}

export type MemoryType = "food" | "danger" | "landmark" | "navigation" | "social" | "environment";

export interface Memory {
  id: string;
  type: MemoryType;
  location: Vector3;
  importance: number;
  confidence: number;
  timestamp: number;
  emotionalValue: number;
  recallCount: number;
  /** subject-facing label, e.g. "ACORNS · OAK" */
  label: string;
  sourceId?: string;
  /** learned probability the resource will be present */
  expectation: number;
  lastVisited: number;
  successCount: number;
  failCount: number;
  subtype?: string;
}

export interface Preference {
  id: string;
  label: string;
  kind: "food" | "location" | "route" | "behavior";
  strength: number;
  detectedAt: number;
}

export interface LearnedLocation {
  id: string;
  name: string;
  position: Vector3;
  visits: number;
  foodValue: number;
  dangerValue: number;
  lastVisit: number;
  landmarkId?: string;
}

export interface BehaviorStats {
  distanceTravelled: number;
  foodEaten: number;
  foodDiscovered: number;
  waterDrinks: number;
  threatEncounters: number;
  contacts: number;
  escapes: number;
  memoryRecalls: number;
  recallSuccesses: number;
  cachesMade: number;
  cachesRetrieved: number;
  cachesPilfered: number;
  pilfersByRivals: number;
  chases: number;
  investigations: number;
  mistakes: number;
  decisions: number;
  alarmCalls: number;
  actionTime: Record<ActionType, number>;
  actionCount: Record<ActionType, number>;
  maxRadius: number;
}

export type Pose = "stand" | "walk" | "run" | "sit" | "eat" | "sleep" | "climb" | "dig" | "drink" | "alert" | "sniff";

export interface AnimationState {
  pose: Pose;
  gaitPhase: number;
  speed: number;
  heading: number;
  headYaw: number;
  headPitch: number;
  tailFlick: number;
  climbHeight: number;
  climbTreeId?: string;
  hidden: boolean;
  carrying: boolean;
  /** 0..1 alarm vocalisation intensity */
  calling: number;
}

export interface SquirrelState {
  position: Vector3;
  velocity: Vector3;

  hunger: number;
  thirst: number;
  energy: number;
  curiosity: number;
  fear: number;
  safety: number;
  health: number;
  warmth: number;

  confidence: number;

  currentGoal: Goal | null;

  memories: Memory[];
  preferences: Preference[];
  learnedLocations: LearnedLocation[];
  behaviorStats: BehaviorStats;

  anim: AnimationState;
  injuredTimer: number;
  /** accumulated path-integration error (believed − true position) */
  piError: { x: number; z: number };
  alive: boolean;
  generation: number;
  bornAt: number;
  fur: "Gray" | "Cinnamon" | "Black";
}

export interface Personality {
  boldness: number;
  curiosityBase: number;
  metabolism: number;
  retention: number;
  learningRate: number;
  temperature: number;
  vigilance: number;
  hoarding: number;
}

export type BrainNodeId = "VISION" | "MEMORY" | "FEAR" | "HUNGER" | "CURIOSITY" | "NAVIGATION" | "DECISION" | "MOTOR" | "REWARD";

export const BRAIN_NODES: BrainNodeId[] = ["VISION", "MEMORY", "FEAR", "HUNGER", "CURIOSITY", "NAVIGATION", "DECISION", "MOTOR", "REWARD"];

export interface RewardSignal {
  id: number;
  time: number;
  value: number;
  label: string;
}

export interface ThoughtEntry {
  id: number;
  time: number;
  text: string;
  level: "info" | "alert" | "memory" | "decision";
}

export type MilestoneId =
  | "FIRST_FOOD"
  | "FIRST_MEMORY"
  | "FIRST_RETURN_TO_MEMORY"
  | "FIRST_DANGER"
  | "FIRST_ESCAPE"
  | "FIRST_SUCCESSFUL_ROUTE"
  | "FIRST_PREFERENCE"
  | "FIRST_EXPLORATION_LOOP"
  | "FIRST_CACHE"
  | "FIRST_CACHE_RETRIEVAL"
  | "FIRST_MISTAKE"
  | "FIRST_NIGHT"
  | "FIRST_FORGETTING"
  | "AVOIDANCE_LEARNED"
  | "EXPLORATION_SHIFT"
  | "FOOD_AVERSION"
  | "MEMORY_RECALL"
  | "FIRST_REPLAY"
  | "FIRST_PILFER"
  | "CACHE_PROTECTION"
  | "FIRST_SNOW"
  | "FIRST_STORM"
  | "FIRST_CHASE"
  | "PLACE_MAP_FORMED"
  | "SUBJECT_DIED"
  | "NEW_GENERATION";

export interface LabEvent {
  id: number;
  time: number;
  text: string;
  category: "discovery" | "memory" | "danger" | "learning" | "behavior" | "environment" | "reward" | "neural" | "social";
  major: boolean;
  milestone?: MilestoneId;
  title?: string;
  detail?: string;
  metrics?: { label: string; value: string }[];
  memoryId?: string;
  location?: Vector3;
}

export interface LearningMetrics {
  foodEfficiency: number;
  navigationEfficiency: number;
  dangerAvoidance: number;
  memoryAccuracy: number;
}

export interface HistorySample {
  t: number;
  day: number;
  explorationRadius: number;
  foodEfficiency: number;
  navigationEfficiency: number;
  dangerAvoidance: number;
  memoryAccuracy: number;
  memoryStrength: number;
  decisionConfidence: number;
  restFraction: number;
  curiosity: number;
  hunger: number;
  fear: number;
  memoryCount: number;
  synapses: number;
  tempC: number;
  health: number;
  placeCells: number;
  realism: number;
}

export interface DaySummary {
  day: number;
  explorationRadius: number;
  foodEfficiency: number;
  navigationEfficiency: number;
  dangerAvoidance: number;
  memoryAccuracy: number;
  foodEaten: number;
  distance: number;
  restFraction: number;
}

export interface BehavioralProfile {
  exploration: number;
  risk: number;
  foodPriority: number;
  memory: number;
  vigilance: number;
  hoarding: number;
  summary: string[];
}

export interface JournalEntry {
  day: number;
  utc: number;
  date: string;
  title: string;
  weather: string;
  body: string[];
  stats: { label: string; value: string }[];
  generation: number;
}
