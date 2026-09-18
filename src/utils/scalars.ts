type Scalar = number | string | boolean | null;

function isScalar(v: unknown): v is Scalar {
  return v === null || typeof v === "number" || typeof v === "string" || typeof v === "boolean";
}

function isNumberRecord(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v) || ArrayBuffer.isView(v) || v instanceof Map || v instanceof Set) return false;
  const vals = Object.values(v);
  return vals.length > 0 && vals.every((x) => typeof x === "number");
}

/**
 * Capture every scalar field (and flat numeric records such as activation maps) of an object:
 * the small counters and timers that must survive a save for a restored simulation to continue
 * exactly where it left off. Infinity/NaN are encoded as strings for JSON.
 */
export function captureScalars(obj: object) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isScalar(v)) out[k] = typeof v === "number" && !Number.isFinite(v) ? `#${v}` : v;
    else if (isNumberRecord(v)) out[k] = { ...v };
  }
  return out;
}

export function restoreScalars(obj: object, data: Record<string, unknown> | undefined) {
  if (!data) return;
  const target = obj as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) {
    if (!(k in target)) continue;
    if (typeof v === "string" && v.startsWith("#") && typeof target[k] === "number") target[k] = Number(v.slice(1));
    else if (v && typeof v === "object") Object.assign(target[k] as object, v);
    else target[k] = v;
  }
}
