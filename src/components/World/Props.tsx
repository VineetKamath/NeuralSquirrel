"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldModel } from "@/simulation/WorldModel";
import { mulberry32, ValueNoise } from "@/utils/rng";
import { barkTexture } from "./textures";
import { U } from "./sharedUniforms";

const lampGlass = new THREE.MeshStandardMaterial({ color: "#f3e2b0", emissive: "#ffcf7a", emissiveIntensity: 0, roughness: 0.3, transparent: true, opacity: 0.92 });

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g.toNonIndexed();
}

function bridgeY(world: WorldModel, x: number, z: number) {
  return Math.max(world.terrain.height(x, z), world.terrain.site.waterLevelAt(x, z) + 1.4) - 0.05;
}

/** real park furniture and structures: benches and lamp posts along OSM footways, buildings, bridge decks */
function buildStructures(world: WorldModel) {
  const site = world.terrain.site;
  const out: THREE.Object3D[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const benches = world.state.objects.filter((o) => o.kind === "bench");
  const lamps = world.state.objects.filter((o) => o.kind === "lamp");

  // Central Park settee: wooden slats on cast-iron frames
  const wood = mergeGeometries([
    box(1.8, 0.04, 0.12, 0, 0.45, 0.14),
    box(1.8, 0.04, 0.12, 0, 0.45, 0.0),
    box(1.8, 0.04, 0.12, 0, 0.45, -0.14),
    box(1.8, 0.1, 0.035, 0, 0.66, -0.23),
    box(1.8, 0.1, 0.035, 0, 0.82, -0.26),
  ]);
  const iron = mergeGeometries([
    box(0.06, 0.45, 0.5, -0.8, 0.225, 0),
    box(0.06, 0.45, 0.5, 0.8, 0.225, 0),
    box(0.05, 0.5, 0.05, -0.8, 0.7, -0.25),
    box(0.05, 0.5, 0.05, 0.8, 0.7, -0.25),
    box(0.05, 0.05, 0.45, -0.8, 0.62, -0.02),
    box(0.05, 0.05, 0.45, 0.8, 0.62, -0.02),
  ]);
  const woodMat = new THREE.MeshStandardMaterial({ color: "#6b4a2e", roughness: 0.85 });
  const ironMat = new THREE.MeshStandardMaterial({ color: "#1f2620", roughness: 0.6, metalness: 0.4 });
  const wi = new THREE.InstancedMesh(wood, woodMat, Math.max(1, benches.length));
  const ii = new THREE.InstancedMesh(iron, ironMat, Math.max(1, benches.length));
  benches.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rotation);
    m4.compose(p.set(b.position.x, world.terrain.height(b.position.x, b.position.z) - 0.02, b.position.z), q, one);
    wi.setMatrixAt(i, m4);
    ii.setMatrixAt(i, m4);
  });
  wi.count = benches.length;
  ii.count = benches.length;
  for (const m of [wi, ii]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    out.push(m);
  }

  // lamp posts with lanterns that light up after dark
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.05, 0.09, 3.4, 8).translate(0, 1.7, 0).toNonIndexed(),
    new THREE.CylinderGeometry(0.14, 0.18, 0.35, 8).translate(0, 0.17, 0).toNonIndexed(),
    new THREE.CylinderGeometry(0.16, 0.06, 0.12, 8).translate(0, 3.46, 0).toNonIndexed(),
    new THREE.ConeGeometry(0.2, 0.22, 8).translate(0, 3.98, 0).toNonIndexed(),
  ]);
  const lantern = new THREE.CylinderGeometry(0.15, 0.1, 0.42, 8).translate(0, 3.68, 0);
  const pi = new THREE.InstancedMesh(pole, ironMat, Math.max(1, lamps.length));
  const li = new THREE.InstancedMesh(lantern, lampGlass, Math.max(1, lamps.length));
  lamps.forEach((l, i) => {
    m4.makeTranslation(l.position.x, world.terrain.height(l.position.x, l.position.z) - 0.02, l.position.z);
    pi.setMatrixAt(i, m4);
    li.setMatrixAt(i, m4);
  });
  pi.count = lamps.length;
  li.count = lamps.length;
  pi.castShadow = true;
  for (const m of [pi, li]) {
    m.computeBoundingSphere();
    out.push(m);
  }

  // buildings from OSM footprints (e.g. the Henry Luce Nature Observatory)
  const stone = new THREE.MeshStandardMaterial({ color: "#8b857a", roughness: 0.92 });
  const roof = new THREE.MeshStandardMaterial({ color: "#4c4a46", roughness: 0.8 });
  for (const b of site.raw.buildings) {
    if (b.poly.length < 3) continue;
    const shape = new THREE.Shape(b.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    let area = 0;
    let base = Infinity;
    for (let i = 0; i < b.poly.length; i++) {
      const [x1, z1] = b.poly[i];
      const [x2, z2] = b.poly[(i + 1) % b.poly.length];
      area += x1 * z2 - x2 * z1;
      base = Math.min(base, world.terrain.height(x1, z1));
    }
    area = Math.abs(area) / 2;
    const height = area > 400 ? 9 : area > 80 ? 5.5 : 3.2;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height + 1.5, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, [roof, stone]);
    mesh.position.y = base - 1.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.push(mesh);
  }

  // bridge decks over the Lake and the Gill (Bow Bridge is cast iron, painted cream)
  const deckMat = new THREE.MeshStandardMaterial({ color: "#cfc6b0", roughness: 0.75, side: THREE.DoubleSide });
  const railMat = new THREE.MeshStandardMaterial({ color: "#e2dccb", roughness: 0.6, metalness: 0.2 });
  for (const path of site.raw.paths) {
    if (!path.bridge || path.pts.length < 2) continue;
    const pts = path.pts;
    const n = pts.length;
    const half = 1.7;
    const deck: number[] = [];
    const idx: number[] = [];
    const rails: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i];
      const [ax, az] = pts[Math.max(0, i - 1)];
      const [bx, bz] = pts[Math.min(n - 1, i + 1)];
      let dx = bx - ax;
      let dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const y = bridgeY(world, x, z);
      deck.push(x - dz * half, y, z + dx * half, x + dz * half, y, z - dx * half);
      if (i === 0) continue;
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      const [px, pz] = pts[i - 1];
      const py = bridgeY(world, px, pz);
      const segLen = Math.hypot(x - px, z - pz);
      for (const side of [-1, 1]) {
        const r = new THREE.BoxGeometry(0.08, 0.9, segLen + 0.05);
        r.translate(0, 0.45, 0);
        r.rotateY(Math.atan2(x - px, z - pz));
        r.translate((x + px) / 2 - dz * half * side, (y + py) / 2, (z + pz) / 2 + dx * half * side);
        rails.push(r.toNonIndexed());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(deck, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const dm = new THREE.Mesh(g, deckMat);
    dm.castShadow = true;
    dm.receiveShadow = true;
    out.push(dm);
    if (rails.length) {
      const rm = new THREE.Mesh(mergeGeometries(rails), railMat);
      rm.castShadow = true;
      out.push(rm);
    }
  }
  return out;
}


function rockGeometry(seed: number) {
  const noise = new ValueNoise(seed);
  const geo = new THREE.IcosahedronGeometry(1, 5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const stone = new THREE.Color();
  const moss = new THREE.Color("#3f5a2a");
  const lichen = new THREE.Color("#8d8a62");
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise.fbm(v.x * 1.6 + 10, v.z * 1.6 + v.y * 1.3, 4);
    const facet = Math.abs(noise.noise(v.x * 3.1 + v.y * 2.2, v.z * 3.1)) * 0.12;
    const r = 0.78 + n * 0.45 + facet;
    v.multiplyScalar(r);
    v.y *= 0.62;
    if (v.y < -0.1) v.y *= 0.4;
    pos.setXYZ(i, v.x, v.y, v.z);
    const g = 0.28 + noise.noise(v.x * 6, v.z * 6 + v.y * 4) * 0.12;
    stone.setRGB(g, g * 0.98, g * 0.94);
    const up = THREE.MathUtils.smoothstep(v.y / 0.62, 0.15, 0.7);
    stone.lerp(moss, up * (0.55 + n * 0.4));
    if (noise.noise(v.x * 9 + 3, v.z * 9 + v.y * 9) > 0.78) stone.lerp(lichen, 0.5);
    colors[i * 3] = stone.r;
    colors[i * 3 + 1] = stone.g;
    colors[i * 3 + 2] = stone.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function logGeometry(length: number, radius: number, seed: number, stump = false) {
  const rng = mulberry32(seed);
  const radial = 16;
  const rings = stump ? 5 : Math.max(6, Math.round(length * 2));
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const phase = rng() * 10;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const bump = 1 + Math.sin(a * 6 + phase + t * 7) * 0.05 + Math.sin(a * 13 + phase) * 0.025;
      let r = radius * bump;
      if (stump) r *= 1 + Math.exp(-t * 5) * 0.5 * Math.max(0, Math.sin(a * 5 + phase));
      else r *= 1 - Math.abs(t - 0.5) * 0.12;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const along = stump ? t * length : (t - 0.5) * length;
      if (stump) pos.push(x, along, y);
      else pos.push(along, y, x);
      uv.push(k / radial, (t * length) / (radius * 3));
      const top = stump ? 0 : Math.max(0, Math.sin(a));
      const m = top * top * (0.6 + rng() * 0.3);
      col.push(1 - m * 0.55, 1 - m * 0.25, 1 - m * 0.7);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      const b = a + radial + 1;
      if (stump) idx.push(a, a + 1, b, b, a + 1, b + 1);
      else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  body.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  body.setIndex(idx);
  body.computeVertexNormals();

  // end caps with pale heartwood
  const caps: THREE.BufferGeometry[] = [body];
  const ends = stump ? [length] : [-length / 2, length / 2];
  for (const e of ends) {
    const cap = new THREE.CircleGeometry(radius * 0.97, radial);
    if (stump) {
      cap.rotateX(-Math.PI / 2);
      cap.translate(0, e, 0);
    } else {
      cap.rotateY(e > 0 ? Math.PI / 2 : -Math.PI / 2);
      cap.translate(e, 0, 0);
    }
    const n = cap.attributes.position.count;
    const cc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      cc[i * 3] = 1.9;
      cc[i * 3 + 1] = 1.55;
      cc[i * 3 + 2] = 1.15;
    }
    cap.setAttribute("color", new THREE.BufferAttribute(cc, 3));
    caps.push(cap);
  }
  const merged = mergeGeometries(caps.map((g) => g.toNonIndexed()), false);
  merged.computeVertexNormals();
  return merged;
}

export function Props({ world, version }: { world: WorldModel; version: number }) {
  const built = useMemo(() => {
    const rng = mulberry32(world.state.seed ^ 0x4242);
    const rockVariants = [0, 1, 2, 3, 4].map((i) => rockGeometry(world.state.seed + i * 97));
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: false });
    const rocks = rockVariants.map(() => [] as THREE.Matrix4[]);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    const logGeos: THREE.BufferGeometry[] = [];
    const structures = buildStructures(world);
    const mush: { pos: THREE.Vector3; scale: number; toxic: boolean }[] = [];

    for (const o of world.state.objects) {
      if (o.kind === "rock") {
        const v = Math.floor(rng() * rockVariants.length);
        const sc = o.scale;
        p.set(o.position.x, o.position.y - 0.15 * sc, o.position.z);
        q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.3, o.rotation, (rng() - 0.5) * 0.3));
        s.set(sc * (0.9 + rng() * 0.4), sc * (0.8 + rng() * 0.5), sc * (0.9 + rng() * 0.4));
        rocks[v].push(new THREE.Matrix4().compose(p.clone(), q.clone(), s.clone()));
      } else if (o.kind === "log") {
        const len = o.length ?? 5;
        const g = logGeometry(len, o.radius * 1.15, Math.floor(o.position.x * 100) ^ 7);
        g.rotateY(o.rotation - Math.PI / 2);
        g.translate(o.position.x, o.position.y + o.radius * 0.8, o.position.z);
        logGeos.push(g);
      } else if (o.kind === "stump") {
        const g = logGeometry(o.height * 0.9, o.radius, Math.floor(o.position.z * 100) ^ 3, true);
        g.translate(o.position.x, o.position.y - 0.2, o.position.z);
        logGeos.push(g);
      } else if (o.kind === "mushroom") {
        mush.push({ pos: new THREE.Vector3(o.position.x, o.position.y, o.position.z), scale: 0.8 + rng() * 0.6, toxic: o.variant === 0 });
      }
    }

    // scattered twigs and pebbles around the forest floor
    const twigs: THREE.Matrix4[] = [];
    const pebbles: THREE.Matrix4[] = [];
    const t = world.terrain;
    for (let i = 0; i < 16000; i++) {
      const x = (rng() - 0.5) * 396;
      const z = (rng() - 0.5) * 396;
      if (t.site.isBlocked(x, z) || t.site.distToPath(x, z) < 1.5) continue;
      const cover = world.coverAt(x, z);
      if (rng() > 0.35 + cover * 0.65) continue;
      const y = t.height(x, z);
      if (rng() < 0.55) {
        const len = 0.3 + rng() * 1.1;
        p.set(x, y + 0.015, z);
        q.setFromEuler(new THREE.Euler(Math.PI / 2 + (rng() - 0.5) * 0.15, rng() * Math.PI * 2, 0, "YXZ"));
        s.set(0.6 + rng() * 0.8, len, 0.6 + rng() * 0.8);
        twigs.push(new THREE.Matrix4().compose(p.clone(), q.clone(), s.clone()));
      } else {
        const sc = 0.04 + rng() * 0.12;
        p.set(x, y, z);
        q.setFromEuler(new THREE.Euler(rng(), rng() * 6, rng()));
        s.set(sc, sc * 0.7, sc * (0.8 + rng() * 0.4));
        pebbles.push(new THREE.Matrix4().compose(p.clone(), q.clone(), s.clone()));
      }
    }

    const makeInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow = true) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.count = list.length;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      return mesh;
    };

    const objects: THREE.Object3D[] = [];
    rockVariants.forEach((g, i) => objects.push(makeInstanced(g, rockMat, rocks[i])));

    const twigGeo = new THREE.CylinderGeometry(0.012, 0.02, 1, 5);
    const twigMat = new THREE.MeshStandardMaterial({ color: "#3b2e22", roughness: 1 });
    objects.push(makeInstanced(twigGeo, twigMat, twigs, false));
    const pebbleGeo = rockGeometry(world.state.seed + 999);
    objects.push(makeInstanced(pebbleGeo, rockMat, pebbles, false));

    if (logGeos.length) {
      const logs = mergeGeometries(logGeos, false);
      const bark = barkTexture("oak");
      const logMat = new THREE.MeshStandardMaterial({ map: bark, vertexColors: true, roughness: 0.95, color: "#8a7a68" });
      const logMesh = new THREE.Mesh(logs, logMat);
      logMesh.castShadow = true;
      logMesh.receiveShadow = true;
      objects.push(logMesh);
    }

    // mushrooms: stems + caps
    const stemGeo = new THREE.CylinderGeometry(0.018, 0.026, 0.12, 7);
    stemGeo.translate(0, 0.06, 0);
    const capGeo = new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.scale(1, 0.55, 1);
    capGeo.translate(0, 0.115, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: "#d8cfb8", roughness: 0.8 });
    const redMat = new THREE.MeshStandardMaterial({ color: "#9c2616", roughness: 0.55 });
    const brownMat = new THREE.MeshStandardMaterial({ color: "#6a4a2c", roughness: 0.7 });
    const stems: THREE.Matrix4[] = [];
    const red: THREE.Matrix4[] = [];
    const brown: THREE.Matrix4[] = [];
    for (const mu of mush) {
      for (let k = 0; k < 3; k++) {
        const sc = mu.scale * (0.6 + rng() * 0.7) * (k === 0 ? 1.3 : 1);
        p.set(mu.pos.x + (rng() - 0.5) * 0.3, t.height(mu.pos.x, mu.pos.z) - 0.01, mu.pos.z + (rng() - 0.5) * 0.3);
        q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.3, rng() * 6, (rng() - 0.5) * 0.3));
        s.setScalar(sc);
        const mm = new THREE.Matrix4().compose(p.clone(), q.clone(), s.clone());
        stems.push(mm);
        (mu.toxic ? red : brown).push(mm);
      }
    }
    objects.push(makeInstanced(stemGeo, stemMat, stems, false));
    objects.push(makeInstanced(capGeo, redMat, red, false));
    objects.push(makeInstanced(capGeo, brownMat, brown, false));
    void m4;
    objects.push(...structures);
    return objects;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, version]);

  useFrame(() => {
    // lanterns switch on at dusk
    const target = THREE.MathUtils.clamp(U.uNight.value * 1.4, 0, 1) * 2.2;
    lampGlass.emissiveIntensity += (target - lampGlass.emissiveIntensity) * 0.05;
  });

  return (
    <group>
      {built.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
    </group>
  );
}
