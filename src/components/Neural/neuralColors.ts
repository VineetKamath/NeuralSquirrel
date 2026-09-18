import type { PopulationId } from "@/simulation/neural/NeuralBrain";

/** display colour for each neural population (grouped by brain system) */
export const POP_COLORS: Record<PopulationId, string> = {
  VIS_FOOD: "#cfdcff",
  VIS_THREAT: "#ff9c8c",
  VIS_WATER: "#7fb7e8",
  VIS_SOCIAL: "#e07ab0",
  NOVELTY: "#c9b4ff",
  CURIOSITY: "#b69cf2",
  HUNGER: "#f0965a",
  THIRST: "#6fa8e0",
  FATIGUE: "#a39a8c",
  COLD: "#9ad0f0",
  AMYGDALA: "#ff5f4f",
  HEAD_DIRECTION: "#5fb0d8",
  GRID: "#4fc0c0",
  VTA: "#78f0c8",
  STRIATUM: "#eef4f1",
  MOTOR: "#8fe3c4",
  PLACE: "#e8b36a",
};

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
