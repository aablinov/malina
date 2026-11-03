import { makeCanvas } from './headless.ts';
/**
 * Пиксельные иконки предметов и HUD в духе Minecraft Dungeons: сетка 16 × 16, рисуются кодом,
 * тёмный контур добавляется сам вокруг закрашенных пикселей. Отдаются как data-URL — в CSS их растягивают
 * с image-rendering: pixelated. Внешних картинок нет (как и у текстур).
 */

import { ICONS as AURA_ICONS } from './aura-icons.ts';
import { ICONS as DARK_ARCANE_ICONS } from './magic/dark-arcane-icons.ts';
import { ICONS as EARTH_ICONS } from './magic/earth-icons.ts';
import { ICONS as FIRE_ICE_ICONS } from './magic/fire-ice-icons.ts';
import { ICONS as STORM_LIGHT_ICONS } from './magic/storm-light-icons.ts';
import { ICONS as BASE_FIRE_ICONS } from './magic/base-fire-icons.ts';
import { ICONS as BASE_SUMMON_ICONS } from './magic/base-summon-icons.ts';
import { ICONS as BASE_BLOOD_ICONS } from './magic/base-blood-icons.ts';
import { ICONS as BASE_LIGHT_ICONS } from './magic/base-light-icons.ts';

export type Draw = (p: Pen) => void;

const N = 16;
const OUTLINE = '#120e18';

export class Pen {
  readonly px = new Map<number, string>();
  /** Пиксель */
  p(x: number, y: number, c: string): void { if (x >= 0 && y >= 0 && x < N && y < N) this.px.set(y * N + x, c); }
  /** Прямоугольник w × h */
  r(x: number, y: number, w: number, h: number, c: string): void { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.p(x + i, y + j, c); }
  /** Отрезок (Брезенхэм) */
  l(x0: number, y0: number, x1: number, y1: number, c: string): void {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.p(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  /** Квадратичная кривая */
  q(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, c: string): void {
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, a = (1 - t) ** 2, b = 2 * (1 - t) * t, d = t * t;
      this.p(Math.round(a * x0 + b * cx + d * x1), Math.round(a * y0 + b * cy + d * y1), c);
    }
  }
  /** Строки-шаблон: символ → цвет из pal, «.» — пусто */
  s(x: number, y: number, rows: string[], pal: Record<string, string>): void {
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = pal[row[i]]; if (c) this.p(x + i, y + j, c); } });
  }
}

// ---------- палитры ----------
const STEEL = ['#f2f6fb', '#c6d0dc', '#8e9aab'];
const WOOD = ['#a8774a', '#7a5230', '#55361d'];
const GOLD = ['#ffe27a', '#f2b632', '#b9761c'];

/** Клинок по диагонали снизу-слева вверх-вправо: от (x0, y0) до (x1, y1), шириной 2 */
function blade(p: Pen, x0: number, y0: number, x1: number, y1: number, hi: string, lo: string): void {
  p.l(x0, y0, x1, y1, hi);
  p.l(x0 + 1, y0, x1, y1 + 1, lo);
}

const ICONS: Record<string, Draw> = {
  ...FIRE_ICE_ICONS, ...STORM_LIGHT_ICONS, ...DARK_ARCANE_ICONS, ...EARTH_ICONS, ...AURA_ICONS, ...BASE_FIRE_ICONS, ...BASE_SUMMON_ICONS, ...BASE_BLOOD_ICONS, ...BASE_LIGHT_ICONS,
  // ---------- ближний бой ----------
  sword(p) {
    blade(p, 7, 8, 14, 1, STEEL[0], STEEL[2]);
    p.l(4, 7, 8, 11, GOLD[1]); p.p(6, 9, GOLD[0]);
    p.l(3, 12, 5, 10, WOOD[1]);
    p.r(1, 13, 2, 2, '#ff2a5d');
  },
  claymore(p) {
    blade(p, 6, 8, 14, 0, STEEL[0], STEEL[1]);
    p.l(7, 9, 14, 2, STEEL[2]);
    p.l(2, 5, 8, 11, GOLD[1]); p.l(3, 5, 8, 10, GOLD[0]);
    p.l(2, 12, 4, 10, WOOD[2]);
    p.r(1, 13, 2, 2, GOLD[1]);
  },
  dagger(p) {
    blade(p, 8, 7, 12, 3, '#ece6ff', '#b89cff');
    p.l(6, 6, 9, 9, '#7b3fbf');
    p.l(5, 10, 7, 8, '#2b2b33');
    p.r(3, 11, 2, 2, '#c27aff');
  },
  axe(p) {
    p.l(2, 13, 10, 5, WOOD[1]); p.l(3, 13, 10, 6, WOOD[2]);
    p.s(8, 1, [
      '..aab.',
      '.aaabb',
      'caaabb',
      'caaab.',
      '.aab..',
      '..c...',
    ], { a: STEEL[1], b: STEEL[0], c: STEEL[2] });
    p.p(2, 13, GOLD[1]);
  },
  mace(p) {
    p.l(2, 13, 8, 7, WOOD[1]); p.l(3, 13, 8, 8, WOOD[2]);
    p.p(8, 7, GOLD[1]); p.p(7, 7, GOLD[1]);
    p.s(8, 1, [
      '..s...',
      '.aaab.',
      'saaabs',
      '.aaab.',
      '.cccb.',
      '..s...',
    ], { a: '#9aa3b1', b: '#c9d0da', c: '#6f7886', s: '#e6ebf1' });
  },
  spear(p) {
    p.l(1, 14, 10, 5, WOOD[0]); p.l(2, 14, 10, 6, WOOD[1]);
    p.p(5, 10, '#c03a3a'); p.p(6, 10, '#c03a3a'); p.p(5, 11, '#c03a3a');
    p.p(10, 5, GOLD[1]); p.p(11, 5, GOLD[1]);
    p.s(10, 0, [
      '....a',
      '...ab',
      '..abb',
      '.abb.',
      '.bb..',
    ], { a: STEEL[0], b: STEEL[1] });
  },
  hammer(p) {
    p.l(2, 13, 7, 8, WOOD[1]); p.l(3, 13, 7, 9, WOOD[2]);
    p.s(5, 1, [
      '..bbbb...',
      '.aaaaaab.',
      'aaaaaaaab',
      'aaarraaab',
      '.caaaaab.',
      '..cccca..',
      '....c....',
    ], { a: '#8a8f99', b: '#b7bcc4', c: '#5d626c', r: '#ffb347' });
  },
  katana(p) {
    p.q(6, 9, 10, 2, 15, 0, STEEL[0]); p.q(7, 9, 11, 3, 15, 1, STEEL[2]);
    p.r(4, 9, 3, 3, '#2b2b33'); p.p(5, 10, GOLD[1]);
    p.l(1, 14, 4, 11, '#c03a4a'); p.l(2, 14, 4, 12, '#2a2230');
  },
  nagakiba(p) {
    p.q(4, 11, 9, 3, 15, 0, STEEL[0]); p.q(5, 11, 10, 4, 15, 1, STEEL[2]);
    p.r(3, 11, 2, 2, '#2b2b33'); p.p(4, 11, '#7ad8ff');
    p.l(0, 15, 3, 12, '#3a5ab8'); p.l(1, 15, 3, 13, '#1e1a26');
  },
  dragonslayer(p) {
    p.s(5, 0, [
      '......aaaa',
      '.....aabbc',
      '....aabbc.',
      '...aabbc..',
      '..aabbc...',
      '.aabbc....',
      'aabbc.....',
      'abbc......',
      '.cc.......',
    ], { a: '#9aa0aa', b: '#6e737c', c: '#4a4e56' });
    p.l(2, 8, 6, 12, '#4a4e56');
    p.l(1, 14, 4, 11, '#5a4030'); p.p(0, 15, '#4a4e56');
  },
  pontiff(p) {
    blade(p, 6, 9, 14, 1, '#ffd2a0', '#ff6a1a');
    blade(p, 9, 9, 1, 1, '#d8d0ff', '#8a6aff');
    p.l(4, 8, 7, 11, '#8a2a1a'); p.l(9, 11, 12, 8, '#3a2a8a');
    p.l(3, 12, 5, 10, '#2a1a14'); p.l(12, 12, 10, 10, '#1a1a2a');
    p.p(2, 13, GOLD[1]); p.p(13, 13, '#c9d2dc');
  },
  staff(p) {
    p.l(2, 15, 11, 6, WOOD[0]); p.l(3, 15, 11, 7, WOOD[1]);
    p.p(4, 13, '#3a5ab8'); p.p(5, 12, '#3a5ab8');
    p.l(10, 6, 12, 4, GOLD[1]); p.l(12, 7, 14, 5, GOLD[1]);
    p.s(11, 1, ['.a..', 'abb.', '.bbc', '..c.'], { a: '#fff2a0', b: '#7ad8ff', c: '#3a9ad8' });
  },
  halberd(p) {
    p.l(1, 15, 12, 4, WOOD[1]); p.l(2, 15, 12, 5, WOOD[2]);
    p.l(12, 3, 15, 0, STEEL[0]);
    p.s(7, 1, ['..aab', '.aaab', 'caab.', 'cab..', '.c...'], { a: STEEL[1], b: STEEL[0], c: STEEL[2] });
    p.p(11, 5, GOLD[1]); p.p(12, 5, GOLD[1]);
  },
  rapier(p) {
    p.l(6, 9, 15, 0, STEEL[0]); p.l(7, 9, 15, 1, STEEL[2]);
    p.s(3, 8, ['.aa.', 'abba', 'abba', '.aa.'], { a: GOLD[2], b: GOLD[0] });
    p.l(1, 14, 4, 11, '#3a2a40');
    p.p(0, 15, GOLD[1]);
  },
  knuckles(p) {
    p.s(1, 4, [
      '.aaaaaaaaaaaa.',
      'abbabbabbabbaa',
      'abbabbabbabbaa',
      '.cccccccccccc.',
      '..c........c..',
      '..cccccccccc..',
    ], { a: STEEL[0], b: STEEL[1], c: STEEL[2] });
    p.r(6, 5, 2, 1, '#ffb347');
  },
  scythe(p) {
    p.l(4, 14, 9, 2, '#4a3560'); p.l(5, 14, 10, 2, '#3b2a4a');
    p.p(4, 14, '#8a5cff');
    p.s(1, 1, [
      '....aaaaab',
      '..aaabbb..',
      '.aabb.....',
      'abb.......',
      'ab........',
      'b.........',
    ], { a: '#cfc8e8', b: '#b98cff' });
  },
  // ---------- дальний бой ----------
  bow(p) { bowShape(p, WOOD[1], WOOD[2], '#e8e2d0'); },
  longbow(p) { bowShape(p, '#4f7a3a', '#35552a', '#e8e2d0'); p.p(6, 9, GOLD[1]); },
  starbow(p) { bowShape(p, '#5ad8ff', '#2f8fd0', '#ffffff'); p.p(2, 12, '#fff6a8'); p.p(12, 2, '#fff6a8'); p.p(7, 7, '#fff6a8'); },
  crossbow(p) {
    p.l(3, 13, 11, 5, WOOD[1]); p.l(4, 13, 11, 6, WOOD[2]);
    p.q(6, 2, 13, 3, 14, 10, '#5a5f6a'); p.q(6, 3, 12, 4, 13, 10, '#8a8f99');
    p.l(6, 3, 13, 10, '#e8e2d0');
    p.l(10, 6, 13, 3, STEEL[0]); p.p(14, 2, STEEL[1]);
  },
  // ---------- броня ----------
  tunic(p) { torso(p, '#5e8f46', '#44703a', '#7a5230'); p.r(7, 6, 2, 6, '#7a5230'); },
  soulrobe(p) {
    p.s(3, 1, [
      '...aaaa...',
      '..abbbba..',
      '..abkkba..',
      '.aabkkbaa.',
      'aaabbbbaaa',
      'aaabbbbaaa',
      '.aabbbbaa.',
      '.aabccbaa.',
      '.aabccbaa.',
      '.aabbbbaa.',
      '.aab..baa.',
      '.ab....ba.',
      '.a......a.',
    ], { a: '#4a4f8a', b: '#6b72b8', c: '#9ae0ff', k: '#1c1a2e' });
  },
  wolf(p) {
    torso(p, '#9a9ea6', '#6f747c', '#4e5259');
    p.s(4, 0, ['a......a', 'aa....aa', '.abbbba.', '.bkbbkb.'], { a: '#c9ccd2', b: '#9a9ea6', k: '#1c1a2e' });
    p.r(7, 7, 2, 5, '#c9ccd2');
  },
  mercenary(p) { torso(p, '#8a5a32', '#6a4024', '#3d2616'); p.l(4, 5, 11, 12, '#c03a3a'); p.p(5, 4, '#f2c040'); p.p(10, 4, '#f2c040'); },
  scale(p) {
    torso(p, '#5f8f7a', '#456b5a', '#2f4a3e');
    for (let y = 5; y < 13; y += 2) for (let x = 5 + (y % 4 === 1 ? 1 : 0); x < 11; x += 2) p.p(x, y, '#8fc0a6');
  },
  champion(p) {
    torso(p, '#d6dbe2', '#9ea6b2', '#6d7682');
    p.r(4, 4, 8, 1, GOLD[1]); p.r(7, 5, 2, 7, GOLD[1]); p.p(7, 7, '#ff2a5d'); p.p(8, 7, '#ff2a5d');
    p.r(2, 2, 3, 2, GOLD[0]); p.r(11, 2, 3, 2, GOLD[0]);
  },
  // ---------- артефакты ----------
  firework(p) {
    // ракета по диагонали: красный корпус в три пикселя, белые полосы, бумажный колпак, искры снизу
    p.l(4, 11, 10, 5, '#ff5a4a'); p.l(5, 11, 11, 5, '#e23a3a'); p.l(5, 12, 11, 6, '#a3202a');
    p.p(6, 9, '#ffffff'); p.p(7, 9, '#ffffff'); p.p(7, 10, '#e8e8e8');
    p.p(8, 7, '#ffffff'); p.p(9, 7, '#ffffff'); p.p(9, 8, '#e8e8e8');
    p.s(10, 1, ['...a', '..ab', '.abb', 'abbc', '.bc.'], { a: '#ffffff', b: '#d8d8d8', c: '#a8a8a8' });
    p.s(1, 11, ['..ab', '.abc', 'abc.', 'bc..'], { a: '#ffe27a', b: '#ff9a2a', c: '#ff5a2a' });
  },
  power(p) {
    p.s(3, 2, [
      '....aa....',
      '...abba...',
      '..abccba..',
      '.abcddcba.',
      'abcdwwdcba',
      'abcdwwdcba',
      '.abcddcba.',
      '..abccba..',
      '...abba...',
      '....aa....',
    ], { a: '#5a5763', b: '#9a97a3', c: '#d8d4e0', d: '#f2b632', w: '#fff6c8' });
  },
  totem(p) {
    p.s(4, 1, [
      '.aaaaaa.',
      'abbbbbba',
      'abkbbkba',
      'abbbbbba',
      'abbccbba',
      '.aaaaaa.',
      '..abba..',
      '.abbbba.',
      '.abrrba.',
      '.arrrra.',
      '.abrrba.',
      '.abbbba.',
      '..aaaa..',
    ], { a: '#5a3a22', b: '#8a6038', k: '#1c1a2e', c: '#c03a3a', r: '#ff3a5a' });
  },
  boots(p) {
    p.s(3, 2, [
      '.......ww..',
      '..aaa.www..',
      '..aba.ww...',
      '..aba......',
      '..abaa.....',
      '..abba.....',
      '..abbaa....',
      '.aabbbaaa..',
      '.abbbbbbba.',
      '.cccccccc..',
    ], { a: '#2f6fd0', b: '#5ab8ff', c: '#1d3f80', w: '#f2f6fb' });
  },
  horn(p) {
    p.q(3, 4, 9, 2, 13, 11, '#e8dcc0');
    p.q(3, 5, 9, 4, 12, 11, '#c8b890');
    p.q(4, 6, 9, 5, 11, 11, '#a89870');
    p.r(11, 11, 3, 3, '#3a5f8a'); p.p(12, 12, '#7ad8ff');
    p.p(3, 4, '#5a4a30');
  },
  lightning(p) {
    p.s(3, 3, [
      '..aaaaaa..',
      '.abbbbbba.',
      'abbbyybbba',
      'abbbyybbba',
      'abbyyybbba',
      'abbbyybbba',
      'abbyybbbba',
      'abbbbbbbba',
      '.acccccca.',
      '..aaaaaa..',
    ], { a: '#5a3a8a', b: '#9a6ad8', c: '#6a4aa8', y: '#ffe24a' });
  },
  harvester(p) {
    p.s(4, 1, [
      '...aa...',
      '..a..a..',
      '.aaaaaa.',
      'abbbbbba',
      'abcddcba',
      'abdssdba',
      'abdssdba',
      'abcddcba',
      'abbbbbba',
      '.aaaaaa.',
      '..a..a..',
    ], { a: '#2b2b33', b: '#4a3a5a', c: '#6a4aa8', d: '#3fb8d8', s: '#bff6ff' });
  },
  // ---------- заклинания (src/spells.ts) ----------
  spark(p) {
    // ломаная молния сверху вниз: белое ядро, голубое свечение
    p.s(3, 0, [
      '......aab.',
      '.....abb..',
      '....abb...',
      '...abb....',
      '..abbbbbb.',
      '.aawwwwba.',
      '....awwa..',
      '...awwa...',
      '..awwa....',
      '.awwa.....',
      '.aww......',
      'aww.......',
      'aw........',
      'a.........',
    ], { a: '#3a8ad8', b: '#7ad8ff', w: '#ffffff' });
    p.p(12, 9, '#bff6ff'); p.p(13, 12, '#7ad8ff'); p.p(2, 4, '#bff6ff');
  },
  fireball(p) {
    // шар пламени с хвостом в левый нижний угол
    p.s(5, 2, [
      '...aaaa..',
      '..abbbba.',
      '.abccccba',
      'abccwwcba',
      'abcwwwcba',
      'abccwwcba',
      '.abccccba',
      '..abbbba.',
      '...aaaa..',
    ], { a: '#c03a1a', b: '#ff6a2a', c: '#ffb43a', w: '#fff2b0' });
    p.l(1, 14, 5, 10, '#ff6a2a'); p.l(2, 14, 6, 10, '#ffb43a'); p.l(1, 13, 5, 9, '#c03a1a');
    p.p(3, 9, '#ffb43a'); p.p(7, 13, '#ff6a2a'); p.p(2, 11, '#ffe27a');
  },
  icerain(p) {
    // облако инея и три сосульки
    p.s(2, 1, [
      '...aaaaa....',
      '.aabbbbbaa..',
      'abbbwwbbbbaa',
      'abwwwwwbbbba',
      '.aaaaaaaaaa.',
    ], { a: '#5a8ab8', b: '#a8d8f8', w: '#ffffff' });
    for (const [x, y, h] of [[4, 7, 6], [8, 7, 8], [12, 7, 5]] as const) {
      p.r(x, y, 2, h - 2, '#a8e8ff'); p.p(x, y, '#ffffff'); p.p(x + 1, y + h - 2, '#5ab8e8'); p.p(x, y + h - 2, '#a8e8ff'); p.p(x, y + h - 1, '#5ab8e8');
    }
  },
  heal(p) {
    // зелёный лист с лепестками малины вокруг
    p.s(3, 2, [
      '.......aa.',
      '.....aabba',
      '...aabbbba',
      '..abbbcbba',
      '.abbbcbba.',
      '.abbcbba..',
      'abbcbba...',
      'abcbba....',
      'acaaa.....',
      'c.........',
    ], { a: '#2f7a2a', b: '#6ad84a', c: '#d8ffb0' });
    p.p(2, 2, '#ff5a8a'); p.p(3, 1, '#ff8fb0'); p.p(13, 13, '#ff5a8a'); p.p(12, 14, '#ff8fb0'); p.p(14, 11, '#ffe27a'); p.p(1, 6, '#ffe27a');
  },
  // ---------- ауры (src/auras.ts) ----------
  'a-pact'(p) {
    // капля крови в кольце из нитей
    p.s(4, 1, [
      '...aa...',
      '...ab...',
      '..abba..',
      '..abba..',
      '.abbcba.',
      '.abbccba',
      'abbbccba',
      'abbbbbba',
      'abbbbbba',
      '.abbbba.',
      '..aaaa..',
    ], { a: '#6a0a1a', b: '#d8203a', c: '#ff8a9a' });
    p.q(1, 12, 1, 15, 5, 14, '#ff4a5a'); p.q(14, 12, 14, 15, 10, 14, '#ff4a5a'); p.p(2, 5, '#ff4a5a'); p.p(13, 5, '#ff4a5a');
  },
  'a-bastion'(p) {
    // щит с руной
    p.s(3, 1, [
      'aaaaaaaaaa',
      'abbbbbbbba',
      'abccccccba',
      'abcwccwcba',
      'abccwwccba',
      'abccwwccba',
      'abcwccwcba',
      '.abccccba.',
      '.abbccbba.',
      '..abbbba..',
      '...abba...',
      '....aa....',
    ], { a: '#2a3a6a', b: '#f2b632', c: '#4a7ad8', w: '#bfe6ff' });
  },
  'a-rage'(p) {
    // пылающий кулак-пламя
    p.s(3, 1, [
      '....a.....',
      '...aba..a.',
      '..abba.aba',
      '..abcba.ba',
      '.abccba.ba',
      'abcccbaaba',
      'abccwcbbba',
      'abcwwccba.',
      'abcwwccba.',
      '.abccccba.',
      '..abbbba..',
      '...aaaa...',
    ], { a: '#8a1a0a', b: '#ff4a1a', c: '#ffa03a', w: '#fff2a0' });
  },
  'a-clarity'(p) {
    // три голубых огонька вокруг глаза
    p.s(3, 5, [
      '..aaaaaa..',
      '.abbbbbba.',
      'abbwccwbba',
      'abbcwwcbba',
      '.abbbbbba.',
      '..aaaaaa..',
    ], { a: '#1a3a6a', b: '#4aa8f8', c: '#1a2a4a', w: '#e8f8ff' });
    for (const [x, y] of [[2, 2], [13, 2], [7, 13]] as const) { p.r(x, y, 2, 2, '#7ad8ff'); p.p(x, y, '#ffffff'); }
  },
  'a-thorns'(p) {
    // венок из колючих лоз
    p.q(3, 8, 3, 2, 8, 2, '#2f6a2a'); p.q(8, 2, 13, 2, 13, 8, '#2f6a2a'); p.q(13, 8, 13, 14, 8, 14, '#2f6a2a'); p.q(8, 14, 3, 14, 3, 8, '#2f6a2a');
    p.q(4, 8, 4, 3, 8, 3, '#5aa84a'); p.q(8, 3, 12, 3, 12, 8, '#5aa84a'); p.q(12, 8, 12, 13, 8, 13, '#5aa84a'); p.q(8, 13, 4, 13, 4, 8, '#5aa84a');
    for (const [x, y] of [[1, 8], [14, 8], [8, 0], [8, 15], [3, 3], [12, 3], [3, 12], [12, 12]] as const) p.p(x, y, '#d8e8b0');
    p.p(7, 7, '#ff4a6a'); p.p(8, 8, '#ff4a6a'); p.p(8, 7, '#ff8aa0');
  },
  // ---------- HUD ----------
  chest(p) {
    p.s(1, 3, [
      '.aaaaaaaaaaaa.',
      'abbbbbbbbbbbba',
      'abbbbbbbbbbbba',
      'cccccckkcccccc',
      'abbbbbkkbbbbba',
      'abbbbbbbbbbbba',
      'abbbbbbbbbbbba',
      'abbbbbbbbbbbba',
      'aaaaaaaaaaaaaa',
    ], { a: '#5a3a1e', b: '#a8743e', c: '#3a2614', k: '#f2c040' });
  },
  potion(p) {
    p.s(3, 1, [
      '....aa....',
      '....aa....',
      '...gwwg...',
      '...gwwg...',
      '..gwwwwg..',
      '.gwrrrrrg.',
      'gwrrrrrrrg',
      'gwrrrrrrrg',
      'gwrrrrrrrg',
      'grrrrrrrdg',
      '.grrrrrdg.',
      '..gggggg..',
    ], { a: '#8a6038', g: '#cfe6f2', w: '#eef8ff', r: '#e2304a', d: '#a3142e' });
  },
  map(p) {
    p.s(1, 2, [
      'aaaaaaaaaaaaa.',
      'abbbbbbbbbbbba',
      'abbcbbbbbbbbba',
      'abbbcbbbbrbbba',
      'abbbbcbbrbrbba',
      'abbbbbcbbrbbba',
      'abbbbbbccbbbba',
      'abbggbbbbbbbba',
      'abggggbbbbbbba',
      'abbggbbbbbbbba',
      'abbbbbbbbbbbba',
      '.aaaaaaaaaaaaa',
    ], { a: '#8a6a3a', b: '#e8d6a8', c: '#8a6a3a', r: '#d0303a', g: '#6a9a4a' });
  },
  arrows(p) {
    for (const [x, y] of [[0, 2], [3, 0], [6, 2]] as [number, number][]) {
      p.l(x + 4, y + 13, x + 4, y + 4, WOOD[0]);
      p.s(x + 3, y + 1, ['.a.', 'aba', 'a.a'], { a: STEEL[1], b: STEEL[0] });
      p.s(x + 3, y + 11, ['w.w', 'www'], { w: '#f2f2f2' });
    }
  },
  arrow(p) {
    p.l(2, 13, 11, 4, WOOD[0]);
    p.s(10, 1, ['..aa', '.aba', 'abba', 'aaa.'], { a: STEEL[1], b: STEEL[0] });
    p.s(1, 11, ['.w..', 'ww..', 'ww.w', '.ww.'], { w: '#f2f2f2' });
  },
  berry(p) {
    p.s(3, 1, [
      '...gg.gg..',
      '....ggg...',
      '..rrrrrr..',
      '.rhrrhrrr.',
      'rrrrrrhrrr',
      'rhrrhrrrrd',
      'rrrrrrrhrd',
      '.rrhrrrrd.',
      '.rrrrrrdd.',
      '..rrrrdd..',
      '...rddd...',
    ], { g: '#3e8a33', r: '#d02a50', h: '#ff7a9a', d: '#8a1030' });
  },
  spiral(p) {
    p.s(2, 2, [
      '..aaaaaaa...',
      '.a.......a..',
      'a..bbbbb..a.',
      'a.b.....b.a.',
      'a.b.ccc.b.a.',
      'a.b.c.c.b.a.',
      'a.b...c.b.a.',
      'a..bbbb..a..',
      '.a......a...',
      '..aaaaaa....',
    ], { a: '#9a5cff', b: '#c08aff', c: '#e8d6ff' });
  },
  soul(p) {
    p.s(4, 1, [
      '...a....',
      '..ab....',
      '..abb...',
      '.abbba..',
      '.abccba.',
      'abcwwcba',
      'abcwwcba',
      'abccccba',
      '.abbbba.',
      '..aaaa..',
    ], { a: '#2f8fb8', b: '#5ad8ff', c: '#a8f0ff', w: '#ffffff' });
  },
  heart(p) {
    p.s(1, 2, [
      '.aaa....aaa...',
      'abbba..abbba..',
      'abwbbaabbbbba.',
      'abwbbbbbbbbba.',
      'abbbbbbbbbbba.',
      '.abbbbbbbbba..',
      '..abbbbbbba...',
      '...abbbbba....',
      '....abbba.....',
      '.....aba......',
      '......a.......',
    ], { a: '#7a0a18', b: '#e2203a', w: '#ff9aa8' });
  },
  roll(p) {
    p.s(1, 3, [
      'aa....aa....',
      '.aa....aa...',
      '..aa....aa..',
      '...aa....aa.',
      '...aa....aa.',
      '..aa....aa..',
      '.aa....aa...',
      'aa....aa....',
    ], { a: '#5ab8ff' });
  },
  grid(p) { for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) p.r(2 + i * 4, 2 + j * 4, 3, 3, '#e8e8e8'); },
  helmet(p) {
    p.s(2, 3, [
      '...aaaaaa...',
      '.aaaaaaaaaa.',
      'aaaaaaaaaaaa',
      'aaaaaaaaaaaa',
      'aaa......aaa',
      'aa........aa',
      'aa........aa',
      'a..........a',
    ], { a: '#e8e8e8' });
  },
  flask(p) {
    p.s(3, 1, [
      '...aaaa...',
      '....aa....',
      '....aa....',
      '...aaaa...',
      '..aaaaaa..',
      '.aaaaaaaa.',
      'aaaaaaaaaa',
      'aaaaaaaaaa',
      'aaaaaaaaaa',
      '.aaaaaaaa.',
    ], { a: '#e8e8e8' });
  },
  lock(p) { p.s(4, 2, ['..aaaa..', '.a....a.', '.a....a.', 'bbbbbbbb', 'bbbccbbb', 'bbbccbbb', 'bbbbbbbb'], { a: '#c6d0dc', b: '#f2b632', c: '#5a3a1e' }); },
  mouse(p) { p.s(4, 1, ['.aaaaaa.', 'aaaabbba', 'aaaabbba', 'aaaabbba', 'aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', '.aaaaaa.'], { a: '#e8e8e8', b: '#ffcf3a' }); },
  // ---------- зачарования (глиф в ромбе) ----------
  'e-blade'(p) { blade(p, 4, 11, 11, 4, '#ffffff', '#cfe6ff'); p.l(3, 9, 6, 12, '#ffffff'); },
  'e-star'(p) { p.s(3, 3, ['....a....', '....a....', '...aaa...', 'aaaaaaaaa', '.aaaaaaa.', '..aaaaa..', '..aa.aa..', '.aa...aa.', '.a.....a.'], { a: '#ffffff' }); },
  'e-drop'(p) { p.s(4, 2, ['...aa...', '...aa...', '..aaaa..', '.aaaaaa.', '.aaaaaa.', 'aaaaaaba', 'aaaaaaba', 'aaaaabba', '.aaaaba.', '..aaaa..'], { a: '#ffffff', b: '#ffd0d8' }); },
  'e-fist'(p) { p.s(3, 4, ['.aaaaaaa.', 'aaaaaaaaa', 'a.a.a.a.a', 'aaaaaaaaa', 'aaaaaaaaa', '.aaaaaaa.', '..aaaaa..'], { a: '#ffffff' }); },
  'e-swirl'(p) { p.q(3, 8, 3, 3, 8, 3, '#ffffff'); p.q(8, 3, 13, 3, 13, 8, '#ffffff'); p.q(13, 8, 13, 13, 8, 13, '#ffffff'); p.q(8, 13, 6, 13, 6, 10, '#ffffff'); },
  'e-flame'(p) { p.s(3, 1, ['....a.....', '...aa.....', '...aaa..a.', '..aaaa.aa.', '..aaaaaaa.', '.aaabaaaa.', '.aabbbaaaa', 'aaabbbbaaa', 'aabbbbbbaa', 'aabbbbbbaa', '.aabbbbaa.', '..aaaaaa..'], { a: '#ffffff', b: '#ffe0a0' }); },
  'e-bolt'(p) { p.s(4, 1, ['....aaa.', '...aaa..', '..aaa...', '.aaa....', 'aaaaaaa.', '...aaa..', '..aaa...', '.aaa....', 'aaa.....', 'aa......'], { a: '#ffffff' }); },
  'e-arrow'(p) { p.l(3, 12, 12, 3, '#ffffff'); p.s(9, 2, ['aaaa', '..aa', '...a', '...a'], { a: '#ffffff' }); p.s(2, 11, ['a...', 'aa..', '.aa.'], { a: '#ffffff' }); },
  'e-multi'(p) { for (const d of [-3, 0, 3]) { p.l(7 + d, 13, 7 + d, 4, '#ffffff'); p.s(6 + d, 2, ['.a.', 'aaa'], { a: '#ffffff' }); } },
  'e-inf'(p) { p.s(1, 5, ['.aaa....aaa..', 'a...a..a...a.', 'a....aa....a.', 'a...a..a...a.', '.aaa....aaa..'], { a: '#ffffff' }); },
  'e-clock'(p) { p.s(3, 2, ['.aaaaaaaa.', '.a......a.', '..a....a..', '...abba...', '....bb....', '....bb....', '...a..a...', '..a.bb.a..', '.a.bbbb.a.', '.aaaaaaaa.'], { a: '#ffffff', b: '#fff0b0' }); },
  'e-pierce'(p) { p.l(1, 8, 14, 8, '#ffffff'); p.s(11, 5, ['a..', 'aa.', 'aaa', 'aa.', 'a..'].map((s) => s), { a: '#ffffff' }); p.r(6, 4, 2, 9, '#ffd0ff'); },
  'e-leaf'(p) { p.s(3, 2, ['......aaa.', '....aaaaa.', '..aaaaaaa.', '.aaaabaaa.', '.aaabaaa..', 'aaabaaa...', 'aabaaa....', '.b........', 'b.........'], { a: '#ffffff', b: '#c8ffd0' }); },
};

function bowShape(p: Pen, wood: string, dark: string, str: string): void {
  p.l(4, 2, 13, 11, str);
  p.q(4, 2, 2, 13, 13, 11, wood);
  p.q(5, 2, 3, 12, 13, 12, dark);
  p.r(4, 8, 2, 2, '#3d2616');
}

/** Нагрудник спереди: плечи, корпус, рукава */
function torso(p: Pen, a: string, b: string, c: string): void {
  p.s(1, 2, [
    '..aaa....aaa..',
    '.aaaaa..aaaaa.',
    'aaaaaaaaaaaaaa',
    'abaaaaaaaaaaba',
    'ab.aaaaaaaa.ba',
    'cc.aaaaaaaa.cc',
    '...aaaaaaaa...',
    '...baaaaaab...',
    '...bbaaaabb...',
    '...cccccccc...',
    '...aaaaaaaa...',
    '...bbbbbbbb...',
  ], { a, b, c });
}

const cache = new Map<string, string>();

/** Иконка как data-URL 16 × 16 (с контуром); mono — залить одним цветом (значки вкладок) */
export function iconURL(name: string, mono?: string): string {
  const key = `${name}|${mono ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = iconCanvas(name, mono).toDataURL();
  cache.set(key, url);
  return url;
}

/** Иконка на холсте 16 × 16 — для текстур в мире (лут на полу) */
export function iconCanvas(name: string, mono?: string): HTMLCanvasElement {
  const draw = ICONS[name] ?? ICONS.grid;
  const pen = new Pen();
  draw(pen);
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  if (!g) return c;
  if (!mono) {
    // контур: пустые соседи закрашенных пикселей (по 4 направлениям)
    g.fillStyle = OUTLINE;
    for (const k of pen.px.keys()) {
      const x = k % N, y = (k / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && !pen.px.has(ny * N + nx)) g.fillRect(nx, ny, 1, 1);
      }
    }
  }
  for (const [k, col] of pen.px) { g.fillStyle = mono ?? col; g.fillRect(k % N, (k / N) | 0, 1, 1); }
  return c;
}

/** <img> иконки для разметки */
export const iconImg = (name: string, cls = '', mono?: string): string => `<img class="px ${cls}" src="${iconURL(name, mono)}" alt="" draggable="false">`;

export const ICON_NAMES = Object.keys(ICONS);
