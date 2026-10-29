import { jungleGroundAt, rockOutcrop } from '../kit.ts';
import { bake, stampInto, type BuildCtx, type Builder } from './build.ts';
import { onWall, pillar, wallRun, type Mat } from './builders-ruins.ts';

/**
 * Биом «джунгли с кристаллами» (wiki/design-prefab-library.md, раздел «Биомы»; референс 16 — MCD, храм в джунглях).
 * Земля `jungle_floor` в контуре с рваным краем, широкие деревья с корнями-контрфорсами и плоской кроной, заросли,
 * светящиеся кристаллы (слой `glow` + запечённый бирюзовый свет), храм из бирюзово-серого камня с резьбой и мхом —
 * через помощники руин с материалом `TEMPLE`. Композиция `temple_ruins_jungle` вложена из средних пресетов.
 */

const pick = <T,>(c: BuildCtx, list: T[]): T => list[Math.floor(c.rnd() * list.length)];
const yaw = (c: BuildCtx): number => Math.floor(c.rnd() * 360);
/** Материал храма для pillar / wallRun / arch */
export const TEMPLE: Mat = { full: 'temple_stone', low: 'temple_stone_mossy', cracked: 'temple_stone_carved', stairs: 'temple_stone_stairs', slab: 'temple_stone_slab' };
/** Реестр строителей — передаётся из builders.ts (композиция вкладывает средние по id) */
let ALL: Builder[] = [];
const find = (id: string): Builder => { const b = ALL.find((b) => b.id === id); if (!b) throw new Error(`Нет строителя «${id}»`); return b; };
/** Вложить средний пресет по id строителя (вариант — своё зерно, поворот — четверти) */
function use(c: BuildCtx, id: string, x: number, z: number, quarter = 0, seed?: number): void {
  const b = find(id);
  stampInto(c, bake(b, seed ?? 1 + Math.floor(c.rnd() * (b.variants ?? 1))), x, z, quarter);
}

const GROUND_J = new Set(['jungle_floor', 'jungle_floor_red', 'moss_teal', 'moss_block']);
/** Земля джунглей в эллипсе rx × rz с рваным краем (клетки y = −1): мозаика блоков по шуму (jungleGroundAt), воду и камень не трогаем */
function jungleGround(c: BuildCtx, rx: number, rz: number, cx = 0, cz = 0): void {
  for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) for (let z = Math.floor(cz - rz - 1); z <= Math.ceil(cz + rz + 1); z++) {
    const e = ((x + 0.5 - cx) / rx) ** 2 + ((z + 0.5 - cz) / rz) ** 2;
    if (e <= 1 + (c.rnd() - 0.5) * 0.35 && c.L.nameAt(x, -1, z) === 'air') c.L.set(x, -1, z, jungleGroundAt(x, z, c.seed * 11));
  }
}
/** Подлесок: папоротники, лианы, цветы, мох и малые кристаллы на свободных клетках земли в радиусе r */
function undergrowth(c: BuildCtx, n: number, r: number, crystals = 0.08): void {
  for (let i = 0; i < n; i++) {
    const x = Math.round((c.rnd() - 0.5) * 2 * r), z = Math.round((c.rnd() - 0.5) * 2 * r);
    if (c.L.nameAt(x, 0, z) !== 'air' || !GROUND_J.has(c.L.nameAt(x, -1, z))) continue;
    const v = c.rnd();
    if (v < crystals) c.L.set(x, 0, z, 'crystal_small');
    else if (v < 0.4) c.L.set(x, 0, z, 'fern_big');
    else if (v < 0.55) c.L.set(x, 0, z, 'fern');
    else if (v < 0.7) c.L.set(x, 0, z, 'moss_carpet');
    else if (v < 0.85) c.L.set(x, 0, z, 'flower_pink');
    else c.L.set(x, 0, z, 'vine');
  }
}
/** Плоская широкая крона: эллипс радиуса r в два слоя (нижний полнее), шапки — leaves_jungle */
function canopy(c: BuildCtx, x: number, y: number, z: number, r: number): void {
  for (const [dy, rr] of [[0, r], [1, r - 1.2], [-1, r - 2.2]] as [number, number][]) {
    if (rr <= 0) continue;
    const ri = Math.ceil(rr);
    for (let dx = -ri; dx <= ri; dx++) for (let dz = -ri; dz <= ri; dz++) {
      if (dx * dx + dz * dz > rr * rr + 0.3 + (c.rnd() - 0.5) * 0.7) continue;
      if (c.L.nameAt(x + dx, y + dy, z + dz) === 'air') c.L.set(x + dx, y + dy, z + dz, 'leaves_jungle');
    }
  }
}
/** Большое дерево джунглей: ствол 2 × 2 из log_jungle высотой h, корни-контрфорсы, плоская крона 7 × 7 */
export function jungleTreeBig(c: BuildCtx, x: number, z: number, h: number): void {
  for (let k = 0; k < h; k++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) c.L.set(x + dx, k, z + dz, 'log_jungle');
  // контрфорсы: по блоку бревна у подножия с четырёх сторон и декор корней
  for (const [dx, dz] of [[-1, 0], [2, 1], [1, -1], [0, 2]]) {
    if (c.rnd() < 0.85) c.L.set(x + dx, 0, z + dz, 'log_jungle');
    if (c.rnd() < 0.4) c.L.set(x + dx, 1, z + dz, 'log_jungle');
  }
  c.dec('roots_big', x + 1, 0, z + 1, yaw(c));
  canopy(c, x + 1, h, z + 1, 3.6);
  // лианы свисают с кроны
  for (let i = 0; i < 3; i++) { const dx = pick(c, [-3, -2, 3, 4]), dz = pick(c, [-3, 4, -2, 3]); if (c.L.nameAt(x + dx, h - 1, z + dz) !== 'air') c.dec('vines_hanging', x + dx, h - 1, z + dz, yaw(c), [x + dx, h - 1, z + dz]); }
}
/** Малое дерево: ствол 1 × 1 высотой h, крона 5 × 5 */
export function jungleTreeSmall(c: BuildCtx, x: number, z: number, h: number): void {
  for (let k = 0; k < h; k++) c.L.set(x, k, z, 'log_jungle');
  canopy(c, x, h, z, 2.4);
  if (c.rnd() < 0.6) c.L.set(x + pick(c, [-1, 1]), 0, z + pick(c, [-1, 1]), 'log_jungle');
}
/** Кристаллы блоками с мхом вокруг: центр — большой, по краю малые и декор */
function crystalPatch(c: BuildCtx, r: number, big: number): void {
  jungleGround(c, r + 0.5, r + 0.5);
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) if (Math.abs(x) + Math.abs(z) <= r && c.rnd() < 0.6) c.L.set(x, -1, z, 'moss_block');
  c.L.set(0, 0, 0, 'crystal');
  if (big > 1) { c.L.set(1, 0, 0, 'crystal'); c.L.set(0, 1, 0, 'crystal'); }
  if (big > 2) { c.L.set(-1, 0, 1, 'crystal'); c.L.set(1, 0, -1, 'crystal'); }
  c.dec('crystal_cluster', pick(c, [-r, r]), 0, pick(c, [-1, 1]), yaw(c));
  c.dec('crystal_shard', pick(c, [-1, 1]), 0, pick(c, [-r, r]), yaw(c));
  undergrowth(c, r * 4, r, 0.35);
}
/** Храмовый пол в прямоугольнике: плиты храмового камня, местами мшистый и резной, в дырах земля с мхом */
function templeFloor(c: BuildCtx, x0: number, z0: number, x1: number, z1: number): void {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const v = c.rnd();
    c.L.set(x, -1, z, v < 0.55 ? 'temple_stone' : v < 0.75 ? 'temple_stone_mossy' : v < 0.82 ? 'temple_stone_carved' : 'jungle_floor');
    if (v >= 0.82 && c.rnd() < 0.6) c.L.set(x, 0, z, pick(c, ['fern_big', 'moss_carpet', 'fern', 'flower_pink']));
  }
}
/** Ступенчатая пирамида: уровни level по кругу, лестница с −Z в середине, верх — площадка */
function pyramid(c: BuildCtx, half: number, levels: number): void {
  for (let k = 0; k < levels; k++) {
    const h = half - k;
    for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) {
      const edge = Math.abs(x) === h || Math.abs(z) === h;
      const v = c.rnd();
      c.L.set(x, k, z, edge && v < 0.15 ? 'temple_stone_mossy' : edge && v < 0.3 ? 'temple_stone_carved' : 'temple_stone');
    }
    // лестница с +Z (лицо витрины): ступени на внешнем ряду, высокая половина к −Z — поворот 3 (+X → −Z)
    for (const x of [-1, 0, 1]) c.L.set(x, k, h, 'temple_stone_stairs', 3);
  }
}

/** Строители джунглей; all — реестр (композиция вкладывает средние по id) */
export function jungleBuilders(all: Builder[]): Builder[] {
  ALL = all;
  return [
  {
    id: 'jungle_tree_big', title: 'Дерево джунглей большое', category: 'джунгли', hint: 'ствол 2 × 2 высотой 6, корни-контрфорсы, плоская крона 7 × 7, лианы, подлесок', variants: 2,
    build(c) {
      jungleGround(c, 4.2, 4.2);
      jungleTreeBig(c, -1, -1, 5 + Math.floor(c.rnd() * 2));
      undergrowth(c, 10, 3.5);
      c.dec('fern_cluster', 2, 0, -2, yaw(c));
      if (c.rnd() < 0.6) c.dec('log_mossy_fallen', -3, 0, 2, pick(c, [10, 80]));
    },
  },
  {
    id: 'jungle_tree_small', title: 'Дерево джунглей малое', category: 'джунгли', hint: 'ствол 4, крона 5 × 5, папоротники и цветы у корней', variants: 2,
    build(c) {
      jungleGround(c, 2.8, 2.8);
      jungleTreeSmall(c, 0, 0, 3 + Math.floor(c.rnd() * 2));
      undergrowth(c, 6, 2.5);
      c.dec('fern_cluster', pick(c, [-2, 2]), 0, pick(c, [-1, 2]), yaw(c));
    },
  },
  {
    id: 'jungle_thicket', title: 'Заросли', category: 'джунгли', hint: '8 × 8: папоротники, лианы, розовые цветы, мох, бревно во мху, малые кристаллы', variants: 2,
    build(c) {
      jungleGround(c, 4.2, 4.2);
      for (let i = 0; i < 4; i++) { const x = -3 + Math.floor(c.rnd() * 7), z = -3 + Math.floor(c.rnd() * 7); if (c.L.nameAt(x, 0, z) === 'air') { c.L.set(x, 0, z, 'leaves_jungle'); if (c.rnd() < 0.4) c.L.set(x, 1, z, 'leaves_jungle'); } }
      undergrowth(c, 26, 3.8, 0.12);
      c.dec('log_mossy_fallen', pick(c, [-2, 1]), 0, pick(c, [-2, 2]), pick(c, [20, 70, 110]));
      c.dec('fern_cluster', 2, 0, 2, yaw(c));
      c.dec('fern_cluster', -3, 0, -1, yaw(c));
      c.dec('mushrooms_glow', pick(c, [-1, 3]), 0, pick(c, [-3, 1]), yaw(c));
    },
  },
  {
    id: 'crystal_cluster_small', title: 'Кристаллы малые', category: 'джунгли', hint: '3 × 3: кристалл блоком, гроздь и обломок на мху, запечённый бирюзовый свет', variants: 2,
    build(c) { crystalPatch(c, 1, 1); },
  },
  {
    id: 'crystal_cluster_big', title: 'Кристаллы большие', category: 'джунгли', hint: '5 × 5: пять кристаллов блоками в два яруса, гроздь, обломок, мох и малые кристаллы вокруг', variants: 2,
    build(c) { crystalPatch(c, 2, 3); c.dec('crystal_cluster', 2, 0, -2, yaw(c)); },
  },
  {
    id: 'crystal_cave_mouth', title: 'Вход в кристальную пещеру', category: 'джунгли', hint: '8 × 6: скала во мху с проёмом 2 × 2 с +Z, внутри кристаллы светятся, лианы над входом', variants: 2,
    build(c) {
      jungleGround(c, 5, 4);
      rockOutcrop(c.L, 0, -1, 3.6, 2.4, 4, 0, c.seed * 7);
      // мох на верхушке вместо травы; проём 2 × 2 с +Z (лицо витрины) вглубь до z = −1
      c.L.forEach((x, y, z) => { if (c.L.nameAt(x, y, z) === 'cliff_grass') c.L.set(x, y, z, 'cliff_jungle'); });
      for (let y = 0; y <= 1; y++) for (const x of [-1, 0]) for (let z = -1; z <= 3; z++) c.L.set(x, y, z, 'air');
      for (const x of [-1, 0]) for (let z = -1; z <= 3; z++) c.L.set(x, -1, z, c.rnd() < 0.5 ? 'moss_block' : 'jungle_floor');
      c.L.set(-1, 0, -1, 'crystal'); c.L.set(0, 1, -1, 'crystal');
      c.L.set(-2, 0, 0, 'crystal_small'); c.L.set(1, 0, 0, 'crystal_small');
      c.dec('crystal_cluster', 0, 0, 0, yaw(c));
      c.dec('crystal_shard', -1, 0, 2, yaw(c));
      c.dec('vines_hanging', -1, 2, 2, 0, [-1, 2, 2]);
      c.dec('vines_wall', 2, 1.8, 2.5, 0, [2, 1, 2]);
      c.dec('vines_wall', -3, 1.6, 2.5, 0, [-3, 1, 2]);
      undergrowth(c, 10, 4.5);
      c.dec('fern_cluster', 3, 0, 3, yaw(c));
    },
  },
  {
    id: 'temple_wall_carved', title: 'Стена храма резная', category: 'джунгли', hint: '7 × 3 вдоль X: храмовый камень с резным рядом, гуляющая высота, лианы и мох у подножия', variants: 2,
    build(c) {
      jungleGround(c, 4.5, 2.2);
      wallRun(c, [[-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0]], 2, 3, TEMPLE);
      for (let x = -3; x <= 3; x++) if (c.L.nameAt(x, 1, 0) !== 'air' && c.rnd() < 0.7) c.L.set(x, 1, 0, 'temple_stone_carved');
      onWall(c, 'vines_wall', pick(c, [-2, 2]), 2.5, 0, '+z');
      onWall(c, 'vines_wall', pick(c, [-1, 1]), 2, 0, '-z');
      c.dec('rubble', 4, 0, 1, yaw(c));
      undergrowth(c, 8, 4);
    },
  },
  {
    id: 'temple_gate', title: 'Ворота храма', category: 'джунгли', hint: 'два столба 1 × 4 с резными капителями и перемычка над проёмом шириной 2, лианы свисают, идол сбоку', variants: 2,
    build(c) {
      jungleGround(c, 3.5, 2.5);
      for (const x of [-2, 2]) { pillar(c, x, 0, 3, false, TEMPLE); c.L.set(x, 3, 0, 'temple_stone_carved'); c.L.set(x, 4, 0, 'temple_stone_slab'); }
      for (let x = -2; x <= 2; x++) c.L.set(x, 4, 0, x === 0 ? 'temple_stone_carved' : 'temple_stone');
      c.L.set(-1, 3, 0, 'temple_stone_stairs', 0); c.L.set(1, 3, 0, 'temple_stone_stairs', 2);
      c.dec('vines_hanging', 0, 4, 0, yaw(c), [0, 4, 0]);
      c.dec('vines_hanging', pick(c, [-1, 1]), 3, 0, yaw(c), [pick(c, [-1, 1]), 3, 0]);
      c.dec('idol_head', 3, 0, 1, 180 + Math.floor(c.rnd() * 40 - 20));
      c.L.set(-3, 0, -1, 'crystal_small');
      undergrowth(c, 6, 3);
    },
  },
  {
    id: 'temple_pyramid_small', title: 'Пирамида храма', category: 'джунгли', hint: '9 × 9: три ступени храмового камня, лестница с +Z, наверху алтарь с кристаллом и свечами, мох и лианы', variants: 2,
    build(c) {
      jungleGround(c, 5.5, 5.5);
      pyramid(c, 4, 3);
      for (let x = -4; x <= 4; x++) for (const z of [-4, 4]) if (c.rnd() < 0.35) c.L.set(x, 0, z, 'temple_stone_mossy');
      c.L.set(0, 3, 0, 'temple_stone_carved');
      c.L.set(0, 4, 0, 'crystal');
      c.dec('candles_group', -1, 3, 1, yaw(c));
      c.dec('candles_row', 1, 3, -1, 90);
      c.dec('crystal_shard', 1, 3, 1, yaw(c));
      onWall(c, 'vines_wall', pick(c, [-3, 3]), 0.5, -4, '-z');
      onWall(c, 'vines_wall', 4, 1.5, pick(c, [-2, 2]), '+x');
      c.dec('idol_head', -3, 0, 5, 180);
      c.dec('rubble', 5, 0, -3, yaw(c));
      undergrowth(c, 8, 5.5);
    },
  },
  {
    id: 'temple_altar_crystal', title: 'Алтарь с кристаллом', category: 'джунгли', hint: '3 × 3: плита храмового камня, кристалл, свечи, обломки — бирюзовый запечённый свет', variants: 2,
    build(c) {
      jungleGround(c, 2.2, 2.2);
      templeFloor(c, -1, -1, 1, 1);
      c.L.set(0, 0, 0, 'temple_stone_carved');
      c.L.set(0, 1, 0, 'crystal');
      c.dec('candles_group', -1, 0, 1, yaw(c));
      c.dec('candle_tall', 1, 0, -1, 0);
      c.dec('crystal_shard', 1, 0, 1, yaw(c));
      c.L.set(-1, 0, -1, 'crystal_small');
    },
  },
  {
    id: 'temple_column_row', title: 'Колонны храма', category: 'джунгли', hint: '8 м вдоль X: столбы храмового камня с резными капителями, один обрушен, плиты под ними', variants: 2,
    build(c) {
      jungleGround(c, 5, 2.5);
      templeFloor(c, -4, -1, 3, 1);
      const broken = pick(c, [0, 1, 2, 3]);
      for (let i = 0; i < 4; i++) {
        const x = -3 + i * 2;
        if (i === broken) { pillar(c, x, 0, 1, false, TEMPLE); c.dec('column_fallen', x + 0.5, 0, 2, pick(c, [0, 15])); c.dec('rubble', x, 0, 1, yaw(c)); continue; }
        pillar(c, x, 0, 3, false, TEMPLE); c.L.set(x, 3, 0, 'temple_stone_carved'); if (c.rnd() < 0.5) c.L.set(x, 4, 0, 'temple_stone_slab');
      }
      onWall(c, 'vines_wall', pick(c, [-3, 1]), 2.5, 0, '+z');
      undergrowth(c, 6, 4.5);
    },
  },
  {
    id: 'jungle_pond', title: 'Пруд в джунглях', category: 'джунгли', hint: '6 × 6: вода с кувшинками, мох и папоротники по берегу, малые кристаллы', variants: 2,
    build(c) {
      jungleGround(c, 4, 3.6);
      for (let x = -3; x <= 2; x++) for (let z = -3; z <= 2; z++) {
        const e = ((x + 0.5) / 2.6) ** 2 + ((z + 0.5) / 2.2) ** 2;
        if (e <= 1 + (c.rnd() - 0.5) * 0.3) { c.L.set(x, -1, z, 'water'); c.L.set(x, -2, z, 'jungle_floor'); }
        else if (c.L.nameAt(x, -1, z) === 'jungle_floor' && c.rnd() < 0.4) c.L.set(x, -1, z, 'moss_teal');
      }
      c.dec('lily_pad', -1, -0.1, 0, yaw(c));
      c.dec('lily_pad', 1, -0.1, -1, yaw(c));
      c.dec('fern_cluster', 3, 0, 1, yaw(c));
      c.dec('fern_cluster', -3, 0, -2, yaw(c));
      c.dec('crystal_shard', pick(c, [-4, 3]), 0, 3, yaw(c));
      c.L.set(2, 0, -3, 'crystal_small');
      undergrowth(c, 8, 4);
    },
  },
  {
    id: 'mossy_boulders', title: 'Валуны во мху', category: 'джунгли', hint: '4 × 4: скала во мху, мох, папоротники, кристалл в щели', variants: 2,
    build(c) {
      jungleGround(c, 2.8, 2.8);
      c.L.set(0, 0, 0, 'cliff_jungle'); c.L.set(1, 0, 0, 'cliff_jungle'); c.L.set(0, 0, 1, 'cliff_jungle');
      c.L.set(0, 1, 0, 'cliff_jungle');
      if (c.rnd() < 0.6) c.L.set(1, 1, 0, 'cliff_stairs', 2);
      c.L.set(-1, 0, 0, 'moss_block'); c.L.set(1, 0, 1, 'cliff_slab');
      c.L.set(-1, 0, 1, 'fern_big'); c.L.set(1, 0, -1, 'crystal_small');
      c.dec('crystal_shard', 2, 0, 1, yaw(c));
      c.dec('fern_cluster', -1, 0, -1, yaw(c));
      c.dec('rock_small', 2, 0, -1, yaw(c));
      undergrowth(c, 5, 2.5);
    },
  },
  {
    id: 'temple_ruins_jungle', title: 'Руины храма в джунглях', category: 'джунгли', hint: '16 × 16: пирамида, ворота, резная стена, колонны, кристаллы, деревья, заросли, пруд', variants: 2,
    build(c) {
      jungleGround(c, 9, 9);
      use(c, 'temple_pyramid_small', 2, 2);
      use(c, 'temple_gate', 2, -6);
      use(c, 'temple_wall_carved', -5, 4, 1);
      use(c, 'temple_column_row', -4, -3, 1);
      use(c, 'crystal_cluster_big', 7, -5);
      use(c, 'crystal_cluster_small', -6, -7);
      use(c, 'jungle_tree_big', -5, 7);
      use(c, 'jungle_tree_small', 7, 6);
      use(c, 'jungle_thicket', 6, 1);
      c.dec('idol_head', -1, 0, -7, 180);
      undergrowth(c, 14, 8);
    },
  },
  ];
}
