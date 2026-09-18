"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Experiment } from "@/simulation/Experiment";
import { getTerrainData, sampleDataGLSL } from "./terrainData";
import { U } from "./sharedUniforms";
import { customFogGLSL } from "./fogChunks";

function waterMaterial(dataTex: THREE.Texture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uData: { value: dataTex },
      uRise: { value: 0 },
      uTime: U.uTime,
      uSunDir: U.uSunDir,
      uSunColor: U.uSunColor,
      uSkyTop: U.uSkyTop,
      uSkyHorizon: U.uSkyHorizon,
      uFogColor: U.uFogColor,
      uFogDensity: U.uFogDensity,
      uRain: U.uRain,
      uHemiSky: U.uHemiSky,
    },
    vertexShader: /* glsl */ `
attribute float aLevel;
uniform float uRise;
varying vec3 vWorld;
varying float vDepth;
varying float vLevel;
void main() {
  vLevel = aLevel + uRise;
  vec4 wp = modelMatrix * vec4(position + vec3(0.0, uRise, 0.0), 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
${sampleDataGLSL}
${customFogGLSL}
varying float vLevel;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uRain;
uniform vec3 uHemiSky;
varying vec3 vWorld;
varying float vDepth;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 waves(vec2 p) {
  vec2 d = vec2(0.0);
  d += vec2(cos(p.x * 1.7 + uTime * 0.9), sin(p.y * 1.3 + uTime * 0.7)) * 0.03;
  d += vec2(sin(p.y * 4.1 - uTime * 1.3 + p.x), cos(p.x * 3.7 + uTime * 1.1)) * 0.015;
  d += vec2(sin(p.x * 9.0 + p.y * 7.0 + uTime * 2.3), cos(p.y * 11.0 - uTime * 2.0)) * 0.006;
  return d;
}
vec2 rainRipples(vec2 p) {
  vec2 cell = floor(p * 1.6);
  vec2 f = fract(p * 1.6) - 0.5;
  float h = hash(cell);
  float t = fract(uTime * 0.9 + h);
  vec2 c = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
  float r = length(f - c * 0.6);
  float ring = sin((r - t * 0.5) * 60.0) * smoothstep(0.5, 0.0, abs(r - t * 0.5) * 6.0) * (1.0 - t);
  return normalize(f - c * 0.6 + 1e-4) * ring * 0.08;
}
void main() {
  float ground = sampleData(vWorld.xz).r;
  float depth = vLevel - ground;
  if (depth < -0.02) discard;
  vec2 d = waves(vWorld.xz) + rainRipples(vWorld.xz) * uRain;
  vec3 n = normalize(vec3(-d.x, 1.0, -d.y));
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
  vec3 r = reflect(-viewDir, n);
  vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(r.y * 1.6, 0.0, 1.0));
  // the surrounding forest darkens reflections near the horizon
  sky = mix(sky * 0.28 + vec3(0.01, 0.015, 0.01), sky, smoothstep(0.08, 0.5, r.y));
  vec3 deep = vec3(0.01, 0.025, 0.02);
  vec3 shallow = vec3(0.07, 0.075, 0.05);
  vec3 base = mix(shallow, deep, smoothstep(0.0, 1.1, depth)) * (uHemiSky * 0.8 + 0.2);
  float spec = pow(max(dot(r, uSunDir), 0.0), 240.0) * 6.0 + pow(max(dot(r, uSunDir), 0.0), 18.0) * 0.12;
  vec3 col = mix(base, sky, fres) + uSunColor * spec * step(0.0, uSunDir.y);
  float edge = smoothstep(-0.02, 0.25, depth);
  float alpha = clamp(mix(0.25, 0.94, smoothstep(0.0, 0.7, depth)) + fres * 0.3, 0.0, 1.0) * edge;
  col = applyFog(col, vDepth, vWorld.y, uFogColor, uFogDensity);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}

/** one mesh per real OSM water body (The Lake, Azalea Pond…) at its DEM-derived level, plus ribbons for The Gill */
function buildWater(world: Experiment["world"]) {
  const site = world.terrain.site;
  const geos: THREE.BufferGeometry[] = [];
  for (const body of site.waterBodies) {
    if (body.kind === "stream") {
      const pts = body.poly;
      if (pts.length < 2) continue;
      const pos: number[] = [];
      const lvl: number[] = [];
      const idx: number[] = [];
      const half = 1.1;
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        const [px, pz] = pts[Math.max(0, i - 1)];
        const [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
        let dx = nx - px;
        let dz = nz - pz;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const y = site.height(x, z) + 0.14;
        pos.push(x - dz * half, y, z + dx * half, x + dz * half, y, z - dx * half);
        lvl.push(y, y);
        if (i > 0) {
          const a = (i - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aLevel", new THREE.Float32BufferAttribute(lvl, 1));
      g.setIndex(idx);
      geos.push(g);
      continue;
    }
    if (body.poly.length < 3) continue;
    const shape = new THREE.Shape(body.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape, 1);
    g.rotateX(-Math.PI / 2);
    const count = g.attributes.position.count;
    const arr = g.attributes.position.array as Float32Array;
    for (let k = 0; k < count; k++) arr[k * 3 + 1] = body.level;
    g.setAttribute("aLevel", new THREE.Float32BufferAttribute(new Float32Array(count).fill(body.level), 1));
    geos.push(g);
  }
  return geos;
}

export function Water({ experiment }: { experiment: Experiment }) {
  const world = experiment.world;
  const puddleGroup = useRef<THREE.Group>(null);
  const version = useRef(-1);
  const { meshes, material, puddleMat } = useMemo(() => {
    const data = getTerrainData(world);
    const mat = waterMaterial(data.texture);
    const list = buildWater(world).map((g) => {
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 2;
      return m;
    });
    const pmat = new THREE.MeshStandardMaterial({ color: "#1a1f1f", roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.8 });
    return { meshes: list, material: mat, puddleMat: pmat };
  }, [world]);

  useFrame(() => {
    // real rainfall raises the water: storms swell the lake and the Gill
    material.uniforms.uRise.value = world.state.floodRise;
    const g = puddleGroup.current;
    if (!g || world.state.foodVersion === version.current) return;
    version.current = world.state.foodVersion;
    while (g.children.length) {
      const c = g.children.pop() as THREE.Mesh;
      c.geometry.dispose();
    }
    for (const w of world.state.waterSources) {
      if (w.kind !== "puddle" || w.amount < 0.05) continue;
      const geo = new THREE.CircleGeometry(w.radius * (0.4 + w.amount * 0.6), 24);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, puddleMat);
      m.position.set(w.position.x, world.terrain.height(w.position.x, w.position.z) + 0.03, w.position.z);
      m.receiveShadow = true;
      g.add(m);
    }
  });

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <group ref={puddleGroup} />
    </group>
  );
}
