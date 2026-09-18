"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLab, SPEEDS } from "@/store/labStore";
import { createExperiment, getExperiment } from "@/store/runtime";
import { nextExperimentNumber } from "@/store/persistence";
import { loadSavedSnapshot, resumeExperiment, useAutosave, useBackgroundDriver } from "@/store/lifecycle";
import { pushControl } from "@/store/serverLink";
import { LIVE, pullLive, startLiveSync } from "@/store/liveMode";
import type { ExperimentSnapshot } from "@/simulation/Experiment";
import { newSeed } from "@/utils/rng";
import WorldCanvas from "@/components/World/WorldCanvas";
import { BootSequence, type BootChoice } from "./BootSequence";
import { TopBar } from "@/components/Controls/TopBar";
import { ArchiveModal } from "@/components/Controls/ArchiveModal";
import { startRecording, stopRecording } from "@/components/Controls/Recorder";
import { ViewportHUD } from "@/components/Telemetry/ViewportHUD";
import { StatePanel } from "@/components/Telemetry/StatePanel";
import { DataPanel } from "@/components/Telemetry/DataPanel";
import { BrainPanel } from "@/components/Brain/BrainPanel";
import { MemoryPanel } from "@/components/Memory/MemoryPanel";
import { LearningPanel } from "@/components/Charts/LearningPanel";
import { EvolutionCharts } from "@/components/Charts/EvolutionCharts";
import { Timeline } from "@/components/Timeline/Timeline";
import { DiscoveryCard } from "@/components/Timeline/DiscoveryCard";
import { MapView } from "@/components/Map/MapView";
import { SpikeRaster } from "@/components/Neural/SpikeRaster";
import { Connectome } from "@/components/Neural/Connectome";
import { NeuronInspector } from "@/components/Neural/NeuronInspector";
import { PlaceFieldPanel } from "@/components/Neural/PlaceFieldPanel";
import { DecisionSources, DopaminePanel, ReplayLog } from "@/components/Neural/LearningSignals";
import { CensusPanel, PopulationPanel, ProvenancePanel, WeatherPanel } from "@/components/Ecology/EcologyPanels";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import { DayReportCard, JournalModal, JournalPanel } from "./Journal";
import { SettingsModal, setSpeedEverywhere } from "./Settings";
import { CommandPalette } from "./CommandPalette";
import { getAudio } from "@/audio/AudioEngine";
import { pad } from "@/utils/format";

// runs once when the (client-only) lab module loads, before any component renders
let initialised = false;
function initialise() {
  if (initialised) return;
  initialised = true;
  const number = nextExperimentNumber();
  const seed = number === 1 ? 728491 : newSeed();
  const exp = createExperiment(seed, number);
  useLab.setState({ experimentNumber: number, seed });
  useLab.getState().publish(exp);
}
if (typeof window !== "undefined") initialise();

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useLab.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.set({ paletteOpen: !s.paletteOpen });
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!s.booted || s.paletteOpen) return;
      if (LIVE && (e.code === "Space" || e.key === "[" || e.key === "]")) return;
      if (e.code === "Space") {
        e.preventDefault();
        s.toggleRunning();
        void pushControl({ running: useLab.getState().running });
      } else if (e.key === "1") s.setMode("observe");
      else if (e.key === "2") s.setMode("neural");
      else if (e.key === "3") s.setMode("ecology");
      else if (e.key === "[" || e.key === "]") {
        const i = SPEEDS.findIndex((v) => Math.abs(v - s.speed) < 1e-9);
        const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + (e.key === "]" ? 1 : -1)))];
        setSpeedEverywhere(next);
      } else if (e.key === "c") s.toggle("cinematic");
      else if (e.key === "m") s.toggle("mapOpen");
      else if (e.key === "d") s.toggle("dataOpen");
      else if (e.key === "o") s.toggle("overlays");
      else if (e.key === "j") s.toggle("journalOpen");
      else if (e.key === ",") s.toggle("settingsOpen");
      else if (e.key === "Escape") {
        if (s.settingsOpen) s.toggle("settingsOpen");
        else if (s.journalOpen) s.toggle("journalOpen");
        else if (s.mapOpen) s.toggle("mapOpen");
        else if (s.cinematic) s.toggle("cinematic");
        else if (s.archiveOpen) s.toggle("archiveOpen");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useAudio() {
  const audio = useLab((s) => s.audio);
  const booted = useLab((s) => s.booted);
  useEffect(() => {
    if (!booted) return;
    const engine = getAudio();
    if (!audio) {
      engine.stop();
      return;
    }
    // browsers require a user gesture before audio can start
    const start = () => engine.start();
    start();
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, [audio, booted]);
}

function useRecording() {
  const recording = useLab((s) => s.recording);
  useEffect(() => {
    if (recording) {
      if (!startRecording()) useLab.setState({ recording: false });
    } else {
      const s = useLab.getState();
      const exp = getExperiment();
      stopRecording(`squirrel-lab-exp${pad(s.experimentNumber)}-day${pad(exp.world.day)}.webm`);
    }
  }, [recording]);
}

/** Night footage is brightened slightly so the subject stays observable. */
function useNightVision(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    let current = -1;
    const t = setInterval(() => {
      const el = ref.current;
      if (!el) return;
      const w = getExperiment().world;
      const ir = Math.max(0, Math.min(1, (0.35 - w.daylight) / 0.3));
      const k = Math.round(ir * 20) / 20;
      if (k === current) return;
      current = k;
      el.style.filter = k > 0 ? `brightness(${1 + 0.35 * k}) saturate(${1 - 0.2 * k}) contrast(${1 + 0.08 * k})` : "none";
    }, 250);
    return () => clearInterval(t);
  }, [ref]);
}

function CatchUpOverlay() {
  const c = useLab((s) => s.catchingUp);
  const date = useLab((s) => s.snap?.dateLabel ?? "");
  return (
    <AnimatePresence>
      {c && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 flex items-center justify-center bg-black/85">
          <div className="mono w-[min(460px,90vw)] text-[11px] tracking-[0.18em] text-[var(--color-text)]">
            <div className="text-[var(--color-bright)]">SIMULATING THE TIME YOU WERE AWAY</div>
            <div className="mt-1 text-[10px] text-[var(--color-dim)]">
              {((c.to - c.from) / 480).toFixed(2)} DAYS · NOW {date}
            </div>
            <div className="mt-3 h-[3px] bg-[rgba(190,210,205,0.08)]">
              <div className="h-full bg-[var(--color-signal)] transition-[width]" style={{ width: `${Math.round(c.progress * 100)}%` }} />
            </div>
            <button className="btn mt-3" onClick={() => useLab.setState({ catchingUp: null })}>
              SKIP REMAINING
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MapOverlay() {
  const open = useLab((s) => s.mapOpen);
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-3 z-10 border border-[var(--color-line-strong)] bg-black">
          <MapView />
          <button className="btn absolute bottom-16 left-2 bg-[#070909]/85" onClick={() => useLab.getState().toggle("mapOpen")}>
            CLOSE MAP · M
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** a layout cell; double-click a panel header to expand it over the lab, Esc or double-click to restore */
function Slot({ area, className = "", children }: { area: string; className?: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);
  return (
    <div
      className={`area-${area} min-h-0 min-w-0 [&>section]:h-full ${expanded ? "fixed inset-3 z-30 shadow-[0_0_0_100vmax_rgba(0,0,0,0.75)]" : className}`}
      onDoubleClick={(e) => {
        if ((e.target as Element).closest(".panel-header")) setExpanded((v) => !v);
      }}
    >
      {children}
    </div>
  );
}

export default function LabApp() {
  const canvasWrap = useRef<HTMLDivElement>(null);
  useNightVision(canvasWrap);
  const [sceneReady, setSceneReady] = useState(false);
  const [saved, setSaved] = useState<ExperimentSnapshot | null | undefined>(undefined);
  const booted = useLab((s) => s.booted);
  const cinematic = useLab((s) => s.cinematic);
  const mode = useLab((s) => s.mode);
  const n = useLab((s) => s.experimentNumber);
  const seed = useLab((s) => s.seed);
  const [showBoot, setShowBoot] = useState(true);
  useKeyboard();
  useAudio();
  useRecording();
  useAutosave();
  useBackgroundDriver();

  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    if (LIVE) setSaved(null);
    else loadSavedSnapshot().then(setSaved);
  }, []);

  const onReady = useCallback(() => setSceneReady(true), []);
  const onBootDone = useCallback(
    (choice: BootChoice) => {
      const st = useLab.getState();
      st.setBooted();
      setShowBoot(false);
      if (LIVE) {
        // spectators never run their own experiment: mirror the always-on lab server
        st.setRunning(false);
        setConnecting("CONNECTING TO THE LIVE LAB…");
        const attempt = () =>
          pullLive()
            .then(() => {
              setConnecting(null);
              startLiveSync();
            })
            .catch(() => {
              setConnecting("LIVE LAB UNREACHABLE · RETRYING…");
              setTimeout(attempt, 5000);
            });
        attempt();
        return;
      }
      if (choice === "resume" && saved) {
        void resumeExperiment(saved, st.speed, st.catchUp);
      } else {
        void st.saveNow(getExperiment());
      }
    },
    [saved]
  );

  const view = cinematic ? "cinematic" : mode;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-void)] xl:h-screen xl:overflow-hidden">
      <AnimatePresence>
        {!cinematic && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4 }}>
            <TopBar />
          </motion.div>
        )}
      </AnimatePresence>

      <main className={`min-h-0 flex-1 ${cinematic ? "p-0" : "p-[6px]"}`}>
        <div className={`lab-layout layout-${view}`}>
          {/* the 3D viewport stays mounted in every mode */}
          <section className={`area-view relative min-h-[300px] overflow-hidden bg-black ${cinematic ? "fixed inset-0 z-30" : "viewport-frame border border-[var(--color-line)]"}`}>
            <motion.div ref={canvasWrap} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: booted ? 1 : 0 }} transition={{ duration: 2.2, ease: "easeOut" }}>
              <WorldCanvas onReady={onReady} />
            </motion.div>
            {booted && <ViewportHUD compact={!cinematic && mode !== "observe"} />}
            {mode === "observe" && <DiscoveryCard />}
            <DayReportCard />
            <DataPanel />
            <MapOverlay />
            {cinematic && (
              <button className="btn pointer-events-auto absolute bottom-3 left-1/2 z-10 -translate-x-1/2 opacity-0 transition-opacity hover:opacity-100" onClick={() => useLab.getState().toggle("cinematic")}>
                EXIT CINEMATIC · ESC
              </button>
            )}
          </section>

          {view === "observe" && (
            <>
              <Slot area="brain" className="h-[420px] xl:h-auto">
                <BrainPanel />
              </Slot>
              <Slot area="state" className="h-[252px] xl:h-auto">
                <StatePanel />
              </Slot>
              <Slot area="memory" className="h-[252px] xl:h-auto">
                <MemoryPanel />
              </Slot>
              <Slot area="learning" className="h-[252px] xl:h-auto">
                <LearningPanel />
              </Slot>
              <Slot area="timeline" className="h-[220px] xl:h-auto">
                <Timeline />
              </Slot>
              <Slot area="evolution" className="h-[260px] xl:h-auto">
                <EvolutionCharts />
              </Slot>
            </>
          )}

          {view === "neural" && (
            <>
              <Slot area="raster" className="h-[420px] xl:h-auto">
                <SpikeRaster index="N1" />
              </Slot>
              <Slot area="conn" className="h-[340px] xl:h-auto">
                <Connectome index="N2" />
              </Slot>
              <Slot area="inspector" className="h-[380px] xl:h-auto">
                <NeuronInspector index="N3" />
              </Slot>
              <Slot area="place" className="h-[320px] xl:h-auto">
                <PlaceFieldPanel index="N4" />
              </Slot>
              <Slot area="decision" className="h-[300px] xl:h-auto">
                <DecisionSources index="N5" />
              </Slot>
              <Slot area="dopamine" className="h-[200px] xl:h-auto">
                <DopaminePanel index="N6" />
              </Slot>
              <Slot area="replay" className="h-[240px] xl:h-auto">
                <ReplayLog index="N7" />
              </Slot>
            </>
          )}

          {view === "ecology" && (
            <>
              <Slot area="map" className="h-[520px] xl:h-auto">
                <section className="panel flex min-h-0 flex-col">
                  <PanelHeader index="E1" title="STUDY SITE MAP" meta="USGS ELEVATION · OSM · COGNITIVE MAP · CLICK TO INSPECT · SCROLL TO ZOOM" />
                  <div className="relative min-h-0 flex-1">
                    <MapView initialLayers={["cognitive", "memories", "caches", "rivals", "predators", "trail", "events", "names"]} />
                  </div>
                </section>
              </Slot>
              <Slot area="weather" className="h-[240px] xl:h-auto">
                <WeatherPanel index="E2" />
              </Slot>
              <Slot area="pop" className="h-[300px] xl:h-auto">
                <PopulationPanel index="E3" />
              </Slot>
              <Slot area="census" className="h-[300px] xl:h-auto">
                <CensusPanel index="E4" />
              </Slot>
              <Slot area="provenance" className="h-[280px] xl:h-auto">
                <ProvenancePanel index="E5" />
              </Slot>
              <Slot area="journal" className="h-[300px] xl:h-auto">
                <JournalPanel index="E6" />
              </Slot>
            </>
          )}
        </div>
      </main>

      <ArchiveModal />
      <JournalModal />
      <SettingsModal />
      <CommandPalette />
      <CatchUpOverlay />
      {connecting && !showBoot && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80">
          <div className="mono text-[11px] tracking-[0.22em] text-[var(--color-text)]">
            {connecting}
            <span className="blink">_</span>
          </div>
        </div>
      )}
      {showBoot && <BootSequence experimentNumber={n} seed={seed} sceneReady={sceneReady} saved={saved} onDone={onBootDone} />}
    </div>
  );
}
