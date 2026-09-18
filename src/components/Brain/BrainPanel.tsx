"use client";

import { useEffect, useRef } from "react";
import { BRAIN_NODES, type BrainNodeId } from "@/types";
import { getExperiment } from "@/store/runtime";
import { useLab } from "@/store/labStore";
import { mulberry32 } from "@/utils/rng";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";

/** anatomical-ish placement in a side view (front of the brain on the right) */
const REGIONS: Record<BrainNodeId, { x: number; y: number; color: string; label: string }> = {
  VISION: { x: 0.14, y: 0.46, color: "207,222,255", label: "VISUAL CORTEX" },
  NAVIGATION: { x: 0.36, y: 0.2, color: "127,183,232", label: "PARIETAL · NAV" },
  MOTOR: { x: 0.56, y: 0.15, color: "143,227,196", label: "MOTOR CORTEX" },
  CURIOSITY: { x: 0.74, y: 0.26, color: "182,156,242", label: "CURIOSITY" },
  DECISION: { x: 0.86, y: 0.47, color: "238,244,241", label: "PREFRONTAL · DECISION" },
  MEMORY: { x: 0.44, y: 0.55, color: "232,179,106", label: "HIPPOCAMPUS · MEMORY" },
  REWARD: { x: 0.62, y: 0.48, color: "120,240,200", label: "STRIATUM · REWARD" },
  FEAR: { x: 0.64, y: 0.7, color: "255,95,79", label: "AMYGDALA · FEAR" },
  HUNGER: { x: 0.5, y: 0.78, color: "240,150,90", label: "HYPOTHALAMUS · DRIVE" },
};

/** closed brain silhouette in unit space: cerebrum, cerebellum, brainstem */
function inBrain(x: number, y: number) {
  const cx = (x - 0.52) / 0.47;
  const cy = (y - 0.44) / 0.38;
  const bump = 0.06 * Math.sin(x * 38) * Math.sin(y * 29);
  const cerebrum = cx * cx + cy * cy * (y < 0.44 ? 1 : 1.35) < 1 + bump;
  const cbx = (x - 0.2) / 0.16;
  const cby = (y - 0.8) / 0.11;
  const cerebellum = cbx * cbx + cby * cby < 1;
  const stem = x > 0.3 && x < 0.4 && y > 0.7 && y < 0.98 - (x - 0.3) * 0.8;
  return cerebrum || cerebellum || stem;
}

interface Neuron {
  x: number;
  y: number;
  region: BrainNodeId;
  birth: number;
  size: number;
  charge: number;
  flash: number;
  links: number[];
}

interface Spike {
  from: number;
  to: number;
  t: number;
  speed: number;
  color: string;
  long: boolean;
}

export function BrainPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const synapses = useLab((s) => s.snap?.synapses ?? 0);
  const development = useLab((s) => s.snap?.development ?? 0);
  const active = useLab((s) => s.snap?.activeNodes ?? 0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── build the neuron field
    const rng = mulberry32(90210);
    const neurons: Neuron[] = [];
    let guard = 0;
    while (neurons.length < 620 && guard++ < 20000) {
      const x = rng();
      const y = rng();
      if (!inBrain(x, y)) continue;
      let best: BrainNodeId = "VISION";
      let bd = Infinity;
      for (const id of BRAIN_NODES) {
        const r = REGIONS[id];
        const d = (r.x - x) ** 2 + ((r.y - y) * 1.2) ** 2;
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      const core = Math.exp(-bd * 30);
      neurons.push({ x, y, region: best, birth: rng() * (1 - core * 0.7), size: 0.7 + rng() * 1.1 + core * 1.2, charge: rng(), flash: 0, links: [] });
    }
    for (let i = 0; i < neurons.length; i++) {
      const n = neurons[i];
      const near = neurons
        .map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2 }))
        .filter((o) => o.j !== i && o.d < 0.012)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      n.links = near.map((o) => o.j);
    }
    const byRegion = Object.fromEntries(BRAIN_NODES.map((id) => [id, neurons.map((n, i) => (n.region === id ? i : -1)).filter((i) => i >= 0)])) as Record<BrainNodeId, number[]>;
    // sulci: decorative folds
    const folds: { pts: [number, number][] }[] = [];
    for (let f = 0; f < 11; f++) {
      const pts: [number, number][] = [];
      let x = 0.12 + rng() * 0.76;
      let y = 0.12 + rng() * 0.5;
      const dir = rng() * Math.PI * 2;
      for (let k = 0; k < 9; k++) {
        if (inBrain(x, y)) pts.push([x, y]);
        x += Math.cos(dir + Math.sin(k * 1.3) * 0.9) * 0.025;
        y += Math.sin(dir + Math.sin(k * 1.3) * 0.9) * 0.025;
      }
      if (pts.length > 3) folds.push({ pts });
    }

    // each drawn neuron stands for real neurons of the spiking network in the same brain region
    const net0 = getExperiment().ctx.neural;
    const displayOf = new Int32Array(net0.N).fill(-1);
    for (const p of net0.pops) {
      const list = byRegion[p.region];
      if (!list?.length) continue;
      for (let j = 0; j < p.count; j++) displayOf[p.start + j] = list[(j * 7919 + p.start) % list.length];
    }
    let lastHead = net0.rasterHead;

    const spikes: Spike[] = [];
    const eeg: number[][] = [[], [], []];
    let raf = 0;
    let last = performance.now();

    const P = (x: number, y: number) => {
      const top = 8;
      const bottom = 44;
      const areaH = h - top - bottom;
      const scale = Math.min(w * 0.94, areaH * 1.55);
      const ox = (w - scale) / 2;
      const oy = top + (areaH - scale / 1.55) / 2;
      return [ox + x * scale, oy + y * (scale / 1.55)] as const;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const time = now / 1000;
      const exp = getExperiment();
      const brain = exp.ctx.brain;
      const dev = brain.development;
      const memCount = exp.ctx.memory.memories.length;
      const grown = Math.min(1, 0.28 + dev * 0.8 + memCount * 0.006);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // silhouette glow
      ctx.save();
      const [bx, by] = P(0.52, 0.46);
      const halo = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(w, h) * 0.55);
      halo.addColorStop(0, "rgba(120,200,180,0.06)");
      halo.addColorStop(1, "rgba(120,200,180,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // folds
      ctx.lineWidth = 1;
      for (const f of folds) {
        ctx.strokeStyle = "rgba(170,210,200,0.05)";
        ctx.beginPath();
        f.pts.forEach(([x, y], i) => {
          const [px, py] = P(x, y);
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        });
        ctx.stroke();
      }

      // region haze
      ctx.globalCompositeOperation = "lighter";
      for (const id of BRAIN_NODES) {
        const r = REGIONS[id];
        const a = brain.activation[id];
        const [x, y] = P(r.x, r.y);
        const rad = Math.min(w, h) * (0.12 + a * 0.1);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${r.color},${0.04 + a * 0.22})`);
        g.addColorStop(1, `rgba(${r.color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // local synapses (appear as the network develops)
      ctx.lineWidth = 0.6;
      for (let i = 0; i < neurons.length; i++) {
        const n = neurons[i];
        if (n.birth > grown) continue;
        const a = brain.activation[n.region];
        const [x1, y1] = P(n.x, n.y);
        for (const j of n.links) {
          const m = neurons[j];
          if (m.birth > grown || j < i) continue;
          const [x2, y2] = P(m.x, m.y);
          ctx.strokeStyle = `rgba(${REGIONS[n.region].color},${0.05 + a * 0.18})`;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }

      // long-range tracts between regions, brightness = learned weight
      for (const e of brain.edges) {
        const a = REGIONS[e.from];
        const b = REGIONS[e.to];
        const [ax, ay] = P(a.x, a.y);
        const [bx2, by2] = P(b.x, b.y);
        const mx = (ax + bx2) / 2;
        const my = (ay + by2) / 2 - 18;
        ctx.strokeStyle = `rgba(143,227,196,${0.03 + e.weight * 0.3})`;
        ctx.lineWidth = 0.4 + e.weight * 2.2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(mx, my, bx2, by2);
        ctx.stroke();
        // spikes travelling along tracts
        if (Math.random() < dt * e.flow * 6 * (0.3 + e.weight) && spikes.length < 380) {
          const fromList = byRegion[e.from];
          const toList = byRegion[e.to];
          spikes.push({
            from: fromList[Math.floor(Math.random() * fromList.length)],
            to: toList[Math.floor(Math.random() * toList.length)],
            t: 0,
            speed: 0.7 + Math.random() * 0.6,
            color: a.color,
            long: true,
          });
        }
      }

      // real action potentials from the spiking network since the last frame
      const net = exp.ctx.neural;
      if (net.N === displayOf.length) {
        const cap = net.rasterId.length;
        let k = lastHead;
        let guard = 0;
        while (k !== net.rasterHead && guard++ < 3000) {
          const d = displayOf[net.rasterId[k]];
          if (d >= 0) {
            const n = neurons[d];
            n.flash = 1;
            n.charge = 0;
            if (n.links.length && spikes.length < 380 && Math.random() < 0.25) {
              const to = n.links[Math.floor(Math.random() * n.links.length)];
              if (neurons[to].birth <= grown) spikes.push({ from: d, to, t: 0, speed: 2.5 + Math.random() * 2, color: REGIONS[n.region].color, long: false });
            }
          }
          k = (k + 1) % cap;
        }
        lastHead = net.rasterHead;
      }

      // spontaneous background firing between network windows
      for (let i = 0; i < neurons.length; i++) {
        const n = neurons[i];
        if (n.birth > grown) continue;
        const a = brain.activation[n.region];
        n.charge += dt * (0.04 + a * 0.5) * (0.6 + n.size * 0.3);
        if (n.charge > 1) {
          n.charge = Math.random() * 0.3;
          n.flash = 1;
          if (n.links.length && spikes.length < 380 && Math.random() < 0.5) {
            const to = n.links[Math.floor(Math.random() * n.links.length)];
            if (neurons[to].birth <= grown) spikes.push({ from: i, to, t: 0, speed: 2.5 + Math.random() * 2, color: REGIONS[n.region].color, long: false });
          }
        }
        n.flash = Math.max(0, n.flash - dt * 3.5);
      }

      ctx.globalCompositeOperation = "lighter";
      for (let i = spikes.length - 1; i >= 0; i--) {
        const s = spikes[i];
        s.t += dt * s.speed;
        const A = neurons[s.from];
        const B = neurons[s.to];
        if (s.t >= 1) {
          B.flash = Math.max(B.flash, s.long ? 0.9 : 0.6);
          B.charge += 0.25;
          spikes.splice(i, 1);
          continue;
        }
        const [ax, ay] = P(A.x, A.y);
        const [bx2, by2] = P(B.x, B.y);
        const bend = s.long ? -18 : 0;
        const u = 1 - s.t;
        const mx = (ax + bx2) / 2;
        const my = (ay + by2) / 2 + bend;
        const x = u * u * ax + 2 * u * s.t * mx + s.t * s.t * bx2;
        const y = u * u * ay + 2 * u * s.t * my + s.t * s.t * by2;
        const t0 = Math.max(0, s.t - (s.long ? 0.08 : 0.25));
        const u0 = 1 - t0;
        const x0 = u0 * u0 * ax + 2 * u0 * t0 * mx + t0 * t0 * bx2;
        const y0 = u0 * u0 * ay + 2 * u0 * t0 * my + t0 * t0 * by2;
        ctx.strokeStyle = `rgba(${s.color},0.55)`;
        ctx.lineWidth = s.long ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = "rgba(235,255,248,0.95)";
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }

      for (let i = 0; i < neurons.length; i++) {
        const n = neurons[i];
        const [x, y] = P(n.x, n.y);
        const col = REGIONS[n.region].color;
        if (n.birth > grown) {
          // dormant neuron: barely visible
          ctx.fillStyle = "rgba(160,180,175,0.07)";
          ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
          continue;
        }
        const a = brain.activation[n.region];
        if (n.flash > 0.05) {
          const r = n.size * (2 + n.flash * 4);
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(${col},${n.flash * 0.9})`);
          g.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${col},${0.3 + a * 0.45 + n.flash * 0.25})`;
        ctx.beginPath();
        ctx.arc(x, y, n.size * (0.8 + n.flash * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // region labels
      ctx.textAlign = "center";
      for (const id of BRAIN_NODES) {
        const r = REGIONS[id];
        const a = brain.activation[id];
        const [x, y] = P(r.x, r.y);
        ctx.font = "500 8.5px 'JetBrains Mono', monospace";
        ctx.fillStyle = `rgba(5,7,8,0.65)`;
        const label = id;
        const tw = ctx.measureText(label).width + 30;
        ctx.fillRect(x - tw / 2, y - 7, tw, 12);
        ctx.fillStyle = `rgba(${r.color},${0.55 + a * 0.45})`;
        ctx.fillText(label, x - 12, y + 2);
        ctx.fillStyle = `rgba(230,240,236,${0.5 + a * 0.5})`;
        ctx.fillText(a.toFixed(2), x + tw / 2 - 14, y + 2);
      }

      // EEG strip
      const traces: [BrainNodeId[], string][] = [
        [["VISION", "CURIOSITY", "MEMORY"], "143,227,196"],
        [["FEAR", "HUNGER"], "255,138,112"],
        [["DECISION", "MOTOR", "NAVIGATION", "REWARD"], "127,183,232"],
      ];
      traces.forEach(([ids, _], k) => {
        let v = 0;
        for (const id of ids) v += brain.activation[id];
        v /= ids.length;
        const noise = (Math.random() - 0.5) * (0.05 + v * 0.35) + Math.sin(time * (8 + k * 5)) * v * 0.15;
        eeg[k].push(v + noise);
        if (eeg[k].length > 260) eeg[k].shift();
        void _;
      });
      const stripTop = h - 38;
      const laneH = 11;
      traces.forEach(([, col], k) => {
        const baseY = stripTop + k * laneH + laneH;
        ctx.strokeStyle = "rgba(190,210,205,0.05)";
        ctx.beginPath();
        ctx.moveTo(10, baseY);
        ctx.lineTo(w - 10, baseY);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${col},0.75)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        eeg[k].forEach((v, i) => {
          const x = 10 + (i / 259) * (w - 20);
          const y = baseY - Math.max(-0.2, Math.min(1.1, v)) * laneH * 0.95;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      });
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader index="01" title="NEURAL ACTIVITY" meta="SIMULATED COGNITIVE NETWORK" />
      <div className="grid grid-cols-3 gap-2 px-3 pb-1">
        <Stat label="SYNAPSES" value={synapses.toLocaleString()} />
        <Stat label="DEVELOPMENT" value={`${Math.round(development * 100)}%`} accent />
        <Stat label="ACTIVE REGIONS" value={`${active}/9`} />
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div className="mono pointer-events-none absolute bottom-[40px] left-3 text-[8px] tracking-[0.16em] text-[var(--color-dim)]">EEG · SENSORY / AFFECT / EXECUTIVE</div>
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border border-[var(--color-line)] bg-white/[0.015] px-2 py-1">
      <div className="mono text-[8px] tracking-[0.16em] text-[var(--color-dim)]">{label}</div>
      <div className={`mono tabular text-[13px] ${accent ? "text-[var(--color-signal)]" : "text-[var(--color-bright)]"}`}>{value}</div>
    </div>
  );
}
