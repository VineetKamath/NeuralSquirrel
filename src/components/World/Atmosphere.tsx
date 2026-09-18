"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Experiment } from "@/simulation/Experiment";
import { focus, U } from "./sharedUniforms";
import { glowTexture } from "./textures";

function makeSnow() {
  const count = 3200;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 36;
    pos[i * 3 + 1] = Math.random() * 16;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 36;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uMap: { value: glowTexture() }, uTime: U.uTime, uFocus: U.uFocus, uOpacity: { value: 0 }, uWind: { value: 1 } },
    vertexShader: /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform vec3 uFocus;
uniform float uWind;
varying float vFade;
void main() {
  vec3 p = position;
  float fall = uTime * (0.7 + aSeed * 0.6);
  p.y = mod(p.y - fall, 16.0);
  p.x += sin(uTime * 0.8 + aSeed * 30.0) * 0.4 + uTime * uWind * 0.6;
  p.z += cos(uTime * 0.6 + aSeed * 17.0) * 0.4 + uTime * uWind * 0.25;
  vec2 rel = mod(p.xz - uFocus.xz + 18.0, 36.0) - 18.0;
  vec3 wp = vec3(uFocus.x + rel.x, uFocus.y + p.y - 3.0, uFocus.z + rel.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vFade = 1.0 - smoothstep(10.0, 18.0, length(rel));
  gl_PointSize = (0.05 + aSeed * 0.05) * 600.0 / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying float vFade;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a;
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), a * uOpacity * vFade);
}`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** Dust motes in daylight, fireflies on warm nights, rain streaks and snowfall from the real weather record. All follow the focus. */
export function Atmosphere({ experiment }: { experiment: Experiment }) {
  const { motes, flies, rain, snow } = useMemo(() => {
    const makePoints = (count: number, spread: number, height: number, size: number, color: string, additive: boolean) => {
      const pos = new Float32Array(count * 3);
      const seed = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * spread;
        pos[i * 3 + 1] = Math.random() * height;
        pos[i * 3 + 2] = (Math.random() - 0.5) * spread;
        seed[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uMap: { value: glowTexture() },
          uTime: U.uTime,
          uFocus: U.uFocus,
          uOpacity: { value: 0 },
          uSize: { value: size },
          uColor: { value: new THREE.Color(color) },
          uSpread: { value: spread },
          uHeight: { value: height },
        },
        vertexShader: /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform vec3 uFocus;
uniform float uSize;
uniform float uSpread;
uniform float uHeight;
varying float vSeed;
varying float vFade;
void main() {
  vec3 p = position;
  p.x += sin(uTime * (0.1 + aSeed * 0.3) + aSeed * 40.0) * 1.5;
  p.z += cos(uTime * (0.12 + aSeed * 0.2) + aSeed * 20.0) * 1.5;
  p.y += sin(uTime * 0.3 + aSeed * 13.0) * 0.6;
  // wrap around the focus so particles are always nearby
  vec2 rel = mod(p.xz - uFocus.xz + uSpread * 0.5, uSpread) - uSpread * 0.5;
  vec3 wp = vec3(uFocus.x + rel.x, uFocus.y + p.y - 0.5, uFocus.z + rel.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vSeed = aSeed;
  vFade = 1.0 - smoothstep(uSpread * 0.3, uSpread * 0.5, length(rel));
  gl_PointSize = uSize * (0.6 + aSeed * 0.8) * 300.0 / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
        fragmentShader: /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform vec3 uColor;
uniform float uTime;
varying float vSeed;
varying float vFade;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a;
  float flicker = 0.55 + 0.45 * sin(uTime * (1.5 + vSeed * 3.0) + vSeed * 50.0);
  gl_FragColor = vec4(uColor, a * uOpacity * vFade * flicker);
}`,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      return pts;
    };

    const rainCount = 2600;
    const rainGeo = new THREE.BufferGeometry();
    const rp = new Float32Array(rainCount * 6);
    for (let i = 0; i < rainCount; i++) {
      const x = (Math.random() - 0.5) * 40;
      const y = Math.random() * 20;
      const z = (Math.random() - 0.5) * 40;
      rp.set([x, y, z, x + 0.03, y - 0.45, z + 0.01], i * 6);
    }
    rainGeo.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    const rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: U.uTime, uFocus: U.uFocus, uOpacity: { value: 0 }, uColor: { value: new THREE.Color("#9fb0b8") } },
      vertexShader: /* glsl */ `
uniform float uTime;
uniform vec3 uFocus;
void main() {
  vec3 p = position;
  p.y = mod(p.y - uTime * 14.0, 20.0);
  vec3 wp = vec3(uFocus.x + p.x, uFocus.y + p.y - 4.0, uFocus.z + p.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
    });
    const rainLines = new THREE.LineSegments(rainGeo, rainMat);
    rainLines.frustumCulled = false;

    return {
      motes: makePoints(420, 26, 6, 0.05, "#fff1d6", true),
      flies: makePoints(90, 40, 2.5, 0.09, "#d8ff8a", true),
      rain: rainLines,
      snow: makeSnow(),
    };
  }, []);

  useFrame(() => {
    const w = experiment.world;
    const day = w.daylight;
    const rainAmt = w.state.rainAmount;
    (motes.material as THREE.ShaderMaterial).uniforms.uOpacity.value = day * (1 - rainAmt) * 0.28;
    (flies.material as THREE.ShaderMaterial).uniforms.uOpacity.value = (1 - day) * (1 - rainAmt) * 0.95;
    (rain.material as THREE.ShaderMaterial).uniforms.uOpacity.value = rainAmt * 0.32;
    rain.visible = rainAmt > 0.02;
    const snowAmt = w.state.snowAmount;
    const snowU = (snow.material as THREE.ShaderMaterial).uniforms;
    snowU.uOpacity.value = snowAmt * 0.9;
    snowU.uWind.value = Math.min(3, w.state.env.windKmh / 10);
    snow.visible = snowAmt > 0.02;
    // fireflies only fly on warm summer nights
    (flies.material as THREE.ShaderMaterial).uniforms.uOpacity.value *= THREE.MathUtils.clamp((w.state.env.tempC - 16) / 6, 0, 1);
    flies.visible = day < 0.8 && w.state.env.tempC > 16;
    void focus;
  });

  return (
    <group>
      <primitive object={motes} />
      <primitive object={flies} />
      <primitive object={rain} />
      <primitive object={snow} />
    </group>
  );
}
