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

  /**
   * Small feedback-delay bus used by the music voices. Gives the generated
   * tracks a sense of room without a single sample of noise underneath them.
   */
  private space(out: AudioNode, amount = 0.3) {
    const ctx = this.ensureCtx();
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(out);
    const send = ctx.createGain();
    send.gain.value = amount;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.29;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2200;
    send.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(bus);
    this.nodes.push(bus, send, delay, feedback, damp);
    return { bus, send };
  }

  /** Scheduled note with independent attack/release, used by the composer. */
  private voice_note(
    out: AudioNode,
    freq: number,
    at: number,
    dur: number,
    gain = 0.12,
    type: OscillatorType = "triangle",
    detune = 0,
  ) {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
    const g = ctx.createGain();
    const attack = Math.min(0.06, dur * 0.2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    this.nodes.push(g);
  }

  /** Chord: the notes sound together and ring out. */
  private chord(out: AudioNode, freqs: number[], at: number, dur: number, gain = 0.07) {
    freqs.forEach((f, i) =>
      this.voice_note(out, f, at + i * 0.012, dur, gain, "triangle", i % 2 ? 4 : -4),
    );
  }

  /** Bass line note — a sine an octave or two down. */
  private bass(out: AudioNode, freq: number, at: number, dur: number, gain = 0.13) {
    this.voice_note(out, freq, at, dur, gain, "sine");
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
      /* Original compositions generated from chord tables and scales.
         Deliberately no noise beds, no crackle, no hiss — just the music. */

      case "lofi": {
        const { bus, send } = this.space(out, 0.34);
        // Fmaj7 – Am7 – Dm7 – G7, four bars, keys-led and unhurried
        const progression = [
          ["F3", "A3", "C4", "E4"],
          ["A3", "C4", "E4", "G4"],
          ["D3", "F3", "A3", "C4"],
          ["G3", "B3", "D4", "F4"],
        ].map((chord) => chord.map(hz));
        const barSeconds = 5.2;
        let bar = 0;
        const playBar = () => {
          const notes = progression[bar % progression.length];
          const root = notes[0];
          bar += 1;
          this.chord(bus, notes, 0, barSeconds * 0.96, 0.055);
          this.bass(bus, root / 2, 0.02, barSeconds * 0.5, 0.12);
          this.bass(bus, root / 2 * 1.5, barSeconds * 0.5, barSeconds * 0.42, 0.1);
          // sparse melody on top, one note per beat at most
          for (let i = 0; i < 4; i++) {
            if (Math.random() > 0.45) continue;
            const degree = SCALES.majorPentatonic[Math.floor(Math.random() * 5)];
            const freq = root * 2 * Math.pow(2, degree / 12);
            const at = i * (barSeconds / 4) + 0.05;
            this.voice_note(bus, freq, at, 1.4, 0.05, "sine");
            this.voice_note(send, freq * 2, at + 0.01, 1.8, 0.02, "sine");
          }
        };
        playBar();
        this.every(barSeconds * 1000, playBar);
        break;
      }

      case "lofiPiano": {
        const { bus, send } = this.space(out, 0.3);
        // Cmaj7 – Em7 – Fmaj7 – Gadd9, arpeggiated like a practice loop
        const progression = [
          ["C3", "E3", "G3", "B3"],
          ["E3", "G3", "B3", "D4"],
          ["F3", "A3", "C4", "E4"],
          ["G3", "B3", "D4", "A4"],
        ].map((c) => c.map(hz));
        const barSeconds = 4.4;
        let bar = 0;
        const playBar = () => {
          const notes = progression[bar % progression.length];
          bar += 1;
          this.bass(bus, notes[0] / 2, 0, 2.1, 0.11);
          // arpeggio, humanised timing and dynamics
          const order = [...notes, notes[2], notes[1], notes[3]];
          order.forEach((freq, i) => {
            const at = i * (barSeconds / order.length) + Math.random() * 0.03;
            this.voice_note(bus, freq, at, 1.5, 0.085 - i * 0.004, "triangle");
            this.voice_note(send, freq * 2, at + 0.02, 2.2, 0.03, "sine");
          });
          // melody note or two above the arpeggio
          if (Math.random() > 0.35) {
            const degree = SCALES.majorPentatonic[Math.floor(Math.random() * 5)];
            const at = 1.2 + Math.random() * 1.4;
            this.voice_note(bus, notes[0] * 2 * Math.pow(2, degree / 12), at, 1.8, 0.055, "sine");
          }
        };
        playBar();
        this.every(barSeconds * 1000, playBar);
        break;
      }

      case "lofiJazz": {
        const { bus, send } = this.space(out, 0.28);
        // ii – V – I in C, walking bass and brushed hits
        const progression = [
          ["D3", "F3", "A3", "C4"],
          ["G3", "B3", "D4", "F4"],
          ["C3", "E3", "G3", "B3"],
          ["A3", "C4", "E4", "G4"],
        ].map((c) => c.map(hz));
        const barSeconds = 3.6;
        let bar = 0;
        const playBar = () => {
          const notes = progression[bar % progression.length];
          bar += 1;
          this.chord(bus, notes, 0, barSeconds * 0.9, 0.05);
          // walking bass: four quarter notes
          const walk = [0, 3, 7, 10];
          walk.forEach((step, i) => {
            this.bass(bus, notes[0] / 2 * Math.pow(2, step / 12), i * 0.9, 0.8, 0.11);
          });
          // brush snare on 2 and 4, light hat eighths
          this.drum(bus, "snare", 0.09, 0.9);
          this.drum(bus, "snare", 0.08, 2.7);
          for (let i = 0; i < 8; i++) this.drum(bus, "hat", 0.05, i * 0.45);
          // a blue note for colour
          this.voice_note(send, notes[1] * 2 * Math.pow(2, 3 / 12), 1.6, 1.2, 0.04, "sine");
        };
        playBar();
        this.every(barSeconds * 1000, playBar);
        break;
      }

      case "lofiBeats": {
        const { bus } = this.space(out, 0.22);
        // Am7 – Fmaj7 – Cmaj7 – G6, boom-bap drums at 78 BPM
        const progression = [
          ["A2", "C3", "E3", "G3"],
          ["F2", "A2", "C3", "E3"],
          ["C3", "E3", "G3", "B3"],
          ["G2", "B2", "D3", "E3"],
        ].map((c) => c.map(hz));
        const barSeconds = 3.1;
        let bar = 0;
        const playBar = () => {
          const notes = progression[bar % progression.length];
          bar += 1;
          this.chord(bus, notes, 0, 2.4, 0.05);
          this.bass(bus, notes[0], 0, 1.0, 0.14);
          this.bass(bus, notes[0] * 1.5, 1.55, 0.7, 0.11);
          // kick / snare / hats pattern
          this.drum(bus, "kick", 0.26, 0);
          this.drum(bus, "kick", 0.2, 1.9);
          this.drum(bus, "snare", 0.2, 0.78);
          this.drum(bus, "snare", 0.18, 2.34);
          for (let i = 0; i < 8; i++) this.drum(bus, "hat", 0.06, 0.4 + i * 0.28);
          // melodic hook, same phrase twice then a variation
          const hook = [0, 3, 5, 7];
          hook.forEach((degree, i) => {
            const freq = notes[0] * 2 * Math.pow(2, degree / 12);
            this.voice_note(bus, freq, i * 0.78, 0.6, 0.05, "triangle");
          });
        };
        playBar();
        this.every(barSeconds * 1000, playBar);
        break;
      }

      case "chillwave": {
        const { bus, send } = this.space(out, 0.4);
        // Am – F – C – G with a slow arpeggio, wide and warm
        const progression = [
          ["A2", "C3", "E3"],
          ["F2", "A2", "C3"],
          ["C3", "E3", "G3"],
          ["G2", "B2", "D3"],
        ].map((c) => c.map(hz));
        const barSeconds = 6.4;
        let bar = 0;
        const playBar = () => {
          const notes = progression[bar % progression.length];
          bar += 1;
          this.chord(bus, notes.map((n) => n * 2), 0, barSeconds * 0.95, 0.05);
          this.bass(bus, notes[0], 0, barSeconds * 0.6, 0.12);
          for (let i = 0; i < 8; i++) {
            const degree = SCALES.lydian[i % SCALES.lydian.length];
            const freq = notes[0] * 4 * Math.pow(2, degree / 12);
            const at = i * (barSeconds / 8) + 0.02;
            this.voice_note(bus, freq, at, 0.9, 0.035, "triangle");
            this.voice_note(send, freq * 2, at, 1.6, 0.018, "sine");
          }
        };
        playBar();
        this.every(barSeconds * 1000, playBar);
        break;
      }

      case "synthwave": {
        const { bus } = this.space(out, 0.26);
        // Em – C – G – D at a driving tempo with a 16th arpeggio
        const progression = [
          ["E2", "G2", "B2"],
          ["C2", "E2", "G2"],
          ["G2", "B2", "D3"],
          ["D2", "F#2", "A2"],
        ].map((c) => c.map(hz));
        const barSeconds = 3.6;
        let bar = 0;
        const playBar = () => {
          const notes = progression[bar % progression.length];
          bar += 1;
          this.chord(bus, notes.map((n) => n * 2), 0, barSeconds * 0.9, 0.045);
          const steps = 16;
          for (let i = 0; i < steps; i++) {
            const degree = SCALES.minorPentatonic[i % SCALES.minorPentatonic.length];
            const freq = notes[0] * 4 * Math.pow(2, degree / 12);
            const at = i * (barSeconds / steps);
            this.voice_note(bus, freq, at, 0.16, 0.032, "square");
          }
          this.bass(bus, notes[0], 0, barSeconds * 0.48, 0.15);
          this.bass(bus, notes[0], barSeconds * 0.5, barSeconds * 0.48, 0.15);
          this.drum(bus, "kick", 0.24, 0);
          this.drum(bus, "kick", 0.22, barSeconds * 0.5);
          this.drum(bus, "snare", 0.16, barSeconds * 0.25);
          this.drum(bus, "snare", 0.16, barSeconds * 0.75);
        };
        playBar();
        this.every(barSeconds * 1000, playBar);
        break;
      }

      case "ambient": {
        const { bus, send } = this.space(out, 0.5);
        // very slow swells: one chord every 16 s, nothing else
        const progression = [
          ["C2", "G2", "C3", "E3"],
          ["A2", "E3", "A3", "C4"],
          ["F2", "C3", "F3", "A3"],
          ["G2", "D3", "G3", "B3"],
        ].map((c) => c.map(hz));
        const barSeconds = 16;
        let bar = 0;
        const swell = () => {
          const notes = progression[bar % progression.length];
          bar += 1;
          this.chord(bus, notes, 0, barSeconds * 1.6, 0.05);
          this.chord(send, notes.map((n) => n * 2), 2, barSeconds * 1.8, 0.02);
        };
        swell();
        this.every(barSeconds * 1000, swell);
        break;
      }

      case "bowls": {
        const { bus, send } = this.space(out, 0.55);
        // singing bowls in A minor pentatonic, one strike every few seconds
        const pitches = ["A2", "C3", "D3", "E3", "G3", "A3"].map(hz);
        const strike = () => {
          const base = pitches[Math.floor(Math.random() * pitches.length)];
          this.voice_note(bus, base, 0, 7.5, 0.075, "sine");
          this.voice_note(bus, base * 2.005, 0.02, 5.5, 0.03, "sine");
          this.voice_note(send, base * 3.01, 0.05, 4, 0.015, "sine");
        };
        strike();
        this.every(6500, strike);
        break;
      }

      case "tanpura": {
        const { bus } = this.space(out, 0.3);
        // Sa–Pa drone: a steady plucked cycle, no noise under it
        const sa = hz("C3");
        const pa = sa * 1.4983;
        this.every(1800, () => {
          this.voice_note(bus, sa, 0, 2.2, 0.085, "triangle");
          this.voice_note(bus, pa, 0.45, 2.0, 0.06, "triangle");
          this.voice_note(bus, sa / 2, 0.9, 2.6, 0.08, "sine");
        });
        break;
      }

      case "flute": {
        const { bus, send } = this.space(out, 0.45);
        // bansuri phrases in D major pentatonic over a soft drone
        const root = hz("D3");
        this.every(1200, () => this.voice_note(bus, root / 2, 0, 6, 0.05, "sine"));
        const phrase = () => {
          const notes = 4 + Math.floor(Math.random() * 4);
          let at = 0;
          for (let i = 0; i < notes; i++) {
            const degree = SCALES.majorPentatonic[Math.floor(Math.random() * 5)];
            const octave = Math.random() > 0.5 ? 2 : 1;
            const freq = root * Math.pow(2, degree / 12) * octave;
            const dur = 0.6 + Math.random() * 0.7;
            this.voice_note(bus, freq, at, dur, 0.07, "sine");
            this.voice_note(send, freq * 2, at + 0.03, dur * 1.3, 0.02, "sine");
            at += dur * 0.85;
          }
        };
        phrase();
        this.every(5800, phrase);
        break;
      }

      /* ------------------------ brainwave ------------------------ */
      case "deep":
      case "alpha":
      case "theta": {
        const { bus } = this.space(out, 0.2);
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
        gl.connect(bus);
        right.connect(gr);
        gr.connect(bus);
        this.lfo(gl.gain, 0.13, 0.04);
        left.start();
        right.start();
        this.sources.push(left, right);
        this.nodes.push(gl, gr);
        break;
      }
    }
  }

  /* --------------------------- transport ---------------------------- */

  /**
   * Start (or switch to) a soundscape. One sound at a time: the Music page
   * plays a single original track or ambience, never a stack of layers.
   */
  play(kind: SoundKind, volume?: number) {
    const ctx = this.ensureCtx();
    if (volume !== undefined) this.volume = volume;
    this.stopAllNodes();
    this.kinds = [kind];

    if (!this.master) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    this.master.gain.value = this.volume;

    const rail = this.rail(1);
    this.voice(kind, rail);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
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
