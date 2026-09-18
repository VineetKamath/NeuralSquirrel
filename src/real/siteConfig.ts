/**
 * The study site: a 400 m × 400 m window over the Ramble and the Lake,
 * Central Park, New York City. Coordinates are real (WGS84).
 * Local frame: +x = east, +z = south, metres, origin at the site centre.
 */
export const SITE = {
  name: "THE RAMBLE · CENTRAL PARK, NEW YORK",
  shortName: "THE RAMBLE",
  centerLat: 40.7775,
  centerLon: -73.9705,
  size: 400,
  /** experiment clock starts on the first day of the 2018 Central Park Squirrel Census */
  startUTC: Date.UTC(2018, 9, 6, 11, 0, 0), // 2018-10-06 07:00 EDT
  timezone: "America/New_York",
};

const M_PER_DEG_LAT = 111320;

export function mPerDegLon(lat = SITE.centerLat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

export function lonLatToLocal(lon: number, lat: number) {
  return {
    x: (lon - SITE.centerLon) * mPerDegLon(),
    z: -(lat - SITE.centerLat) * M_PER_DEG_LAT,
  };
}

export function localToLonLat(x: number, z: number) {
  return {
    lon: SITE.centerLon + x / mPerDegLon(),
    lat: SITE.centerLat - z / M_PER_DEG_LAT,
  };
}

export function siteBBox(marginM = 20) {
  const half = SITE.size / 2 + marginM;
  return {
    south: SITE.centerLat - half / M_PER_DEG_LAT,
    north: SITE.centerLat + half / M_PER_DEG_LAT,
    west: SITE.centerLon - half / mPerDegLon(),
    east: SITE.centerLon + half / mPerDegLon(),
  };
}
