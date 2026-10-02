/**
 * Regain focus audio.
 *
 * Every sound is synthesised in the browser with the Web Audio API, so the app
 * ships without megabytes of audio files and works offline. Rain / ocean /
 * fire are noise-shaping chains, lo-fi is a generated chord progression and
 * 40 Hz "deep focus" is a binaural-ish drone.
 */

export type SoundKind =
  | "white"
  | "pink"
  | "brown"
  | "rain"
  | "ocean"
  | "fire"
  | "forest"
  | "cafe"
  | "lofi"
  | "deep";

function noiseBuffer(ctx: AudioContext, kind: "white" | "pink" | "brown", seconds = 4) {
  const length = ctx.sampleRate * seconds;
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

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private scheduler: number | null = null;
  private kind: SoundKind | null = null;
  private volume = 0.4;

  private ensureCtx() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private noise(kind: "white" | "pink" | "brown", gain = 0.5, filter?: { type: BiquadFilterType; freq: number; q?: number }) {
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
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    g.connect(this.master!);
    src.start();
    this.sources.push(src);
    this.nodes.push(g, node);
    return g;
  }

  private lfo(target: AudioParam, freq: number, depth: number) {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g);
    g.connect(target);
    osc.start();
    this.sources.push(osc);
    this.nodes.push(g);
  }

  private burst(type: BiquadFilterType, freq: number, decay: number, gain: number, q = 1) {
    const ctx = this.ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, "white", 0.5);
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = freq;
    bq.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(bq);
    bq.connect(g);
    g.connect(this.master!);
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  private blip(freq: number, dur: number, gain = 0.2, type: OscillatorType = "sine", delay = 0) {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.35, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private pad(freqs: number[], dur: number, gain = 0.12) {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime;
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.9);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(g);
      g.connect(this.master!);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    }
  }

  /** Start (or switch to) a soundscape. */
  play(kind: SoundKind, volume?: number) {
    const ctx = this.ensureCtx();
    if (volume !== undefined) this.volume = volume;
    this.stopAllNodes();
    this.kind = kind;
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    this.master.gain.value = this.volume;

    switch (kind) {
      case "white":
        this.noise("white", 0.28);
        break;
      case "pink":
        this.noise("pink", 0.42);
        break;
      case "brown":
        this.noise("brown", 0.72, { type: "lowpass", freq: 700 });
        break;
      case "rain": {
        const g = this.noise("white", 0.24, { type: "bandpass", freq: 1400, q: 0.6 });
        this.noise("brown", 0.3, { type: "lowpass", freq: 320 });
        this.lfo(g.gain, 0.07, 0.05);
        this.scheduler = window.setInterval(() => {
          if (Math.random() > 0.45) this.burst("highpass", 2400 + Math.random() * 2500, 0.09, 0.05, 0.6);
        }, 900);
        break;
      }
      case "ocean": {
        const g = this.noise("brown", 0.5, { type: "lowpass", freq: 620 });
        this.lfo(g.gain, 0.06, 0.32);
        const foam = this.noise("white", 0.12, { type: "bandpass", freq: 1800, q: 0.4 });
        this.lfo(foam.gain, 0.06, 0.08);
        break;
      }
      case "fire": {
        this.noise("brown", 0.38, { type: "lowpass", freq: 480 });
        this.scheduler = window.setInterval(() => {
          if (Math.random() > 0.35) this.burst("highpass", 900 + Math.random() * 2200, 0.05, 0.11, 0.7);
          if (Math.random() > 0.93) this.burst("bandpass", 220, 0.4, 0.14, 1.2);
        }, 320);
        break;
      }
      case "forest": {
        const g = this.noise("pink", 0.2, { type: "lowpass", freq: 2400 });
        this.lfo(g.gain, 0.05, 0.05);
        this.scheduler = window.setInterval(() => {
          if (Math.random() > 0.4) {
            const base = 1900 + Math.random() * 1800;
            const notes = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < notes; i++) {
              this.blip(base * (1 + i * 0.12), 0.09, 0.05, "sine", i * 0.11);
            }
          }
        }, 4200);
        break;
      }
      case "cafe": {
        const g = this.noise("pink", 0.3, { type: "lowpass", freq: 900 });
        this.lfo(g.gain, 0.11, 0.12);
        const murmur = this.noise("pink", 0.16, { type: "bandpass", freq: 420, q: 0.8 });
        this.lfo(murmur.gain, 0.23, 0.1);
        this.noise("brown", 0.22, { type: "lowpass", freq: 260 });
        break;
      }
      case "lofi": {
        this.noise("pink", 0.05, { type: "highpass", freq: 3200 });
        const roots = [220, 174.61, 196, 146.83];
        let step = 0;
        const chord = () => {
          const root = roots[step % roots.length];
          step += 1;
          this.pad([root, root * 1.19, root * 1.5, root * 2], 6.4, 0.075);
        };
        chord();
        this.scheduler = window.setInterval(chord, 6200);
        break;
      }
      case "deep": {
        const left = this.ensureCtx().createOscillator();
        const right = this.ensureCtx().createOscillator();
        left.type = "sine";
        right.type = "sine";
        left.frequency.value = 200;
        right.frequency.value = 210;
        const gl = this.ensureCtx().createGain();
        gl.gain.value = 0.09;
        left.connect(gl);
        gl.connect(this.master);
        const gr = this.ensureCtx().createGain();
        gr.gain.value = 0.09;
        right.connect(gr);
        gr.connect(this.master);
        this.lfo(gl.gain, 0.15, 0.05);
        left.start();
        right.start();
        this.sources.push(left, right);
        this.noise("brown", 0.12, { type: "lowpass", freq: 400 });
        break;
      }
    }
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
    if (this.scheduler !== null) {
      window.clearInterval(this.scheduler);
      this.scheduler = null;
    }
  }

  stop() {
    this.stopAllNodes();
    this.kind = null;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }

  current(): SoundKind | null {
    return this.kind;
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
      if (kind === "tick") {
        this.blip(880, 0.05, 0.05);
      } else if (kind === "phase") {
        this.blip(660, 0.18, 0.16);
        this.blip(990, 0.22, 0.14, "sine", 0.18);
      } else if (kind === "complete") {
        [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.3, 0.13, "sine", i * 0.13));
      } else {
        this.blip(300, 0.3, 0.2, "square");
        this.blip(220, 0.4, 0.16, "square", 0.22);
      }
    } catch {
      /* audio is best-effort */
    }
  }
}

export const ambient = new AmbientEngine();
