import { ACTIONS, type ActionType, type BrainNodeId } from "@/types";
import { NEURAL } from "@/real/biology";
import { b64ToF32, f32ToB64 } from "@/utils/b64";
import type { RNG } from "@/utils/rng";

/**
 * Spiking neural network controlling part of the subject's behaviour.
 *
 *  - Izhikevich (2003) neurons: regular-spiking (cortical/hippocampal), fast-spiking,
 *    and a medium-spiny variant for the striatum.
 *  - Head-direction ring, grid-cell modules (scale ratio ≈ √2) and recruited place cells.
 *  - Actor–critic reinforcement learning with spiking neurons (Frémaux et al. 2013):
 *    a place-cell critic estimates value; its temporal-difference error drives VTA
 *    dopamine neurons and gates spike-timing-dependent plasticity (Izhikevich 2007)
 *    on synapses from sensory, interoceptive and place neurons onto striatal action channels.
 *  - Offline reverse replay of rewarded trajectories during sleep.
 */

export type PopulationId =
  | "VIS_FOOD"
  | "VIS_THREAT"
  | "VIS_WATER"
  | "VIS_SOCIAL"
  | "NOVELTY"
  | "CURIOSITY"
  | "HUNGER"
  | "THIRST"
  | "FATIGUE"
  | "COLD"
  | "AMYGDALA"
  | "HEAD_DIRECTION"
  | "GRID"
  | "VTA"
  | "STRIATUM"
  | "MOTOR"
  | "PLACE";

export interface Population {
  id: PopulationId;
  label: string;
  region: BrainNodeId;
  start: number;
  count: number;
  model: "RS" | "FS" | "MSN";
  presynaptic: boolean;
  description: string;
}

const LAYOUT: [PopulationId, number, BrainNodeId, Population["model"], boolean, string, string][] = [
  ["VIS_FOOD", 16, "VISION", "RS", true, "FOOD BEARING RING", "egocentric bearing of visible food"],
  ["VIS_THREAT", 16, "VISION", "RS", true, "THREAT BEARING RING", "egocentric bearing of a detected predator"],
  ["VIS_WATER", 8, "VISION", "RS", true, "WATER BEARING RING", "bearing of the nearest water edge"],
  ["VIS_SOCIAL", 8, "VISION", "RS", true, "CONSPECIFIC RING", "bearing of other squirrels"],
  ["NOVELTY", 12, "CURIOSITY", "RS", true, "NOVELTY DETECTORS", "novel objects in view"],
  ["CURIOSITY", 10, "CURIOSITY", "RS", true, "EXPLORATORY DRIVE", "curiosity drive"],
  ["HUNGER", 12, "HUNGER", "RS", true, "ARCUATE · HUNGER", "hypothalamic energy-deficit signal"],
  ["THIRST", 8, "HUNGER", "RS", true, "SUBFORNICAL · THIRST", "osmotic thirst signal"],
  ["FATIGUE", 8, "HUNGER", "RS", true, "SLEEP PRESSURE", "homeostatic fatigue"],
  ["COLD", 6, "HUNGER", "RS", true, "THERMOSENSORY", "cold exposure from real air temperature"],
  ["AMYGDALA", 24, "FEAR", "RS", true, "BASOLATERAL AMYGDALA", "threat and learned danger"],
  ["HEAD_DIRECTION", 24, "NAVIGATION", "RS", false, "HEAD-DIRECTION CELLS", "ring attractor tuned to heading"],
  ["GRID", 48, "NAVIGATION", "RS", false, "ENTORHINAL GRID CELLS", "three modules, spacing ratio ≈ 1.42"],
  ["VTA", 16, "REWARD", "FS", false, "VTA DOPAMINE", "reward prediction error"],
  ["STRIATUM", ACTIONS.length * 10, "DECISION", "MSN", false, "STRIATAL ACTION CHANNELS", "10 medium spiny neurons per action"],
  ["MOTOR", 20, "MOTOR", "RS", false, "MOTOR CORTEX", "movement vigour"],
  ["PLACE", 480, "MEMORY", "RS", true, "HIPPOCAMPAL PLACE CELLS", "recruited as new locations are visited"],
];

export interface NeuralInputs {
  believed: { x: number; z: number };
  heading: number;
  foodBearing: number | null;
  foodSalience: number;
  threatBearing: number | null;
  threatLevel: number;
  waterBearing: number | null;
  waterSalience: number;
  rivalBearing: number | null;
  rivalSalience: number;
  novelty: number;
  curiosity: number;
  hunger: number;
  thirst: number;
  fatigue: number;
  cold: number;
  fear: number;
  dangerHere: number;
  motor: number;
  executing: ActionType | null;
  sleeping: boolean;
}

export interface ReplayStep {
  place: number;
  action: number;
  reward: number;
  x: number;
  z: number;
}

export interface ReplayEvent {
  time: number;
  length: number;
  meanDelta: number;
  path: { x: number; z: number }[];
  reward: number;
}

const PLACE_SIGMA = 5;
const MAX_PLACE = 480;
const GRID_SPACING = [14, 14 * NEURAL.gridScaleRatio.value, 14 * NEURAL.gridScaleRatio.value ** 2];
const RASTER_CAP = 16000;

export class NeuralBrain {
  readonly pops: Population[] = [];
  readonly popById = {} as Record<PopulationId, Population>;
  readonly N: number;
  readonly v: Float32Array;
  readonly u: Float32Array;
  readonly a: Float32Array;
  readonly b: Float32Array;
  readonly c: Float32Array;
  readonly d: Float32Array;
  readonly jitter: Float32Array;
  readonly rate: Float32Array;
  private Iext: Float32Array;
  private spikedStep: Int32Array;

  /** presynaptic index for each neuron, or −1 */
  readonly preIndex: Int32Array;
  readonly preNeuron: Int32Array;
  readonly NPRE: number;
  readonly A = ACTIONS.length;
  /** plastic synapses onto striatal channels [pre × action] and their innate baseline */
  W: Float32Array;
  W0: Float32Array;
  private E: Float32Array;
  private preTrace: Float32Array;
  private postTrace: Float32Array;
  private S: Float32Array;

  /** place cells */
  placeX: Float32Array;
  placeZ: Float32Array;
  placeCount = 0;
  placeBorn: Float32Array;
  Wv: Float32Array;
  private placeElig: Float32Array;
  private placeGrid = new Map<number, number[]>();

  gridPhase: Float32Array;
  gridAngle: number[];

  // dynamics & learning state
  clockMs = 0;
  private vPrev = 0;
  delta = 0;
  dopamine = 0;
  valueNow = 0;
  windowSpikes = 0;
  totalSpikes = 0;
  learningEvents = 0;
  lastVotes = new Float32Array(ACTIONS.length);
  /** leaky evidence accumulation of channel votes (basal-ganglia style integration, tau ≈ 6 windows) */
  accVotes = new Float32Array(ACTIONS.length);
  lastCounts = new Float32Array(ACTIONS.length);
  popRate: Record<PopulationId, number>;
  regionRate: Record<BrainNodeId, number>;
  alphaCritic = 0.02;
  etaActor = 0.012;

  // visualisation buffers
  rasterId: Int32Array;
  rasterT: Float32Array;
  rasterHead = 0;
  rasterCount = 0;
  probeId = -1;
  probeTrace: Float32Array = new Float32Array(240);
  probeHead = 0;
  replays: ReplayEvent[] = [];
  lastReplay: ReplayEvent | null = null;
  neurogenesis = 0;

  private rngState: number;

  constructor(rng: RNG, genome?: Float32Array) {
    let idx = 0;
    for (const [id, count, region, model, presyn, label, description] of LAYOUT) {
      const p: Population = { id, label, region, start: idx, count, model, presynaptic: presyn, description };
      this.pops.push(p);
      this.popById[id] = p;
      idx += count;
    }
    this.N = idx;
    this.v = new Float32Array(this.N).fill(-65);
    this.u = new Float32Array(this.N);
    this.a = new Float32Array(this.N);
    this.b = new Float32Array(this.N);
    this.c = new Float32Array(this.N);
    this.d = new Float32Array(this.N);
    this.jitter = new Float32Array(this.N);
    this.rate = new Float32Array(this.N);
    this.Iext = new Float32Array(this.N);
    this.spikedStep = new Int32Array(this.N).fill(-1000);
    for (const p of this.pops) {
      const prm = p.model === "FS" ? NEURAL.izhikevichFS : p.model === "MSN" ? NEURAL.izhikevichMSN : NEURAL.izhikevichRS;
      for (let i = p.start; i < p.start + p.count; i++) {
        this.a[i] = prm.a;
        this.b[i] = prm.b;
        this.c[i] = prm.c + (rng() - 0.5) * 4;
        this.d[i] = prm.d;
        this.u[i] = prm.b * -65;
        this.jitter[i] = 0.8 + rng() * 0.4;
      }
    }
    this.preIndex = new Int32Array(this.N).fill(-1);
    const pre: number[] = [];
    for (const p of this.pops) {
      if (!p.presynaptic) continue;
      for (let i = p.start; i < p.start + p.count; i++) {
        this.preIndex[i] = pre.length;
        pre.push(i);
      }
    }
    this.preNeuron = Int32Array.from(pre);
    this.NPRE = pre.length;
    this.W = new Float32Array(this.NPRE * this.A);
    this.W0 = new Float32Array(this.NPRE * this.A);
    this.E = new Float32Array(this.NPRE * this.A);
    this.preTrace = new Float32Array(this.NPRE);
    this.postTrace = new Float32Array(this.A);
    this.S = new Float32Array(this.A);
    this.placeX = new Float32Array(MAX_PLACE);
    this.placeZ = new Float32Array(MAX_PLACE);
    this.placeBorn = new Float32Array(MAX_PLACE);
    this.Wv = new Float32Array(MAX_PLACE);
    this.placeElig = new Float32Array(MAX_PLACE);
    this.gridPhase = new Float32Array(48 * 2);
    for (let i = 0; i < 48; i++) {
      this.gridPhase[i * 2] = rng();
      this.gridPhase[i * 2 + 1] = rng();
    }
    this.gridAngle = [rng() * Math.PI, rng() * Math.PI, rng() * Math.PI];
    this.rasterId = new Int32Array(RASTER_CAP);
    this.rasterT = new Float32Array(RASTER_CAP);
    this.rngState = Math.floor(rng() * 2 ** 31) || 1;
    this.popRate = Object.fromEntries(this.pops.map((p) => [p.id, 0])) as Record<PopulationId, number>;
    this.regionRate = { VISION: 0, MEMORY: 0, FEAR: 0, HUNGER: 0, CURIOSITY: 0, NAVIGATION: 0, DECISION: 0, MOTOR: 0, REWARD: 0 };
    this.buildInnateWeights(genome, rng);
  }

  /** innate (inherited) synaptic biases: instincts expressed as connectivity */
  private buildInnateWeights(genome: Float32Array | undefined, rng: RNG) {
    const act = (a: ActionType) => ACTIONS.indexOf(a);
    const rows: [PopulationId, [ActionType, number][]][] = [
      ["VIS_FOOD", [["SEARCH_FOR_FOOD", 0.8], ["EAT", 0.9], ["STORE_FOOD", 0.3]]],
      ["VIS_THREAT", [["FLEE", 1.2], ["HIDE", 1.1], ["OBSERVE", 0.3], ["PERCH", 0.4]]],
      ["VIS_WATER", [["DRINK", 0.6]]],
      ["VIS_SOCIAL", [["CHASE", 0.6], ["OBSERVE", 0.2]]],
      ["NOVELTY", [["INVESTIGATE", 0.9], ["EXPLORE", 0.4]]],
      ["CURIOSITY", [["EXPLORE", 0.9], ["INVESTIGATE", 0.3]]],
      ["HUNGER", [["SEARCH_FOR_FOOD", 1.0], ["RETURN_TO_MEMORY", 0.8], ["EAT", 0.8]]],
      ["THIRST", [["DRINK", 1.0], ["RETURN_TO_MEMORY", 0.3]]],
      ["FATIGUE", [["REST", 1.2]]],
      ["COLD", [["REST", 0.8]]],
      ["AMYGDALA", [["FLEE", 0.6], ["HIDE", 0.8], ["PERCH", 0.5], ["OBSERVE", 0.6]]],
    ];
    rows.forEach(([pid, entries], g) => {
      const scale = genome ? genome[g] : 1;
      const p = this.popById[pid];
      for (let i = p.start; i < p.start + p.count; i++) {
        const r = this.preIndex[i];
        for (const [a, w] of entries) this.W0[r * this.A + act(a)] = w * scale * (0.85 + rng() * 0.3);
      }
    });
    this.W.set(this.W0);
  }

  static genomeSize = 11;

  // ─────────────────────────── helpers ───────────────────────────

  private noise() {
    // xorshift32 → approx. normal via sum of uniforms
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0 || 1;
    const u1 = (this.rngState & 0xffff) / 65536;
    const u2 = ((this.rngState >>> 16) & 0xffff) / 65536;
    return (u1 + u2 - 1) * 2.4;
  }

  private ring(p: Population, bearing: number | null, salience: number, gain: number, kappa = 2.5) {
    for (let j = 0; j < p.count; j++) {
      const i = p.start + j;
      if (bearing === null) {
        this.Iext[i] = 0;
        continue;
      }
      const pref = (j / p.count) * Math.PI * 2 - Math.PI;
      this.Iext[i] = gain * salience * Math.exp(kappa * (Math.cos(bearing - pref) - 1)) * this.jitter[i];
    }
  }

  private uniform(p: Population, value: number) {
    for (let i = p.start; i < p.start + p.count; i++) this.Iext[i] = value * this.jitter[i];
  }

  placeActivation(i: number, x: number, z: number) {
    const dx = this.placeX[i] - x;
    const dz = this.placeZ[i] - z;
    return Math.exp(-(dx * dx + dz * dz) / (2 * PLACE_SIGMA * PLACE_SIGMA));
  }

  private nearbyPlaces(x: number, z: number) {
    const out: number[] = [];
    const gx = Math.floor(x / 10);
    const gz = Math.floor(z / 10);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const list = this.placeGrid.get((gx + dx) * 1000 + gz + dz);
        if (list) for (const i of list) out.push(i);
      }
    }
    return out;
  }

  /** critic value estimate at a location (used by the decision system) */
  placeValue(x: number, z: number) {
    let v = 0;
    for (const i of this.nearbyPlaces(x, z)) v += this.Wv[i] * this.placeActivation(i, x, z);
    return v;
  }

  gridRate(cell: number, x: number, z: number) {
    const module = Math.floor(cell / 16);
    const lambda = GRID_SPACING[module];
    const k = (4 * Math.PI) / (Math.sqrt(3) * lambda);
    const px = x - this.gridPhase[cell * 2] * lambda;
    const pz = z - this.gridPhase[cell * 2 + 1] * lambda;
    let s = 0;
    for (let m = 0; m < 3; m++) {
      const ang = this.gridAngle[module] + (m * Math.PI) / 3;
      s += Math.cos(k * (Math.cos(ang) * px + Math.sin(ang) * pz));
    }
    return Math.max(0, (s + 1.5) / 4.5);
  }

  private recruitPlace(x: number, z: number, time: number) {
    if (this.placeCount >= MAX_PLACE) return -1;
    const i = this.placeCount++;
    this.placeX[i] = x;
    this.placeZ[i] = z;
    this.placeBorn[i] = time;
    this.Wv[i] = 0;
    const key = Math.floor(x / 10) * 1000 + Math.floor(z / 10);
    if (!this.placeGrid.has(key)) this.placeGrid.set(key, []);
    this.placeGrid.get(key)!.push(i);
    this.neurogenesis++;
    return i;
  }

  /** index of the most active place cell at a location (recruiting one if needed) */
  placeAt(x: number, z: number, time: number) {
    let best = -1;
    let bestAct = 0;
    for (const i of this.nearbyPlaces(x, z)) {
      const act = this.placeActivation(i, x, z);
      if (act > bestAct) {
        bestAct = act;
        best = i;
      }
    }
    if (bestAct < Math.exp(-(6 * 6) / (2 * PLACE_SIGMA * PLACE_SIGMA))) {
      const r = this.recruitPlace(x, z, time);
      if (r >= 0) return r;
    }
    return best;
  }

  /** Izhikevich (2003) membrane update, two 0.5 ms half-steps */
  private integrate(i: number, I: number) {
    let v = this.v[i];
    let u = this.u[i];
    v += 0.5 * (0.04 * v * v + 5 * v + 140 - u + I);
    v += 0.5 * (0.04 * v * v + 5 * v + 140 - u + I);
    u += this.a[i] * (this.b[i] * v - u);
    if (v >= 30) {
      this.v[i] = this.c[i];
      this.u[i] = u + this.d[i];
      return true;
    }
    this.v[i] = v;
    this.u[i] = u;
    return false;
  }

  private onSpike(i: number, step: number, stepBase: number, recentPre: number[], Aminus: number) {
    this.record(i);
    const pr = this.preIndex[i];
    if (pr >= 0) {
      this.preTrace[pr] += 1;
      if (this.spikedStep[i] < stepBase) recentPre.push(pr);
      const row = pr * this.A;
      for (let ch = 0; ch < this.A; ch++) {
        this.S[ch] += this.W[row + ch] * 1.4;
        this.E[row + ch] -= Aminus * this.postTrace[ch];
      }
    }
    this.spikedStep[i] = step;
  }

  private record(id: number) {
    this.rasterId[this.rasterHead] = id;
    this.rasterT[this.rasterHead] = this.clockMs;
    this.rasterHead = (this.rasterHead + 1) % RASTER_CAP;
    this.rasterCount = Math.min(RASTER_CAP, this.rasterCount + 1);
  }

  // ─────────────────────────── simulation ───────────────────────────

  /**
   * Integrate the network for one cognitive window.
   * @param windowMs integration length (1 ms steps)
   * @param gapMs    simulated time since the previous window (for trace decay)
   * @param reward   reward received since the previous window
   */
  runWindow(inp: NeuralInputs, windowMs: number, gapMs: number, reward: number, simTime: number) {
    const P = this.popById;
    const { x, z } = inp.believed;

    // ── critic: temporal-difference error at the window boundary
    const place = this.placeAt(x, z, simTime);
    const active = this.nearbyPlaces(x, z);
    let V = 0;
    for (const i of active) V += this.Wv[i] * this.placeActivation(i, x, z);
    const gamma = Math.pow(0.95, gapMs / 1000);
    this.delta = Math.max(-1.5, Math.min(1.5, reward + gamma * V - this.vPrev));
    this.valueNow = V;
    // critic update on eligible place cells
    const traceDecay = Math.exp(-gapMs / NEURAL.eligibilityTau.value);
    for (let i = 0; i < this.placeCount; i++) {
      if (this.placeElig[i] < 1e-3) continue;
      this.Wv[i] = Math.max(-2, Math.min(2, this.Wv[i] + this.alphaCritic * this.delta * this.placeElig[i]));
      this.placeElig[i] *= traceDecay;
    }
    for (const i of active) this.placeElig[i] = Math.min(1, this.placeElig[i] + this.placeActivation(i, x, z));
    this.vPrev = V;
    this.dopamine = this.dopamine * 0.6 + this.delta * 0.4;

    // ── actor: dopamine-gated plasticity on accumulated eligibility traces
    if (Math.abs(this.delta) > 0.01) {
      const lr = this.etaActor * this.delta;
      for (let k = 0; k < this.E.length; k++) {
        const e = this.E[k];
        if (e === 0) continue;
        const w = this.W[k] + lr * e;
        this.W[k] = w < -1.5 ? -1.5 : w > 2.5 ? 2.5 : w;
      }
      this.learningEvents++;
    }
    for (let k = 0; k < this.E.length; k++) this.E[k] *= traceDecay;

    // ── external drive for this window
    this.Iext.fill(0);
    this.ring(P.VIS_FOOD, inp.foodBearing, inp.foodSalience, 15);
    this.ring(P.VIS_THREAT, inp.threatBearing, inp.threatLevel, 16);
    this.ring(P.VIS_WATER, inp.waterBearing, inp.waterSalience, 12);
    this.ring(P.VIS_SOCIAL, inp.rivalBearing, inp.rivalSalience, 12);
    this.uniform(P.NOVELTY, 2 + inp.novelty * 12);
    this.uniform(P.CURIOSITY, inp.curiosity * 12);
    this.uniform(P.HUNGER, inp.hunger * 14);
    this.uniform(P.THIRST, inp.thirst * 14);
    this.uniform(P.FATIGUE, inp.fatigue * 13);
    this.uniform(P.COLD, inp.cold * 13);
    this.uniform(P.AMYGDALA, Math.max(inp.fear, inp.threatLevel) * 13 + inp.dangerHere * 8);
    const hdKappa = 1 / ((NEURAL.hdTuningWidth.value * Math.PI) / 180) ** 2;
    this.ring(P.HEAD_DIRECTION, inp.heading, 1, 14, hdKappa);
    for (let j = 0; j < P.GRID.count; j++) this.Iext[P.GRID.start + j] = 14 * this.gridRate(j, x, z);
    const da = this.delta;
    this.uniform(P.VTA, 4.5 + 22 * Math.max(0, da) - 8 * Math.max(0, -da));
    this.uniform(P.MOTOR, 3 + inp.motor * 11);
    const exec = inp.executing ? ACTIONS.indexOf(inp.executing) : -1;

    // place cells: only simulate those near the believed location
    const placeActive: number[] = [];
    const placeDrive: number[] = [];
    for (const i of active) {
      const act = this.placeActivation(i, x, z);
      if (act < 0.02) continue;
      placeActive.push(P.PLACE.start + i);
      placeDrive.push(16 * act);
    }

    // neuron list for this window (dormant place cells are skipped)
    const nonPlaceEnd = P.PLACE.start;
    const striatumStart = P.STRIATUM.start;
    const perChannel = 10;
    const counts = this.lastCounts;
    counts.fill(0);
    const synDecay = Math.exp(-1 / 5);
    const traceDecay20 = Math.exp(-1 / NEURAL.stdpTau.value);
    const Aplus = NEURAL.stdpAPlus.value;
    const Aminus = NEURAL.stdpAMinus.value;
    const recentPre: number[] = [];
    const spikeCounts = new Float32Array(this.N);
    let spikes = 0;
    const stepBase = Math.round(this.clockMs);
    const lateral = new Float32Array(this.A);

    for (let t = 0; t < windowMs; t++) {
      this.clockMs += 1;
      const step = stepBase + t;
      const theta = 0.65 + 0.35 * Math.cos(2 * Math.PI * NEURAL.thetaHz.value * (this.clockMs / 1000));
      // lateral inhibition from recent channel activity
      for (let ch = 0; ch < this.A; ch++) lateral[ch] = this.postTrace[ch] * 4;
      let lateralSum = 0;
      for (let ch = 0; ch < this.A; ch++) lateralSum += lateral[ch];

      for (let i = 0; i < nonPlaceEnd; i++) {
        let I = this.Iext[i];
        if (i >= striatumStart && i < striatumStart + this.A * perChannel) {
          const ch = Math.floor((i - striatumStart) / perChannel);
          I = 2.2 + this.S[ch] + (ch === exec ? 3 : 0) - (lateralSum - lateral[ch]) * 0.35;
        } else if (i >= P.GRID.start && i < P.GRID.start + P.GRID.count) {
          I *= theta;
        }
        I += this.noise();
        if (this.integrate(i, I)) {
          spikes++;
          spikeCounts[i]++;
          this.onSpike(i, step, stepBase, recentPre, Aminus);
          if (i >= striatumStart && i < striatumStart + this.A * perChannel) {
            const ch = Math.floor((i - striatumStart) / perChannel);
            counts[ch]++;
            this.postTrace[ch] += 0.1;
            for (const pr of recentPre) this.E[pr * this.A + ch] += Aplus * this.preTrace[pr];
          }
        }
      }
      for (let k = 0; k < placeActive.length; k++) {
        const i = placeActive[k];
        if (this.integrate(i, placeDrive[k] * theta + this.noise())) {
          spikes++;
          spikeCounts[i]++;
          this.onSpike(i, step, stepBase, recentPre, Aminus);
        }
      }
      for (let ch = 0; ch < this.A; ch++) {
        this.S[ch] *= synDecay;
        this.postTrace[ch] *= traceDecay20;
      }
      for (const pr of recentPre) this.preTrace[pr] *= traceDecay20;

      if (this.probeId >= 0) {
        this.probeTrace[this.probeHead] = this.v[this.probeId];
        this.probeHead = (this.probeHead + 1) % this.probeTrace.length;
      }
    }
    for (const pr of recentPre) this.preTrace[pr] = 0;

    // firing-rate estimates (Hz)
    const k = 1000 / windowMs;
    for (let i = 0; i < this.N; i++) this.rate[i] += (spikeCounts[i] * k - this.rate[i]) * 0.3;
    for (const p of this.pops) {
      let s = 0;
      let n = 0;
      for (let i = p.start; i < p.start + p.count; i++) {
        if (p.id === "PLACE" && i - p.start >= this.placeCount) break;
        s += this.rate[i];
        n++;
      }
      this.popRate[p.id] = n ? s / n : 0;
    }
    const r = this.popRate;
    const norm = (hz: number) => Math.min(1, hz / 40);
    this.regionRate.VISION = norm((r.VIS_FOOD + r.VIS_THREAT + r.VIS_WATER + r.VIS_SOCIAL) * 1.5);
    this.regionRate.CURIOSITY = norm(r.NOVELTY + r.CURIOSITY);
    this.regionRate.HUNGER = norm(Math.max(r.HUNGER, r.THIRST, r.COLD) + r.FATIGUE * 0.3);
    this.regionRate.FEAR = norm(r.AMYGDALA * 1.2);
    this.regionRate.NAVIGATION = norm((r.HEAD_DIRECTION + r.GRID) * 0.9);
    this.regionRate.MEMORY = norm(placeActive.length ? (placeActive.reduce((s2, i) => s2 + this.rate[i], 0) / placeActive.length) * 0.8 : 0);
    this.regionRate.DECISION = norm(r.STRIATUM * 2.2);
    this.regionRate.MOTOR = norm(r.MOTOR);
    this.regionRate.REWARD = norm(r.VTA * 1.3);

    const mean = counts.reduce((s2, c2) => s2 + c2, 0) / this.A;
    const max = Math.max(...counts);
    for (let ch = 0; ch < this.A; ch++) {
      this.lastVotes[ch] = (counts[ch] - mean) / (max - mean + 1);
      this.accVotes[ch] += (this.lastVotes[ch] - this.accVotes[ch]) * 0.16;
    }
    this.windowSpikes = spikes;
    this.totalSpikes += spikes;
    return { place, spikes };
  }

  vote(action: ActionType) {
    return this.accVotes[ACTIONS.indexOf(action)];
  }

  // ─────────────────────────── sleep replay ───────────────────────────

  /** reverse replay of a rewarded trajectory, compressed in time */
  replay(seq: ReplayStep[], simTime: number) {
    if (seq.length < 3) return null;
    const P = this.popById;
    let sumDelta = 0;
    let totalReward = 0;
    const compression = NEURAL.replayCompression.value;
    for (let k = seq.length - 1; k >= 0; k--) {
      const s = seq[k];
      if (s.place < 0 || s.place >= this.placeCount) continue;
      const next = seq[k + 1];
      const vNext = next && next.place >= 0 ? this.Wv[next.place] : 0;
      const delta = s.reward + 0.9 * vNext - this.Wv[s.place];
      this.Wv[s.place] = Math.max(-2, Math.min(2, this.Wv[s.place] + 0.08 * delta));
      if (s.action >= 0) {
        const row = this.preIndex[P.PLACE.start + s.place] * this.A;
        const w = this.W[row + s.action] + 0.05 * delta;
        this.W[row + s.action] = Math.max(-1.5, Math.min(2.5, w));
      }
      sumDelta += delta;
      totalReward += s.reward;
      // sharp-wave ripple: the place cell and its neighbours fire in a compressed burst
      this.clockMs += 300 / compression;
      this.record(P.PLACE.start + s.place);
      this.rate[P.PLACE.start + s.place] = Math.max(this.rate[P.PLACE.start + s.place], 60);
    }
    const ev: ReplayEvent = {
      time: simTime,
      length: seq.length,
      meanDelta: sumDelta / seq.length,
      path: seq.map((s) => ({ x: s.x, z: s.z })),
      reward: totalReward,
    };
    this.replays.push(ev);
    if (this.replays.length > 60) this.replays.shift();
    this.lastReplay = ev;
    this.regionRate.MEMORY = 1;
    return ev;
  }

  // ─────────────────────────── introspection ───────────────────────────

  populationOf(id: number) {
    for (const p of this.pops) if (id >= p.start && id < p.start + p.count) return p;
    return this.pops[0];
  }

  describeNeuron(id: number) {
    const p = this.populationOf(id);
    const j = id - p.start;
    let tuning = p.description;
    let place: { x: number; z: number } | null = null;
    if (p.id.startsWith("VIS_") || p.id === "HEAD_DIRECTION") {
      const deg = Math.round(((j / p.count) * 360 - 180 + 360) % 360);
      tuning = p.id === "HEAD_DIRECTION" ? `preferred heading ${deg}°` : `preferred bearing ${deg - 180 > 0 ? "+" : ""}${deg - 180}° from heading`;
    } else if (p.id === "GRID") {
      const m = Math.floor(j / 16);
      tuning = `module ${m + 1} · spacing ${GRID_SPACING[m].toFixed(1)} m`;
    } else if (p.id === "STRIATUM") {
      tuning = `action channel ${ACTIONS[Math.floor(j / 10)]}`;
    } else if (p.id === "PLACE") {
      if (j < this.placeCount) {
        place = { x: this.placeX[j], z: this.placeZ[j] };
        tuning = `place field (${place.x.toFixed(0)}, ${place.z.toFixed(0)}) σ ${PLACE_SIGMA} m · value ${this.Wv[j].toFixed(2)}`;
      } else tuning = "dormant (not yet recruited)";
    }
    const prm = p.model === "FS" ? NEURAL.izhikevichFS : p.model === "MSN" ? NEURAL.izhikevichMSN : NEURAL.izhikevichRS;
    const out: { action: ActionType; weight: number }[] = [];
    const pr = this.preIndex[id];
    if (pr >= 0) {
      for (let ch = 0; ch < this.A; ch++) out.push({ action: ACTIONS[ch], weight: this.W[pr * this.A + ch] });
      out.sort((q, w) => Math.abs(w.weight) - Math.abs(q.weight));
    }
    const inputs: { neuron: number; label: string; weight: number }[] = [];
    if (p.id === "STRIATUM") {
      const ch = Math.floor(j / 10);
      const list: { neuron: number; label: string; weight: number }[] = [];
      for (let r = 0; r < this.NPRE; r++) {
        const n = this.preNeuron[r];
        const pp = this.populationOf(n);
        if (pp.id === "PLACE" && n - pp.start >= this.placeCount) continue;
        list.push({ neuron: n, label: `${pp.label} #${n - pp.start}`, weight: this.W[r * this.A + ch] });
      }
      list.sort((q, w) => Math.abs(w.weight) - Math.abs(q.weight));
      inputs.push(...list.slice(0, 6));
    }
    return {
      id,
      population: p,
      index: j,
      model: p.model,
      params: prm,
      rate: this.rate[id],
      membrane: this.v[id],
      tuning,
      place,
      outputs: out.slice(0, 5),
      inputs,
    };
  }

  // ─────────────────────────── persistence ───────────────────────────

  toJSON() {
    return {
      W: f32ToB64(this.W),
      W0: f32ToB64(this.W0),
      Wv: f32ToB64(this.Wv),
      placeX: f32ToB64(this.placeX),
      placeZ: f32ToB64(this.placeZ),
      placeBorn: f32ToB64(this.placeBorn),
      placeCount: this.placeCount,
      gridPhase: f32ToB64(this.gridPhase),
      gridAngle: this.gridAngle,
      clockMs: this.clockMs,
      totalSpikes: this.totalSpikes,
      learningEvents: this.learningEvents,
      neurogenesis: this.neurogenesis,
      replays: this.replays.slice(-20),
      vPrev: this.vPrev,
      // live dynamics (exact continuation for spectators mirroring the live server)
      dyn: {
        v: f32ToB64(this.v),
        u: f32ToB64(this.u),
        rate: f32ToB64(this.rate),
        Iext: f32ToB64(this.Iext),
        spiked: f32ToB64(Float32Array.from(this.spikedStep)),
        E: f32ToB64(this.E),
        pre: f32ToB64(this.preTrace),
        post: f32ToB64(this.postTrace),
        S: f32ToB64(this.S),
        pe: f32ToB64(this.placeElig),
        acc: f32ToB64(this.accVotes),
        last: f32ToB64(this.lastVotes),
        counts: f32ToB64(this.lastCounts),
        rng: this.rngState,
        delta: this.delta,
        dopamine: this.dopamine,
        valueNow: this.valueNow,
        windowSpikes: this.windowSpikes,
        a: f32ToB64(this.a),
        b: f32ToB64(this.b),
        c: f32ToB64(this.c),
        d: f32ToB64(this.d),
        jitter: f32ToB64(this.jitter),
        popRate: this.popRate,
        regionRate: this.regionRate,
      },
    };
  }

  load(o: ReturnType<NeuralBrain["toJSON"]>) {
    this.W.set(b64ToF32(o.W));
    this.W0.set(b64ToF32(o.W0));
    this.Wv.set(b64ToF32(o.Wv));
    this.placeX.set(b64ToF32(o.placeX));
    this.placeZ.set(b64ToF32(o.placeZ));
    this.placeBorn.set(b64ToF32(o.placeBorn));
    this.placeCount = o.placeCount;
    this.gridPhase.set(b64ToF32(o.gridPhase));
    this.gridAngle = o.gridAngle;
    this.clockMs = o.clockMs;
    this.totalSpikes = o.totalSpikes;
    this.learningEvents = o.learningEvents;
    this.neurogenesis = o.neurogenesis;
    this.replays = o.replays ?? [];
    this.lastReplay = this.replays[this.replays.length - 1] ?? null;
    this.vPrev = o.vPrev ?? 0;
    const d = o.dyn;
    if (d) {
      this.v.set(b64ToF32(d.v));
      this.u.set(b64ToF32(d.u));
      this.rate.set(b64ToF32(d.rate));
      this.Iext.set(b64ToF32(d.Iext));
      this.spikedStep.set(Int32Array.from(b64ToF32(d.spiked)));
      this.E.set(b64ToF32(d.E));
      this.preTrace.set(b64ToF32(d.pre));
      this.postTrace.set(b64ToF32(d.post));
      this.S.set(b64ToF32(d.S));
      this.placeElig.set(b64ToF32(d.pe));
      this.accVotes.set(b64ToF32(d.acc));
      this.lastVotes.set(b64ToF32(d.last));
      this.lastCounts.set(b64ToF32(d.counts));
      this.rngState = d.rng;
      this.delta = d.delta;
      this.dopamine = d.dopamine;
      this.valueNow = d.valueNow;
      this.windowSpikes = d.windowSpikes;
      if (d.a) {
        this.a.set(b64ToF32(d.a));
        this.b.set(b64ToF32(d.b));
        this.c.set(b64ToF32(d.c));
        this.d.set(b64ToF32(d.d));
        this.jitter.set(b64ToF32(d.jitter));
        Object.assign(this.popRate, d.popRate);
        Object.assign(this.regionRate, d.regionRate);
      }
    }
    this.placeGrid.clear();
    for (let i = 0; i < this.placeCount; i++) {
      const key = Math.floor(this.placeX[i] / 10) * 1000 + Math.floor(this.placeZ[i] / 10);
      if (!this.placeGrid.has(key)) this.placeGrid.set(key, []);
      this.placeGrid.get(key)!.push(i);
    }
  }
}
