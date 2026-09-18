"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useLab } from "@/store/labStore";

function Row({ k, v, accent }: { k: string; v: string | number; accent?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--color-dim)]">{k}</span>
      <span className={`tabular ${accent ? "text-[var(--color-signal)]" : "text-[var(--color-bright)]"}`}>{v}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-line)] py-2">
      <div className="label mb-1 !text-[var(--color-mid)]">{title}</div>
      {children}
    </div>
  );
}

export function DataPanel() {
  const open = useLab((s) => s.dataOpen);
  const snap = useLab((s) => s.snap);
  const seed = useLab((s) => s.seed);
  return (
    <AnimatePresence>
      {open && snap && (
        <motion.aside
          initial={{ x: 280, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 280, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="panel mono absolute bottom-3 right-3 top-3 z-10 w-[250px] overflow-y-auto !bg-[rgba(6,8,8,0.9)] px-3 text-[10px] leading-[1.65]"
        >
          <div className="flex items-center justify-between py-2">
            <span className="text-[10px] tracking-[0.22em] text-[var(--color-bright)]">RAW STATE</span>
            <button className="text-[var(--color-dim)] hover:text-[var(--color-bright)]" onClick={() => useLab.getState().toggle("dataOpen")}>
              ✕
            </button>
          </div>
          <Block title="POSITION">
            <Row k="x" v={snap.position.x.toFixed(2)} />
            <Row k="y" v={snap.position.y.toFixed(2)} />
            <Row k="z" v={snap.position.z.toFixed(2)} />
          </Block>
          <Block title="MOTION">
            <Row k="VELOCITY" v={snap.speed.toFixed(2)} />
            <Row k="HEADING" v={snap.heading.toFixed(3)} />
          </Block>
          <Block title="DRIVES">
            <Row k="HUNGER" v={snap.hunger.toFixed(3)} />
            <Row k="THIRST" v={snap.thirst.toFixed(3)} />
            <Row k="CURIOSITY" v={snap.curiosity.toFixed(3)} />
            <Row k="FEAR" v={snap.fear.toFixed(3)} />
            <Row k="ENERGY" v={snap.energy.toFixed(3)} />
            <Row k="SAFETY" v={snap.safety.toFixed(3)} />
            <Row k="EXPLORATION" v={snap.exploration.toFixed(3)} />
          </Block>
          <Block title="DECISION">
            <Row k="CURRENT GOAL" v={snap.goalType ?? "NONE"} accent />
            <Row k="PHASE" v={snap.goalPhase || "—"} />
            <Row k="DECISIONS" v={snap.stats.decisions} />
            <Row k="CONFIDENCE" v={snap.decisionConfidence.toFixed(3)} />
            <Row k="Q-STATES" v={snap.qStates} />
            <Row k="Q-UPDATES" v={snap.qUpdates} />
          </Block>
          <Block title="MEMORY">
            <Row k="MEMORY COUNT" v={snap.memoryCount} />
            <Row k="KNOWN LOCATIONS" v={snap.knownLocations} />
            <Row k="ENCODING PRECISION" v={snap.encodingPrecision.toFixed(3)} />
            <Row k="EXPLORED" v={`${(snap.explored * 100).toFixed(1)}%`} />
            <Row k="RECALLS" v={`${snap.stats.recallSuccesses}/${snap.stats.recalls}`} />
          </Block>
          <Block title="SKILLS">
            <Row k="NAV SKILL" v={snap.navSkill.toFixed(3)} />
            <Row k="VIGILANCE" v={snap.vigilance.toFixed(3)} />
            <Row k="ACTIVE BRAIN NODES" v={`${snap.activeNodes} / 9`} accent />
            <Row k="SYNAPSES" v={snap.synapses} />
          </Block>
          <Block title="LEARNED ASSOCIATIONS · FOOD NEAR">
            {Object.entries(snap.objectFood).map(([k, v]) => (
              <Row key={k} k={k.toUpperCase()} v={v.toFixed(2)} />
            ))}
          </Block>
          <Block title="FOOD PREFERENCE">
            {Object.keys(snap.foodPreference).length === 0 && <div className="text-[var(--color-dim)]">—</div>}
            {Object.entries(snap.foodPreference).map(([k, v]) => (
              <Row key={k} k={k} v={v.toFixed(2)} />
            ))}
          </Block>
          <Block title="LIFETIME">
            <Row k="DISTANCE" v={`${snap.stats.distance.toFixed(0)} m`} />
            <Row k="FOOD EATEN" v={snap.stats.foodEaten} />
            <Row k="SOURCES FOUND" v={snap.stats.discovered} />
            <Row k="ENCOUNTERS" v={snap.stats.encounters} />
            <Row k="CONTACTS" v={snap.stats.contacts} />
            <Row k="ESCAPES" v={snap.stats.escapes} />
            <Row k="CACHES" v={`${snap.stats.retrieved}/${snap.stats.caches}`} />
            <Row k="MISTAKES" v={snap.stats.mistakes} />
          </Block>
          <div className="py-2 text-[var(--color-dim)]">SEED {seed}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
