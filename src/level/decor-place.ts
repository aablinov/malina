import { raycastVoxels } from './collide.ts';
import type { Anchor } from './decor.ts';
import type { DecorItem, Level } from './level.ts';
import { DIRS } from './obj.ts';

/**
 * Куда встанет предмет декора под лучом (редактор): луч по вокселям → клетка и грань → точка на грани с шагом 1/16.
 * floor — только на верх блока (или на плоскость y = 0 в пустоте), wall — на боковую грань (предмет разворачивается
 * спиной к стене), ceiling — на низ блока. Поворот пользователя (extra: [рыск, наклон, крен]) добавляется к повороту от грани.
 */

const P = 1 / 16;
const snap = (v: number): number => Math.round(v / P) * P;
/** Рыск, при котором +Z формы смотрит по нормали грани (0 +X, 1 +Z, 2 −X, 3 −Z) */
const WALL_YAW = [-90, 0, 90, 180];

export interface DecorPlacement { pos: [number, number, number]; rot: number[]; on?: [number, number, number] }

export function placeDecor(L: Level, anchor: Anchor, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, extra: readonly number[] = [0, 0, 0], maxY = Infinity): DecorPlacement | null {
  const h = raycastVoxels(L, o.x, o.y, o.z, d.x, d.y, d.z, 300, maxY);
  const rot = (base: number) => {
    const r = [base + (extra[0] ?? 0), extra[1] ?? 0, extra[2] ?? 0].map((v) => ((v % 360) + 540) % 360 - 180);
    while (r.length > 1 && r[r.length - 1] === 0) r.pop();
    return r[0] === 0 && r.length === 1 ? [] : r;
  };
  if (!h || h.face < 0) {
    if (anchor !== 'floor' || d.y > -1e-4) return null;
    const t = -o.y / d.y;
    if (t <= 0 || t > 300) return null;
    return { pos: [snap(o.x + d.x * t), 0, snap(o.z + d.z * t)], rot: rot(0) };
  }
  const px = o.x + d.x * h.t, py = o.y + d.y * h.t, pz = o.z + d.z * h.t;
  const n = DIRS[h.face];
  const cell: [number, number, number] = [h.x, h.y, h.z];
  if (anchor === 'floor' && h.face === 4) {
    // верх блока: у полублоков и ступеней — по высоте столкновения, у заборов — по клетке
    const def = L.defAt(h.x, h.y, h.z);
    const top = def.collide > 0 && def.collide < 1 ? def.collide : 1;
    return { pos: [snap(px), h.y + top, snap(pz)], rot: rot(0), on: cell };
  }
  if (anchor === 'ceiling' && h.face === 5) return { pos: [snap(px), h.y, snap(pz)], rot: rot(0), on: cell };
  if (anchor === 'wall' && h.face < 4) {
    // плоскость грани — точно, остальные координаты — с шагом 1/16
    const fx = n[0] ? h.x + n[0] * 0.5 : snap(px), fz = n[2] ? h.z + n[2] * 0.5 : snap(pz);
    return { pos: [fx, snap(py), fz], rot: rot(WALL_YAW[h.face]), on: cell };
  }
  return null;
}

/** Совпадает ли клетка, к которой прикреплён предмет */
export const attachedTo = (d: DecorItem, x: number, y: number, z: number): boolean => !!d.on && d.on[0] === x && d.on[1] === y && d.on[2] === z;
