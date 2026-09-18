// Solar position: NOAA General Solar Position calculations (Spencer / NOAA spreadsheet method).
// Moon: low-precision algorithm (Schlyter), accurate to about a degree — ample for lighting.

const RAD = Math.PI / 180;

function julianDay(utcMs: number) {
  return utcMs / 86400000 + 2440587.5;
}

export interface SkyPosition {
  elevation: number; // degrees
  azimuth: number; // degrees clockwise from north
}

export function sunPosition(utcMs: number, lat: number, lon: number): SkyPosition {
  const jd = julianDay(utcMs);
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime =
    4 *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD)) /
    RAD;
  const date = new Date(utcMs);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (minutes + eqTime + 4 * lon + 1440) % 1440;
  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  const zenith = Math.acos(Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(hourAngle * RAD)) / RAD;
  const az = Math.atan2(Math.sin(hourAngle * RAD), Math.cos(hourAngle * RAD) * Math.sin(lat * RAD) - Math.tan(decl * RAD) * Math.cos(lat * RAD)) / RAD;
  return { elevation: 90 - zenith, azimuth: (az + 180 + 360) % 360 };
}

export function moonPosition(utcMs: number, lat: number, lon: number): SkyPosition & { illumination: number; phase: number } {
  const d = julianDay(utcMs) - 2451543.5;
  const N = (125.1228 - 0.0529538083 * d) * RAD;
  const i = 5.1454 * RAD;
  const w = (318.0634 + 0.1643573223 * d) * RAD;
  const a = 60.2666;
  const ecc = 0.0549;
  const M = ((115.3654 + 13.0649929509 * d) % 360) * RAD;
  let E = M + ecc * Math.sin(M) * (1 + ecc * Math.cos(M));
  for (let k = 0; k < 3; k++) E = E - (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
  const xv = a * (Math.cos(E) - ecc);
  const yv = a * Math.sqrt(1 - ecc * ecc) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i));
  const yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i));
  const zh = r * Math.sin(v + w) * Math.sin(i);
  const lonEcl = Math.atan2(yh, xh);
  const latEcl = Math.atan2(zh, Math.hypot(xh, yh));
  const ecl = (23.4393 - 3.563e-7 * d) * RAD;
  const xe = Math.cos(lonEcl) * Math.cos(latEcl);
  const ye = Math.sin(lonEcl) * Math.cos(latEcl) * Math.cos(ecl) - Math.sin(latEcl) * Math.sin(ecl);
  const ze = Math.sin(lonEcl) * Math.cos(latEcl) * Math.sin(ecl) + Math.sin(latEcl) * Math.cos(ecl);
  const ra = Math.atan2(ye, xe);
  const dec = Math.atan2(ze, Math.hypot(xe, ye));
  const gmst = ((280.46061837 + 360.98564736629 * (julianDay(utcMs) - 2451545)) % 360) * RAD;
  const ha = gmst + lon * RAD - ra;
  const alt = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat * RAD) - Math.sin(lat * RAD) * Math.cos(ha));
  // phase from sun–moon elongation
  const sunLon = (280.46646 + 0.98564736 * d) * RAD;
  const elong = Math.acos(Math.cos(lonEcl - sunLon) * Math.cos(latEcl));
  const illumination = (1 - Math.cos(elong)) / 2;
  const phase = (((lonEcl - sunLon) / (2 * Math.PI)) % 1 + 1) % 1;
  return { elevation: alt / RAD, azimuth: ((az / RAD) + 360) % 360, illumination, phase };
}

/** unit direction toward a sky position in the local frame (+x east, +y up, +z south) */
export function skyDirection(p: SkyPosition) {
  const el = p.elevation * RAD;
  const az = p.azimuth * RAD;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}

/** sunrise/sunset (UTC ms) for the local day containing utcMs, by bisection on elevation −0.833° */
export function sunTimes(utcMs: number, lat: number, lon: number, tzOffsetH: number) {
  const localMidnight = Math.floor((utcMs + tzOffsetH * 3600000) / 86400000) * 86400000 - tzOffsetH * 3600000;
  const f = (t: number) => sunPosition(t, lat, lon).elevation + 0.833;
  const find = (a: number, b: number) => {
    let fa = f(a);
    for (let k = 0; k < 30; k++) {
      const m = (a + b) / 2;
      const fm = f(m);
      if (fa * fm <= 0) b = m;
      else {
        a = m;
        fa = fm;
      }
    }
    return (a + b) / 2;
  };
  const noon = localMidnight + 12 * 3600000;
  return { sunrise: find(localMidnight, noon), sunset: find(noon, localMidnight + 86400000) };
}
