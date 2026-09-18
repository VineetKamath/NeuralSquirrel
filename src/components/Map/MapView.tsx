"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getExperiment } from "@/store/runtime";
import { useLab } from "@/store/labStore";
import { getSite, LAND } from "@/real/site";
import { CENSUS } from "@/real/census";
import { localToLonLat } from "@/real/siteConfig";
import { WORLD_HALF, WORLD_SIZE, GRID_RES, GRID_CELL } from "@/simulation/constants";
import { realDateString } from "@/utils/format";
import { BASE_PPM, COVER_NAMES, elevationAt, getMapBase } from "./mapBase";

export type MapLayer =
  | "cognitive"
  | "danger"
  | "memories"
  | "caches"
  | "food"
  | "places"
  | "census"
  | "rivals"
  | "predators"
  | "trail"
  | "events"
  | "names";

export const LAYER_LABELS: Record<MapLayer, string> = {
  cognitive: "COGNITIVE MAP",
  danger: "DANGER",
  memories: "MEMORIES",
  caches: "CACHES",
  food: "FOOD (TRUTH)",
  places: "PLACE CELLS",
  census: "CENSUS 2018",
  rivals: "SQUIRRELS",
  predators: "PREDATORS",
  trail: "TRAIL",
  events: "EVENTS",
  names: "NAMES",
};

const DEFAULT_LAYERS: MapLayer[] = ["cognitive", "memories", "caches", "rivals", "predators", "trail", "names"];

const FUR: Record<string, string> = { Gray: "#b9c0c4", Cinnamon: "#d08a52", Black: "#50504c" };

interface View {
  cx: number;
  cz: number;
  scale: number;
}

interface Inspect {
  x: number;
  z: number;
  sx: number;
  sy: number;
  lines: { k: string; v: string; tone?: string }[];
}

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 300, h: 300 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(50, r.width), h: Math.max(50, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** grid overlay (100 × 100) rendered into a small canvas and stretched over the map */
function gridImage(canvas: HTMLCanvasElement, values: Float32Array | ((i: number) => number), rgb: [number, number, number], gain: number) {
  canvas.width = GRID_RES;
  canvas.height = GRID_RES;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(GRID_RES, GRID_RES);
  for (let i = 0; i < GRID_RES * GRID_RES; i++) {
    const v = typeof values === "function" ? values(i) : values[i];
    const a = Math.max(0, Math.min(1, v * gain));
    img.data[i * 4] = rgb[0];
    img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = a * 200;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Interactive map of the real study site: cartographic base, the subject's cognitive map and
 * ground-truth layers, pan/zoom, click inspection and a time scrubber over the recorded trail.
 */
export function MapView({ compact = false, initialLayers = DEFAULT_LAYERS }: { compact?: boolean; initialLayers?: MapLayer[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useSize(wrap);
  const [layers, setLayers] = useState<Set<MapLayer>>(() => new Set(initialLayers));
  const [follow, setFollow] = useState(true);
  const [scrub, setScrub] = useState<number | null>(null);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const view = useRef<View>({ cx: 0, cz: 0, scale: compact ? 1.4 : 2.2 });
  const drag = useRef<{ x: number; y: number; cx: number; cz: number; moved: boolean } | null>(null);
  const cognitive = useMemo(() => (typeof document !== "undefined" ? document.createElement("canvas") : null), []);
  const danger = useMemo(() => (typeof document !== "undefined" ? document.createElement("canvas") : null), []);
  const focusMemoryId = useLab((s) => s.focusMemoryId);
  const [timeRange, setTimeRange] = useState({ t0: 0, t1: 1 });
  const [playing, setPlaying] = useState(0);
  const scrubRef = useRef(scrub);
  scrubRef.current = scrub;
  const followRef = useRef(follow);
  followRef.current = follow;
  const replay = useLab((s) => s.replay);

  // time-lapse playback of the recorded history (sim seconds per real second)
  useEffect(() => {
    if (!playing || compact) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setScrub((v) => {
        const t1 = getExperiment().time;
        const next = (v ?? getExperiment().trail[0]) + dt * playing;
        if (next >= t1) {
          setPlaying(0);
          return null;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, compact]);

  // replay an event selected in the timeline: jump shortly before it and play through
  useEffect(() => {
    if (!replay || compact) return;
    setFollow(false);
    view.current.cx = replay.x;
    view.current.cz = replay.z;
    view.current.scale = Math.max(view.current.scale, 5);
    setLayers((l) => new Set([...l, "trail", "events"]));
    setScrub(Math.max(getExperiment().trail[0] ?? 0, replay.time - 40));
    setPlaying(8);
    const t = setTimeout(() => useLab.setState({ replay: null }), 100);
    return () => clearTimeout(t);
  }, [replay, compact]);

  const toggleLayer = (l: MapLayer) =>
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });

  const toScreen = useCallback(
    (x: number, z: number) => {
      const v = view.current;
      return [size.w / 2 + (x - v.cx) * v.scale, size.h / 2 + (z - v.cz) * v.scale] as const;
    },
    [size]
  );
  const toWorld = useCallback(
    (sx: number, sy: number) => {
      const v = view.current;
      return [(sx - size.w / 2) / v.scale + v.cx, (sy - size.h / 2) / v.scale + v.cz] as const;
    },
    [size]
  );

  // focus a memory selected elsewhere in the UI
  useEffect(() => {
    if (!focusMemoryId) return;
    const m = getExperiment().ctx.memory.memories.find((x) => x.id === focusMemoryId);
    if (m) {
      setFollow(false);
      view.current.cx = m.location.x;
      view.current.cz = m.location.z;
      view.current.scale = Math.max(view.current.scale, 4);
    }
  }, [focusMemoryId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const base = getMapBase();
    const site = getSite();
    let raf = 0;
    let last = 0;
    let lastGrid = -10;
    let lastRange = -1000;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < (compact ? 200 : 90)) return;
      last = now;
      const exp = getExperiment();
      const world = exp.world;
      const s = exp.agent.state;
      const v = view.current;
      const time = world.state.time;
      const scrub = scrubRef.current;
      const follow = followRef.current;
      const tScrub = scrub ?? time;
      const t0 = exp.trailCount ? exp.trail[0] : 0;
      if (!compact && now - lastRange > 500) {
        lastRange = now;
        setTimeRange((r) => (Math.abs(r.t1 - time) > 1 || r.t0 !== t0 ? { t0, t1: time } : r));
      }

      // subject position at the scrubbed time
      let px = s.position.x;
      let pz = s.position.z;
      if (scrub !== null && exp.trailCount) {
        let lo = 0;
        let hi = exp.trailCount - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (exp.trail[mid * 4] <= tScrub) lo = mid;
          else hi = mid - 1;
        }
        px = exp.trail[lo * 4 + 1];
        pz = exp.trail[lo * 4 + 2];
      }
      if (follow) {
        v.cx += (px - v.cx) * 0.25;
        v.cz += (pz - v.cz) * 0.25;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#07090a";
      ctx.fillRect(0, 0, size.w, size.h);
      const [ox, oy] = toScreen(-WORLD_HALF, -WORLD_HALF);
      ctx.imageSmoothingEnabled = v.scale < BASE_PPM * 1.5;
      ctx.drawImage(base, ox, oy, WORLD_SIZE * v.scale, WORLD_SIZE * v.scale);

      const mem = exp.ctx.memory;
      if ((layers.has("cognitive") || layers.has("danger")) && now - lastGrid > 1000) {
        lastGrid = now;
        if (cognitive) gridImage(cognitive, mem.familiarity, [143, 227, 196], 0.9);
        if (danger) gridImage(danger, (i) => mem.danger[i], [255, 95, 79], 1.4);
      }
      ctx.imageSmoothingEnabled = true;
      if (layers.has("cognitive") && cognitive) {
        ctx.globalAlpha = 0.45;
        ctx.drawImage(cognitive, ox, oy, WORLD_SIZE * v.scale, WORLD_SIZE * v.scale);
        ctx.globalAlpha = 1;
      }
      if (layers.has("danger") && danger) {
        ctx.globalAlpha = 0.7;
        ctx.drawImage(danger, ox, oy, WORLD_SIZE * v.scale, WORLD_SIZE * v.scale);
        ctx.globalAlpha = 1;
      }

      const dot = (x: number, z: number, r: number, fill: string, stroke?: string) => {
        const [sx, sy] = toScreen(x, z);
        if (sx < -20 || sy < -20 || sx > size.w + 20 || sy > size.h + 20) return;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      };

      if (layers.has("census")) {
        for (const c of CENSUS.sightings) dot(c.x, c.z, compact ? 1.2 : 2.2, FUR[c.fur] ?? "#999", "rgba(0,0,0,0.5)");
      }

      if (layers.has("places")) {
        const nb = exp.ctx.neural;
        for (let i = 0; i < nb.placeCount; i++) {
          const val = nb.Wv[i];
          const a = Math.min(1, Math.abs(val) * 2.5 + 0.15);
          const col = val >= 0 ? `rgba(232,179,106,${a})` : `rgba(127,183,232,${a})`;
          const [sx, sy] = toScreen(nb.placeX[i], nb.placeZ[i]);
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1.5, 5 * v.scale * 0.35), 0, Math.PI * 2);
          ctx.strokeStyle = col;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      if (layers.has("food")) {
        for (const f of world.state.foodSources) {
          if (f.amount < 1 || f.kind === "cache") continue;
          const col = f.toxic ? "#ff5f4f" : f.kind === "scraps" ? "#f0e0a0" : f.kind === "berry" ? "#d05a8a" : "#e8b36a";
          dot(f.position.x, f.position.z, compact ? 1 : 1.8, col);
        }
      }

      if (layers.has("caches")) {
        for (const f of world.state.foodSources) {
          if (f.kind !== "cache" || f.amount < 1) continue;
          const own = f.owner === "subject";
          const resident = f.owner === "resident";
          if (resident && v.scale < 1.6) continue;
          dot(f.position.x, f.position.z, own ? 2.4 : 1.4, own ? "#b69cf2" : resident ? "rgba(160,150,190,0.35)" : "#e07ab0");
        }
      }

      if (layers.has("trail") && exp.trailCount > 1) {
        const tr = exp.trail;
        const n = exp.trailCount;
        const stride = Math.max(1, Math.floor(n / 6000));
        ctx.lineWidth = compact ? 1 : 1.3;
        let prevGen = -1;
        for (let i = 0; i < n; i += stride) {
          const t = tr[i * 4];
          if (t > tScrub) break;
          const age = (tScrub - t) / (480 * 3);
          if (age > 1 && scrub === null && compact) continue;
          const [sx, sy] = toScreen(tr[i * 4 + 1], tr[i * 4 + 2]);
          const gen = tr[i * 4 + 3];
          if (gen !== prevGen || i === 0) {
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            prevGen = gen;
            ctx.strokeStyle = `rgba(143,227,196,${Math.max(0.12, 0.8 - Math.min(1, age) * 0.65)})`;
          } else {
            if (i % (stride * 60) === 0) {
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.strokeStyle = `rgba(143,227,196,${Math.max(0.12, 0.8 - Math.min(1, age) * 0.65)})`;
            } else ctx.lineTo(sx, sy);
          }
        }
        ctx.stroke();
      }

      if (layers.has("memories")) {
        for (const m of mem.memories) {
          const col =
            m.subtype === "water"
              ? "#7fb7e8"
              : m.type === "danger"
                ? "#ff5f4f"
                : m.subtype === "cache"
                  ? "#b69cf2"
                  : m.type === "food"
                    ? "#e8b36a"
                    : m.type === "social"
                      ? "#e07ab0"
                      : "#cfd8d4";
          const [sx, sy] = toScreen(m.location.x, m.location.z);
          const r = 2 + m.confidence * 3;
          ctx.beginPath();
          ctx.moveTo(sx, sy - r);
          ctx.lineTo(sx + r, sy);
          ctx.lineTo(sx, sy + r);
          ctx.lineTo(sx - r, sy);
          ctx.closePath();
          ctx.fillStyle = col + "55";
          ctx.fill();
          ctx.strokeStyle = m.id === focusMemoryId ? "#ffffff" : col;
          ctx.lineWidth = m.id === focusMemoryId ? 2 : 1;
          ctx.stroke();
        }
      }

      if (layers.has("events") && !compact) {
        const log = exp.ctx.events.log;
        for (const e of log) {
          if (!e.location || e.time > tScrub || tScrub - e.time > 480 * 5) continue;
          const col = e.category === "danger" ? "#ff5f4f" : e.category === "environment" ? "#7fb7e8" : e.category === "social" ? "#e07ab0" : e.major ? "#8fe3c4" : "rgba(207,216,212,0.5)";
          const [sx, sy] = toScreen(e.location.x, e.location.z);
          ctx.strokeStyle = col;
          ctx.lineWidth = 1;
          ctx.strokeRect(sx - 3, sy - 3, 6, 6);
        }
      }

      if (layers.has("rivals") && scrub === null) {
        for (const r of exp.ctx.rivals?.rivals ?? []) {
          if (!r.alive) continue;
          dot(r.position.x, r.position.z, compact ? 2 : 3.2, FUR[r.fur] ?? "#aaa", "#e07ab0");
          if (!compact && v.scale > 1.5) {
            const [sx, sy] = toScreen(r.position.x, r.position.z);
            ctx.fillStyle = "rgba(224,122,176,0.85)";
            ctx.font = "9px JetBrains Mono, monospace";
            ctx.fillText(r.name, sx + 5, sy - 4);
          }
        }
      }

      if (layers.has("predators") && scrub === null) {
        for (const t of world.state.threats) {
          const [sx, sy] = toScreen(t.position.x, t.position.z);
          ctx.strokeStyle = t.kind === "hawk" ? "#e8b36a" : "#ff5f4f";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 5);
          ctx.lineTo(sx + 5, sy + 4);
          ctx.lineTo(sx - 5, sy + 4);
          ctx.closePath();
          ctx.stroke();
          if (!compact) {
            ctx.fillStyle = ctx.strokeStyle;
            ctx.font = "8.5px JetBrains Mono, monospace";
            ctx.fillText(t.kind === "hawk" ? "RED-TAILED HAWK" : "DOG OFF LEASH", sx + 7, sy + 3);
          }
        }
      }

      if (layers.has("names") && !compact) {
        ctx.font = "9px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        for (const nm of site.raw.names) {
          const [sx, sy] = toScreen(nm.x, nm.z);
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillText(nm.name.toUpperCase(), sx + 1, sy + 1);
          ctx.fillStyle = "rgba(220,230,224,0.8)";
          ctx.fillText(nm.name.toUpperCase(), sx, sy);
        }
        ctx.textAlign = "left";
      }

      // nest and subject
      const home = exp.agent.homeTree.position;
      {
        const [sx, sy] = toScreen(home.x, home.z);
        ctx.strokeStyle = "#e8b36a";
        ctx.lineWidth = 1.2;
        ctx.strokeRect(sx - 4, sy - 4, 8, 8);
        if (!compact) {
          ctx.fillStyle = "#e8b36a";
          ctx.font = "8.5px JetBrains Mono, monospace";
          ctx.fillText("NEST", sx + 6, sy + 3);
        }
      }
      {
        const [sx, sy] = toScreen(px, pz);
        ctx.beginPath();
        ctx.arc(sx, sy, compact ? 3 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = s.alive ? "#8fe3c4" : "#5b6663";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx, sy, (compact ? 6 : 9) + Math.sin(now / 300) * 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(143,227,196,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
        if (scrub === null) {
          const hd = s.anim.heading;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.sin(hd) * 12, sy + Math.cos(hd) * 12);
          ctx.strokeStyle = "#8fe3c4";
          ctx.stroke();
          if (!compact) {
            const vr = exp.agent.perception?.visionRange ?? 0;
            ctx.beginPath();
            ctx.arc(sx, sy, vr * v.scale, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(143,227,196,0.12)";
            ctx.setLineDash([3, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      // scale bar
      if (!compact) {
        const metres = v.scale > 4 ? 10 : v.scale > 1.5 ? 50 : 100;
        const w = metres * v.scale;
        ctx.strokeStyle = "rgba(220,230,224,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(12, size.h - 14);
        ctx.lineTo(12 + w, size.h - 14);
        ctx.moveTo(12, size.h - 18);
        ctx.lineTo(12, size.h - 10);
        ctx.moveTo(12 + w, size.h - 18);
        ctx.lineTo(12 + w, size.h - 10);
        ctx.stroke();
        ctx.fillStyle = "rgba(220,230,224,0.8)";
        ctx.font = "9px JetBrains Mono, monospace";
        ctx.fillText(`${metres} m`, 16 + w, size.h - 10);
        // north arrow (+z is south)
        ctx.fillText("N ↑", size.w - 30, size.h - 10);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, layers, compact, toScreen, cognitive, danger, focusMemoryId]);

  const onWheel = (e: React.WheelEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const [wx, wz] = toWorld(mx, my);
    const v = view.current;
    v.scale = Math.max(0.6, Math.min(24, v.scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
    if (!follow) {
      v.cx = wx - (mx - size.w / 2) / v.scale;
      v.cz = wz - (my - size.h / 2) / v.scale;
    }
  };

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, cx: view.current.cx, cz: view.current.cz, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      d.moved = true;
      setFollow(false);
    }
    if (d.moved) {
      view.current.cx = d.cx - dx / view.current.scale;
      view.current.cz = d.cz - dy / view.current.scale;
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || compact) {
      if (compact && d && !d.moved) useLab.getState().setMode("ecology");
      return;
    }
    const r = wrap.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const [x, z] = toWorld(sx, sy);
    setInspect({ x, z, sx, sy, lines: inspectAt(x, z) });
  };

  const fit = () => {
    setFollow(false);
    view.current = { cx: 0, cz: 0, scale: Math.min(size.w, size.h) / WORLD_SIZE };
  };

  const zoom = (k: number) => {
    view.current.scale = Math.max(0.6, Math.min(24, view.current.scale * k));
  };

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      <div
        ref={wrap}
        className={`absolute inset-0 ${compact ? "cursor-pointer" : "cursor-crosshair"}`}
        onWheel={compact ? undefined : onWheel}
        onPointerDown={onDown}
        onPointerMove={compact ? undefined : onMove}
        onPointerUp={onUp}
      >
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      </div>

      {!compact && (
        <>
          <div className="absolute left-2 top-2 flex max-w-[70%] flex-wrap gap-1">
            {(Object.keys(LAYER_LABELS) as MapLayer[]).map((l) => (
              <button key={l} className="btn !px-1.5 !py-[3px] !text-[8.5px] bg-[#070909]/80" data-active={layers.has(l)} onClick={() => toggleLayer(l)}>
                {LAYER_LABELS[l]}
              </button>
            ))}
          </div>
          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <button className="btn bg-[#070909]/80" data-active={follow} onClick={() => setFollow((f) => !f)} title="Follow subject">
              ◎ FOLLOW
            </button>
            <button className="btn bg-[#070909]/80" onClick={fit}>
              ⤢ FIT
            </button>
            <div className="flex gap-1">
              <button className="btn flex-1 bg-[#070909]/80" onClick={() => zoom(1.4)}>
                +
              </button>
              <button className="btn flex-1 bg-[#070909]/80" onClick={() => zoom(1 / 1.4)}>
                −
              </button>
            </div>
          </div>
          <Scrubber
            range={timeRange}
            value={scrub}
            onChange={(v) => {
              setPlaying(0);
              setScrub(v);
            }}
            playing={playing}
            onPlay={(rate) => {
              if (scrub === null && rate) setScrub(timeRange.t0);
              setPlaying(rate);
            }}
          />
          <Legend />
          {inspect && <InspectCard data={inspect} onClose={() => setInspect(null)} />}
        </>
      )}
    </div>
  );
}

function Scrubber({
  range,
  value,
  onChange,
  playing,
  onPlay,
}: {
  range: { t0: number; t1: number };
  value: number | null;
  onChange: (v: number | null) => void;
  playing: number;
  onPlay: (rate: number) => void;
}) {
  const span = Math.max(1, range.t1 - range.t0);
  const t = value ?? range.t1;
  const rates = [8, 60, 480];
  return (
    <div className="absolute inset-x-2 bottom-7 flex items-center gap-2 border border-[var(--color-line)] bg-[#070909]/85 px-2 py-1">
      <span className="mono shrink-0 text-[8.5px] tracking-[0.14em] text-[var(--color-dim)]">TIME-LAPSE</span>
      {rates.map((r) => (
        <button key={r} className="btn !px-1.5 !py-[3px] !text-[8.5px]" data-active={playing === r} onClick={() => onPlay(playing === r ? 0 : r)} title={r === 480 ? "one day per second" : r === 60 ? "3 hours per second" : "real-time replay ×8"}>
          {playing === r ? "Ⅱ" : "▶"} {r === 480 ? "1 D/S" : r === 60 ? "3 H/S" : "×8"}
        </button>
      ))}
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(((t - range.t0) / span) * 1000)}
        onChange={(e) => {
          const v = range.t0 + (Number(e.target.value) / 1000) * span;
          onChange(v >= range.t1 - span * 0.002 ? null : v);
        }}
        className="h-1 min-w-0 flex-1 accent-[#8fe3c4]"
      />
      <span className="mono tabular shrink-0 text-[9px] tracking-[0.08em] text-[var(--color-text)]">{realDateString(t)}</span>
      <button className="btn !px-1.5 !py-[3px] !text-[8.5px]" data-active={value === null} onClick={() => onChange(null)}>
        LIVE
      </button>
    </div>
  );
}

function Legend() {
  const items: [string, string][] = [
    ["#8fe3c4", "SUBJECT / FAMILIAR"],
    ["#e8b36a", "FOOD MEMORY · NEST"],
    ["#7fb7e8", "WATER"],
    ["#b69cf2", "OWN CACHE"],
    ["#e07ab0", "OTHER SQUIRRELS"],
    ["#ff5f4f", "DANGER"],
  ];
  return (
    <div className="mono absolute right-2 bottom-16 hidden flex-col gap-[2px] border border-[var(--color-line)] bg-[#070909]/80 px-2 py-1 text-[8px] tracking-[0.1em] text-[var(--color-mid)] md:flex">
      {items.map(([c, l]) => (
        <div key={l} className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5" style={{ background: c }} />
          {l}
        </div>
      ))}
    </div>
  );
}

function InspectCard({ data, onClose }: { data: Inspect; onClose: () => void }) {
  return (
    <div
      className="mono absolute z-10 w-[250px] border border-[var(--color-line-strong)] bg-[#0a0c0d]/95 px-2.5 py-2 text-[9.5px] shadow-xl"
      style={{ left: Math.min(data.sx + 10, 9999), top: Math.max(4, data.sy - 20), transform: data.sx > 400 ? "translateX(-110%)" : undefined }}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="tracking-[0.2em] text-[var(--color-bright)]">INSPECT</span>
        <button className="text-[var(--color-dim)] hover:text-[var(--color-bright)]" onClick={onClose}>
          ✕
        </button>
      </div>
      {data.lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[86px_1fr] gap-2 leading-[1.55]">
          <span className="tracking-[0.08em] text-[var(--color-dim)]">{l.k}</span>
          <span className="truncate" style={{ color: l.tone ?? "var(--color-text)" }} title={l.v}>
            {l.v}
          </span>
        </div>
      ))}
    </div>
  );
}

/** everything the lab knows about a point: real site data, ground truth and the subject's beliefs */
function inspectAt(x: number, z: number) {
  const exp = getExperiment();
  const site = getSite();
  const world = exp.world;
  const lines: { k: string; v: string; tone?: string }[] = [];
  const { lon, lat } = localToLonLat(x, z);
  lines.push({ k: "LOCAL", v: `${x.toFixed(1)} E · ${(-z).toFixed(1)} N m` });
  lines.push({ k: "WGS84", v: `${lat.toFixed(5)}, ${lon.toFixed(5)}` });
  lines.push({ k: "ELEVATION", v: `${elevationAt(x, z).toFixed(1)} m (USGS DEM)` });
  const land = site.landAt(x, z);
  let cover = COVER_NAMES[land] ?? "—";
  if (land === LAND.WATER) {
    const edge = site.nearestWaterEdge(x, z, 5);
    cover = `WATER · ${edge?.body?.name ?? ""}`;
  }
  if (site.onBridge(x, z)) cover = "BRIDGE";
  else if (site.distToPath(x, z) < 1.5) cover += " · FOOTPATH";
  lines.push({ k: "LAND COVER", v: `${cover} (OSM)` });
  const near = world.objectsNear(x, z, 4).sort((a, b) => Math.hypot(a.position.x - x, a.position.z - z) - Math.hypot(b.position.x - x, b.position.z - z))[0];
  if (near) lines.push({ k: "OBJECT", v: `${near.kind.toUpperCase()}${near.fallen ? " (FALLEN)" : ""}${near.crop !== undefined && near.kind === "oak" ? ` · CROP ${near.crop.toFixed(0)}` : ""}` });
  const food = world.state.foodSources.filter((f) => f.amount >= 1 && Math.hypot(f.position.x - x, f.position.z - z) < 4);
  if (food.length) lines.push({ k: "FOOD", v: food.map((f) => `${f.label} ×${Math.floor(f.amount)}`).join(", "), tone: "#e8b36a" });
  const mem = exp.ctx.memory;
  lines.push({ k: "FAMILIARITY", v: `${Math.round(mem.familiarityAt(x, z) * 100)}%`, tone: "#8fe3c4" });
  const d = mem.dangerAt(x, z);
  if (d > 0.02) lines.push({ k: "DANGER", v: `${Math.round(d * 100)}%`, tone: "#ff5f4f" });
  const m = mem.memories.filter((mm) => Math.hypot(mm.location.x - x, mm.location.z - z) < 6).sort((a, b) => b.confidence - a.confidence)[0];
  if (m) lines.push({ k: "MEMORY", v: `${m.label} · ${Math.round(m.confidence * 100)}%`, tone: "#e8b36a" });
  const nb = exp.ctx.neural;
  let best = -1;
  let bd = 12;
  for (let i = 0; i < nb.placeCount; i++) {
    const dd = Math.hypot(nb.placeX[i] - x, nb.placeZ[i] - z);
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  }
  if (best >= 0) lines.push({ k: "PLACE CELL", v: `#${best} · value ${nb.Wv[best].toFixed(2)} · ${bd.toFixed(1)} m`, tone: "#b69cf2" });
  else lines.push({ k: "PLACE CELL", v: "none recruited here", tone: "#5b6663" });
  const c = CENSUS.sightings.filter((cs) => Math.hypot(cs.x - x, cs.z - z) < 10).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  if (c) {
    const acts = [c.forage && "foraging", c.eat && "eating", c.climb && "climbing", c.run && "running", c.chase && "chasing"].filter(Boolean).join(", ");
    lines.push({ k: "CENSUS 2018", v: `${c.id} · ${c.fur} ${c.age} · ${c.shift} ${c.date}` });
    if (acts) lines.push({ k: "OBSERVED", v: acts });
    if (c.note) lines.push({ k: "NOTE", v: c.note });
  }
  void GRID_CELL;
  return lines;
}
