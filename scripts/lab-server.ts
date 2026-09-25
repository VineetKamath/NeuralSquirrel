/**
 * Live lab server: runs one experiment continuously (24/7), serves the spectator site and exposes
 * the experiment state so every visitor watches the same squirrel.
 *
 *   npm run lab:server -- --port 4317 --speed 1 --seed 728491
 *
 * Environment (all optional; flags take precedence):
 *   PORT            HTTP port (default 4317; Hugging Face Spaces uses 7860)
 *   LAB_SPEED       simulation multiplier (1 = one day per 8 minutes; 0.00555 = real time)
 *   LAB_SEED        seed for a brand-new experiment
 *   LAB_SAVE        path of the local save file (default data/lab-server-save.json)
 *   LAB_STATIC      directory of the exported site to serve (default out/, if it exists)
 *   LAB_BACKUP      committed fallback save (default backup/lab-save.json.gz), used when it is newer than
 *                   any other save, e.g. after a redeploy wiped the local save on a host without a disk
 *   HF_TOKEN + HF_SAVE_REPO   also keep the save in a Hugging Face dataset repo (survives restarts
 *                             on hosts without a persistent disk), e.g. HF_SAVE_REPO=user/squirrel-lab-save
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { Experiment, type ExperimentSnapshot } from "../src/simulation/Experiment";
import { DAY_LENGTH, FIXED_DT } from "../src/simulation/constants";
import { realDateString } from "../src/utils/format";

function arg(name: string, env: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[env] ?? fallback;
}

const PORT = Number(arg("port", "PORT", "4317"));
const SAVE = resolve(arg("save", "LAB_SAVE", "data/lab-server-save.json"));
const STATIC = resolve(arg("static", "LAB_STATIC", "out"));
const BACKUP = resolve(arg("backup", "LAB_BACKUP", "backup/lab-save.json.gz"));
const HF_TOKEN = process.env.HF_TOKEN ?? "";
const HF_REPO = process.env.HF_SAVE_REPO ?? "";
let speed = Number(arg("speed", "LAB_SPEED", "1"));
let running = true;
const started = Date.now();

// ───────────────────────────── persistence ─────────────────────────────

async function hfDownload(): Promise<ExperimentSnapshot | null> {
  if (!HF_TOKEN || !HF_REPO) return null;
  try {
    const res = await fetch(`https://huggingface.co/datasets/${HF_REPO}/resolve/main/save.json.gz`, { headers: { authorization: `Bearer ${HF_TOKEN}` } });
    if (!res.ok) return null;
    return JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")) as ExperimentSnapshot;
  } catch (e) {
    console.warn(`[lab] hub download failed: ${(e as Error).message}`);
    return null;
  }
}

async function hfUpload(json: string) {
  if (!HF_TOKEN || !HF_REPO) return;
  const content = gzipSync(json).toString("base64");
  const body =
    JSON.stringify({ key: "header", value: { summary: `autosave ${new Date().toISOString()}` } }) +
    "\n" +
    JSON.stringify({ key: "file", value: { path: "save.json.gz", content, encoding: "base64" } }) +
    "\n";
  const res = await fetch(`https://huggingface.co/api/datasets/${HF_REPO}/commit/main`, {
    method: "POST",
    headers: { authorization: `Bearer ${HF_TOKEN}`, "content-type": "application/x-ndjson" },
    body,
  });
  if (!res.ok) console.warn(`[lab] hub upload failed: ${res.status} ${await res.text()}`);
}

function readLocal(): ExperimentSnapshot | null {
  if (!existsSync(SAVE)) return null;
  try {
    return JSON.parse(readFileSync(SAVE, "utf8")) as ExperimentSnapshot;
  } catch (e) {
    console.warn(`[lab] could not read ${SAVE}: ${(e as Error).message}`);
    return null;
  }
}

function readBackup(): ExperimentSnapshot | null {
  if (!existsSync(BACKUP)) return null;
  try {
    return JSON.parse(gunzipSync(readFileSync(BACKUP)).toString("utf8")) as ExperimentSnapshot;
  } catch (e) {
    console.warn(`[lab] could not read ${BACKUP}: ${(e as Error).message}`);
    return null;
  }
}

async function load(): Promise<Experiment> {
  const local = readLocal();
  const remote = await hfDownload();
  const backup = readBackup();
  const snap = [local, remote, backup].filter(Boolean).sort((a, b) => b!.savedAt - a!.savedAt)[0] ?? null;
  if (snap) {
    try {
      const exp = Experiment.restore(snap);
      console.log(`[lab] resumed experiment ${exp.number} (seed ${exp.seed}) at ${realDateString(exp.time)}`);
      // simulate the time the server was down
      const away = Math.min(DAY_LENGTH * 30, ((Date.now() - snap.savedAt) / 1000) * speed);
      if (away > 1) {
        console.log(`[lab] catching up ${(away / DAY_LENGTH).toFixed(2)} days of downtime…`);
        let done = 0;
        while (done < away) done += exp.fastForward(Math.min(DAY_LENGTH, away - done), 5000);
      }
      return exp;
    } catch (e) {
      console.warn(`[lab] could not resume: ${(e as Error).message}`);
    }
  }
  const seed = Number(arg("seed", "LAB_SEED", "728491"));
  console.log(`[lab] new experiment · seed ${seed}`);
  return new Experiment(seed, 1);
}

// ───────────────────────────── simulation ─────────────────────────────

async function main() {
  const exp = await load();

  function save() {
    const json = JSON.stringify(exp.snapshot());
    mkdirSync(dirname(SAVE), { recursive: true });
    writeFileSync(`${SAVE}.tmp`, json);
    renameSync(`${SAVE}.tmp`, SAVE);
    return json;
  }

  // real elapsed time × speed, advanced in the same fixed steps the browser uses, so spectators'
  // local copies stay in lock-step with this one
  let lastTick = Date.now();
  let debt = 0;
  setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    if (!running) return;
    debt += dt * speed;
    const stepDt = speed >= 50 ? FIXED_DT * 2 : FIXED_DT;
    exp.agent.neuralWindowMs = speed >= 50 ? 20 : speed >= 10 ? 35 : 50;
    const budget = performance.now() + 40;
    while (debt >= stepDt && performance.now() < budget) {
      exp.step(stepDt);
      debt -= stepDt;
    }
    if (debt > DAY_LENGTH) debt = 0;
    exp.lastWall = now;
  }, 50);

  let lastHub = 0;
  setInterval(() => {
    try {
      const json = save();
      // the hub keeps history; commit every 30 minutes
      if (Date.now() - lastHub > 30 * 60000) {
        lastHub = Date.now();
        void hfUpload(json).catch((e) => console.warn(`[lab] hub upload failed: ${(e as Error).message}`));
      }
    } catch (e) {
      console.warn(`[lab] save failed: ${(e as Error).message}`);
    }
  }, 60000);

  let lastDay = exp.world.day;
  setInterval(() => {
    if (exp.world.day !== lastDay) {
      lastDay = exp.world.day;
      const s = exp.agent.state;
      const j = exp.journal.entries[exp.journal.entries.length - 1];
      console.log(`[lab] day ${lastDay} · ${realDateString(exp.time)} · gen ${s.generation} · health ${(s.health * 100).toFixed(0)}% · ${j?.title ?? ""}`);
    }
  }, 5000);

  // ───────────────────────────── spectators ─────────────────────────────

  const viewers = new Map<string, number>();
  function countViewers() {
    const cutoff = Date.now() - 45000;
    for (const [id, t] of viewers) if (t < cutoff) viewers.delete(id);
    return Math.max(1, viewers.size);
  }

  // one snapshot serves every visitor that arrives within a couple of seconds
  let snapCache: { at: number; gz: Buffer; raw: string } | null = null;
  function snapshotPayload() {
    if (!snapCache || Date.now() - snapCache.at > 2000) {
      const raw = JSON.stringify({ ...exp.snapshot(), savedAt: Date.now() });
      snapCache = { at: Date.now(), raw, gz: gzipSync(raw) };
    }
    return snapCache;
  }

  function status() {
    const s = exp.agent.state;
    return {
      seed: exp.seed,
      number: exp.number,
      time: exp.time,
      day: exp.world.day,
      date: realDateString(exp.time),
      speed,
      running,
      generation: s.generation,
      x: s.position.x,
      z: s.position.z,
      savedAt: Date.now(),
      uptime: (Date.now() - started) / 1000,
      viewers: countViewers(),
    };
  }

  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
  };

  function serveStatic(pathname: string, res: import("node:http").ServerResponse, gzipOk: boolean) {
    if (!existsSync(STATIC)) return false;
    let rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    if (rel.includes("..")) return false;
    let file = join(STATIC, rel);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) && existsSync(`${join(STATIC, rel)}.html`)) file = `${join(STATIC, rel)}.html`;
    if (!existsSync(file)) {
      // missing build assets are a real 404 (an old cached page must not receive HTML as JavaScript)
      if (rel.startsWith("_next") || extname(rel)) return false;
      file = join(STATIC, "index.html");
      if (!existsSync(file)) return false;
    }
    const ext = extname(file);
    const body = readFileSync(file);
    const immutable = rel.startsWith("_next/static");
    const headers: Record<string, string> = {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    };
    if (gzipOk && [".html", ".js", ".css", ".json", ".svg", ".txt"].includes(ext)) {
      headers["content-encoding"] = "gzip";
      res.writeHead(200, headers).end(gzipSync(body));
    } else res.writeHead(200, headers).end(body);
    return true;
  }

  const server = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const gzipOk = /gzip/.test(String(req.headers["accept-encoding"] ?? ""));
    const json = (body: unknown) => res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));

    if (req.method === "GET" && url.pathname === "/api/status") return json(status());
    if (req.method === "GET" && url.pathname === "/api/live") {
      const v = url.searchParams.get("v");
      if (v) viewers.set(v.slice(0, 16), Date.now());
      return json(status());
    }
    if (req.method === "GET" && url.pathname === "/api/snapshot") {
      const p = snapshotPayload();
      if (gzipOk) res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "no-store" }).end(p.gz);
      else res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(p.raw);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/journal") return json(exp.journal.entries);
    if (req.method === "GET" && url.pathname === "/healthz") return res.writeHead(200).end("ok");
    if (req.method === "POST" && url.pathname === "/api/control") {
      // changing the shared experiment requires the admin key
      const key = process.env.LAB_ADMIN_KEY;
      if (!key || req.headers["x-admin-key"] !== key) return res.writeHead(403).end("forbidden");
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const patch = JSON.parse(body || "{}") as { speed?: number; running?: boolean };
          if (typeof patch.speed === "number" && patch.speed > 0 && patch.speed <= 100) speed = patch.speed;
          if (typeof patch.running === "boolean") running = patch.running;
          json(status());
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }
    if (req.method === "GET" && serveStatic(url.pathname, res, gzipOk)) return;
    res.writeHead(404, { "content-type": "text/plain" }).end("squirrel lab server: /api/status /api/live /api/snapshot /api/journal");
  });

  server.listen(PORT, () =>
    console.log(
      `[lab] listening on http://localhost:${PORT} · speed ${speed}× · saving to ${SAVE}${HF_REPO ? ` + hf:${HF_REPO}` : ""}${existsSync(STATIC) ? ` · serving ${STATIC}` : ""}`,
    ),
  );

  const shutdown = async () => {
    console.log("[lab] saving before exit…");
    try {
      const json = save();
      await hfUpload(json).catch(() => undefined);
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main();
