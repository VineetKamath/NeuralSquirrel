"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLab } from "@/store/labStore";
import { getExperiment } from "@/store/runtime";
import { TIME_SCALES } from "@/simulation/constants";
import { downloadSnapshot } from "@/store/lifecycle";
import { pushControl } from "@/store/serverLink";
import { setSpeedEverywhere } from "./Settings";
import { LIVE } from "@/store/liveMode";

interface Command {
  id: string;
  label: string;
  group: string;
  keys?: string;
  run: () => void;
}

function commands(): Command[] {
  const a = useLab.getState();
  const list: Command[] = [
    {
      id: "run",
      label: a.running ? "Pause observation" : "Resume observation",
      group: "EXPERIMENT",
      keys: "SPACE",
      run: () => {
        a.toggleRunning();
        void pushControl({ running: useLab.getState().running });
      },
    },
    { id: "observe", label: "Mode · Observe", group: "VIEW", keys: "1", run: () => a.setMode("observe") },
    { id: "neural", label: "Mode · Neuroscience", group: "VIEW", keys: "2", run: () => a.setMode("neural") },
    { id: "ecology", label: "Mode · Ecology & map", group: "VIEW", keys: "3", run: () => a.setMode("ecology") },
    { id: "cinematic", label: "Toggle cinematic camera", group: "VIEW", keys: "C", run: () => a.toggle("cinematic") },
    { id: "overlays", label: "Toggle 3D overlays", group: "VIEW", keys: "O", run: () => a.toggle("overlays") },
    { id: "map", label: "Open map overlay", group: "VIEW", keys: "M", run: () => a.toggle("mapOpen") },
    { id: "journal", label: "Open field journal", group: "EXPERIMENT", keys: "J", run: () => a.toggle("journalOpen") },
    { id: "settings", label: "Open settings", group: "EXPERIMENT", keys: ",", run: () => a.toggle("settingsOpen") },
    { id: "archive", label: "Open experiment archive", group: "EXPERIMENT", run: () => a.toggle("archiveOpen") },
    { id: "save", label: "Save experiment now", group: "EXPERIMENT", run: () => void a.saveNow(getExperiment()) },
    { id: "export", label: "Export snapshot file", group: "EXPERIMENT", run: downloadSnapshot },
    { id: "record", label: a.recording ? "Stop recording" : "Record 3D feed", group: "EXPERIMENT", run: () => a.setRecording(!a.recording) },
    { id: "audio", label: a.audio ? "Mute audio" : "Enable audio", group: "EXPERIMENT", run: () => a.toggle("audio") },
    { id: "new", label: "New experiment (new seed)", group: "EXPERIMENT", run: () => a.newExperiment() },
    { id: "reset", label: "Restart this seed", group: "EXPERIMENT", run: () => a.resetExperiment() },
    { id: "neuron-place", label: "Inspect a place cell", group: "NEURONS", run: () => pickNeuron("PLACE") },
    { id: "neuron-vta", label: "Inspect a VTA dopamine neuron", group: "NEURONS", run: () => pickNeuron("VTA") },
    { id: "neuron-grid", label: "Inspect a grid cell", group: "NEURONS", run: () => pickNeuron("GRID") },
    { id: "neuron-amyg", label: "Inspect an amygdala neuron", group: "NEURONS", run: () => pickNeuron("AMYGDALA") },
    { id: "neuron-str", label: "Inspect a striatal action neuron", group: "NEURONS", run: () => pickNeuron("STRIATUM") },
  ];
  if (LIVE) return list.filter((c) => !["run", "new", "reset", "save", "archive"].includes(c.id));
  for (const t of TIME_SCALES) list.push({ id: `speed-${t.id}`, label: `Day length · ${t.label} (${t.hint})`, group: "TIME", run: () => setSpeedEverywhere(t.speed) });
  return list;
}

function pickNeuron(pop: string) {
  const nb = getExperiment().ctx.neural;
  const p = nb.pops.find((x) => x.id === pop);
  if (!p) return;
  const count = p.id === "PLACE" ? Math.max(1, nb.placeCount) : p.count;
  useLab.getState().setMode("neural");
  useLab.getState().selectNeuron(p.start + Math.floor(Math.random() * count));
}

/** ⌘K / Ctrl+K quick command launcher */
export function CommandPalette() {
  const open = useLab((s) => s.paletteOpen);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => {
    if (!open) return [];
    const all = commands();
    if (!q.trim()) return all;
    const terms = q.toLowerCase().split(/\s+/);
    return all.filter((c) => terms.every((t) => `${c.label} ${c.group}`.toLowerCase().includes(t)));
  }, [q, open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 20);
    }
  }, [open]);

  const close = () => useLab.setState({ paletteOpen: false });
  const exec = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[14vh]" onClick={close}>
          <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="panel w-[min(560px,100%)] !bg-[rgba(7,9,9,0.97)]" onClick={(e) => e.stopPropagation()}>
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSel((v) => Math.min(list.length - 1, v + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSel((v) => Math.max(0, v - 1));
                } else if (e.key === "Enter") exec(list[sel]);
                else if (e.key === "Escape") close();
              }}
              placeholder="TYPE A COMMAND…"
              className="mono w-full border-b border-[var(--color-line)] bg-transparent px-4 py-3 text-[12px] tracking-[0.12em] text-[var(--color-bright)] outline-none placeholder:text-[var(--color-dim)]"
            />
            <div className="max-h-[50vh] overflow-y-auto py-1">
              {list.map((c, i) => (
                <button
                  key={c.id}
                  className={`flex w-full items-center gap-3 px-4 py-[7px] text-left ${i === sel ? "bg-[rgba(143,227,196,0.08)]" : ""}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => exec(c)}
                >
                  <span className="mono w-[76px] shrink-0 text-[8.5px] tracking-[0.16em] text-[var(--color-dim)]">{c.group}</span>
                  <span className={`text-[12.5px] ${i === sel ? "text-[var(--color-bright)]" : "text-[var(--color-text)]"}`}>{c.label}</span>
                  {c.keys && <span className="mono ml-auto border border-[var(--color-line)] px-1.5 text-[9px] text-[var(--color-mid)]">{c.keys}</span>}
                </button>
              ))}
              {list.length === 0 && <div className="mono px-4 py-3 text-[10px] text-[var(--color-dim)]">NO MATCHING COMMAND</div>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
