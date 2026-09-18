import { getSite, LAND } from "@/real/site";
import { WORLD_HALF, WORLD_SIZE } from "@/simulation/constants";

/** pixels per metre of the cached base map */
export const BASE_PPM = 2;

const COVER: Record<number, [number, number, number]> = {
  [LAND.LAWN]: [44, 58, 36],
  [LAND.WOOD]: [27, 44, 30],
  [LAND.WATER]: [14, 36, 52],
  [LAND.ROCK]: [66, 66, 60],
  [LAND.BUILDING]: [88, 82, 72],
  [LAND.SCRUB]: [44, 52, 34],
};

export const COVER_NAMES: Record<number, string> = {
  [LAND.LAWN]: "LAWN",
  [LAND.WOOD]: "WOODLAND",
  [LAND.WATER]: "WATER",
  [LAND.ROCK]: "ROCK OUTCROP",
  [LAND.BUILDING]: "BUILDING",
  [LAND.SCRUB]: "SCRUB",
};

let cached: HTMLCanvasElement | null = null;

/**
 * Cartographic base map of the real site: land cover from OpenStreetMap, hillshade and 1 m contours
 * from the USGS-derived elevation model, footpaths and bridges. Built once and cached.
 */
export function getMapBase(): HTMLCanvasElement {
  if (cached) return cached;
  const site = getSite();
  const n = WORLD_SIZE * BASE_PPM;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  const H = new Float32Array((n + 2) * (n + 2));
  const step = 1 / BASE_PPM;
  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      const x = (i + 0.5) * step - WORLD_HALF;
      const z = (j + 0.5) * step - WORLD_HALF;
      H[(j + 1) * (n + 2) + (i + 1)] = site.height(x, z);
    }
  }
  const h = (i: number, j: number) => H[(j + 1) * (n + 2) + (i + 1)];
  // sun from the north-west at 45°, the cartographic convention
  const lx = -0.5;
  const lz = -0.5;
  const ly = 0.7071;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * step - WORLD_HALF;
      const z = (j + 0.5) * step - WORLD_HALF;
      const land = site.landAt(x, z);
      const base = COVER[land] ?? COVER[LAND.LAWN];
      const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * step);
      const dz = (h(i, j + 1) - h(i, j - 1)) / (2 * step);
      const len = Math.hypot(dx, 1, dz);
      const shade = Math.max(0, (-dx * lx + ly - dz * lz) / len);
      const lit = land === LAND.WATER ? 1 : 0.55 + shade * 0.75;
      let r = base[0] * lit;
      let g = base[1] * lit;
      let b = base[2] * lit;
      // footpaths and bridges
      const path = site.pathFactor(x, z);
      if (path > 0.35) {
        const k = Math.min(1, (path - 0.35) * 2.2);
        const bridge = site.onBridge(x, z);
        r += ((bridge ? 196 : 112) - r) * k;
        g += ((bridge ? 188 : 104) - g) * k;
        b += ((bridge ? 168 : 90) - b) * k;
      }
      // contour lines every metre, index contours every 5 m
      if (land !== LAND.WATER) {
        const c0 = Math.floor(h(i, j));
        const cross = Math.floor(h(i + 1, j)) !== c0 || Math.floor(h(i, j + 1)) !== c0;
        if (cross) {
          const index = Math.floor(Math.max(h(i + 1, j), h(i, j + 1), h(i, j))) % 5 === 0;
          const a = index ? 0.32 : 0.13;
          r += (214 - r) * a;
          g += (226 - g) * a;
          b += (206 - b) * a;
        }
      }
      const k = (j * n + i) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // water outlines
  ctx.save();
  ctx.scale(BASE_PPM, BASE_PPM);
  ctx.translate(WORLD_HALF, WORLD_HALF);
  ctx.lineJoin = "round";
  for (const body of site.waterBodies) {
    ctx.beginPath();
    body.poly.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    if (body.kind === "stream") {
      ctx.strokeStyle = "rgba(96,150,190,0.8)";
      ctx.lineWidth = 1.4;
    } else {
      ctx.closePath();
      ctx.strokeStyle = "rgba(110,165,205,0.55)";
      ctx.lineWidth = 0.6;
    }
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(20,18,16,0.7)";
  ctx.lineWidth = 0.5;
  for (const b of site.raw.buildings) {
    ctx.beginPath();
    b.poly.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  cached = canvas;
  return canvas;
}

/** real elevation above sea level (m) at a local point */
export function elevationAt(x: number, z: number) {
  const site = getSite();
  return site.height(x, z) + site.baseElevation;
}
