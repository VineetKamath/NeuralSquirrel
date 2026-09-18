import { Experiment } from "../src/simulation/Experiment";
import { FIXED_DT } from "../src/simulation/constants";
const exp = new Experiment(Number(process.argv[2] ?? 728491), 1);
const secs = Number(process.argv[3] ?? 200);
const every = Number(process.argv[4] ?? 3);
let lastT = 0; let lastThought = 0;
for (let i = 0; i < secs / FIXED_DT; i++) {
  exp.step(FIXED_DT);
  for (const th of exp.ctx.brain.thoughts) if (th.id > lastThought) { lastThought = th.id; console.log(`    · ${th.text}`); }
  if (exp.time - lastT >= every) {
    lastT = exp.time;
    const s = exp.agent.state; const g = s.currentGoal;
    const top = exp.agent.lastSelection?.candidates.slice(0, 4).map(c => `${c.type}:${c.total.toFixed(2)}`).join(" ");
    console.log(`t${exp.time.toFixed(0)} pos(${s.position.x.toFixed(1)},${s.position.z.toFixed(1)}) ${g?.type ?? "-"}/${g?.phase ?? ""} ${g?.label ?? ""} tgt(${g?.target?.x.toFixed(1)},${g?.target?.z.toFixed(1)}) pose ${s.anim.pose} sp ${s.anim.speed.toFixed(1)} climb ${s.anim.climbHeight.toFixed(1)} H${s.hunger.toFixed(2)} E${s.energy.toFixed(2)} F${s.fear.toFixed(2)} | ${top}`);
  }
}
