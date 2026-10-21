import type { AmmoType } from './weapons';
import type { BeetleKind } from './beetle';

export type RegionId = 'meadow' | 'farm' | 'ravine' | 'hive';
export type Ground = RegionId;

export interface Region {
  id: RegionId;
  name: string;
  desc: string;
  /** Прямоугольник региона в мировых координатах */
  x0: number; z0: number; x1: number; z1: number;
  /** Точка высадки */
  drop: { x: number; z: number };
  /** Цвет на карте */
  color: string;
}

export interface Camp {
  id: number;
  region: RegionId;
  x: number;
  z: number;
}

export type ObstacleKind = 'tree' | 'rock' | 'pillar' | 'hive' | 'fence' | 'cabin' | 'hay' | 'deadtree';
export interface Obstacle { kind: ObstacleKind; x: number; z: number; r: number; seed: number; rot?: number }
export interface Cache { x: number; z: number; type: AmmoType | 'health'; amount: number }

export interface MissionMap {
  name: string;
  /** Половина размера игрового поля */
  halfX: number;
  halfZ: number;
  regions: Region[];
  camps: Camp[];
  obstacles: Obstacle[];
  caches: Cache[];
}

/** Детерминированный генератор случайных чисел */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export const HALF_X = 60;
export const HALF_Z = 40;

export const REGIONS: Region[] = [
  { id: 'meadow', name: 'Малиновая опушка', desc: 'Луга и рощи. Спокойное место для начала.', x0: -HALF_X, z0: 0, x1: 0, z1: HALF_Z, drop: { x: -38, z: 26 }, color: '#6fbf4a' },
  { id: 'farm', name: 'Старая ферма', desc: 'Брошенные поля, изгороди и сараи.', x0: 0, z0: 0, x1: HALF_X, z1: HALF_Z, drop: { x: 36, z: 28 }, color: '#d8a83e' },
  { id: 'ravine', name: 'Каменный овраг', desc: 'Скалы и узкие проходы, много укрытий.', x0: -HALF_X, z0: -HALF_Z, x1: 0, z1: 0, drop: { x: -40, z: -26 }, color: '#9aa0aa' },
  { id: 'hive', name: 'Ульевые холмы', desc: 'Гнёзда жуков. Здесь их больше всего.', x0: 0, z0: -HALF_Z, x1: HALF_X, z1: 0, drop: { x: 38, z: -26 }, color: '#b05ad8' },
];
export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r])) as Record<RegionId, Region>;

const CAMP_POS: [RegionId, number, number][] = [
  ['meadow', -50, 10], ['meadow', -22, 34], ['meadow', -12, 12],
  ['farm', 14, 34], ['farm', 24, 10], ['farm', 52, 14],
  ['ravine', -52, -12], ['ravine', -30, -34], ['ravine', -14, -14],
  ['hive', 14, -12], ['hive', 24, -36], ['hive', 54, -8],
];

export function regionAt(x: number, z: number): RegionId {
  if (z >= 0) return x < 0 ? 'meadow' : 'farm';
  return x < 0 ? 'ravine' : 'hive';
}

/** Уровень лагеря: чем дальше от точки высадки, тем опаснее */
export function campLevel(c: { x: number; z: number }, drop: { x: number; z: number }): number {
  const d = Math.hypot(c.x - drop.x, c.z - drop.z);
  return Math.max(1, Math.min(6, 1 + Math.floor(d / 20)));
}

/** Сколько и каких жуков охраняет лагерь этого уровня */
export function campGuards(level: number, r: () => number): BeetleKind[] {
  const n = 3 + Math.round(level * 1.6);
  const pool: [BeetleKind, number][] = [
    ['small', 4], ['spitter', 1 + level * 0.6], ['fast', level >= 2 ? 1 + level * 0.4 : 0],
    ['big', level >= 3 ? level * 0.35 : 0], ['bombardier', level >= 3 ? level * 0.4 : 0],
  ];
  const total = pool.reduce((s, [, w]) => s + w, 0);
  const out: BeetleKind[] = [];
  for (let i = 0; i < n; i++) {
    let x = r() * total;
    for (const [k, w] of pool) { x -= w; if (x <= 0) { out.push(k); break; } }
    if (out.length < i + 1) out.push('small');
  }
  return out;
}

/** Тестовая карта: 4 региона, 12 лагерей, ~10–15 минут игры */
export function buildTestMap(): MissionMap {
  const r = rng(20261021);
  const camps: Camp[] = CAMP_POS.map(([region, x, z], id) => ({ id, region, x, z }));
  const obstacles: Obstacle[] = [];
  const caches: Cache[] = [];

  const free = (x: number, z: number, pad: number) =>
    Math.abs(x) < HALF_X - 2 && Math.abs(z) < HALF_Z - 2 &&
    Math.abs(x) > 2.5 && Math.abs(z) > 2.5 && // дороги между регионами свободны
    camps.every((c) => Math.hypot(c.x - x, c.z - z) > 8 + pad) &&
    REGIONS.every((g) => Math.hypot(g.drop.x - x, g.drop.z - z) > 6 + pad) &&
    obstacles.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + pad + 0.6);

  const scatter = (region: Region, kind: ObstacleKind, n: number, rad: [number, number]) => {
    for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
      const x = region.x0 + 2 + r() * (region.x1 - region.x0 - 4);
      const z = region.z0 + 2 + r() * (region.z1 - region.z0 - 4);
      const rr = rad[0] + r() * (rad[1] - rad[0]);
      if (!free(x, z, rr)) continue;
      obstacles.push({ kind, x, z, r: rr, seed: Math.floor(r() * 1e6), rot: r() * Math.PI });
      i++;
    }
  };
  const [meadow, farm, ravine, hive] = REGIONS;
  scatter(meadow, 'tree', 34, [0.7, 1.0]);
  scatter(meadow, 'rock', 8, [0.6, 0.9]);
  // ферма: сарай, сено, изгороди
  obstacles.push({ kind: 'cabin', x: 44, z: 32, r: 3.1, seed: 1 });
  scatter(farm, 'hay', 10, [0.7, 0.8]);
  scatter(farm, 'fence', 14, [1.6, 1.6]);
  scatter(farm, 'tree', 12, [0.7, 1.0]);
  // овраг: каменные столбы и скалы
  scatter(ravine, 'pillar', 36, [0.8, 1.6]);
  scatter(ravine, 'rock', 16, [0.6, 0.9]);
  scatter(ravine, 'deadtree', 8, [0.5, 0.5]);
  // ульи
  scatter(hive, 'hive', 9, [1.6, 2.2]);
  scatter(hive, 'pillar', 12, [0.8, 1.2]);
  scatter(hive, 'deadtree', 10, [0.5, 0.5]);

  // ящики с патронами и аптечки
  const ammoTypes: AmmoType[] = ['bullets', 'bullets', 'shells', 'cells', 'grenades'];
  for (const g of REGIONS) {
    for (let i = 0, tries = 0; i < 6 && tries < 200; tries++) {
      const x = g.x0 + 4 + r() * (g.x1 - g.x0 - 8);
      const z = g.z0 + 4 + r() * (g.z1 - g.z0 - 8);
      if (!free(x, z, 0.5)) continue;
      const type: AmmoType | 'health' = i === 0 ? 'health' : ammoTypes[Math.floor(r() * ammoTypes.length)];
      const amount = type === 'health' ? 35 : type === 'bullets' ? 60 : type === 'shells' ? 12 : type === 'cells' ? 80 : 4;
      caches.push({ x, z, type, amount });
      i++;
    }
  }
  return { name: 'Малиновая долина', halfX: HALF_X, halfZ: HALF_Z, regions: REGIONS, camps, obstacles, caches };
}
