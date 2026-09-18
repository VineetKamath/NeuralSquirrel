"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldModel } from "@/simulation/WorldModel";
import type { WorldObject } from "@/types";
import { mulberry32, type RNG } from "@/utils/rng";
import { barkTexture, fernTexture, leafClusterTexture, pineTexture } from "./textures";
import { U } from "./sharedUniforms";

// ───────────────────────────── trunk & branch geometry ─────────────────────────────

const up = new THREE.Vector3(0, 1, 0);

/** tapered, slightly irregular tube along a set of points */
function tube(points: THREE.Vector3[], r0: number, r1: number, radial: number, rng: RNG, flare = 0, uvScale = 1) {
  const rings = points.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const seed = rng() * 100;
  let len = 0;
  for (let i = 0; i < rings; i++) {
    const p = points[i];
    if (i > 0) len += p.distanceTo(points[i - 1]);
    const t = i / (rings - 1);
    const dir = new THREE.Vector3()
      .subVectors(points[Math.min(i + 1, rings - 1)], points[Math.max(i - 1, 0)])
      .normalize();
    const side = Math.abs(dir.dot(up)) > 0.95 ? new THREE.Vector3(1, 0, 0) : up;
    const nx = new THREE.Vector3().crossVectors(dir, side).normalize();
    const ny = new THREE.Vector3().crossVectors(nx, dir).normalize();
    let r = r0 + (r1 - r0) * t;
    if (flare) r *= 1 + flare * Math.exp(-t * 14);
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const bump = 1 + Math.sin(a * 5 + seed + t * 9) * 0.05 + Math.sin(a * 11 + seed * 2) * 0.03 + (flare ? Math.max(0, Math.sin(a * 4 + seed)) * flare * 0.5 * Math.exp(-t * 18) : 0);
      const n = nx.clone().multiplyScalar(Math.cos(a)).add(ny.clone().multiplyScalar(Math.sin(a)));
      pos.push(p.x + n.x * r * bump, p.y + n.y * r * bump, p.z + n.z * r * bump);
      nor.push(n.x, n.y, n.z);
      uv.push(k / radial, (len / (r0 * 6.28)) * 0.5 * uvScale);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function curve(from: THREE.Vector3, dir: THREE.Vector3, length: number, segments: number, droop: number, wobble: number, rng: RNG) {
  const pts: THREE.Vector3[] = [from.clone()];
  const d = dir.clone().normalize();
  const p = from.clone();
  for (let i = 1; i <= segments; i++) {
    d.y -= droop / segments;
    d.x += (rng() - 0.5) * wobble;
    d.z += (rng() - 0.5) * wobble;
    d.normalize();
    p.addScaledVector(d, length / segments);
    pts.push(p.clone());
  }
  return pts;
}

interface Card {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
  normal: THREE.Vector3;
  color: THREE.Color;
  /** order in which the card's leaves fall (0 first) */
  rank?: number;
  /** autumn colour for this card */
  autumn?: THREE.Color;
}

const AUTUMN = {
  oak: ["#7a3b1c", "#8e5a24", "#6b4a26", "#9a4a22"],
  birch: ["#c9a227", "#d8b43a", "#b88f1f"],
  bush: ["#9b2a1c", "#b5461f", "#7e2a2a"],
};

function clump(cards: Card[], center: THREE.Vector3, radius: number, count: number, size: number, rng: RNG, tint: THREE.Color, flat = 0.75) {
  for (let i = 0; i < count; i++) {
    const u = rng() * Math.PI * 2;
    const v = Math.acos(2 * rng() - 1);
    const r = radius * (0.45 + 0.55 * Math.cbrt(rng()));
    const off = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v) * flat, Math.sin(v) * Math.sin(u)).multiplyScalar(r);
    const pos = center.clone().add(off);
    const normal = off.clone().normalize().lerp(up, 0.35).normalize();
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI));
    const c = tint.clone().offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1 - (off.y < 0 ? 0.06 : 0));
    cards.push({ pos, quat, scale: size * (0.75 + rng() * 0.5), normal, color: c });
  }
}

interface VegetationBuild {
  oakBark: THREE.BufferGeometry | null;
  pineBark: THREE.BufferGeometry | null;
  birchBark: THREE.BufferGeometry | null;
  broadCards: Card[];
  birchCards: Card[];
  pineCards: Card[];
  bushCards: Card[];
  fernCards: Card[];
}

function buildOak(o: WorldObject, rng: RNG, bark: THREE.BufferGeometry[], cards: Card[]) {
  const s = o.scale;
  const base = new THREE.Vector3(o.position.x, o.position.y - 0.3, o.position.z);
  const trunkH = 4.2 * s;
  const lean = new THREE.Vector3((rng() - 0.5) * 0.15, 1, (rng() - 0.5) * 0.15);
  const trunkPts = curve(base, lean, trunkH + 0.3, 8, 0, 0.08, rng);
  bark.push(tube(trunkPts, o.radius * 1.05, o.radius * 0.55, 14, rng, 0.9));
  const top = trunkPts[trunkPts.length - 1];
  const tint = new THREE.Color().setHSL(0.24 + rng() * 0.03, 0.42, 0.26);
  const limbs = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rng() * 0.6;
    const startT = 0.55 + rng() * 0.45;
    const start = trunkPts[Math.floor(startT * (trunkPts.length - 1))].clone();
    const dir = new THREE.Vector3(Math.cos(a), 0.7 + rng() * 0.6, Math.sin(a));
    const len = (3.6 + rng() * 2.4) * s;
    const pts = curve(start, dir, len, 5, 0.25, 0.25, rng);
    bark.push(tube(pts, o.radius * 0.38, o.radius * 0.1, 7, rng));
    const end = pts[pts.length - 1];
    clump(cards, end.clone().add(new THREE.Vector3(0, 0.6 * s, 0)), 2.3 * s, 22, 2.1 * s, rng, tint);
    const mid = pts[Math.floor(pts.length / 2)];
    const sub = curve(mid, new THREE.Vector3(Math.cos(a + 0.9), 0.9, Math.sin(a + 0.9)), len * 0.5, 3, 0.1, 0.3, rng);
    bark.push(tube(sub, o.radius * 0.14, o.radius * 0.05, 5, rng));
    clump(cards, sub[sub.length - 1].clone().add(new THREE.Vector3(0, 0.4, 0)), 1.7 * s, 13, 1.8 * s, rng, tint);
  }
  clump(cards, top.clone().add(new THREE.Vector3(0, 3.2 * s, 0)), 3.2 * s, 34, 2.4 * s, rng, tint, 0.6);
}

function buildPine(o: WorldObject, rng: RNG, bark: THREE.BufferGeometry[], cards: Card[]) {
  const s = o.scale;
  const H = o.height;
  const base = new THREE.Vector3(o.position.x, o.position.y - 0.3, o.position.z);
  const pts = curve(base, new THREE.Vector3((rng() - 0.5) * 0.05, 1, (rng() - 0.5) * 0.05), H, 10, 0, 0.02, rng);
  bark.push(tube(pts, o.radius * 1.1, 0.04, 9, rng, 0.5, 2));
  const tint = new THREE.Color().setHSL(0.3 + rng() * 0.04, 0.3, 0.17);
  const tiers = 11;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = H * (0.3 + t * 0.68);
    const center = new THREE.Vector3(base.x, base.y + y, base.z);
    const r = (1 - t) * 3.4 * s + 0.5;
    const count = Math.round(6 + (1 - t) * 10);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + rng() * 0.5 + i;
      const dist = r * (0.45 + rng() * 0.45);
      const pos = center.clone().add(new THREE.Vector3(Math.cos(a) * dist, -dist * 0.25, Math.sin(a) * dist));
      // card lies roughly horizontal, pointing outward and drooping
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - (0.15 + rng() * 0.3), -a - Math.PI / 2, 0, "YXZ"));
      const normal = new THREE.Vector3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize();
      cards.push({
        pos,
        quat,
        scale: (1.4 + (1 - t) * 1.6 + rng() * 0.5) * s,
        normal,
        color: tint.clone().offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.06 + t * 0.04),
      });
    }
  }
}

function buildBirch(o: WorldObject, rng: RNG, bark: THREE.BufferGeometry[], cards: Card[]) {
  const s = o.scale;
  const H = o.height;
  const base = new THREE.Vector3(o.position.x, o.position.y - 0.2, o.position.z);
  const pts = curve(base, new THREE.Vector3((rng() - 0.5) * 0.3, 1, (rng() - 0.5) * 0.3), H * 0.85, 9, 0, 0.1, rng);
  bark.push(tube(pts, o.radius, 0.05, 9, rng, 0.3, 1.5));
  const tint = new THREE.Color().setHSL(0.2 + rng() * 0.04, 0.45, 0.33);
  for (let i = 0; i < 7; i++) {
    const t = 0.45 + (i / 7) * 0.55;
    const p = pts[Math.floor(t * (pts.length - 1))];
    const a = rng() * Math.PI * 2;
    const br = curve(p, new THREE.Vector3(Math.cos(a), 0.9, Math.sin(a)), 1.8 * s, 3, 0.4, 0.3, rng);
    bark.push(tube(br, 0.05 * s, 0.015, 4, rng));
    clump(cards, br[br.length - 1], 1.5 * s, 16, 1.3 * s, rng, tint);
  }
}

function buildVegetation(world: WorldModel): VegetationBuild {
  const rng = mulberry32(world.state.seed ^ 0x1234);
  const oak: THREE.BufferGeometry[] = [];
  const pine: THREE.BufferGeometry[] = [];
  const birch: THREE.BufferGeometry[] = [];
  const broadCards: Card[] = [];
  const birchCards: Card[] = [];
  const pineCards: Card[] = [];
  const bushCards: Card[] = [];
  const fernCards: Card[] = [];
  const seasonal = (cards: Card[], from: number, palette: string[]) => {
    for (let i = from; i < cards.length; i++) {
      cards[i].rank = rng();
      cards[i].autumn = new THREE.Color(palette[Math.floor(rng() * palette.length)]).offsetHSL(0, 0, (rng() - 0.5) * 0.08);
    }
  };
  for (const o of world.state.objects) {
    if (o.fallen) continue;
    if (o.kind === "oak") {
      const n = broadCards.length;
      buildOak(o, rng, oak, broadCards);
      seasonal(broadCards, n, AUTUMN.oak);
    } else if (o.kind === "pine") buildPine(o, rng, pine, pineCards);
    else if (o.kind === "birch") {
      const n = birchCards.length;
      buildBirch(o, rng, birch, birchCards);
      seasonal(birchCards, n, AUTUMN.birch);
    } else if (o.kind === "bush") {
      const s = o.scale;
      const tint = new THREE.Color().setHSL(0.25 + rng() * 0.05, 0.38, o.variant === 1 ? 0.22 : 0.25);
      const n = 3 + Math.floor(rng() * 3);
      const from = bushCards.length;
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const c = new THREE.Vector3(o.position.x + Math.cos(a) * 0.5 * s, o.position.y + (0.45 + rng() * 0.5) * s, o.position.z + Math.sin(a) * 0.5 * s);
        clump(bushCards, c, 0.75 * s, 12, 0.95 * s, rng, tint, 0.8);
      }
      seasonal(bushCards, from, AUTUMN.bush);
    }
  }
  // ferns: decorative, clustered in shaded woodland ground
  const t = world.terrain;
  let placed = 0;
  for (let i = 0; i < 30000 && placed < 2200; i++) {
    const x = (rng() - 0.5) * 390;
    const z = (rng() - 0.5) * 390;
    const cover = world.coverAt(x, z);
    const m = t.moisture(x, z);
    if (rng() > cover * 0.8 + (m > 0.55 ? 0.25 : 0)) continue;
    if (t.pathFactor(x, z) > 0.2 || t.shoreFactor(x, z) > 0.05 || t.isBlocked(x, z)) continue;
    if (world.obstaclesNear(x, z).some((o) => Math.hypot(o.position.x - x, o.position.z - z) < o.radius + 0.5)) continue;
    const y = t.height(x, z);
    const fronds = 5 + Math.floor(rng() * 4);
    const size = 0.55 + rng() * 0.5;
    const tint = new THREE.Color().setHSL(0.24 + rng() * 0.05, 0.45, 0.26);
    for (let k = 0; k < fronds; k++) {
      const a = (k / fronds) * Math.PI * 2 + rng() * 0.4;
      const tilt = 0.6 + rng() * 0.5;
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, -a, 0, "YXZ"));
      const pos = new THREE.Vector3(x + Math.sin(a) * size * 0.25, y + size * 0.28, z + Math.cos(a) * size * 0.25);
      fernCards.push({ pos, quat, scale: size, normal: up.clone(), color: tint.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.08), rank: rng(), autumn: new THREE.Color("#8a6a3a") });
    }
    placed++;
  }

  const merge = (arr: THREE.BufferGeometry[]) => {
    if (!arr.length) return null;
    const g = mergeGeometries(arr, false);
    arr.forEach((a) => a.dispose());
    return g;
  };
  return { oakBark: merge(oak), pineBark: merge(pine), birchBark: merge(birch), broadCards, birchCards, pineCards, bushCards, fernCards };
}

// ───────────────────────────── materials ─────────────────────────────

function foliageMaterial(map: THREE.Texture, alphaTest = 0.42, sway = 1, deciduous = true) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    alphaTest,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWind = U.uWind;
    shader.uniforms.uLeaf = U.uLeaf;
    shader.uniforms.uLeafColour = U.uLeafColour;
    shader.uniforms.uSnow = U.uSnow;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 aClumpNormal;
attribute float aRank;
attribute vec3 aAutumn;
uniform float uTime;
uniform float uWind;
uniform float uLeaf;
uniform float uLeafColour;
varying vec3 vAutumn;
varying float vColourMix;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
${
  deciduous
    ? `// real phenology: cards drop in rank order as the canopy thins
transformed *= step(aRank, uLeaf + 0.001);
vAutumn = aAutumn;
vColourMix = clamp(uLeafColour * 1.3 - aRank * 0.3, 0.0, 1.0);`
    : `vAutumn = aAutumn; vColourMix = 0.0;`
}`
      )
      .replace(
        "#include <defaultnormal_vertex>",
        `#include <defaultnormal_vertex>
transformedNormal = normalize(normalMatrix * aClumpNormal);`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ph = ip.x * 0.37 + ip.z * 0.23;
  float w = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.3;
  transformed.x += w * 0.06 * uWind * ${sway.toFixed(2)} * (0.5 + position.y);
  transformed.z += cos(uTime * 1.7 + ph) * 0.04 * uWind * ${sway.toFixed(2)};
}`
      )
;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vAutumn;\nvarying float vColourMix;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
// autumn colours follow the real calendar
diffuseColor.rgb = mix(diffuseColor.rgb, vAutumn * (0.55 + diffuseColor.g * 0.9), vColourMix);`
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
// soft translucency so foliage never goes fully black
reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.08;`
      );
  };
  return mat;
}

function barkMaterial(kind: "oak" | "birch" | "pine") {
  const map = barkTexture(kind);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0, color: kind === "birch" ? "#d8d4ca" : "#a89a8a" });
}

/** foliage cards split into 100 m chunks so off-screen areas are frustum-culled */
function CardMesh({ cards, material, castShadow = true }: { cards: Card[]; material: THREE.Material; castShadow?: boolean }) {
  const meshes = useMemo(() => {
    const chunks = new Map<number, Card[]>();
    for (const c of cards) {
      const key = Math.floor((c.pos.x + 200) / 100) * 10 + Math.floor((c.pos.z + 200) / 100);
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key)!.push(c);
    }
    const out: THREE.InstancedMesh[] = [];
    for (const list of chunks.values()) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const normals = new Float32Array(list.length * 3);
      const ranks = new Float32Array(list.length);
      const autumn = new Float32Array(list.length * 3);
      list.forEach((c, i) => {
        normals[i * 3] = c.normal.x;
        normals[i * 3 + 1] = c.normal.y;
        normals[i * 3 + 2] = c.normal.z;
        ranks[i] = c.rank ?? 0;
        const a = c.autumn ?? c.color;
        autumn[i * 3] = a.r;
        autumn[i * 3 + 1] = a.g;
        autumn[i * 3 + 2] = a.b;
      });
      geo.setAttribute("aClumpNormal", new THREE.InstancedBufferAttribute(normals, 3));
      geo.setAttribute("aRank", new THREE.InstancedBufferAttribute(ranks, 1));
      geo.setAttribute("aAutumn", new THREE.InstancedBufferAttribute(autumn, 3));
      const m = new THREE.InstancedMesh(geo, material, list.length);
      const mat4 = new THREE.Matrix4();
      const scl = new THREE.Vector3();
      list.forEach((c, i) => {
        scl.setScalar(c.scale);
        mat4.compose(c.pos, c.quat, scl);
        m.setMatrixAt(i, mat4);
        m.setColorAt(i, c.color);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = castShadow;
      m.receiveShadow = true;
      m.computeBoundingSphere();
      if (m.boundingSphere) m.boundingSphere.radius += 6;
      out.push(m);
    }
    return out;
  }, [cards, material, castShadow]);
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

export function Vegetation({ world, version }: { world: WorldModel; version: number }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const build = useMemo(() => buildVegetation(world), [world, version]);
  const mats = useMemo(
    () => ({
      broad: foliageMaterial(leafClusterTexture("oak")),
      birch: foliageMaterial(leafClusterTexture("birch"), 0.42, 1.4),
      pine: foliageMaterial(pineTexture(), 0.4, 0.5, false),
      bush: foliageMaterial(leafClusterTexture("bush"), 0.42, 0.6),
      fern: foliageMaterial(fernTexture(), 0.45, 0.4),
      oakBark: barkMaterial("oak"),
      pineBark: barkMaterial("pine"),
      birchBark: barkMaterial("birch"),
    }),
    []
  );
  return (
    <group>
      {build.oakBark && <mesh geometry={build.oakBark} material={mats.oakBark} castShadow receiveShadow />}
      {build.pineBark && <mesh geometry={build.pineBark} material={mats.pineBark} castShadow receiveShadow />}
      {build.birchBark && <mesh geometry={build.birchBark} material={mats.birchBark} castShadow receiveShadow />}
      <CardMesh cards={build.broadCards} material={mats.broad} />
      <CardMesh cards={build.pineCards} material={mats.pine} />
      <CardMesh cards={build.birchCards} material={mats.birch} />
      <CardMesh cards={build.bushCards} material={mats.bush} />
      <CardMesh cards={build.fernCards} material={mats.fern} castShadow={false} />
    </group>
  );
}
