import type { RewardSignal } from "@/types";

/** Internal reward signals. Positive and negative reinforcement feed learning and the REWARD node. */
export class RewardSystem {
  log: RewardSignal[] = [];
  private counter = 0;
  total = 0;
  recent = 0;
  /** accumulator for the goal currently being executed */
  goalAccum = 0;
  /** accumulator between spiking-network windows (dopamine input) */
  windowAccum = 0;

  emit(time: number, value: number, label: string) {
    const r: RewardSignal = { id: ++this.counter, time, value, label };
    this.log.push(r);
    if (this.log.length > 80) this.log.splice(0, this.log.length - 80);
    this.total += value;
    this.recent = Math.max(-1, Math.min(1, this.recent + value));
    this.goalAccum += value;
    this.windowAccum += value;
    return r;
  }

  /** small continuous signals are accumulated without cluttering the log */
  silent(value: number) {
    this.total += value;
    this.goalAccum += value;
    this.windowAccum += value;
  }

  takeGoalReward() {
    const v = this.goalAccum;
    this.goalAccum = 0;
    return v;
  }

  takeWindowReward() {
    const v = this.windowAccum;
    this.windowAccum = 0;
    return v;
  }

  decay(dt: number) {
    this.recent *= Math.exp(-dt * 1.5);
  }

  get lastId() {
    return this.counter;
  }

  toJSON() {
    return { log: this.log.slice(-30), counter: this.counter, total: this.total, recent: this.recent, goalAccum: this.goalAccum, windowAccum: this.windowAccum };
  }

  load(o: ReturnType<RewardSystem["toJSON"]>) {
    this.log = o.log;
    this.counter = o.counter;
    this.total = o.total;
    this.recent = o.recent ?? 0;
    this.goalAccum = o.goalAccum ?? 0;
    this.windowAccum = o.windowAccum ?? 0;
  }
}
