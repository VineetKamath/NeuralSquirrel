import { Experiment } from "../src/simulation/Experiment";
import { DAY_LENGTH, FIXED_DT } from "../src/simulation/constants";

const seed = Number(process.argv[2] ?? 728491);
const days = Number(process.argv[3] ?? 10);
const exp = new Experiment(seed, 1);
const t0 = Date.now();
let lastEvent = 0;
const steps = Math.round((days * DAY_LENGTH) / FIXED_DT);
for (let i = 0; i < steps; i++) {
  exp.step(FIXED_DT);
  const ev = exp.ctx.events.log;
  for (const e of ev) {
    if (e.id <= lastEvent) continue;
    lastEvent = e.id;
    if (e.major) console.log(`  [d${(e.time / DAY_LENGTH + 1).toFixed(2)}] ★ ${e.title} — ${e.text}`);
  }
  if (i % Math.round(DAY_LENGTH / FIXED_DT) === 0) {
    const m = exp.ctx.learning.metrics;
    const s = exp.agent.state;
    console.log(
      `day ${(exp.time / DAY_LENGTH + 1).toFixed(1)} food ${(m.foodEfficiency * 100).toFixed(0)} nav ${(m.navigationEfficiency * 100).toFixed(0)} danger ${(m.dangerAvoidance * 100).toFixed(0)} mem ${(m.memoryAccuracy * 100).toFixed(0)} | H ${s.hunger.toFixed(2)} T ${s.thirst.toFixed(2)} E ${s.energy.toFixed(2)} F ${s.fear.toFixed(2)} C ${s.curiosity.toFixed(2)} | mems ${s.memories.length} eaten ${s.behaviorStats.foodEaten} contacts ${s.behaviorStats.contacts} enc ${s.behaviorStats.threatEncounters} caches ${s.behaviorStats.cachesMade} nav ${exp.ctx.learning.navSkill.toFixed(2)}`
    );
  }
}
const st = exp.agent.state.behaviorStats;
console.log("actionTime", Object.fromEntries(Object.entries(st.actionTime).map(([k, v]) => [k, Math.round(v)])));
console.log("actionCount", st.actionCount);
console.log("days", exp.metrics.days.map((d) => `${d.day}:${d.explorationRadius.toFixed(0)}m/${d.foodEaten}`).join(" "));
console.log("profile", exp.profile());
console.log("ms", Date.now() - t0, "brain dev", exp.ctx.brain.development.toFixed(2));
