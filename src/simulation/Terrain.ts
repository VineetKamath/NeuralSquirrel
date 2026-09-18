import type { Vector3 } from "@/types";
import { getSite, type SiteModel } from "@/real/site";

/**
 * Terrain adapter used by the simulation and renderer.
 * Heights, water, land cover and paths come from the real site model.
 */
export class Terrain {
  readonly site: SiteModel;
  paths: Vector3[][] = [];

  constructor() {
    this.site = getSite();
  }

  height(x: number, z: number) {
    return this.site.height(x, z);
  }

  normalY(x: number, z: number) {
    const e = 0.5;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return 1 / Math.sqrt(1 + (hx / (2 * e)) ** 2 + (hz / (2 * e)) ** 2);
  }

  pathFactor(x: number, z: number) {
    return this.site.pathFactor(x, z);
  }

  isWater(x: number, z: number) {
    return this.site.isWater(x, z);
  }

  isBlocked(x: number, z: number) {
    return this.site.isBlocked(x, z);
  }

  shoreFactor(x: number, z: number) {
    return this.site.shoreFactor(x, z);
  }

  /** woodland factor stands in for moisture/shade */
  moisture(x: number, z: number) {
    return this.site.landAt(x, z) === 1 ? 0.7 : 0.3;
  }
}
