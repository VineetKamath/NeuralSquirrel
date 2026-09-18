"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Experiment } from "@/simulation/Experiment";
import type { Threat } from "@/types";
import { damp, dampAngle } from "@/utils/math";
import { createFurMaterial, furMesh, paintCoat } from "@/components/Squirrel/furMaterial";

function ellipsoid(rx: number, ry: number, rz: number, w = 20, h = 14) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

/** off-leash dogs: the main ground predator pressure on Central Park squirrels (coats vary by dog) */
const COATS = [
  ["#8a6a42", "#d8c4a0", "#5a4228"],
  ["#1e1a18", "#6a625a", "#141110"],
  ["#c49a52", "#ecd8a8", "#9a7438"],
  ["#6a4a34", "#e8e0d4", "#3c2a1e"],
];

function buildDog(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const coat = COATS[h % COATS.length];
  const orange = new THREE.Color(coat[0]);
  const cream = new THREE.Color(coat[1]);
  const darkOrange = new THREE.Color(coat[2]);
  const fur = createFurMaterial({ length: 0.018, density: 60, gravity: 0.5 });
  const tailFur = createFurMaterial({ length: 0.05, density: 40, gravity: 0.4 });
  const legMat = new THREE.MeshStandardMaterial({ color: "#1c130e", roughness: 0.9 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: "#0a0806", roughness: 0.1 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.4;
  root.add(body);
  body.add(furMesh(paintCoat(ellipsoid(0.12, 0.13, 0.3), orange, cream, darkOrange), fur.material));
  const neck = furMesh(paintCoat(ellipsoid(0.09, 0.11, 0.12), orange, cream, orange), fur.material);
  neck.position.set(0, 0.07, 0.26);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.14, 0.36);
  body.add(head);
  head.add(furMesh(paintCoat(ellipsoid(0.075, 0.07, 0.08), orange, cream, orange), fur.material));
  const snoutGeo = paintCoat(new THREE.ConeGeometry(0.045, 0.14, 12), orange, cream, orange);
  snoutGeo.rotateX(Math.PI / 2);
  const snout = new THREE.Mesh(snoutGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  snout.position.set(0, -0.02, 0.12);
  head.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), legMat);
  nose.position.set(0, -0.015, 0.19);
  head.add(nose);
  for (const side of [-1, 1]) {
    // floppy dog ears
    const ear = new THREE.Mesh(ellipsoid(0.02, 0.055, 0.035), new THREE.MeshStandardMaterial({ color: darkOrange, roughness: 0.9 }));
    ear.position.set(side * 0.065, 0.02, -0.01);
    ear.rotation.z = side * 0.35;
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), eyeMat);
    eye.position.set(side * 0.04, 0.02, 0.06);
    head.add(eye);
  }
  const legs: THREE.Group[] = [];
  const legGeo = new THREE.CylinderGeometry(0.022, 0.016, 0.34, 8);
  legGeo.translate(0, -0.17, 0);
  for (const [x, z] of [
    [-0.07, 0.2],
    [0.07, 0.2],
    [-0.07, -0.2],
    [0.07, -0.2],
  ]) {
    const leg = new THREE.Group();
    leg.position.set(x, -0.04, z);
    leg.add(new THREE.Mesh(legGeo, legMat));
    body.add(leg);
    legs.push(leg);
  }
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  const radii = [0.05, 0.07, 0.085, 0.09, 0.085, 0.06];
  for (let i = 0; i < radii.length; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.02 : 0, i === 0 ? -0.3 : -0.08);
    parent.add(seg);
    const geo = ellipsoid(radii[i], radii[i] * 0.9, 0.07, 14, 10);
    geo.translate(0, 0, -0.04);
    const tip = i === radii.length - 1;
    paintCoat(geo, tip ? cream : orange, tip ? cream : darkOrange, tip ? cream : orange);
    seg.add(furMesh(geo, tailFur.material));
    tail.push(seg);
    parent = seg;
  }
  root.traverse((o) => (o.castShadow = true));
  return { root, body, head, legs, tail };
}

function buildHawk() {
  // red-tailed hawk (Buteo jamaicensis), resident in Central Park
  const brown = new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 0.85, side: THREE.DoubleSide });
  const rufous = new THREE.MeshStandardMaterial({ color: "#a4502a", roughness: 0.85, side: THREE.DoubleSide });
  const pale = new THREE.MeshStandardMaterial({ color: "#b9a488", roughness: 0.9 });
  const root = new THREE.Group();
  const body = new THREE.Mesh(ellipsoid(0.1, 0.09, 0.28), brown);
  root.add(body);
  const belly = new THREE.Mesh(ellipsoid(0.085, 0.07, 0.22), pale);
  belly.position.y = -0.03;
  root.add(belly);
  const head = new THREE.Mesh(ellipsoid(0.06, 0.06, 0.07), brown);
  head.position.set(0, 0.03, 0.28);
  root.add(head);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.12);
  wingShape.quadraticCurveTo(0.5, 0.2, 0.95, 0.02);
  wingShape.lineTo(0.9, -0.08);
  wingShape.quadraticCurveTo(0.5, -0.2, 0, -0.14);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 12);
  wingGeo.rotateX(-Math.PI / 2);
  const wings: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.06, 0.03, 0.02);
    const w = new THREE.Mesh(wingGeo, brown);
    w.scale.set(side, 1, 1);
    pivot.add(w);
    root.add(pivot);
    wings.push(pivot);
  }
  const tailShape = new THREE.Shape();
  tailShape.moveTo(-0.04, 0);
  tailShape.lineTo(0.04, 0);
  tailShape.lineTo(0.1, -0.28);
  tailShape.lineTo(-0.1, -0.28);
  const tailGeo = new THREE.ShapeGeometry(tailShape);
  tailGeo.rotateX(-Math.PI / 2);
  const tail = new THREE.Mesh(tailGeo, rufous);
  tail.position.set(0, 0, -0.24);
  root.add(tail);
  root.traverse((o) => (o.castShadow = true));
  root.scale.setScalar(1.3);
  return { root, wings };
}

function Dog({ threat }: { threat: Threat }) {
  const fox = useMemo(() => buildDog(threat.id), []);
  const s = useRef({ pos: new THREE.Vector3(threat.position.x, threat.position.y, threat.position.z), heading: threat.heading, lie: 0, t: 0 });
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = s.current;
    st.t += dt;
    const target = new THREE.Vector3(threat.position.x, threat.position.y, threat.position.z);
    if (st.pos.distanceTo(target) > 6) st.pos.copy(target);
    st.pos.x = damp(st.pos.x, target.x, 12, dt);
    st.pos.y = damp(st.pos.y, target.y, 12, dt);
    st.pos.z = damp(st.pos.z, target.z, 12, dt);
    st.heading = dampAngle(st.heading, threat.heading, 8, dt);
    fox.root.position.copy(st.pos);
    fox.root.rotation.y = st.heading;
    const resting = threat.state === "rest";
    st.lie = damp(st.lie, resting ? 1 : 0, 3, dt);
    const sp = threat.speed;
    const phase = threat.gait * Math.PI * 2;
    const amp = Math.min(1, sp / 3) * 0.7;
    fox.legs.forEach((leg, i) => {
      const diag = i === 0 || i === 3 ? 0 : Math.PI;
      leg.rotation.x = Math.sin(phase + diag) * amp * (1 - st.lie) + st.lie * (i < 2 ? -1.3 : 1.3);
    });
    fox.body.position.y = 0.4 - st.lie * 0.26 + Math.abs(Math.sin(phase)) * 0.03 * amp;
    fox.body.rotation.x = threat.state === "stalk" ? 0.08 : 0;
    fox.head.rotation.x = threat.state === "stalk" ? 0.35 : resting ? 0.5 : Math.sin(st.t * 0.6) * 0.1;
    fox.head.rotation.y = resting ? 0.6 : Math.sin(st.t * 0.4) * 0.2;
    fox.tail.forEach((seg, i) => {
      seg.rotation.x = (i === 0 ? -0.5 : 0.08) + Math.sin(st.t * 3 + i * 0.6) * 0.05;
      seg.rotation.y = Math.sin(st.t * 2 + i * 0.5) * 0.08 + (resting ? 0.25 : 0);
    });
  });
  return <primitive object={fox.root} />;
}

function Hawk({ threat }: { threat: Threat }) {
  const hawk = useMemo(() => buildHawk(), []);
  const s = useRef({ pos: new THREE.Vector3(), init: false, t: 0, bank: 0 });
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = s.current;
    st.t += dt;
    hawk.root.visible = threat.active;
    if (!threat.active) {
      st.init = false;
      return;
    }
    const target = new THREE.Vector3(threat.position.x, threat.position.y, threat.position.z);
    if (!st.init || st.pos.distanceTo(target) > 15) {
      st.pos.copy(target);
      st.init = true;
    }
    const prev = st.pos.clone();
    st.pos.lerp(target, 1 - Math.exp(-dt * 8));
    const v = st.pos.clone().sub(prev);
    hawk.root.position.copy(st.pos);
    if (v.lengthSq() > 1e-6) {
      const yaw = Math.atan2(v.x, v.z);
      hawk.root.rotation.y = dampAngle(hawk.root.rotation.y, yaw, 4, dt);
      hawk.root.rotation.x = damp(hawk.root.rotation.x, -Math.atan2(v.y, Math.hypot(v.x, v.z)) * 0.8, 4, dt);
    }
    const diving = threat.state === "dive";
    st.bank = damp(st.bank, diving ? 0 : -0.35, 2, dt);
    hawk.root.rotation.z = st.bank;
    const flap = diving ? 0 : Math.max(0, Math.sin(st.t * 0.35)) > 0.85 ? Math.sin(st.t * 9) * 0.5 : Math.sin(st.t * 1.2) * 0.04;
    hawk.wings.forEach((w, i) => {
      const side = i === 0 ? -1 : 1;
      w.rotation.z = diving ? side * -1.1 : side * (0.1 + flap);
    });
  });
  return <primitive object={hawk.root} />;
}

export function Predators({ experiment }: { experiment: Experiment }) {
  const threats = experiment.world.state.threats;
  return (
    <group>
      {threats.map((t) => (t.kind === "dog" ? <Dog key={t.id} threat={t} /> : <Hawk key={t.id} threat={t} />))}
    </group>
  );
}
