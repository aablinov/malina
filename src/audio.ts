let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
/** Echo input: a short decaying delay — the magic "chime" of treasures */
let echo: GainNode | null = null;
/** Bus of ordinary sounds: duck mutes it before a spell impact; spells (fg) bypass it */
let bus: GainNode | null = null;
/** Reverb input */
let verb: GainNode | null = null;
let muted = false;
const VOL = 0.4;
/** Master volume from the settings 0..1 (src/menu/settings.ts) */
let volume = 1;

declare global {
  interface Window { webkitAudioContext?: typeof AudioContext }
}

export function initAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOL * volume;
    // compressor: loud spell impacts are denser and do not rasp on overload
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    master.connect(comp).connect(ctx.destination);
    // reverb (the impulse is decaying noise, generated in code): spells sound as in a big hall
    verb = ctx.createGain();
    const conv = ctx.createConvolver(), vlp = ctx.createBiquadFilter(), vout = ctx.createGain();
    const len = Math.round(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4); }
    conv.buffer = ir; vlp.type = 'lowpass'; vlp.frequency.value = 5200; vout.gain.value = 0.7;
    verb.connect(vlp).connect(conv).connect(vout).connect(master);
    bus = ctx.createGain();
    bus.connect(master);
    echo = ctx.createGain();
    const delay = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), wet = ctx.createGain();
    delay.delayTime.value = 0.14; fb.gain.value = 0.38; lp.type = 'lowpass'; lp.frequency.value = 4200; wet.gain.value = 0.55;
    echo.connect(delay).connect(lp).connect(fb).connect(delay);
    lp.connect(wet).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}
/**
 * Voice budget (wiki/dev-performance.md): a spell volley and the grimoire choir used to spin up a hundred audio nodes per frame.
 * Each voice takes a ticket for its duration before being created; when MAX_VOICES sound at once, new ones
 * are silently skipped. busy() — the fraction of the budget in use: batched sounds use it to cut duplicates and sparkles first
 */
const MAX_VOICES = 32;
const ends: number[] = [];
function prune(): void {
  const now = ctx ? ctx.currentTime : 0;
  for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= now) { ends[i] = ends[ends.length - 1]; ends.pop(); }
}
/** Take a ticket for a voice of duration dur (with delay); false — the budget is spent, skip the sound */
export function claimVoice(dur: number, delay = 0): boolean {
  if (!ctx) return false;
  prune();
  if (ends.length >= MAX_VOICES) return false;
  ends.push(ctx.currentTime + delay + dur + 0.05);
  return true;
}
/** Fraction of the voice budget in use 0..1 */
export function busy(): number { prune(); return ends.length / MAX_VOICES; }

export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : VOL * volume;
  return muted;
}

/** Master volume 0..1 — from the settings */
export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = muted ? 0 : VOL * volume;
}

interface ToneOptions { type?: OscillatorType; f0?: number; f1?: number; dur?: number; vol?: number; delay?: number; echo?: boolean; fg?: boolean; attack?: number }
interface NoiseOptions { dur?: number; vol?: number; freq?: number; f1?: number; q?: number; delay?: number; fg?: boolean; attack?: number; type?: BiquadFilterType; echo?: boolean }

/** Where the sound goes: spells — straight to master, the rest — through the duckable bus */
const out = (fg?: boolean): AudioNode => (fg ? master : bus ?? master) as AudioNode;

function tone({ type = 'square', f0 = 440, f1, dur = 0.1, vol = 0.3, delay = 0, echo: wet = false, fg, attack = 0.008 }: ToneOptions): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
  o.connect(g).connect(out(fg));
  if (wet && echo) g.connect(echo);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise({ dur = 0.1, vol = 0.3, freq = 1200, f1, q = 1, delay = 0, fg, attack = 0, type = 'bandpass', echo: wet = false }: NoiseOptions): void {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = dur > 0.45;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  if (attack > 0) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); } else g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
  s.connect(f).connect(g).connect(out(fg));
  if (wet && echo) g.connect(echo);
  s.start(t); s.stop(t + dur + 0.02);
}

/** "Silence before the strike": mute ordinary sounds for hold seconds (spells bypass the bus) */
export function duck(depth = 0.2, hold = 0.25, release = 0.5): void {
  if (!ctx || !bus) return;
  const t = ctx.currentTime, g = bus.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(depth, t + 0.04);
  g.setValueAtTime(depth, t + 0.04 + hold);
  g.linearRampToValueAtTime(1, t + 0.04 + hold + release);
}

/** Audio nodes for spells (src/spell-audio.ts): null until the sound is enabled */
export function audioCore(): { ctx: AudioContext; out: AudioNode; verb: AudioNode; noise: AudioBuffer } | null {
  return ctx && master && verb && noiseBuf ? { ctx, out: master, verb, noise: noiseBuf } : null;
}

let lastChew = 0, lastLand = 0;
/** Pentatonic from C5: whatever you play in a row sounds cheerful */
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093, 2349.32, 2637.02];
const note = (i: number): number => PENTA[Math.max(0, Math.min(PENTA.length - 1, i))];
export const sfx = {
  hit() { noise({ dur: 0.07, vol: 0.25, freq: 900 }); tone({ type: 'triangle', f0: 200, f1: 90, dur: 0.08, vol: 0.18 }); },
  // ---------- shooting ----------
  /** Ricochet whistle */
  ricochet() { tone({ type: 'sine', f0: 2600 + Math.random() * 800, f1: 900, dur: 0.28, vol: 0.06 }); noise({ dur: 0.04, vol: 0.12, freq: 4000, q: 1 }); },
  rifle() { noise({ dur: 0.09, vol: 0.28, freq: 1400, q: 0.6 }); tone({ type: 'square', f0: 220, f1: 70, dur: 0.08, vol: 0.12 }); },
  uzi() { noise({ dur: 0.05, vol: 0.18, freq: 2200, q: 0.8 }); tone({ type: 'square', f0: 340, f1: 120, dur: 0.04, vol: 0.06 }); },
  shotgun() { noise({ dur: 0.28, vol: 0.45, freq: 700, q: 0.4 }); tone({ type: 'sine', f0: 120, f1: 40, dur: 0.25, vol: 0.35 }); noise({ dur: 0.08, vol: 0.12, freq: 3000, q: 1, delay: 0.28 }); },
  super() { noise({ dur: 0.4, vol: 0.55, freq: 500, q: 0.4 }); tone({ type: 'sine', f0: 90, f1: 30, dur: 0.4, vol: 0.45 }); tone({ type: 'sawtooth', f0: 160, f1: 50, dur: 0.15, vol: 0.12 }); },
  chaingun() { noise({ dur: 0.05, vol: 0.2, freq: 1700, q: 0.7 }); tone({ type: 'square', f0: 180, f1: 80, dur: 0.04, vol: 0.07 }); },
  plasma() { tone({ type: 'sawtooth', f0: 1400, f1: 500, dur: 0.07, vol: 0.06 }); tone({ type: 'sine', f0: 2200, f1: 900, dur: 0.06, vol: 0.05 }); },
  launcher() { tone({ type: 'sine', f0: 160, f1: 70, dur: 0.18, vol: 0.3 }); noise({ dur: 0.12, vol: 0.18, freq: 500, q: 0.6 }); },
  bfg() { tone({ type: 'sawtooth', f0: 80, f1: 600, dur: 0.5, vol: 0.12 }); tone({ type: 'sine', f0: 200, f1: 50, dur: 0.6, vol: 0.4, delay: 0.1 }); noise({ dur: 0.5, vol: 0.25, freq: 400, q: 0.5, delay: 0.1 }); },
  explosion() { tone({ type: 'sine', f0: 100, f1: 28, dur: 0.6, vol: 0.5 }); noise({ dur: 0.6, vol: 0.45, freq: 260, q: 0.4 }); noise({ dur: 0.2, vol: 0.2, freq: 1800, q: 0.5 }); },
  missile() { noise({ dur: 0.2, vol: 0.1, freq: 2500, q: 0.8 }); tone({ type: 'sawtooth', f0: 500, f1: 900, dur: 0.15, vol: 0.04 }); },
  hook() { tone({ type: 'square', f0: 900, f1: 300, dur: 0.15, vol: 0.06 }); noise({ dur: 0.3, vol: 0.12, freq: 4000, q: 3 }); },
  spit() { noise({ dur: 0.12, vol: 0.12, freq: 900, q: 2 }); tone({ type: 'sine', f0: 300, f1: 600, dur: 0.1, vol: 0.06 }); },
  splat() { noise({ dur: 0.1, vol: 0.08, freq: 600, q: 1 }); },
  pickup() { tone({ type: 'triangle', f0: 880, dur: 0.06, vol: 0.07 }); tone({ type: 'triangle', f0: 1320, dur: 0.08, vol: 0.07, delay: 0.05 }); },
  heat() { tone({ type: 'sawtooth', f0: 200, f1: 1200, dur: 0.3, vol: 0.1 }); noise({ dur: 0.4, vol: 0.3, freq: 1000, q: 0.5 }); },
  spinup() { tone({ type: 'sawtooth', f0: 80, f1: 400, dur: 0.5, vol: 0.06 }); },
  zap() { noise({ dur: 0.06, vol: 0.1, freq: 5000, q: 1 }); tone({ type: 'square', f0: 1600, f1: 400, dur: 0.05, vol: 0.04 }); },
  // ---------- real guns (stage 0) ----------
  pm() { noise({ dur: 0.07, vol: 0.26, freq: 1900, q: 0.7 }); tone({ type: 'square', f0: 260, f1: 90, dur: 0.06, vol: 0.1 }); },
  ak() { noise({ dur: 0.11, vol: 0.32, freq: 1100, q: 0.5 }); tone({ type: 'square', f0: 170, f1: 55, dur: 0.09, vol: 0.14 }); noise({ dur: 0.05, vol: 0.06, freq: 4200, q: 1, delay: 0.03 }); },
  ar() { noise({ dur: 0.09, vol: 0.28, freq: 1500, q: 0.6 }); tone({ type: 'square', f0: 210, f1: 70, dur: 0.07, vol: 0.12 }); },
  dbl() { noise({ dur: 0.3, vol: 0.5, freq: 650, q: 0.4 }); tone({ type: 'sine', f0: 110, f1: 38, dur: 0.28, vol: 0.38 }); },
  dblBoth() { noise({ dur: 0.42, vol: 0.62, freq: 520, q: 0.4 }); tone({ type: 'sine', f0: 90, f1: 30, dur: 0.4, vol: 0.5 }); tone({ type: 'sawtooth', f0: 150, f1: 45, dur: 0.14, vol: 0.12 }); },
  dry() { tone({ type: 'square', f0: 1800, dur: 0.02, vol: 0.06 }); noise({ dur: 0.02, vol: 0.06, freq: 5000, q: 2 }); },
  magOut() { noise({ dur: 0.05, vol: 0.12, freq: 2400, q: 2 }); tone({ type: 'triangle', f0: 700, f1: 500, dur: 0.05, vol: 0.05 }); },
  magIn() { noise({ dur: 0.04, vol: 0.18, freq: 1600, q: 1.5 }); tone({ type: 'square', f0: 420, dur: 0.03, vol: 0.06, delay: 0.02 }); },
  rack() { noise({ dur: 0.05, vol: 0.16, freq: 2800, q: 1.5 }); noise({ dur: 0.05, vol: 0.2, freq: 1800, q: 1.5, delay: 0.09 }); tone({ type: 'square', f0: 600, dur: 0.03, vol: 0.05, delay: 0.09 }); },
  breakOpen() { noise({ dur: 0.08, vol: 0.18, freq: 1300, q: 1.2 }); tone({ type: 'triangle', f0: 380, f1: 300, dur: 0.08, vol: 0.06 }); },
  breakClose() { noise({ dur: 0.05, vol: 0.24, freq: 1500, q: 1.4 }); tone({ type: 'square', f0: 300, dur: 0.04, vol: 0.08 }); },
  shellsIn() { noise({ dur: 0.04, vol: 0.12, freq: 900, q: 1.5 }); noise({ dur: 0.04, vol: 0.12, freq: 950, q: 1.5, delay: 0.12 }); },
  roll() { noise({ dur: 0.2, vol: 0.14, freq: 700, q: 0.6 }); },
  step() { noise({ dur: 0.04, vol: 0.035, freq: 500, q: 0.8 }); },
  // ---------- jailers ----------
  flame() { noise({ dur: 0.08, vol: 0.09, freq: 420, q: 0.5 }); },
  blast() { tone({ type: 'sine', f0: 90, f1: 25, dur: 0.8, vol: 0.55 }); noise({ dur: 0.8, vol: 0.5, freq: 220, q: 0.4 }); noise({ dur: 0.25, vol: 0.25, freq: 1600, q: 0.5 }); },
  shout() { tone({ type: 'sawtooth', f0: 180, f1: 140, dur: 0.18, vol: 0.06 }); tone({ type: 'sawtooth', f0: 210, f1: 160, dur: 0.18, vol: 0.05, delay: 0.2 }); },
  // ---------- arachnids ----------
  screech() { tone({ type: 'sawtooth', f0: 900, f1: 1700, dur: 0.25, vol: 0.07 }); tone({ type: 'square', f0: 1300, f1: 600, dur: 0.3, vol: 0.05, delay: 0.08 }); noise({ dur: 0.3, vol: 0.12, freq: 3200, q: 2 }); },
  leap() { noise({ dur: 0.1, vol: 0.12, freq: 1400, q: 0.8 }); tone({ type: 'triangle', f0: 300, f1: 520, dur: 0.08, vol: 0.05 }); },
  land() { noise({ dur: 0.06, vol: 0.1, freq: 600, q: 1 }); },
  slash() { noise({ dur: 0.12, vol: 0.2, freq: 2800, q: 0.9 }); tone({ type: 'sawtooth', f0: 500, f1: 180, dur: 0.12, vol: 0.06 }); },
  web() { noise({ dur: 0.18, vol: 0.14, freq: 1100, q: 3 }); tone({ type: 'sine', f0: 240, f1: 500, dur: 0.14, vol: 0.06 }); },
  webHit() { noise({ dur: 0.2, vol: 0.18, freq: 800, q: 2 }); tone({ type: 'sine', f0: 200, f1: 120, dur: 0.2, vol: 0.08 }); },
  hurt() { tone({ type: 'square', f0: 160, f1: 90, dur: 0.12, vol: 0.12 }); },

  /** Swing: pitch — whistle pitch, heavy — a heavy weapon */
  swing(pitch = 1, heavy = false) {
    noise({ dur: heavy ? 0.22 : 0.13, vol: heavy ? 0.22 : 0.16, freq: 2600 * pitch, q: 0.7 });
    if (heavy) tone({ type: 'sine', f0: 140 * pitch, f1: 60, dur: 0.2, vol: 0.12 });
  },
  /** Blade chime — when drawing the weapon */
  draw(pitch = 1) {
    tone({ type: 'triangle', f0: 1400 * pitch, f1: 2200 * pitch, dur: 0.18, vol: 0.06 });
    tone({ type: 'sine', f0: 2800 * pitch, dur: 0.3, vol: 0.03, delay: 0.05 });
    noise({ dur: 0.12, vol: 0.06, freq: 5000, q: 2 });
  },
  shing() { tone({ type: 'sawtooth', f0: 2400, f1: 900, dur: 0.25, vol: 0.06 }); noise({ dur: 0.2, vol: 0.15, freq: 6000, q: 1 }); },
  quake() { tone({ type: 'sine', f0: 70, f1: 30, dur: 0.5, vol: 0.45 }); noise({ dur: 0.45, vol: 0.3, freq: 180, q: 0.5 }); },
  beam() { tone({ type: 'sine', f0: 440, f1: 880, dur: 1.0, vol: 0.08 }); tone({ type: 'sine', f0: 660, f1: 1320, dur: 1.0, vol: 0.05, delay: 0.1 }); },
  dash() { noise({ dur: 0.12, vol: 0.2, freq: 1800, q: 0.6 }); tone({ type: 'square', f0: 600, f1: 1200, dur: 0.08, vol: 0.04 }); },
  freeze() { [1800, 2400, 3000].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.15, vol: 0.05, delay: i * 0.04 })); noise({ dur: 0.3, vol: 0.12, freq: 7000, q: 2 }); },
  void() { tone({ type: 'sawtooth', f0: 90, f1: 45, dur: 1.1, vol: 0.08 }); tone({ type: 'sine', f0: 200, f1: 60, dur: 1.1, vol: 0.06 }); },
  kill() { tone({ type: 'square', f0: 300, f1: 900, dur: 0.12, vol: 0.1 }); noise({ dur: 0.18, vol: 0.2, freq: 600 }); },
  harvest() { [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.14, vol: 0.16, delay: i * 0.06 })); },
  plant() { tone({ type: 'sine', f0: 260, f1: 520, dur: 0.18, vol: 0.22 }); noise({ dur: 0.12, vol: 0.12, freq: 500 }); },
  ready() { tone({ type: 'sine', f0: 1320, dur: 0.12, vol: 0.06 }); tone({ type: 'sine', f0: 1760, dur: 0.14, vol: 0.05, delay: 0.07 }); },
  wave() { tone({ type: 'sawtooth', f0: 110, f1: 82, dur: 0.9, vol: 0.12 }); tone({ type: 'sawtooth', f0: 165, f1: 123, dur: 0.9, vol: 0.08 }); },
  chew() { const n = performance.now(); if (n - lastChew < 140) return; lastChew = n; noise({ dur: 0.05, vol: 0.05, freq: 3500 }); },
  bushDead() { tone({ type: 'sawtooth', f0: 300, f1: 60, dur: 0.5, vol: 0.12 }); noise({ dur: 0.3, vol: 0.2, freq: 400 }); },
  burst() { tone({ type: 'sine', f0: 90, f1: 40, dur: 0.4, vol: 0.4 }); noise({ dur: 0.35, vol: 0.3, freq: 300, q: 0.5 }); },
  empty() { tone({ type: 'square', f0: 140, dur: 0.07, vol: 0.08 }); },

  // ---------- treasures ----------
  /** Walked up to a chest: a quiet chime */
  twinkle() { [7, 9, 11].forEach((n, i) => tone({ type: 'sine', f0: note(n), dur: 0.3, vol: 0.035, delay: i * 0.07, echo: true })); },
  /** The chest charges up: a rising hum and the quickening rattle of the lid */
  chestCharge(dur = 0.6) {
    tone({ type: 'sine', f0: 180, f1: 900, dur, vol: 0.1 });
    tone({ type: 'triangle', f0: 270, f1: 1350, dur, vol: 0.05 });
    noise({ dur, vol: 0.05, freq: 6000, q: 0.7 });
    for (let t = 0, gap = 0.12; t < dur; t += gap, gap = Math.max(0.03, gap * 0.78)) {
      noise({ dur: 0.035, vol: 0.14, freq: 700 + t * 1600, q: 2, delay: t });
      tone({ type: 'triangle', f0: 200 + t * 600, dur: 0.03, vol: 0.05, delay: t });
    }
  },
  /** The chest flew open: a thump, a whirl, an arpeggio fanfare, a chord and a scatter of bells */
  chestOpen() {
    tone({ type: 'sine', f0: 160, f1: 45, dur: 0.55, vol: 0.45 });
    noise({ dur: 0.35, vol: 0.3, freq: 600, q: 0.5 });
    noise({ dur: 0.7, vol: 0.12, freq: 3500, q: 0.6, delay: 0.03 });
    [0, 2, 3, 5, 7, 8].forEach((n, i) => {
      tone({ type: 'triangle', f0: note(n), dur: 0.4, vol: 0.13, delay: 0.05 + i * 0.065, echo: true });
      tone({ type: 'square', f0: note(n), dur: 0.08, vol: 0.025, delay: 0.05 + i * 0.065 });
    });
    for (const n of [5, 7, 8]) tone({ type: 'sine', f0: note(n), dur: 1.4, vol: 0.06, delay: 0.45, echo: true });
    for (let i = 0; i < 12; i++) tone({ type: 'sine', f0: note(7 + ((Math.random() * 6) | 0)) * 2, dur: 0.16, vol: 0.022, delay: 0.5 + i * 0.055 + Math.random() * 0.03, echo: true });
  },
  /** An item flew out of the chest: an upward "plop", each next one higher */
  lootPop(i = 0) {
    const f = note(i);
    tone({ type: 'sine', f0: f * 0.5, f1: f * 1.2, dur: 0.1, vol: 0.13 });
    tone({ type: 'triangle', f0: f, dur: 0.14, vol: 0.05, delay: 0.04, echo: true });
  },
  /** Loot hit the ground */
  lootLand() {
    const n = performance.now(); if (n - lastLand < 60) return; lastLand = n;
    tone({ type: 'triangle', f0: 1600 + Math.random() * 500, dur: 0.05, vol: 0.035 });
    noise({ dur: 0.03, vol: 0.05, freq: 2500, q: 2 });
  },
  /** A trophy landed on the ground: a long magic chime — the rarer the item, the higher and richer */
  itemLand(rarity = 0) {
    const f = note(5 + rarity * 2);
    tone({ type: 'sine', f0: f, dur: 1.3, vol: 0.09, echo: true });
    tone({ type: 'sine', f0: f * 1.5, dur: 1.0, vol: 0.05, delay: 0.09, echo: true });
    tone({ type: 'sine', f0: f * 2.01, dur: 0.8, vol: 0.035, delay: 0.18, echo: true });
    if (rarity === 2) for (let i = 0; i < 6; i++) tone({ type: 'triangle', f0: note(8 + i), dur: 0.2, vol: 0.03, delay: 0.3 + i * 0.06, echo: true });
  },
  /** A raspberry picked up: a juicy pop and a bell; a streak climbs the scale */
  berry(combo = 0) {
    const f = note(combo + 2);
    noise({ dur: 0.06, vol: 0.14, freq: 650, q: 1.5 });
    tone({ type: 'sine', f0: 240, f1: 680, dur: 0.09, vol: 0.2 });
    tone({ type: 'triangle', f0: f, dur: 0.22, vol: 0.1, delay: 0.05, echo: true });
    tone({ type: 'sine', f0: f * 2, dur: 0.16, vol: 0.035, delay: 0.1, echo: true });
  },
  /** A trophy picked up: a fanfare, longer for rare ones */
  treasure(rarity = 0) {
    const run = [[0, 2, 4], [0, 2, 4, 5], [0, 2, 4, 5, 7, 9]][rarity] ?? [0, 2, 4];
    run.forEach((n, i) => {
      tone({ type: 'square', f0: note(n), dur: 0.12, vol: 0.035, delay: i * 0.075 });
      tone({ type: 'triangle', f0: note(n), dur: 0.3, vol: 0.11, delay: i * 0.075, echo: true });
    });
    const end = run.length * 0.075;
    for (const n of [5, 7]) tone({ type: 'sine', f0: note(n + rarity * 2), dur: 1, vol: 0.06, delay: end, echo: true });
    noise({ dur: 0.6, vol: 0.05, freq: 7000, q: 1, delay: end });
  },
  /** A wooden crate flew apart */
  crateBreak() {
    noise({ dur: 0.2, vol: 0.35, freq: 550, q: 0.7 });
    noise({ dur: 0.06, vol: 0.22, freq: 1700, q: 1.5, delay: 0.03 });
    noise({ dur: 0.05, vol: 0.16, freq: 1200, q: 1.5, delay: 0.1 });
    tone({ type: 'triangle', f0: 190, f1: 90, dur: 0.12, vol: 0.15 });
  },
};
