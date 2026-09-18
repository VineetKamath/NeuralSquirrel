import * as THREE from "three";
import type { WorldModel } from "@/simulation/WorldModel";
import { WORLD_SIZE } from "@/simulation/constants";
import { LAND } from "@/real/site";
import { clamp } from "@/utils/math";

export const DATA_RES = 512;

export interface TerrainData {
  /** R height, G grass density, B canopy cover, A litter density */
  texture: THREE.DataTexture;
  seed: number;
  version: number;
}

let cached: TerrainData | null = null;

export function getTerrainData(world: WorldModel): TerrainData {
  const version = world.state.structureVersion;
  if (cached && cached.seed === world.state.seed && cached.version === version) return cached;
  cached?.texture.dispose();
  const data = new Float32Array(DATA_RES * DATA_RES * 4);
  const t = world.terrain;
  const site = t.site;
  for (let j = 0; j < DATA_RES; j++) {
    for (let i = 0; i < DATA_RES; i++) {
      const x = (i / (DATA_RES - 1)) * WORLD_SIZE - WORLD_SIZE / 2;
      const z = (j / (DATA_RES - 1)) * WORLD_SIZE - WORLD_SIZE / 2;
      const h = t.height(x, z);
      const land = site.landAt(x, z);
      const path = site.pathFactor(x, z);
      const cover = world.coverAt(x, z);
      const shore = site.shoreFactor(x, z);
      const blocked = land === LAND.WATER || land === LAND.BUILDING ? 1 : 0;
      // real land cover: lawns are dense turf, woodland floor has sparse grass and deep leaf litter
      const base = land === LAND.LAWN ? 1 : land === LAND.WOOD ? 0.28 : land === LAND.SCRUB ? 0.55 : land === LAND.ROCK ? 0.12 : 0;
      const grass = clamp(base * (1 - path * 1.2) * (1 - cover * 0.6) * (1 - shore)) * (1 - blocked);
      const litter = clamp((land === LAND.WOOD ? 0.9 : 0.25) * (0.4 + cover * 0.8) * (1 - path * 0.9) * (1 - shore)) * (1 - blocked);
      const k = (j * DATA_RES + i) * 4;
      data[k] = h;
      data[k + 1] = grass;
      data[k + 2] = cover;
      data[k + 3] = litter;
    }
  }
  const texture = new THREE.DataTexture(data, DATA_RES, DATA_RES, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  cached = { texture, seed: world.state.seed, version };
  return cached;
}

export const sampleDataGLSL = /* glsl */ `
uniform sampler2D uData;
const float DATA_RES = ${DATA_RES.toFixed(1)};
const float WORLD_SIZE = ${WORLD_SIZE.toFixed(1)};
vec4 sampleData(vec2 xz) {
  vec2 uv = (xz + WORLD_SIZE * 0.5) / WORLD_SIZE * (DATA_RES - 1.0);
  uv = clamp(uv, vec2(0.0), vec2(DATA_RES - 1.001));
  vec2 i = floor(uv);
  vec2 f = uv - i;
  vec4 a = texture2D(uData, (i + vec2(0.5, 0.5)) / DATA_RES);
  vec4 b = texture2D(uData, (i + vec2(1.5, 0.5)) / DATA_RES);
  vec4 c = texture2D(uData, (i + vec2(0.5, 1.5)) / DATA_RES);
  vec4 d = texture2D(uData, (i + vec2(1.5, 1.5)) / DATA_RES);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;
