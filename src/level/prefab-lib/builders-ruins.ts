import type { BuildCtx, Builder } from './build.ts';

/**
 * Партия «Руины» (wiki/design-prefab-library.md, раздел C; референсы 1, 3, 4, 8, 9, 10 в wiki/sources/refs-settlements.md):
 * арки и акведук, обломки стен, колонны, капелла с колокольней, круглая башня, площадка со статуями, алтарь, кладбище, чаши.
 * Кладка — руинный кирпич `bricks_old` (со ступенями, полублоком и стенкой), у подножия мшистый и треснутый; вокруг щебень,
 * кирпичи, горшки, кости, плющ на стенах, трава в швах.
 */

const pick = <T,>(c: BuildCtx, list: T[]): T => list[Math.floor(c.rnd() * list.length)];
const yaw = (c: BuildCtx): number => Math.floor(c.rnd() * 360);

/** Материал кладки руин: полный блок, низ (мшистый), треснутый, ступени, полублок — для руинного кирпича, песчаника, храмового камня */
export interface Mat { full: string; low: string; cracked: string; stairs: string; slab: string }
export const RUIN: Mat = { full: 'bricks_old', low: 'bricks_mossy', cracked: 'bricks_cracked', stairs: 'bricks_old_stairs', slab: 'bricks_old_slab' };
/** Кирпич кладки: у земли чаще мшистый и треснутый, выше — руинный */
const brick = (c: BuildCtx, y: number, m: Mat = RUIN): string => {
  const v = c.rnd();
  if (y === 0) return v < 0.25 ? m.low : v < 0.35 ? m.cracked : m.full;
  return v < 0.08 ? m.cracked : m.full;
};
/** Столб кладки высотой h с рваным верхом: иногда полублок или ступень сверху */
export function pillar(c: BuildCtx, x: number, z: number, h: number, ragged = true, m: Mat = RUIN): void {
  for (let y = 0; y < h; y++) c.L.set(x, y, z, brick(c, y, m));
  if (ragged) { const v = c.rnd(); if (v < 0.35) c.L.set(x, h, z, m.slab); else if (v < 0.5) c.L.set(x, h, z, m.stairs, Math.floor(c.rnd() * 4)); }
}
/** Стена по отрезку клеток с гуляющей высотой hMin..hMax и рваным верхом */
export function wallRun(c: BuildCtx, cells: [number, number][], hMin: number, hMax: number, m: Mat = RUIN): void {
  let h = hMin + Math.floor(c.rnd() * (hMax - hMin + 1));
  for (const [x, z] of cells) {
    h = Math.max(hMin, Math.min(hMax, h + (c.rnd() < 0.4 ? (c.rnd() < 0.5 ? -1 : 1) : 0)));
    pillar(c, x, z, h, true, m);
  }
}
/**
 * Настенный декор на грани клетки (x, y, z): face — куда смотрит грань ('+z' | '-z' | '+x' | '-x').
 * Рыск как у блоков: 0 — смотрит к +Z, 90 — к −X, 180 — к −Z, 270 — к +X.
 */
export function onWall(c: BuildCtx, name: string, x: number, y: number, z: number, face: '+z' | '-z' | '+x' | '-x'): void {
  const [dx, dz, rot] = face === '+z' ? [0, 0.5, 0] : face === '-z' ? [0, -0.5, 180] : face === '+x' ? [0.5, 0, 270] : [-0.5, 0, 90];
  c.dec(name, x + dx, y, z + dz, rot, [x, Math.floor(y), z]);
}
/** Арка шириной 1 между столбами x0 и x1 (= x0 + 2) с перемычкой на высоте h и зубцами сверху */
export function arch(c: BuildCtx, x0: number, z: number, h: number, collapsed = false, m: Mat = RUIN): void {
  pillar(c, x0, z, h, false, m); pillar(c, x0 + 2, z, h, false, m);
  if (collapsed) { c.dec('rubble', x0 + 1, 0, z + 1, yaw(c)); c.dec('bricks_loose', x0 + 1, 0, z, yaw(c)); return; }
  for (let x = x0; x <= x0 + 2; x++) c.L.set(x, h, z, brick(c, h, m));
  // пята арки: ступени под перемычкой лицом внутрь проёма
  c.L.set(x0, h - 1, z, m.stairs, 0); c.L.set(x0 + 2, h - 1, z, m.stairs, 2);
  for (let x = x0; x <= x0 + 2; x++) { const v = c.rnd(); if (v < 0.4) c.L.set(x, h + 1, z, m.slab); else if (v < 0.6) c.L.set(x, h + 1, z, brick(c, h + 1, m)); }
}
/** Пол из плит с выпавшими и заросшими местами в прямоугольнике */
export function ruinFloor(c: BuildCtx, x0: number, z0: number, x1: number, z1: number): void {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const v = c.rnd();
    c.L.set(x, -1, z, v < 0.6 ? 'tiles' : v < 0.8 ? 'tiles_broken' : 'grass');
    if (v >= 0.8 && c.rnd() < 0.5) c.L.set(x, 0, z, pick(c, ['tall_grass', 'dry_grass', 'fern']));
  }
}
const scatter = (c: BuildCtx, items: [string, number, number][]): void => { for (const [n, x, z] of items) c.dec(n, x, 0, z, yaw(c)); };

export const RUINS: Builder[] = [
  {
    id: 'ruin_arch', title: 'Арка', category: 'руины', hint: 'проём 1 × 3 в руинном кирпиче, зубцы сверху, плющ и щебень', variants: 2,
    build(c) {
      arch(c, -1, 0, 3);
      onWall(c, 'ivy', pick(c, [-1, 1]), 2.5, 0, '+z');
      scatter(c, [['rubble', 2, 1], ['bricks_loose', -2, -1]]);
      c.L.set(pick(c, [2, -2]), 0, pick(c, [1, -1]), 'tall_grass');
    },
  },
  {
    id: 'ruin_arcade', title: 'Акведук', category: 'руины', hint: '4 арки вдоль X высотой 4, один пролёт обрушен', variants: 2,
    build(c) {
      const broken = pick(c, [1, 2]);
      for (let i = 0; i < 4; i++) arch(c, -6 + i * 3, 0, 4, i === broken);
      onWall(c, 'ivy', -6, 3.5, 0, '+z');
      onWall(c, 'ivy', 3, 3, 0, '-z');
      scatter(c, [['rubble', -4, 2], ['bricks_loose', 5, -2], ['pot_clay', -7, -1], ['skull', 1, 2]]);
      for (const [x, z] of [[-5, -2], [0, 2], [6, 1]]) c.L.set(x, 0, z, pick(c, ['tall_grass', 'dry_grass']));
    },
  },
  {
    id: 'ruin_wall_window', title: 'Стена с окном', category: 'руины', hint: 'обломок 5 × 3 с арочным окном, плющ, горшки у подножия', variants: 2,
    build(c) {
      wallRun(c, [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]], 2, 3);
      c.L.set(0, 1, 0, 'air'); c.L.set(0, 2, 0, 'air');
      c.L.set(0, 3, 0, 'bricks_old_slab');
      c.L.set(-1, 2, 0, 'bricks_old_stairs', 0); c.L.set(1, 2, 0, 'bricks_old_stairs', 2);
      onWall(c, 'ivy', pick(c, [-2, 2]), 2, 0, '+z');
      scatter(c, [['pot_clay', -2, 1], ['rubble', 2, -1], ['bricks_loose', 1, 1]]);
      c.L.set(-1, 0, -1, 'fern');
    },
  },
  {
    id: 'ruin_corner', title: 'Угол стены', category: 'руины', hint: 'две стены 4 × 3 под углом, высота спадает от угла; внутри горшки и череп', variants: 2,
    build(c) {
      for (let i = 0; i <= 3; i++) { pillar(c, i, 0, Math.max(1, 3 - Math.floor(i / 1.5)), i > 0); pillar(c, 0, i, Math.max(1, 3 - Math.floor(i / 1.5)), i > 0); }
      onWall(c, 'ivy', 1, 1.5, 0, '+z');
      scatter(c, [['pot_clay', 2, 2], ['skull', 1, 3], ['rubble', 4, 1], ['bricks_loose', -1, 3]]);
      c.L.set(3, 0, 1, 'tall_grass'); c.L.set(1, 0, 1, 'fern');
    },
  },
  {
    id: 'ruin_column_row', title: 'Ряд колонн', category: 'руины', hint: '8 м вдоль X: обломки и упавшие колонны на плитах', variants: 2,
    build(c) {
      ruinFloor(c, -4, -1, 3, 1);
      for (let i = 0; i < 4; i++) {
        const x = -3 + i * 2;
        if (c.rnd() < 0.3) c.dec('column_fallen', x + 0.5, 0, pick(c, [1, 2]), pick(c, [0, 15, -20]));
        else c.dec('column_stump', x, 0, 0, pick(c, [0, 90]));
      }
      scatter(c, [['rubble', 0, -2], ['bricks_loose', -4, 2]]);
      c.L.set(4, 0, -1, 'dry_grass');
    },
  },
  {
    id: 'ruin_chapel', title: 'Капелла', category: 'руины', hint: 'неф без крыши 6 × 7 и колокольня 3 × 3 высотой 8; вариант 1 — дерево внутри, 2 — алтарь и башня обрушена', variants: 2,
    build(c) {
      const whole = c.seed === 1;
      ruinFloor(c, -4, -3, 4, 3);
      // неф: стены по периметру x −4..1, z −3..3, высота 2–3; вход с −X, окна по длинным стенам
      const ring: [number, number][] = [];
      for (let x = -4; x <= 1; x++) { ring.push([x, -3]); ring.push([x, 3]); }
      for (let z = -2; z <= 2; z++) ring.push([-4, z]);
      wallRun(c, ring, 2, 3);
      for (let y = 0; y <= 3; y++) c.L.set(-4, y, 0, 'air');
      for (const z of [-3, 3]) for (const x of [-2, 0]) { c.L.set(x, 1, z, 'air'); c.L.set(x, 2, z, 'air'); c.L.set(x, 3, z, 'bricks_old_slab'); }
      // колокольня x 2..4, z −1..1: полая, окна арками на высоте 5–6
      const top = whole ? 8 : 5;
      for (let x = 2; x <= 4; x++) for (let z = -1; z <= 1; z++) {
        if (x === 3 && z === 0) continue;
        const h = whole ? top : (x === 4 || z === 1 ? top : top + 2 + Math.floor(c.rnd() * 2));
        pillar(c, x, z, h, !whole);
        if (whole && (x !== 3 && z !== 0)) c.L.set(x, top, z, 'bricks_old_slab');
      }
      for (const [x, z] of [[3, -1], [3, 1], [4, 0]]) { c.L.set(x, 5, z, 'air'); c.L.set(x, 6, z, 'air'); if (whole) c.L.set(x, 7, z, 'bricks_old_slab'); }
      c.L.set(2, 1, 0, 'air'); c.L.set(2, 2, 0, 'air'); // проход из нефа в башню
      // внутри: дерево или алтарь
      if (whole) {
        for (let k = 0; k < 2; k++) c.L.set(-1, k, 0, 'log');
        for (const [dx, dy, dz] of [[0, 2, 0], [1, 2, 0], [-1, 2, 0], [0, 2, 1], [0, 2, -1], [0, 3, 0], [1, 3, 0], [0, 3, 1], [0, 4, 0]]) c.L.set(-1 + dx, dy, dz, 'leaves_gold');
        c.dec('leaf_litter', -2, 0, 1, yaw(c));
      } else {
        c.L.set(-1, 0, 0, 'bricks_old_slab');
        c.dec('candles_group', -1, 0.5, 0, yaw(c));
        c.dec('candle_tall', -1, 0, 2, 0);
        c.dec('stone_bowl', -2, 0, -2, yaw(c));
      }
      onWall(c, 'ivy', -1, 2, 3, '+z');
      onWall(c, 'ivy', 2, 3.5, -1, '-z');
      onWall(c, 'ivy', -4, 1.5, -2, '-x');
      scatter(c, [['rubble', 5, 2], ['rubble', -5, -4], ['bricks_loose', 0, 4], ['pot_clay', 3, 2], ['pot_clay', -5, 1], ['skull', 1, -4], ['bones', 5, -2]]);
      for (const [x, z] of [[-5, 3], [2, -4], [5, 0]]) c.L.set(x, 0, z, pick(c, ['tall_grass', 'dry_grass', 'fern']));
    },
  },
  {
    id: 'ruin_tower_round', title: 'Башня круглая', category: 'руины', hint: 'полая башня 5 × 5 высотой до 8, верх обломан, вход с −X', variants: 2,
    build(c) {
      const cells: [number, number][] = [];
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) + Math.abs(z) >= 2 && Math.abs(x) + Math.abs(z) <= 3) cells.push([x, z]);
      for (const [x, z] of cells) {
        const a = Math.atan2(z, x);
        const h = 5 + Math.round(1.5 + 1.5 * Math.sin(a * 2 + c.seed));
        pillar(c, x, z, h);
      }
      for (let y = 0; y <= 2; y++) c.L.set(-2, y, 0, 'air');
      for (const [x, z] of [[2, 0], [0, 2], [0, -2]]) { c.L.set(x, 3, z, 'air'); c.L.set(x, 4, z, 'air'); }
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) c.L.set(x, -1, z, c.rnd() < 0.7 ? 'tiles' : 'tiles_broken');
      onWall(c, 'ivy', 0, 2.5, 2, '+z');
      onWall(c, 'ivy', 2, 4, -1, '+x');
      scatter(c, [['rubble', -3, 2], ['bricks_loose', 3, 2], ['pot_clay', 0, 0], ['skull', -3, -2]]);
      c.L.set(3, 0, -1, 'tall_grass');
    },
  },
  {
    id: 'ruin_platform_statues', title: 'Площадка со статуями', category: 'руины', hint: 'плиты 8 × 6 на блок выше, лестница с −X, две статуи в капюшонах', variants: 2,
    build(c) {
      for (let x = -3; x <= 4; x++) for (let z = -2; z <= 3; z++) {
        c.L.set(x, -1, z, 'bricks_old');
        const v = c.rnd();
        c.L.set(x, 0, z, v < 0.7 ? 'tiles' : v < 0.9 ? 'tiles_broken' : 'bricks_old');
      }
      for (let z = -1; z <= 2; z++) { c.L.set(-4, 0, z, 'tiles_stairs', 0); }
      c.dec('statue_hooded', 4, 1, -2, 90);
      c.dec('statue_hooded', 4, 1, 3, 90);
      c.dec('stone_bowl', 1, 1, 0, yaw(c));
      scatter(c, [['bricks_loose', -5, -2], ['rubble', 5, 1]]);
      c.L.set(pick(c, [0, 2]), 1, pick(c, [-2, 3]), 'tall_grass');
    },
  },
  {
    id: 'ruin_altar', title: 'Алтарь', category: 'руины', hint: 'плита со свечами и запечённым золотым светом, чаша и череп — «место благодати»', variants: 2,
    build(c) {
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) c.L.set(x, -1, z, c.rnd() < 0.75 ? 'tiles' : 'tiles_broken');
      c.L.set(0, 0, 0, 'bricks_old_slab');
      c.dec('candles_group', 0, 0.5, 0, yaw(c));
      c.dec('candle_tall', -1, 0, 1, 0);
      c.dec('candles_row', 1, 0, -1, 90);
      c.dec('stone_bowl', 1, 0, 1, yaw(c));
      c.dec('skull', -1, 0, -1, yaw(c));
    },
  },
  {
    id: 'graveyard_small', title: 'Кладбище', category: 'руины', hint: '6 × 6: надгробия трёх форм, кресты, мёртвое дерево, свечи у могилы', variants: 2,
    build(c) {
      const graves: [number, number][] = [[-2, -2], [0, -2], [2, -2], [-2, 1], [1, 1], [-1, 3]];
      for (const [x, z] of graves) c.dec(pick(c, ['gravestone', 'gravestone', 'gravestone_wide', 'gravestone_fallen', 'grave_cross']), x, 0, z, 180 + Math.floor(c.rnd() * 30 - 15));
      c.dec('tree_dead', 3, 0, 2, yaw(c));
      c.dec('candles_group', 0, 0, 1, yaw(c));
      scatter(c, [['bones', 2, 3], ['skull', -3, 0]]);
      for (const [x, z] of [[-3, -1], [1, -1], [3, -2], [-2, 2]]) c.L.set(x, 0, z, pick(c, ['dry_grass', 'dry_grass', 'tall_grass']));
    },
  },
  {
    id: 'ruin_bowls', title: 'Чаши и горшки', category: 'руины', hint: 'каменная чаша и глиняные горшки у обломка кладки', variants: 2,
    build(c) {
      c.dec('stone_bowl', 0, 0, 0, yaw(c));
      c.dec('pot_clay', 1, 0, 1, yaw(c));
      if (c.rnd() < 0.6) c.dec('pot_clay', -1, 0, 1, yaw(c));
      c.dec('bricks_loose', 1, 0, -1, yaw(c));
      c.L.set(-1, 0, -1, brick(c, 0));
    },
  },
];
