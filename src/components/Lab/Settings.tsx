"use client";

import { useRef, useState } from "react";
import { useLab } from "@/store/labStore";
import { getExperiment } from "@/store/runtime";
import { TIME_SCALES } from "@/simulation/constants";
import { deleteSavedSnapshot, downloadSnapshot, importSnapshotFile, MAX_CATCH_UP } from "@/store/lifecycle";
import { connectServer, disconnectServer, pushControl } from "@/store/serverLink";
import { Modal } from "./Modal";
import { LIVE } from "@/store/liveMode";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-[var(--color-line)] px-4 py-3 md:grid-cols-[220px_1fr]">
      <div>
        <div className="mono text-[10px] tracking-[0.18em] text-[var(--color-bright)]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-[1.45] text-[var(--color-dim)]">{hint}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function setSpeedEverywhere(speed: number) {
  useLab.getState().setSpeed(speed);
  void pushControl({ speed });
}

export function SettingsModal() {
  const open = useLab((s) => s.settingsOpen);
  const speed = useLab((s) => s.speed);
  const autosave = useLab((s) => s.autosave);
  const catchUp = useLab((s) => s.catchUp);
  const quality = useLab((s) => s.quality);
  const lastSaved = useLab((s) => s.lastSaved);
  const server = useLab((s) => s.server);
  const audio = useLab((s) => s.audio);
  const autoSlow = useLab((s) => s.autoSlow);
  const overlays = useLab((s) => s.overlays);
  const [url, setUrl] = useState(server.url);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const a = useLab.getState();

  return (
    <Modal open={open} onClose={() => a.toggle("settingsOpen")} title="LAB SETTINGS" meta="EXPERIMENT DURATION · PERSISTENCE · SERVER" width={860}>
      {!LIVE && (
        <>
      <Row label="DAY LENGTH" hint="How fast simulated time runs. REAL TIME makes one simulated day last 24 hours, for experiments that run for weeks.">
        {TIME_SCALES.map((t) => (
          <button key={t.id} className="btn" data-active={Math.abs(speed - t.speed) < 1e-9} onClick={() => setSpeedEverywhere(t.speed)} title={t.hint}>
            {t.label}
            <span className="ml-1.5 text-[8.5px] text-[var(--color-dim)]">{t.hint}</span>
          </button>
        ))}
      </Row>
      <Row label="AUTOSAVE" hint="The full experiment (world, memories, synapses, lineage) is saved in this browser every minute and when the tab closes.">
        <button className="btn" data-active={autosave} onClick={() => a.toggle("autosave")}>
          {autosave ? "ON" : "OFF"}
        </button>
        <button
          className="btn"
          onClick={async () => {
            const ok = await a.saveNow(getExperiment());
            setMsg(ok ? "SAVED" : "SAVE FAILED");
          }}
        >
          SAVE NOW
        </button>
        <span className="mono text-[9.5px] text-[var(--color-dim)]">{lastSaved ? `LAST SAVED ${new Date(lastSaved).toLocaleTimeString()}` : "NOT SAVED YET"}</span>
        {msg && <span className="mono text-[9.5px] text-[var(--color-signal)]">{msg}</span>}
      </Row>
      <Row label="OFFLINE CATCH-UP" hint={`When you come back, the time you were away is simulated at the chosen day length (up to ${MAX_CATCH_UP / 480} days). While the tab is hidden the experiment keeps running.`}>
        <button className="btn" data-active={catchUp} onClick={() => a.toggle("catchUp")}>
          {catchUp ? "ON" : "OFF"}
        </button>
      </Row>
      <Row label="SNAPSHOTS" hint="Export the complete experiment state as a file, or continue an exported experiment on another machine.">
        <button className="btn" onClick={downloadSnapshot}>
          EXPORT SNAPSHOT
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          IMPORT SNAPSHOT…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await importSnapshotFile(f);
              setMsg("SNAPSHOT LOADED");
            } catch (err) {
              setMsg(`IMPORT FAILED · ${(err as Error).message}`);
            }
            e.target.value = "";
          }}
        />
        <button
          className="btn btn-alert"
          onClick={async () => {
            await deleteSavedSnapshot();
            setMsg("BROWSER SAVE DELETED");
          }}
        >
          DELETE BROWSER SAVE
        </button>
      </Row>
      <Row label="SERVER MODE" hint="Run `npm run lab:server` to keep an experiment alive for weeks without a browser. Attach here to watch it.">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="mono w-56 border border-[var(--color-line)] bg-transparent px-2 py-[5px] text-[10px] text-[var(--color-text)] outline-none"
        />
        {server.connected ? (
          <button className="btn btn-alert" data-active onClick={disconnectServer}>
            DISCONNECT
          </button>
        ) : (
          <button className="btn" onClick={() => connectServer(url)}>
            CONNECT
          </button>
        )}
        <span className={`mono text-[9.5px] ${server.connected ? "text-[var(--color-signal)]" : "text-[var(--color-dim)]"}`}>{server.status || "LOCAL"}</span>
      </Row>
        </>
      )}
      <Row label="RENDER QUALITY" hint="Lower quality reduces resolution and disables shadows for long unattended runs.">
        {(["low", "medium", "high"] as const).map((q) => (
          <button key={q} className="btn" data-active={quality === q} onClick={() => a.set({ quality: q })}>
            {q}
          </button>
        ))}
      </Row>
      <Row label="OBSERVATION">
        <button className="btn" data-active={audio} onClick={() => a.toggle("audio")}>
          AUDIO
        </button>
        <button className="btn" data-active={overlays} onClick={() => a.toggle("overlays")}>
          3D OVERLAYS
        </button>
        <button className="btn" data-active={autoSlow} onClick={() => a.toggle("autoSlow")}>
          AUTO-SLOW ON DISCOVERY
        </button>
      </Row>
    </Modal>
  );
}
