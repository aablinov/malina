import type * as THREE from 'three';

/**
 * Приманки (wiki/design-spells.md, «Базовые заклинания»): призванные волки, элементали и големы. Моб выбирает ближайшую цель
 * из героя и приманок; приманка с taunt тянет на себя всех в этом радиусе, даже если герой ближе (голем держит врагов).
 * Урон моба по приманке идёт в её hurt, а не герою (src/mobs/mob.ts).
 */
export interface Decoy {
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly alive: boolean;
  /** Радиус, в котором приманка перетягивает мобов с героя на себя, м */
  readonly taunt?: number;
  hurt(dmg: number, from: THREE.Vector3): void;
}

export const decoys: Decoy[] = [];

export function addDecoy(d: Decoy): () => void {
  decoys.push(d);
  return () => { const i = decoys.indexOf(d); if (i >= 0) decoys.splice(i, 1); };
}

/** Цель моба в точке at: приманка или null (тогда — герой) */
export function pickDecoy(at: THREE.Vector3, hero: THREE.Vector3, aggro: number): Decoy | null {
  const dh = Math.hypot(hero.x - at.x, hero.z - at.z);
  let best: Decoy | null = null, bd = Infinity;
  for (const d of decoys) {
    if (!d.alive) continue;
    const dist = Math.hypot(d.pos.x - at.x, d.pos.z - at.z);
    if (dist > aggro) continue;
    // приманка с taunt перебивает героя в своём радиусе
    const score = d.taunt && dist < d.taunt ? dist - 100 : dist;
    if (score < bd) { bd = score; best = d; }
  }
  return best && (bd < 0 || bd < dh) ? best : null;
}
