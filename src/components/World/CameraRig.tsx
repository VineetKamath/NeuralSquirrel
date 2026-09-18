"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Experiment } from "@/simulation/Experiment";
import { useLab } from "@/store/labStore";
import { focus } from "./sharedUniforms";
import { cinematicState } from "./cinematicState";

type ShotKind = "LOW TRACK" | "SIDE DOLLY" | "ORBIT" | "WIDE" | "MACRO" | "HIGH DRONE" | "TREE LINE";

const SHOTS: ShotKind[] = ["LOW TRACK", "ORBIT", "WIDE", "SIDE DOLLY", "MACRO", "HIGH DRONE", "TREE LINE"];

export function CameraRig({ experiment }: { experiment: Experiment }) {
  const cinematic = useLab((s) => s.cinematic);
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const last = useRef(new THREE.Vector3());
  const initialized = useRef(false);
  const director = useRef({
    shot: "LOW TRACK" as ShotKind,
    timer: 0,
    duration: 8,
    anchor: new THREE.Vector3(),
    angle: 0,
    look: new THREE.Vector3(),
    lastEvent: 0,
  });

  useEffect(() => {
    initialized.current = false;
  }, [experiment]);

  useEffect(() => {
    if (!cinematic && controls.current) {
      controls.current.target.copy(focus.position).add(new THREE.Vector3(0, 0.2, 0));
      last.current.copy(focus.position);
    }
    if (cinematic) {
      director.current.timer = 999;
    }
  }, [cinematic]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const cam = camera as THREE.PerspectiveCamera;
    const terrain = experiment.world.terrain;
    if (!focus.initialized) return;

    if (!initialized.current) {
      const h = focus.heading;
      // the subject starts facing away from its nest tree: observe from the open side
      cam.position.set(focus.position.x + Math.sin(h + 0.5) * 3.2, focus.position.y + 1.1, focus.position.z + Math.cos(h + 0.5) * 3.2);
      last.current.copy(focus.position);
      if (controls.current) controls.current.target.copy(focus.position).add(new THREE.Vector3(0, 0.2, 0));
      initialized.current = true;
    }

    if (!cinematic) {
      const delta = new THREE.Vector3().subVectors(focus.position, last.current);
      if (delta.length() > 25) delta.set(0, 0, 0);
      cam.position.add(delta);
      if (controls.current) {
        controls.current.target.add(delta);
        controls.current.update();
      }
      last.current.copy(focus.position);
      cam.fov += (40 - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    } else {
      const d = director.current;
      const events = useLab.getState().events;
      const lastMajor = [...events].reverse().find((e) => e.major);
      d.timer += dt;
      if (lastMajor && lastMajor.id !== d.lastEvent) {
        d.lastEvent = lastMajor.id;
        d.timer = 999;
        d.shot = Math.random() < 0.5 ? "MACRO" : "ORBIT";
      }
      if (d.timer > d.duration) {
        const pose = experiment.agent.state.anim.pose;
        const close = pose === "eat" || pose === "sniff" || pose === "alert" || pose === "dig" || pose === "drink";
        let next = SHOTS[Math.floor(Math.random() * SHOTS.length)];
        if (close && Math.random() < 0.55) next = "MACRO";
        if (d.timer >= 999 && (d.shot === "MACRO" || d.shot === "ORBIT")) next = d.shot;
        d.shot = next;
        d.timer = 0;
        d.duration = 6 + Math.random() * 6;
        d.angle = Math.random() * Math.PI * 2;
        d.anchor.copy(focus.position);
        cinematicState.shot = next;
        cinematicState.cut = true;
      }
      const P = focus.position;
      const h = focus.heading;
      const F = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
      const R = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
      const pos = new THREE.Vector3();
      const look = new THREE.Vector3().copy(P).add(new THREE.Vector3(0, 0.18, 0));
      let fov = 38;
      const tt = d.timer;
      switch (d.shot) {
        case "LOW TRACK":
          pos.copy(P).addScaledVector(F, -1.7).addScaledVector(R, 0.7).add(new THREE.Vector3(0, 0.32, 0));
          look.addScaledVector(F, 0.9);
          fov = 42;
          break;
        case "SIDE DOLLY":
          pos.copy(P).addScaledVector(R, 2.3 - tt * 0.05).addScaledVector(F, 0.4).add(new THREE.Vector3(0, 0.45, 0));
          fov = 34;
          break;
        case "ORBIT": {
          const a = d.angle + tt * 0.18;
          pos.set(P.x + Math.cos(a) * 2.6, P.y + 0.8 + Math.sin(tt * 0.3) * 0.2, P.z + Math.sin(a) * 2.6);
          fov = 36;
          break;
        }
        case "WIDE": {
          const a = d.angle;
          pos.set(d.anchor.x + Math.cos(a) * (15 - tt * 0.25), d.anchor.y + 4.5, d.anchor.z + Math.sin(a) * (15 - tt * 0.25));
          look.y += 0.4;
          fov = 30;
          break;
        }
        case "MACRO":
          pos.copy(P).addScaledVector(F, 0.95).addScaledVector(R, 0.42).add(new THREE.Vector3(0, 0.2, 0));
          look.add(new THREE.Vector3(0, 0.05, 0)).addScaledVector(F, 0.15);
          fov = 26;
          break;
        case "HIGH DRONE": {
          const a = d.angle + tt * 0.04;
          pos.set(P.x + Math.cos(a) * 7, P.y + 13 - tt * 0.2, P.z + Math.sin(a) * 7);
          fov = 40;
          break;
        }
        case "TREE LINE": {
          const a = d.angle;
          pos.set(d.anchor.x + Math.cos(a) * 6, d.anchor.y + 2.4, d.anchor.z + Math.sin(a) * 6);
          fov = 24;
          break;
        }
      }
      const minY = terrain.height(pos.x, pos.z) + 0.15;
      if (pos.y < minY) pos.y = minY;
      if (cinematicState.cut) {
        cam.position.copy(pos);
        d.look.copy(look);
        cam.fov = fov;
        cinematicState.cut = false;
      } else {
        const k = 1 - Math.exp(-dt * (d.shot === "WIDE" || d.shot === "TREE LINE" ? 1.2 : 4));
        cam.position.lerp(pos, k);
        d.look.lerp(look, 1 - Math.exp(-dt * 6));
        cam.fov += (fov - cam.fov) * Math.min(1, dt * 2);
      }
      cam.lookAt(d.look);
      cam.updateProjectionMatrix();
      last.current.copy(focus.position);
    }

    // never below ground
    const gy = terrain.height(cam.position.x, cam.position.z) + 0.12;
    if (cam.position.y < gy) cam.position.y = gy;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={!cinematic}
      enableDamping
      dampingFactor={0.08}
      minDistance={0.7}
      maxDistance={90}
      maxPolarAngle={Math.PI * 0.49}
      enablePan={false}
    />
  );
}
