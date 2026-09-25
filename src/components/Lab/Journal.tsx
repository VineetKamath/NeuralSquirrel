"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import type { JournalEntry } from "@/types";
import { pad } from "@/utils/format";
import { Modal } from "./Modal";

function exportText(entries: JournalEntry[], n: number) {
  const lines = [`NUT THE SQUIRREL — SQUIRREL LAB EXPERIMENT ${pad(n)} — FIELD JOURNAL`, ""];
  for (const e of entries) {
    lines.push(`DAY ${e.day} · ${e.date} · GENERATION ${e.generation}`, e.title, e.weather, ...e.body, e.stats.map((s) => `${s.label}: ${s.value}`).join(" · "), "");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `squirrel-lab-exp${pad(n)}-journal.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Entry({ e }: { e: JournalEntry }) {
  return (
    <article className="border-b border-[var(--color-line)] px-5 py-4">
      <div className="mono flex flex-wrap items-baseline gap-x-3 text-[9.5px] tracking-[0.16em] text-[var(--color-dim)]">
        <span className="text-[var(--color-signal)]">DAY {pad(e.day, 3)}</span>
        <span>{e.date}</span>
        <span>GEN {e.generation}</span>
      </div>
      <h3 className="mt-1 text-[15px] font-medium tracking-[0.02em] text-[var(--color-bright)]">{e.title}</h3>
      <div className="mono mt-0.5 text-[10px] tracking-[0.06em] text-[#9fc3dc]">{e.weather}</div>
      <div className="mt-2 space-y-1 text-[12.5px] leading-[1.6] text-[var(--color-text)]">
        {e.body.map((b, i) => (
          <p key={i}>{b}</p>
        ))}
      </div>
      <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9.5px] tracking-[0.08em]">
        {e.stats.map((s) => (
          <span key={s.label} className="text-[var(--color-dim)]">
            {s.label} <span className="tabular text-[var(--color-bright)]">{s.value}</span>
          </span>
        ))}
      </div>
    </article>
  );
}

/** a written field notebook: one entry per simulated day, grounded in the real weather */
/** entries rendered per page: years of daily entries would otherwise be thousands of DOM nodes */
const PAGE = 40;

export function JournalModal() {
  const open = useLab((s) => s.journalOpen);
  const journal = useLab((s) => s.journal);
  const n = useLab((s) => s.experimentNumber);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [q, open]);
  const list = useMemo(() => {
    const all = journal.slice().reverse();
    if (!q) return all;
    const k = q.toLowerCase();
    return all.filter((e) => [e.title, e.date, e.weather, ...e.body].join(" ").toLowerCase().includes(k));
  }, [journal, q]);
  return (
    <Modal
      open={open}
      onClose={() => useLab.getState().toggle("journalOpen")}
      title="FIELD JOURNAL"
      meta={`EXPERIMENT ${pad(n)} · ${journal.length} DAYS`}
      width={820}
      actions={
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SEARCH…"
            className="mono w-40 border border-[var(--color-line)] bg-transparent px-2 py-[4px] text-[10px] tracking-[0.1em] text-[var(--color-text)] outline-none placeholder:text-[var(--color-dim)]"
          />
          <button className="btn" onClick={() => exportText(journal, n)} disabled={!journal.length}>
            EXPORT .TXT
          </button>
        </>
      }
    >
      {list.length === 0 ? (
        <div className="mono p-10 text-center text-[10px] tracking-[0.16em] text-[var(--color-dim)]">THE FIRST ENTRY IS WRITTEN AT THE END OF DAY 1.</div>
      ) : (
        <>
          {list.slice(0, shown).map((e) => (
            <Entry key={`${e.day}-${e.generation}`} e={e} />
          ))}
          {list.length > shown && (
            <div className="flex justify-center p-4">
              <button className="btn" onClick={() => setShown((v) => v + PAGE * 2)}>
                SHOW OLDER · {list.length - shown} MORE
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export function JournalPanel({ index = "E6" }: { index?: string }) {
  const journal = useLab((s) => s.journal);
  const latest = journal.slice(-12).reverse();
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader
        index={index}
        title="FIELD JOURNAL"
        meta={`${journal.length} ENTRIES`}
        right={
          <button className="btn !px-1.5 !py-[3px] !text-[8.5px]" onClick={() => useLab.getState().toggle("journalOpen")}>
            OPEN · J
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {latest.length === 0 && <div className="mono py-4 text-center text-[9.5px] tracking-[0.12em] text-[var(--color-dim)]">FIRST ENTRY AT THE END OF DAY 1</div>}
        {latest.map((e) => (
          <button key={`${e.day}-${e.generation}`} className="block w-full border-b border-[var(--color-line)] py-1.5 text-left hover:bg-white/[0.02]" onClick={() => useLab.getState().set({ dayReport: e })}>
            <div className="mono flex gap-2 text-[8.5px] tracking-[0.12em] text-[var(--color-dim)]">
              <span className="text-[var(--color-signal)]">D{pad(e.day, 3)}</span>
              <span>{e.date}</span>
            </div>
            <div className="truncate text-[11.5px] text-[var(--color-text)]">{e.title}</div>
            <div className="mono truncate text-[9px] text-[#8fb3cc]">{e.weather}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

/** end-of-day report card that slides in when a simulated day closes */
export function DayReportCard() {
  const report = useLab((s) => s.dayReport);
  const cinematic = useLab((s) => s.cinematic);
  const discovery = useLab((s) => s.discovery);
  useEffect(() => {
    if (!report) return;
    const t = setTimeout(() => useLab.setState({ dayReport: null }), 14000);
    return () => clearTimeout(t);
  }, [report]);
  return (
    <AnimatePresence>
      {report && !cinematic && !discovery && (
        <motion.div
          key={`${report.day}-${report.generation}`}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.45 }}
          className="panel pointer-events-auto absolute right-3 top-3 z-20 w-[min(360px,calc(100%-24px))] !bg-[rgba(7,9,9,0.94)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
            <span className="mono text-[9px] tracking-[0.2em] text-[var(--color-signal)]">DAY {pad(report.day, 3)} REPORT</span>
            <span className="mono text-[9px] tracking-[0.12em] text-[var(--color-dim)]">{report.date}</span>
            <button className="ml-auto text-[var(--color-dim)] hover:text-[var(--color-bright)]" onClick={() => useLab.setState({ dayReport: null })}>
              ✕
            </button>
          </div>
          <div className="px-3 py-2">
            <div className="text-[13px] text-[var(--color-bright)]">{report.title}</div>
            <div className="mono mt-0.5 text-[9.5px] text-[#9fc3dc]">{report.weather}</div>
            <div className="mt-1.5 line-clamp-4 text-[11.5px] leading-[1.55] text-[var(--color-text)]">{report.body.join(" ")}</div>
            <div className="mono mt-2 grid grid-cols-3 gap-1">
              {report.stats.slice(0, 6).map((s) => (
                <div key={s.label} className="border border-[var(--color-line)] px-1.5 py-1">
                  <div className="truncate text-[7.5px] tracking-[0.12em] text-[var(--color-dim)]">{s.label}</div>
                  <div className="tabular truncate text-[10.5px] text-[var(--color-bright)]">{s.value}</div>
                </div>
              ))}
            </div>
            <button className="btn mt-2 w-full" onClick={() => useLab.setState({ dayReport: null, journalOpen: true })}>
              OPEN FIELD JOURNAL
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
