import { Level } from './level.ts';
import { PLOTS, SHOP } from '../config.ts';

/**
 * Генератор огорода (хаб): поле с грядками, дорожки, холмы вокруг, деревья, домик.
 * Пишет блоки в Level; в игру попадает уже сохранённая карта assets/maps/garden.json —
 * пересобрать её: `npm run map:garden`.
 */

function hash(x: number, z: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, zi, 7), b = hash(xi + 1, zi, 7), c = hash(xi, zi + 1, 7), d = hash(xi + 1, zi + 1, 7);
  const u = s(fx), v = s(fz);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Радиус карты и половина поля */
export const GARDEN_R = 27, GARDEN_F = 15;
const R = GARDEN_R, F = GARDEN_F;

export function isBed(x: number, z: number): boolean {
  return Math.abs(x) <= 7 && [-4, 0, 4].some((bz) => Math.abs(z - bz) <= 1);
}
function isPath(x: number, z: number): boolean {
  const side = hash(x, z, 3) > 0.35;
  if (Math.abs(z) >= 8 && (x === 0 || (Math.abs(x) === 1 && (side || Math.abs(z) > F)))) return true;
  if (Math.abs(x) >= 10 && (z === 0 || (Math.abs(z) === 1 && (side || Math.abs(x) > F)))) return true;
  if ((Math.abs(z) === 7 && Math.abs(x) <= 9) || (Math.abs(x) === 9 && Math.abs(z) <= 7)) return side || hash(x, z, 4) > 0.5;
  return false;
}
function isEntrance(x: number, z: number): boolean {
  return (Math.abs(x) <= 1 && Math.abs(z) > F) || (Math.abs(z) <= 1 && Math.abs(x) > F);
}

/** Деревья на поле, домик, камни и ящики — вокруг них круглые коллайдеры для пуль (world.ts) */
export const GARDEN_TREES: [number, number][] = [[-13, 6], [5, -13], [-6, -13], [-13, -3]];
export const GARDEN_HOUSE = { x: -11, z: -11, r: 3.1 };
export const GARDEN_ROCKS: [number, number][] = [[-14, 11], [12, -14], [13, 12], [-4, 12], [11, 5]];
export const GARDEN_CRATES: [number, number, number][] = [[-8, 0, -12], [-8, 0, -13], [-8, 1, -13], [-12, 0, -8]];
export const GARDEN_LANTERNS: [number, number][] = [[-9.6, -7.6], [9.6, -7.6], [-9.6, 7.6], [9.6, 7.6], [-3, 14.6], [14.6, -3]];

export function buildGardenLevel(): Level {
  const L = new Level('Огород');
  const heights = new Map<string, number>();
  const H = (x: number, z: number): number => {
    const k = x + ',' + z;
    const cached = heights.get(k);
    if (cached !== undefined) return cached;
    let h = 0;
    const inField = Math.abs(x) <= F && Math.abs(z) <= F;
    if (!inField && !isEntrance(x, z)) {
      const dist = Math.max(Math.abs(x), Math.abs(z)) - F;
      h = 1 + Math.floor(vnoise(x * 0.2, z * 0.2) * 3.2) + Math.floor(dist / 5);
      const nearEntr = (Math.abs(x) === 2 && Math.abs(z) > F) || (Math.abs(z) === 2 && Math.abs(x) > F);
      if (nearEntr) h = Math.min(h, 2);
      const camSide = (x > F && z > -F + 2) || (z > F && x > -F + 2);
      if (camSide) h = dist <= 2 ? 1 : 0;
    }
    heights.set(k, h);
    return h;
  };

  // земля: клетка y = −1 — поверхность на высоте 0; холмы растут вверх
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const h = H(x, z);
    if (h === 0) {
      const inField = Math.abs(x) <= F && Math.abs(z) <= F;
      if (inField && isBed(x, z)) L.set(x, -1, z, 'farm');
      else if (isPath(x, z) || isEntrance(x, z)) L.set(x, -1, z, 'path');
      else L.set(x, -1, z, 'grass');
      continue;
    }
    for (let k = 0; k <= h; k++) {
      const y = k - 1;
      if (k === h) L.set(x, y, z, hash(x, z, 5) < 0.12 ? 'mossy' : 'grass');
      else if (k === h - 1) L.set(x, y, z, 'dirt');
      else L.set(x, y, z, hash(x, z, k) < 0.25 ? 'mossy' : 'stone');
    }
  }

  // деревья
  const addTree = (x: number, z: number, base: number, size = 1) => {
    const t = 3 + Math.floor(hash(x, z, 11) * 2) + (size > 1 ? 1 : 0);
    for (let k = 0; k < t; k++) L.set(x, base + k, z, 'log');
    const r = 2.2 * size, cy = base + t;
    const ri = Math.ceil(r);
    for (let dx = -ri; dx <= ri; dx++) for (let dy = -1; dy <= ri; dy++) for (let dz = -ri; dz <= ri; dz++) {
      const d2 = dx * dx + dy * dy * 1.4 + dz * dz;
      if (d2 > r * r + 0.5) continue;
      if (dx === 0 && dz === 0 && dy < 1) continue;
      if (d2 > r * r * 0.6 && hash(x + dx, z + dz, dy + 20) < 0.35) continue;
      if (L.isAir(x + dx, cy + dy, z + dz)) L.set(x + dx, cy + dy, z + dz, 'leaves');
    }
  };
  const treeSpots: [number, number][] = [];
  for (let x = -R + 1; x <= R - 1; x++) for (let z = -R + 1; z <= R - 1; z++) {
    const far = x < -F - 1 || z < -F - 1;
    if (!far) continue;
    if (Math.abs(x) <= 4 || Math.abs(z) <= 4) continue;
    if (hash(x, z, 33) > 0.09) continue;
    if (treeSpots.some(([a, b]) => Math.abs(a - x) < 4 && Math.abs(b - z) < 4)) continue;
    treeSpots.push([x, z]);
    addTree(x, z, H(x, z), hash(x, z, 1) > 0.6 ? 1.3 : 1);
  }
  for (const [x, z] of GARDEN_TREES) addTree(x, z, 0, 1.1);

  // домик: стены из досок с бревенчатыми углами, дверь и окна, ступенчатая крыша
  const { x: cx, z: cz } = GARDEN_HOUSE;
  for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) {
    const edge = Math.abs(x - cx) === 2 || Math.abs(z - cz) === 2;
    if (!edge) continue;
    const corner = Math.abs(x - cx) === 2 && Math.abs(z - cz) === 2;
    for (let k = 0; k < 3; k++) {
      if (x === cx && z === cz + 2 && k < 2) continue; // дверь
      if (z === cz + 2 && Math.abs(x - cx) === 1 && k === 1) continue; // окна
      if (x === cx + 2 && z === cz && k === 1) continue;
      L.set(x, k, z, corner ? 'log' : 'planks');
    }
  }
  for (let layer = 0; layer < 4; layer++) {
    const r = 3 - layer;
    for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      const dx = Math.abs(x - cx), dz = Math.abs(z - cz);
      if (layer < 3 && dx < r && dz < r) continue;
      // по краю — ступени черепицы, повёрнутые к центру; на углах и верхушке — полублок поверх
      const onEdge = dx === r || dz === r;
      if (!onEdge || layer === 3 || (dx === r && dz === r)) { L.set(x, 3 + layer, z, 'log'); L.set(x, 4 + layer, z, 'roof_slab'); continue; }
      const rot = dx === r ? (x > cx ? 2 : 0) : (z > cz ? 3 : 1);
      L.set(x, 3 + layer, z, 'roof_stairs', rot);
    }
  }
  L.set(cx - 2, 0, cz + 3, 'torch'); L.set(cx + 2, 0, cz + 3, 'torch');
  for (const [x, y, z] of GARDEN_CRATES) L.set(x, y, z, 'crate');
  for (const [x, z] of GARDEN_ROCKS) L.set(x, 0, z, 'mossy');
  L.set(-5, 0, -11, 'campfire');

  // бортики грядок: брус по краю клетки, с двух сторон каждой грядки
  for (const bz of [-4, 0, 4]) for (let x = -7; x <= 7; x++) { L.set(x, 0, bz + 2, 'rail', 0); L.set(x, 0, bz - 2, 'rail', 2); }

  // трава и цветы
  const spots: [number, number, number][] = [...GARDEN_TREES.map(([x, z]) => [x, z, 1.1] as [number, number, number]), [cx, cz, 3.4], [SHOP.x, SHOP.z + 0.3, 1.95], ...GARDEN_LANTERNS.map(([x, z]) => [x, z, 0.65] as [number, number, number])];
  const blocked = (x: number, z: number) => spots.some(([sx, sz, r]) => Math.hypot(sx - x, sz - z) < r) || PLOTS.some((p) => Math.abs(p.x - x) < 1.2 && Math.abs(p.z - z) < 1.2);
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const h = H(x, z);
    const inField = Math.abs(x) <= F && Math.abs(z) <= F;
    if (h === 0 && (isPath(x, z) || isEntrance(x, z) || (inField && isBed(x, z)))) continue;
    if (h === 0 && blocked(x, z)) continue;
    if (!L.isAir(x, h, z) || L.nameAt(x, h - 1, z) !== 'grass') continue;
    const r = hash(x, z, 50);
    if (r < 0.4) L.set(x, h, z, 'tall_grass');
    else if (r < 0.47) L.set(x, h, z, ['flower_red', 'flower_blue', 'flower_white', 'flower_yellow'][Math.floor(hash(x, z, 80) * 4)]);
  }

  L.spawn = [0, 0, 2];
  L.dirty.clear();
  return L;
}
