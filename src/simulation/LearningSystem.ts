import { ACTIONS, type ActionType, type LearningMetrics, type ObjectKind, type Personality } from "@/types";
import { clamp } from "@/utils/math";
import type { RNG } from "@/utils/rng";

export interface Transition {
  stateKey: string;
  action: ActionType;
  reward: number;
  nextStateKey: string;
}

/**
 * Lightweight reinforcement learning.
 *
 *   Q(s,a) ← Q(s,a) + α · (r + γ · max_a' Q(s',a') − Q(s,a))
 *
 * plus a set of slowly adapting "skills" (navigation precision, vigilance,
 * object→food associations, food preferences) that make adaptation visible.
 * The Q-table can be swapped for a learned model without touching the agent.
 */
export class LearningSystem {
  q = new Map<string, Float32Array>();
  alpha: number;
  gamma = 0.6;
  updates = 0;

  navSkill = 0.12;
  vigilance: number;
  confidence = 0.2;
  objectFood: Record<ObjectKind, number> = {
    oak: 0.3,
    pine: 0.3,
    birch: 0.3,
    bush: 0.3,
    rock: 0.3,
    log: 0.3,
    stump: 0.3,
    mushroom: 0.3,
    bench: 0.3,
    lamp: 0.02,
  };
  /** keyed by food label so the subject can discriminate between similar food */
  foodPreference: Record<string, number> = {};
  /** learned wariness of caching in front of other squirrels */
  audienceCaution = 0;

  toJSON() {
    return {
      q: Object.fromEntries(Array.from(this.q.entries()).map(([k, v]) => [k, Array.from(v)])),
      updates: this.updates,
      navSkill: this.navSkill,
      vigilance: this.vigilance,
      confidence: this.confidence,
      objectFood: this.objectFood,
      foodPreference: this.foodPreference,
      audienceCaution: this.audienceCaution,
      metrics: this.metrics,
      decisionConfidence: this.decisionConfidence,
    };
  }

  load(o: ReturnType<LearningSystem["toJSON"]>) {
    this.q = new Map(Object.entries(o.q).map(([k, v]) => {
      const row = new Float32Array(ACTIONS.length);
      row.set(v.slice(0, ACTIONS.length));
      return [k, row];
    }));
    this.updates = o.updates;
    this.navSkill = o.navSkill;
    this.vigilance = o.vigilance;
    this.confidence = o.confidence;
    this.objectFood = { ...this.objectFood, ...o.objectFood };
    this.foodPreference = o.foodPreference;
    this.audienceCaution = o.audienceCaution ?? 0;
    this.metrics = o.metrics;
    this.decisionConfidence = o.decisionConfidence;
  }

  metrics: LearningMetrics;
  decisionConfidence = 0.3;

  constructor(private personality: Personality, rng: RNG) {
    this.alpha = personality.learningRate;
    this.vigilance = personality.vigilance;
    this.metrics = {
      foodEfficiency: 0.12 + rng() * 0.12,
      navigationEfficiency: 0.08 + rng() * 0.1,
      dangerAvoidance: 0.25 + rng() * 0.15,
      memoryAccuracy: 0.1 + rng() * 0.1,
    };
  }

  static stateKey(hunger: number, energy: number, fear: number, knowsFood: boolean, threat: boolean) {
    const b = (v: number) => (v < 0.33 ? 0 : v < 0.66 ? 1 : 2);
    return `${b(hunger)}${b(energy)}${b(fear)}${knowsFood ? 1 : 0}${threat ? 1 : 0}`;
  }

  private row(key: string) {
    let r = this.q.get(key);
    if (!r) {
      r = new Float32Array(ACTIONS.length);
      this.q.set(key, r);
    }
    return r;
  }

  value(key: string, action: ActionType) {
    return this.row(key)[ACTIONS.indexOf(action)];
  }

  update(t: Transition) {
    const row = this.row(t.stateKey);
    const i = ACTIONS.indexOf(t.action);
    const next = this.row(t.nextStateKey);
    let maxNext = -Infinity;
    for (let k = 0; k < next.length; k++) maxNext = Math.max(maxNext, next[k]);
    const r = clamp(t.reward, -1.5, 1.5);
    const old = row[i];
    row[i] = old + this.alpha * (r + this.gamma * maxNext * 0.5 - old);
    this.updates++;
    // outcome-driven confidence
    this.confidence = clamp(this.confidence + 0.04 * ((r > 0 ? 1 : r < -0.05 ? 0 : 0.5) - this.confidence));
    return row[i] - old;
  }

  /** weight of learned values in decisions grows with experience */
  get qWeight() {
    return clamp(0.15 + this.updates / 400, 0.15, 0.6);
  }

  ema(key: keyof LearningMetrics, sample: number, rate = 0.12) {
    this.metrics[key] = clamp(this.metrics[key] + (clamp(sample) - this.metrics[key]) * rate);
  }

  navigationOutcome(success: boolean, straightness: number) {
    if (success) this.navSkill = clamp(this.navSkill + 0.06 * this.alpha * (0.4 + straightness), 0, 0.95);
    else this.navSkill = clamp(this.navSkill - 0.004, 0.05, 0.95);
  }

  foodAssociation(kind: ObjectKind, found: boolean) {
    const v = this.objectFood[kind];
    this.objectFood[kind] = clamp(v + this.alpha * ((found ? 1 : 0) - v) * (found ? 1 : 0.45), 0.02, 0.98);
  }

  foodOutcome(label: string, value: number) {
    const v = this.foodPreference[label] ?? 0;
    this.foodPreference[label] = clamp(v + this.alpha * 1.6 * (value - v), -1, 1);
  }

  preference(label: string) {
    return this.foodPreference[label] ?? 0;
  }

  threatOutcome(contact: boolean) {
    this.vigilance = clamp(this.vigilance + (contact ? 0.12 : 0.03), 0, 0.95);
  }

  decay(dtDays: number) {
    this.vigilance = clamp(this.vigilance - dtDays * 0.015 * (this.vigilance - this.personality.vigilance));
  }

  tableSize() {
    return this.q.size;
  }
}
