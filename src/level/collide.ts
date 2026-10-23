import type { Level } from './level.ts';
import { obstacle, type Obstacle } from '../collision';
import { DIRS } from './obj.ts';

/**
 * Столкновения тел с блоками уровня, с учётом высоты.
 * Тело — вертикальный цилиндр радиуса r и высоты h, стоящий на y (ноги).
 * Шаг step (0,5 м) — на полублок и ступень поднимаемся не замечая, выше — стена.
 *
 * Все функции принимают мировые координаты: клетка (x, y, z) занимает [x−0,5; x+0,5) × [y; y+1) × [z−0,5; z+0,5).
 */

/** Клетка по мировой координате вдоль X или Z */
export const cell = (w: number): number => Math.floor(w + 0.5);

export const STEP = 0.5;
export const BODY_H = 1.6;

export interface Terrain {
  /** Высота пола под точкой: верх самого высокого блока не выше y + step; −Infinity — пропасть */
  floorAt(x: number, z: number, y: number): number;
  /** Вытолкнуть цилиндр из блоков. true — было касание */
  resolve(pos: { x: number; y: number; z: number }, r: number, h?: number): boolean;
  /** Пересекает ли отрезок (на высоте y) блок выше y */
  blocked(ax: number, az: number, bx: number, bz: number, y: number): boolean;
  /** Точка, где отрезок на высоте y упирается в блок, и нормаль грани; null — путь свободен */
  wallHit(ax: number, az: number, bx: number, bz: number, y: number): { x: number; z: number; nx: number; nz: number } | null;
}

/**
 * Верх блока для столкновений (y + высота) или −Infinity, если проходимый.
 * Для ступеней зависит от точки (px, pz): над низкой половиной 0,5, над высокой 1; без точки — 0,5.
 */
export function collideTop(L: Level, x: number, y: number, z: number, px?: number, pz?: number): number {
  const d = L.defAt(x, y, z);
  if (d.collide <= 0) return -Infinity;
  if (d.stairs && px !== undefined && pz !== undefined) {
    // в локальные координаты формы: клетка [x−0,5; x+0,5) → [0; 1), затем снимаем поворот
    let lx = px - x + 0.5, lz = pz - z + 0.5;
    const rot = L.rotAt(x, y, z);
    for (let k = 0; k < (4 - rot) % 4; k++) { const nx = 1 - lz; lz = lx; lx = nx; }
    return y + (lx >= 0.5 ? 1 : 0.5);
  }
  return y + d.collide;
}

export function terrainOf(L: Level): Terrain {
  const floorAt = (x: number, z: number, y: number): number => {
    const b = L.getBounds();
    if (!b) return -Infinity;
    const cx = cell(x), cz = cell(z);
    const yTop = Math.min(b.maxY, Math.floor(y + STEP));
    for (let cy = yTop; cy >= b.minY; cy--) {
      const t = collideTop(L, cx, cy, cz, x, z);
      if (t > -Infinity && t <= y + STEP + 1e-3) return t;
    }
    return -Infinity;
  };
  const resolve = (pos: { x: number; y: number; z: number }, r: number, h = BODY_H): boolean => {
    const b = L.getBounds();
    if (!b) return false;
    let touched = false;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      const x0 = cell(pos.x - r), x1 = cell(pos.x + r);
      const z0 = cell(pos.z - r), z1 = cell(pos.z + r);
      // блоки ниже ног тоже могут быть высокими (забор 1,5 м), поэтому смотрим на слой ниже
      const y0 = Math.max(b.minY, Math.floor(pos.y + STEP) - 1), y1 = Math.min(b.maxY, Math.floor(pos.y + h - 0.01));
      for (let cy = y0; cy <= y1; cy++) for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
        const top = collideTop(L, cx, cy, cz, pos.x, pos.z);
        if (top <= pos.y + STEP + 1e-3 || cy >= pos.y + h) continue;
        // круг против квадрата клетки
        const qx = Math.max(cx - 0.5, Math.min(pos.x, cx + 0.5)), qz = Math.max(cz - 0.5, Math.min(pos.z, cz + 0.5));
        let nx = pos.x - qx, nz = pos.z - qz;
        const d2 = nx * nx + nz * nz;
        if (d2 >= r * r) continue;
        let push: number;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); nx /= d; nz /= d; push = r - d; }
        else {
          const px = Math.min(pos.x - cx + 0.5, cx + 0.5 - pos.x), pz = Math.min(pos.z - cz + 0.5, cz + 0.5 - pos.z);
          if (px < pz) { nx = pos.x < cx ? -1 : 1; nz = 0; push = px + r; }
          else { nx = 0; nz = pos.z < cz ? -1 : 1; push = pz + r; }
        }
        pos.x += nx * push; pos.z += nz * push;
        any = touched = true;
      }
      if (!any) break;
    }
    return touched;
  };
  const blocked = (ax: number, az: number, bx: number, bz: number, y: number): boolean => {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.25));
    const cy = Math.floor(y);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = cell(ax + (bx - ax) * t), z = cell(az + (bz - az) * t);
      for (let k = cy - 1; k <= cy; k++) if (collideTop(L, x, k, z) > y) return true;
    }
    return false;
  };
  const wallHit = (ax: number, az: number, bx: number, bz: number, y: number) => {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    const h = raycastVoxels(L, ax, y, az, dx / len, 0, dz / len, len, Infinity, (x, cy, z) => collideTop(L, x, cy, z) > y);
    if (!h || h.face < 0 || h.face > 3) return null;
    const n = DIRS[h.face];
    const t = Math.max(0, h.t - 0.02);
    return { x: ax + (dx / len) * t, z: az + (dz / len) * t, nx: -n[0], nz: -n[2] };
  };
  return { floorAt, resolve, blocked, wallHit };
}

/**
 * Потолок над точкой: низ ближайшего твёрдого блока не ниже y + gap (перемычку двери над головой пропускаем).
 * Infinity — над головой открыто. Нужен для разреза дома в рендере.
 */
export function ceilingAt(L: Level, x: number, z: number, y: number, gap = 2.5, range = 8): number {
  const cx = cell(x), cz = cell(z);
  for (let cy = Math.ceil(y + gap); cy <= y + range; cy++) if (L.defAt(cx, cy, cz).collide > 0) return cy;
  return Infinity;
}

export interface VoxelHit { x: number; y: number; z: number; /** Направление грани (индекс DIRS), через которую вошёл луч */ face: number; t: number }

/** Луч по вокселям (DDA): первая клетка, где hit(x, y, z) (по умолчанию — непустая, y ≤ maxY), и грань входа */
export function raycastVoxels(L: Level, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, maxY = Infinity, hit?: (x: number, y: number, z: number) => boolean): VoxelHit | null {
  ox += 0.5; oz += 0.5;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx ? ((sx > 0 ? x + 1 - ox : ox - x) * tdx) : Infinity;
  let ty = dy ? ((sy > 0 ? y + 1 - oy : oy - y) * tdy) : Infinity;
  let tz = dz ? ((sz > 0 ? z + 1 - oz : oz - z) * tdz) : Infinity;
  let face = -1, t = 0;
  const b = L.getBounds();
  for (let i = 0; i < 512; i++) {
    if (b && (hit ? hit(x, y, z) : y <= maxY && L.code(x, y, z) !== 0)) return { x, y, z, face, t };
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; face = sx > 0 ? 2 : 0; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; face = sy > 0 ? 5 : 4; }
    else { z += sz; t = tz; tz += tdz; face = sz > 0 ? 3 : 1; }
    if (t > maxT) return null;
  }
  return null;
}

/**
 * Препятствия для плоских систем (пули, навигация врагов, укрытия): все клетки в прямоугольнике,
 * чей верх выше y0 + step, слитые в полосы вдоль X. Высота препятствия — для пуль, от y0.
 */
export function obstaclesOf(L: Level, y0: number, x0: number, z0: number, x1: number, z1: number): Obstacle[] {
  const out: Obstacle[] = [];
  const b = L.getBounds();
  if (!b) return out;
  const top = (x: number, z: number): number => {
    let best = -Infinity;
    for (let y = Math.max(b.minY, Math.floor(y0 + STEP) - 1); y <= Math.min(b.maxY, Math.floor(y0 + BODY_H)); y++) {
      const t = collideTop(L, x, y, z);
      if (t > best && y < y0 + BODY_H) best = t;
    }
    return best;
  };
  for (let z = z0; z <= z1; z++) {
    let run: number | null = null, runH = 0;
    const flush = (x: number) => {
      if (run === null) return;
      out.push(obstacle((run + x) / 2 - 0.5, z, x - run, 1, runH - y0));
      run = null;
    };
    for (let x = x0; x <= x1 + 1; x++) {
      const t = x <= x1 ? top(x, z) : -Infinity;
      const solid = t > y0 + STEP + 1e-3;
      if (solid && run !== null && Math.abs(t - runH) < 1e-6) continue;
      flush(x);
      if (solid) { run = x; runH = t; }
    }
  }
  return out;
}
