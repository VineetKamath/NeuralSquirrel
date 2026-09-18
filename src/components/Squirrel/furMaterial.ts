import * as THREE from "three";

export const SHELLS = 12;

/**
 * Shell-textured fur. The mesh is drawn as an InstancedMesh with SHELLS instances;
 * each instance is pushed outward along the normal and thinned by a strand mask.
 */
export function createFurMaterial(opts: { length: number; density: number; clump?: number; gravity?: number; baseDark?: number }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const uniforms = {
    uFurLength: { value: opts.length },
    uDensity: { value: opts.density },
    uGravity: { value: opts.gravity ?? 0.35 },
    uShells: { value: SHELLS },
    uBaseDark: { value: opts.baseDark ?? 0.45 },
    uMotion: { value: new THREE.Vector3() },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uFurLength;
uniform float uShells;
uniform float uGravity;
uniform vec3 uMotion;
varying float vShell;
varying vec2 vFurUv;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float shellK = float(gl_InstanceID) / (uShells - 1.0);
vShell = shellK;
vFurUv = uv;
transformed += objectNormal * shellK * uFurLength;
transformed.y -= shellK * shellK * uFurLength * uGravity;
transformed -= uMotion * shellK * shellK * uFurLength;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uDensity;
uniform float uBaseDark;
varying float vShell;
varying vec2 vFurUv;
float furHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec2 furCell = floor(vFurUv * vec2(uDensity * 2.0, uDensity));
vec2 furF = fract(vFurUv * vec2(uDensity * 2.0, uDensity)) - 0.5;
float strand = furHash(furCell);
float thickness = (1.0 - vShell) * 0.55 + 0.25;
if (vShell > 0.001 && (strand < vShell * 0.7 || length(furF) > thickness)) discard;
diffuseColor.rgb *= mix(uBaseDark, 1.0, vShell) * (0.85 + strand * 0.3);
// frosted tips
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.15 + 0.01, smoothstep(0.8, 1.0, vShell) * step(0.8, strand));`
      );
  };
  return { material: mat, uniforms };
}

export function furMesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.InstancedMesh(geometry, material, SHELLS);
  const id = new THREE.Matrix4();
  for (let i = 0; i < SHELLS; i++) mesh.setMatrixAt(i, id);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** colour a geometry: dorsal coat vs ventral cream, with a darker stripe along the back */
export function paintCoat(geo: THREE.BufferGeometry, dorsal: THREE.Color, ventral: THREE.Color, flank: THREE.Color, stripe = 0) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i);
    const nx = nor.getX(i);
    c.copy(ventral).lerp(flank, THREE.MathUtils.smoothstep(ny, -0.75, -0.1));
    c.lerp(dorsal, THREE.MathUtils.smoothstep(ny, -0.1, 0.55));
    if (stripe) c.multiplyScalar(1 - stripe * Math.exp(-nx * nx * 30) * Math.max(0, ny));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}
