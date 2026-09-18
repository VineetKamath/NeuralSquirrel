"use client";

import { useEffect, useRef, useState } from "react";
import { useLab, type LabMode } from "@/store/labStore";
import { TIME_SCALES } from "@/simulation/constants";
import { pad } from "@/utils/format";
import { pushControl } from "@/store/serverLink";
import { setSpeedEverywhere } from "@/components/Lab/Settings";
import { LIVE } from "@/store/liveMode";

const MODES: { id: LabMode; label: string; key: string }[] = [
  { id: "observe", label: "OBSERVE", key: "1" },
  { id: "neural", label: "NEUROSCIENCE", key: "2" },
  { id: "ecology", label: "ECOLOGY", key: "3" },
];

function weatherGlyph(w: string, night: boolean) {
  switch (w) {
    case "rain":
      return "☂";
    case "snow":
      return "❄";
    case "storm":
      return "⚡";
    case "fog":
      return "≋";
    case "cloudy":
      return "☁";
    default:
      return night ? "☾" : "☀";
  }
}

export function scaleFor(speed: number) {
  return TIME_SCALES.reduce((best, t) => (Math.abs(Math.log(t.speed / speed)) < Math.abs(Math.log(best.speed / speed)) ? t : best), TIME_SCALES[3]);
}

function SpeedMenu() {
  const speed = useLab((s) => s.speed);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = scaleFor(speed);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button className="btn flex items-center gap-1.5" data-active={open} onClick={() => setOpen((v) => !v)} title="Day length ( [ and ] )">
        <span className="text-[var(--color-bright)]">{current.short}</span>
        <span className="hidden text-[8.5px] text-[var(--color-dim)] lg:inline">{current.hint.replace("1 day = ", "")}/DAY</span>
        <span className="text-[8px]">▾</span>
      </button>
      {open && (
        <div className="panel absolute right-0 top-[calc(100%+4px)] z-50 w-[230px] !bg-[rgba(7,9,9,0.98)] py-1">
          <div className="mono px-3 py-1 text-[8.5px] tracking-[0.16em] text-[var(--color-dim)]">SIMULATED DAY LENGTH</div>
          {TIME_SCALES.map((t) => (
            <button
              key={t.id}
              className={`mono flex w-full items-center justify-between px-3 py-[6px] text-left text-[10px] tracking-[0.1em] hover:bg-white/[0.04] ${t.id === current.id ? "text-[var(--color-signal)]" : "text-[var(--color-text)]"}`}
              onClick={() => {
                setSpeedEverywhere(t.speed);
                setOpen(false);
              }}
            >
              <span>{t.label}</span>
              <span className="text-[9px] text-[var(--color-dim)]">{t.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const running = useLab((s) => s.running);
  const n = useLab((s) => s.experimentNumber);
  const dateLabel = useLab((s) => s.snap?.dateLabel ?? "");
  const day = useLab((s) => s.snap?.day ?? 1);
  const weather = useLab((s) => s.snap?.weather ?? "clear");
  const tempC = useLab((s) => Math.round((s.snap?.env.tempC ?? 0) * 10) / 10);
  const night = useLab((s) => (s.snap?.daylight ?? 1) < 0.2);
  const gen = useLab((s) => s.snap?.generation ?? 1);
  const alive = useLab((s) => s.snap?.alive ?? true);
  const mode = useLab((s) => s.mode);
  const cinematic = useLab((s) => s.cinematic);
  const audio = useLab((s) => s.audio);
  const recording = useLab((s) => s.recording);
  const server = useLab((s) => s.server);
  const saved = useLab((s) => s.lastSaved);
  const a = useLab.getState();

  return (
    <header className="relative z-20 flex h-10 shrink-0 items-center gap-3 whitespace-nowrap border-b border-[var(--color-line)] bg-[#070909]/95 px-3">
      <div className="flex items-center gap-2.5">
        <Logo />
        <div className="mono hidden text-[11px] tracking-[0.32em] text-[var(--color-bright)] sm:block">SQUIRREL LAB</div>
      </div>
      <Divider />
      <div className="mono flex items-center gap-2 text-[10px] tracking-[0.2em] text-[var(--color-mid)]">
        EXP <span className="text-[var(--color-bright)]">{pad(n)}</span>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${!alive ? "bg-[var(--color-dim)]" : running ? "bg-[var(--color-alert)] pulse-soft" : "bg-[var(--color-amber)]"}`} />
        <span className={running ? "text-[var(--color-bright)]" : "text-[var(--color-amber)]"}>{running ? "LIVE" : "PAUSED"}</span>
        <span className="hidden text-[var(--color-dim)] md:inline">
          GEN <span className="text-[var(--color-text)]">{gen}</span>
        </span>
      </div>
      <Divider className="hidden lg:block" />
      <div className="mono hidden items-center gap-3 text-[10px] tracking-[0.12em] text-[var(--color-dim)] lg:flex">
        <span className="tabular text-[var(--color-text)]">{dateLabel}</span>
        <span>
          DAY <span className="tabular text-[var(--color-text)]">{pad(day, 3)}</span>
        </span>
        <span className="text-[var(--color-text)]" title={weather}>
          {weatherGlyph(weather, night)} <span className="tabular">{tempC.toFixed(1)}°C</span>
        </span>
        {server.connected && !LIVE && <span className="text-[var(--color-signal)]">⇄ SERVER</span>}
        {saved > 0 && <span className="hidden 2xl:inline">SAVED {new Date(saved).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>

      <nav className="ml-2 hidden items-center border border-[var(--color-line)] md:flex">
        {MODES.map((m) => (
          <button
            key={m.id}
            className="mono px-2.5 py-[5px] text-[9.5px] tracking-[0.16em] text-[var(--color-dim)] hover:text-[var(--color-bright)] data-[active=true]:bg-[rgba(143,227,196,0.08)] data-[active=true]:text-[var(--color-signal)]"
            data-active={mode === m.id && !cinematic}
            onClick={() => a.setMode(m.id)}
            title={m.key}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        {LIVE ? (
          <span className="mono flex items-center gap-1.5 border border-[rgba(255,95,79,0.35)] px-2 py-[5px] text-[9.5px] tracking-[0.16em] text-[var(--color-text)]" title="Everyone watches the same experiment, running 24/7">
            <span className="blink inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-alert)]" />
            LIVE 24/7<span className="hidden text-[var(--color-dim)] lg:inline"> · {server.status.replace(/^LIVE · /, "")}</span>
          </span>
        ) : (
          <>
            <button
              className="btn"
              onClick={() => {
                a.toggleRunning();
                void pushControl({ running: useLab.getState().running });
              }}
              title="Space"
            >
              {running ? "Ⅱ" : "▶"}
              <span className="hidden sm:inline">{running ? " PAUSE" : " START"}</span>
            </button>
            <SpeedMenu />
          </>
        )}
        <Divider className="hidden md:block" />
        <button className="btn hidden md:block" onClick={() => a.toggle("journalOpen")} title="J">
          JOURNAL
        </button>
        <button className="btn" data-active={cinematic} onClick={() => a.toggle("cinematic")} title="C">
          CINEMATIC
        </button>
        <button className="btn btn-alert hidden sm:block" data-active={recording} onClick={() => a.setRecording(!recording)} title="Record the 3D feed">
          ● REC
        </button>
        <button className="btn hidden md:block" data-active={audio} onClick={() => a.toggle("audio")} title="Audio">
          {audio ? "♪" : "♪̸"}
        </button>
        <button className="btn" onClick={() => a.set({ paletteOpen: true })} title="Command palette (Ctrl/⌘ K)">
          ⌘K
        </button>
        <button className="btn" onClick={() => a.toggle("settingsOpen")} title="Settings (,)">
          ⚙
        </button>
      </div>
    </header>
  );
}

function Divider({ className = "" }: { className?: string }) {
  return <div className={`h-4 w-px shrink-0 bg-[var(--color-line-strong)] ${className}`} />;
}

export function Logo() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="13" height="13" stroke="rgba(207,216,212,0.45)" />
      <circle cx="7" cy="7" r="2.2" fill="#8fe3c4" />
      <path d="M7 0.5V3M7 11V13.5M0.5 7H3M11 7H13.5" stroke="rgba(207,216,212,0.45)" />
    </svg>
  );
}
