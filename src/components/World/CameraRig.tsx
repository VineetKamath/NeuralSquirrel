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

type ShotKind = "LOW TRACK" | "SIDE DOLLY" | "ORBIT" | "WIDE" | "MACRO" | "HIGH DRONE" | "TREE LINE" | "CANOPY" | "NEST WATCH" | "PURSUIT";

/** ground shots rotated through while the subject is on the ground */
const GROUND_SHOTS: ShotKind[] = ["LOW TRACK", "ORBIT", "WIDE", "SIDE DOLLY", "MACRO", "HIGH DRONE", "TREE LINE"];

type Context = "ground" | "tree" | "drey" | "flee" | "dead";

const TREE_KINDS = new Set(["oak", "pine", "birch"]);

/** true if the straight line from camera to subject is not blocked by a trunk, rock, log, building or the ground */
function lineOfSight(experiment: Experiment, from: THREE.Vector3, to: THREE.Vector3) {
  const world = experiment.world;
  const site = world.terrain.site;
  const steps = Math.max(4, Math.ceil(from.distanceTo(to) / 0.4));
  const near = world.objectsNear((from.x + to.x) / 2, (from.z + to.z) / 2, from.distanceTo(to) / 2 + 4);
  const climbTree = experiment.agent.state.anim.climbTreeId;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    if (y < world.terrain.height(x, z) + 0.05) return false;
    if (site.isBlocked(x, z) && !site.isWater(x, z)) return false;
    for (const o of near) {
      if (o.fallen) continue;
      const d = Math.hypot(o.position.x - x, o.position.z - z);
      if (TREE_KINDS.has(o.kind)) {
        // trunk (the subject's own tree is fine near the end of the line)
        if (d < o.radius + 0.2 && y < o.position.y + o.height * 0.55 && !(o.id === climbTree && t > 0.85)) return false;
        // crown: dense foliage above ~3.5 m
        if (y > o.position.y + 3.5 * o.scale && d < 2.4 * o.scale && t < 0.8) return false;
      } else if ((o.kind === "rock" || o.kind === "log" || o.kind === "stump" || o.kind === "bush") && d < o.radius + 0.1 && y < o.position.y + o.radius * 1.4) return false;
    }
  }
  return true;
}

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
    blocked: 0,
    side: 1,
    offset: 0,
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
      // start with an immediate cut
      director.current.timer = 999;
      director.current.blocked = 0;
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
      const s = experiment.agent.state;
      const anim = s.anim;
      const tree = anim.climbTreeId ? experiment.world.state.objects.find((o) => o.id === anim.climbTreeId) : undefined;
      const context: Context = !s.alive
        ? "dead"
        : anim.hidden && anim.pose === "sleep" && anim.climbHeight > 4
          ? "drey"
          : anim.climbHeight > 1.2 && tree
            ? "tree"
            : s.currentGoal?.type === "FLEE"
              ? "flee"
              : "ground";
      const events = useLab.getState().events;
      const lastMajor = [...events].reverse().find((e) => e.major);
      d.timer += dt;
      let forced: ShotKind | null = null;
      if (lastMajor && lastMajor.id !== d.lastEvent) {
        d.lastEvent = lastMajor.id;
        if (context === "ground") forced = Math.random() < 0.5 ? "MACRO" : "ORBIT";
      }
      const contextShot: Record<Exclude<Context, "ground">, ShotKind> = { tree: "CANOPY", drey: "NEST WATCH", flee: "PURSUIT", dead: "WIDE" };
      const wanted = context === "ground" ? null : contextShot[context];
      const wrongContext = (wanted && d.shot !== wanted) || (!wanted && (d.shot === "CANOPY" || d.shot === "NEST WATCH" || d.shot === "PURSUIT"));
      // cut when the shot ends, the situation changes, or the view has been blocked for a moment
      if (d.timer > d.duration || forced || wrongContext || d.blocked > 0.7) {
        const close = anim.pose === "eat" || anim.pose === "sniff" || anim.pose === "alert" || anim.pose === "dig" || anim.pose === "drink";
        let next: ShotKind = wanted ?? GROUND_SHOTS[Math.floor(Math.random() * GROUND_SHOTS.length)];
        if (!wanted && close && Math.random() < 0.55) next = "MACRO";
        if (!wanted && forced) next = forced;
        if (!wanted && next === d.shot && d.blocked > 0.7) next = "HIGH DRONE";
        d.shot = next;
        d.timer = 0;
        d.duration = next === "NEST WATCH" ? 18 : 6 + Math.random() * 6;
        d.angle = Math.random() * Math.PI * 2;
        d.anchor.copy(focus.position);
        d.blocked = 0;
        d.side = Math.random() < 0.5 ? 1 : -1;
        d.offset = 0;
        cinematicState.shot = next;
        cinematicState.cut = true;
      }
      const P = focus.position;
      const h = focus.heading;
      const tt = d.timer;
      const look = new THREE.Vector3().copy(P).add(new THREE.Vector3(0, 0.18, 0));
      let fov = 38;
      // camera placement for a shot, rotated by `rot` around the subject when the first choice is blocked
      const place = (rot: number, pull: number) => {
        const hh = h + rot;
        const F = new THREE.Vector3(Math.sin(hh), 0, Math.cos(hh));
        const R = new THREE.Vector3(Math.cos(hh), 0, -Math.sin(hh)).multiplyScalar(d.side);
        const pos = new THREE.Vector3();
        switch (d.shot) {
          case "LOW TRACK":
            pos.copy(P).addScaledVector(F, -1.7 * pull).addScaledVector(R, 0.7).add(new THREE.Vector3(0, 0.32, 0));
            fov = 42;
            break;
          case "SIDE DOLLY":
            pos.copy(P).addScaledVector(R, (2.3 - tt * 0.05) * pull).addScaledVector(F, 0.4).add(new THREE.Vector3(0, 0.45, 0));
            fov = 34;
            break;
          case "ORBIT": {
            const a = d.angle + rot + tt * 0.18;
            pos.set(P.x + Math.cos(a) * 2.6 * pull, P.y + 0.8 + Math.sin(tt * 0.3) * 0.2, P.z + Math.sin(a) * 2.6 * pull);
            fov = 36;
            break;
          }
          case "WIDE": {
            const a = d.angle + rot;
            const r = (15 - tt * 0.25) * pull;
            pos.set(d.anchor.x + Math.cos(a) * r, d.anchor.y + 4.5, d.anchor.z + Math.sin(a) * r);
            fov = 30;
            break;
          }
          case "MACRO":
            pos.copy(P).addScaledVector(F, 0.95 * pull).addScaledVector(R, 0.42).add(new THREE.Vector3(0, 0.2, 0));
            fov = 26;
            break;
          case "HIGH DRONE": {
            const a = d.angle + rot + tt * 0.04;
            pos.set(P.x + Math.cos(a) * 7 * pull, P.y + 13 - tt * 0.2, P.z + Math.sin(a) * 7 * pull);
            fov = 40;
            break;
          }
          case "TREE LINE": {
            const a = d.angle + rot;
            pos.set(d.anchor.x + Math.cos(a) * 6 * pull, d.anchor.y + 2.4, d.anchor.z + Math.sin(a) * 6 * pull);
            fov = 24;
            break;
          }
          case "CANOPY": {
            // level with the subject on the trunk, a few metres out
            const c = tree ? tree.position : P;
            const out = new THREE.Vector3(P.x - c.x, 0, P.z - c.z);
            if (out.lengthSq() < 1e-4) out.set(Math.sin(h), 0, Math.cos(h));
            out.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5 * d.side + rot + Math.sin(tt * 0.2) * 0.25);
            pos.copy(P).addScaledVector(out, 3.4 * pull).add(new THREE.Vector3(0, 0.35, 0));
            fov = 36;
            break;
          }
          case "NEST WATCH": {
            // the drey from below, framing the nest tree against the sky
            const c = tree ? tree.position : P;
            const a = d.angle + rot + tt * 0.02;
            const r = 9 * pull;
            pos.set(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
            pos.y = experiment.world.terrain.height(pos.x, pos.z) + 1.7;
            look.set(c.x, P.y + 0.3, c.z);
            fov = 42;
            break;
          }
          case "PURSUIT":
            pos.copy(P).addScaledVector(F, -3.4 * pull).add(new THREE.Vector3(0, 1.3, 0));
            look.addScaledVector(F, 2);
            fov = 50;
            break;
        }
        if (d.shot === "LOW TRACK") look.addScaledVector(F, 0.9);
        if (d.shot === "MACRO") look.add(new THREE.Vector3(0, 0.05, 0)).addScaledVector(F, 0.15);
        if (d.shot === "WIDE") look.y += 0.4;
        const minY = terrain.height(pos.x, pos.z) + 0.15;
        if (pos.y < minY) pos.y = minY;
        return pos;
      };
      // keep the subject in view: try the planned framing, then rotate around and move in
      let pos = place(d.offset, 1);
      const target = look.clone();
      if (!lineOfSight(experiment, pos, target)) {
        let found = false;
        for (const pull of [1, 0.7, 0.45]) {
          for (const rot of [0.5, -0.5, 1.1, -1.1, 1.8, -1.8, Math.PI]) {
            const cand = place(d.offset + rot, pull);
            if (lineOfSight(experiment, cand, target)) {
              pos = cand;
              d.offset += rot;
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (!found) d.blocked += dt;
      } else d.blocked = Math.max(0, d.blocked - dt);
      if (cinematicState.cut) {
        cam.position.copy(pos);
        d.look.copy(look);
        cam.fov = fov;
        cinematicState.cut = false;
      } else {
        const slow = d.shot === "WIDE" || d.shot === "TREE LINE" || d.shot === "NEST WATCH";
        const k = 1 - Math.exp(-dt * (slow ? 1.2 : d.shot === "PURSUIT" ? 5 : 4));
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
