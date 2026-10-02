/**
 * Regain focus audio.
 *
 * Every sound is synthesised in the browser with the Web Audio API, so the app
 * ships without megabytes of audio files and works fully offline. Rain / ocean
 * / fire are noise-shaping chains, the lo-fi family is a generated chord-and-
 * drum composer, and the brainwave set is a binaural-ish drone.
 *
 * The engine plays *layers*: one primary soundscape plus optional extras
 * (rain + piano, café + brown noise…), each with its own gain, so the Music
 * page can build a mix instead of forcing a single choice.
 */

export type SoundKind =
  | "white"
  | "pink"
  | "brown"
  | "rain"
  | "thunder"
  | "stream"
  | "wind"
  | "ocean"
  | "fire"
  | "forest"
  | "night"
  | "chimes"
  | "cafe"
  | "library"
  | "train"
  | "keyboard"
  | "plane"
  | "lofi"
  | "lofiPiano"
  | "lofiJazz"
  | "lofiBeats"
  | "chillwave"
  | "synthwave"
  | "ambient"
  | "bowls"
  | "tanpura"
  | "flute"
  | "deep"
  | "alpha"
  | "theta";

export interface Layer {
  kind: SoundKind;
  /** 0–1, relative to the master volume */
  volume?: number;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function noiseBuffer(ctx: AudioContext, kind: "white" | "pink" | "brown", seconds = 4) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let brown = 0;

  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === "white") {
      data[i] = white * 0.6;
    } else if (kind === "pink") {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
      b6 = white * 0.115926;
    } else {
      brown = (brown + 0.02 * white) / 1.02;
      data[i] = brown * 3.2;
    }
  }
  return buffer;
}

/** Note names → Hz, used by the generated music voices. */
const NOTE: Record<string, number> = (() => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const map: Record<string, number> = {};
  for (let octave = 0; octave <= 7; octave++) {
    names.forEach((name, index) => {
      const midi = 12 * (octave + 1) + index;
      map[`${name}${octave}`] = 440 * Math.pow(2, (midi - 69) / 12);
    });
  }
  return map;
})();
const hz = (note: string) => NOTE[note] ?? 220;

/** Scale degrees (semitones from the root) the composer improvises with. */
const SCALES = {
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

/* ------------------------------------------------------------------ */
/* engine                                                             */
/* ------------------------------------------------------------------ */

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** per-layer gain rails so a layer can be muted without rebuilding the mix */
  private layerGains: GainNode[] = [];
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private timers: number[] = [];
  private kinds: SoundKind[] = [];
  private volume = 0.4;

  private ensureCtx() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Gain node a voice should connect to (respects the layer volume). */
  private rail(volume = 1) {
    const ctx = this.ensureCtx();
    const g = ctx.createGain();
    g.gain.value = volume;
    g.connect(this.master!);
    this.layerGains.push(g);
    return g;
  }

  private noise(
    out: AudioNode,
    kind: "white" | "pink" | "brown",
    gain = 0.5,
    filter?: { type: BiquadFilterType; freq: number; q?: number },
  ) {
    const ctx = this.ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, kind);
    src.loop = true;
    let node: AudioNode = src;
    if (filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = filter.type;
      bq.frequency.value = filter.freq;
      if (filter.q) bq.Q.value = filter.q;
      src.connect(bq);
      node = bq;
      this.nodes.push(bq);
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    g.connect(out);
    src.start();
    this.sources.push(src);
    this.nodes.push(g);
    return g;
  }

  private lfo(target: AudioParam, freq: number, depth: number, shape: OscillatorType = "sine") {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = shape;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g);
    g.connect(target);
    osc.start();
    this.sources.push(osc);
    this.nodes.push(g);
  }

  /** One-shot filtered noise — rain splashes, fire crackle, page turns. */
  private burst(
    out: AudioNode,
    type: BiquadFilterType,
    freq: number,
    decay: number,
    gain: number,
    q = 1,
    delay = 0,
  ) {
    const ctx = this.ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, "white", 0.5);
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = freq;
    bq.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(bq);
    bq.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + decay + 0.05);
    this.nodes.push(g, bq);
  }

  /** Pitched one-shot with a soft attack/decay envelope. */
  private note(
    out: AudioNode,
    freq: number,
    dur: number,
    gain = 0.2,
    type: OscillatorType = "sine",
    delay = 0,
    glide = 1,
  ) {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t);
    if (glide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.08, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    this.nodes.push(g);
  }

  /** Sustained chord pad (lo-fi family, ambient, chillwave). */
  private pad(out: AudioNode, freqs: number[], dur: number, gain = 0.09, type: OscillatorType = "triangle") {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    lp.connect(out);
    this.nodes.push(lp);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + Math.min(1.2, dur * 0.3));
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(g);
      g.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.1);
      this.nodes.push(g);
    }
  }

  /** Kick / snare / hat for the lo-fi beats voice. */
  private drum(out: AudioNode, kind: "kick" | "snare" | "hat", gain = 0.3, delay = 0) {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime + delay;
    if (kind === "kick") {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.35);
      this.nodes.push(g);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, "white", 0.4);
    const bq = ctx.createBiquadFilter();
    bq.type = kind === "snare" ? "bandpass" : "highpass";
    bq.frequency.value = kind === "snare" ? 1800 : 7000;
    bq.Q.value = kind === "snare" ? 0.9 : 0.6;
    const g = ctx.createGain();
    const decay = kind === "snare" ? 0.18 : 0.06;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * (kind === "snare" ? 1 : 0.5), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(bq);
    bq.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + decay + 0.05);
    this.nodes.push(g, bq);
  }

  private every(ms: number, fn: () => void) {
    const id = window.setInterval(fn, ms);
    this.timers.push(id);
    return id;
  }

  /** Random value in a range. */
  private rnd(min: number, max: number) {
    return min + Math.random() * (max - min);
  }

  /* --------------------------- voices --------------------------- */

  private voice(kind: SoundKind, out: AudioNode) {
    switch (kind) {
      /* ------------------------- masking ------------------------- */
      case "white":
        this.noise(out, "white", 0.28);
        break;
      case "pink":
        this.noise(out, "pink", 0.42);
        break;
      case "brown":
        this.noise(out, "brown", 0.72, { type: "lowpass", freq: 700 });
        break;

      /* ------------------------- nature -------------------------- */
      case "rain": {
        const g = this.noise(out, "white", 0.24, { type: "bandpass", freq: 1400, q: 0.6 });
        this.noise(out, "brown", 0.3, { type: "lowpass", freq: 320 });
        this.lfo(g.gain, 0.07, 0.05);
        this.every(900, () => {
          if (Math.random() > 0.45) this.burst(out, "highpass", this.rnd(2400, 4900), 0.09, 0.05, 0.6);
        });
        break;
      }
      case "thunder": {
        const g = this.noise(out, "white", 0.3, { type: "bandpass", freq: 1200, q: 0.5 });
        this.noise(out, "brown", 0.42, { type: "lowpass", freq: 400 });
        this.lfo(g.gain, 0.06, 0.07);
        this.every(700, () => {
          if (Math.random() > 0.5) this.burst(out, "highpass", this.rnd(2000, 5200), 0.1, 0.05, 0.6);
        });
        // rolling thunder: a long low rumble every 20–50 s
        this.every(4000, () => {
          if (Math.random() < 0.18) this.burst(out, "lowpass", this.rnd(90, 180), 3.2, 0.3, 0.7);
        });
        break;
      }
      case "stream": {
        const g = this.noise(out, "white", 0.22, { type: "bandpass", freq: 900, q: 0.4 });
        this.noise(out, "pink", 0.16, { type: "highpass", freq: 2600 });
        this.lfo(g.gain, 0.31, 0.08);
        this.every(2600, () => {
          if (Math.random() > 0.5) this.note(out, this.rnd(2400, 3600), 0.09, 0.03, "sine", 0, 1.1);
        });
        break;
      }
      case "wind": {
        const g = this.noise(out, "brown", 0.34, { type: "lowpass", freq: 520 });
        this.lfo(g.gain, 0.045, 0.22, "sine");
        const leaves = this.noise(out, "pink", 0.1, { type: "bandpass", freq: 3000, q: 0.5 });
        this.lfo(leaves.gain, 0.09, 0.07);
        break;
      }
      case "ocean": {
        const g = this.noise(out, "brown", 0.5, { type: "lowpass", freq: 620 });
        this.lfo(g.gain, 0.06, 0.32);
        const foam = this.noise(out, "white", 0.12, { type: "bandpass", freq: 1800, q: 0.4 });
        this.lfo(foam.gain, 0.06, 0.08);
        break;
      }
      case "fire": {
        this.noise(out, "brown", 0.38, { type: "lowpass", freq: 480 });
        this.every(320, () => {
          if (Math.random() > 0.35) this.burst(out, "highpass", this.rnd(900, 3100), 0.05, 0.11, 0.7);
          if (Math.random() > 0.93) this.burst(out, "bandpass", 220, 0.4, 0.14, 1.2);
        });
        break;
      }
      case "forest": {
        const g = this.noise(out, "pink", 0.2, { type: "lowpass", freq: 2400 });
        this.lfo(g.gain, 0.05, 0.05);
        this.every(4200, () => {
          if (Math.random() > 0.4) {
            const base = this.rnd(1900, 3700);
            const notes = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < notes; i++) {
              this.note(out, base * (1 + i * 0.12), 0.09, 0.05, "sine", i * 0.11);
            }
          }
        });
        break;
      }
      case "night": {
        this.noise(out, "brown", 0.22, { type: "lowpass", freq: 380 });
        // cricket chirps: short high blips in irregular bursts
        this.every(600, () => {
          if (Math.random() > 0.55) {
            const freq = this.rnd(3800, 4600);
            const count = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < count; i++) this.note(out, freq, 0.03, 0.035, "square", i * 0.05);
          }
        });
        this.every(11000, () => {
          if (Math.random() > 0.7) {
            // distant owl: two soft descending hoots
            this.note(out, 420, 0.35, 0.05, "sine", 0, 0.92);
            this.note(out, 400, 0.45, 0.045, "sine", 0.6, 0.9);
          }
        });
        break;
      }
      case "chimes": {
        this.noise(out, "pink", 0.08, { type: "bandpass", freq: 2600, q: 0.4 });
        this.every(3400, () => {
          if (Math.random() > 0.35) {
            const base = [523.25, 587.33, 659.25, 783.99, 880][Math.floor(Math.random() * 5)];
            this.note(out, base, 3.6, 0.055, "sine", 0);
            this.note(out, base * 2.01, 2.4, 0.025, "sine", 0.02);
          }
        });
        break;
      }

      /* ------------------------- places -------------------------- */
      case "cafe": {
        const g = this.noise(out, "pink", 0.3, { type: "lowpass", freq: 900 });
        this.lfo(g.gain, 0.11, 0.12);
        const murmur = this.noise(out, "pink", 0.16, { type: "bandpass", freq: 420, q: 0.8 });
        this.lfo(murmur.gain, 0.23, 0.1);
        this.noise(out, "brown", 0.22, { type: "lowpass", freq: 260 });
        break;
      }
      case "library": {
        this.noise(out, "brown", 0.26, { type: "lowpass", freq: 300 });
        const hum = this.noise(out, "pink", 0.1, { type: "bandpass", freq: 180, q: 0.7 });
        this.lfo(hum.gain, 0.02, 0.03);
        this.every(5200, () => {
          // page turn / chair shift
          if (Math.random() > 0.4) this.burst(out, "highpass", this.rnd(1800, 3800), 0.22, 0.035, 0.5);
        });
        break;
      }
      case "train": {
        const rain = this.noise(out, "white", 0.16, { type: "bandpass", freq: 1500, q: 0.6 });
        this.lfo(rain.gain, 0.05, 0.04);
        this.noise(out, "brown", 0.34, { type: "lowpass", freq: 300 });
        // bogie clatter: paired thuds, 2 per bar
        this.every(1500, () => {
          this.drum(out, "kick", 0.12);
          this.drum(out, "kick", 0.09, 0.18);
        });
        break;
      }
      case "keyboard": {
        const g = this.noise(out, "brown", 0.24, { type: "lowpass", freq: 340 });
        this.lfo(g.gain, 0.02, 0.03);
        // irregular key clicks, like someone typing nearby
        this.every(420, () => {
          if (Math.random() > 0.35) {
            const count = 2 + Math.floor(Math.random() * 5);
            for (let i = 0; i < count; i++) {
              this.burst(out, "bandpass", this.rnd(1500, 3200), 0.03, 0.05, 1.4, i * this.rnd(0.06, 0.12));
            }
          }
        });
        break;
      }
      case "plane": {
        const g = this.noise(out, "brown", 0.42, { type: "lowpass", freq: 420 });
        this.lfo(g.gain, 0.03, 0.05);
        const hiss = this.noise(out, "white", 0.06, { type: "highpass", freq: 4000 });
        this.lfo(hiss.gain, 0.05, 0.02);
        break;
      }

      /* -------------------------- music -------------------------- */
      case "lofi": {
        this.noise(out, "pink", 0.04, { type: "highpass", freq: 3200 });
        const roots = ["A2", "F2", "G2", "D2"];
        let step = 0;
        const chord = () => {
          const root = hz(roots[step % roots.length]);
          step += 1;
          this.pad(out, [root, root * 1.19, root * 1.5, root * 2], 6.4, 0.075);
          this.note(out, root / 2, 3.2, 0.09, "sine"); // bass
        };
        chord();
        this.every(6200, chord);
        break;
      }
      case "lofiPiano": {
        this.noise(out, "pink", 0.035, { type: "highpass", freq: 3600 });
        const roots = ["C3", "A2", "F2", "G2"];
        const scale = SCALES.majorPentatonic;
        let bar = 0;
        const phrase = () => {
          const root = hz(roots[bar % roots.length]);
          bar += 1;
          this.pad(out, [root / 2, root / 2 * 1.5], 5.6, 0.05);
          const notes = 3 + Math.floor(Math.random() * 3);
          let t = 0;
          for (let i = 0; i < notes; i++) {
            const degree = scale[Math.floor(Math.random() * scale.length)];
            const octave = Math.random() > 0.6 ? 2 : 1;
            const freq = root * Math.pow(2, degree / 12) * octave;
            this.note(out, freq, this.rnd(0.5, 1.1), 0.085, "triangle", t, 0.999);
            t += this.rnd(0.28, 0.62);
          }
        };
        phrase();
        this.every(5200, phrase);
        break;
      }
      case "lofiJazz": {
        this.noise(out, "pink", 0.04, { type: "highpass", freq: 3400 });
        const roots = ["D2", "G2", "C2", "A2"];
        let bar = 0;
        const phrase = () => {
          const root = hz(roots[bar % roots.length]);
          bar += 1;
          // ii–V-ish pad plus a walking bass line
          this.pad(out, [root, root * 1.19, root * 1.41, root * 1.78], 5.2, 0.06);
          const walk = [0, 3, 5, 7, 10];
          for (let i = 0; i < 4; i++) {
            const step = walk[(i + bar) % walk.length];
            this.note(out, root * Math.pow(2, step / 12), 0.42, 0.1, "sine", i * 0.62);
          }
          // brushed snare
          for (let i = 0; i < 4; i++) {
            this.burst(out, "bandpass", 1800, 0.12, 0.035, 0.8, i * 1.24 + 0.3);
          }
        };
        phrase();
        this.every(5000, phrase);
        break;
      }
      case "lofiBeats": {
        this.noise(out, "pink", 0.05, { type: "highpass", freq: 3200 });
        const roots = ["F2", "A2", "D2", "G2"];
        let bar = 0;
        const loop = () => {
          const root = hz(roots[bar % roots.length]);
          bar += 1;
          this.pad(out, [root, root * 1.19, root * 1.5], 4.4, 0.06);
          // 78 BPM, one bar ≈ 4.2 s: hip-hop-ish boom-bap
          this.drum(out, "kick", 0.26, 0);
          this.drum(out, "kick", 0.2, 0.62);
          this.drum(out, "snare", 0.22, 1.05);
          this.drum(out, "snare", 0.2, 3.15);
          for (let i = 0; i < 8; i++) this.drum(out, "hat", 0.1, 1.2 + i * 0.38);
          this.note(out, root * 2, 0.6, 0.06, "triangle", 0.3);
        };
        loop();
        this.every(4200, loop);
        break;
      }
      case "chillwave": {
        this.noise(out, "pink", 0.03, { type: "highpass", freq: 4200 });
        const roots = ["C3", "E3", "A2", "F3"];
        let bar = 0;
        const phrase = () => {
          const root = hz(roots[bar % roots.length]);
          bar += 1;
          this.pad(out, [root, root * 1.25, root * 1.5, root * 2.5], 7.5, 0.055, "sawtooth");
          for (let i = 0; i < 6; i++) {
            this.note(
              out,
              root * Math.pow(2, SCALES.lydian[i % SCALES.lydian.length] / 12) * 2,
              0.32,
              0.045,
              "triangle",
              0.4 + i * 0.52,
            );
          }
        };
        phrase();
        this.every(7200, phrase);
        break;
      }
      case "synthwave": {
        this.noise(out, "pink", 0.03, { type: "highpass", freq: 5000 });
        const roots = ["E2", "C2", "G2", "D2"];
        let bar = 0;
        const phrase = () => {
          const root = hz(roots[bar % roots.length]);
          bar += 1;
          this.pad(out, [root, root * 1.5, root * 2], 3.4, 0.07, "sawtooth");
          this.drum(out, "kick", 0.24, 0);
          this.drum(out, "kick", 0.22, 1.0);
          this.drum(out, "snare", 0.18, 0.5);
          this.drum(out, "snare", 0.18, 1.5);
          // 16th-note arpeggio
          const arp = SCALES.minorPentatonic;
          for (let i = 0; i < 16; i++) {
            const degree = arp[i % arp.length];
            this.note(out, root * 2 * Math.pow(2, degree / 12), 0.14, 0.045, "square", i * 0.25);
          }
        };
        phrase();
        this.every(4000, phrase);
        break;
      }
      case "ambient": {
        const roots = ["C2", "G2", "A2", "F2"];
        let bar = 0;
        const swell = () => {
          const root = hz(roots[bar % roots.length]);
          bar += 1;
          this.pad(out, [root, root * 1.5, root * 2.99, root * 4.02], 16, 0.045, "sine");
        };
        this.noise(out, "brown", 0.1, { type: "lowpass", freq: 240 });
        swell();
        this.every(15000, swell);
        break;
      }
      case "bowls": {
        this.noise(out, "brown", 0.14, { type: "lowpass", freq: 260 });
        this.every(6500, () => {
          const base = [174.61, 196, 220, 261.63][Math.floor(Math.random() * 4)];
          this.note(out, base, 7, 0.075, "sine", 0);
          this.note(out, base * 2.004, 5.5, 0.03, "sine", 0.03);
          this.note(out, base * 3.01, 3.5, 0.012, "sine", 0.06);
        });
        break;
      }
      case "tanpura": {
        // Sa–Pa drone: steady plucked cycle under everything
        const sa = hz("C3");
        const pa = sa * 1.4983;
        this.every(1800, () => {
          this.note(out, sa, 2.2, 0.075, "triangle");
          this.note(out, pa, 2.0, 0.055, "triangle", 0.45);
          this.note(out, sa / 2, 2.6, 0.07, "sine", 0.9);
        });
        this.noise(out, "brown", 0.05, { type: "lowpass", freq: 320 });
        break;
      }
      case "flute": {
        this.noise(out, "pink", 0.08, { type: "bandpass", freq: 900, q: 0.4 });
        const root = hz("D3");
        this.every(5800, () => {
          const scale = SCALES.majorPentatonic;
          const notes = 4 + Math.floor(Math.random() * 3);
          let t = 0;
          for (let i = 0; i < notes; i++) {
            const degree = scale[Math.floor(Math.random() * scale.length)];
            const octave = Math.random() > 0.5 ? 2 : 1;
            this.note(out, root * Math.pow(2, degree / 12) * octave, this.rnd(0.5, 1.0), 0.05, "sine", t, 1.004);
            t += this.rnd(0.5, 0.85);
          }
        });
        break;
      }

      /* ------------------------ brainwave ------------------------ */
      case "deep":
      case "alpha":
      case "theta": {
        const beat = kind === "deep" ? 40 : kind === "alpha" ? 10 : 6;
        const carrier = kind === "deep" ? 200 : 180;
        const ctx = this.ensureCtx();
        const left = ctx.createOscillator();
        const right = ctx.createOscillator();
        left.type = "sine";
        right.type = "sine";
        left.frequency.value = carrier - beat / 2;
        right.frequency.value = carrier + beat / 2;
        const gl = ctx.createGain();
        gl.gain.value = 0.085;
        const gr = ctx.createGain();
        gr.gain.value = 0.085;
        left.connect(gl);
        gl.connect(out);
        right.connect(gr);
        gr.connect(out);
        this.lfo(gl.gain, 0.13, 0.04);
        left.start();
        right.start();
        this.sources.push(left, right);
        this.nodes.push(gl, gr);
        this.noise(out, "brown", kind === "deep" ? 0.12 : 0.08, { type: "lowpass", freq: 400 });
        break;
      }
    }
  }

  /* --------------------------- transport ---------------------------- */

  /**
   * Start a mix. The first entry is the primary soundscape; the rest are layers.
   * Replaces whatever is currently playing.
   */
  playMix(layers: Layer[], volume?: number) {
    const ctx = this.ensureCtx();
    if (volume !== undefined) this.volume = volume;
    this.stopAllNodes();
    this.kinds = layers.map((l) => l.kind);

    if (!this.master) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    this.master.gain.value = this.volume;

    for (const layer of layers) {
      const rail = this.rail(layer.volume ?? 1);
      this.voice(layer.kind, rail);
    }
  }

  /** Start (or switch to) a single soundscape. */
  play(kind: SoundKind, volume?: number, mix?: Layer[]) {
    const extras = (mix ?? []).filter((l) => l.kind !== kind);
    this.playMix([{ kind, volume: 1 }, ...extras], volume);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Adjust the level of one layer of the running mix without restarting it. */
  setLayerVolume(index: number, value: number) {
    const rail = this.layerGains[index];
    if (rail) rail.gain.value = Math.max(0, Math.min(1, value));
  }

  private stopAllNodes() {
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      try {
        s.disconnect();
      } catch {
        /* ignore */
      }
    });
    this.nodes.forEach((n) => {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    });
    this.sources = [];
    this.nodes = [];
    this.layerGains = [];
    this.timers.forEach((id) => window.clearInterval(id));
    this.timers = [];
  }

  stop() {
    this.stopAllNodes();
    this.kinds = [];
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }

  current(): SoundKind | null {
    return this.kinds[0] ?? null;
  }

  /** Every layer currently playing, in order. */
  currentMix(): SoundKind[] {
    return [...this.kinds];
  }

  /** Short alert used for phase changes and the Focus Guard. */
  cue(kind: "phase" | "warn" | "tick" | "complete") {
    try {
      this.ensureCtx();
      if (!this.master) {
        this.master = this.ensureCtx().createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ensureCtx().destination);
      }
      const rail = this.master;
      if (kind === "tick") {
        this.note(rail, 880, 0.05, 0.05);
      } else if (kind === "phase") {
        this.note(rail, 660, 0.18, 0.16);
        this.note(rail, 990, 0.22, 0.14, "sine", 0.18);
      } else if (kind === "complete") {
        [523, 659, 784, 1046].forEach((f, i) => this.note(rail, f, 0.3, 0.13, "sine", i * 0.13));
      } else {
        this.note(rail, 300, 0.3, 0.2, "square");
        this.note(rail, 220, 0.4, 0.16, "square", 0.22);
      }
    } catch {
      /* audio is best-effort */
    }
  }
}

export const ambient = new AmbientEngine();
