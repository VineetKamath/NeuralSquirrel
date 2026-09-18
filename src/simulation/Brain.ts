import { BRAIN_NODES, type BrainNodeId, type ThoughtEntry } from "@/types";
import { clamp } from "@/utils/math";

export interface BrainEdge {
  from: BrainNodeId;
  to: BrainNodeId;
  weight: number;
  /** recent signal flow, drives particle density */
  flow: number;
  /** total accumulated use */
  use: number;
}

export interface BrainSignals {
  vision: number;
  memory: number;
  fear: number;
  hunger: number;
  curiosity: number;
  navigation: number;
  decision: number;
  motor: number;
  reward: number;
}

const EDGE_LIST: [BrainNodeId, BrainNodeId][] = [
  ["VISION", "MEMORY"],
  ["VISION", "FEAR"],
  ["VISION", "CURIOSITY"],
  ["VISION", "HUNGER"],
  ["VISION", "NAVIGATION"],
  ["MEMORY", "NAVIGATION"],
  ["MEMORY", "DECISION"],
  ["MEMORY", "FEAR"],
  ["HUNGER", "DECISION"],
  ["FEAR", "DECISION"],
  ["CURIOSITY", "DECISION"],
  ["NAVIGATION", "MOTOR"],
  ["DECISION", "MOTOR"],
  ["DECISION", "NAVIGATION"],
  ["FEAR", "MOTOR"],
  ["REWARD", "MEMORY"],
  ["REWARD", "DECISION"],
  ["MOTOR", "REWARD"],
];

/**
 * SIMULATED COGNITIVE NETWORK.
 * Region activations are driven by the real simulation state. Connection weights
 * follow a reward-modulated Hebbian rule: co-active regions strengthen their link,
 * more so when outcomes carry reward, and unused links slowly weaken.
 * This is a visual/functional abstraction, not a neural reconstruction.
 */
export class Brain {
  activation: Record<BrainNodeId, number>;
  pulse: Record<BrainNodeId, number>;
  edges: BrainEdge[];
  thoughts: ThoughtEntry[] = [];
  development = 0;
  private counter = 0;
  private lastThought = new Map<string, number>();

  toJSON() {
    return { edges: this.edges, thoughts: this.thoughts.slice(-20), counter: this.counter, development: this.development };
  }

  load(o: ReturnType<Brain["toJSON"]>) {
    this.edges = o.edges;
    this.thoughts = o.thoughts;
    this.counter = o.counter;
    this.development = o.development;
  }

  constructor(initialWeight: () => number) {
    this.activation = Object.fromEntries(BRAIN_NODES.map((n) => [n, 0.05])) as Record<BrainNodeId, number>;
    this.pulse = Object.fromEntries(BRAIN_NODES.map((n) => [n, 0])) as Record<BrainNodeId, number>;
    this.edges = EDGE_LIST.map(([from, to]) => ({ from, to, weight: 0.06 + initialWeight() * 0.08, flow: 0, use: 0 }));
  }

  stimulate(node: BrainNodeId, amount: number) {
    this.pulse[node] = clamp(this.pulse[node] + amount, 0, 1.5);
  }

  /** chain activation along the canonical pathway */
  cascade(nodes: BrainNodeId[], amount: number) {
    nodes.forEach((n, i) => this.stimulate(n, amount * (1 - i * 0.08)));
  }

  update(dt: number, s: BrainSignals, rewardMagnitude: number) {
    const targets: Record<BrainNodeId, number> = {
      VISION: s.vision,
      MEMORY: s.memory,
      FEAR: s.fear,
      HUNGER: s.hunger,
      CURIOSITY: s.curiosity,
      NAVIGATION: s.navigation,
      DECISION: s.decision,
      MOTOR: s.motor,
      REWARD: s.reward,
    };
    for (const n of BRAIN_NODES) {
      this.pulse[n] *= Math.exp(-dt * 2.2);
      const target = clamp(targets[n] + this.pulse[n]);
      this.activation[n] += (target - this.activation[n]) * Math.min(1, dt * 4);
    }
    const modulation = 0.35 + rewardMagnitude * 2.5;
    let total = 0;
    for (const e of this.edges) {
      const a = this.activation[e.from];
      const b = this.activation[e.to];
      const co = a * b;
      e.flow += (a * e.weight * 1.6 - e.flow) * Math.min(1, dt * 3);
      e.use += co * dt;
      e.weight = clamp(e.weight + dt * (0.0045 * co * modulation - 0.00035 * (e.weight - 0.05)), 0.04, 1);
      total += e.weight;
    }
    this.development = clamp((total / this.edges.length - 0.08) / 0.6);
  }

  think(time: number, text: string, level: ThoughtEntry["level"] = "info", cooldown = 6) {
    const last = this.lastThought.get(text);
    if (last !== undefined && time - last < cooldown) return;
    this.lastThought.set(text, time);
    this.thoughts.push({ id: ++this.counter, time, text, level });
    if (this.thoughts.length > 60) this.thoughts.splice(0, this.thoughts.length - 60);
  }

  activeCount(threshold = 0.3) {
    return BRAIN_NODES.filter((n) => this.activation[n] > threshold).length;
  }

  /** a readable "synapse" count derived from connection strength */
  synapses(memoryCount: number, qStates: number) {
    let w = 0;
    for (const e of this.edges) w += e.weight;
    return Math.round(w * 420 + memoryCount * 36 + qStates * 18);
  }

  get lastThoughtId() {
    return this.counter;
  }
}
