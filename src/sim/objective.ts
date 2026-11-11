import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { ExpLair, ExpSite } from '../expedition/types.ts';
import type { EntityState } from '../net/snapshot.ts';
import type { Target } from '../target.ts';
import { r1 } from './entities.ts';
import type { SimWorld } from './world.ts';

/**
 * Things on an expedition map the squad acts on (wiki/design-expeditions.md, section 4): a lair that is burnt down with weapons,
 * a beacon that is lit and held, the extraction pad. Pure state and records; the rules (src/sim/expedition.ts) decide what they mean
 */

/** From how far a hero uses a beacon, a plot, the pad, a chest */
export const USE_R = 2.6;
/** A beacon charges while a hero stands this close */
export const HOLD_R = 6;
export const BEACON_HOLD = 20;
export const EXTRACT_WAIT = 90;
/** The pad's radius: who stands on it leaves with the balloon */
export const PAD_R = 5;
/** The balloon waits this long for the rest of the squad */
export const BOARD_WAIT = 20;

const NEST_HP = [0, 160, 260, 420];

/** Lair: a mound with health — sword, arrows and spells burn it down */
export class SimNest implements Target {
  readonly id: string;
  readonly size: 1 | 2 | 3;
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly topY = 2.2;
  readonly prop = true;
  readonly solid: Obstacle;
  hp: number;
  maxHp: number;
  dead = false;
  onDeath?: () => void;
  private readonly w: SimWorld;

  constructor(w: SimWorld, l: ExpLair, players: number) {
    this.w = w;
    this.id = l.id;
    this.size = l.size;
    this.pos = new THREE.Vector3(l.x, w.floor(l.x, l.z, 2), l.z);
    this.radius = 1.1 + l.size * 0.3;
    this.hp = this.maxHp = Math.round(NEST_HP[l.size] * (1 + 0.5 * (players - 1)));
    this.solid = { x: l.x, z: l.z, hx: this.radius * 0.7, hz: this.radius * 0.7, rot: 0, h: 1.6, y0: this.pos.y };
  }

  get alive(): boolean { return !this.dead; }

  hit(dmg: number): void {
    if (this.dead) return;
    const v = Math.max(1, Math.round(dmg));
    this.hp = Math.max(0, this.hp - v);
    this.w.emit({ t: 'nest.hurt', id: this.id, x: this.pos.x, y: this.pos.y, z: this.pos.z, n: v });
    if (this.hp > 0) return;
    this.dead = true;
    this.w.emit({ t: 'nest.die', id: this.id, x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.onDeath?.();
  }

  entity(out: EntityState[]): void { out.push({ id: this.id, x: this.pos.x, y: this.pos.y, z: this.pos.z, size: this.size, hp: this.hp, maxHp: this.maxHp, dead: this.dead ? 1 : 0 }); }
}

/** Beacon: lit with F, then held — the charge grows while a hero stands by it and drains when nobody does */
export class SimBeacon {
  readonly id: string;
  readonly pos: THREE.Vector3;
  state: 'dark' | 'lighting' | 'lit' = 'dark';
  charge = 0;

  constructor(w: SimWorld, s: ExpSite) { this.id = s.id; this.pos = new THREE.Vector3(s.x, w.floor(s.x, s.z, 2), s.z); }

  /** true — it has just been lit for good */
  update(dt: number, held: boolean): boolean {
    if (this.state !== 'lighting') return false;
    this.charge = held ? this.charge + dt : Math.max(0, this.charge - dt * 0.5);
    if (this.charge < BEACON_HOLD) return false;
    this.charge = BEACON_HOLD;
    this.state = 'lit';
    return true;
  }

  entity(out: EntityState[]): void { out.push({ id: this.id, x: this.pos.x, y: this.pos.y, z: this.pos.z, state: this.state, k: r1(this.charge / BEACON_HOLD) }); }
}

/** Extraction pad: idle → called (the balloon is on its way) → ready (boarding) → gone */
export class SimExtraction {
  readonly id = 'extract';
  readonly pos: THREE.Vector3;
  state: 'idle' | 'called' | 'ready' | 'gone' = 'idle';
  /** Seconds until the balloon lands, then until it leaves */
  t = 0;

  constructor(w: SimWorld, s: ExpSite) { this.pos = new THREE.Vector3(s.x, w.floor(s.x, s.z, 2), s.z); }

  entity(out: EntityState[]): void { out.push({ id: this.id, x: this.pos.x, y: this.pos.y, z: this.pos.z, state: this.state, t: Math.ceil(this.t) }); }
}
