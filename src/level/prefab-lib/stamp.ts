import type { DecorItem, Level, LevelEntity } from '../level.ts';
import { blockDef } from '../palette.ts';
import type { PrefabData } from './types.ts';

/** Turn a prefab by quarter quarters around the vertical through the anchor cell: (dx, dz) → (−dz, dx), like blocks, where 90° takes +X to +Z */
export function rotatePrefab(u: PrefabData, quarter: number): PrefabData {
  const q = ((quarter % 4) + 4) % 4;
  if (!q) return u;
  const turn = (x: number, z: number): [number, number] => { for (let i = 0; i < q; i++) [x, z] = [-z, x]; return [x, z]; };
  return {
    ...u,
    cells: u.cells.map(([dx, dy, dz, n, r]) => { const [x, z] = turn(dx, dz); return [x, dy, z, n, blockDef(n).rotatable ? (r + q) % 4 : r]; }),
    decor: u.decor.map((d) => {
      const [x, z] = turn(d.pos[0], d.pos[2]);
      const rot = [...(d.rot ?? [0])]; rot[0] = ((rot[0] ?? 0) + 90 * q) % 360;
      const out: DecorItem = { ...d, pos: [x, d.pos[1], z], rot };
      if (d.on) { const [ox, oz] = turn(d.on[0], d.on[2]); out.on = [ox, d.on[1], oz]; }
      return out;
    }),
    entities: u.entities.map((e) => { const [x, z] = turn(e.x, e.z); return { ...e, x, z, ...(e.rot !== undefined ? { rot: (e.rot + 90 * q) % 360 } : {}) }; }),
  };
}

/** Place a prefab with its anchor at cell (x, y, z): cells via level.set (the editor records them for undo), decor and light are returned shifted */
export function stampPrefab(L: Level, u: PrefabData, x: number, y: number, z: number, quarter = 0): { decor: DecorItem[]; entities: LevelEntity[] } {
  const p = rotatePrefab(u, quarter);
  for (const [dx, dy, dz, n, r] of p.cells) L.set(x + dx, y + dy, z + dz, n, r);
  const decor = p.decor.map((d) => ({ ...JSON.parse(JSON.stringify(d)) as DecorItem, pos: [d.pos[0] + x, d.pos[1] + y, d.pos[2] + z] as [number, number, number], ...(d.on ? { on: [d.on[0] + x, d.on[1] + y, d.on[2] + z] as [number, number, number] } : {}) }));
  const entities = p.entities.map((e) => ({ ...JSON.parse(JSON.stringify(e)) as LevelEntity, x: e.x + x, y: e.y + y, z: e.z + z }));
  return { decor, entities };
}
