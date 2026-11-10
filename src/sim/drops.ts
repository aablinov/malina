import * as THREE from 'three';
import type { EntityState } from '../net/snapshot.ts';
import { r2 } from './entities.ts';
import type { SimWorld } from './world.ts';

/**
 * Loot from fallen enemies (wiki/design-tower-defence.md, section 19): an item pops out of the body, lies under a pillar of light
 * and flies to the nearest hero on their feet who comes within `reach`; whoever picks it up gets it (`onPick`).
 * Which item — `rollMobLoot` (src/items.ts): gear from the common pool or a relic that drops from enemies only
 */
export interface Drop {
  id: string;
  /** Item id (src/items.ts) */
  def: string;
  /** A relic: the pillar is taller and golden */
  relic: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  lock: number;
  /** Lies for this long, then fades, s */
  left: number;
}

/** Chance that a rank-and-file enemy leaves an item (mini-bosses always do) */
export const DROP_CHANCE = 0.14;
/** How long an item waits on the ground, s */
const DROP_LIFE = 90;
/** No more than this many on the ground: beyond that the oldest gives way */
const MAX_DROPS = 24;

export class Drops {
  readonly list: Drop[] = [];
  reach = 3.5;
  /** Picked up by the hero of seat `seat` */
  onPick: ((seat: number, def: string, relic: boolean) => void) | null = null;
  private readonly w: SimWorld;

  constructor(w: SimWorld) { this.w = w; }

  drop(at: THREE.Vector3, def: string, relic: boolean): Drop {
    const r = this.w.rng;
    const d: Drop = { id: this.w.id('d'), def, relic, pos: at.clone().setY(at.y + 0.9), vel: new THREE.Vector3((r() - 0.5) * 3, 5.5, (r() - 0.5) * 3), lock: 0.7, left: DROP_LIFE };
    if (this.list.length >= MAX_DROPS) this.list.shift();
    this.list.push(d);
    this.w.emit({ t: 'drop.spawn', id: d.id, x: d.pos.x, y: d.pos.y, z: d.pos.z, def, relic });
    return d;
  }

  clear(): void { this.list.length = 0; }

  update(dt: number): void {
    const heroes = this.w.h.heroes();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.lock -= dt; d.left -= dt;
      if (d.left <= 0) { this.list.splice(i, 1); continue; }
      d.vel.y -= 14 * dt;
      d.pos.addScaledVector(d.vel, dt);
      const floor = this.w.floor(d.pos.x, d.pos.z, d.pos.y) + 0.35;
      if (d.pos.y < floor) {
        d.pos.y = floor;
        if (Math.abs(d.vel.y) > 2) { d.vel.y = -d.vel.y * 0.35; d.vel.x *= 0.5; d.vel.z *= 0.5; }
        else { d.vel.y = 0; const k = Math.exp(-6 * dt); d.vel.x *= k; d.vel.z *= k; }
      }
      if (d.lock > 0) continue;
      let to: (typeof heroes)[number] | null = null, best = this.reach;
      for (const h of heroes) {
        if (h.down) continue;
        const dh = Math.hypot(h.pos.x - d.pos.x, h.pos.z - d.pos.z);
        if (dh < best && Math.abs(h.pos.y - d.pos.y) < 3) { best = dh; to = h; }
      }
      if (!to) continue;
      d.pos.add(to.pos.clone().setY(to.pos.y + 0.7).sub(d.pos).setLength(Math.min(best + 0.3, (4 + (this.reach - best) * 5) * dt)));
      if (best < 0.7) {
        this.list.splice(i, 1);
        this.w.emit({ t: 'drop.pick', id: d.id, x: d.pos.x, y: d.pos.y, z: d.pos.z, def: d.def, relic: d.relic, seat: to.seat });
        this.onPick?.(to.seat, d.def, d.relic);
      }
    }
  }

  entities(out: EntityState[]): void {
    for (const d of this.list) out.push({ id: d.id, x: r2(d.pos.x), y: r2(d.pos.y), z: r2(d.pos.z), def: d.def, relic: d.relic ? 1 : 0 });
  }
}
