import type { Vector3 } from "@/types";

export const v3 = (x = 0, y = 0, z = 0): Vector3 => ({ x, y, z });
export const clone = (v: Vector3): Vector3 => ({ x: v.x, y: v.y, z: v.z });
export const dist2D = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v: number, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function angleTo(from: Vector3, to: Vector3) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function dampAngle(current: number, target: number, rate: number, dt: number) {
  const diff = wrapAngle(target - current);
  return current + diff * (1 - Math.exp(-rate * dt));
}

export function damp(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** distance from point to segment in XZ plane */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t);
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t, cx, cz };
}
