"use client";

import { useEffect, useState } from "react";

export type Quality = "low" | "medium" | "high";

/** phones and tablets (touch-first) */
export function isMobileDevice() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 820;
}

/** a render quality that the device can sustain */
export function detectQuality(): Quality {
  if (typeof window === "undefined") return "high";
  if (isMobileDevice()) return "low";
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return cores <= 4 || mem <= 4 ? "medium" : "high";
}

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** true on phone-sized screens */
export function useSmallScreen() {
  return useMediaQuery("(max-width: 767px)");
}
