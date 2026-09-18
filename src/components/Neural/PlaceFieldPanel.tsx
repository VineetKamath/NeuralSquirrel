"use client";

import { useEffect, useRef, useState } from "react";
import { getExperiment } from "@/store/runtime";
import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import { getMapBase } from "@/components/Map/mapBase";
import { WORLD_HALF, WORLD_SIZE } from "@/simulation/constants";

type Mode = "place" | "grid";

/**
 * Hippocampal-entorhinal spatial code. PLACE: every recruited place cell drawn at its field centre,
 * coloured by the value the critic has learned for that place; live activity shown as glow.
 * GRID: the rate map of one entorhinal grid cell sampled across the site (hexagonal firing fields).
 */
export function PlaceFieldPanel({ index = "N4" }: { index?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>("place");
  const [module, setModule] = useState(0);
  const placeCells = useLab((s) => s.snap?.neural.placeCells ?? 0);

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
    const base = getMapBase();
    const gridImg = document.createElement("canvas");
    let gridKey = "";
    let raf = 0;
    let last = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 120) return;
      last = now;
      const exp = getExperiment();
      const nb = exp.ctx.neural;
      const s = exp.agent.state;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#060808";
      ctx.fillRect(0, 0, w, h);
      // view centred on the subject's home range
      const home = exp.agent.homeTree.position;
      const span = mode === "grid" ? 120 : 170;
      const scale = Math.min(w, h) / span;
      const cx = mode === "grid" ? s.position.x : home.x * 0.5 + s.position.x * 0.5;
      const cz = mode === "grid" ? s.position.z : home.z * 0.5 + s.position.z * 0.5;
      const X = (x: number) => w / 2 + (x - cx) * scale;
      const Z = (z: number) => h / 2 + (z - cz) * scale;
      ctx.globalAlpha = mode === "grid" ? 0.25 : 0.45;
      ctx.drawImage(base, X(-WORLD_HALF), Z(-WORLD_HALF), WORLD_SIZE * scale, WORLD_SIZE * scale);
      ctx.globalAlpha = 1;

      if (mode === "place") {
        const place = nb.popById.PLACE;
        for (let i = 0; i < nb.placeCount; i++) {
          const x = X(nb.placeX[i]);
          const z = Z(nb.placeZ[i]);
          if (x < -10 || z < -10 || x > w + 10 || z > h + 10) continue;
          const val = nb.Wv[i];
          const rate = nb.rate[place.start + i];
          const act = Math.min(1, rate / 30);
          const vv = Math.max(-1, Math.min(1, val * 3));
          const col = vv >= 0 ? `232,179,106` : `127,183,232`;
          if (act > 0.05) {
            const g = ctx.createRadialGradient(x, z, 0, x, z, 5 * scale * 1.2);
            g.addColorStop(0, `rgba(143,227,196,${act * 0.55})`);
            g.addColorStop(1, "rgba(143,227,196,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, z, 5 * scale * 1.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(x, z, Math.max(1.5, 1.2 + Math.abs(vv) * 3), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${col},${0.35 + Math.abs(vv) * 0.65})`;
          ctx.fill();
        }
      } else {
        const cell = module * 16 + 5;
        const key = `${cell}:${Math.round(cx / 4)}:${Math.round(cz / 4)}:${Math.round(w)}`;
        if (key !== gridKey) {
          gridKey = key;
          const res = 90;
          gridImg.width = res;
          gridImg.height = res;
          const gctx = gridImg.getContext("2d")!;
          const img = gctx.createImageData(res, res);
          for (let j = 0; j < res; j++) {
            for (let i = 0; i < res; i++) {
              const x = cx + ((i + 0.5) / res - 0.5) * span;
              const z = cz + ((j + 0.5) / res - 0.5) * span;
              const r = nb.gridRate(cell, x, z);
              const k = (j * res + i) * 4;
              img.data[k] = 40 + r * 60;
              img.data[k + 1] = 120 + r * 120;
              img.data[k + 2] = 150 + r * 80;
              img.data[k + 3] = r * 220;
            }
          }
          gctx.putImageData(img, 0, 0);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(gridImg, X(cx - span / 2), Z(cz - span / 2), span * scale, span * scale);
      }

      // subject and its path-integration belief
      const bx = s.position.x + s.piError.x;
      const bz = s.position.z + s.piError.z;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(X(s.position.x), Z(s.position.z));
      ctx.lineTo(X(bx), Z(bz));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(X(s.position.x), Z(s.position.z), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#8fe3c4";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(X(bx), Z(bz), 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.font = "8.5px JetBrains Mono, monospace";
      ctx.fillStyle = "rgba(207,216,212,0.6)";
      if (mode === "place") {
        ctx.fillText("● TRUE POSITION  ○ PATH-INTEGRATION ESTIMATE", 8, h - 22);
        ctx.fillStyle = "#e8b36a";
        ctx.fillText("■ HIGH LEARNED VALUE", 8, h - 10);
        ctx.fillStyle = "#7fb7e8";
        ctx.fillText("■ LOW / NEGATIVE", 150, h - 10);
      } else {
        ctx.fillText(`GRID CELL #${module * 16 + 5} · MODULE ${module + 1} · RATE MAP (${span} m)`, 8, h - 10);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode, module]);

  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader
        index={index}
        title={mode === "place" ? "PLACE FIELDS" : "GRID CELLS"}
        meta={mode === "place" ? `${placeCells} RECRUITED · CRITIC VALUE` : "ENTORHINAL MODULES"}
        right={
          <>
            {mode === "grid" &&
              [0, 1, 2].map((m) => (
                <button key={m} className="btn !px-1.5 !py-[3px] !text-[8.5px]" data-active={module === m} onClick={() => setModule(m)}>
                  M{m + 1}
                </button>
              ))}
            <button className="btn !px-1.5 !py-[3px] !text-[8.5px]" data-active={mode === "place"} onClick={() => setMode("place")}>
              PLACE
            </button>
            <button className="btn !px-1.5 !py-[3px] !text-[8.5px]" data-active={mode === "grid"} onClick={() => setMode("grid")}>
              GRID
            </button>
          </>
        }
      />
      <div ref={wrap} className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
    </section>
  );
}
