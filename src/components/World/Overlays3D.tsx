"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Experiment } from "@/simulation/Experiment";
import { focus } from "./sharedUniforms";

const MEM_COLORS: Record<string, THREE.Color> = {
  food: new THREE.Color("#e8b36a"),
  danger: new THREE.Color("#ff5f4f"),
  landmark: new THREE.Color("#cfd8d4"),
  environment: new THREE.Color("#7fb7e8"),
  navigation: new THREE.Color("#8fe3c4"),
  social: new THREE.Color("#b69cf2"),
};

const TRAIL = 240;
const MAX_BEACONS = 120;

/** Research overlays drawn inside the world: subject ring, goal vector, memory beacons, trail. */
export function Overlays3D({ experiment, visible }: { experiment: Experiment; visible: boolean }) {
  const parts = useMemo(() => {
    const group = new THREE.Group();
    const lineMat = (color: string, opacity: number) =>
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false });

    // subject ring with ticks
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55));
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), lineMat("#8fe3c4", 0.55));
    const tickPts: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      tickPts.push(new THREE.Vector3(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62), new THREE.Vector3(Math.cos(a) * 0.78, 0, Math.sin(a) * 0.78));
    }
    const ticks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), lineMat("#8fe3c4", 0.7));
    const subject = new THREE.Group();
    subject.add(ring, ticks);
    group.add(subject);

    // perception radius
    const visPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      visPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const vision = new THREE.Line(new THREE.BufferGeometry().setFromPoints(visPts), lineMat("#cfd8d4", 0.12));
    group.add(vision);

    // goal vector
    const goalGeo = new THREE.BufferGeometry();
    goalGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const goalLine = new THREE.Line(goalGeo, new THREE.LineDashedMaterial({ color: "#8fe3c4", dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.6, fog: false }));
    group.add(goalLine);
    const markerGeo = new THREE.OctahedronGeometry(0.12, 0);
    const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: "#8fe3c4", wireframe: true, transparent: true, opacity: 0.85, fog: false }));
    group.add(marker);
    const markerPole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1.4, 0)]), lineMat("#8fe3c4", 0.35));
    group.add(markerPole);

    // trail
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    trailGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
    trail.frustumCulled = false;
    group.add(trail);

    // memory beacons: vertical lines with intensity by strength
    const beaconGeo = new THREE.BufferGeometry();
    beaconGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_BEACONS * 6), 3));
    beaconGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_BEACONS * 6), 3));
    const beacons = new THREE.LineSegments(beaconGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    beacons.frustumCulled = false;
    group.add(beacons);

    // threat bracket
    const bracketPts: THREE.Vector3[] = [];
    const b = 0.7;
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      bracketPts.push(new THREE.Vector3(sx * b, 0, sz * b), new THREE.Vector3(sx * b * 0.55, 0, sz * b));
      bracketPts.push(new THREE.Vector3(sx * b, 0, sz * b), new THREE.Vector3(sx * b, 0, sz * b * 0.55));
    }
    const bracket = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(bracketPts), lineMat("#ff5f4f", 0.9));
    group.add(bracket);

    group.renderOrder = 10;
    group.traverse((o) => (o.renderOrder = 10));
    return { group, subject, vision, goalLine, marker, markerPole, trail, beacons, bracket, trailIndex: 0, trailTimer: 0, trailFilled: 0 };
  }, []);

  useFrame((state, dt) => {
    const p = parts;
    p.group.visible = visible;
    if (!visible) return;
    const agent = experiment.agent;
    const s = agent.state;
    const t = state.clock.elapsedTime;
    const w = experiment.world;

    p.subject.position.set(focus.position.x, focus.position.y + 0.03, focus.position.z);
    p.subject.rotation.y = t * 0.4;
    p.subject.scale.setScalar(1 + Math.sin(t * 2) * 0.03);

    const vr = agent.perception?.visionRange ?? 10;
    p.vision.position.set(focus.position.x, focus.position.y + 0.05, focus.position.z);
    p.vision.scale.set(vr, 1, vr);

    const g = s.currentGoal;
    const show = !!g?.target;
    p.goalLine.visible = p.marker.visible = p.markerPole.visible = show;
    if (g?.target) {
      const ty = w.terrain.height(g.target.x, g.target.z);
      const pos = p.goalLine.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, focus.position.x, focus.position.y + 0.12, focus.position.z);
      pos.setXYZ(1, g.target.x, ty + 0.12, g.target.z);
      pos.needsUpdate = true;
      p.goalLine.computeLineDistances();
      p.marker.position.set(g.target.x, ty + 1.45 + Math.sin(t * 2) * 0.05, g.target.z);
      p.marker.rotation.y = t;
      p.markerPole.position.set(g.target.x, ty, g.target.z);
      const col = g.type === "FLEE" || g.type === "HIDE" ? "#ff5f4f" : g.memoryId ? "#e8b36a" : "#8fe3c4";
      (p.marker.material as THREE.MeshBasicMaterial).color.set(col);
      (p.goalLine.material as THREE.LineDashedMaterial).color.set(col);
    }

    // trail
    p.trailTimer += dt;
    if (p.trailTimer > 0.25) {
      p.trailTimer = 0;
      const pos = p.trail.geometry.attributes.position as THREE.BufferAttribute;
      const col = p.trail.geometry.attributes.color as THREE.BufferAttribute;
      // shift
      for (let i = TRAIL - 1; i > 0; i--) {
        pos.setXYZ(i, pos.getX(i - 1), pos.getY(i - 1), pos.getZ(i - 1));
      }
      pos.setXYZ(0, focus.position.x, focus.position.y + 0.05, focus.position.z);
      p.trailFilled = Math.min(TRAIL, p.trailFilled + 1);
      for (let i = 0; i < TRAIL; i++) {
        const k = i < p.trailFilled ? Math.pow(1 - i / TRAIL, 1.5) : 0;
        col.setXYZ(i, 0.56 * k, 0.89 * k, 0.77 * k);
      }
      if (p.trailFilled < TRAIL) {
        for (let i = p.trailFilled; i < TRAIL; i++) pos.setXYZ(i, focus.position.x, focus.position.y + 0.05, focus.position.z);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }

    // memory beacons
    const mems = experiment.ctx.memory.memories;
    const bpos = p.beacons.geometry.attributes.position as THREE.BufferAttribute;
    const bcol = p.beacons.geometry.attributes.color as THREE.BufferAttribute;
    let n = 0;
    for (const m of mems) {
      if (n >= MAX_BEACONS) break;
      const y = w.terrain.height(m.location.x, m.location.z);
      const strength = Math.min(1, m.importance * (0.4 + m.confidence));
      const h = 0.6 + strength * 3.2;
      const c = MEM_COLORS[m.type] ?? MEM_COLORS.landmark;
      const pulse = 0.75 + Math.sin(t * 2 + n) * 0.25;
      bpos.setXYZ(n * 2, m.location.x, y, m.location.z);
      bpos.setXYZ(n * 2 + 1, m.location.x, y + h, m.location.z);
      bcol.setXYZ(n * 2, c.r * strength, c.g * strength, c.b * strength);
      bcol.setXYZ(n * 2 + 1, c.r * 0.05 * pulse, c.g * 0.05, c.b * 0.05);
      n++;
    }
    p.beacons.geometry.setDrawRange(0, n * 2);
    bpos.needsUpdate = true;
    bcol.needsUpdate = true;

    const threat = agent.perception?.threats[0]?.threat;
    p.bracket.visible = !!threat && threat.kind === "dog";
    if (threat) {
      p.bracket.position.set(threat.position.x, threat.position.y + 0.05, threat.position.z);
      p.bracket.rotation.y = t * 0.8;
    }
  });

  return <primitive object={parts.group} />;
}
