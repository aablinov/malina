import { bell, boom, deg, hiss, pluck, voice } from './spell-audio.ts';
import type { WeaponCategory } from './weapons.ts';

/**
 * Звук оружия (wiki/design-weapon-arts.md, раздел 6): у каждого вида — свой свист взмаха, свой звук попадания и свои
 * звуки спец-удара по ходу удара. Строится из тех же кирпичей, что и звук заклинаний (src/spell-audio.ts): шум через
 * фильтр — свист и треск, синус через насыщение — удар в низ, колокольчики — звон стали и магии.
 * Тяжёлое оружие гудит низко и долго, лёгкое свистит высоко и коротко, клинки звенят, кулаки и булава — глухо бьют.
 */

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Свист рассекаемого воздуха: f — высота, dur — длина, sweep — куда уходит высота */
function whoosh(f: number, dur: number, vol: number, delay = 0, sweep = 0.55): void {
  hiss({ dur, vol, f: f * rnd(0.92, 1.08), f1: f * sweep, q: 0.9, attack: dur * 0.35, delay, verb: 0.1 });
}
/** Звон стали: короткий щелчок и колокольчик */
function clang(f: number, vol: number, delay = 0): void {
  hiss({ dur: 0.05, vol: vol * 1.4, f: 4200, q: 1.2, delay, verb: 0.1 });
  bell(f * rnd(0.97, 1.03), 0.35, vol * 0.5, delay, 0.25);
}
/** Глухой удар: низ и хруст */
function thud(f: number, vol: number, delay = 0): void {
  boom(f, f * 0.45, 0.22, vol, delay, 0.15);
  hiss({ dur: 0.09, vol: vol * 0.7, f: 500, q: 0.7, delay, verb: 0.05 });
}
/** Разрез: шипящий высокий срез */
function slice(vol: number, delay = 0, f = 5200): void {
  hiss({ dur: 0.1, vol, f, f1: f * 0.5, q: 1.4, delay, verb: 0.15 });
}
/** Треск пламени */
function crackle(vol: number, delay = 0, n = 4): void {
  for (let i = 0; i < n; i++) hiss({ dur: 0.04, vol: vol * rnd(0.6, 1), f: rnd(1800, 3600), q: 3, delay: delay + i * rnd(0.02, 0.05), verb: 0.05 });
  hiss({ dur: 0.3, vol: vol * 0.6, f: 700, q: 0.6, delay, verb: 0.15 });
}
/** Магическое переливание пентатоникой: root — корень, n нот вверх */
function chime(root: number, n: number, vol: number, delay = 0, step = 0.05): void {
  for (let i = 0; i < n; i++) bell(deg(root, i * 2), 0.5, vol, delay + i * step, 0.5);
}

// ---------- взмах и попадание ----------

interface WeaponVoice {
  /** Взмах шага комбо (0, 1, 2 — добивающий) */
  swing(step: number): void;
  /** Попадание: finisher — добивающий */
  hit(finisher: boolean): void;
}

const blade = (f: number, ring: number, len = 0.13): WeaponVoice => ({
  swing: (s) => whoosh(f * (s === 1 ? 1.12 : s === 2 ? 0.8 : 1), s === 2 ? len * 1.6 : len, s === 2 ? 0.2 : 0.15),
  hit: (fin) => { slice(fin ? 0.16 : 0.12); clang(ring, fin ? 0.1 : 0.07); if (fin) thud(90, 0.3); },
});
const heavy = (f: number, low: number, len: number): WeaponVoice => ({
  swing: (s) => { whoosh(f * (s === 2 ? 0.75 : 1), len * (s === 2 ? 1.4 : 1), 0.2, 0, 0.45); boom(low * 1.6, low, len, 0.12, len * 0.3, 0.1); },
  hit: (fin) => { thud(fin ? low : low * 1.4, fin ? 0.5 : 0.35); hiss({ dur: 0.16, vol: 0.16, f: 300, q: 0.5, verb: 0.15 }); },
});

const VOICES: Record<WeaponCategory, WeaponVoice> = {
  'меч': blade(2600, 1760),
  'катана': {
    // тонкий быстрый свист и чистый высокий звон
    swing: (s) => { whoosh(s === 2 ? 2800 : 3600, s === 2 ? 0.2 : 0.11, 0.16, 0, 0.4); if (s === 0) hiss({ dur: 0.14, vol: 0.05, f: 6500, f1: 3000, q: 2 }); },
    hit: (fin) => { slice(fin ? 0.2 : 0.15, 0, 6500); bell(2349, 0.5, fin ? 0.07 : 0.05, 0.01, 0.35); },
  },
  'кинжал': {
    swing: (s) => whoosh(s === 2 ? 3200 : 4200, s === 2 ? 0.1 : 0.07, 0.12),
    hit: (fin) => { slice(0.11, 0, 6000); if (fin) clang(2093, 0.06); },
  },
  'рапира': {
    // «фьють»: свист вверх, укол — звонкий щелчок
    swing: (s) => hiss({ dur: s === 2 ? 0.14 : 0.08, vol: 0.13, f: 2200, f1: 4800, q: 1.2, attack: 0.02, verb: 0.05 }),
    hit: (fin) => { hiss({ dur: 0.03, vol: 0.18, f: 5200, q: 2 }); bell(fin ? 2637 : 3136, 0.3, 0.05, 0, 0.3); },
  },
  'копьё': {
    swing: (s) => hiss({ dur: s === 2 ? 0.22 : 0.14, vol: 0.16, f: 1500, f1: 3200, q: 0.9, attack: 0.04, verb: 0.08 }),
    hit: (fin) => { hiss({ dur: 0.05, vol: 0.2, f: 3000, q: 1.4 }); thud(fin ? 120 : 160, fin ? 0.3 : 0.18); },
  },
  'топор': heavy(1500, 90, 0.2),
  'булава': heavy(1300, 80, 0.2),
  'молот': heavy(900, 60, 0.28),
  'великий меч': {
    // гул железа: свист низкий и долгий, удар — тяжёлый звон и низ
    swing: (s) => { whoosh(s === 2 ? 600 : 800, s === 2 ? 0.45 : 0.34, 0.24, 0, 0.4); boom(70, 40, 0.4, 0.14, 0.1, 0.1); },
    hit: (fin) => { thud(fin ? 55 : 70, fin ? 0.6 : 0.45); clang(440, 0.08); hiss({ dur: 0.25, vol: 0.2, f: 260, q: 0.5, verb: 0.2 }); },
  },
  'алебарда': {
    swing: (s) => { whoosh(1700 * (s === 1 ? 1.1 : 1), s === 2 ? 0.3 : 0.22, 0.18, 0, 0.5); },
    hit: (fin) => { slice(0.12, 0, 4000); thud(fin ? 90 : 120, fin ? 0.35 : 0.22); },
  },
  'коса': {
    // жуткий свист: стеклянная нота скользит вниз
    swing: (s) => { whoosh(2200, s === 2 ? 0.3 : 0.18, 0.13); voice({ type: 'sine', f: s === 2 ? 880 : 1046, f1: 620, dur: 0.35, vol: 0.04, verb: 0.6, attack: 0.03 }); },
    hit: (fin) => { slice(0.12, 0, 4500); if (fin) bell(311, 0.8, 0.07, 0, 0.7); },
  },
  'посох': {
    swing: (s) => { whoosh(1800, 0.16, 0.12); pluck(deg(523.25, s * 2 + Math.floor(Math.random() * 3)), 0.05); },
    hit: (fin) => { thud(150, 0.2); chime(784, fin ? 3 : 1, 0.05); },
  },
  'парные клинки': {
    // правая — пламя, левая — звёздный свет
    swing: (s) => { whoosh(2700 * (s === 1 ? 1.15 : 1), 0.12, 0.14); if (s !== 1) crackle(0.05, 0.02, 2); if (s !== 0) bell(1568, 0.35, 0.035, 0.03, 0.5); },
    hit: (fin) => { slice(0.13); crackle(0.07, 0, 3); if (fin) { bell(1760, 0.5, 0.06, 0.02, 0.5); thud(90, 0.3); } },
  },
  'кастеты': {
    swing: (s) => whoosh(s === 2 ? 1100 : 1500, s === 2 ? 0.14 : 0.08, 0.13),
    hit: (fin) => { thud(fin ? 110 : 170, fin ? 0.45 : 0.32); hiss({ dur: 0.04, vol: 0.22, f: 1300, q: 0.8 }); },
  },
};

export const weaponSwing = (cat: WeaponCategory, step: number): void => VOICES[cat]?.swing(step);
export const weaponHit = (cat: WeaponCategory, finisher: boolean): void => VOICES[cat]?.hit(finisher);

// ---------- спец-удары ----------

/** Миг спец-удара: start — начало, hit — каждый удар серии, end — финал (взрыв, волна, приземление) */
export type SpecialCue = 'start' | 'hit' | 'end';

const SPECIAL: Record<WeaponCategory, Record<SpecialCue, () => void>> = {
  'меч': {
    // вихрь: свист закручивается вверх, каждый круг — звон, в конце — аккорд
    start: () => { hiss({ dur: 0.85, vol: 0.18, f: 500, f1: 3200, q: 1.2, attack: 0.2, verb: 0.3 }); bell(523.25, 0.6, 0.06, 0, 0.6); },
    hit: () => { whoosh(2800, 0.14, 0.2); clang(1760, 0.06); },
    end: () => chime(523.25, 4, 0.07),
  },
  'топор': {
    // бросок, свист вращения (hit — каждый оборот), лязг при возврате в руку
    start: () => { whoosh(1400, 0.25, 0.25, 0, 0.4); boom(120, 60, 0.2, 0.15); },
    hit: () => whoosh(1900, 0.09, 0.14, 0, 0.7),
    end: () => { clang(880, 0.12); thud(140, 0.2); },
  },
  'булава': {
    start: () => whoosh(900, 0.35, 0.2, 0, 0.4),
    hit: () => { boom(70, 32, 0.6, 0.55, 0, 0.35); hiss({ dur: 0.45, vol: 0.25, f: 220, q: 0.5, verb: 0.3 }); },
    end: () => bell(196, 1, 0.08, 0, 0.7),
  },
  'кинжал': {
    // рывок тени: обратный вдох и тёмный гул, три сухих разреза
    start: () => { hiss({ dur: 0.3, vol: 0.2, f: 600, f1: 4000, q: 0.8, attack: 0.25, verb: 0.3 }); voice({ type: 'sawtooth', f: 110, f1: 82, dur: 0.5, vol: 0.05, lp: 600, verb: 0.4 }); },
    hit: () => slice(0.18, 0, 6200),
    end: () => bell(1244, 0.6, 0.06, 0, 0.6),
  },
  'копьё': {
    start: () => hiss({ dur: 0.3, vol: 0.22, f: 1200, f1: 4200, q: 1, attack: 0.15, verb: 0.15 }),
    hit: () => { hiss({ dur: 0.06, vol: 0.3, f: 3500, q: 1.2 }); boom(130, 50, 0.35, 0.4, 0, 0.25); },
    end: () => clang(1318, 0.08),
  },
  'молот': {
    // прыжок — свист вверх, приземление — землетрясение и камни
    start: () => { hiss({ dur: 0.5, vol: 0.2, f: 400, f1: 2400, q: 0.8, attack: 0.2, verb: 0.2 }); },
    hit: () => {
      boom(60, 24, 0.9, 0.8, 0, 0.45);
      hiss({ dur: 0.8, vol: 0.4, f: 180, q: 0.4, verb: 0.4 });
      for (let i = 0; i < 6; i++) hiss({ dur: 0.06, vol: 0.12, f: rnd(600, 1400), q: 1.5, delay: 0.15 + i * 0.08, verb: 0.1 });
    },
    end: () => bell(130.81, 1.2, 0.07, 0, 0.8),
  },
  'посох': {
    start: () => chime(523.25, 5, 0.06, 0, 0.04),
    hit: () => { whoosh(2400, 0.4, 0.16, 0, 0.3); voice({ type: 'triangle', f: 784, f1: 1568, dur: 0.5, vol: 0.06, verb: 0.6 }); },
    end: () => { chime(1046.5, 3, 0.06); boom(110, 55, 0.4, 0.3); },
  },
  'коса': {
    // жатва: низкий хор, стеклянный свист, души — колокольчики вниз
    start: () => { voice({ type: 'sawtooth', f: 98, dur: 0.9, vol: 0.05, lp: 700, detune: 12, verb: 0.6, attack: 0.15 }); voice({ type: 'sawtooth', f: 146.8, dur: 0.9, vol: 0.04, lp: 700, verb: 0.6, attack: 0.15 }); },
    hit: () => { whoosh(2200, 0.3, 0.2); [1046.5, 932.3, 784].forEach((f, i) => bell(f, 0.5, 0.05, i * 0.06, 0.6)); },
    end: () => bell(233, 1.2, 0.07, 0, 0.8),
  },
  'катана': {
    // иайдо: гул и пульс сердца в тишине, мгновенный «шинь» на весь экран, разрезы проступают сухим треском
    start: () => { voice({ type: 'sine', f: 82, dur: 0.6, vol: 0.12, verb: 0.5, attack: 0.1 }); boom(60, 50, 0.12, 0.25, 0.15); boom(60, 50, 0.12, 0.2, 0.38); },
    hit: () => { hiss({ dur: 0.35, vol: 0.3, f: 7000, f1: 2500, q: 1.6, verb: 0.5 }); bell(2349, 1, 0.09, 0, 0.7); },
    end: () => { for (let i = 0; i < 3; i++) slice(0.2, i * 0.05, 5800); boom(80, 40, 0.4, 0.4, 0.05); },
  },
  'великий меч': {
    // ярость: рык железа, каждый оборот — тяжёлый свист, финал — грохот
    start: () => { voice({ type: 'sawtooth', f: 73, f1: 55, dur: 1.2, vol: 0.08, lp: 500, detune: 20, verb: 0.4, attack: 0.1 }); },
    hit: () => { whoosh(700, 0.3, 0.26, 0, 0.4); thud(60, 0.4); },
    end: () => { boom(50, 22, 1, 0.8, 0, 0.5); hiss({ dur: 0.7, vol: 0.3, f: 200, q: 0.4, verb: 0.4 }); clang(330, 0.1, 0.05); },
  },
  'парные клинки': {
    // танец: пламя и свет по очереди (hit чередуется сам), крест — аккорд и взрыв
    start: () => { crackle(0.1, 0, 5); chime(659.25, 3, 0.05); },
    hit: () => { whoosh(3000, 0.09, 0.15); if (Math.random() < 0.5) crackle(0.07, 0, 2); else bell(deg(1046.5, Math.floor(Math.random() * 5)), 0.35, 0.05, 0, 0.5); },
    end: () => { chime(523.25, 4, 0.07, 0, 0.03); boom(80, 30, 0.6, 0.55, 0.05, 0.4); crackle(0.12, 0.05, 6); },
  },
  'алебарда': {
    start: () => hiss({ dur: 1, vol: 0.14, f: 700, f1: 1800, q: 1, attack: 0.3, verb: 0.2 }),
    hit: () => { whoosh(1500, 0.22, 0.22, 0, 0.5); thud(110, 0.2); },
    end: () => clang(659.25, 0.1),
  },
  'рапира': {
    start: () => { clang(2093, 0.08); },
    hit: () => { hiss({ dur: 0.05, vol: 0.18, f: rnd(3600, 5200), f1: 6500, q: 1.4 }); bell(deg(1318.5, Math.floor(Math.random() * 5)), 0.25, 0.04, 0.01, 0.3); },
    end: () => { hiss({ dur: 0.2, vol: 0.28, f: 2000, f1: 6000, q: 1.2, attack: 0.05 }); bell(2637, 0.7, 0.08, 0.05, 0.5); },
  },
  'кастеты': {
    start: () => { boom(160, 120, 0.1, 0.2); boom(160, 120, 0.1, 0.2, 0.12); },
    hit: () => { thud(rnd(140, 200), 0.32); hiss({ dur: 0.03, vol: 0.2, f: 1400, q: 0.8 }); },
    end: () => { whoosh(900, 0.2, 0.25, 0, 1.8); boom(90, 30, 0.7, 0.7, 0.08, 0.4); },
  },
};

export const specialSound = (cat: WeaponCategory, cue: SpecialCue): void => SPECIAL[cat]?.[cue]();
