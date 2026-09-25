import type { BehavioralProfile, DaySummary, HistorySample, Personality } from "@/types";
import { clamp, dist2D } from "@/utils/math";
import { DAY_LENGTH, HISTORY_INTERVAL } from "./constants";
import type { SquirrelAgent } from "./SquirrelAgent";
import type { SimContext } from "./SquirrelAgent";

/** Tracks behaviour over time: hourly samples, daily summaries, behavioural profile. */
export class MetricsSystem {
  history: HistorySample[] = [];
  days: DaySummary[] = [];
  private timer = 0;
  private dayRadius = 0;
  private dayStartDistance = 0;
  private dayStartFood = 0;
  private dayRestTime = 0;
  private dayTime = 0;
  private lastDay = 1;
  private radiusSum = 0;
  private radiusCount = 0;
  private riskTime = 0;
  private totalTime = 0;

  toJSON() {
    return {
      history: this.history,
      days: this.days,
      timer: this.timer,
      dayRadius: this.dayRadius,
      dayStartDistance: this.dayStartDistance,
      dayStartFood: this.dayStartFood,
      dayRestTime: this.dayRestTime,
      dayTime: this.dayTime,
      lastDay: this.lastDay,
      radiusSum: this.radiusSum,
      radiusCount: this.radiusCount,
      riskTime: this.riskTime,
      totalTime: this.totalTime,
    };
  }

  load(o: ReturnType<MetricsSystem["toJSON"]>) {
    Object.assign(this, o);
  }

  /** a new generation starts its own counters */
  resetForGeneration(agent: SquirrelAgent) {
    this.dayStartDistance = agent.state.behaviorStats.distanceTravelled;
    this.dayStartFood = agent.state.behaviorStats.foodEaten;
    this.radiusSum = 0;
    this.radiusCount = 0;
    this.riskTime = 0;
    this.totalTime = 0;
  }

  update(dt: number, agent: SquirrelAgent, ctx: SimContext) {
    const { world, memory } = ctx;
    const s = agent.state;
    const r = dist2D(s.position, agent.homeTree.position);
    this.dayRadius = Math.max(this.dayRadius, r);
    this.dayTime += dt;
    this.totalTime += dt;
    if (s.currentGoal?.type === "REST") this.dayRestTime += dt;
    if (memory.dangerAt(s.position.x, s.position.z) > 0.2 || (agent.perception?.threatLevel ?? 0) > 0.3) this.riskTime += dt;

    this.timer += dt;
    if (this.timer >= HISTORY_INTERVAL) {
      this.timer -= HISTORY_INTERVAL;
      this.radiusSum += r;
      this.radiusCount++;
      this.sample(agent, ctx);
    }

    const day = world.day;
    if (day !== this.lastDay) {
      this.closeDay(this.lastDay, agent, ctx);
      this.lastDay = day;
    }
  }

  private sample(agent: SquirrelAgent, ctx: SimContext) {
    const { world, memory, learning, brain } = ctx;
    const s = agent.state;
    const m = learning.metrics;
    this.history.push({
      t: world.state.time,
      day: world.state.time / DAY_LENGTH + 1,
      explorationRadius: this.dayRadius,
      foodEfficiency: m.foodEfficiency,
      navigationEfficiency: m.navigationEfficiency,
      dangerAvoidance: m.dangerAvoidance,
      memoryAccuracy: m.memoryAccuracy,
      memoryStrength: memory.averageStrength(),
      decisionConfidence: learning.decisionConfidence,
      restFraction: this.dayTime > 0 ? this.dayRestTime / this.dayTime : 0,
      curiosity: s.curiosity,
      hunger: s.hunger,
      fear: s.fear,
      memoryCount: memory.memories.length,
      synapses: brain.synapses(memory.memories.length, learning.tableSize()) + ctx.neural.placeCount * 24,
      tempC: world.state.env.tempC,
      health: s.health,
      placeCells: ctx.neural.placeCount,
      realism: ctx.calibration.realism(),
    });
    if (this.history.length > 720) {
      // keep long runs light: thin older samples
      this.history = this.history.filter((_, i) => i % 2 === 0 || i > this.history.length - 240);
    }
  }

  private closeDay(day: number, agent: SquirrelAgent, ctx: SimContext) {
    const { learning, events, world } = ctx;
    const s = agent.state;
    const m = learning.metrics;
    const summary: DaySummary = {
      day,
      explorationRadius: this.dayRadius,
      foodEfficiency: m.foodEfficiency,
      navigationEfficiency: m.navigationEfficiency,
      dangerAvoidance: m.dangerAvoidance,
      memoryAccuracy: m.memoryAccuracy,
      foodEaten: s.behaviorStats.foodEaten - this.dayStartFood,
      distance: s.behaviorStats.distanceTravelled - this.dayStartDistance,
      restFraction: this.dayTime > 0 ? this.dayRestTime / this.dayTime : 0,
    };
    this.days.push(summary);
    const prev = this.days[this.days.length - 2];
    if (prev && prev.explorationRadius > 12 && summary.explorationRadius > 8) {
      const ratio = summary.explorationRadius / prev.explorationRadius;
      if (ratio < 0.6 || ratio > 1.6) {
        const text = ratio < 1 ? "exploration pattern changed: range contracted" : "exploration pattern changed: range expanded";
        events.add(world.state.time, text, "behavior");
        events.milestone("EXPLORATION_SHIFT", world.state.time, text, "behavior", {
          title: "EXPLORATION PATTERN CHANGED",
          detail:
            ratio < 1
              ? `Daily exploration radius fell from ${prev.explorationRadius.toFixed(0)} m to ${summary.explorationRadius.toFixed(0)} m. The subject is concentrating activity in familiar territory.`
              : `Daily exploration radius grew from ${prev.explorationRadius.toFixed(0)} m to ${summary.explorationRadius.toFixed(0)} m. The subject is extending its range.`,
          metrics: [
            { label: `DAY ${prev.day}`, value: `${prev.explorationRadius.toFixed(0)} m` },
            { label: `DAY ${summary.day}`, value: `${summary.explorationRadius.toFixed(0)} m` },
          ],
        });
      }
    }
    if (world.isNight || day === 1) {
      events.milestone("FIRST_NIGHT", world.state.time, "first night survived", "environment", {
        title: "FIRST DAY COMPLETED",
        detail: `Subject completed its first full day. ${summary.foodEaten} food units consumed, ${summary.distance.toFixed(0)} m travelled, ${s.memories.length} memories retained.`,
        metrics: [
          { label: "FOOD EFFICIENCY", value: `${Math.round(m.foodEfficiency * 100)}%` },
          { label: "NAVIGATION", value: `${Math.round(m.navigationEfficiency * 100)}%` },
          { label: "MEMORY ACCURACY", value: `${Math.round(m.memoryAccuracy * 100)}%` },
        ],
      });
    }
    events.add(world.state.time, `day ${String(day).padStart(2, "0")} complete · radius ${summary.explorationRadius.toFixed(0)} m`, "environment");
    this.dayRadius = 0;
    this.dayRestTime = 0;
    this.dayTime = 0;
    this.dayStartDistance = s.behaviorStats.distanceTravelled;
    this.dayStartFood = s.behaviorStats.foodEaten;
  }

  profile(agent: SquirrelAgent, ctx: SimContext, p: Personality): BehavioralProfile {
    const { memory, learning } = ctx;
    const s = agent.state;
    const st = s.behaviorStats;
    const total = Math.max(1, this.totalTime);
    const avgRadius = this.radiusCount ? this.radiusSum / this.radiusCount : 0;
    const forage = (st.actionTime.SEARCH_FOR_FOOD + st.actionTime.EAT + st.actionTime.RETURN_TO_MEMORY + st.actionTime.STORE_FOOD) / total;
    const exploration = clamp(0.3 * p.curiosityBase + 0.4 * clamp(avgRadius / 45) + 0.3 * clamp(memory.exploredNow() * 3));
    const risk = clamp(0.45 * p.boldness + 0.35 * clamp((this.riskTime / total) * 6) + 0.2 * clamp(st.contacts / 3));
    const foodPriority = clamp(0.25 * p.metabolism + 0.75 * clamp(forage * 2.2));
    const mem = clamp(0.4 * learning.metrics.memoryAccuracy + 0.35 * memory.averageStrength() * 2 + 0.25 * p.retention);
    const vigilance = clamp(0.6 * learning.vigilance + 0.4 * clamp((st.actionTime.OBSERVE / total) * 12));
    const hoarding = clamp(0.4 * p.hoarding + 0.6 * clamp(st.cachesMade / Math.max(4, st.foodEaten * 0.6)));
    const summary: string[] = [];
    if (exploration > 0.6) summary.push("ranges widely beyond the nest");
    else if (exploration < 0.35) summary.push("concentrates activity in familiar territory");
    if (risk > 0.6) summary.push("tolerates proximity to known danger");
    else if (risk < 0.35) summary.push("avoids locations associated with threat");
    if (mem > 0.6) summary.push("relies heavily on spatial memory");
    if (hoarding > 0.55) summary.push("caches surplus food");
    if (vigilance > 0.6) summary.push("frequent scanning behaviour");
    if (!summary.length) summary.push("balanced behavioural allocation");
    return { exploration, risk, foodPriority, memory: mem, vigilance, hoarding, summary };
  }
}
