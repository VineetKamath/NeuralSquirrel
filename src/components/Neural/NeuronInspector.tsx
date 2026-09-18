"use client";

import { useEffect, useRef, useState } from "react";
import { getExperiment } from "@/store/runtime";
import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import { POP_COLORS } from "./neuralColors";

type Info = ReturnType<ReturnType<typeof getExperiment>["ctx"]["neural"]["describeNeuron"]>;

/** a single neuron: its model, tuning, live membrane potential and strongest plastic synapses */
export function NeuronInspector({ index = "N3" }: { index?: string }) {
  const selected = useLab((s) => s.selectedNeuron);
  const [info, setInfo] = useState<Info | null>(null);
  const traceRef = useRef<HTMLCanvasElement>(null);
  const pops = getExperiment().ctx.neural.pops;

  useEffect(() => {
    if (selected === null) {
      setInfo(null);
      return;
    }
    const tick = () => setInfo(getExperiment().ctx.neural.describeNeuron(selected));
    tick();
    const t = setInterval(tick, 400);
    return () => clearInterval(t);
  }, [selected]);

  useEffect(() => {
    const canvas = traceRef.current;
    if (!canvas || selected === null) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.floor(r.width * dpr)) {
        canvas.width = Math.floor(r.width * dpr);
        canvas.height = Math.floor(r.height * dpr);
      }
      const w = r.width;
      const h = r.height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const nb = getExperiment().ctx.neural;
      const tr = nb.probeTrace;
      const n = tr.length;
      const y = (mv: number) => h - ((Math.max(-90, Math.min(35, mv)) + 90) / 125) * h;
      ctx.strokeStyle = "rgba(190,210,205,0.12)";
      ctx.setLineDash([2, 3]);
      for (const mv of [-65, 30]) {
        ctx.beginPath();
        ctx.moveTo(0, y(mv));
        ctx.lineTo(w, y(mv));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = "#8fe3c4";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = tr[(nb.probeHead + i) % n];
        const X = (i / (n - 1)) * w;
        if (i === 0) ctx.moveTo(X, y(v));
        else ctx.lineTo(X, y(v));
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(207,216,212,0.5)";
      ctx.font = "8px JetBrains Mono, monospace";
      ctx.fillText("+30 mV", 2, y(30) - 2);
      ctx.fillText("−65 mV", 2, y(-65) - 2);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [selected]);

  const pick = (popIndex: number) => {
    const p = pops[popIndex];
    useLab.getState().selectNeuron(p.start + Math.floor(Math.random() * (p.id === "PLACE" ? Math.max(1, getExperiment().ctx.neural.placeCount) : p.count)));
  };

  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader
        index={index}
        title="NEURON INSPECTOR"
        meta={info ? `#${info.id}` : "SELECT IN RASTER OR CONNECTOME"}
        right={
          <select
            className="mono border border-[var(--color-line)] bg-[#070909] px-1 py-[2px] text-[9px] text-[var(--color-mid)]"
            value={info ? pops.indexOf(info.population) : -1}
            onChange={(e) => pick(Number(e.target.value))}
          >
            <option value={-1}>POPULATION…</option>
            {pops.map((p, i) => (
              <option key={p.id} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        }
      />
      {!info ? (
        <div className="mono flex flex-1 items-center justify-center px-4 text-center text-[10px] tracking-[0.14em] text-[var(--color-dim)]">
          CLICK ANY NEURON TO RECORD ITS MEMBRANE POTENTIAL
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-2">
          <div className="flex items-baseline gap-2">
            <span className="inline-block h-2 w-2" style={{ background: POP_COLORS[info.population.id] }} />
            <span className="mono text-[11px] tracking-[0.12em] text-[var(--color-bright)]">{info.population.label}</span>
            <span className="mono text-[9px] text-[var(--color-dim)]">#{info.index}</span>
          </div>
          <div className="mono text-[9.5px] leading-[1.5] text-[var(--color-text)]">{info.tuning}</div>
          <div className="mono grid grid-cols-3 gap-1 text-[9px]">
            <Stat k="MODEL" v={info.model === "FS" ? "FAST-SPIKING" : info.model === "MSN" ? "MSN" : "REGULAR"} />
            <Stat k="RATE" v={`${info.rate.toFixed(1)} Hz`} />
            <Stat k="V" v={`${info.membrane.toFixed(1)} mV`} />
            <Stat k="a · b" v={`${info.params.a} · ${info.params.b}`} />
            <Stat k="c · d" v={`${info.params.c} · ${info.params.d}`} />
            <Stat k="REGION" v={info.population.region} />
          </div>
          <div className="label mt-0.5">MEMBRANE POTENTIAL · LIVE</div>
          <canvas ref={traceRef} className="h-[62px] w-full shrink-0 border border-[var(--color-line)] bg-[#050707]" />
          {info.outputs.length > 0 && (
            <>
              <div className="label mt-0.5">PLASTIC OUTPUTS → ACTION CHANNELS</div>
              {info.outputs.map((o) => (
                <WeightRow key={o.action} label={o.action} w={o.weight} />
              ))}
            </>
          )}
          {info.inputs.length > 0 && (
            <>
              <div className="label mt-0.5">STRONGEST INPUTS</div>
              {info.inputs.map((o) => (
                <WeightRow key={o.neuron} label={o.label} w={o.weight} onClick={() => useLab.getState().selectNeuron(o.neuron)} />
              ))}
            </>
          )}
          <div className="mono mt-1 text-[8.5px] leading-[1.5] text-[var(--color-dim)]">{info.params.basis}</div>
        </div>
      )}
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-[var(--color-line)] px-1.5 py-1">
      <div className="text-[7.5px] tracking-[0.14em] text-[var(--color-dim)]">{k}</div>
      <div className="tabular truncate text-[9.5px] text-[var(--color-bright)]">{v}</div>
    </div>
  );
}

function WeightRow({ label, w, onClick }: { label: string; w: number; onClick?: () => void }) {
  const pct = Math.min(100, Math.abs(w) * 60);
  return (
    <div className={`grid h-[14px] grid-cols-[120px_1fr_40px] items-center gap-2 ${onClick ? "cursor-pointer hover:bg-white/[0.03]" : ""}`} onClick={onClick}>
      <span className="mono truncate text-[9px] text-[var(--color-mid)]">{label}</span>
      <div className="relative h-[3px] bg-[rgba(190,210,205,0.06)]">
        <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: w >= 0 ? "#8fe3c4" : "#ff5f4f" }} />
      </div>
      <span className="mono tabular text-right text-[9px] text-[var(--color-text)]">{w.toFixed(2)}</span>
    </div>
  );
}
