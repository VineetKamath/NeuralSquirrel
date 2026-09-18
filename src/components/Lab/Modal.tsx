"use client";

import { AnimatePresence, motion } from "framer-motion";

export function Modal({
  open,
  onClose,
  title,
  meta,
  width = 900,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  meta?: string;
  width?: number;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            className="panel flex max-h-[88vh] w-full flex-col overflow-hidden !bg-[rgba(7,9,9,0.97)]"
            style={{ maxWidth: width }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5">
              <span className="mono text-[11px] tracking-[0.26em] text-[var(--color-bright)]">{title}</span>
              {meta && <span className="mono hidden truncate text-[9px] tracking-[0.14em] text-[var(--color-dim)] sm:inline">{meta}</span>}
              <div className="ml-auto flex items-center gap-1.5">
                {actions}
                <button className="btn" onClick={onClose}>
                  CLOSE ✕
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
