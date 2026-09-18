import * as THREE from "three";
import type { EnvironmentState, WorldState } from "@/types";
import { skyDirection } from "@/real/astronomy";

/**
 * Sky and light keyframes indexed by the real solar elevation (degrees) rather than clock time,
 * so dawn, dusk and day length follow the true NOAA sun position for Central Park.
 */
interface Key {
  el: number;
  top: string;
  horizon: string;
  fog: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  exposure: number;
}

const KEYS: Key[] = [
  { el: -90, top: "#0b1628", horizon: "#1f2e46", fog: "#1b2638", sun: "#a9c0f0", sunI: 1.5, hemiSky: "#6a86b4", hemiGround: "#252c38", hemiI: 1.6, exposure: 1.85 },
  { el: -12, top: "#0e1a30", horizon: "#27324c", fog: "#1e283a", sun: "#a9c0f0", sunI: 1.5, hemiSky: "#6a7fae", hemiGround: "#252c38", hemiI: 1.55, exposure: 1.75 },
  { el: -5, top: "#1d2c44", horizon: "#6a5068", fog: "#3a3844", sun: "#c89aa0", sunI: 1.2, hemiSky: "#5a6c88", hemiGround: "#2a2420", hemiI: 1.1, exposure: 1.4 },
  { el: 0, top: "#2c3a58", horizon: "#d8845a", fog: "#5e4a48", sun: "#ff8a4a", sunI: 1.6, hemiSky: "#6a6c84", hemiGround: "#2a1e16", hemiI: 0.8, exposure: 1.22 },
  { el: 6, top: "#46668c", horizon: "#c8a484", fog: "#7a7a72", sun: "#ffc890", sunI: 2.9, hemiSky: "#9aa8bc", hemiGround: "#3a3120", hemiI: 1.0, exposure: 1.1 },
  { el: 20, top: "#5476a0", horizon: "#b9c0bc", fog: "#8a9692", sun: "#ffe8cc", sunI: 3.7, hemiSky: "#aabdce", hemiGround: "#3e3726", hemiI: 1.12, exposure: 1.05 },
  { el: 45, top: "#5a7fa8", horizon: "#b6c4c6", fog: "#8e9c98", sun: "#fff3e2", sunI: 4.2, hemiSky: "#b3c6d6", hemiGround: "#40392a", hemiI: 1.2, exposure: 1.03 },
  { el: 90, top: "#5a7fa8", horizon: "#b6c4c6", fog: "#8e9c98", sun: "#fff3e2", sunI: 4.3, hemiSky: "#b3c6d6", hemiGround: "#40392a", hemiI: 1.2, exposure: 1.03 },
];

export interface EnvState {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  lightDir: THREE.Vector3;
  isDay: boolean;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  exposure: number;
  night: number;
  moonIllumination: number;
  snowCover: number;
}

const c1 = new THREE.Color();
const c2 = new THREE.Color();
const grey = new THREE.Color("#7d8583");
const rainGrey = new THREE.Color("#4c5456");
const snowWhite = new THREE.Color("#b8c0c8");

function mix(out: THREE.Color, a: string, b: string, t: number) {
  c1.set(a);
  c2.set(b);
  return out.copy(c1).lerp(c2, t);
}

export function createEnv(): EnvState {
  return {
    sunDir: new THREE.Vector3(0, 1, 0),
    moonDir: new THREE.Vector3(0, 1, 0),
    lightDir: new THREE.Vector3(0, 1, 0),
    isDay: true,
    sunColor: new THREE.Color(),
    sunIntensity: 1,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
    skyTop: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogDensity: 0.015,
    exposure: 1,
    night: 0,
    moonIllumination: 0.5,
    snowCover: 0,
  };
}

export function updateEnv(env: EnvState, w: WorldState) {
  const e: EnvironmentState = w.env;
  const el = e.sunElevation;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].el <= el) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = THREE.MathUtils.smoothstep(el, a.el, b.el);

  mix(env.skyTop, a.top, b.top, t);
  mix(env.skyHorizon, a.horizon, b.horizon, t);
  mix(env.fogColor, a.fog, b.fog, t);
  mix(env.sunColor, a.sun, b.sun, t);
  mix(env.hemiSky, a.hemiSky, b.hemiSky, t);
  mix(env.hemiGround, a.hemiGround, b.hemiGround, t);
  env.sunIntensity = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
  env.hemiIntensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);
  env.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, t);

  const sd = skyDirection({ elevation: el, azimuth: e.sunAzimuth });
  env.sunDir.set(sd.x, sd.y, sd.z);
  const md = skyDirection({ elevation: e.moonElevation, azimuth: e.moonAzimuth });
  env.moonDir.set(md.x, md.y, md.z);
  env.moonIllumination = e.moonIllumination;
  env.isDay = el > -1;
  env.night = THREE.MathUtils.clamp((-el - 1) / 7, 0, 1);

  if (env.isDay) {
    env.lightDir.copy(env.sunDir);
  } else {
    // the real moon lights the night when it is up; otherwise a soft skyglow from the city (Manhattan)
    const moonUp = THREE.MathUtils.clamp(e.moonElevation / 10, 0, 1);
    const moonLight = moonUp * (0.35 + 0.65 * e.moonIllumination);
    if (moonUp > 0.05) env.lightDir.copy(env.moonDir);
    else env.lightDir.set(0.25, 1, 0.35);
    // never fully dark: the park sits inside the brightest skyglow in North America
    const dim = 0.72 + 0.28 * moonLight;
    env.sunIntensity *= env.night > 0.5 ? dim : 1;
    env.hemiIntensity *= env.night > 0.5 ? 0.85 + 0.15 * moonLight : 1;
  }
  env.lightDir.y = Math.max(env.lightDir.y, 0.12);
  env.lightDir.normalize();

  // real cloud cover, rain, snow and fog
  const overcast = Math.max(w.fogAmount * 0.7, w.rainAmount, w.snowAmount * 0.8, (e.cloud / 100) * 0.6);
  env.sunIntensity *= 1 - overcast * 0.72;
  env.hemiIntensity *= 1 + overcast * 0.15;
  const tint = w.snowAmount > 0.2 ? snowWhite : w.rainAmount > 0.3 ? rainGrey : grey;
  if (env.night < 0.5) env.fogColor.lerp(tint, overcast * 0.55);
  env.skyHorizon.lerp(env.fogColor, 0.35 + overcast * 0.5);
  env.skyTop.lerp(env.fogColor, overcast * 0.6);
  env.fogDensity = 0.0085 + w.fogAmount * 0.03 + w.rainAmount * 0.008 + w.snowAmount * 0.012;
  // snow lying on the ground brightens the whole scene
  env.snowCover = THREE.MathUtils.clamp(e.snowDepthM / 0.06, 0, 1);
  env.hemiIntensity *= 1 + env.snowCover * 0.25;
  return env;
}
