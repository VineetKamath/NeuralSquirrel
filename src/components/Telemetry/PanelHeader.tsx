export function PanelHeader({ title, meta, right, index }: { title: string; meta?: string; right?: React.ReactNode; index?: string }) {
  return (
    <div className="panel-header relative flex items-center gap-2 mb-1.5 border-b border-[var(--color-line)] px-3 py-[7px]" title="Double-click to expand">
      {index && <span className="mono text-[9px] tracking-[0.1em] text-[var(--color-signal)]/70">{index}</span>}
      <span className="h-3 w-px bg-[var(--color-line-strong)]" />
      <h2 className="mono text-[10px] font-medium tracking-[0.24em] text-[var(--color-bright)]">{title}</h2>
      {meta && <span className="mono hidden truncate text-[9px] tracking-[0.14em] text-[var(--color-dim)] sm:inline">{meta}</span>}
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}
