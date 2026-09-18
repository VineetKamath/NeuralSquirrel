import * as THREE from "three";

/** Uniform objects shared by every custom shader; updated once per frame. */
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uHemiSky: { value: new THREE.Color(0.6, 0.7, 0.8) },
  uHemiGround: { value: new THREE.Color(0.2, 0.18, 0.12) },
  uFogColor: { value: new THREE.Color(0.5, 0.55, 0.55) },
  uFogDensity: { value: 0.015 },
  uWind: { value: 1 },
  uRain: { value: 0 },
  uNight: { value: 0 },
  uFocus: { value: new THREE.Vector3() },
  uSkyTop: { value: new THREE.Color() },
  uSkyHorizon: { value: new THREE.Color() },
  /** 0 = bare ground, 1 = full snow cover (from real snow depth) */
  uSnow: { value: 0 },
  /** deciduous canopy fraction (real phenology) */
  uLeaf: { value: 1 },
  /** autumn colouring 0..1 */
  uLeafColour: { value: 0 },
  /** grass dormancy in cold months 0..1 */
  uDormant: { value: 0 },
};

/** a per-frame render-side focus point (smoothed squirrel position) */
export const focus = {
  position: new THREE.Vector3(),
  heading: 0,
  initialized: false,
};
