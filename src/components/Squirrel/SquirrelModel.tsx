"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Experiment } from "@/simulation/Experiment";
import type { AnimationState, Pose, Vector3 } from "@/types";
import { damp, dampAngle } from "@/utils/math";
import { mulberry32 } from "@/utils/rng";
import { createFurMaterial, furMesh, paintCoat } from "./furMaterial";
import { focus } from "@/components/World/sharedUniforms";
import { useLab } from "@/store/labStore";

const SCALE = 1.35;
const TAIL_SEGMENTS = 10;
const TAIL_RADII = [0.02, 0.028, 0.036, 0.043, 0.048, 0.051, 0.051, 0.048, 0.041, 0.03];

interface PoseParams {
  bodyY: number;
  bodyPitch: number;
  headPitch: number;
  shoulder: number;
  elbow: number;
  hip: number;
  knee: number;
  tail: number[];
}

function ellipsoid(rx: number, ry: number, rz: number, w = 24, h = 16) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

function capsule(r: number, len: number) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, -len / 2 - r * 0.5, 0);
  return g;
}

const TAIL_STAND = [0.42, 0.42, 0.38, 0.28, 0.08, -0.14, -0.3, -0.36, -0.32, -0.2];
const TAIL_ALERT = [0.75, 0.55, 0.32, 0.12, -0.02, -0.12, -0.22, -0.3, -0.34, -0.3];
const TAIL_RUN = [0.2, 0.12, 0.06, 0.02, 0, -0.02, -0.04, -0.06, -0.08, -0.08];
const TAIL_SLEEP = [0.7, 0.62, 0.58, 0.55, 0.52, 0.48, 0.42, 0.36, 0.3, 0.22];
const TAIL_CLIMB = [-0.25, -0.12, -0.05, 0, 0.02, 0.04, 0.05, 0.05, 0.05, 0.04];
const TAIL_LOW = [0.3, 0.28, 0.2, 0.1, 0, -0.1, -0.16, -0.2, -0.2, -0.16];

function targetPose(pose: Pose, t: number, gait: number, speed: number, climbingDown: boolean): PoseParams {
  const phi = gait * Math.PI * 2;
  switch (pose) {
    case "walk":
    case "run": {
      const k = Math.min(1, speed / 3.5);
      const bound = Math.sin(phi);
      return {
        bodyY: 0.08 + Math.max(0, bound) * 0.05 * k + Math.abs(bound) * 0.008,
        bodyPitch: -0.06 + bound * 0.22 * (0.4 + k * 0.6),
        headPitch: -bound * 0.12 - 0.05,
        shoulder: Math.sin(phi + Math.PI * 0.9) * (0.6 + k * 0.5),
        elbow: -0.3 - Math.max(0, Math.sin(phi + Math.PI * 0.4)) * 0.8,
        hip: Math.sin(phi) * (0.7 + k * 0.5),
        knee: 0.4 + Math.max(0, -Math.sin(phi)) * 0.9,
        tail: TAIL_RUN.map((v, i) => v + Math.sin(phi - i * 0.55) * 0.07 * (0.5 + k)),
      };
    }
    case "alert":
      return {
        bodyY: 0.075,
        bodyPitch: -1.05,
        headPitch: 0.95,
        shoulder: -1.5,
        elbow: -1.3,
        hip: 0.9,
        knee: 1.3,
        tail: TAIL_ALERT.map((v, i) => v + Math.sin(t * 1.3 - i * 0.4) * 0.03),
      };
    case "sit":
      return {
        bodyY: 0.07,
        bodyPitch: -0.75,
        headPitch: 0.62,
        shoulder: -0.9,
        elbow: -0.9,
        hip: 0.9,
        knee: 1.3,
        tail: TAIL_ALERT.map((v, i) => v * 0.9 + Math.sin(t * 1.1 - i * 0.4) * 0.03),
      };
    case "eat":
      return {
        bodyY: 0.07,
        bodyPitch: -0.95,
        headPitch: 1.05 + Math.sin(t * 17) * 0.07,
        shoulder: -2.2 + Math.sin(t * 9) * 0.1,
        elbow: -1.6,
        hip: 0.95,
        knee: 1.35,
        tail: TAIL_ALERT.map((v, i) => v + Math.sin(t * 1.5 - i * 0.5) * 0.03),
      };
    case "sniff":
      return {
        bodyY: 0.068,
        bodyPitch: 0.22,
        headPitch: 0.35 + Math.sin(t * 22) * 0.04,
        shoulder: 0.25,
        elbow: -0.4,
        hip: 0.35,
        knee: 0.9,
        tail: TAIL_LOW.map((v, i) => v + Math.sin(t * 2 - i * 0.5) * 0.04),
      };
    case "dig":
      return {
        bodyY: 0.064,
        bodyPitch: 0.4,
        headPitch: 0.25,
        shoulder: 0.5 + Math.sin(t * 26) * 0.7,
        elbow: -0.6 + Math.sin(t * 26 + 1.5) * 0.5,
        hip: 0.5,
        knee: 1.0,
        tail: TAIL_STAND.map((v, i) => v + Math.sin(t * 6 - i * 0.6) * 0.06),
      };
    case "drink":
      return {
        bodyY: 0.062,
        bodyPitch: 0.5,
        headPitch: 0.35 + Math.sin(t * 8) * 0.05,
        shoulder: 0.5,
        elbow: -0.9,
        hip: 0.45,
        knee: 1.1,
        tail: TAIL_LOW,
      };
    case "sleep":
      return {
        bodyY: 0.045 + Math.sin(t * 1.4) * 0.002,
        bodyPitch: 0.25,
        headPitch: 0.75,
        shoulder: 1.1,
        elbow: -2.2,
        hip: -0.6,
        knee: 2.0,
        tail: TAIL_SLEEP,
      };
    case "climb": {
      const moving = speed > 0.2;
      const s = Math.sin(t * 14);
      return {
        bodyY: 0.03,
        bodyPitch: climbingDown ? 1.45 : -1.45,
        headPitch: climbingDown ? -0.6 : 0.2,
        shoulder: moving ? s * 0.7 - 0.4 : -0.5,
        elbow: -0.5,
        hip: moving ? -s * 0.7 + 0.2 : 0.3,
        knee: 0.7,
        tail: climbingDown ? TAIL_STAND.map((v) => -v * 0.4) : TAIL_CLIMB,
      };
    }
    default:
      return {
        bodyY: 0.08,
        bodyPitch: -0.15 + Math.sin(t * 0.9) * 0.02,
        headPitch: 0.05 + Math.sin(t * 0.7) * 0.05,
        shoulder: 0.05,
        elbow: -0.2,
        hip: 0.4,
        knee: 0.9,
        tail: TAIL_STAND.map((v, i) => v + Math.sin(t * 1.2 - i * 0.45) * 0.035),
      };
  }
}

/** census fur morphs (2018 Central Park Squirrel Census: Gray 83%, Cinnamon 13%, Black 3%) */
const FUR_PALETTES: Record<string, { dorsal: string; flank: string; ventral: string; tail: string }> = {
  Gray: { dorsal: "#625a50", flank: "#7d5f45", ventral: "#d4c9b6", tail: "#5a5550" },
  Cinnamon: { dorsal: "#7a4524", flank: "#9a5226", ventral: "#d8c2a2", tail: "#86482a" },
  Black: { dorsal: "#1d1b1a", flank: "#2b2622", ventral: "#3e3631", tail: "#221f1d" },
};

interface BodySource {
  position: Vector3;
  anim: AnimationState;
}

function SquirrelRig({ get, fur, seed, subject }: { get: () => BodySource | null; fur: string; seed: number; subject: boolean }) {
  const speedMul = useLab((s) => s.speed);
  const runningRef = useRef(true);
  runningRef.current = useLab((s) => s.running);

  const rig = useMemo(() => {
    const rng = mulberry32(seed ^ 0xfeed);
    const pal = FUR_PALETTES[fur] ?? FUR_PALETTES.Gray;
    const jitter = 0.92 + rng() * 0.16;
    const dorsal = new THREE.Color(pal.dorsal).multiplyScalar(jitter);
    const flank = new THREE.Color(pal.flank).multiplyScalar(jitter);
    const ventral = new THREE.Color(pal.ventral);
    const tailColor = new THREE.Color(pal.tail).multiplyScalar(jitter);

    const bodyFur = createFurMaterial({ length: 0.0055, density: 120, gravity: 0.7, baseDark: 0.55 });
    const headFur = createFurMaterial({ length: 0.0035, density: 140, gravity: 0.3, baseDark: 0.6 });
    const tailFur = createFurMaterial({ length: 0.024, density: 70, gravity: 0.3, baseDark: 0.4 });
    const limbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const legMat = new THREE.MeshStandardMaterial({ color: flank.clone().multiplyScalar(0.85), roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: "#2a1f18", roughness: 0.8 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: "#050404", roughness: 0.05, metalness: 0.2 });
    const noseMat = new THREE.MeshStandardMaterial({ color: "#2a1c18", roughness: 0.35 });
    const earMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

    const root = new THREE.Group();
    root.scale.setScalar(SCALE);
    const hips = new THREE.Group();
    root.add(hips);

    // body extends forward from the hips
    const bodyGeo = ellipsoid(0.05, 0.056, 0.105, 32, 22);
    {
      const p = bodyGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        const k = z < 0 ? 1 + (-z / 0.105) * 0.18 : 1 - (z / 0.105) * 0.12;
        p.setX(i, p.getX(i) * k);
        p.setY(i, p.getY(i) * k);
      }
      bodyGeo.computeVertexNormals();
    }
    paintCoat(bodyGeo, dorsal, ventral, flank, 0.12);
    const body = furMesh(bodyGeo, bodyFur.material);
    body.position.set(0, 0.008, 0.075);
    hips.add(body);

    const chestGeo = paintCoat(ellipsoid(0.032, 0.036, 0.04), dorsal, ventral, flank);
    const chest = furMesh(chestGeo, bodyFur.material);
    chest.position.set(0, 0.012, 0.165);
    hips.add(chest);

    // head
    const head = new THREE.Group();
    head.position.set(0, 0.04, 0.195);
    hips.add(head);
    const skullGeo = paintCoat(ellipsoid(0.034, 0.033, 0.042), dorsal, ventral, flank);
    const skull = furMesh(skullGeo, headFur.material);
    skull.position.set(0, 0.01, 0.01);
    head.add(skull);
    const snout = new THREE.Mesh(paintCoat(ellipsoid(0.019, 0.017, 0.026), dorsal, ventral, flank), limbMat);
    snout.position.set(0, -0.002, 0.045);
    head.add(snout);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0058, 10, 8), noseMat);
    nose.position.set(0, 0.003, 0.07);
    head.add(nose);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0082, 14, 10), eyeMat);
      eye.position.set(side * 0.024, 0.017, 0.028);
      head.add(eye);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0088, 0.0022, 6, 16), new THREE.MeshStandardMaterial({ color: "#d9d0bf", roughness: 1 }));
      ring.position.copy(eye.position);
      ring.rotation.y = side * 1.2;
      head.add(ring);
      const earGeo = paintCoat(new THREE.SphereGeometry(0.01, 10, 8), dorsal, flank, flank);
      earGeo.scale(0.8, 1.45, 0.35);
      const ear = new THREE.Mesh(earGeo, earMat);
      ear.position.set(side * 0.02, 0.04, -0.006);
      ear.rotation.set(-0.15, 0, side * -0.3);
      head.add(ear);
    }
    const carry = new THREE.Group();
    const nut = new THREE.Mesh(ellipsoid(0.011, 0.011, 0.015, 10, 8), new THREE.MeshStandardMaterial({ color: "#8a5a2b", roughness: 0.45 }));
    carry.add(nut);
    carry.position.set(0, -0.012, 0.075);
    carry.visible = false;
    head.add(carry);

    // legs
    const limbGeoUpperF = paintCoat(capsule(0.011, 0.03), dorsal, ventral, flank);
    const limbGeoLowerF = paintCoat(capsule(0.0075, 0.028), flank, ventral, flank);
    const pawGeo = ellipsoid(0.0055, 0.0038, 0.008, 8, 6);
    const front: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.027, -0.012, 0.15);
      hips.add(shoulder);
      shoulder.add(new THREE.Mesh(limbGeoUpperF, legMat));
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.045, 0);
      shoulder.add(elbow);
      elbow.add(new THREE.Mesh(limbGeoLowerF, legMat));
      const paw = new THREE.Mesh(pawGeo, dark);
      paw.position.set(0, -0.04, 0.006);
      elbow.add(paw);
      front.push({ shoulder, elbow });
    }
    const thighGeo = paintCoat(ellipsoid(0.023, 0.036, 0.034), dorsal, ventral, flank);
    const shinGeo = paintCoat(capsule(0.009, 0.032), flank, ventral, flank);
    const footGeo = ellipsoid(0.009, 0.006, 0.03, 8, 6);
    footGeo.translate(0, 0, 0.018);
    const hind: { hip: THREE.Group; knee: THREE.Group }[] = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.036, 0.0, 0.02);
      hips.add(hip);
      const thigh = furMesh(thighGeo, bodyFur.material);
      thigh.position.set(0, -0.012, 0.004);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.set(0, -0.034, 0.02);
      hip.add(knee);
      knee.add(new THREE.Mesh(shinGeo, legMat));
      const foot = new THREE.Mesh(footGeo, dark);
      foot.position.set(0, -0.042, -0.012);
      knee.add(foot);
      hind.push({ hip, knee });
    }

    // tail chain
    const tailRoot = new THREE.Group();
    tailRoot.position.set(0, 0.018, -0.02);
    hips.add(tailRoot);
    const tail: THREE.Group[] = [];
    let parent: THREE.Object3D = tailRoot;
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, 0, i === 0 ? 0 : -0.034);
      parent.add(seg);
      const r = TAIL_RADII[i];
      const geo = ellipsoid(r * 0.72, r * 0.62, 0.03, 18, 12);
      geo.translate(0, 0, -0.017);
      paintCoat(geo, tailColor, tailColor.clone().multiplyScalar(1.25), tailColor);
      seg.add(furMesh(geo, tailFur.material));
      tail.push(seg);
      parent = seg;
    }

    return {
      root,
      hips,
      head,
      front,
      hind,
      tail,
      carry,
      furUniforms: [bodyFur.uniforms, headFur.uniforms, tailFur.uniforms],
    };
  }, [fur, seed]);

  const state = useRef({
    pos: new THREE.Vector3(),
    heading: 0,
    init: false,
    time: 0,
    gait: 0,
    lastClimb: 0,
    climbingDown: false,
    pose: {
      bodyY: 0.08,
      bodyPitch: 0,
      headPitch: 0,
      headYaw: 0,
      shoulder: 0,
      elbow: 0,
      hip: 0,
      knee: 0,
      tail: TAIL_STAND.slice(),
    },
    vel: new THREE.Vector3(),
  });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const src = get();
    if (!src) {
      rig.root.visible = false;
      return;
    }
    const a = src.anim;
    const st = state.current;
    // asleep inside a drey: the leaf nest hides the animal
    rig.root.visible = !(a.hidden && a.pose === "sleep" && a.climbHeight > 4);
    const running = runningRef.current;
    st.time += dt * (running ? 1 : 0.25);

    const target = new THREE.Vector3(src.position.x, src.position.y, src.position.z);
    if (!st.init || st.pos.distanceTo(target) > 4) {
      st.pos.copy(target);
      st.heading = a.heading;
      st.init = true;
    }
    const prev = st.pos.clone();
    st.pos.x = damp(st.pos.x, target.x, 18, dt);
    st.pos.z = damp(st.pos.z, target.z, 18, dt);
    st.pos.y = damp(st.pos.y, target.y, a.pose === "climb" ? 18 : 22, dt);
    st.heading = dampAngle(st.heading, a.pose === "climb" ? a.heading + Math.PI : a.heading, 10, dt);
    st.vel.subVectors(st.pos, prev).divideScalar(Math.max(dt, 1e-4));

    if (a.pose === "climb") {
      if (Math.abs(a.climbHeight - st.lastClimb) > 0.001) st.climbingDown = a.climbHeight < st.lastClimb;
      st.lastClimb = a.climbHeight;
    } else st.lastClimb = 0;

    const visualSpeed = running ? Math.min(speedMul, 3) : 0;
    const moveSpeed = a.speed;
    st.gait += dt * visualSpeed * (moveSpeed > 0.05 ? 1.1 + moveSpeed * 1.25 : 0);

    rig.root.position.copy(st.pos);
    rig.root.rotation.set(0, st.heading, 0);

    const tp = targetPose(a.pose, st.time * Math.max(1, Math.min(speedMul, 3)), st.gait, moveSpeed, st.climbingDown);
    const p = st.pose;
    const rate = a.pose === "walk" || a.pose === "run" ? 20 : 7;
    p.bodyY = damp(p.bodyY, tp.bodyY, rate, dt);
    p.bodyPitch = damp(p.bodyPitch, tp.bodyPitch, rate, dt);
    p.headPitch = damp(p.headPitch, tp.headPitch, rate, dt);
    p.headYaw = damp(p.headYaw, a.headYaw, 6, dt);
    p.shoulder = damp(p.shoulder, tp.shoulder, rate, dt);
    p.elbow = damp(p.elbow, tp.elbow, rate, dt);
    p.hip = damp(p.hip, tp.hip, rate, dt);
    p.knee = damp(p.knee, tp.knee, rate, dt);
    const flick = a.tailFlick;
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const extra = flick > 0 && i > 1 && i < 8 ? Math.sin(st.time * 32 + i) * 0.22 * flick : 0;
      p.tail[i] = damp(p.tail[i], tp.tail[i] + extra, flick > 0 ? 30 : 6, dt);
      rig.tail[i].rotation.x = p.tail[i];
      rig.tail[i].rotation.y = Math.sin(st.time * 0.8 + i * 0.3) * 0.02;
    }

    rig.hips.position.set(0, p.bodyY, a.pose === "climb" ? -0.03 : -0.07);
    rig.hips.rotation.x = p.bodyPitch;
    rig.head.rotation.set(p.headPitch, p.headYaw, 0);
    rig.front.forEach((f, i) => {
      const offset = a.pose === "walk" || a.pose === "run" ? (i === 0 ? 0 : 0.35) : 0;
      f.shoulder.rotation.x = p.shoulder + offset * 0.3;
      f.elbow.rotation.x = p.elbow;
    });
    rig.hind.forEach((h, i) => {
      const offset = a.pose === "walk" || a.pose === "run" ? (i === 0 ? 0 : 0.25) : 0;
      h.hip.rotation.x = p.hip + offset * 0.3;
      h.knee.rotation.x = -p.knee * 0.6;
    });
    rig.carry.visible = a.carrying;

    // fur trails slightly behind motion
    for (const u of rig.furUniforms) u.uMotion.value.set(0, 0, Math.min(1, st.vel.length() * 0.15));

    if (subject) {
      focus.position.copy(st.pos);
      focus.heading = st.heading;
      focus.initialized = true;
    }
  });

  return <primitive object={rig.root} />;
}

/** leaf-and-twig dreys high in the nest trees of the subject and its neighbours */
function Dreys({ experiment }: { experiment: Experiment }) {
  const mesh = useMemo(() => {
    const world = experiment.world;
    const ids = new Set<string>([experiment.agent.homeTree.id, ...(experiment.ctx.rivals?.rivals.map((r) => r.homeTreeId) ?? [])]);
    const geo = new THREE.IcosahedronGeometry(0.42, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const rng = mulberry32(experiment.seed ^ 0xd4e1);
    for (let i = 0; i < pos.count; i++) {
      const k = 0.8 + rng() * 0.45;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.75, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: "#5a4630", roughness: 1, flatShading: true });
    const trees = world.state.objects.filter((o) => ids.has(o.id));
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, trees.length));
    const m4 = new THREE.Matrix4();
    trees.forEach((t, i) => {
      const home = t.id === experiment.agent.homeTree.id;
      const h = home ? 8.5 : Math.max(6, Math.min(8.5, t.height * 0.65));
      m4.makeTranslation(t.position.x + t.radius * 0.6 + 0.25, t.position.y + h + 0.25, t.position.z);
      m.setMatrixAt(i, m4);
    });
    m.count = trees.length;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }, [experiment]);
  return <primitive object={mesh} />;
}

export function SquirrelModel({ experiment }: { experiment: Experiment }) {
  const rivals = experiment.ctx.rivals?.rivals ?? [];
  const fur = experiment.agent.state.fur ?? "Gray";
  return (
    <group>
      <SquirrelRig key={`subject-${experiment.agent.state.generation}`} get={() => experiment.agent.state} fur={fur} seed={experiment.seed + experiment.agent.state.generation} subject />
      {rivals.map((r, i) => (
        <SquirrelRig
          key={r.id}
          get={() => {
            const rv = experiment.ctx.rivals?.rivals.find((x) => x.id === r.id);
            return rv && rv.alive ? rv : null;
          }}
          fur={r.fur}
          seed={experiment.seed + i * 131}
          subject={false}
        />
      ))}
      <Dreys experiment={experiment} />
    </group>
  );
}
