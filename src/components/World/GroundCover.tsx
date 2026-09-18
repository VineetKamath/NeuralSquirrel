"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldModel } from "@/simulation/WorldModel";
import { getTerrainData, sampleDataGLSL } from "./terrainData";
import { focus, U } from "./sharedUniforms";
import { customFogGLSL } from "./fogChunks";
import { litterTexture } from "./textures";
import { useLab } from "@/store/labStore";

const lightingGLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform vec3 uFogColor;
uniform float uFogDensity;
`;

function gridOffsets(radius: number, spacing: number) {
  const n = Math.floor(radius / spacing);
  const arr: number[] = [];
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      if (i * i + j * j > n * n) continue;
      arr.push(i, j);
    }
  }
  return new Float32Array(arr);
}

/** GPU grass: a camera-following patch of blades anchored to world cells. */
function Grass({ world, RADIUS, SPACING }: { world: WorldModel; RADIUS: number; SPACING: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const { geometry, material } = useMemo(() => {
    const base = new THREE.BufferGeometry();
    const segs = 4;
    const verts: number[] = [];
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      verts.push(-0.5, t, 0, 0.5, t, 0);
    }
    verts.push(0, 1, 0);
    const idx: number[] = [];
    for (let i = 0; i < segs - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    idx.push((segs - 1) * 2, (segs - 1) * 2 + 1, segs * 2);
    base.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    base.setIndex(idx);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    const offsets = gridOffsets(RADIUS, SPACING);
    geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 2));
    geo.instanceCount = offsets.length / 2;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const data = getTerrainData(world);
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uData: { value: data.texture },
        uCenter: { value: new THREE.Vector2() },
        uSpacing: { value: SPACING },
        uRadius: { value: RADIUS },
        uTime: U.uTime,
        uWind: U.uWind,
        uFocus: U.uFocus,
        uSunDir: U.uSunDir,
        uSunColor: U.uSunColor,
        uHemiSky: U.uHemiSky,
        uHemiGround: U.uHemiGround,
        uFogColor: U.uFogColor,
        uFogDensity: U.uFogDensity,
        uSnow: U.uSnow,
        uDormant: U.uDormant,
      },
      vertexShader: /* glsl */ `
${sampleDataGLSL}
attribute vec2 aOffset;
uniform vec2 uCenter;
uniform float uSpacing;
uniform float uRadius;
uniform float uTime;
uniform float uWind;
uniform vec3 uFocus;
uniform float uSnow;
uniform float uDormant;
varying float vT;
varying vec3 vColor;
varying float vDepth;
varying float vWorldY;
varying float vCover;
varying vec3 vWorld;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 cell = floor(uCenter / uSpacing) + aOffset;
  float h1 = hash(cell);
  float h2 = hash(cell + 17.31);
  float h3 = hash(cell + 41.73);
  float h4 = hash(cell + 5.17);
  vec2 xz = cell * uSpacing + (vec2(h1, h2) - 0.5) * uSpacing * 1.7;
  vec4 d = sampleData(xz);
  float dist = length(xz - uFocus.xz);
  float fade = 1.0 - smoothstep(uRadius * 0.5, uRadius * 0.97, dist);
  float keep = step(h3, d.g * 1.15) * fade;
  float height = (0.08 + 0.26 * h4 * h4) * (0.55 + d.g * 0.8) * keep * (1.0 - smoothstep(0.1, 0.6, uSnow) * 0.9) * (1.0 - uDormant * 0.35);
  float angle = hash(cell + 9.91) * 6.2831;
  float t = position.y;
  vT = t;
  float width = 0.022 * (0.7 + h1 * 0.6) * keep;
  vec2 across = vec2(cos(angle), sin(angle));
  vec3 wp = vec3(xz.x, d.r - 0.02, xz.y);
  wp.xz += across * position.x * width * (1.0 - t * 0.9);
  wp.y += t * height;
  float gust = sin(uTime * 1.3 + xz.x * 0.21 + xz.y * 0.13) * 0.5 + 0.5;
  float w = sin(uTime * 2.2 + xz.x * 0.9 + xz.y * 0.6 + h2 * 3.0) * (0.35 + gust * 0.65);
  vec2 lean = vec2(-across.y, across.x) * (h2 - 0.5) * 0.9 + vec2(0.8, 0.35) * w * uWind * 0.55;
  wp.xz += lean * t * t * height;
  wp.y -= length(lean) * t * t * height * 0.25;
  vec3 dry = vec3(0.36, 0.3, 0.14);
  vec3 green = mix(vec3(0.12, 0.17, 0.05), vec3(0.24, 0.3, 0.09), h4);
  vColor = mix(green, dry, clamp(smoothstep(0.55, 0.95, h2) * 0.55 + uDormant * 0.65, 0.0, 1.0));
  vCover = d.b;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDepth = -mv.z;
  vWorldY = wp.y;
  vWorld = wp;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */ `
${lightingGLSL}
${customFogGLSL}
varying float vT;
varying vec3 vColor;
varying float vDepth;
varying float vWorldY;
varying float vCover;
varying vec3 vWorld;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float ao = mix(0.28, 1.0, vT * vT);
  float sun = max(uSunDir.y, 0.0) * (1.0 - vCover * 0.72);
  vec3 light = mix(uHemiGround, uHemiSky, 0.5 + vT * 0.5) * 0.9 + uSunColor * sun * (0.55 + 0.45 * vT);
  float trans = pow(max(dot(viewDir, -uSunDir), 0.0), 5.0) * vT * (1.0 - vCover * 0.8);
  vec3 col = vColor * ao * light + vColor * uSunColor * trans * 0.9;
  col = applyFog(col, vDepth, vWorldY, uFogColor, uFogDensity);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    return { geometry: geo, material: mat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, RADIUS, SPACING]);

  useFrame(() => {
    const m = material as THREE.ShaderMaterial;
    m.uniforms.uCenter.value.set(focus.position.x, focus.position.z);
  });

  return <mesh ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}

/** fallen leaves lying on the forest floor around the focus */
function Litter({ world }: { world: WorldModel }) {
  const RADIUS = 11;
  const SPACING = 0.16;
  const { geometry, material } = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1);
    base.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const offsets = gridOffsets(RADIUS, SPACING);
    geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 2));
    geo.instanceCount = offsets.length / 2;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const data = getTerrainData(world);
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uData: { value: data.texture },
        uMap: { value: litterTexture() },
        uCenter: { value: new THREE.Vector2() },
        uSpacing: { value: SPACING },
        uRadius: { value: RADIUS },
        uFocus: U.uFocus,
        uSunDir: U.uSunDir,
        uSunColor: U.uSunColor,
        uHemiSky: U.uHemiSky,
        uHemiGround: U.uHemiGround,
        uFogColor: U.uFogColor,
        uFogDensity: U.uFogDensity,
        uSnowL: U.uSnow,
      },
      vertexShader: /* glsl */ `
${sampleDataGLSL}
attribute vec2 aOffset;
uniform vec2 uCenter;
uniform float uSpacing;
uniform float uRadius;
uniform vec3 uFocus;
uniform float uSnowL;
varying vec2 vUv;
varying float vDepth;
varying float vWorldY;
varying float vCover;
varying float vTone;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1137); p3 += dot(p3, p3.yzx + 19.19); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 cell = floor(uCenter / uSpacing) + aOffset;
  float h1 = hash(cell);
  float h2 = hash(cell + 3.7);
  float h3 = hash(cell + 11.3);
  vec2 xz = cell * uSpacing + (vec2(h1, h2) - 0.5) * uSpacing * 2.0;
  vec4 d = sampleData(xz);
  float dist = length(xz - uFocus.xz);
  float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, dist);
  float keep = step(h3, d.a * 0.85) * fade * (1.0 - smoothstep(0.15, 0.5, uSnowL));
  float size = (0.07 + h2 * 0.07) * keep;
  float a = h1 * 6.2831;
  vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xz * size;
  vec3 wp = vec3(xz.x + p.x, d.r + 0.012 + h3 * 0.01, xz.y + p.y);
  float atlas = floor(hash(cell + 7.1) * 4.0);
  vUv = (uv + vec2(mod(atlas, 2.0), floor(atlas / 2.0))) * 0.5;
  vCover = d.b;
  vTone = 0.6 + h3 * 0.6;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDepth = -mv.z;
  vWorldY = wp.y;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */ `
${lightingGLSL}
${customFogGLSL}
uniform sampler2D uMap;
varying vec2 vUv;
varying float vDepth;
varying float vWorldY;
varying float vCover;
varying float vTone;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.5) discard;
  vec3 light = uHemiSky * 0.55 + uHemiGround * 0.35 + uSunColor * max(uSunDir.y, 0.0) * (1.0 - vCover * 0.7) * 0.7;
  vec3 col = tex.rgb * vTone * light;
  col = applyFog(col, vDepth, vWorldY, uFogColor, uFogDensity);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    return { geometry: geo, material: mat };
  }, [world]);

  useFrame(() => {
    material.uniforms.uCenter.value.set(focus.position.x, focus.position.z);
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

export function GroundCover({ world }: { world: WorldModel }) {
  const quality = useLab((s) => s.quality);
  // phones draw far fewer blades (≈9k vs ≈58k) and skip the leaf litter
  const grass = quality === "low" ? { r: 9, s: 0.17 } : quality === "medium" ? { r: 12, s: 0.13 } : { r: 15, s: 0.11 };
  return (
    <>
      <Grass key={quality} world={world} RADIUS={grass.r} SPACING={grass.s} />
      {quality !== "low" && <Litter world={world} />}
    </>
  );
}
