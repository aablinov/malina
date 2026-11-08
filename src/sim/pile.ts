import * as THREE from 'three';
import type { EntityState } from '../net/snapshot.ts';
import { r2 } from './entities.ts';
import type { SimWorld } from './world.ts';

/**
 * Raspberry piles from fallen enemies (wiki/design-tower-defence.md): pop up from a point, fall, lie; fly to the nearest
 * hero on their feet within `reach` (the harvest after a wave — from anywhere), whoever picks it up gets the raspberries (`onPick`)
 */
export interface Pile {
  id: string;
  n: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Cannot be picked up yet: just popped out */
  lock: number;
  t: number;
  landed: boolean;
}

export class Piles {
  readonly list: Pile[] = [];
  /** From how far raspberries are pulled to the hero, m */
  reach = 6;
  /** Harvest: for this many more seconds all raspberries fly to the hero from anywhere */
  harvestT = 0;
  /** Picked up by the hero of seat `seat` */
  onPick: ((seat: number, n: number, at: THREE.Vector3) => void) | null = null;
  private readonly w: SimWorld;

  constructor(w: SimWorld) { this.w = w; }

  /** Raspberries from a rank-and-file mob: one pile pops up from the point */
  drop(at: THREE.Vector3, n: number): Pile | null {
    if (n <= 0) return null;
    const r = this.w.rng;
    const p: Pile = { id: this.w.id('p'), n, pos: at.clone().setY(at.y + 0.8), vel: new THREE.Vector3((r() - 0.5) * 2, 4, (r() - 0.5) * 2), lock: 0.4, t: 0, landed: false };
    this.list.push(p);
    this.w.emit({ t: 'pile.drop', id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, n });
    return p;
  }

  /** Harvest (wave beaten) */
  harvest(sec = 4): void { this.harvestT = Math.max(this.harvestT, sec); }

  clear(): void { this.list.length = 0; }

  update(dt: number): void {
    this.harvestT = Math.max(0, this.harvestT - dt);
    const heroes = this.w.h.heroes();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.lock -= dt;
      p.vel.y -= 12 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const floor = this.w.floor(p.pos.x, p.pos.z, p.pos.y) + 0.14;
      if (p.pos.y < floor) {
        p.pos.y = floor;
        if (!p.landed && p.vel.y < -1) { p.landed = true; this.w.emit({ t: 'pile.land', id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z }); }
        if (Math.abs(p.vel.y) > 1.5) { p.vel.y = -p.vel.y * 0.3; p.vel.x *= 0.5; p.vel.z *= 0.5; }
        else { p.vel.y = 0; const k = Math.exp(-6 * dt); p.vel.x *= k; p.vel.z *= k; }
      }
      // to the nearest hero on their feet
      let to: (typeof heroes)[number] | null = null, d = Infinity;
      for (const h of heroes) {
        if (h.down) continue;
        const dh = Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z);
        if (dh < d) { d = dh; to = h; }
      }
      const reach = this.harvestT > 0 ? Infinity : this.reach;
      if (p.lock <= 0 && to && d < reach) {
        const pull = to.pos.clone().setY(to.pos.y + 0.6).sub(p.pos).setLength((reach === Infinity ? 14 + d : Math.min(10, 3 + (reach - d) * 6)) * dt);
        p.pos.add(pull);
        if (d < 0.6) {
          this.list.splice(i, 1);
          this.w.emit({ t: 'pile.pick', id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, n: p.n, seat: to.seat });
          this.onPick?.(to.seat, p.n, p.pos);
        }
      }
    }
  }

  entities(out: EntityState[]): void {
    for (const p of this.list) out.push({ id: p.id, x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z), n: p.n });
  }
}
