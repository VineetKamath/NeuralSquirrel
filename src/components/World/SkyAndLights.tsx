"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Experiment } from "@/simulation/Experiment";
import { createEnv, updateEnv } from "./environment";
import { focus, U } from "./sharedUniforms";

/** Sky dome, sun/moon light, hemisphere light, fog and shared uniforms. */
export function SkyAndLights({ experiment }: { experiment: Experiment }) {
  const { scene, gl } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const env = useMemo(() => createEnv(), []);
  const fog = useMemo(() => new THREE.FogExp2("#7d8a88", 0.015), []);

  const sky = useMemo(() => {
    const geo = new THREE.SphereGeometry(420, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: U.uSkyTop,
        uHorizon: U.uSkyHorizon,
        uFog: U.uFogColor,
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonIllum: { value: 0.5 },
        uSunColor: U.uSunColor,
        uNight: U.uNight,
        uTime: U.uTime,
      },
      vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`,
      fragmentShader: /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uMoonIllum;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.6, h), 0.7));
  col = mix(uFog, col, smoothstep(-0.05, 0.18, h));
  float s = max(dot(d, uSunDir), 0.0);
  float dayVis = smoothstep(-0.1, 0.05, uSunDir.y);
  col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 40.0) * 0.12 + pow(s, 6.0) * 0.05) * dayVis;
  // stars
  vec3 sp = floor(d * 380.0);
  float star = step(0.9965, hash(sp)) * smoothstep(0.05, 0.3, h);
  float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + hash(sp + 1.0) * 30.0);
  col += vec3(0.8, 0.85, 1.0) * star * twinkle * uNight * 0.9;
  // moon
  // the real moon: position and phase from the ephemeris
  float m = max(dot(d, uMoonDir), 0.0);
  float moonVis = smoothstep(-0.02, 0.03, uMoonDir.y) * (0.35 + 0.65 * smoothstep(-0.05, 0.3, -uSunDir.y));
  col += vec3(0.75, 0.8, 0.95) * (smoothstep(0.9994, 0.9997, m) * (0.4 + 1.2 * uMoonIllum) + pow(m, 60.0) * 0.06 * uMoonIllum) * moonVis;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
  }, []);

  useFrame((state) => {
    const w = experiment.world.state;
    updateEnv(env, w);
    U.uSnow.value = env.snowCover;
    U.uLeaf.value = w.env.leaf;
    U.uLeafColour.value = w.env.leafColour;
    // turf goes dormant through the cold months (grass colour follows the real calendar)
    U.uDormant.value = THREE.MathUtils.clamp((1 - w.env.leaf) * 1.2, 0, 1);
    U.uTime.value = state.clock.elapsedTime;
    U.uSunDir.value.copy(env.lightDir);
    U.uSunColor.value.copy(env.sunColor).multiplyScalar(env.sunIntensity * 0.42);
    U.uHemiSky.value.copy(env.hemiSky).multiplyScalar(env.hemiIntensity);
    U.uHemiGround.value.copy(env.hemiGround).multiplyScalar(env.hemiIntensity);
    U.uFogColor.value.copy(env.fogColor);
    U.uFogDensity.value = env.fogDensity;
    U.uSkyTop.value.copy(env.skyTop);
    U.uSkyHorizon.value.copy(env.skyHorizon);
    U.uNight.value = env.night;
    U.uRain.value = w.rainAmount;
    // real wind speed from the ERA5 record drives foliage and grass sway
    U.uWind.value = 0.25 + Math.min(2.2, w.env.windKmh / 14 + (w.env.gustKmh - w.env.windKmh) / 40) + Math.sin(state.clock.elapsedTime * 0.07) * 0.2;
    U.uFocus.value.copy(focus.position);
    // the sky dome's sun direction is the true sun, not the moon
    const skyU = (sky.material as THREE.ShaderMaterial).uniforms;
    skyU.uSunDir.value.copy(env.sunDir);
    skyU.uMoonDir.value.copy(env.moonDir);
    skyU.uMoonIllum.value = env.moonIllumination;

    fog.color.copy(env.fogColor);
    fog.density = env.fogDensity;
    if (scene.fog !== fog) scene.fog = fog;
    scene.background = env.fogColor;
    gl.toneMappingExposure = env.exposure;
    sky.position.copy(state.camera.position);

    const light = sun.current;
    if (light) {
      light.color.copy(env.sunColor);
      light.intensity = env.sunIntensity;
      // moonlight casts soft, faint shadows so the forest floor stays readable
      light.shadow.intensity = 1 - env.night * 0.7;
      light.position.copy(focus.position).addScaledVector(env.lightDir, 70);
      light.target.position.copy(focus.position);
      light.target.updateMatrixWorld();
    }
    if (hemi.current) {
      hemi.current.color.copy(env.hemiSky);
      hemi.current.groundColor.copy(env.hemiGround);
      hemi.current.intensity = env.hemiIntensity * 1.5;
    }
  });

  return (
    <>
      <primitive object={sky} />
      <hemisphereLight ref={hemi} args={["#9fb4c8", "#3a3322", 1]} />
      <directionalLight
        ref={sun}
        castShadow
        intensity={2}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-38}
        shadow-camera-right={38}
        shadow-camera-top={38}
        shadow-camera-bottom={-38}
        shadow-camera-near={1}
        shadow-camera-far={180}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
    </>
  );
}
