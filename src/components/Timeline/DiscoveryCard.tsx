"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLab } from "@/store/labStore";
import { dayString } from "@/utils/format";

export function DiscoveryCard() {
  const discovery = useLab((s) => s.discovery);
  const dismiss = useLab((s) => s.dismissDiscovery);
  const viewMemory = useLab((s) => s.viewMemory);
  const cinematic = useLab((s) => s.cinematic);

  useEffect(() => {
    if (!discovery) return;
    const t = setTimeout(dismiss, 14000);
    return () => clearTimeout(t);
  }, [discovery, dismiss]);

  return (
    <AnimatePresence>
      {discovery && !cinematic && (
        <motion.div
          key={discovery.id}
          initial={{ opacity: 0, x: 24, filter: "blur(4px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: 16 }}
          transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute bottom-3 left-3 right-3 z-10 md:bottom-auto md:left-auto md:right-5 md:top-[118px] md:w-[min(340px,calc(100%-40px))]"
        >
          <div className="panel scanlines overflow-hidden !bg-[rgba(8,11,11,0.86)]">
            <motion.div className="h-px bg-[var(--color-signal)]" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9 }} style={{ transformOrigin: "left" }} />
            <div className="px-4 pb-3 pt-3">
              <div className="mono flex items-center justify-between text-[9px] tracking-[0.2em] text-[var(--color-dim)]">
                <span>EVENT DETECTED</span>
                <span className="tabular">{dayString(discovery.time)}</span>
              </div>
              <motion.div
                className="mono mt-2 text-[13px] tracking-[0.22em] text-[var(--color-signal)]"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0.6, 1] }}
                transition={{ duration: 0.8, delay: 0.2 }}
              >
                {discovery.title}
              </motion.div>
              <div className="mt-2 whitespace-pre-line text-[12.5px] leading-[1.5] text-[var(--color-text)]">{discovery.detail}</div>
              {discovery.metrics && discovery.metrics.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-[var(--color-line)] pt-2">
                  {discovery.metrics.map((m) => (
                    <div key={m.label} className="mono flex min-w-0 items-baseline justify-between gap-2 text-[9.5px]">
                      <span className="min-w-0 truncate tracking-[0.12em] text-[var(--color-dim)]">{m.label}</span>
                      <span className="tabular shrink-0 whitespace-nowrap text-[11px] text-[var(--color-bright)]">{m.value}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                {discovery.memoryId && (
                  <button
                    className="btn"
                    onClick={() => {
                      viewMemory(discovery.memoryId!);
                      dismiss();
                    }}
                  >
                    VIEW MEMORY
                  </button>
                )}
                <button className="btn" onClick={dismiss}>
                  DISMISS
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
