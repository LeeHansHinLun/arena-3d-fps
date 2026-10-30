/* Fully procedural WebAudio: SFX + generative synthwave music. No asset files. */

export type Sfx =
  | 'rifle' | 'shotgun' | 'rail' | 'rocket' | 'explosion'
  | 'hit' | 'hitHead' | 'kill' | 'hurt' | 'die' | 'jump' | 'airjump' | 'land' | 'step'
  | 'slide' | 'dash' | 'walljump' | 'reload' | 'empty' | 'switch' | 'pickupHealth'
  | 'pickupArmor' | 'pad' | 'ui' | 'uiHover' | 'uiBack' | 'beep' | 'go' | 'win' | 'lose'
  | 'streak' | 'spawn' | 'enemyShot' | 'enemyShotgun' | 'enemyRail' | 'join';

interface PlayOpts {
  vol?: number;
  pan?: number;
  rate?: number;
}

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  vol = { master: 0.8, sfx: 0.9, music: 0.35 };
  private active = 0;
  private musicTimer: number | null = null;
  private nextTime = 0;
  private step = 0;
  musicOn = false;
  intensity = 0.6;

  init() {
    if (!this.ctx) {
      const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 2400;
      this.musicBus.connect(this.musicFilter);
      this.musicFilter.connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(master: number, sfx: number, music: number) {
    this.vol = { master, sfx, music };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
  }

  setIntensity(v: number) {
    this.intensity = v;
    if (this.ctx) this.musicFilter.frequency.setTargetAtTime(900 + v * 3200, this.ctx.currentTime, 0.4);
  }

  private out(node: AudioNode, pan?: number) {
    const ctx = this.ctx!;
    if (pan && Math.abs(pan) > 0.01 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p);
      p.connect(this.sfx);
    } else node.connect(this.sfx);
  }

  private tone(o: { f: number; f2?: number; dur: number; type?: OscillatorType; vol?: number; pan?: number; delay?: number; att?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f), t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol ?? 0.3), t + (o.att ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g);
    this.out(g, o.pan);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
    this.active++;
    osc.onended = () => {
      this.active--;
    };
  }

  private noise(o: { dur: number; vol: number; type: BiquadFilterType; f: number; f2?: number; q?: number; pan?: number; delay?: number; att?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = ctx.createBiquadFilter();
    flt.type = o.type;
    flt.frequency.setValueAtTime(o.f, t);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.dur);
    flt.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), t + (o.att ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(flt);
    flt.connect(g);
    this.out(g, o.pan);
    src.start(t, Math.random() * 0.8);
    src.stop(t + o.dur + 0.03);
    this.active++;
    src.onended = () => {
      this.active--;
    };
  }

  play(name: Sfx, opts: PlayOpts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.active > 46 && name !== 'kill' && name !== 'hurt' && name !== 'explosion') return;
    const v = opts.vol ?? 1;
    const pan = opts.pan ?? 0;
    const r = (opts.rate ?? 1) * (0.96 + Math.random() * 0.08);
    switch (name) {
      case 'rifle':
        this.noise({ dur: 0.07, vol: 0.5 * v, type: 'bandpass', f: 2600 * r, f2: 800, q: 0.8, pan });
        this.tone({ f: 260 * r, f2: 60, dur: 0.09, type: 'square', vol: 0.22 * v, pan });
        break;
      case 'enemyShot':
        this.noise({ dur: 0.07, vol: 0.4 * v, type: 'bandpass', f: 1800 * r, f2: 600, q: 0.8, pan });
        this.tone({ f: 190 * r, f2: 55, dur: 0.09, type: 'sawtooth', vol: 0.14 * v, pan });
        break;
      case 'shotgun':
      case 'enemyShotgun':
        this.noise({ dur: 0.3, vol: 0.9 * v, type: 'lowpass', f: 3200 * r, f2: 260, q: 0.6, pan });
        this.tone({ f: 150 * r, f2: 38, dur: 0.22, type: 'sawtooth', vol: 0.4 * v, pan });
        break;
      case 'rail':
      case 'enemyRail':
        this.tone({ f: 2000 * r, f2: 90, dur: 0.5, type: 'sawtooth', vol: 0.2 * v, pan });
        this.tone({ f: 110, f2: 38, dur: 0.45, type: 'sine', vol: 0.5 * v, pan });
        this.noise({ dur: 0.25, vol: 0.3 * v, type: 'highpass', f: 4000, pan });
        break;
      case 'rocket':
        this.noise({ dur: 0.4, vol: 0.6 * v, type: 'lowpass', f: 1500, f2: 200, pan });
        this.tone({ f: 130 * r, f2: 48, dur: 0.3, type: 'triangle', vol: 0.4 * v, pan });
        break;
      case 'explosion':
        this.noise({ dur: 1.2, vol: 1.0 * v, type: 'lowpass', f: 2000 * r, f2: 50, q: 0.7, pan, att: 0.006 });
        this.tone({ f: 95 * r, f2: 26, dur: 0.9, type: 'sine', vol: 0.9 * v, pan });
        this.tone({ f: 200, f2: 40, dur: 0.4, type: 'sawtooth', vol: 0.25 * v, pan });
        break;
      case 'hit':
        this.tone({ f: 1500, dur: 0.05, type: 'sine', vol: 0.28 * v });
        break;
      case 'hitHead':
        this.tone({ f: 2200, dur: 0.06, type: 'sine', vol: 0.32 * v });
        this.tone({ f: 3000, dur: 0.09, type: 'sine', vol: 0.22 * v, delay: 0.04 });
        break;
      case 'kill':
        this.tone({ f: 520, dur: 0.12, type: 'triangle', vol: 0.34 * v });
        this.tone({ f: 780, dur: 0.12, type: 'triangle', vol: 0.34 * v, delay: 0.07 });
        this.tone({ f: 1170, dur: 0.22, type: 'triangle', vol: 0.3 * v, delay: 0.14 });
        break;
      case 'hurt':
        this.tone({ f: 170, f2: 55, dur: 0.2, type: 'sine', vol: 0.6 * v });
        this.noise({ dur: 0.12, vol: 0.35 * v, type: 'lowpass', f: 900 });
        break;
      case 'die':
        this.tone({ f: 340, f2: 38, dur: 0.8, type: 'sawtooth', vol: 0.35 * v });
        this.noise({ dur: 0.5, vol: 0.4 * v, type: 'lowpass', f: 1500, f2: 100 });
        break;
      case 'jump':
        this.noise({ dur: 0.13, vol: 0.14 * v, type: 'bandpass', f: 500, f2: 1300, q: 1.2, pan });
        break;
      case 'airjump':
        this.noise({ dur: 0.18, vol: 0.25 * v, type: 'bandpass', f: 700, f2: 2400, q: 1.5 });
        this.tone({ f: 300, f2: 700, dur: 0.14, type: 'triangle', vol: 0.15 * v });
        break;
      case 'land':
        this.tone({ f: 110, f2: 40, dur: 0.14, type: 'sine', vol: 0.55 * v });
        this.noise({ dur: 0.09, vol: 0.2 * v, type: 'lowpass', f: 600 });
        break;
      case 'step':
        this.noise({ dur: 0.045, vol: 0.1 * v, type: 'lowpass', f: (500 + Math.random() * 300) * r, pan });
        break;
      case 'slide':
        this.noise({ dur: 0.55, vol: 0.22 * v, type: 'bandpass', f: 800, f2: 280, q: 1, att: 0.04 });
        break;
      case 'dash':
        this.noise({ dur: 0.28, vol: 0.4 * v, type: 'bandpass', f: 400, f2: 2800, q: 1, att: 0.02 });
        this.tone({ f: 180, f2: 620, dur: 0.22, type: 'sawtooth', vol: 0.1 * v });
        break;
      case 'walljump':
        this.tone({ f: 280, f2: 760, dur: 0.14, type: 'triangle', vol: 0.28 * v });
        this.noise({ dur: 0.1, vol: 0.2 * v, type: 'highpass', f: 1500 });
        break;
      case 'reload':
        this.tone({ f: 900, dur: 0.03, type: 'square', vol: 0.12 * v });
        this.tone({ f: 500, dur: 0.05, type: 'square', vol: 0.12 * v, delay: 0.22 });
        this.tone({ f: 1200, dur: 0.05, type: 'square', vol: 0.16 * v, delay: 0.75 });
        break;
      case 'empty':
        this.tone({ f: 320, dur: 0.04, type: 'square', vol: 0.18 * v });
        break;
      case 'switch':
        this.tone({ f: 500, f2: 950, dur: 0.06, type: 'square', vol: 0.1 * v });
        break;
      case 'pickupHealth':
        [600, 800, 1000].forEach((f, i) => this.tone({ f, dur: 0.12, type: 'sine', vol: 0.3 * v, delay: i * 0.06 }));
        break;
      case 'pickupArmor':
        this.tone({ f: 380, f2: 820, dur: 0.22, type: 'triangle', vol: 0.34 * v });
        this.tone({ f: 760, f2: 1200, dur: 0.2, type: 'sine', vol: 0.2 * v, delay: 0.08 });
        break;
      case 'pad':
        this.tone({ f: 180, f2: 1000, dur: 0.35, type: 'sawtooth', vol: 0.18 * v, pan });
        this.noise({ dur: 0.3, vol: 0.2 * v, type: 'bandpass', f: 600, f2: 3000, pan });
        break;
      case 'ui':
        this.tone({ f: 880, f2: 1100, dur: 0.06, type: 'sine', vol: 0.16 * v });
        break;
      case 'uiHover':
        this.tone({ f: 660, dur: 0.025, type: 'sine', vol: 0.05 * v });
        break;
      case 'uiBack':
        this.tone({ f: 700, f2: 420, dur: 0.08, type: 'sine', vol: 0.14 * v });
        break;
      case 'beep':
        this.tone({ f: 660, dur: 0.14, type: 'square', vol: 0.16 * v });
        break;
      case 'go':
        this.tone({ f: 990, dur: 0.4, type: 'square', vol: 0.18 * v });
        this.tone({ f: 1320, dur: 0.4, type: 'triangle', vol: 0.18 * v });
        break;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ f, dur: 0.35, type: 'triangle', vol: 0.3 * v, delay: i * 0.1 }));
        break;
      case 'lose':
        [440, 370, 311, 220].forEach((f, i) => this.tone({ f, dur: 0.4, type: 'sawtooth', vol: 0.18 * v, delay: i * 0.16 }));
        break;
      case 'streak':
        [600, 900, 1350].forEach((f, i) => this.tone({ f, dur: 0.16, type: 'square', vol: 0.14 * v, delay: i * 0.05 }));
        break;
      case 'spawn':
        this.tone({ f: 200, f2: 900, dur: 0.4, type: 'sine', vol: 0.2 * v });
        this.noise({ dur: 0.35, vol: 0.12 * v, type: 'highpass', f: 2000, att: 0.15 });
        break;
      case 'join':
        this.tone({ f: 700, dur: 0.07, type: 'sine', vol: 0.08 * v });
        this.tone({ f: 900, dur: 0.09, type: 'sine', vol: 0.08 * v, delay: 0.07 });
        break;
    }
  }

  /* ----------------------------- music ----------------------------- */
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = window.setInterval(() => this.schedule(), 40);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) return;
    if (ctx.state !== 'running') {
      this.nextTime = ctx.currentTime + 0.1;
      return;
    }
    const bpm = 112;
    const sd = 60 / bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.18) {
      this.musicStep(this.step, this.nextTime, sd);
      this.nextTime += sd;
      this.step = (this.step + 1) % 64;
    }
  }

  private mTone(t: number, f: number, dur: number, type: OscillatorType, vol: number, cut?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (cut) {
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(cut, t);
      flt.frequency.exponentialRampToValueAtTime(Math.max(120, cut * 0.15), t + dur);
      osc.connect(flt);
      flt.connect(g);
    } else osc.connect(g);
    g.connect(this.musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private mNoise(t: number, dur: number, vol: number, type: BiquadFilterType, f: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(this.musicBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  private musicStep(step: number, t: number, sd: number) {
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const roots = [33, 29, 36, 31];
    const chords = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]];
    const root = roots[bar];
    const ch = chords[bar];
    // drums
    if (s % 4 === 0) {
      const ctx = this.ctx!;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g);
      g.connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.22);
    }
    if (s === 4 || s === 12) this.mNoise(t, 0.16, 0.5, 'bandpass', 1800);
    if (s % 2 === 1) this.mNoise(t, 0.04, 0.16 * (0.4 + this.intensity), 'highpass', 7000);
    // bass (8ths)
    if (s % 2 === 0) {
      const oct = s % 8 === 6 ? 12 : 0;
      this.mTone(t, midi(root + oct), sd * 1.8, 'sawtooth', 0.34, 1100);
    }
    // arp
    const pat = [0, 1, 2, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1];
    const n = ch[pat[s]] + 12;
    this.mTone(t, midi(n), sd * 1.3, 'square', 0.06 + this.intensity * 0.05, 2600);
    // pad on bar start
    if (s === 0) {
      ch.forEach((c) => this.mTone(t, midi(c), sd * 15, 'triangle', 0.07));
    }
    // lead hint every 4 bars
    if (step % 64 === 32 || step % 64 === 40) this.mTone(t, midi(ch[2] + 24), sd * 6, 'sawtooth', 0.04, 3000);
  }
}

export const audio = new AudioEngine();
