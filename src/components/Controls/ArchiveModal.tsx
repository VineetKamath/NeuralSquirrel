"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useLab } from "@/store/labStore";
import { deleteRecord, loadRecords } from "@/store/persistence";
import { pad } from "@/utils/format";

function Bar({ v }: { v: number }) {
  return (
    <span className="relative inline-block h-[3px] w-14 bg-[rgba(190,210,205,0.08)] align-middle">
      <span className="absolute inset-y-0 left-0 bg-[var(--color-signal)]" style={{ width: `${Math.round(v * 100)}%` }} />
    </span>
  );
}

function lvl(v: number) {
  return v > 0.66 ? "HIGH" : v > 0.38 ? "MOD" : "LOW";
}

export function ArchiveModal() {
  const open = useLab((s) => s.archiveOpen);
  const records = useLab((s) => s.records);
  const current = useLab((s) => s.experimentNumber);
  const a = useLab.getState();
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4" onClick={() => a.toggle("archiveOpen")}>
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="panel max-h-[85vh] w-[min(1100px,100%)] overflow-hidden !bg-[rgba(7,9,9,0.96)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5">
              <span className="mono text-[11px] tracking-[0.26em] text-[var(--color-bright)]">EXPERIMENT ARCHIVE</span>
              <span className="mono text-[9px] tracking-[0.14em] text-[var(--color-dim)]">STORED LOCALLY · {records.length} RECORDS</span>
              <button className="btn ml-auto" onClick={() => a.toggle("archiveOpen")}>
                CLOSE ✕
              </button>
            </div>
            <div className="max-h-[calc(85vh-48px)] overflow-auto">
              {records.length === 0 ? (
                <div className="mono p-10 text-center text-[10px] tracking-[0.16em] text-[var(--color-dim)]">NO STORED EXPERIMENTS YET. RECORDS ARE SAVED AUTOMATICALLY WHILE AN EXPERIMENT RUNS.</div>
              ) : (
                <table className="mono w-full min-w-[900px] text-left text-[10px]">
                  <thead className="sticky top-0 bg-[#080a0a] text-[8.5px] tracking-[0.14em] text-[var(--color-dim)]">
                    <tr className="border-b border-[var(--color-line)]">
                      {["EXP", "SEED", "DAYS", "FOOD", "NAV", "DANGER", "MEMORY", "EXPLORATION", "RISK", "FOOD PRIO", "MEM", "EVENTS", "CONTACTS", ""].map((h) => (
                        <th key={h} className="px-3 py-2 font-normal">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records
                      .slice()
                      .reverse()
                      .map((r) => (
                        <tr key={r.number} className={`border-b border-[var(--color-line)] hover:bg-white/[0.02] ${r.number === current ? "text-[var(--color-signal)]" : "text-[var(--color-text)]"}`}>
                          <td className="px-3 py-2 tracking-[0.12em]">EXPERIMENT {pad(r.number)}</td>
                          <td className="tabular px-3 text-[var(--color-mid)]">{r.seed}</td>
                          <td className="tabular px-3">{r.simDays.toFixed(1)}</td>
                          {[r.metrics.foodEfficiency, r.metrics.navigationEfficiency, r.metrics.dangerAvoidance, r.metrics.memoryAccuracy].map((v, i) => (
                            <td key={i} className="tabular px-3">
                              <Bar v={v} /> <span className="ml-1">{Math.round(v * 100)}</span>
                            </td>
                          ))}
                          <td className="px-3">{lvl(r.profile.exploration)}</td>
                          <td className="px-3">{lvl(r.profile.risk)}</td>
                          <td className="px-3">{lvl(r.profile.foodPriority)}</td>
                          <td className="px-3">{lvl(r.profile.memory)}</td>
                          <td className="tabular px-3">{r.milestones}</td>
                          <td className="tabular px-3">{r.contacts}</td>
                          <td className="whitespace-nowrap px-3">
                            <button
                              className="btn !px-2 !py-1 !text-[9px]"
                              onClick={() => {
                                a.toggle("archiveOpen");
                                a.newExperiment(r.seed);
                              }}
                              title="Start a new experiment with this seed"
                            >
                              RE-RUN SEED
                            </button>
                            {r.number !== current && (
                              <button
                                className="btn ml-1 !px-2 !py-1 !text-[9px]"
                                onClick={() => {
                                  deleteRecord(r.number);
                                  useLab.setState({ records: loadRecords() });
                                }}
                              >
                                DEL
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
              {records.length > 1 && (
                <div className="mono border-t border-[var(--color-line)] px-4 py-3 text-[9.5px] leading-[1.7] text-[var(--color-dim)]">
                  Profiles emerge from randomized initial parameters plus each subject&apos;s experience. Re-running a seed reproduces the world and starting parameters; trajectories stay approximately reproducible.
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
