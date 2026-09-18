// builds the spectator site as a static export (served by scripts/lab-server.ts)
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_LIVE: "1", STATIC_EXPORT: "1" },
});
process.exit(r.status ?? 1);
