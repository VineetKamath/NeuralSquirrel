"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useLab } from "@/store/labStore";
import { frameStats, getExperiment, onExperimentChange } from "@/store/runtime";
import type { Experiment } from "@/simulation/Experiment";
import { patchFogChunks } from "./fogChunks";
import { TerrainMesh } from "./Terrain";
import { GroundCover } from "./GroundCover";
import { Vegetation } from "./Vegetation";
import { Props } from "./Props";
import { Food } from "./Food";
import { Water } from "./Water";
import { SkyAndLights } from "./SkyAndLights";
import { Atmosphere } from "./Atmosphere";
import { Overlays3D } from "./Overlays3D";
import { Predators } from "./Predators";
import { CameraRig } from "./CameraRig";
import { SquirrelModel } from "@/components/Squirrel/SquirrelModel";
import { canvasRegistry } from "./canvasRegistry";

patchFogChunks();

/** Advances the simulation in lock-step with rendering and publishes throttled UI snapshots. */
function SimDriver({ experiment }: { experiment: Experiment }) {
  const timers = useRef({ publish: 0, slow: 0, persist: 0, fps: 0, frames: 0 });
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    canvasRegistry.canvas = gl.domElement;
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __lab: unknown }).__lab = { experiment, gl, scene, camera, store: useLab };
    }
  }, [gl, scene, camera, experiment]);

  useFrame((_, dt) => {
    const store = useLab.getState();
    const t = timers.current;
    if (store.booted && store.running && !store.catchingUp) {
      frameStats.steps = experiment.advance(dt, store.speed);
    }
    t.frames++;
    t.fps += dt;
    if (t.fps >= 0.5) {
      frameStats.fps = t.frames / t.fps;
      t.frames = 0;
      t.fps = 0;
    }
    t.publish += dt;
    t.slow += dt;
    t.persist += dt;
    if (t.publish > 0.12) {
      t.publish = 0;
      store.publish(experiment);
    }
    if (t.slow > 1) {
      t.slow = 0;
      store.publishSlow(experiment);
    }
    if (t.persist > 15) {
      t.persist = 0;
      store.persist(experiment);
    }
  }, -1);
  return null;
}

/** re-render when the world's physical structure changes (storm-felled trees) */
function useStructureVersion(experiment: Experiment) {
  const [v, setV] = useState(experiment.world.state.structureVersion);
  useEffect(() => {
    const id = setInterval(() => {
      const nv = experiment.world.state.structureVersion;
      setV((old) => (old === nv ? old : nv));
    }, 1000);
    return () => clearInterval(id);
  }, [experiment]);
  return v;
}

function ReadySignal({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current++;
    if (frames.current === 4) onReady?.();
  });
  return null;
}

function Scene({ experiment, onReady }: { experiment: Experiment; onReady?: () => void }) {
  const overlays = useLab((s) => s.overlays);
  const cinematic = useLab((s) => s.cinematic);
  const structure = useStructureVersion(experiment);
  return (
    <>
      <SimDriver experiment={experiment} />
      <ReadySignal onReady={onReady} />
      <SkyAndLights experiment={experiment} />
      <TerrainMesh world={experiment.world} />
      <GroundCover world={experiment.world} />
      <Vegetation world={experiment.world} version={structure} />
      <Props world={experiment.world} version={structure} />
      <Water experiment={experiment} />
      <Food experiment={experiment} />
      <SquirrelModel experiment={experiment} />
      <Predators experiment={experiment} />
      <Atmosphere experiment={experiment} />
      <Overlays3D experiment={experiment} visible={overlays && !cinematic} />
      <CameraRig experiment={experiment} />
    </>
  );
}

export default function WorldCanvas({ onReady }: { onReady?: () => void }) {
  const [experiment, setExperiment] = useState<Experiment>(() => getExperiment());
  const version = useLab((s) => s.version);
  const quality = useLab((s) => s.quality);
  const dpr: [number, number] = quality === "low" ? [0.7, 1] : quality === "medium" ? [1, 1.25] : [1, 1.5];

  useEffect(() => onExperimentChange((e) => setExperiment(e)), []);

  return (
    <Canvas
      shadows={quality !== "low"}
      dpr={dpr}
      camera={{ fov: 40, near: 0.03, far: 900, position: [0, 3, 6] }}
      gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.85;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <Suspense fallback={null}>
        <Scene key={`${experiment.seed}-${experiment.number}-${version}`} experiment={experiment} onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}
