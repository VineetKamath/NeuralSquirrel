import * as THREE from "three";

let patched = false;

/**
 * Replace three's exponential fog with a height-aware variant: valleys and the
 * forest floor hold denser mist, giving a volumetric impression at little cost.
 */
export function patchFogChunks() {
  if (patched) return;
  patched = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogWorldY;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWP = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    fogWP = batchingMatrix * fogWP;
  #endif
  #ifdef USE_INSTANCING
    fogWP = instanceMatrix * fogWP;
  #endif
  vFogWorldY = ( modelMatrix * fogWP ).y;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogWorldY;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    float fogHeight = exp( - max( vFogWorldY + 1.5, 0.0 ) * 0.075 );
    fogFactor *= mix( 0.6, 1.0, fogHeight );
    fogFactor = clamp( fogFactor + fogHeight * 0.08 * smoothstep( 1.5, 40.0, vFogDepth ), 0.0, 1.0 );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

/** GLSL snippet for custom shaders that want the same fog */
export const customFogGLSL = /* glsl */ `
vec3 applyFog(vec3 col, float depth, float worldY, vec3 fogCol, float density) {
  float f = 1.0 - exp(-density * density * depth * depth);
  float fh = exp(-max(worldY + 1.5, 0.0) * 0.075);
  f *= mix(0.6, 1.0, fh);
  f = clamp(f + fh * 0.08 * smoothstep(1.5, 40.0, depth), 0.0, 1.0);
  return mix(col, fogCol, f);
}
`;
