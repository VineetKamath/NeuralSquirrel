import { CENSUS, COMPARABLE, type BehaviourProfile } from "@/real/census";
import { clamp } from "@/utils/math";
import type { SquirrelState } from "@/types";

type Key = (typeof COMPARABLE)[number]["key"];

export interface ObservationSample {
  running: number;
  chasing: number;
  climbing: number;
  eating: number;
  foraging: number;
  aboveGround: number;
  tail_twitches: number;
  tail_flags: number;
  kuks: number;
}

/**
 * Compares the subject with the real 2018 Central Park Squirrel Census.
 *
 * Census volunteers recorded what each squirrel was doing when first seen.
 * The simulation takes equivalent "snapshot" observations during daylight
 * (morning and afternoon shifts, like the census) and slowly nudges behavioural
 * biases toward the real proportions. This is calibration against field data,
 * not scripting: behaviour still arises from drives, memory and learning.
 */
export class CalibrationSystem {
  counts = { AM: this.zero(), PM: this.zero() };
  n = { AM: 0, PM: 0 };
  /** additive biases applied to action drives */
  bias: Record<Key, number> = Object.fromEntries(COMPARABLE.map((c) => [c.key, 0])) as Record<Key, number>;
  enabled = true;
  private timer = 0;
  private lastAlarm = -999;

  private zero(): ObservationSample {
    return { running: 0, chasing: 0, climbing: 0, eating: 0, foraging: 0, aboveGround: 0, tail_twitches: 0, tail_flags: 0, kuks: 0 };
  }

  private lastTwitch = -999;
  private lastFlag = -999;

  noteAlarm(time: number) {
    this.lastAlarm = time;
    this.lastFlag = time;
  }

  noteTwitch(time: number) {
    this.lastTwitch = time;
  }

  noteFlag(time: number) {
    this.lastFlag = time;
  }

  /** record a census-style observation of the subject */
  observe(dt: number, s: SquirrelState, time: number, hour: number, sunElevation: number) {
    this.timer += dt;
    if (this.timer < 1.5) return; // ≈ every 4.5 simulated minutes
    this.timer = 0;
    if (sunElevation < 2 || !s.alive) return;
    if (s.anim.hidden && s.anim.climbHeight > 5) return; // inside a drey: a census volunteer would not see it
    const shift = hour < 12 ? "AM" : "PM";
    const c = this.counts[shift];
    const g = s.currentGoal;
    const a = s.anim;
    // volunteers recorded several simultaneous activities for one squirrel; the same applies here
    const foragingGoal = g?.type === "SEARCH_FOR_FOOD" || g?.type === "RETURN_TO_MEMORY" || g?.type === "STORE_FOOD" || (g?.type === "INVESTIGATE" && g.phase === "sniff");
    c.running += a.pose === "run" || a.speed > 2.2 ? 1 : 0;
    c.chasing += g?.type === "CHASE" ? 1 : 0;
    c.climbing += a.pose === "climb" && (a.speed > 0.1 || a.climbHeight > 0.5) ? 1 : 0;
    c.eating += a.pose === "eat" ? 1 : 0;
    c.foraging += a.pose === "sniff" || a.pose === "dig" || foragingGoal || (g?.type === "EXPLORE" && a.pose !== "run") ? 1 : 0;
    c.aboveGround += a.climbHeight > 0.5 ? 1 : 0;
    c.tail_twitches += time - this.lastTwitch < 6 ? 1 : 0;
    c.tail_flags += time - this.lastFlag < 6 ? 1 : 0;
    c.kuks += time - this.lastAlarm < 20 ? 1 : 0;
    this.n[shift]++;
  }

  simulated(shift: "AM" | "PM" | "ALL"): Record<Key, number> {
    const keys = COMPARABLE.map((c) => c.key);
    const out = {} as Record<Key, number>;
    const nAM = this.n.AM;
    const nPM = this.n.PM;
    for (const k of keys) {
      const kk = k as keyof ObservationSample;
      if (shift === "ALL") out[k] = nAM + nPM ? (this.counts.AM[kk] + this.counts.PM[kk]) / (nAM + nPM) : 0;
      else out[k] = this.n[shift] ? this.counts[shift][kk] / this.n[shift] : 0;
    }
    return out;
  }

  real(shift: "AM" | "PM" | "ALL"): Record<Key, number> {
    const src: BehaviourProfile = shift === "AM" ? CENSUS.am : shift === "PM" ? CENSUS.pm : CENSUS.park;
    return Object.fromEntries(COMPARABLE.map((c) => [c.key, src[c.key] as number])) as Record<Key, number>;
  }

  /** similarity to the census: 1 − mean normalised absolute difference */
  realism() {
    const total = this.n.AM + this.n.PM;
    if (total < 20) return 0;
    const sim = this.simulated("ALL");
    const real = this.real("ALL");
    let err = 0;
    let wsum = 0;
    for (const c of COMPARABLE) {
      const w = Math.max(0.05, real[c.key]);
      err += Math.min(1, Math.abs(sim[c.key] - real[c.key]) / Math.max(0.08, real[c.key])) * w;
      wsum += w;
    }
    return clamp(1 - err / wsum);
  }

  sampleCount() {
    return this.n.AM + this.n.PM;
  }

  /** daily calibration step: move biases toward reducing the discrepancy */
  calibrate() {
    if (!this.enabled || this.sampleCount() < 30) return;
    const sim = this.simulated("ALL");
    const real = this.real("ALL");
    for (const c of COMPARABLE) {
      const diff = real[c.key] - sim[c.key];
      this.bias[c.key] = clamp(this.bias[c.key] + diff * 0.6, -0.6, 0.6);
    }
    // older observations fade so calibration tracks the current behaviour
    for (const shift of ["AM", "PM"] as const) {
      for (const k of Object.keys(this.counts[shift]) as (keyof ObservationSample)[]) this.counts[shift][k] *= 0.7;
      this.n[shift] *= 0.7;
    }
  }

  toJSON() {
    return { counts: this.counts, n: this.n, bias: this.bias, enabled: this.enabled };
  }

  load(o: ReturnType<CalibrationSystem["toJSON"]>) {
    this.counts = o.counts;
    this.n = o.n;
    this.bias = o.bias;
    this.enabled = o.enabled;
  }
}
