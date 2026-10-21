let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
const VOL = 0.4;

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
    master.gain.value = muted ? 0 : VOL;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}
export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : VOL;
  return muted;
}

interface ToneOptions { type?: OscillatorType; f0?: number; f1?: number; dur?: number; vol?: number; delay?: number }
interface NoiseOptions { dur?: number; vol?: number; freq?: number; q?: number; delay?: number }

function tone({ type = 'square', f0 = 440, f1, dur = 0.1, vol = 0.3, delay = 0 }: ToneOptions): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise({ dur = 0.1, vol = 0.3, freq = 1200, q = 1, delay = 0 }: NoiseOptions): void {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}

let lastChew = 0;
export const sfx = {
  hit() { noise({ dur: 0.07, vol: 0.25, freq: 900 }); tone({ type: 'triangle', f0: 200, f1: 90, dur: 0.08, vol: 0.18 }); },
  // ---------- стрельба ----------
  /** Свист рикошета */
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
  // ---------- реальные стволы (этап 0) ----------
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
  // ---------- тюремщики ----------
  flame() { noise({ dur: 0.08, vol: 0.09, freq: 420, q: 0.5 }); },
  blast() { tone({ type: 'sine', f0: 90, f1: 25, dur: 0.8, vol: 0.55 }); noise({ dur: 0.8, vol: 0.5, freq: 220, q: 0.4 }); noise({ dur: 0.25, vol: 0.25, freq: 1600, q: 0.5 }); },
  shout() { tone({ type: 'sawtooth', f0: 180, f1: 140, dur: 0.18, vol: 0.06 }); tone({ type: 'sawtooth', f0: 210, f1: 160, dur: 0.18, vol: 0.05, delay: 0.2 }); },
  // ---------- арахниды ----------
  screech() { tone({ type: 'sawtooth', f0: 900, f1: 1700, dur: 0.25, vol: 0.07 }); tone({ type: 'square', f0: 1300, f1: 600, dur: 0.3, vol: 0.05, delay: 0.08 }); noise({ dur: 0.3, vol: 0.12, freq: 3200, q: 2 }); },
  leap() { noise({ dur: 0.1, vol: 0.12, freq: 1400, q: 0.8 }); tone({ type: 'triangle', f0: 300, f1: 520, dur: 0.08, vol: 0.05 }); },
  land() { noise({ dur: 0.06, vol: 0.1, freq: 600, q: 1 }); },
  slash() { noise({ dur: 0.12, vol: 0.2, freq: 2800, q: 0.9 }); tone({ type: 'sawtooth', f0: 500, f1: 180, dur: 0.12, vol: 0.06 }); },
  web() { noise({ dur: 0.18, vol: 0.14, freq: 1100, q: 3 }); tone({ type: 'sine', f0: 240, f1: 500, dur: 0.14, vol: 0.06 }); },
  webHit() { noise({ dur: 0.2, vol: 0.18, freq: 800, q: 2 }); tone({ type: 'sine', f0: 200, f1: 120, dur: 0.2, vol: 0.08 }); },
  hurt() { tone({ type: 'square', f0: 160, f1: 90, dur: 0.12, vol: 0.12 }); },

  /** Взмах: pitch — высота свиста, heavy — тяжёлое оружие */
  swing(pitch = 1, heavy = false) {
    noise({ dur: heavy ? 0.22 : 0.13, vol: heavy ? 0.22 : 0.16, freq: 2600 * pitch, q: 0.7 });
    if (heavy) tone({ type: 'sine', f0: 140 * pitch, f1: 60, dur: 0.2, vol: 0.12 });
  },
  /** Звон клинка — при доставании оружия */
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
};
