"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { WorldModel } from "@/simulation/WorldModel";
import { WORLD_SIZE } from "@/simulation/constants";
import { clamp } from "@/utils/math";
import { ValueNoise } from "@/utils/rng";
import { LAND } from "@/real/site";
import { U } from "./sharedUniforms";

const SEGMENTS = 400;

export function TerrainMesh({ world }: { world: WorldModel }) {
  const { geometry, material } = useMemo(() => {
    const t = world.terrain;
    const site = t.site;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const noise = new ValueNoise(20181006 ^ 0x77);
    const woodFloor = new THREE.Color("#4a3a28");
    const litter = new THREE.Color("#6a4e30");
    const lawn = new THREE.Color("#5b6e33");
    const lawnWorn = new THREE.Color("#7a7248");
    const moss = new THREE.Color("#4a5c34");
    const asphalt = new THREE.Color("#57534e");
    const rock = new THREE.Color("#6f6c66");
    const mud = new THREE.Color("#2b261f");
    const stone = new THREE.Color("#8a8479");
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, t.height(x, z));
      const land = site.landAt(x, z);
      const path = site.pathFactor(x, z);
      const n1 = noise.fbm(x * 0.08, z * 0.08, 3);
      const n2 = noise.noise(x * 0.6 + 40, z * 0.6);
      if (land === LAND.LAWN) c.copy(lawn).lerp(lawnWorn, clamp(n1 * 0.9 - 0.2));
      else if (land === LAND.WOOD) c.copy(litter).lerp(woodFloor, clamp(n2 * 0.8)).lerp(moss, clamp(n1 - 0.45) * 0.8);
      else if (land === LAND.ROCK) c.copy(rock).lerp(moss, clamp(n1 - 0.5));
      else if (land === LAND.BUILDING) c.copy(stone);
      else if (land === LAND.SCRUB) c.copy(lawnWorn).lerp(litter, 0.5);
      else c.copy(mud);
      // Central Park paths are asphalt with worn verges
      c.lerp(asphalt, path * 0.92);
      c.lerp(mud, site.shoreFactor(x, z) * 0.75);
      const v = 0.86 + n2 * 0.28;
      colors[i * 3] = c.r * v;
      colors[i * 3 + 1] = c.g * v;
      colors[i * 3 + 2] = c.b * v;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSnow = U.uSnow;
      shader.uniforms.uDormant = U.uDormant;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vTerrainWorld;\nvarying float vUp;")
        .replace(
          "#include <fog_vertex>",
          "#include <fog_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUp = normal.y;"
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vTerrainWorld;
varying float vUp;
uniform float uSnow;
uniform float uDormant;
float tHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  vec2 p = vTerrainWorld.xz;
  float n = tNoise(p * 2.3) * 0.5 + tNoise(p * 7.1) * 0.3 + tNoise(p * 23.0) * 0.2;
  float speck = step(0.82, tNoise(p * 31.0));
  diffuseColor.rgb *= 0.8 + n * 0.4;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.35, 1.05, 0.7), speck * 0.35);
  // dormant winter turf turns straw-coloured
  float green = clamp((diffuseColor.g - diffuseColor.r) * 6.0, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 0.95, 0.7), uDormant * green * 0.6);
  // real snow depth: accumulates on flat ground first, broken up by noise
  float snowMask = smoothstep(0.55, 0.9, vUp) * smoothstep(0.0, 0.35, uSnow + (n - 0.5) * 0.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), snowMask * clamp(uSnow * 1.6, 0.0, 1.0));
}`
        );
    };
    return { geometry: geo, material: mat };
  }, [world]);

  return <mesh geometry={geometry} material={material} receiveShadow />;
}
