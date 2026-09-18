import censusJson from "./data/census.json";
import type { RNG } from "@/utils/rng";

export interface CensusSighting {
  id: string;
  x: number;
  z: number;
  shift: string;
  date: string;
  fur: string;
  age: string;
  above: number;
  run: number;
  chase: number;
  climb: number;
  eat: number;
  forage: number;
  alarm: number;
  approach: number;
  flee: number;
  note: string;
}

export interface BehaviourProfile {
  n: number;
  running: number;
  chasing: number;
  climbing: number;
  eating: number;
  foraging: number;
  kuks: number;
  quaas: number;
  moans: number;
  tail_flags: number;
  tail_twitches: number;
  approaches: number;
  indifferent: number;
  runs_from: number;
  aboveGround: number;
}

interface CensusJson {
  source: string;
  total: number;
  park: BehaviourProfile;
  am: BehaviourProfile;
  pm: BehaviourProfile;
  fur: Record<string, number>;
  age: Record<string, number>;
  sitePresent: number;
  sightings: CensusSighting[];
}

export const CENSUS = censusJson as unknown as CensusJson;

/** behaviours comparable between the census and the simulation */
export const COMPARABLE: { key: keyof BehaviourProfile; label: string }[] = [
  { key: "foraging", label: "FORAGING" },
  { key: "eating", label: "EATING" },
  { key: "running", label: "RUNNING" },
  { key: "climbing", label: "CLIMBING" },
  { key: "aboveGround", label: "ABOVE GROUND" },
  { key: "chasing", label: "CHASING" },
  { key: "tail_twitches", label: "TAIL TWITCH" },
  { key: "tail_flags", label: "TAIL FLAG" },
  { key: "kuks", label: "ALARM (KUK)" },
];

/** fur colour sampled from the real park-wide distribution */
export function sampleFur(rng: RNG): "Gray" | "Cinnamon" | "Black" {
  const g = CENSUS.fur.Gray ?? 0;
  const c = CENSUS.fur.Cinnamon ?? 0;
  const b = CENSUS.fur.Black ?? 0;
  const r = rng() * (g + c + b);
  return r < g ? "Gray" : r < g + c ? "Cinnamon" : "Black";
}

/** k-means over real sighting coordinates: activity centres of the resident population */
export function activityCentres(k: number, rng: RNG) {
  const pts = CENSUS.sightings;
  if (pts.length < k) return pts.map((p) => ({ x: p.x, z: p.z, members: 1 }));
  const centres = Array.from({ length: k }, () => {
    const p = pts[Math.floor(rng() * pts.length)];
    return { x: p.x, z: p.z, members: 0 };
  });
  for (let it = 0; it < 12; it++) {
    const sums = centres.map(() => ({ x: 0, z: 0, n: 0 }));
    for (const p of pts) {
      let best = 0;
      let bd = Infinity;
      centres.forEach((c, i) => {
        const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      sums[best].x += p.x;
      sums[best].z += p.z;
      sums[best].n++;
    }
    centres.forEach((c, i) => {
      if (sums[i].n) {
        c.x = sums[i].x / sums[i].n;
        c.z = sums[i].z / sums[i].n;
        c.members = sums[i].n;
      }
    });
  }
  return centres;
}
