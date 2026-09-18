// Global simulation constants. 1 world unit = 1 metre.

export const WORLD_SIZE = 400;
export const WORLD_HALF = WORLD_SIZE / 2;

/** simulated seconds per in-world day (at 1× speed one day takes 8 real minutes) */
export const DAY_LENGTH = 480;

export const FIXED_DT = 1 / 30;
export const DECISION_INTERVAL = 0.3;

export const GRID_CELL = 4;
export const GRID_RES = WORLD_SIZE / GRID_CELL; // 100 × 100 cells

export const SPEED = {
  walk: 1.1,
  hop: 2.6,
  run: 4.2,
  flee: 5.4,
  climb: 1.6,
};

export const HISTORY_INTERVAL = DAY_LENGTH / 24; // one sample per simulated hour

/** speed multipliers; values below 1 give real-world day lengths */
export const TIME_SCALES = [
  { id: "rt", label: "REAL TIME", short: "RT", speed: DAY_LENGTH / 86400, hint: "1 day = 24 h" },
  { id: "6h", label: "1 DAY = 6 H", short: "6H", speed: DAY_LENGTH / 21600, hint: "1 day = 6 h" },
  { id: "1h", label: "1 DAY = 1 H", short: "1H", speed: DAY_LENGTH / 3600, hint: "1 day = 1 h" },
  { id: "1x", label: "1×", short: "1×", speed: 1, hint: "1 day = 8 min" },
  { id: "2x", label: "2×", short: "2×", speed: 2, hint: "1 day = 4 min" },
  { id: "5x", label: "5×", short: "5×", speed: 5, hint: "1 day = 96 s" },
  { id: "10x", label: "10×", short: "10×", speed: 10, hint: "1 day = 48 s" },
  { id: "50x", label: "50×", short: "50×", speed: 50, hint: "1 day ≈ 10 s" },
  { id: "100x", label: "100×", short: "100×", speed: 100, hint: "1 day ≈ 5 s" },
];
