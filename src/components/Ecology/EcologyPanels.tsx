"use client";

import { memo, useMemo } from "react";
import { Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLab } from "@/store/labStore";
import { PanelHeader } from "@/components/Telemetry/PanelHeader";
import { dailySeries, WEATHER_SOURCE } from "@/real/weather";
import { CENSUS, COMPARABLE } from "@/real/census";
import { SITE } from "@/real/siteConfig";
import { formatDate, localTime } from "@/real/calendar";
import { SITE_META } from "@/real/site";
import { pad } from "@/utils/format";

const FUR: Record<string, string> = { Gray: "#b9c0c4", Cinnamon: "#d08a52", Black: "#6a6a64" };

/** the real 2018–19 weather record for the site, with the experiment's current date marked */
export const WeatherPanel = memo(function WeatherPanel({ index = "E2" }: { index?: string }) {
  const utc = useLab((s) => Math.floor((s.snap?.env.utc ?? SITE.startUTC) / 3600000));
  const tempC = useLab((s) => Math.round((s.snap?.env.tempC ?? 0) * 10) / 10);
  const wind = useLab((s) => Math.round(s.snap?.env.windKmh ?? 0));
  const cloud = useLab((s) => Math.round(s.snap?.env.cloud ?? 0));
  const series = useMemo(
    () =>
      dailySeries()
        .filter((d) => d.utc >= SITE.startUTC - 86400000 * 5)
        .map((d) => ({ ...d, label: formatDate(localTime(d.utc + 12 * 3600000)).slice(4, 10), snowCm: d.snow * 100 })),
    []
  );
  const now = series.findIndex((d) => d.utc > utc * 3600000) - 1;
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader
        index={index}
        title="WEATHER RECORD"
        meta="ERA5 · CENTRAL PARK · OCT 2018 – JUN 2019"
        right={
          <span className="mono tabular text-[9px] text-[var(--color-text)]">
            {tempC.toFixed(1)} °C · WIND {wind} km/h · CLOUD {cloud}%
          </span>
        }
      />
      <div className="min-h-0 flex-1 px-1 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <XAxis dataKey="label" tick={{ fill: "#5b6663", fontSize: 8.5, fontFamily: "JetBrains Mono" }} interval={29} tickLine={false} axisLine={{ stroke: "rgba(190,210,205,0.1)" }} />
            <YAxis yAxisId="t" tick={{ fill: "#5b6663", fontSize: 8.5, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false} width={40} unit="°" />
            <YAxis yAxisId="p" orientation="right" hide domain={[0, 60]} />
            <Tooltip
              contentStyle={{ background: "#0a0c0d", border: "1px solid rgba(190,210,205,0.18)", fontFamily: "JetBrains Mono", fontSize: 10 }}
              labelStyle={{ color: "#8c9894" }}
              formatter={(v, n) => [n === "snowCm" ? `${Number(v).toFixed(0)} cm` : n === "precip" ? `${Number(v).toFixed(1)} mm` : `${Number(v).toFixed(1)} °C`, n === "snowCm" ? "SNOW DEPTH" : String(n).toUpperCase()]}
            />
            <Bar yAxisId="p" dataKey="precip" fill="#7fb7e8" opacity={0.45} isAnimationActive={false} />
            <Bar yAxisId="p" dataKey="snowCm" fill="#eef4f1" opacity={0.35} isAnimationActive={false} />
            <Line yAxisId="t" dataKey="max" stroke="#e8966a" dot={false} strokeWidth={1} isAnimationActive={false} />
            <Line yAxisId="t" dataKey="min" stroke="#7fb7e8" dot={false} strokeWidth={1} isAnimationActive={false} />
            <ReferenceLine yAxisId="t" y={0} stroke="rgba(190,210,205,0.18)" strokeDasharray="2 3" />
            {now >= 0 && <ReferenceLine yAxisId="t" x={series[now].label} stroke="#8fe3c4" strokeWidth={1.5} label={{ value: "NOW", fill: "#8fe3c4", fontSize: 8.5, position: "top" }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mono truncate px-3 pb-1.5 text-[8px] tracking-[0.08em] text-[var(--color-dim)]">SOURCE · {WEATHER_SOURCE}</div>
    </section>
  );
});

/** resident squirrels (seeded from 2018 census activity centres) and the subject's lineage */
export function PopulationPanel({ index = "E3" }: { index?: string }) {
  const rivals = useLab((s) => s.snap?.rivals ?? []);
  const lineage = useLab((s) => s.lineage);
  const gen = useLab((s) => s.snap?.generation ?? 1);
  const age = useLab((s) => s.snap?.ageDays ?? 0);
  const fur = useLab((s) => s.snap?.fur ?? "Gray");
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader index={index} title="POPULATION" meta="NEIGHBOURS · LINEAGE" right={<span className="mono text-[9px] text-[var(--color-mid)]">{rivals.filter((r) => r.alive).length} RESIDENTS ALIVE</span>} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto px-3 pb-2 lg:grid-cols-2">
        <div>
          <div className="label mb-1">RESIDENT SQUIRRELS</div>
          <div className="mono grid grid-cols-[1fr_58px_34px_34px_44px] gap-x-2 border-b border-[var(--color-line)] pb-[2px] text-[8px] tracking-[0.1em] text-[var(--color-dim)]">
            <span>NAME</span>
            <span>STATE</span>
            <span className="text-right">CACHE</span>
            <span className="text-right">STOLE</span>
            <span className="text-right">DIST</span>
          </div>
          {rivals.map((r) => (
            <div key={r.id} className={`mono grid grid-cols-[1fr_58px_34px_34px_44px] items-center gap-x-2 py-[2px] text-[9.5px] ${r.alive ? "text-[var(--color-text)]" : "text-[var(--color-dim)] line-through"}`}>
              <span className="flex items-center gap-1.5 truncate">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: FUR[r.fur] ?? "#999" }} />
                {r.name}
              </span>
              <span className="truncate text-[8.5px] uppercase text-[var(--color-mid)]">{r.alive ? r.mode : "dead"}</span>
              <span className="tabular text-right">{r.cached}</span>
              <span className="tabular text-right">{r.pilfered}</span>
              <span className="tabular text-right">{r.distance.toFixed(0)} m</span>
            </div>
          ))}
        </div>
        <div>
          <div className="label mb-1">LINEAGE</div>
          {lineage.map((l) => (
            <div key={l.generation} className="mono grid grid-cols-[30px_1fr_52px] gap-x-2 py-[2px] text-[9.5px] text-[var(--color-mid)]">
              <span className="text-[var(--color-dim)]">G{pad(l.generation)}</span>
              <span className="flex items-center gap-1.5 truncate">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: FUR[l.fur] ?? "#999" }} />
                {l.cause.toUpperCase()}
              </span>
              <span className="tabular text-right">{l.daysAlive.toFixed(1)} d</span>
            </div>
          ))}
          <div className="mono grid grid-cols-[30px_1fr_52px] gap-x-2 py-[2px] text-[9.5px] text-[var(--color-signal)]">
            <span>G{pad(gen)}</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: FUR[fur] ?? "#999" }} />
              LIVING
            </span>
            <span className="tabular text-right">{age.toFixed(1)} d</span>
          </div>
          <div className="mono mt-2 text-[8.5px] leading-[1.5] text-[var(--color-dim)]">
            Successors inherit mutated instincts (innate synaptic biases) and temperament. Learned knowledge is not inherited except the parent&apos;s caches.
          </div>
        </div>
      </div>
    </section>
  );
}

/** how closely the subject's behaviour matches what 2018 census volunteers recorded for real squirrels */
export function CensusPanel({ index = "E4" }: { index?: string }) {
  const sim = useLab((s) => s.snap?.censusSim ?? {});
  const bias = useLab((s) => s.snap?.calibrationBias ?? {});
  const realism = useLab((s) => s.snap?.realism ?? 0);
  const samples = useLab((s) => s.snap?.censusSamples ?? 0);
  const real = CENSUS.park as unknown as Record<string, number>;
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader
        index={index}
        title="CENSUS CALIBRATION"
        meta={`${CENSUS.total.toLocaleString()} REAL SIGHTINGS · ${samples.toLocaleString()} SIMULATED`}
        right={<span className={`mono tabular text-[11px] ${realism > 0.7 ? "text-[var(--color-signal)]" : "text-[var(--color-amber)]"}`}>{Math.round(realism * 100)}% REALISM</span>}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-3 pb-2">
        <div className="mono grid grid-cols-[92px_1fr_62px_44px] gap-x-2 text-[8px] tracking-[0.1em] text-[var(--color-dim)]">
          <span>BEHAVIOUR</span>
          <span />
          <span className="text-right">SIM / REAL</span>
          <span className="text-right">BIAS</span>
        </div>
        {COMPARABLE.map((c) => {
          const sv = sim[c.key] ?? 0;
          const rv = real[c.key] ?? 0;
          const scale = Math.max(0.5, sv, rv);
          return (
            <div key={c.key} className="grid grid-cols-[92px_1fr_62px_44px] items-center gap-x-2">
              <span className="mono truncate text-[9px] tracking-[0.06em] text-[var(--color-mid)]">{c.label}</span>
              <div className="relative h-[10px]">
                <div className="absolute left-0 top-[1px] h-[3px]" style={{ width: `${(rv / scale) * 100}%`, background: "#e8b36a" }} />
                <div className="absolute left-0 top-[6px] h-[3px]" style={{ width: `${(sv / scale) * 100}%`, background: "#8fe3c4" }} />
              </div>
              <span className="mono tabular text-right text-[9px] text-[var(--color-text)]">
                {Math.round(sv * 100)} / {Math.round(rv * 100)}%
              </span>
              <span className="mono tabular text-right text-[9px] text-[var(--color-dim)]">{(bias[c.key] ?? 0) >= 0 ? "+" : ""}{(bias[c.key] ?? 0).toFixed(2)}</span>
            </div>
          );
        })}
        <div className="mono mt-1 flex gap-3 text-[8.5px] text-[var(--color-dim)]">
          <span>
            <span className="text-[#e8b36a]">■</span> CENSUS 2018
          </span>
          <span>
            <span className="text-[#8fe3c4]">■</span> SUBJECT (SAME PROTOCOL)
          </span>
        </div>
        <div className="mono mt-1 text-[8.5px] leading-[1.5] text-[var(--color-dim)]">
          Each simulated daylight observation is scored with the census volunteers&apos; categories. Daily calibration nudges drive biases toward the real rates; decisions themselves stay emergent.
        </div>
      </div>
    </section>
  );
}

/** what is real and where it came from */
export function ProvenancePanel({ index = "E5" }: { index?: string }) {
  const rows: [string, string, string][] = [
    ["TERRAIN", "USGS 3DEP via AWS Terrain Tiles (z15)", "REAL"],
    ["LAND COVER · PATHS · WATER", `OpenStreetMap (${SITE_META.fetchedAt.slice(0, 10)})`, "REAL"],
    ["WEATHER (HOURLY)", "Open-Meteo ERA5 reanalysis", "REAL"],
    ["SUN · MOON · DST", "NOAA solar equations, lunar ephemeris", "REAL"],
    ["SQUIRREL BEHAVIOUR RATES", "2018 Central Park Squirrel Census", "REAL"],
    ["FUR MORPHS · SIGHTINGS", "2018 Central Park Squirrel Census", "REAL"],
    ["ENERGY BUDGET", "Kleiber scaling, thermoregulation", "PUBLISHED"],
    ["NEURON MODEL", "Izhikevich 2003/2007", "PUBLISHED"],
    ["PLASTICITY", "STDP (Song 2000) + dopamine TD (Frémaux 2013)", "PUBLISHED"],
    ["PHENOLOGY · ACORN MAST", "NYC leaf/mast timing, modelled", "MODEL"],
    ["INDIVIDUAL DECISIONS", "Spiking network + drives, emergent", "SIMULATED"],
    ["TREE POSITIONS · FOOD ITEMS", "Procedural within real land cover", "SIMULATED"],
  ];
  const tone: Record<string, string> = { REAL: "#8fe3c4", PUBLISHED: "#7fb7e8", MODEL: "#e8b36a", SIMULATED: "#b69cf2" };
  return (
    <section className="panel flex min-h-0 flex-col">
      <PanelHeader index={index} title="DATA PROVENANCE" meta={`SITE · THE RAMBLE, CENTRAL PARK · ${SITE.centerLat.toFixed(4)}°N ${Math.abs(SITE.centerLon).toFixed(4)}°W`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {rows.map(([k, v, t]) => (
          <div key={k} className="mono grid grid-cols-[150px_1fr_70px] gap-x-2 border-b border-[var(--color-line)] py-[3px] text-[9px]">
            <span className="tracking-[0.06em] text-[var(--color-mid)]">{k}</span>
            <span className="truncate text-[var(--color-text)]" title={v}>
              {v}
            </span>
            <span className="text-right tracking-[0.1em]" style={{ color: tone[t] }}>
              {t}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
