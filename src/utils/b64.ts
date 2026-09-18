/** compact base64 encoding for typed arrays (works in browsers and Node) */
function bytesToB64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function b64ToBytes(b64: string) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function f32ToB64(a: Float32Array) {
  return bytesToB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
}

export function b64ToF32(b64: string) {
  const bytes = b64ToBytes(b64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)).slice();
}
