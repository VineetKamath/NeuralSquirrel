import { getExperiment } from "@/store/runtime";
import { focus } from "@/components/World/sharedUniforms";

/**
 * Procedural documentary-style ambience built with WebAudio:
 * wind, leaves, birds (day), insects (night), water, rain, footsteps,
 * and very quiet instrument tones tied to cognitive events.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private waterGain!: GainNode;
  private insectGain!: GainNode;
  private humGain!: GainNode;
  private noise!: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBird = 0;
  private nextRustle = 0;
  private nextStep = 0;
  private nextHawk = 0;
  private lastEvent = 0;
  private lastDecision = 0;
  private enabled = false;

  start() {
    if (this.ctx) {
      this.enabled = true;
      void this.ctx.resume();
      this.master.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.8);
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.enabled = true;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.master.gain.setTargetAtTime(0.55, ctx.currentTime, 1.5);

    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = this.noise.getChannelData(c);
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.02 * white) / 1.02;
        d[i] = white * 0.5 + brown * 3;
      }
    }

    // wind bed
    const wind = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // rain
    const rain = this.loopNoise();
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = "highpass";
    rainHp.frequency.value = 900;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainHp).connect(this.rainGain).connect(this.master);

    // water
    const water = this.loopNoise();
    const waterBp = ctx.createBiquadFilter();
    waterBp.type = "bandpass";
    waterBp.frequency.value = 1300;
    waterBp.Q.value = 1.4;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    water.connect(waterBp).connect(this.waterGain).connect(this.master);

    // insects: amplitude-modulated high tone
    const insect = ctx.createOscillator();
    insect.frequency.value = 4700;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 23;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(am.gain);
    this.insectGain = ctx.createGain();
    this.insectGain.gain.value = 0;
    insect.connect(am).connect(this.insectGain).connect(this.master);
    insect.start();
    lfo.start();

    // faint instrument hum tied to brain activity
    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 96;
    const hum2 = ctx.createOscillator();
    hum2.type = "sine";
    hum2.frequency.value = 144.5;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    hum.connect(this.humGain);
    hum2.connect(this.humGain);
    this.humGain.connect(this.master);
    hum.start();
    hum2.start();

    this.timer = setInterval(() => this.tick(), 100);
  }

  stop() {
    this.enabled = false;
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }

  private loopNoise() {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * 2);
    return src;
  }

  private burst(duration: number, freq: number, type: BiquadFilterType, gain: number, pan = 0) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + duration * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t, Math.random() * 2, duration + 0.05);
  }

  private chirp(pan: number, loud: number) {
    const ctx = this.ctx!;
    const notes = 2 + Math.floor(Math.random() * 5);
    const base = 2400 + Math.random() * 2600;
    const species = Math.random();
    let t = ctx.currentTime + 0.02;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      const dur = species < 0.5 ? 0.06 + Math.random() * 0.05 : 0.14 + Math.random() * 0.1;
      const f0 = base * (0.9 + Math.random() * 0.25);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (species < 0.5 ? 1.35 : 0.72), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012 * loud, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += dur + 0.03 + Math.random() * 0.09;
    }
  }

  private tone(freq: number, dur: number, gain: number, freq2?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t + dur * 0.6);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hawkCry() {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.type = "sawtooth";
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 2600;
    f.Q.value = 3;
    o.frequency.setValueAtTime(3100, t);
    o.frequency.exponentialRampToValueAtTime(1900, t + 1.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.3);
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const exp = getExperiment();
    const w = exp.world;
    const now = ctx.currentTime;
    const day = w.daylight;
    const rain = w.state.rainAmount;
    const gust = 0.5 + 0.5 * Math.sin(now * 0.13) * Math.sin(now * 0.041 + 1);

    this.windGain.gain.setTargetAtTime(0.03 + gust * 0.05 + rain * 0.04, now, 0.5);
    this.windFilter.frequency.setTargetAtTime(260 + gust * 320, now, 0.8);
    this.rainGain.gain.setTargetAtTime(rain * 0.07, now, 1);
    this.insectGain.gain.setTargetAtTime((1 - day) * (1 - rain) * 0.004, now, 1.5);

    const dPond = w.terrain.site.distToWater(focus.position.x, focus.position.z);
    this.waterGain.gain.setTargetAtTime(Math.max(0, 1 - dPond / 25) * 0.035, now, 0.8);

    const brain = exp.ctx.brain;
    let act = 0;
    for (const k in brain.activation) act += brain.activation[k as keyof typeof brain.activation];
    this.humGain.gain.setTargetAtTime(Math.min(1, act / 5) * 0.0035, now, 0.6);

    if (now > this.nextRustle) {
      this.nextRustle = now + 0.4 + Math.random() * (3 - gust * 2);
      this.burst(0.6 + Math.random() * 1.2, 3000 + Math.random() * 3000, "highpass", 0.012 + gust * 0.02, Math.random() * 2 - 1);
    }
    if (day > 0.35 && rain < 0.5 && now > this.nextBird) {
      this.nextBird = now + 1.5 + Math.random() * 7;
      this.chirp(Math.random() * 1.6 - 0.8, day * (0.4 + Math.random() * 0.8));
    }

    const agent = exp.agent.state;
    const speed = agent.anim.speed;
    if (speed > 0.3 && now > this.nextStep) {
      this.nextStep = now + Math.max(0.09, 0.45 - speed * 0.08);
      this.burst(0.05, 2400 + Math.random() * 1500, "bandpass", 0.03, 0);
    }
    if (agent.anim.pose === "dig" && now > this.nextStep) {
      this.nextStep = now + 0.12;
      this.burst(0.07, 900, "bandpass", 0.03, 0);
    }
    if (agent.anim.pose === "eat" && now > this.nextStep) {
      this.nextStep = now + 0.18 + Math.random() * 0.2;
      this.burst(0.03, 4500, "highpass", 0.02, 0);
    }

    const hawk = w.state.threats.find((t) => t.kind === "hawk");
    if (hawk?.active && now > this.nextHawk) {
      this.nextHawk = now + 6 + Math.random() * 10;
      this.hawkCry();
    }

    const events = exp.ctx.events;
    if (events.lastId !== this.lastEvent) {
      const fresh = events.log.filter((e) => e.id > this.lastEvent);
      this.lastEvent = events.lastId;
      if (fresh.some((e) => e.major)) {
        this.tone(660, 1.6, 0.012, 990);
        setTimeout(() => this.ctx && this.tone(1320, 1.4, 0.006), 180);
      } else if (fresh.some((e) => e.category === "danger")) {
        this.tone(220, 0.8, 0.008, 180);
      } else if (fresh.length) {
        this.tone(1760, 0.25, 0.0025);
      }
    }
    const decisions = agent.behaviorStats.decisions;
    if (decisions !== this.lastDecision) {
      this.lastDecision = decisions;
      this.tone(2900 + Math.random() * 400, 0.06, 0.0012);
    }
  }
}

let engine: AudioEngine | null = null;
export function getAudio() {
  if (!engine) engine = new AudioEngine();
  return engine;
}
