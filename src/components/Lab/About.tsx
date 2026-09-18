"use client";

import { useLab } from "@/store/labStore";
import { Modal } from "./Modal";

const REPO = "https://github.com/VineetKamath/NeuralSquirrel";
const AUTHOR = "https://github.com/VineetKamath";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--color-line)] px-5 py-4">
      <h3 className="mono mb-2 text-[10px] tracking-[0.24em] text-[var(--color-signal)]">{title}</h3>
      <div className="text-[13px] leading-[1.65] text-[var(--color-text)]">{children}</div>
    </section>
  );
}

function Point({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-[7px] h-[5px] w-[5px] shrink-0 bg-[var(--color-signal)]" />
      <span>
        <span className="text-[var(--color-bright)]">{k}</span> {children}
      </span>
    </li>
  );
}

/** what the project is, who built it and how to support it */
export function AboutModal() {
  const open = useLab((s) => s.aboutOpen);
  return (
    <Modal open={open} onClose={() => useLab.getState().toggle("aboutOpen")} title="ABOUT" meta="NUT THE SQUIRREL · SQUIRREL LAB" width={760}>
      <div className="px-5 pb-4 pt-5">
        <div className="mono text-[18px] tracking-[0.3em] text-[var(--color-bright)]">NUT THE SQUIRREL</div>
        <div className="mono mt-1 text-[10px] tracking-[0.24em] text-[var(--color-mid)]">SQUIRREL LAB · WATCH A MIND GROW</div>
        <p className="mt-3 text-[14px] leading-[1.65] text-[var(--color-text)]">
          Nut is an artificial squirrel with a spiking neural brain, living in a recreation of The Ramble in Central Park, New York, built from real data. She runs live
          around the clock, and nobody controls her: everyone who visits watches the same squirrel, in real time, as she learns to survive.
        </p>
      </div>

      <Section title="WHAT MAKES IT DIFFERENT">
        <ul className="space-y-1.5">
          <Point k="Real place.">Terrain from USGS elevation data; paths, lakes and woodland from OpenStreetMap.</Point>
          <Point k="Real weather.">Hourly weather from the 2018–19 record, so she lives through the actual frosts, storms and snowfall, with real sun and moon positions.</Point>
          <Point k="Real squirrels.">Her behaviour is calibrated against the 2018 Central Park Squirrel Census, over 3,000 real sightings.</Point>
          <Point k="A real brain model.">846 Izhikevich spiking neurons, dopamine-driven learning, place and grid cells, and sleep replay, all from published neuroscience.</Point>
          <Point k="No script.">She forages, buries food for winter, drinks, escapes dogs and hawks, and competes with other squirrels. Her successors inherit instincts, not memories.</Point>
        </ul>
      </Section>

      <Section title="WHAT YOU CAN WATCH">
        <ul className="space-y-1.5">
          <Point k="Observe:">the live 3D feed, her drives, memories and learning.</Point>
          <Point k="Neuroscience:">every spike of every neuron, her mental map of the park, and what drove each decision.</Point>
          <Point k="Ecology:">the real map, weather record, population and a field journal written each simulated day.</Point>
          <Point k="Cinematic:">an automatic camera that follows her story.</Point>
        </ul>
        <p className="mt-2 text-[12px] text-[var(--color-dim)]">
          This is an experiment: the brain is a simplified model of real neuroscience, not a copy of a real squirrel&apos;s mind.
        </p>
      </Section>

      <Section title="BUILT BY">
        <div className="flex flex-wrap items-center gap-3">
          <a href={AUTHOR} target="_blank" rel="noreferrer" className="flex items-center gap-3">
            <img src="https://github.com/VineetKamath.png?size=96" alt="Vineet Kamath" width={44} height={44} className="rounded-full border border-[var(--color-line-strong)]" />
            <span>
              <span className="block text-[15px] text-[var(--color-bright)]">Vineet Kamath</span>
              <span className="mono block text-[10px] tracking-[0.12em] text-[var(--color-mid)]">github.com/VineetKamath</span>
            </span>
          </a>
        </div>
      </Section>

      <Section title="SUPPORT & DEVELOP">
        <p>
          Nut is open source. If you enjoy watching her, a star on GitHub helps the project grow. Ideas, bug reports and contributions are very welcome, from new
          animals and behaviours to better brains and visuals.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn !text-[var(--color-signal)]" data-active href={REPO} target="_blank" rel="noreferrer">
            ★ STAR ON GITHUB
          </a>
          <a className="btn" href={`${REPO}/issues`} target="_blank" rel="noreferrer">
            REPORT AN ISSUE / IDEA
          </a>
          <a className="btn" href={`${REPO}/fork`} target="_blank" rel="noreferrer">
            FORK & CONTRIBUTE
          </a>
        </div>
      </Section>
    </Modal>
  );
}
