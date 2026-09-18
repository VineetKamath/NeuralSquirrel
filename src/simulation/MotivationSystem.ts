import type { Personality, SquirrelState } from "@/types";
import { clamp } from "@/utils/math";
import { dailyEnergyNeed } from "@/real/biology";
import { DAY_LENGTH } from "./constants";

export type ActivityLevel = "sleep" | "rest" | "idle" | "walk" | "run" | "climb";

export interface MotivationContext {
  activity: ActivityLevel;
  night: boolean;
  raining: boolean;
  /** learned danger association at current location, 0..1 */
  dangerHere: number;
  /** perceived threat proximity, 0..1 */
  threatLevel: number;
  /** novelty of what is currently perceived, 0..1 */
  novelty: number;
  /** fraction of the world already explored */
  explored: number;
  /** 0 = open, 1 = under cover */
  cover: number;
  /** real air temperature (°C) */
  tempC: number;
  /** sheltered in the leaf nest (drey) */
  inDrey: boolean;
  snow: boolean;
}

export interface Drives {
  HUNGER: number;
  THIRST: number;
  CURIOSITY: number;
  FEAR: number;
  ENERGY: number;
  SAFETY: number;
  EXPLORATION: number;
  WARMTH: number;
}

const ACTIVITY_COST: Record<ActivityLevel, number> = {
  sleep: 0.55,
  rest: 0.65,
  idle: 0.8,
  walk: 1,
  run: 1.7,
  climb: 1.5,
};

/** reference field energy need at the lower critical temperature */
const REFERENCE_NEED = dailyEnergyNeed(10);

/**
 * Internal drives. Hunger scales with a Kleiber-law energy budget and the real
 * air temperature (thermoregulation), so cold snaps in the weather record raise
 * food requirements exactly when food is scarcest.
 */
export class MotivationSystem {
  habituation = 0;
  energyNeedToday = REFERENCE_NEED;

  update(s: SquirrelState, p: Personality, dt: number, ctx: MotivationContext) {
    const cost = ACTIVITY_COST[ctx.activity];
    // a drey insulates: effective temperature is much milder inside
    const effTemp = ctx.inDrey ? Math.max(ctx.tempC, 12) : ctx.tempC;
    this.energyNeedToday = dailyEnergyNeed(effTemp);
    const thermal = this.energyNeedToday / REFERENCE_NEED;
    // hunger 0→1 corresponds to roughly one day's field energy requirement
    s.hunger = clamp(s.hunger + (dt / DAY_LENGTH) * 1.05 * p.metabolism * cost * thermal);
    // rain and dew are drunk from leaves; lying snow is eaten
    s.thirst = clamp(s.thirst + (dt / DAY_LENGTH) * 0.95 * cost * (ctx.raining ? 0.45 : ctx.snow ? 0.3 : 1) * (ctx.tempC > 22 ? 1.4 : 1));

    let dEnergy = 0;
    switch (ctx.activity) {
      case "sleep":
        dEnergy = ctx.inDrey ? 0.0135 : 0.0105;
        break;
      case "rest":
        dEnergy = 0.008;
        break;
      case "idle":
        dEnergy = -0.0004;
        break;
      case "walk":
        dEnergy = -0.0011;
        break;
      case "run":
      case "climb":
        dEnergy = -0.0032;
        break;
    }
    if (s.hunger > 0.9) dEnergy -= 0.0015;
    if (s.thirst > 0.95) dEnergy -= 0.001;
    if (ctx.night && ctx.activity !== "sleep" && ctx.activity !== "rest") dEnergy -= 0.0006;
    if (effTemp < 0) dEnergy -= Math.min(0.002, -effTemp * 0.00008);
    s.energy = clamp(s.energy + dEnergy * dt);

    s.warmth = clamp(s.warmth + ((ctx.inDrey ? 1 : clamp((effTemp + 10) / 25)) - s.warmth) * Math.min(1, dt * 0.02));

    const baseline = (1 - p.boldness) * 0.08 + (ctx.night ? 0.08 : 0) + (1 - ctx.cover) * 0.03;
    const anticipatory = ctx.dangerHere * 0.6 * (1.25 - p.boldness);
    const target = Math.max(baseline, ctx.threatLevel, anticipatory);
    if (target > s.fear) s.fear = clamp(s.fear + (target - s.fear) * Math.min(1, dt * 3.5));
    else s.fear = clamp(s.fear - dt * 0.05 * (0.6 + p.boldness), target, 1);

    this.habituation = Math.pow(ctx.explored, 0.6) * 0.75;
    const growth = 0.0042 * p.curiosityBase * (1 - this.habituation) + ctx.novelty * 0.035;
    s.curiosity = clamp(s.curiosity + dt * growth - dt * s.fear * 0.004);

    s.safety = clamp(1 - (s.fear * 0.55 + ctx.dangerHere * 0.3 + (1 - ctx.cover) * 0.15));

    // health: starvation, dehydration and hypothermia erode it; good condition restores it
    const day = dt / DAY_LENGTH;
    let dHealth = 0;
    if (s.hunger >= 0.99) dHealth -= 0.35 * day;
    if (s.thirst >= 0.99) dHealth -= 0.3 * day;
    if (effTemp < -6 && s.energy < 0.2) dHealth -= 0.5 * day;
    if (s.hunger < 0.6 && s.thirst < 0.7 && s.energy > 0.35) dHealth += 0.2 * day;
    s.health = clamp(s.health + dHealth);
  }

  drives(s: SquirrelState): Drives {
    return {
      HUNGER: s.hunger,
      THIRST: s.thirst,
      CURIOSITY: s.curiosity,
      FEAR: s.fear,
      ENERGY: s.energy,
      SAFETY: s.safety,
      EXPLORATION: clamp(s.curiosity * (1 - this.habituation) * (1 - s.fear)),
      WARMTH: s.warmth,
    };
  }
}
