"use client";

import { useEffect, useRef } from "react";
import { getExperiment } from "@/store/runtime";
import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import { POP_COLORS } from "./neuralColors";

const WINDOW_MS = 1500;

/**
 * Spike raster of the full spiking network: every dot is one action potential emitted by an
 * Izhikevich neuron during the last 1.5 s of network time. Rows are grouped by population.
 */
export function SpikeRaster({ index = "N1" }: { index?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spikes = useLab((s) => s.snap?.neural.spikesPerWindow ?? 0);
  const neurons = useLab((s) => s.snap?.neural.neurons ?? 0);
  const selected = useLab((s) => s.selectedNeuron);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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
    let raf = 0;
    const LABEL_W = 92;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const nb = getExperiment().ctx.neural;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#060808";
      ctx.fillRect(0, 0, w, h);
      const plotW = w - LABEL_W - 6;
      // rows: place cells are compressed to their recruited count
      const rowOf = new Int32Array(nb.N).fill(-1);
      let rows = 0;
      const bands: { pop: (typeof nb.pops)[number]; from: number; to: number }[] = [];
      for (const p of nb.pops) {
        const count = p.id === "PLACE" ? Math.max(1, nb.placeCount) : p.count;
        const from = rows;
        for (let j = 0; j < count; j++) rowOf[p.start + j] = rows++;
        bands.push({ pop: p, from, to: rows });
      }
      const rowH = h / rows;
      ctx.font = "8px JetBrains Mono, monospace";
      for (const b of bands) {
        const y0 = b.from * rowH;
        const y1 = b.to * rowH;
        ctx.fillStyle = "rgba(190,210,205,0.035)";
        if (bands.indexOf(b) % 2 === 0) ctx.fillRect(LABEL_W, y0, plotW, y1 - y0);
        ctx.strokeStyle = "rgba(190,210,205,0.08)";
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.lineTo(w, y0);
        ctx.stroke();
        if (y1 - y0 >= 7) {
          ctx.fillStyle = POP_COLORS[b.pop.id];
          ctx.globalAlpha = 0.75;
          ctx.fillText(b.pop.id.replace("_", " "), 4, (y0 + y1) / 2 + 3);
          ctx.globalAlpha = 1;
        }
      }
      const now = nb.clockMs;
      const t0 = now - WINDOW_MS;
      const cap = nb.rasterId.length;
      const dotH = Math.max(1, Math.min(2.5, rowH));
      for (let k = 0; k < nb.rasterCount; k++) {
        const idx = (nb.rasterHead - 1 - k + cap) % cap;
        const t = nb.rasterT[idx];
        if (t < t0) break;
        const id = nb.rasterId[idx];
        const row = rowOf[id];
        if (row < 0) continue;
        const x = LABEL_W + ((t - t0) / WINDOW_MS) * plotW;
        const p = nb.populationOf(id);
        ctx.fillStyle = id === selectedRef.current ? "#ffffff" : POP_COLORS[p.id];
        ctx.fillRect(x, row * rowH, id === selectedRef.current ? 2.5 : 1.4, dotH);
      }
      // theta rhythm guide (8 Hz)
      ctx.strokeStyle = "rgba(143,227,196,0.06)";
      for (let t = Math.ceil(t0 / 125) * 125; t < now; t += 125) {
        const x = LABEL_W + ((t - t0) / WINDOW_MS) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      if (selectedRef.current !== null && rowOf[selectedRef.current] >= 0) {
        const y = rowOf[selectedRef.current] * rowH;
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.strokeRect(LABEL_W, y - 1, plotW, dotH + 2);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const onClick = (e: React.MouseEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const y = e.clientY - r.top;
    const nb = getExperiment().ctx.neural;
    let rows = 0;
    const map: number[] = [];
    for (const p of nb.pops) {
      const count = p.id === "PLACE" ? Math.max(1, nb.placeCount) : p.count;
      for (let j = 0; j < count; j++) {
        map.push(p.start + j);
        rows++;
      }
    }
    const row = Math.floor((y / r.height) * rows);
    if (map[row] !== undefined) useLab.getState().selectNeuron(map[row]);
  };

  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader
        index={index}
        title="SPIKE RASTER"
        meta="IZHIKEVICH NETWORK · LAST 1.5 S"
        right={
          <span className="mono tabular text-[9px] tracking-[0.1em] text-[var(--color-mid)]">
            {neurons} NEURONS · {spikes} SPIKES/WINDOW
          </span>
        }
      />
      <div ref={wrap} className="relative min-h-0 flex-1 cursor-crosshair" onClick={onClick}>
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
    </section>
  );
}
