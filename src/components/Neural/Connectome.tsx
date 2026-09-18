"use client";

import { useEffect, useRef, useState } from "react";
import { getExperiment } from "@/store/runtime";
import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import { ACTIONS } from "@/types";
import type { PopulationId } from "@/simulation/neural/NeuralBrain";
import { mulberry32 } from "@/utils/rng";
import { hexToRgb, POP_COLORS } from "./neuralColors";

/** approximate anatomical centre (x: rostral+, y: dorsal+, z: lateral) and spread of each population */
const ANATOMY: Record<PopulationId, [number, number, number, number]> = {
  VIS_FOOD: [-0.78, 0.18, 0.3, 0.12],
  VIS_THREAT: [-0.8, 0.02, 0.32, 0.12],
  VIS_WATER: [-0.74, 0.3, 0.2, 0.1],
  VIS_SOCIAL: [-0.7, -0.08, 0.24, 0.1],
  NOVELTY: [0.42, 0.42, 0.18, 0.12],
  CURIOSITY: [0.6, 0.3, 0.1, 0.1],
  HUNGER: [0.05, -0.52, 0.05, 0.07],
  THIRST: [0.14, -0.46, 0.08, 0.06],
  FATIGUE: [-0.04, -0.44, 0.1, 0.06],
  COLD: [0.1, -0.38, 0.14, 0.05],
  AMYGDALA: [0.2, -0.3, 0.42, 0.09],
  HEAD_DIRECTION: [-0.2, 0.05, 0.12, 0.08],
  GRID: [-0.12, -0.2, 0.46, 0.1],
  VTA: [-0.1, -0.62, 0.02, 0.06],
  STRIATUM: [0.28, 0.02, 0.3, 0.14],
  MOTOR: [0.1, 0.58, 0.3, 0.1],
  PLACE: [-0.3, -0.05, 0.36, 0.16],
};

/**
 * Rotating 3D view of the spiking network: neurons placed by anatomical region, flashing when they
 * fire, with the strongest learned (STDP + dopamine) synapses onto the striatal action channels drawn as links.
 */
export function Connectome({ index = "N2" }: { index?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spin, setSpin] = useState(true);
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const angle = useRef({ yaw: 0.6, pitch: 0.25, dragging: false, lx: 0, ly: 0, moved: false });
  const proj = useRef<{ sx: Float32Array; sy: Float32Array; depth: Float32Array }>({ sx: new Float32Array(0), sy: new Float32Array(0), depth: new Float32Array(0) });
  const learned = useLab((s) => s.snap?.neural.learningEvents ?? 0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const el = wrap.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const resize = () => {
      const r = el.getBoundingClientRect();
      w = Math.max(10, r.width);
      h = Math.max(10, r.height);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const nb = getExperiment().ctx.neural;
    const rng = mulberry32(846);
    const N = nb.N;
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const pz = new Float32Array(N);
    const col: [number, number, number][] = new Array(N);
    const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-9)) * Math.cos(Math.PI * 2 * rng());
    for (const p of nb.pops) {
      const [cx, cy, cz, sp] = ANATOMY[p.id];
      const rgb = hexToRgb(POP_COLORS[p.id]);
      for (let j = 0; j < p.count; j++) {
        const id = p.start + j;
        // bilateral: alternate hemispheres
        const side = j % 2 === 0 ? 1 : -1;
        px[id] = cx + gauss() * sp;
        py[id] = cy + gauss() * sp * 0.8;
        pz[id] = side * cz + gauss() * sp * 0.6;
        col[id] = rgb;
      }
    }
    proj.current = { sx: new Float32Array(N), sy: new Float32Array(N), depth: new Float32Array(N) };
    const flash = new Float32Array(N);
    let lastHead = nb.rasterHead;
    let raf = 0;
    let lastT = performance.now();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      const exp = getExperiment();
      const net = exp.ctx.neural;
      const a = angle.current;
      if (spinRef.current && !a.dragging) a.yaw += dt * 0.18;
      // new spikes since last frame
      const cap = net.rasterId.length;
      let k = lastHead;
      let guard = 0;
      while (k !== net.rasterHead && guard++ < 4000) {
        flash[net.rasterId[k]] = 1;
        k = (k + 1) % cap;
      }
      lastHead = net.rasterHead;
      for (let i = 0; i < N; i++) flash[i] *= Math.exp(-dt * 7);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#050707";
      ctx.fillRect(0, 0, w, h);
      const cyw = Math.cos(a.yaw);
      const syw = Math.sin(a.yaw);
      const cp = Math.cos(a.pitch);
      const sp = Math.sin(a.pitch);
      const scale = Math.min(w, h) * 0.42;
      const { sx, sy, depth } = proj.current;
      const place = net.popById.PLACE;
      for (let i = 0; i < N; i++) {
        const x = px[i] * cyw - pz[i] * syw;
        const z0 = px[i] * syw + pz[i] * cyw;
        const y = py[i] * cp - z0 * sp;
        const z = py[i] * sp + z0 * cp;
        const persp = 1 / (1.9 - z * 0.5);
        sx[i] = w / 2 + x * scale * persp * 1.3;
        sy[i] = h / 2 - y * scale * persp * 1.3;
        depth[i] = z;
      }

      // strongest plastic synapses onto the action channels of the currently winning action
      const snap = useLab.getState().snap;
      const winner = snap?.candidates[0]?.type;
      const ch = winner ? ACTIONS.indexOf(winner) : -1;
      if (ch >= 0) {
        const str = net.popById.STRIATUM;
        const links: { pre: number; wgt: number }[] = [];
        for (let r = 0; r < net.NPRE; r++) {
          const n = net.preNeuron[r];
          if (n >= place.start && n - place.start >= net.placeCount) continue;
          const wgt = net.W[r * net.A + ch] - net.W0[r * net.A + ch];
          if (Math.abs(wgt) > 0.02) links.push({ pre: n, wgt });
        }
        links.sort((p, q) => Math.abs(q.wgt) - Math.abs(p.wgt));
        const target = str.start + ch * 10 + 4;
        for (const l of links.slice(0, 60)) {
          const alpha = Math.min(0.55, Math.abs(l.wgt) * 1.5) * (0.35 + flash[l.pre] * 0.65);
          ctx.strokeStyle = l.wgt > 0 ? `rgba(143,227,196,${alpha})` : `rgba(255,95,79,${alpha})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(sx[l.pre], sy[l.pre]);
          ctx.lineTo(sx[target], sy[target]);
          ctx.stroke();
        }
      }

      const selected = useLab.getState().selectedNeuron;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < N; i++) {
        if (i >= place.start && i - place.start >= net.placeCount) {
          ctx.fillStyle = "rgba(90,90,90,0.12)";
          ctx.fillRect(sx[i], sy[i], 1, 1);
          continue;
        }
        const [r, g, b] = col[i];
        const f = flash[i];
        const base = 0.22 + (depth[i] + 1) * 0.12;
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, base + f * 0.9)})`;
        const sz = 1.3 + f * 2.6;
        ctx.fillRect(sx[i] - sz / 2, sy[i] - sz / 2, sz, sz);
      }
      ctx.globalCompositeOperation = "source-over";
      if (selected !== null && selected < N) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx[selected], sy[selected], 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = "8.5px JetBrains Mono, monospace";
      ctx.fillStyle = "rgba(207,216,212,0.45)";
      ctx.fillText("ROSTRAL →", w - 64, h - 8);
      if (winner) ctx.fillText(`LINKS · LEARNED INPUTS TO ${winner}`, 8, h - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const onDown = (e: React.PointerEvent) => {
    const a = angle.current;
    a.dragging = true;
    a.moved = false;
    a.lx = e.clientX;
    a.ly = e.clientY;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const a = angle.current;
    if (!a.dragging) return;
    const dx = e.clientX - a.lx;
    const dy = e.clientY - a.ly;
    if (Math.abs(dx) + Math.abs(dy) > 2) a.moved = true;
    a.yaw += dx * 0.01;
    a.pitch = Math.max(-1.2, Math.min(1.2, a.pitch + dy * 0.01));
    a.lx = e.clientX;
    a.ly = e.clientY;
  };
  const onUp = (e: React.PointerEvent) => {
    const a = angle.current;
    a.dragging = false;
    if (a.moved) return;
    const r = wrap.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const { sx, sy, depth } = proj.current;
    let best = -1;
    let bd = 64;
    for (let i = 0; i < sx.length; i++) {
      const d = (sx[i] - mx) ** 2 + (sy[i] - my) ** 2 - depth[i] * 4;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) useLab.getState().selectNeuron(best);
  };

  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader
        index={index}
        title="CONNECTOME"
        meta="DRAG TO ROTATE · CLICK A NEURON"
        right={
          <>
            <span className="mono tabular text-[9px] text-[var(--color-mid)]">{learned.toLocaleString()} PLASTICITY EVENTS</span>
            <button className="btn !px-1.5 !py-[3px] !text-[8.5px]" data-active={spin} onClick={() => setSpin((v) => !v)}>
              SPIN
            </button>
          </>
        }
      />
      <div ref={wrap} className="relative min-h-0 flex-1 cursor-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
    </section>
  );
}
