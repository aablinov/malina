import type { Level } from './level.ts';

/**
 * Готовые сборки уровня в духе Minecraft Dungeons (wiki/style-world.md): ступенчатые ограды, стога, скалы, реки,
 * мосты, холмы, порталы. Каждая — функция «поставь в эту точку», детерминированная от координат, их можно сочетать.
 * Ими собрана зона «мир» плейграунда (src/level/world-zone.ts); комнатам и генератору этажа они тоже подходят.
 */

export function hash2(x: number, z: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Плавный шум 0..1 с шагом cell (для рваных краёв и высот) */
export function noise2(x: number, z: number, cell: number, seed = 0): number {
  const gx = Math.floor(x / cell), gz = Math.floor(z / cell), fx = x / cell - gx, fz = z / cell - gz;
  const sm = (t: number) => t * t * (3 - 2 * t), u = sm(fx), v = sm(fz);
  const a = hash2(gx, gz, seed), b = hash2(gx + 1, gz, seed), c = hash2(gx, gz + 1, seed), d = hash2(gx + 1, gz + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Ступенчатая ограда, как каменные стены двора на скриншоте 10: высота гуляет блоками от hMin до hMax,
 * перепады сглажены полублоками сверху. Линия от (x0, z0) до (x1, z1) — вдоль X или Z. y — низ (верх пола под ней).
 */
export function steppedWall(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, hMin: number, hMax: number, block = 'wall_stone'): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  const dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const x = x0 + dx * i, z = z0 + dz * i;
    const h = hMin + Math.floor(noise2(i, x * 0.37 + z, 3, 7) * (hMax - hMin + 1));
    for (let k = 0; k < h; k++) L.set(x, y + k, z, block);
    if (hash2(x, z, 8) < 0.35) L.set(x, y + h, z, `${block}_slab`);
  }
}

/** Пол площадки из блока floor в прямоугольнике (включительно) на уровне y */
export function floorRect(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, floor: string): void {
  L.fill(x0, y, z0, x1, y, z1, floor);
}

/** Стог: пирамидка тюков сена по маске рядов снизу вверх ('#' — тюк), как в углу двора на скриншоте 10 */
export function hayStack(L: Level, x: number, y: number, z: number, layers: string[][]): void {
  layers.forEach((rows, k) => rows.forEach((row, dz) => [...row].forEach((c, dx) => { if (c === '#') L.set(x + dx, y + k, z + dz, 'hay'); })));
}

/**
 * Скальный массив (скриншоты 11, 12): прямоугольник x0..x1 × z0..z1, низ на y, высота гуляет по шуму от hMin до hMax.
 * Столбцы целиком светлые или тёмные — читаются вертикальные пласты; верх — скала с травой (бахрома свисает с края).
 */
export function cliffMass(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, hMin: number, hMax: number, seed = 0, dark = 0.25): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    const h = hMin + Math.floor(noise2(x, z, 4, seed) * (hMax - hMin + 0.999));
    const body = hash2(x, z, seed + 1) < dark ? 'cliff_dark' : 'cliff';
    for (let k = 0; k < h - 1; k++) L.set(x, y + k, z, body);
    L.set(x, y + h - 1, z, 'cliff_grass');
  }
}

/** Скальные ступени к реке (скриншот 11, справа): высота падает от hFar к 1 по направлению (dx, dz), шаг ступени — step клеток */
export function cliffSteps(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, hFar: number, dirX: number, step = 2, seed = 0): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    const along = dirX > 0 ? Math.max(x0, x1) - x : x - Math.min(x0, x1);
    const h = Math.max(1, Math.min(hFar, 1 + Math.floor((along + noise2(x, z, 3, seed) * 1.8) / step)));
    for (let k = 0; k < h - 1; k++) L.set(x, y + k, z, hash2(x, z, seed + 2) < 0.2 ? 'cliff_dark' : 'cliff');
    L.set(x, y + h - 1, z, 'cliff_grass');
  }
}

/**
 * Русло реки: в прямоугольнике убирает землю от yGround вниз до воды, ставит реку с течением rot на yWater и песок под ней.
 * Берега — то, что вокруг (трава с бахромой свешивается к воде).
 */
export function riverBed(L: Level, x0: number, z0: number, x1: number, z1: number, yGround: number, yWater: number, rot: number): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    for (let y = yWater + 1; y <= yGround + 4; y++) L.set(x, y, z, 'air');
    L.set(x, yWater, z, 'river', rot);
    L.set(x, yWater - 1, z, 'sand');
  }
}

/** Водопад: стена струй x0..x1 на линии z от yBottom до yTop (включительно) */
export function waterfall(L: Level, x0: number, x1: number, z: number, yBottom: number, yTop: number): void {
  for (let x = x0; x <= x1; x++) for (let y = yBottom; y <= yTop; y++) L.set(x, y, z, 'waterfall');
}

/**
 * Мост вдоль X (скриншот 11): настил x0..x1 × z0..z1 на уровне y (верх — y + 1), брусья по бокам на z0 − 1 и z1 + 1,
 * столбы на брусьях по концам
 */
export function bridgeX(L: Level, x0: number, x1: number, z0: number, z1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) L.set(x, y, z, 'bridge_deck', 1);
    L.set(x, y, z0 - 1, 'bridge_beam', 0);
    L.set(x, y, z1 + 1, 'bridge_beam', 0);
  }
  for (const x of [x0, x1]) for (const z of [z0 - 1, z1 + 1]) L.set(x, y + 1, z, 'bridge_post');
}

/** Лестница из ступеней block_stairs: поднимается по направлению (dx, dz) от (x, y, z) на steps блоков, ширина width по перпендикуляру; под ступенями — block */
export function stairway(L: Level, x: number, y: number, z: number, dx: number, dz: number, steps: number, width: number, block: string): void {
  // ступени поднимаются к +X при rot 0, rot 1 — к +Z, 2 — к −X, 3 — к −Z
  const rot = dx > 0 ? 0 : dz > 0 ? 1 : dx < 0 ? 2 : 3;
  for (let k = 0; k < steps; k++) for (let w = 0; w < width; w++) {
    const cx = x + dx * k + (dz ? w : 0), cz = z + dz * k + (dx ? w : 0);
    for (let j = 0; j < k; j++) L.set(cx, y + j, cz, block);
    L.set(cx, y + k, cz, `${block}_stairs`, rot);
  }
}
