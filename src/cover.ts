import * as THREE from 'three';
import { raycastObstacles, type Obstacle } from './collision';
import type { NavGrid } from './nav';

/**
 * Точки укрытий: вдоль каждой грани препятствия, на шаг от неё.
 * Укрытие защищает от угрозы, если препятствие стоит между точкой и угрозой.
 */
export interface CoverPoint {
  pos: THREE.Vector3;
  /** Высота укрытия: низкое (за ним приседают) или высокое */
  h: number;
  /** Наружная нормаль грани — от препятствия к точке */
  nx: number;
  nz: number;
  obstacle: Obstacle;
}

export function buildCoverPoints(obstacles: readonly Obstacle[], nav: NavGrid): CoverPoint[] {
  const out: CoverPoint[] = [];
  for (const o of obstacles) {
    if (Math.max(o.hx, o.hz) > 12) continue; // стены по периметру — не укрытия
    const c = Math.cos(o.rot), s = Math.sin(o.rot);
    const toWorld = (lx: number, lz: number) => new THREE.Vector3(o.x + lx * c + lz * s, 0, o.z - lx * s + lz * c);
    const sides: [number, number, number][] = [[1, 0, o.hz], [-1, 0, o.hz], [0, 1, o.hx], [0, -1, o.hx]];
    for (const [ax, az, halfLen] of sides) {
      const off = 0.75;
      const n = Math.max(1, Math.floor((halfLen * 2) / 0.9));
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : -halfLen + 0.3 + (k / (n - 1)) * (halfLen * 2 - 0.6);
        const lx = ax !== 0 ? ax * (o.hx + off) : t;
        const lz = az !== 0 ? az * (o.hz + off) : t;
        const p = toWorld(lx, lz);
        if (!nav.walkable(p.x, p.z)) continue;
        const nrm = toWorld(ax, az).sub(toWorld(0, 0));
        out.push({ pos: p, h: o.h, nx: nrm.x, nz: nrm.z, obstacle: o });
      }
    }
  }
  return out;
}

/** Укрытие закрывает от угрозы: точка за препятствием, луч к угрозе упирается в него */
export function protects(c: CoverPoint, threat: THREE.Vector3): boolean {
  const dx = threat.x - c.pos.x, dz = threat.z - c.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.5) return false;
  if ((dx * c.nx + dz * c.nz) / d > -0.25) return false;
  return raycastObstacles(c.pos.x, c.pos.z, dx / d, dz / d, Math.min(d, 2), 0.6, [c.obstacle]) !== null;
}
