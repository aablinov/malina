import type { TdLane, TdPad } from '../td/types.ts';
import type { Level } from './level.ts';

/**
 * The Bush Defence sutler (wiki/design-tower-defence.md, section 12) — a spot for his stall: near the hero's spawn point,
 * not on a road, not by a pad, on flat ground with no blocks or decor. Searches in rings out from the preferred point.
 */

const segDist = (px: number, pz: number, a: [number, number], b: [number, number]): number => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
};

/** A free cell for the sutler near (x, z); facing the bush at (bx, bz). null — none found */
export function sutlerSpot(L: Level, lanes: TdLane[], pads: TdPad[], x: number, z: number, bx = 0, bz = 0): { kind: 'sutler'; x: number; z: number; yaw: number } | null {
  const ok = (cx: number, cz: number): boolean => {
    for (const l of lanes) {
      const pts = [...l.points, ...(l.inner ?? [])];
      for (let i = 0; i + 1 < pts.length; i++) if (segDist(cx, cz, pts[i], pts[i + 1]) < 3.5) return false;
    }
    if (pads.some((p) => Math.hypot(p.x - cx, p.z - cz) < 4)) return false;
    if (Math.hypot(cx - bx, cz - bz) < 4.5) return false;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (L.topAt(cx + dx, cz + dz) !== -1) return false;
      for (let y = 0; y < 3; y++) if (!L.isAir(cx + dx, y, cz + dz)) return false;
    }
    return !L.decor.some((d) => Math.hypot(d.pos[0] - cx, d.pos[2] - cz) < 2);
  };
  for (let r = 0; r <= 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const cx = x + dx, cz = z + dz;
    if (ok(cx, cz)) return { kind: 'sutler', x: cx, z: cz, yaw: Math.atan2(bx - cx, bz - cz) };
  }
  return null;
}
