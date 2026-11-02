import type * as THREE from 'three';
import type { Knight } from './knight';

/**
 * Отряд героев в общем бою (wiki/design-multiplayer.md): у хоста кроме своего героя бегают герои гостей.
 * Моб выбирает ближайшего героя на ногах (src/mobs/mob.ts), его удары по герою гостя уходят в `hurt`.
 * В одиночной игре список пуст — моб видит только своего героя, как раньше
 */
export const party: {
  /** Герои гостей у хоста */
  allies: Knight[];
  /** Ударить героя гостя: урон уже с масштабом моба */
  hurt: ((k: Knight, dmg: number, from: THREE.Vector3, knock: number) => void) | null;
} = { allies: [], hurt: null };

/** Ближайший герой на ногах к точке at; все без сил — свой */
export function nearestHero(at: THREE.Vector3, local: Knight): Knight {
  let best = local, bd = local.down ? Infinity : Math.hypot(local.pos.x - at.x, local.pos.z - at.z);
  for (const k of party.allies) {
    if (k.down) continue;
    const d = Math.hypot(k.pos.x - at.x, k.pos.z - at.z);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
