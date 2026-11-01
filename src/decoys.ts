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
  /** Осадная цель (башня обороны куста): её видят только охотники (Mob.hunter), остальные идут мимо */
  readonly siege?: boolean;
  hurt(dmg: number, from: THREE.Vector3): void;
  /** Заморозить на sec секунд (башня); false — не замерзает */
  freeze?(sec: number): boolean;
}

export const decoys: Decoy[] = [];

export function addDecoy(d: Decoy): () => void {
  decoys.push(d);
  return () => { const i = decoys.indexOf(d); if (i >= 0) decoys.splice(i, 1); };
}

/**
 * Цель моба в точке at: приманка или null (тогда — герой). hunter — моб охотится на башни: осадные приманки видит,
 * если они по высоте не дальше reachY (башню на стене замка с земли не загрызть, но снежком достать можно)
 */
export function pickDecoy(at: THREE.Vector3, hero: THREE.Vector3, aggro: number, hunter = false, reachY = 1.5): Decoy | null {
  const dh = Math.hypot(hero.x - at.x, hero.z - at.z);
  let best: Decoy | null = null, bd = Infinity;
  for (const d of decoys) {
    if (!d.alive) continue;
    if (d.siege && (!hunter || Math.abs(d.pos.y - at.y) > reachY)) continue;
    const dist = Math.hypot(d.pos.x - at.x, d.pos.z - at.z);
    // приманка с taunt видна из своего радиуса, даже если он больше aggro моба (куст малины и мобы на марше)
    if (dist > Math.max(aggro, d.taunt ?? 0)) continue;
    // приманка с taunt перебивает героя в своём радиусе
    const score = d.taunt && dist < d.taunt ? dist - 100 : dist;
    if (score < bd) { bd = score; best = d; }
  }
  return best && (bd < 0 || bd < dh) ? best : null;
}
