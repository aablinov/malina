import { Level } from '../level/level.ts';
import { hash2, landscape, noise2, rockOutcrop, surfaceAt, tree } from '../level/kit.ts';

/**
 * Процедурный открытый мир (wiki/dev-performance.md, «Регионы»): регион — колонка 32 × 32 м, генерируется по сиду
 * при подходе игрока и детерминирован от (seed, rx, rz). Рельеф — шум в мировых координатах, поэтому стыки между
 * регионами сходятся; ландшафт считается на окне с запасом MARGIN и в мир копируется только своя колонка.
 * Дороги — через каждые 64 м по сетке, озёра — по крупному шуму, деревья и цветы — по хэшу клетки, рядом с дорогой
 * и озером — ящики, бочки и сундуки (сущности региона со стабильными id «rx,rz:n»).
 */

export const REGION = 32;
const MARGIN = 12;
const ROAD = 64;

export interface RegionEntity { id: string; kind: 'barrel' | 'crate' | 'chest'; x: number; z: number; rot: number }
export interface RegionData { entities: RegionEntity[] }
export interface RegionSource {
  generate(rx: number, rz: number, into: Level): RegionData;
  /** Регион выгружается: убрать из уровня то, что не чанки (декор) */
  release?(rx: number, rz: number, from: Level): void;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** xorshift по сиду региона — для числа и мест предметов */
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function worldSource(seed: number): RegionSource {
  const lake = (x: number, z: number) => noise2(x, z, 48, seed + 7);
  const road = (x: number, z: number) => mod(x, ROAD) < 3 || mod(z, ROAD) < 3;
  return {
    generate(rx, rz, into) {
      const x0 = rx * REGION, z0 = rz * REGION, x1 = x0 + REGION - 1, z1 = z0 + REGION - 1;
      const tmp = new Level('регион');
      const ax0 = x0 - MARGIN, az0 = z0 - MARGIN, ax1 = x1 + MARGIN, az1 = z1 + MARGIN;
      // основание: озёра, песок по берегам, дороги, трава; под ними земля
      for (let z = az0; z <= az1; z++) for (let x = ax0; x <= ax1; x++) {
        const lk = lake(x, z);
        if (lk < 0.3) { tmp.set(x, -1, z, 'water'); tmp.set(x, -2, z, 'sand'); continue; }
        tmp.set(x, -1, z, lk < 0.35 ? 'sand' : road(x, z) ? 'path' : 'grass');
        tmp.set(x, -2, z, 'dirt');
      }
      // холмистый ландшафт плитами по 0,5 м; у дорог и воды — ровно
      landscape(tmp, ax0, az0, ax1, az1, 0, { seed, layers: 3, scale: 28, fade: 6, stone: 0.3, dry: 0.12, daisies: 0.04, flat: (x, z) => road(x, z) || lake(x, z) < 0.38 });
      // скала — в каждом четвёртом регионе, целиком внутри своей колонки
      if (hash2(rx, rz, seed + 9) < 0.25) {
        const cx = x0 + 10 + Math.floor(hash2(rx, rz, seed + 10) * 12), cz = z0 + 10 + Math.floor(hash2(rx, rz, seed + 11) * 12);
        if (lake(cx, cz) > 0.42 && !road(cx, cz)) rockOutcrop(tmp, cx, cz, 4 + hash2(rx, rz, seed + 12) * 2, 3 + hash2(rx, rz, seed + 13) * 2, 3, surfaceAt(tmp, cx, cz), seed + rx * 31 + rz * 17);
      }
      // деревья и цветы — по хэшу клетки, деревья не ближе 3 м к краю региона (крона остаётся внутри)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const y = surfaceAt(tmp, x, z);
        if (tmp.nameAt(x, y - 1, z) !== 'grass' || !tmp.isAir(x, y, z)) continue;
        const h = hash2(x, z, seed + 21);
        const inner = x - x0 >= 3 && x1 - x >= 3 && z - z0 >= 3 && z1 - z >= 3;
        if (inner && h < 0.012 && lake(x, z) > 0.45 && !road(x, z)) tree(tmp, x, y, z, 3 + (hash2(x, z, seed + 22) < 0.5 ? 1 : 0), 2);
        else if (h > 0.985) tmp.set(x, y, z, ['flower_red', 'flower_blue', 'flower_white', 'flower_yellow'][Math.floor(hash2(x, z, seed + 23) * 4)]);
        else if (h > 0.94) tmp.set(x, y, z, 'tall_grass');
      }
      // в мир — только своя колонка
      tmp.forEach((x, y, z, id, rot) => { if (x >= x0 && x <= x1 && z >= z0 && z <= z1) into.set(x, y, z, tmp.palette[id], rot); });
      // предметы: на ровной траве, не ближе 4 м к краю; у каждого — стабильный id
      const spots: [number, number][] = [];
      for (let z = z0 + 4; z <= z1 - 4; z++) for (let x = x0 + 4; x <= x1 - 4; x++) {
        if (tmp.nameAt(x, -1, z) === 'grass' && tmp.isAir(x, 0, z) && tmp.isAir(x, 1, z) && lake(x, z) > 0.42) spots.push([x, z]);
      }
      const r = rng(Math.floor(hash2(rx, rz, seed + 30) * 4294967295));
      const entities: RegionEntity[] = [];
      const take = (kind: RegionEntity['kind'], n: number): void => {
        for (let i = 0; i < n && spots.length; i++) {
          const k = Math.floor(r() * spots.length);
          const [x, z] = spots.splice(k, 1)[0];
          // не вплотную друг к другу
          if (entities.some((e) => Math.abs(e.x - x) < 2 && Math.abs(e.z - z) < 2)) continue;
          entities.push({ id: `${rx},${rz}:${entities.length}`, kind, x, z, rot: Math.floor(r() * 4) * 90 + Math.floor(r() * 30) });
        }
      };
      take('crate', Math.floor(r() * 4));
      take('barrel', Math.floor(r() * 3));
      if (r() < 0.35) take('chest', 1);
      return { entities };
    },
  };
}
