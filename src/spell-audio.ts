import { audioCore, busy, claimVoice } from './audio.ts';

/**
  * Spell sound (wiki/design-spells.md, section 5): not “beeps” but a small orchestra in a hall.
  * - Everything is built from notes of the major pentatonic — whatever you play in a row sounds joyful and “childlike” (as in MCD).
  * - Power comes from the lows: a sine through soft saturation (harmonics audible even on laptop speakers), plus reverb.
  * - Charge goes in steps: each step adds a chord note and a ringing note above, the pulse quickens like a heartbeat.
 */

/** Sound school — matches the spell school (src/spells.ts School) */
export type SpellSound = 'spark' | 'fireball' | 'icerain' | 'heal' | 'star' | 'void' | 'earth' | 'arcane' | 'summon' | 'blood';

/** Major pentatonic: degree i → semitones from the root */
const PENTA = [0, 2, 4, 7, 9];
/** Note s semitones above the root */
export const semi = (root: number, s: number): number => root * Math.pow(2, s / 12);
/** i-th degree of the major pentatonic from the root (5 degrees per octave) */
export const deg = (root: number, i: number): number => semi(root, 12 * Math.floor(i / 5) + PENTA[((i % 5) + 5) % 5]);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Element palette: root, charge chord (semitones), timbre and brightness */
const PAL: Record<SpellSound, { root: number; chord: number[]; wave: OscillatorType; lp: number }> = {
  spark: { root: 329.63, chord: [0, 7, 12, 19], wave: 'triangle', lp: 3200 },
  fireball: { root: 110, chord: [0, 7, 12, 19], wave: 'sawtooth', lp: 900 },
  icerain: { root: 523.25, chord: [0, 4, 7, 12], wave: 'sine', lp: 7000 },
  heal: { root: 261.63, chord: [0, 4, 7, 11], wave: 'triangle', lp: 3000 },
  star: { root: 392, chord: [0, 4, 7, 14], wave: 'sine', lp: 6000 },
  void: { root: 130.81, chord: [0, 3, 7, 10], wave: 'triangle', lp: 1400 },
  earth: { root: 98, chord: [0, 7, 12, 16], wave: 'triangle', lp: 1100 },
  arcane: { root: 349.23, chord: [0, 4, 8, 12], wave: 'triangle', lp: 4000 },
  summon: { root: 293.66, chord: [0, 5, 7, 12], wave: 'triangle', lp: 2600 },
  blood: { root: 146.83, chord: [0, 3, 7, 10], wave: 'sawtooth', lp: 900 },
};

let shaper: Float32Array | null = null;
/** Soft saturation curve (tanh) */
const drive = (): Float32Array => (shaper ??= (() => { const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(x * 3) / Math.tanh(3); } return c; })());

interface VoiceOpts {
  type?: OscillatorType; f: number; f1?: number; dur: number; vol: number; attack?: number; delay?: number;
  /** Detune of the second oscillator, cents — warmer and wider */
  detune?: number;
  lp?: number; lp1?: number; q?: number;
  /** Share sent to the reverb */
  verb?: number;
}

/** Note: one or two oscillators, a filter with an envelope, volume with attack and decay */
export function voice({ type = 'triangle', f, f1, dur, vol, attack = 0.005, delay = 0, detune = 0, lp, lp1, q = 0.7, verb = 0.25 }: VoiceOpts): void {
  const a = audioCore();
  if (!a) return;
  // voice budget: when short, the detuned double goes first, then the note itself
  if (detune && busy() > 0.6) detune = 0;
  if (!claimVoice(dur, delay)) return;
  const { ctx } = a, t = ctx.currentTime + delay;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.02));
  let head: AudioNode = g;
  if (lp) {
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = q;
    fl.frequency.setValueAtTime(lp, t);
    if (lp1) fl.frequency.exponentialRampToValueAtTime(lp1, t + dur);
    fl.connect(g); head = fl;
  }
  for (const d of detune ? [-detune, detune] : [0]) {
    const o = ctx.createOscillator(); o.type = type; o.detune.value = d;
    o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(head); o.start(t); o.stop(t + dur + 0.05);
  }
  g.connect(a.out);
  if (verb > 0) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s).connect(a.verb); }
}

interface HissOpts { dur: number; vol: number; f: number; f1?: number; q?: number; type?: BiquadFilterType; attack?: number; delay?: number; verb?: number }

/** Noise through a filter with an envelope: whoosh, roar, crackle, thunder */
export function hiss({ dur, vol, f, f1, q = 0.8, type = 'bandpass', attack = 0.003, delay = 0, verb = 0.2 }: HissOpts): void {
  const a = audioCore();
  if (!a) return;
  // sparks and crackle (shorter than 0.1 s) yield first once the budget is half full
  if (dur < 0.1 && busy() > 0.5) return;
  if (!claimVoice(dur, delay)) return;
  const { ctx } = a, t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = a.noise; s.loop = true;
  s.playbackRate.value = rnd(0.9, 1.1);
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t);
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.02));
  s.connect(fl).connect(g).connect(a.out);
  if (verb > 0) { const v = ctx.createGain(); v.gain.value = verb; g.connect(v).connect(a.verb); }
  s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.05);
}

/** Thump in the lows: a sine with falling pitch through saturation — harmonics make it audible and “fat” */
export function boom(f0: number, f1: number, dur: number, vol: number, delay = 0, verb = 0.25): void {
  const a = audioCore();
  if (!a) return;
  if (!claimVoice(dur, delay)) return;
  const { ctx } = a, t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
  const pre = ctx.createGain(); pre.gain.value = 1.6;
  const ws = ctx.createWaveShaper(); ws.curve = drive();
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(pre).connect(ws).connect(g).connect(a.out);
  if (verb > 0) { const v = ctx.createGain(); v.gain.value = verb; g.connect(v).connect(a.verb); }
  o.start(t); o.stop(t + dur + 0.05);
}

/** Ringing bell note: fundamental and overtones */
export function bell(f: number, dur: number, vol: number, delay = 0, verb = 0.5): void {
  voice({ type: 'sine', f, dur, vol, delay, verb, attack: 0.003 });
  voice({ type: 'sine', f: f * 2.01, dur: dur * 0.6, vol: vol * 0.35, delay, verb, attack: 0.003 });
  voice({ type: 'triangle', f: f * 3, dur: dur * 0.25, vol: vol * 0.15, delay, verb });
}

/** Pluck, like a harp */
export const pluck = (f: number, vol: number, delay = 0, dur = 0.7): void => voice({ type: 'triangle', f, dur, vol, delay, lp: f * 6, lp1: f * 1.5, verb: 0.45, attack: 0.002 });

// ---------- charge ----------

/**
  * Charge sound: a chord bed (each step adds a note), lows and wind grow, the pulse quickens.
  * set(k) — every frame; stage(n) — a new step of the circle; full() — charge complete; stop() — cast or cancel
 */
export class ChargeSound {
  private readonly nodes: AudioScheduledSourceNode[] = [];
  private readonly pad: GainNode[] = [];
  private out: GainNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private sub: GainNode | null = null;
  private wind: GainNode | null = null;
  private windF: BiquadFilterNode | null = null;
  private shim: GainNode | null = null;
  private nextPulse = 0;
  private stageN = 0;
  private k = 0;
  private stopped = false;

  private readonly kind: SpellSound;
  constructor(kind: SpellSound) { this.kind = kind;
    const a = audioCore();
    const P = PAL[kind];
    // inhale: a rising whistle and a soft “whump”
    hiss({ dur: 0.35, vol: 0.12, f: 500, f1: 3000, q: 0.7, attack: 0.2, verb: 0.3 });
    boom(P.root > 300 ? 160 : 120, 60, 0.35, 0.22);
    if (!a) return;
    const { ctx } = a, t = ctx.currentTime;
    this.out = ctx.createGain(); this.out.gain.value = 1;
    this.out.connect(a.out);
    const send = ctx.createGain(); send.gain.value = 0.4; this.out.connect(send).connect(a.verb);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = P.lp * 0.4; this.lp.Q.value = 0.8;
    this.lp.connect(this.out);
    P.chord.forEach((s, i) => {
      const g = ctx.createGain(); g.gain.value = 0.0001;
      g.gain.setTargetAtTime(i === 0 ? 0.05 : 0.0001, t, 0.08);
      for (const d of [-8, 8]) {
        const o = ctx.createOscillator(); o.type = P.wave; o.frequency.value = semi(P.root, s); o.detune.value = d;
        o.connect(g); o.start(t); this.nodes.push(o);
      }
      g.connect(this.lp as BiquadFilterNode);
      this.pad.push(g);
    });
    // lows: the root two octaves down through saturation
    const so = ctx.createOscillator(); so.type = 'sine'; so.frequency.value = P.root / (P.root > 200 ? 4 : 2);
    const ws = ctx.createWaveShaper(); ws.curve = drive();
    this.sub = ctx.createGain(); this.sub.gain.value = 0.0001;
    so.connect(ws).connect(this.sub).connect(this.out); so.start(t); this.nodes.push(so);
    // wind of magic
    const n = ctx.createBufferSource(); n.buffer = a.noise; n.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 1.2;
    this.wind = ctx.createGain(); this.wind.gain.value = 0.0001;
    n.connect(this.windF).connect(this.wind).connect(this.out); n.start(t); this.nodes.push(n);
    // shimmer on top: appears at full charge
    this.shim = ctx.createGain(); this.shim.gain.value = 0.0001;
    const trem = ctx.createGain(); trem.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(trem.gain); lfo.start(t); this.nodes.push(lfo);
    for (const m of [4, 6]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = P.root * m; o.connect(trem); o.start(t); this.nodes.push(o); }
    trem.connect(this.shim).connect(this.out);
    this.nextPulse = t + 0.3;
  }

  set(k: number): void {
    const a = audioCore();
    if (!a || this.stopped || !this.lp) return;
    this.k = k;
    const { ctx } = a, t = ctx.currentTime, P = PAL[this.kind];
    this.lp.frequency.setTargetAtTime(P.lp * (0.4 + k * 1.6), t, 0.08);
    this.sub?.gain.setTargetAtTime(0.02 + Math.pow(k, 1.4) * 0.3, t, 0.1);
    this.wind?.gain.setTargetAtTime(0.01 + k * 0.07, t, 0.1);
    this.windF?.frequency.setTargetAtTime(300 + k * 2600, t, 0.1);
    // pulse like a heart: faster and stronger with charge
    if (t >= this.nextPulse) {
      boom(P.root > 200 ? 110 : 90, 45, 0.22, 0.12 + k * 0.28, 0, 0.1);
      hiss({ dur: 0.05, vol: 0.03 + k * 0.05, f: 6000, type: 'highpass', verb: 0.1 });
      this.nextPulse = t + 0.44 - k * 0.32;
    }
  }

  /** New step: a chord note enters, a ringing note above, “whump” */
  stage(n: number): void {
    if (this.stopped) return;
    this.stageN = n;
    const a = audioCore(), P = PAL[this.kind];
    const g = this.pad[Math.min(n, this.pad.length - 1)];
    if (a && g) g.gain.setTargetAtTime(0.045, a.ctx.currentTime, 0.05);
    const top = P.root < 200 ? P.root * 4 : P.root * 2;
    bell(deg(top, n * 2), 0.9, 0.09 + n * 0.015);
    boom(140, 55, 0.3, 0.2 + n * 0.05);
    hiss({ dur: 0.25, vol: 0.06, f: 2000, f1: 7000, q: 0.6, attack: 0.15, verb: 0.3 });
  }

  /** Charge complete: a fanfare chord, a scatter of bells, the shimmer stays until the cast */
  full(): void {
    if (this.stopped) return;
    const a = audioCore(), P = PAL[this.kind];
    const top = P.root < 200 ? P.root * 4 : P.root * 2;
    [0, 2, 4, 5].forEach((d, i) => bell(deg(top, d + 5), 1.3, 0.08, i * 0.05, 0.6));
    for (let i = 0; i < 8; i++) voice({ type: 'sine', f: deg(top * 2, 5 + ((Math.random() * 6) | 0)), dur: 0.2, vol: 0.025, delay: 0.2 + i * 0.05, verb: 0.6 });
    boom(100, 40, 0.6, 0.4);
    if (a) this.shim?.gain.setTargetAtTime(0.025, a.ctx.currentTime, 0.1);
  }

  stop(release = 0.08): void {
    const a = audioCore();
    if (this.stopped || !a || !this.out) { this.stopped = true; return; }
    this.stopped = true;
    const t = a.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.exponentialRampToValueAtTime(0.0001, t + release);
    for (const n of this.nodes) n.stop(t + release + 0.05);
  }

  /** How many steps are gathered (for debugging) */
  get level(): number { return this.stageN + this.k; }
}

// ---------- casts and hits ----------

let lastShard = 0, lastDrink = 0;

export type AuraSound = 'pact' | 'bastion' | 'rage' | 'clarity' | 'thorns' | 'inferno' | 'frost' | 'storm' | 'halo' | 'shade' | 'quake' | 'blades';
const AURA_ROOT: Record<AuraSound, number> = {
  pact: 220, bastion: 196, rage: 146.83, clarity: 293.66, thorns: 246.94,
  inferno: 110, frost: 329.63, storm: 164.81, halo: 261.63, shade: 185, quake: 98, blades: 277.18,
};
const AURA_CHORD: Record<AuraSound, number[]> = {
  pact: [0, 3, 7, 12], bastion: [0, 7, 12, 16], rage: [0, 7, 12, 19], clarity: [0, 4, 7, 11, 14], thorns: [0, 5, 7, 12],
  inferno: [0, 7, 12, 15, 19], frost: [0, 4, 7, 11, 16], storm: [0, 6, 7, 12], halo: [0, 4, 7, 12, 16], shade: [0, 3, 6, 10], quake: [0, 7, 12], blades: [0, 5, 9, 12, 17],
};
const SAW_AURA: AuraSound[] = ['rage', 'inferno', 'storm'];
let lastBurn = 0, lastChill = 0, lastCut = 0, lastDrainS = 0;

export const spellSfx = {
  /** Left the hand: a whoosh and the body of the element; k — charge */
  release(kind: SpellSound, k = 0) {
    hiss({ dur: 0.28, vol: 0.16 + k * 0.1, f: 500, f1: 5000, q: 0.6, attack: 0.08, verb: 0.3 });
    boom(130 + k * 30, 50, 0.3, 0.2 + k * 0.2);
    if (kind === 'heal') return;
    voice({ type: 'triangle', f: semi(PAL[kind].root < 200 ? PAL[kind].root * 4 : PAL[kind].root * 2, 7), f1: semi(PAL[kind].root, 12), dur: 0.25, vol: 0.05, verb: 0.3 });
  },

  /** Mythic spell: the world falls silent — a choir (warm voices with a slow attack) and a bell strike */
  mythic() {
    [0, 7, 12, 16, 19].forEach((s, i) => voice({ type: 'triangle', f: semi(196, s), dur: 2.6, vol: 0.05, attack: 0.4, detune: 14, lp: 2400, delay: i * 0.03, verb: 0.8 }));
    boom(70, 30, 1.6, 0.6, 0, 0.6);
    bell(semi(392, 12), 2.4, 0.08, 0.05, 0.8);
    hiss({ dur: 1.2, vol: 0.1, f: 300, f1: 5000, q: 0.5, attack: 0.6, verb: 0.6 });
  },
  /** Sparks gather in the hand: crackling and a rise */
  sparkGather() {
    for (let i = 0; i < 6; i++) hiss({ dur: 0.025, vol: 0.06, f: rnd(4000, 8000), q: 2, delay: i * 0.022, verb: 0.1 });
    voice({ type: 'triangle', f: 660, f1: 1980, dur: 0.14, vol: 0.04, verb: 0.3 });
  },
  /** Lightning strike: a click, a whipping discharge, lows, a bright chord and a long rumble */
  sparkStrike(k = 0) {
    hiss({ dur: 0.04, vol: 0.45, f: 3000, type: 'highpass', verb: 0.2 });
    hiss({ dur: 0.35, vol: 0.32 + k * 0.12, f: 3500, f1: 380, q: 0.9, verb: 0.35 });
    boom(110 - k * 30, 32, 0.7 + k * 0.3, 0.5 + k * 0.2, 0, 0.35);
    [0, 7, 12, 16].forEach((s, i) => voice({ type: 'triangle', f: semi(659.25, s), dur: 0.8 + k * 0.4, vol: 0.05, delay: 0.02 + i * 0.025, verb: 0.6 }));
    hiss({ dur: 1.8 + k, vol: 0.18 + k * 0.1, f: 260, f1: 60, q: 0.5, type: 'lowpass', attack: 0.3, delay: 0.1, verb: 0.5 });
    for (let i = 0; i < 4; i++) boom(rnd(60, 80), 35, 0.4, 0.06 + k * 0.04, 0.35 + i * 0.25 + Math.random() * 0.1, 0.4);
  },
  /** Jump to the next target: a pluck up the scale and a discharge */
  sparkChain(i = 0) {
    pluck(deg(659.25, 2 + i * 2), 0.09);
    hiss({ dur: 0.1, vol: 0.14, f: 5000, f1: 1500, q: 1, verb: 0.2 });
  },

  /** Fireball launched: “fwump” and a growl */
  fireLaunch(k = 0) {
    hiss({ dur: 0.5, vol: 0.3 + k * 0.1, f: 250, f1: 2200, q: 0.5, type: 'lowpass', attack: 0.05, verb: 0.3 });
    voice({ type: 'sawtooth', f: 110, f1: 82, dur: 0.45, vol: 0.06 + k * 0.03, detune: 12, lp: 1500, lp1: 300, verb: 0.2 });
    boom(150, 60, 0.3, 0.25 + k * 0.15);
  },
  /** Explosion: a heavy thump, crunch, roar of flame, a brass chord, crackle of embers */
  fireBoom(k = 0) {
    boom(120 - k * 40, 28, 1.1 + k * 0.4, 0.75, 0, 0.4);
    hiss({ dur: 0.12, vol: 0.4, f: 1800, q: 0.6, verb: 0.2 });
    hiss({ dur: 1.3 + k * 0.6, vol: 0.32, f: 1600, f1: 160, q: 0.4, type: 'lowpass', attack: 0.01, verb: 0.45 });
    [0, 7, 12].forEach((s) => voice({ type: 'sawtooth', f: semi(110, s), dur: 0.9 + k * 0.4, vol: 0.06, detune: 10, lp: 3200, lp1: 260, attack: 0.01, verb: 0.5 }));
    voice({ type: 'triangle', f: semi(440, 7), dur: 1, vol: 0.04, delay: 0.05, verb: 0.6 });
    for (let i = 0; i < 12; i++) hiss({ dur: 0.02, vol: 0.06, f: rnd(2500, 6000), q: 3, delay: 0.3 + Math.random() * 1.6, verb: 0.15 });
  },

  /** Ice rain gathers: a crystal arpeggio upward and a cold wind */
  iceCall() {
    [0, 2, 4, 5, 7].forEach((d, i) => bell(deg(1046.5, d), 0.9, 0.05, i * 0.07, 0.6));
    hiss({ dur: 0.6, vol: 0.12, f: 3000, f1: 9000, q: 0.8, attack: 0.35, verb: 0.5 });
    boom(150, 60, 0.6, 0.2);
  },
  /** First wave: a thump, the glassy ring of shards and a long chord of bells */
  iceImpact(k = 0) {
    boom(130 - k * 30, 34, 0.8, 0.55, 0, 0.4);
    hiss({ dur: 0.4, vol: 0.28, f: 5000, type: 'highpass', verb: 0.4 });
    for (let i = 0; i < 10; i++) voice({ type: 'triangle', f: deg(2093, (Math.random() * 8) | 0), dur: 0.15, vol: 0.035, delay: Math.random() * 0.25, verb: 0.4 });
    [0, 4, 7, 12, 16].forEach((s, i) => bell(semi(523.25, s), 2 + k, 0.05, 0.04 + i * 0.03, 0.7));
  },
  /** Icicle shattered: a pentatonic note — the rain folds into a melody */
  iceShard() {
    const n = performance.now(); if (n - lastShard < 40) return; lastShard = n;
    voice({ type: 'triangle', f: deg(1046.5, 3 + ((Math.random() * 9) | 0)), dur: 0.18, vol: 0.05, verb: 0.35 });
    hiss({ dur: 0.05, vol: 0.06, f: 7000, type: 'highpass', verb: 0.1 });
  },

  // ---------- auras (src/auras.ts) ----------
  /** Aura gauge is full: two ringing bells upward */
  auraReady() {
    bell(deg(1046.5, 3), 0.8, 0.07, 0, 0.6); bell(deg(1046.5, 5), 1.1, 0.07, 0.09, 0.6);
  },
  /** Aura equipped: a short soft “whump” and the element's note */
  auraOn(kind: AuraSound) {
    boom(120, 55, 0.4, 0.25);
    bell(AURA_ROOT[kind] * 2, 0.9, 0.06, 0.05, 0.6);
  },
  /** Aura flare: a thump, a fanfare chord of the element up through an octave, a choir bed, sparks */
  auraFlare(kind: AuraSound) {
    const r = AURA_ROOT[kind], ch = AURA_CHORD[kind];
    boom(110, 30, 1.2, 0.75, 0, 0.45);
    hiss({ dur: 0.5, vol: 0.2, f: 400, f1: 6000, q: 0.6, attack: 0.05, verb: 0.4 });
    ch.forEach((s, i) => { voice({ type: SAW_AURA.includes(kind) ? 'sawtooth' : 'triangle', f: semi(r, s), dur: 1.6, vol: 0.06, detune: 9, lp: 3500, lp1: 900, delay: i * 0.05, verb: 0.6 }); bell(semi(r * 2, s), 1.4, 0.05, 0.1 + i * 0.06, 0.7); });
    ch.forEach((s) => voice({ type: 'sine', f: semi(r, s), dur: 3, vol: 0.035, attack: 0.5, delay: 0.2, verb: 0.7 }));
    for (let i = 0; i < 12; i++) voice({ type: 'sine', f: deg(r * 4, (Math.random() * 8) | 0), dur: 0.2, vol: 0.02, delay: 0.3 + i * 0.06, verb: 0.6 });
  },
  /** Flare ended: a chord going down and fading */
  auraFade(kind: AuraSound) {
    [12, 7, 0].forEach((s, i) => bell(semi(AURA_ROOT[kind], s), 0.9, 0.045, i * 0.08, 0.6));
  },
  /** Bastion took a hit: the ring of a shield */
  bastionBlock() {
    voice({ type: 'triangle', f: 880, dur: 0.5, vol: 0.08, verb: 0.5 });
    voice({ type: 'sine', f: 1318.5, dur: 0.7, vol: 0.05, verb: 0.6 });
    hiss({ dur: 0.08, vol: 0.18, f: 3500, q: 1.2, verb: 0.3 });
    boom(160, 70, 0.2, 0.25);
  },
  /** Crown of Thorns lashed the offender */
  thornsLash() {
    hiss({ dur: 0.18, vol: 0.25, f: 2600, f1: 900, q: 1.5, verb: 0.2 });
    pluck(deg(392, 4), 0.08);
    boom(140, 60, 0.18, 0.2);
  },
  /** Crucible burns: crackle of embers and a soft “foosh” */
  auraBurn() {
    const n = performance.now(); if (n - lastBurn < 200) return; lastBurn = n;
    hiss({ dur: 0.25, vol: 0.08, f: 900, f1: 300, q: 0.5, type: 'lowpass', verb: 0.2 });
    for (let i = 0; i < 3; i++) hiss({ dur: 0.02, vol: 0.05, f: rnd(2500, 6000), q: 3, delay: Math.random() * 0.15, verb: 0.1 });
  },
  /** Deep Frost: a crystal click of rime */
  auraChill() {
    const n = performance.now(); if (n - lastChill < 200) return; lastChill = n;
    voice({ type: 'triangle', f: deg(1318.5, (Math.random() * 5) | 0), dur: 0.12, vol: 0.035, verb: 0.4 });
    hiss({ dur: 0.06, vol: 0.05, f: 7000, type: 'highpass', verb: 0.2 });
  },
  /** Storm Crown: a short whipping discharge */
  auraZap() {
    hiss({ dur: 0.03, vol: 0.3, f: 3000, type: 'highpass', verb: 0.2 });
    hiss({ dur: 0.22, vol: 0.2, f: 3500, f1: 500, q: 0.9, verb: 0.3 });
    boom(120, 45, 0.35, 0.25, 0, 0.3);
    pluck(deg(659.25, (Math.random() * 5) | 0), 0.06);
  },
  /** Punishing Halo: a beam from the sky — a bell and radiance */
  auraBeam() {
    bell(deg(1046.5, (Math.random() * 5) | 0), 0.9, 0.06, 0, 0.6);
    hiss({ dur: 0.3, vol: 0.12, f: 6000, f1: 1500, q: 0.7, verb: 0.4 });
    boom(150, 60, 0.25, 0.2);
  },
  /** Hungry Shadow drinks: a low inhale going down */
  auraDrain() {
    const n = performance.now(); if (n - lastDrainS < 250) return; lastDrainS = n;
    voice({ type: 'sine', f: 370, f1: 185, dur: 0.3, vol: 0.06, verb: 0.5 });
    voice({ type: 'triangle', f: deg(277.18, (Math.random() * 4) | 0), dur: 0.35, vol: 0.03, delay: 0.08, verb: 0.6 });
  },
  /** Stone Stride: a dull thump of earth and the rattle of pebbles; big — during the flare */
  auraStomp(big = false) {
    boom(90, 30, 0.6, big ? 0.65 : 0.45, 0, 0.3);
    hiss({ dur: 0.35, vol: 0.14, f: 700, f1: 150, q: 0.5, type: 'lowpass', verb: 0.2 });
    for (let i = 0; i < 5; i++) hiss({ dur: 0.03, vol: 0.06, f: rnd(1500, 3500), q: 2, delay: 0.08 + Math.random() * 0.3, verb: 0.1 });
  },
  /** Blade Whirl struck: a whoosh and the blade's note — together they fold into a melody */
  bladeCut() {
    const n = performance.now(); if (n - lastCut < 70) return; lastCut = n;
    hiss({ dur: 0.1, vol: 0.12, f: 5000, f1: 2000, q: 1.5, verb: 0.2 });
    voice({ type: 'triangle', f: deg(1108.7, (Math.random() * 7) | 0), dur: 0.2, vol: 0.035, verb: 0.4 });
  },

  /** Blood Pact: a soft “gulp” of life */
  pactDrink() {
    const n = performance.now(); if (n - lastDrink < 120) return; lastDrink = n;
    voice({ type: 'sine', f: 220, f1: 440, dur: 0.14, vol: 0.07, verb: 0.3 });
    voice({ type: 'triangle', f: deg(523.25, (Math.random() * 5) | 0), dur: 0.3, vol: 0.035, delay: 0.06, verb: 0.5 });
  },

  /** Healing: a soft thump, a harp up through two octaves, a warm chord, sparks */
  healCast(k = 0) {
    boom(120, 55, 0.5, 0.3);
    [0, 4, 7, 11, 14, 16, 19, 24].forEach((s, i) => pluck(semi(261.63, s), 0.07, i * 0.045, 1.1));
    [0, 4, 7, 11].forEach((s) => voice({ type: 'sine', f: semi(261.63, s), dur: 2 + k, vol: 0.04, attack: 0.3, delay: 0.15, verb: 0.6 }));
    for (let i = 0; i < 10; i++) voice({ type: 'sine', f: deg(2093, (Math.random() * 7) | 0), dur: 0.25, vol: 0.022, delay: 0.4 + i * 0.07, verb: 0.6 });
    hiss({ dur: 0.9, vol: 0.06, f: 4000, q: 0.7, attack: 0.25, verb: 0.4 });
  },
};
