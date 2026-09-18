import { Experiment } from "../src/simulation/Experiment";
import { DAY_LENGTH, FIXED_DT } from "../src/simulation/constants";
import { realDateString } from "../src/utils/format";
const days = Number(process.argv[2] ?? 8);
const seeds = process.argv.slice(3).map(Number);
for (const seed of seeds) {
  const e = new Experiment(seed, 1);
  const t0 = Date.now();
  const rows: string[] = [];
  for (let d = 1; d <= days; d++) {
    for (let i = 0; i < DAY_LENGTH / (FIXED_DT * 2); i++) { e.agent.neuralWindowMs = 20; e.step(FIXED_DT * 2); }
    const m = e.ctx.learning.metrics; const s = e.agent.state;
    rows.push(`${d}:${(m.foodEfficiency*100)|0}/${(m.navigationEfficiency*100)|0}/${(m.dangerAvoidance*100)|0}/${(m.memoryAccuracy*100)|0} H${s.hunger.toFixed(1)}E${s.energy.toFixed(1)}T${s.thirst.toFixed(1)}hp${s.health.toFixed(1)} g${s.generation}`);
  }
  const st = e.agent.state.behaviorStats;
  console.log(`seed ${seed} ${(Date.now()-t0)}ms ${realDateString(e.time)} gen ${e.agent.state.generation} lineage ${e.lineage.map(l=>l.cause+":"+l.daysAlive.toFixed(1)).join(",")} mems ${e.ctx.memory.memories.length} eaten ${st.foodEaten} caches ${st.cachesMade}/${st.cachesRetrieved} pilfered ${st.pilfersByRivals}/${st.cachesPilfered} contacts ${st.contacts} chases ${st.chases} alarms ${st.alarmCalls} places ${e.ctx.neural.placeCount} replays ${e.ctx.neural.replays.length} realism ${(e.ctx.calibration.realism()*100).toFixed(0)}% milestones ${e.ctx.events.achieved.size}`);
  console.log("   " + rows.join("  "));
  const sim = e.ctx.calibration.simulated("ALL"), real = e.ctx.calibration.real("ALL");
  console.log("   census sim/real:", Object.keys(sim).map(k => `${k} ${(sim[k as keyof typeof sim]*100).toFixed(0)}/${(real[k as keyof typeof real]*100).toFixed(0)}`).join("  "));
  const at = st.actionTime; console.log("   time:", Object.entries(at).map(([k,v])=>`${k.slice(0,6)} ${Math.round(v)}`).join(" "));
}
