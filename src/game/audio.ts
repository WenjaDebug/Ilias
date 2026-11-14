/**
 * Synthesised atmosphere and effects (WebAudio, no sound files yet):
 * night wind, crackling fires, footsteps, bow, impacts, shouts, heartbeat.
 * Real recorded sounds can replace these later without touching the game code.
 */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private crackleGain!: GainNode;
  private heartGain!: GainNode;
  private heartT = 0;
  private stepT = 0;
  enabled = true;
  private musicGain!: GainNode;
  private musicLevel = 0;
  private noteT = 0;
  private melodyIdx = 0;
  /** 0 = the quiet sneaking tune, 1 = the storm: the same lyre, lower and driven */
  storm = 0;

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // wind: low-passed noise with slow gusts
    const wind = this.noiseSrc(true);
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 380;
    const wg = ctx.createGain();
    wg.gain.value = 0.08;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.05;
    lfo.connect(lfoG).connect(wg.gain);
    lfo.start();
    wind.connect(wf).connect(wg).connect(this.master);

    // fire crackle bed (volume follows distance to nearest fire)
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    const roar = this.noiseSrc(true);
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 600;
    rf.Q.value = 0.6;
    const rg = ctx.createGain();
    rg.gain.value = 0.25;
    roar.connect(rf).connect(rg).connect(this.crackleGain);
    this.crackleGain.connect(this.master);

    this.heartGain = ctx.createGain();
    this.heartGain.gain.value = 0;
    this.heartGain.connect(this.master);

    // music bed: two soft detuned drones (an open fifth) under the plucked notes
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);
    for (const [f, v] of [[73.4, 0.05], [110.2, 0.03], [146.6, 0.018]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = v;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11 + Math.random() * 0.08;
      const lg = ctx.createGain();
      lg.gain.value = v * 0.5;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      o.connect(g).connect(this.musicGain);
      o.start();
    }
  }

  /** 0 = silent (fight), 1 = quiet tension music */
  setMusic(level: number) {
    if (!this.ctx) return;
    if (level !== this.musicLevel) {
      this.musicLevel = level;
      this.musicGain.gain.setTargetAtTime(level * 0.9, this.ctx.currentTime, level ? 2.5 : 0.25);
    }
  }

  /** a plucked lyre-like note: bright attack, quick decay, a touch of a second string */
  private pluck(freq: number, vol: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [mul, v, type] of [[1, 1, 'triangle'], [2, 0.25, 'sine'], [1.005, 0.5, 'sine']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * v, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + 1.7);
    }
  }

  private noiseSrc(loop: boolean) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  private burst(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = 'bandpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slide = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** per-frame: fire loudness and heartbeat by danger */
  update(dt: number, fireProximity: number, danger: number, moving: number, sprint: boolean, crouched: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crackleGain.gain.setTargetAtTime(Math.min(0.5, fireProximity), t, 0.3);
    // slow phrases in the Dorian mode on D, like a lyre picked at in the dark
    if (this.musicLevel > 0) {
      this.noteT -= dt;
      if (this.noteT <= 0) {
        const scale = [146.8, 164.8, 174.6, 196, 220, 246.9, 261.6, 293.7, 329.6];
        // the storm keeps the ancient mode but drops an octave in places and never rests
        const phrase = this.storm > 0.5 ? [0, 0, 3, 0, 4, 3, 2, 0, 0, 5, 4, 2, 0, 3] : [0, 2, 4, 3, 7, 4, 2, 0, -1, 4, 5, 4, 2, 0];
        const deg = phrase[this.melodyIdx % phrase.length];
        this.melodyIdx++;
        if (deg >= 0) {
          const low = this.storm > 0.5 && this.melodyIdx % 2 === 0 ? 0.5 : 1;
          this.pluck(scale[deg] * low, (0.07 + Math.random() * 0.03) * (1 + this.storm * 0.4));
        }
        const rest = this.melodyIdx % phrase.length === 0 && this.storm < 0.5 ? 4 : 0;
        this.noteT = (0.9 + Math.random() * 1.1) * (1 - this.storm * 0.55) + rest;
      }
    }
    if (Math.random() < fireProximity * dt * 18) this.burst(2500 + Math.random() * 3000, 3, 0.04, 0.25 * fireProximity, 'highpass');
    // heartbeat
    this.heartT -= dt;
    if (danger > 0.25 && this.heartT <= 0) {
      this.heartT = 1.1 - danger * 0.55;
      this.tone(52, 0.18, 0.35 * danger);
      setTimeout(() => this.tone(46, 0.16, 0.25 * danger), 160);
    }
    // footsteps
    if (moving > 0.3) {
      this.stepT -= dt * moving * (sprint ? 0.55 : 0.7);
      if (this.stepT <= 0) {
        this.stepT = 1;
        this.burst(crouched ? 300 : 500, 1.2, crouched ? 0.06 : 0.09, crouched ? 0.05 : sprint ? 0.22 : 0.12, 'lowpass');
      }
    }
  }

  bowDraw() { this.burst(900, 4, 0.35, 0.05); }
  bowRelease() { this.tone(180, 0.18, 0.25, 'triangle', -90); this.burst(3000, 1, 0.08, 0.1, 'highpass'); }
  arrowHitWall() { this.burst(1800, 2, 0.08, 0.2); this.tone(120, 0.06, 0.15, 'square'); }
  arrowHitFlesh() { this.burst(400, 1, 0.12, 0.25, 'lowpass'); }
  swordSwing() { this.burst(2200, 0.8, 0.18, 0.12, 'highpass'); }
  swordHit() { this.tone(900, 0.25, 0.12, 'square', -300); this.burst(1500, 2, 0.15, 0.2); }
  blocked() { this.tone(1400, 0.3, 0.15, 'triangle', -400); }
  takedown() { this.burst(250, 1, 0.25, 0.3, 'lowpass'); this.tone(70, 0.3, 0.2); }
  bodyFall() { this.burst(160, 1, 0.3, 0.35, 'lowpass'); }
  land() { this.burst(200, 1, 0.12, 0.25, 'lowpass'); }
  hurt() { this.tone(160, 0.25, 0.25, 'sawtooth', -60); }
  pickup() { this.tone(520, 0.12, 0.12, 'triangle'); setTimeout(() => this.tone(780, 0.18, 0.1, 'triangle'), 90); }
  shout() {
    // a rough shouted call: two detuned saws with a vowel-ish formant
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 800;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    for (const fr of [150, 153]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(fr, t);
      o.frequency.linearRampToValueAtTime(fr * 1.4, t + 0.25);
      o.frequency.linearRampToValueAtTime(fr * 1.1, t + 0.85);
      o.connect(f);
      o.start(t);
      o.stop(t + 0.95);
    }
    f.connect(g).connect(this.master);
  }
  hatch() { this.burst(300, 1, 0.5, 0.3, 'lowpass'); this.tone(90, 0.4, 0.15, 'sawtooth', -30); }
  /** the alarm bell: a bronze strike with its partials ringing out */
  bell() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [mul, v, dur] of [[1, 0.28, 2.6], [2.76, 0.12, 1.6], [5.4, 0.06, 0.9], [1.52, 0.1, 2.0]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 520 * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    this.burst(3000, 1, 0.05, 0.15, 'highpass');
  }
  /** the Greek war horn: a long brassy note that swells and breaks off */
  horn() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, type, v] of [[196, 'sawtooth', 0.12], [196.8, 'square', 0.05], [392, 'sawtooth', 0.04]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * 0.94, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.3);
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.35);
      g.gain.setValueAtTime(v, t + 1.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
      o.connect(fl).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 2.4);
    }
  }
  /** wood groaning and chain over a drum: the gate on the move */
  creak() { this.burst(140, 3, 0.6, 0.25, 'lowpass'); this.tone(60, 0.5, 0.12, 'sawtooth', 15); }
  /** the padlock springs open */
  unlock() { this.tone(1800, 0.08, 0.12, 'square', -600); setTimeout(() => this.burst(900, 2, 0.12, 0.2), 120); }
  /** the beam grinding through its brackets */
  grind() { this.burst(220, 2, 0.35, 0.18, 'lowpass'); }
  /** a far-off roar of many voices (the army at the gate) */
  roar() { this.burst(300, 0.5, 2.5, 0.18, 'bandpass'); this.burst(700, 0.7, 2.0, 0.1, 'bandpass'); }
  torchOut() { this.burst(1200, 1.5, 0.3, 0.2, 'lowpass'); this.burst(4000, 2, 0.15, 0.1, 'highpass'); }
  ropeGrip() { this.burst(700, 0.6, 0.07, 0.06, 'bandpass'); }
}
