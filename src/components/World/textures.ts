import * as THREE from "three";
import { mulberry32 } from "@/utils/rng";

// Procedural canvas textures. Generated once in the browser, cached for the session.

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return { c, ctx };
}

function finish(key: string, c: HTMLCanvasElement, repeat = false, srgb = true) {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

function hsl(h: number, s: number, l: number, a = 1) {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

function drawLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, rot: number, color: string, lobed: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  if (lobed) {
    const lobes = 4;
    for (let i = 0; i <= lobes; i++) {
      const t = i / lobes;
      const w = Math.sin(t * Math.PI) * wid * (i % 2 ? 1 : 0.7);
      ctx.quadraticCurveTo(w * 1.2, -len * (t - 0.12), w * 0.6, -len * t);
    }
    for (let i = lobes; i >= 0; i--) {
      const t = i / lobes;
      const w = Math.sin(t * Math.PI) * wid * (i % 2 ? 1 : 0.7);
      ctx.quadraticCurveTo(-w * 1.2, -len * (t + 0.12), -w * 0.6, -len * t);
    }
  } else {
    ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.8, 0, -len);
    ctx.bezierCurveTo(-wid * 0.8, -len * 0.8, -wid, -len * 0.25, 0, 0);
  }
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = Math.max(0.6, wid * 0.08);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -len * 0.92);
  ctx.stroke();
  ctx.restore();
}

/** clustered broadleaf foliage card */
export function leafClusterTexture(kind: "oak" | "birch" | "bush") {
  const key = `leaf-${kind}`;
  if (cache.has(key)) return cache.get(key)!;
  const S = 512;
  const { c, ctx } = canvas(S, S);
  const rng = mulberry32(kind === "oak" ? 11 : kind === "birch" ? 23 : 37);
  const count = kind === "birch" ? 150 : kind === "bush" ? 120 : 95;
  const baseHue = kind === "birch" ? 78 : kind === "bush" ? 95 : 88;
  // twigs
  ctx.strokeStyle = "rgba(52,40,28,0.9)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2);
    const a = rng() * Math.PI * 2;
    ctx.lineTo(S / 2 + Math.cos(a) * S * 0.35, S / 2 + Math.sin(a) * S * 0.35);
    ctx.stroke();
  }
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * S * 0.4;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const depth = r / (S * 0.4);
    const l = 22 + rng() * 22 + (1 - depth) * 4;
    const len = kind === "birch" ? 34 + rng() * 14 : kind === "bush" ? 30 + rng() * 16 : 48 + rng() * 22;
    const wid = kind === "birch" ? 14 + rng() * 5 : kind === "bush" ? 12 + rng() * 6 : 17 + rng() * 7;
    drawLeaf(ctx, x, y, len, wid, a + Math.PI / 2 + (rng() - 0.5) * 1.4, hsl(baseHue + (rng() - 0.5) * 22, 32 + rng() * 22, l), kind === "oak");
  }
  return finish(key, c);
}

export function pineTexture() {
  const key = "pine";
  if (cache.has(key)) return cache.get(key)!;
  const W = 512;
  const H = 512;
  const { c, ctx } = canvas(W, H);
  const rng = mulberry32(51);
  // a drooping branch spray seen from above, stem along the vertical axis
  ctx.lineCap = "round";
  const stems = 5;
  for (let s = 0; s < stems; s++) {
    const sx = W / 2 + (s - 2) * 46;
    ctx.strokeStyle = "rgba(60,44,30,0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2, H);
    ctx.quadraticCurveTo(sx, H * 0.55, sx + (rng() - 0.5) * 60, 30);
    ctx.stroke();
    for (let i = 0; i < 70; i++) {
      const t = rng();
      const px = W / 2 + (sx - W / 2) * (1 - t) * 0.6 + (sx - W / 2) * 0.4 + (rng() - 0.5) * 30 * (1 - t);
      const py = H - t * (H - 40);
      const side = rng() < 0.5 ? -1 : 1;
      const nl = 28 + rng() * 26 * (1 - t * 0.5);
      ctx.strokeStyle = hsl(120 + rng() * 30, 25 + rng() * 15, 14 + rng() * 14);
      ctx.lineWidth = 2 + rng() * 1.5;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + side * nl * 0.9, py - nl * 0.5);
      ctx.stroke();
    }
  }
  return finish(key, c);
}

export function fernTexture() {
  const key = "fern";
  if (cache.has(key)) return cache.get(key)!;
  const W = 256;
  const H = 512;
  const { c, ctx } = canvas(W, H);
  const rng = mulberry32(77);
  ctx.strokeStyle = "rgba(70,90,40,1)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W / 2, H);
  ctx.quadraticCurveTo(W / 2 + 10, H / 2, W / 2 - 6, 10);
  ctx.stroke();
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const y = H - t * (H - 20);
    const len = Math.sin((1 - t) * Math.PI * 0.85 + 0.2) * 100 + 8;
    for (const side of [-1, 1]) {
      const x = W / 2 + Math.sin(t * 3) * 4;
      ctx.fillStyle = hsl(92 + rng() * 16, 38 + rng() * 14, 22 + rng() * 12 + t * 8);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(side * (1.25 - t * 0.35));
      ctx.beginPath();
      ctx.ellipse(0, -len / 2, len * 0.14 + 3, len / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  return finish(key, c);
}

export function barkTexture(kind: "oak" | "birch" | "pine") {
  const key = `bark-${kind}`;
  if (cache.has(key)) return cache.get(key)!;
  const W = 256;
  const H = 512;
  const { c, ctx } = canvas(W, H);
  const rng = mulberry32(kind === "birch" ? 5 : kind === "pine" ? 9 : 3);
  if (kind === "birch") {
    ctx.fillStyle = "#cfcbc0";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${150 + rng() * 60},${145 + rng() * 60},${135 + rng() * 50},0.25)`;
      ctx.fillRect(rng() * W, rng() * H, 4 + rng() * 30, 1 + rng() * 2);
    }
    for (let i = 0; i < 45; i++) {
      ctx.fillStyle = `rgba(20,18,16,${0.5 + rng() * 0.4})`;
      const w = 10 + rng() * 60;
      const x = rng() * W;
      const y = rng() * H;
      ctx.beginPath();
      ctx.ellipse(x, y, w / 2, 1.5 + rng() * 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const base = kind === "pine" ? [70, 48, 36] : [62, 52, 42];
    ctx.fillStyle = `rgb(${base.join(",")})`;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2200; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const v = (rng() - 0.5) * 50;
      ctx.fillStyle = `rgba(${base[0] + v},${base[1] + v},${base[2] + v},0.35)`;
      ctx.fillRect(x, y, 1 + rng() * 5, 8 + rng() * 40);
    }
    ctx.strokeStyle = "rgba(10,8,6,0.6)";
    for (let i = 0; i < 70; i++) {
      ctx.lineWidth = 1 + rng() * 3;
      let x = rng() * W;
      let y = rng() * H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rng() - 0.5) * 14;
        y += 12 + rng() * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // moss
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(${70 + rng() * 30},${90 + rng() * 30},${40 + rng() * 20},${0.15 + rng() * 0.25})`;
      ctx.beginPath();
      ctx.arc(rng() * W, H * 0.6 + rng() * H * 0.4, 2 + rng() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return finish(key, c, true);
}

/** 2x2 atlas of fallen leaves */
export function litterTexture() {
  const key = "litter";
  if (cache.has(key)) return cache.get(key)!;
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const rng = mulberry32(99);
  const hues = [28, 38, 18, 48];
  for (let i = 0; i < 4; i++) {
    const cx = (i % 2) * (S / 2) + S / 4;
    const cy = Math.floor(i / 2) * (S / 2) + S / 4 + 44;
    drawLeaf(ctx, cx, cy, 88, 30, 0, hsl(hues[i], 40 + rng() * 20, 20 + rng() * 14), i % 2 === 0);
  }
  return finish(key, c);
}

/** soft round gradient sprite */
export function glowTexture() {
  const key = "glow";
  if (cache.has(key)) return cache.get(key)!;
  const S = 64;
  const { c, ctx } = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return finish(key, c, false, false);
}
