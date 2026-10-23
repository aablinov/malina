import * as THREE from 'three';

/**
 * Препятствие — повёрнутый прямоугольник на плоскости XZ с высотой.
 * Тела (герой, жуки) — круги. Пули летят горизонтально на своей высоте
 * и задевают только препятствия выше себя: из-за низкого укрытия стоя стрелять можно, присев — нет.
 */
export interface Obstacle {
  x: number;
  z: number;
  /** Половины размеров вдоль своих осей */
  hx: number;
  hz: number;
  /** Поворот вокруг Y, рад */
  rot: number;
  /** Высота для пуль, м (визуально стена может быть ниже — как стены со стороны камеры) */
  h: number;
  /** Низ препятствия, м (декор на втором ярусе); нет — стоит на полу арены, мешает на любой высоте */
  y0?: number;
}

/** Тело ростом 1,6 м на высоте ног y задевает препятствие по вертикали */
export function overlapsY(o: Obstacle, y: number, bodyH = 1.6): boolean {
  return o.y0 === undefined || (y + bodyH > o.y0 && y < o.y0 + o.h);
}

export function obstacle(x: number, z: number, w: number, d: number, h: number, rotDeg = 0): Obstacle {
  return { x, z, hx: w / 2, hz: d / 2, rot: THREE.MathUtils.degToRad(rotDeg), h };
}

/** Вытолкнуть круг из препятствий. Возвращает true, если было касание. Скольжение вдоль стен получается само. */
export function resolveCircle(pos: THREE.Vector3, r: number, obs: readonly Obstacle[]): boolean {
  let touched = false;
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    for (const o of obs) {
      if (!overlapsY(o, pos.y)) continue;
      const c = Math.cos(o.rot), s = Math.sin(o.rot);
      const dx = pos.x - o.x, dz = pos.z - o.z;
      // в локальные оси препятствия (поворот на −rot)
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const qx = THREE.MathUtils.clamp(lx, -o.hx, o.hx);
      const qz = THREE.MathUtils.clamp(lz, -o.hz, o.hz);
      let nx = lx - qx, nz = lz - qz;
      const d2 = nx * nx + nz * nz;
      if (d2 >= r * r) continue;
      let push: number;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nx /= d; nz /= d;
        push = r - d;
      } else {
        // центр внутри — выталкиваем по ближайшей грани
        const px = o.hx - Math.abs(lx), pz = o.hz - Math.abs(lz);
        if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; }
        else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; }
      }
      // обратно в мировые оси (поворот на +rot)
      const wx = nx * c + nz * s;
      const wz = -nx * s + nz * c;
      pos.x += wx * push;
      pos.z += wz * push;
      any = touched = true;
    }
    if (!any) break;
  }
  return touched;
}

export interface RayHit {
  t: number;
  /** Нормаль поверхности в точке попадания (XZ) */
  nx: number;
  nz: number;
  obstacle: Obstacle;
}

/** Луч на высоте y против препятствий; dir — единичный вектор в XZ */
export function raycastObstacles(ox: number, oz: number, dx: number, dz: number, maxT: number, y: number, obs: readonly Obstacle[]): RayHit | null {
  let best: RayHit | null = null;
  for (const o of obs) {
    if (o.y0 === undefined ? y >= o.h : y >= o.y0 + o.h || y < o.y0) continue;
    const c = Math.cos(o.rot), s = Math.sin(o.rot);
    const rx = ox - o.x, rz = oz - o.z;
    const lox = rx * c - rz * s, loz = rx * s + rz * c;
    const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
    let tmin = 0, tmax = best ? best.t : maxT;
    let axis = -1, sign = 0;
    let ok = true;
    for (let a = 0; a < 2; a++) {
      const p = a === 0 ? lox : loz, d = a === 0 ? ldx : ldz, h = a === 0 ? o.hx : o.hz;
      if (Math.abs(d) < 1e-9) { if (p < -h || p > h) { ok = false; break; } continue; }
      let t1 = (-h - p) / d, t2 = (h - p) / d;
      let sg = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = sg; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { ok = false; break; }
    }
    if (!ok || axis < 0 || tmin <= 1e-6) continue;
    const lnx = axis === 0 ? sign : 0, lnz = axis === 1 ? sign : 0;
    best = { t: tmin, nx: lnx * c + lnz * s, nz: -lnx * s + lnz * c, obstacle: o };
  }
  return best;
}

/** Луч против круга; возвращает расстояние до входа или −1 */
export function raycastCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, r: number): number {
  const fx = ox - cx, fz = oz - cz;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  return c < 0 ? 0 : -1;
}
