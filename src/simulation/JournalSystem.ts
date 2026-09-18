import type { JournalEntry, LabEvent } from "@/types";
import { daySummary } from "@/real/weather";
import { formatDate, localTime } from "@/real/calendar";

export interface DayStats {
  day: number;
  utcStart: number;
  generation: number;
  foodEaten: number;
  distance: number;
  cachesMade: number;
  cachesRetrieved: number;
  pilfered: number;
  encounters: number;
  contacts: number;
  memories: number;
  placeCells: number;
  newPlaceCells: number;
  replays: number;
  explored: number;
  radius: number;
  health: number;
  realism: number;
  events: LabEvent[];
}

/** writes a field-notebook entry for each simulated day, grounded in real weather */
export class JournalSystem {
  entries: JournalEntry[] = [];

  write(d: DayStats) {
    const w = daySummary(d.utcStart);
    const date = formatDate(localTime(d.utcStart + 12 * 3600000));
    const weatherLine =
      `${w.min.toFixed(0)}–${w.max.toFixed(0)} °C` +
      (w.precip > 0.5 ? ` · ${w.precip.toFixed(1)} mm precipitation` : " · dry") +
      (w.depth > 0.01 ? ` · snow cover ${(w.depth * 100).toFixed(0)} cm` : "") +
      (w.gust > 50 ? ` · gusts to ${Math.round(w.gust)} km/h` : "");

    const body: string[] = [];
    const majors = d.events.filter((e) => e.major);
    const title = majors[0]?.title ?? (d.foodEaten === 0 ? "A lean day" : d.cachesMade > 3 ? "Hoarding" : d.encounters > 1 ? "Predator pressure" : "Routine foraging");

    body.push(
      `Subject ate ${d.foodEaten} food item${d.foodEaten === 1 ? "" : "s"}, travelled ${Math.round(d.distance)} m and ranged up to ${Math.round(d.radius)} m from the nest.`
    );
    if (w.max < 0) body.push("Freezing all day; the subject had to balance higher energy cost against time exposed.");
    else if (w.precip > 8) body.push("Heavy rain; activity was limited and shelter was used more.");
    if (w.depth > 0.03) body.push("Snow covered the ground. Surface food was hidden; buried caches remained findable by smell.");
    if (d.cachesMade) body.push(`${d.cachesMade} cache${d.cachesMade === 1 ? "" : "s"} buried${d.cachesRetrieved ? `, ${d.cachesRetrieved} recovered from memory` : ""}.`);
    if (d.pilfered) body.push(`${d.pilfered} of its caches were taken by other squirrels.`);
    if (d.encounters) body.push(`${d.encounters} predator encounter${d.encounters === 1 ? "" : "s"}${d.contacts ? `, ${d.contacts} with contact` : ", no contact"}.`);
    if (d.newPlaceCells > 0) body.push(`${d.newPlaceCells} new place cells recruited (total ${d.placeCells}); ${Math.round(d.explored * 100)}% of the site now familiar.`);
    if (d.replays) body.push(`${d.replays} hippocampal replay event${d.replays === 1 ? "" : "s"} during sleep consolidated rewarded routes.`);
    for (const e of majors.slice(0, 3)) body.push(`◆ ${e.title}: ${e.text}.`);

    const entry: JournalEntry = {
      day: d.day,
      utc: d.utcStart,
      date,
      title,
      weather: weatherLine,
      body,
      generation: d.generation,
      stats: [
        { label: "FOOD", value: String(d.foodEaten) },
        { label: "DISTANCE", value: `${Math.round(d.distance)} m` },
        { label: "CACHES", value: `${d.cachesMade}/${d.cachesRetrieved}` },
        { label: "MEMORIES", value: String(d.memories) },
        { label: "PLACE CELLS", value: String(d.placeCells) },
        { label: "HEALTH", value: `${Math.round(d.health * 100)}%` },
        { label: "CENSUS MATCH", value: d.realism > 0 ? `${Math.round(d.realism * 100)}%` : "—" },
      ],
    };
    this.entries.push(entry);
    return entry;
  }

  toJSON() {
    return this.entries;
  }

  load(entries: JournalEntry[]) {
    this.entries = entries;
  }
}
