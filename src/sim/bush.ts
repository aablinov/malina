import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { Decoy } from '../decoys.ts';
import type { EntityState } from '../net/snapshot.ts';
import type { SimWorld } from './world.ts';

/** The raspberry bush — what we defend (wiki/design-tower-defence.md, section 4): a decoy with taunt, health from meta.td.bush */
export class SimBush implements Decoy {
  readonly id = 'bush';
  readonly pos: THREE.Vector3;
  readonly radius = 1.3;
  readonly taunt = 7;
  readonly solid: Obstacle;
  hp: number;
  maxHp: number;
  dead = false;
  /** Total damage taken (for tests) */
  taken = 0;
  onDeath?: () => void;
  private readonly w: SimWorld;

  constructor(w: SimWorld, x: number, z: number, hp: number) {
    this.w = w;
    this.pos = new THREE.Vector3(x, 0, z);
    this.hp = this.maxHp = hp;
    this.solid = { x, z, hx: 0.45, hz: 0.45, rot: 0, h: 1.2 };
  }

  get alive(): boolean { return !this.dead; }

  hurt(dmg: number, from: THREE.Vector3): void {
    if (this.dead) return;
    const v = Math.round(dmg);
    this.hp = Math.max(0, this.hp - v);
    this.taken += v;
    this.w.emit({ t: 'bush.hurt', id: this.id, x: this.pos.x, y: this.pos.y, z: this.pos.z, n: v, fx: from.x, fz: from.z });
    if (this.hp <= 0) {
      this.dead = true;
      this.w.emit({ t: 'bush.die', id: this.id, x: this.pos.x, y: this.pos.y, z: this.pos.z });
      this.onDeath?.();
    }
  }

  reset(): void { this.hp = this.maxHp; this.dead = false; }

  entity(out: EntityState[]): void { out.push({ id: this.id, hp: Math.round(this.hp), maxHp: this.maxHp, dead: this.dead ? 1 : 0 }); }
}
