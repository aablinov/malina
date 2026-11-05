import { Level } from '../level/level.ts';
import { hash2, landscape, noise2, rockOutcrop, surfaceAt, tree } from '../level/kit.ts';

/**
 * Procedural open world (wiki/dev-performance.md, "Regions"): a region is a 32 × 32 m column, generated from the seed
 * as the player approaches and deterministic from (seed, rx, rz). The relief is noise in world coordinates, so the seams between
 * regions match; the landscape is computed on a window with a MARGIN of slack and only the region's own column is copied into the world.
 * Roads every 64 m on a grid, lakes by coarse noise, trees and flowers by cell hash, crates, barrels and chests near roads
 * and lakes (region entities with stable ids "rx,rz:n").
 */

export const REGION = 32;
const MARGIN = 12;
const ROAD = 64;

export interface RegionEntity { id: string; kind: 'barrel' | 'crate' | 'chest' | 'terminal'; x: number; z: number; rot: number }
export interface RegionData { entities: RegionEntity[] }
export interface RegionSource {
  generate(rx: number, rz: number, into: Level): RegionData;
  /** The region is being unloaded: remove what is not chunks (decor) from the level */
  release?(rx: number, rz: number, from: Level): void;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** xorshift from the region seed — for the number and places of items */
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
      const tmp = new Level('region');
      const ax0 = x0 - MARGIN, az0 = z0 - MARGIN, ax1 = x1 + MARGIN, az1 = z1 + MARGIN;
      // base: lakes, sand on the shores, roads, grass; dirt beneath
      for (let z = az0; z <= az1; z++) for (let x = ax0; x <= ax1; x++) {
        const lk = lake(x, z);
        if (lk < 0.3) { tmp.set(x, -1, z, 'water'); tmp.set(x, -2, z, 'sand'); continue; }
        tmp.set(x, -1, z, lk < 0.35 ? 'sand' : road(x, z) ? 'path' : 'grass');
        tmp.set(x, -2, z, 'dirt');
      }
      // hilly landscape in 0.5 m slabs; flat by roads and water
      landscape(tmp, ax0, az0, ax1, az1, 0, { seed, layers: 3, scale: 28, fade: 6, stone: 0.3, dry: 0.12, daisies: 0.04, flat: (x, z) => road(x, z) || lake(x, z) < 0.38 });
      // a rock in every fourth region, entirely inside its own column
      if (hash2(rx, rz, seed + 9) < 0.25) {
        const cx = x0 + 10 + Math.floor(hash2(rx, rz, seed + 10) * 12), cz = z0 + 10 + Math.floor(hash2(rx, rz, seed + 11) * 12);
        if (lake(cx, cz) > 0.42 && !road(cx, cz)) rockOutcrop(tmp, cx, cz, 4 + hash2(rx, rz, seed + 12) * 2, 3 + hash2(rx, rz, seed + 13) * 2, 3, surfaceAt(tmp, cx, cz), seed + rx * 31 + rz * 17);
      }
      // trees and flowers by cell hash, trees no closer than 3 m to the region edge (the crown stays inside)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const y = surfaceAt(tmp, x, z);
        if (tmp.nameAt(x, y - 1, z) !== 'grass' || !tmp.isAir(x, y, z)) continue;
        const h = hash2(x, z, seed + 21);
        const inner = x - x0 >= 3 && x1 - x >= 3 && z - z0 >= 3 && z1 - z >= 3;
        if (inner && h < 0.012 && lake(x, z) > 0.45 && !road(x, z)) tree(tmp, x, y, z, 3 + (hash2(x, z, seed + 22) < 0.5 ? 1 : 0), 2);
        else if (h > 0.985) tmp.set(x, y, z, ['flower_red', 'flower_blue', 'flower_white', 'flower_yellow'][Math.floor(hash2(x, z, seed + 23) * 4)]);
        else if (h > 0.94) tmp.set(x, y, z, 'tall_grass');
      }
      // only the region's own column goes into the world
      tmp.forEach((x, y, z, id, rot) => { if (x >= x0 && x <= x1 && z >= z0 && z <= z1) into.set(x, y, z, tmp.palette[id], rot); });
      // items: on flat grass, no closer than 4 m to the edge; each has a stable id
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
          // not right next to each other
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
