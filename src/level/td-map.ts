import { Level } from './level.ts';
import { hash2, noise2, rockOutcrop, tree } from './kit.ts';
import { stampPrefab } from './prefab-lib/stamp.ts';
import type { LibraryPrefab } from './prefab-lib/types.ts';
import type { TdLane, TdPad, TdSpec } from '../td/types.ts';

/**
 * Карта «Оборона куста» (wiki/design-tower-defence.md): 96 × 96 м, куст малины в центре, три дороги врагов от логов
 * на краях, площадки под башни вдоль дорог. `npm run map:td` пишет assets/maps/td.json; открыть — `?map=td`.
 * Дороги, площадки и куст — в `meta.td` (src/td/types.ts): режим читает их оттуда, а блоки лишь рисуют то же самое.
 */

export const TD_HALF = 48;

/** Дороги врагов: от логова к кусту (метры) */
export const TD_LANES: TdLane[] = [
  { id: 'west', title: 'Западная тропа', points: [[-45, -8], [-37, -8], [-31, 2], [-22, 5], [-15, -2], [-8, -3], [-3, -1]] },
  { id: 'north', title: 'Северная тропа', points: [[7, -45], [7, -37], [-1, -31], [-4, -22], [3, -15], [4, -8], [1, -3]] },
  { id: 'east', title: 'Восточная тропа', points: [[45, 9], [37, 9], [31, 2], [23, -2], [17, 5], [9, 6], [3, 2]] },
];

/** Площадки под башни: у поворотов дорог, по две-три на дорогу, и у куста */
export const TD_PADS: TdPad[] = [
  // запад
  { x: -40, z: -12 }, { x: -33, z: -3 }, { x: -25, z: 1 }, { x: -18, z: 2 }, { x: -11, z: -7 },
  // север
  { x: 3, z: -40 }, { x: -5, z: -35 }, { x: -8, z: -24 }, { x: 0, z: -19 }, { x: 8, z: -12 },
  // восток
  { x: 40, z: 5 }, { x: 34, z: -2 }, { x: 26, z: 2 }, { x: 20, z: 9 }, { x: 13, z: 2 },
  // у куста
  { x: -6, z: 5 }, { x: 6, z: -4 },
];

export const TD_SPEC: TdSpec = {
  bush: { x: 0, z: 0, hp: 400 },
  lanes: TD_LANES,
  pads: TD_PADS,
  berries: 300,
  rest: 20,
};

export function buildTdMap(lib: Record<string, LibraryPrefab>): Level {
  const L = new Level('Оборона куста');
  const H = TD_HALF;
  const used = new Set<string>();
  const key = (x: number, z: number): string => `${x},${z}`;
  const mark = (x: number, z: number, r: number): void => { for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) used.add(key(xx, zz)); };
  // ---------- земля ----------
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) { L.set(x, -1, z, hash2(x, z, 1) < 0.06 ? 'dirt' : 'grass'); L.set(x, -2, z, 'dirt'); }
  // ---------- дороги врагов: тропа 3 м с рваным краем ----------
  const road = new Set<string>();
  for (const lane of TD_LANES) {
    const pts = lane.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len * 2);
      for (let k = 0; k <= n; k++) {
        const t = k / n, cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        for (let x = Math.floor(cx - 3); x <= Math.ceil(cx + 3); x++) for (let z = Math.floor(cz - 3); z <= Math.ceil(cz + 3); z++) {
          const d = Math.hypot(x - cx, z - cz);
          if (d <= 1.5 || (d <= 2.4 && noise2(x, z, 3, 5) > 0.6)) { road.add(key(x, z)); used.add(key(x, z)); }
        }
      }
    }
  }
  for (const k of road) { const [x, z] = k.split(',').map(Number); L.set(x, -1, z, 'path'); }
  // ---------- площадь куста: плиты, по кругу — забор с проёмами у дорог ----------
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
    const d = Math.hypot(x, z);
    if (d <= 4.3) { L.set(x, -1, z, hash2(x, z, 2) < 0.85 ? 'tiles' : 'tiles_broken'); used.add(key(x, z)); }
  }
  mark(0, 0, 3);
  // ---------- площадки: круг плит с бортиком ----------
  for (const p of TD_PADS) {
    for (let x = p.x - 2; x <= p.x + 2; x++) for (let z = p.z - 2; z <= p.z + 2; z++) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= 1.6) L.set(x, -1, z, 'tiles'); else if (d <= 2.3) L.set(x, -1, z, 'cobble');
    }
    mark(p.x, p.z, 3);
  }
  // ---------- логова: пещера в скале, из неё выходит дорога ----------
  for (const lane of TD_LANES) {
    const [x, z] = lane.points[0], [nx, nz] = lane.points[1];
    const dx = Math.sign(nx - x), dz = Math.sign(nz - z);
    rockOutcrop(L, x - dx * 4, z - dz * 4, dx ? 5 : 7, dz ? 5 : 7, 5, 0, 300 + x + z);
    // проход 3 × 3 внутрь на 5 клеток, пол — камень, в глубине — огонь
    for (let k = -2; k <= 5; k++) for (let w = -1; w <= 1; w++) {
      const cx = x - dx * k + (dz ? w : 0), cz = z - dz * k + (dx ? w : 0);
      for (let y = 0; y < 3; y++) L.set(cx, y, cz, 'air');
      L.set(cx, -1, cz, k < 0 ? 'path' : 'cobble');
      if (k === 5 && L.isAir(cx, 3, cz)) L.set(cx, 3, cz, 'cliff_dark');
      used.add(key(cx, cz));
    }
    L.set(x - dx * 5, 0, z - dz * 5, 'fire');
    L.set(x - dx * 1 + (dz ? 2 : 0), 0, z - dz * 1 + (dx ? 2 : 0), 'torch');
    L.set(x - dx * 1 - (dz ? 2 : 0), 0, z - dz * 1 - (dx ? 2 : 0), 'torch');
  }
  // ---------- край карты: скала ----------
  for (let i = -H - 1; i <= H + 1; i++) for (const [x, z] of [[i, -H - 1], [i, H + 1], [-H - 1, i], [H + 1, i]]) {
    if (L.topAt(x, z) !== null && L.topAt(x, z)! >= 0) continue;
    L.set(x, -1, z, 'cliff'); L.set(x, 0, z, 'cliff'); L.set(x, 1, z, noise2(x, z, 4, 7) > 0.5 ? 'cliff_dark' : 'cliff_grass');
    if (noise2(x, z, 4, 7) > 0.5) L.set(x, 2, z, 'cliff_grass');
  }
  // ---------- декор: деревья, валуны, кусты — на свободной земле ----------
  const free = (x: number, z: number, r: number): boolean => {
    for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) if (Math.abs(xx) > H - 1 || Math.abs(zz) > H - 1 || used.has(key(xx, zz)) || L.topAt(xx, zz) !== -1) return false;
    return true;
  };
  const stamp = (id: string, x: number, z: number, q = 0): boolean => {
    const p = lib[id];
    if (!p) throw new Error(`Нет пресета «${id}»`);
    const rx = Math.ceil(p.size[0] / 2) + 1, rz = Math.ceil(p.size[2] / 2) + 1;
    if (!free(x, z, Math.max(rx, rz))) return false;
    const r = stampPrefab(L, p, x, 0, z, q);
    for (const d of r.decor) L.addDecor(d);
    L.entities.push(...r.entities);
    mark(x, z, Math.max(rx, rz));
    return true;
  };
  const ids = ['tree_oak', 'tree_oak_2', 'boulder_group', 'bush_cluster', 'tree_dead', 'stump_logs', 'boulder_single', 'meadow_flowers'];
  for (let z = -H + 3; z <= H - 3; z += 2) for (let x = -H + 3; x <= H - 3; x += 2) {
    const v = hash2(x, z, 11);
    if (v > 0.16) continue;
    stamp(ids[Math.floor(hash2(x, z, 12) * ids.length)], x, z, Math.floor(hash2(x, z, 13) * 4));
  }
  for (let z = -H + 2; z <= H - 2; z++) for (let x = -H + 2; x <= H - 2; x++) {
    if (!free(x, z, 0)) continue;
    const v = hash2(x, z, 14);
    if (v < 0.04) L.set(x, 0, z, 'tall_grass'); else if (v < 0.055) L.set(x, 0, z, 'flower_red'); else if (v < 0.065) L.set(x, 0, z, 'daisies');
    else if (v < 0.07 && free(x, z, 2)) { tree(L, x, 0, z, 3 + Math.floor(hash2(x, z, 15) * 2), 2); mark(x, z, 2); }
  }
  // ---------- герой, цель ----------
  L.spawn = [0, 0, 7];
  L.meta.spawnYaw = 270;
  L.meta.goal = ['Защити куст малины', 'Оборона куста'];
  L.meta.td = TD_SPEC;
  L.meta.world = { weather: { kind: 'leaves', intensity: 0.3, wind: 1 } };
  return L;
}
