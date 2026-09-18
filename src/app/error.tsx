"use client";

/** shown if the lab crashes: reset saved viewer settings and reload */
export default function LabError({ error }: { error: Error & { digest?: string } }) {
  const restart = () => {
    try {
      localStorage.removeItem("squirrel-lab:prefs:v2");
    } catch {
      /* storage unavailable */
    }
    window.location.reload();
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050607] p-6">
      <div className="mono w-[min(460px,100%)] text-[11px] tracking-[0.16em] text-[#b9c4c0]">
        <div className="text-[14px] tracking-[0.36em] text-[#eef4f1]">NUT THE SQUIRREL</div>
        <div className="mt-2 text-[#6e7a76]">THE LAB VIEW HIT AN ERROR. NUT IS FINE: THE EXPERIMENT KEEPS RUNNING ON THE SERVER.</div>
        <button className="btn mt-4" onClick={restart}>
          ↻ RELOAD THE LAB
        </button>
        <div className="mt-4 truncate text-[9px] text-[#39413e]">{error.message}</div>
      </div>
    </div>
  );
}
