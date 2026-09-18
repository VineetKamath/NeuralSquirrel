import type { BehavioralProfile, DaySummary, LearningMetrics } from "@/types";

export interface ExperimentRecord {
  number: number;
  seed: number;
  createdAt: number;
  updatedAt: number;
  simDays: number;
  metrics: LearningMetrics;
  profile: BehavioralProfile;
  days: DaySummary[];
  milestones: number;
  memories: number;
  foodEaten: number;
  contacts: number;
  distance: number;
}

const KEY = "squirrel-lab:experiments:v1";

export function loadRecords(): ExperimentRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecord(record: ExperimentRecord) {
  try {
    const all = loadRecords().filter((r) => r.number !== record.number);
    all.push(record);
    all.sort((a, b) => a.number - b.number);
    localStorage.setItem(KEY, JSON.stringify(all.slice(-40)));
  } catch {
    /* storage unavailable */
  }
}

export function deleteRecord(number: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadRecords().filter((r) => r.number !== number)));
  } catch {
    /* storage unavailable */
  }
}

export function nextExperimentNumber() {
  const all = loadRecords();
  return all.length ? Math.max(...all.map((r) => r.number)) + 1 : 1;
}
