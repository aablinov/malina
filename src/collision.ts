import * as THREE from 'three';

/**
 * An obstacle is a rotated rectangle on the XZ plane with a height.
 * Bodies (hero, beetles) are circles. Bullets fly horizontally at their own height
 * and hit only obstacles taller than themselves: you can shoot over low cover standing, but not crouching.
 */
export interface Obstacle {
  x: number;
  z: number;
  /** Half-sizes along its own axes */
  hx: number;
  hz: number;
  /** Rotation around Y, rad */
  rot: number;
  /** Height for bullets, m (visually the wall may be lower — like walls on the camera side) */
  h: number;
  /** Obstacle bottom, m (decor on the second tier); absent — stands on the arena floor, blocks at any height */
  y0?: number;
}

/** A 1.6 m tall body with feet at height y overlaps the obstacle vertically */
export function overlapsY(o: Obstacle, y: number, bodyH = 1.6): boolean {
  return o.y0 === undefined || (y + bodyH > o.y0 && y < o.y0 + o.h);
}

export function obstacle(x: number, z: number, w: number, d: number, h: number, rotDeg = 0): Obstacle {
  return { x, z, hx: w / 2, hz: d / 2, rot: THREE.MathUtils.degToRad(rotDeg), h };
}

/** Push a circle out of obstacles. Returns true if there was contact. Sliding along walls comes for free. */
export function resolveCircle(pos: THREE.Vector3, r: number, obs: readonly Obstacle[]): boolean {
  let touched = false;
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    for (const o of obs) {
      if (!overlapsY(o, pos.y)) continue;
      const c = Math.cos(o.rot), s = Math.sin(o.rot);
      const dx = pos.x - o.x, dz = pos.z - o.z;
      // into the obstacle's local axes (rotate by −rot)
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
        // centre inside — push out through the nearest face
        const px = o.hx - Math.abs(lx), pz = o.hz - Math.abs(lz);
        if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; }
        else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; }
      }
      // back into world axes (rotate by +rot)
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
  /** Surface normal at the hit point (XZ) */
  nx: number;
  nz: number;
  obstacle: Obstacle;
}

/** A ray at height y against obstacles; dir — a unit vector in XZ */
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

/** A ray against a circle; returns the entry distance or −1 */
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

/** Distance from a point to the obstacle edge (0 — inside) */
export function distToObstacle(x: number, z: number, o: Obstacle): number {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const dx = x - o.x, dz = z - o.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const qx = Math.max(Math.abs(lx) - o.hx, 0), qz = Math.max(Math.abs(lz) - o.hz, 0);
  return Math.hypot(qx, qz);
}
