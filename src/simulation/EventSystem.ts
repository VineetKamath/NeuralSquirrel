import type { LabEvent, MilestoneId, Vector3 } from "@/types";

export interface EventOptions {
  title?: string;
  detail?: string;
  metrics?: { label: string; value: string }[];
  memoryId?: string;
  location?: Vector3;
  major?: boolean;
}

/** Detects and logs notable behaviour. Milestones fire exactly once per experiment. */
export class EventSystem {
  log: LabEvent[] = [];
  achieved = new Map<MilestoneId, number>();
  private counter = 0;
  private lastText = new Map<string, number>();

  toJSON() {
    return { log: this.log.slice(-300), achieved: Array.from(this.achieved.entries()), counter: this.counter };
  }

  load(o: ReturnType<EventSystem["toJSON"]>) {
    this.log = o.log;
    this.achieved = new Map(o.achieved);
    this.counter = o.counter;
  }

  /** allow a milestone to fire again (used when a new generation begins) */
  reset(ids: MilestoneId[]) {
    for (const id of ids) this.achieved.delete(id);
  }

  add(time: number, text: string, category: LabEvent["category"], opts: EventOptions = {}) {
    const last = this.lastText.get(text);
    if (!opts.major && last !== undefined && time - last < 20) return null;
    this.lastText.set(text, time);
    const e: LabEvent = {
      id: ++this.counter,
      time,
      text,
      category,
      major: !!opts.major,
      title: opts.title,
      detail: opts.detail,
      metrics: opts.metrics,
      memoryId: opts.memoryId,
      location: opts.location,
    };
    this.log.push(e);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    return e;
  }

  has(id: MilestoneId) {
    return this.achieved.has(id);
  }

  milestone(id: MilestoneId, time: number, text: string, category: LabEvent["category"], opts: EventOptions) {
    if (this.achieved.has(id)) return null;
    this.achieved.set(id, time);
    const e = this.add(time, text, category, { ...opts, major: true });
    if (e) e.milestone = id;
    return e;
  }

  get lastId() {
    return this.counter;
  }
}
