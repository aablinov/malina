import type { Level } from './level.ts';
import type { PgLabel } from './playground-map.ts';
import { bridgeX, cliffMass, floorRect, hash2, hayStack, landscape, noise2, portal, rampart, riverBed, rockOutcrop, stairway, steppedWall, surfaceAt, tree, waterfall } from './kit.ts';

/**
 * Зона «мир» плейграунда за восточной стеной: наборы по скриншотам Minecraft Dungeons (wiki/style-world.md),
 * каждый — 3–4 сочетаемых элемента: двор со складом, река с водопадом и мостом, скалы по краю уровня,
 * холмы со свечами, портал в холме, разные холмы. Собрана сборками из kit.ts.
 */

export type Dec = (name: string, x: number, y: number, z: number, rot?: number, on?: [number, number, number]) => void;

/** Границы зоны: x от X0 до X1, z от −Z до Z (включительно); вход — проём в восточной стене арены на z −1…1 */
export const WORLD = { X0: 26, X1: 76, Z: 24 };

export function buildWorldZone(L: Level, labels: PgLabel[], dec: Dec): void {
  const { X0, X1, Z } = WORLD;
  // земля: трава на y = −1, под ней земля (чтобы русло реки и уступы не висели в пустоте)
  for (let x = X0; x <= X1; x++) for (let z = -Z; z <= Z; z++) { L.set(x, -1, z, 'grass'); L.set(x, -2, z, 'dirt'); L.set(x, -3, z, 'dirt'); }
  // дорога 3 м от проёма через всю зону, край по шуму
  for (let x = X0; x <= X1; x++) for (let z = -3; z <= 3; z++) {
    const n = noise2(x, z, 3, 21);
    if (Math.abs(z) <= 1 || (Math.abs(z) === 2 && n > 0.62)) L.set(x, -1, z, 'path');
  }
  labels.push({ text: 'мир: наборы по скриншотам Minecraft Dungeons', x: X0 + 8, z: 4.4, size: 1 });
  buildTerrain(L, labels);
  buildBounds(L, labels);
  buildYard(L, labels, dec);
  buildRiver(L, labels, dec);
  buildHills(L, labels, dec);
  buildPortal(L, labels, dec);
}

/**
 * Рельеф зоны (скриншоты 13–17) — две сущности. Ландшафт: плиты в 4 слоя по 0,5 м, проходим везде, к дороге, двору,
 * реке и стене со свечами спадает плавно. Скалы: непроходимые каменные массивы поверх ландшафта — по краям, у дороги;
 * в одну встроен портал, на другую ведут земляные ступени.
 */
function buildTerrain(L: Level, labels: PgLabel[]): void {
  const { X0, X1, Z } = WORLD;
  const flat = (x: number, z: number) =>
    Math.abs(z) <= 3 // дорога
    || (x <= 46 && z <= -8) // двор
    || (x >= 49 && x <= 56) // русло, пруд, водопад
    || (x >= 37 && x <= 48 && z >= 4 && z <= 9) // стена со свечами
    || x <= X0 + 1; // у проёма в стене арены
  landscape(L, X0, -Z + 2, X1 - 1, Z - 1, 0, { layers: 4, scale: 28, fade: 6, stone: 0.3, dry: 0.12, daisies: 0.05, seed: 71, flat });
  labels.push({ text: 'ландшафт: плиты по 0,5 м — пройти можно отовсюду', x: 38, z: 23.6, size: 0.7 });
  // скалы по краям ландшафта — непроходимые, с травой сверху
  rockOutcrop(L, 30, 20, 3, 2.5, 4, 0, 81);
  rockOutcrop(L, 73, 17, 3, 4, 5, 0, 82);
  // низкая скала у дороги и земляные ступени на неё (скриншот 15): земля здесь ровная, высоты ступеней точные
  rockOutcrop(L, 35, -6, 3, 1.4, 3, 0, 83);
  for (const sx of [35, 36]) {
    let zf = -3;
    while (zf > -8 && L.nameAt(sx, surfaceAt(L, sx, zf) - 1, zf) !== 'cliff_grass') zf--;
    const hs = surfaceAt(L, sx, zf);
    if (hs > 0 && hs < 6) stairway(L, sx, 0, zf + hs, 0, -1, hs, 1, 'path');
  }
  labels.push({ text: 'скалы непроходимы; на низкую — земляные ступени', x: 37, z: 22.4, size: 0.6 });
}

/** 5. Портал (скриншот 14): в скале к северу от дороги, лицом к дороге — проём с рамой и золотым сиянием, выход прорублен до земли */
function buildPortal(L: Level, labels: PgLabel[], dec: Dec): void {
  rockOutcrop(L, 66, -12, 7, 5, 5, 0, 84);
  portal(L, 66, 0, -6, 2, 3);
  dec('candles_group', 64.4, 0, -3.8);
  dec('candles_group', 69.6, 0, -3.6, 60);
  labels.push({ text: 'портал в скале: рама, сияние, выход к дороге', x: 67, z: 5.4, size: 0.6 });
}

/** 4 и 6. Деревья и флора на террасах; крепостная стена со свечами — свет запечён в камень */
function buildHills(L: Level, labels: PgLabel[], dec: Dec): void {
  const { X0, X1, Z } = WORLD;
  // деревья: по сетке 7 клеток со сдвигом, только на траве террас
  for (let x = X0 + 4; x <= X1 - 4; x += 7) for (let z = -Z + 5; z <= Z - 3; z += 7) {
    const tx = x + Math.floor(hash2(x, z, 81) * 4) - 2, tz = z + Math.floor(hash2(x, z, 82) * 4) - 2;
    const y = surfaceAt(L, tx, tz);
    if (y < 1 || hash2(tx, tz, 83) > 0.33 || L.nameAt(tx, y - 1, tz) !== 'grass' || Math.hypot(tx - 67, tz + 6) < 6) continue;
    tree(L, tx, y, tz, 2, 2);
  }
  // крепостная стена со свечами: свет только запечённый
  rampart(L, 39, 6, 46, 6, 0, 3);
  // зубцы — на x = 39, 42, 45; свечи — между ними
  dec('candles_group', 40, 3, 6);
  dec('candle_tall', 41, 3, 6);
  dec('candles_row', 43.5, 3, 6);
  dec('candles_group', 46, 3, 6, 40);
  dec('candles_group', 38.2, 0, 7.4);
  labels.push({ text: 'стена со свечами: свет запечён в камень', x: 42.5, z: 4.9, size: 0.6 });
}

/**
 * 3. Края уровня (скриншот 12): высокие скалы на дальней стороне (−Z) — массив 2–3 блока толщиной, 5–8 высотой,
 * светлые и тёмные столбы, трава сверху; со стороны камеры (+X, +Z) — низкие скалы в 1–2 блока.
 */
function buildBounds(L: Level, labels: PgLabel[]): void {
  const { X0, X1, Z } = WORLD;
  cliffMass(L, X0, -Z, X1, -Z + 1, -1, 5, 8, 11);
  cliffMass(L, X1, -Z, X1, Z, -1, 1, 2, 12);
  cliffMass(L, X0 + 1, Z, X1, Z, -1, 1, 2, 13);
  labels.push({ text: 'края уровня: скалы, тёмные пласты, трава сверху', x: 40, z: -6.6, size: 0.7 });
}

/** 2. Река (скриншот 11): водопад из скалы, пруд с брызгами, река с течением к +Z, мост с фонарями, скальные ступени к воде */
function buildRiver(L: Level, labels: PgLabel[], dec: Dec): void {
  const Z = WORLD.Z;
  // скала с водопадом: массив до y = 5, у воды по бокам — щёки
  cliffMass(L, 47, -Z, 58, -Z + 2, -1, 7, 7, 21, 0.3);
  for (const x of [51, 54]) for (let y = -1; y <= 5; y++) L.set(x, y, -Z + 3, y === 5 ? 'cliff_grass' : 'cliff');
  for (let z = -Z; z <= -Z + 2; z++) for (const x of [52, 53]) { L.set(x, 5, z, 'river', 1); L.set(x, 4, z, 'sand'); L.set(x, 6, z, 'air'); }
  waterfall(L, 52, 53, -Z + 3, -2, 5);
  // пруд под водопадом и русло на юг (течение к +Z, rot 1), вода на полтора блока ниже земли
  riverBed(L, 50, -Z + 4, 55, -Z + 7, -1, -2, 1);
  riverBed(L, 52, -Z + 8, 53, Z - 1, -1, -2, 1);
  // брызги и пена у подножия, пена по течению
  dec('waterfall_splash', 52.5, -1.15, -Z + 4.2, 0);
  dec('waterfall_foam', 50.8, -1.15, -Z + 5.2, 40);
  dec('waterfall_foam', 54.3, -1.15, -Z + 5.6, -20);
  dec('foam_patch', 52.6, -1.12, -Z + 6.6, 15);
  dec('foam_patch', 52.4, -1.12, -6, 70);
  dec('foam_patch', 52.7, -1.12, 9, 30);
  // мост на дороге
  bridgeX(L, 51, 54, -1, 1, -1);
  dec('lantern_post', 50.3, 0, -3.3, 0);
  dec('lantern_post_double', 55.2, 0, 3.4, 90);
  labels.push({ text: 'река: водопад, брызги, течение, мост, фонари', x: 52.5, z: 5.4, size: 0.7 });
}

/** 1. Двор со складом (скриншот 10): пол с уступом, ступенчатые ограды, стог, ящики, сундук, телеги, скамья, фонари */
function buildYard(L: Level, labels: PgLabel[], dec: Dec): void {
  const x0 = 29, x1 = 43, z0 = -22, z1 = -10;
  floorRect(L, x0, z0, x1, z1, -1, 'yard_floor');
  // уступ на полблока у дальней ограды — как ступени пола на скриншоте
  floorRect(L, x0, z0, x1, z0 + 3, 0, 'yard_floor_slab');
  steppedWall(L, x0 - 1, z0 - 1, x1 + 1, z0 - 1, 0, 2, 3);
  steppedWall(L, x0 - 1, z0, x0 - 1, z1, 0, 1, 2);
  steppedWall(L, x1 + 1, z0, x1 + 1, z1 - 4, 0, 1, 2);
  // стог в углу: пирамидка тюков
  hayStack(L, x0, 0, z0, [['####', '####', '###.'], ['###.', '##..'], ['#...']]);
  labels.push({ text: 'двор: пол, уступ, ограды, сено', x: (x0 + x1) / 2, z: z1 + 1.6, size: 0.8 });
  // склад: ящики, сундук, телеги, скамья
  dec('crates_banded_stack', 40.5, 0.5, -20.6, -10);
  dec('crate_banded', 42.4, 0, -16.2, 12);
  dec('crate_banded', 42.2, 0, -15.1, -4);
  dec('crate_small', 30.6, 0, -14.2, 20);
  dec('crate_small', 31.4, 0, -13.4, -15);
  dec('crate_small', 30.3, 0, -12.8, 40);
  dec('chest', 35.5, 0.5, -21.2, 0);
  dec('cart_loaded', 39.8, 0, -13.2, -35);
  dec('cart', 34.6, 0, -15.6, 120);
  dec('bench', 36.5, 0, -11.2, 0);
  // фонари: двойной у входа во двор, низкий у ограды, настенный на дальней стене
  dec('lantern_post_double', 32.5, 0, -11, 90);
  dec('lantern_short', 43.2, 0, -10.4);
  dec('lantern_wall', 37, 1.9, z0 - 0.5, 0, [37, 1, z0 - 1]);
  labels.push({ text: 'ящики · сундук · телеги · скамья · фонари', x: 37, z: z1 + 2.6, size: 0.6 });
}
