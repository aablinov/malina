import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { Decoy } from '../decoys.ts';
import { hash2 } from '../level/kit.ts';
import type { Level } from '../level/level.ts';
import type { EntityState } from '../net/snapshot.ts';
import type { TdWall } from '../td/types.ts';
import type { SimWorld } from './world.ts';

/**
 * Castle wall or gate — siege (section 9): a decoy with taunt; health gone — a breach: wall blocks fly up as debris,
 * enemy obstacles are recomputed, the lane continues inward (`SimTd.breach`). A gate is leaves without blocks: closed —
 * an obstacle for enemies. Repair restores health and blocks. Below half health the bricks crack
 */
interface Cell { x: number; y: number; z: number; name: string; rot: number }

export class SimWall implements Decoy {
  readonly id: string;
  readonly spec: TdWall;
  readonly pos: THREE.Vector3;
  readonly radius = 0.5;
  readonly taunt: number;
  readonly title: string;
  readonly kind: 'wall' | 'gate';
  readonly out: THREE.Vector3;
  hp: number;
  readonly maxHp: number;
  dead = false;
  cracked = false;
  /** Total damage taken and how many times repaired (for tests) */
  taken = 0;
  repairs = 0;
  onBreak?: () => void;
  onRepair?: () => void;
  /** Obstacle for enemies (only an intact gate has one) */
  readonly solid: Obstacle | null;
  private readonly cells: Cell[] = [];
  private readonly w: SimWorld;
  private readonly level: Level;

  constructor(w: SimWorld, level: Level, spec: TdWall) {
    this.w = w;
    this.level = level;
    this.spec = spec;
    this.id = `w:${spec.id}`;
    this.title = spec.title; this.kind = spec.kind;
    this.hp = this.maxHp = spec.hp;
    this.taunt = spec.kind === 'gate' ? 12 : 6;
    this.out = new THREE.Vector3(spec.out[0], 0, spec.out[1]);
    this.pos = new THREE.Vector3(spec.breach[0], 0, spec.breach[1]);
    const alongX = spec.x1 - spec.x0 >= spec.z1 - spec.z0;
    for (let x = spec.x0; x <= spec.x1; x++) for (let z = spec.z0; z <= spec.z1; z++) {
      if (spec.kind === 'wall' && Math.abs(alongX ? x - spec.breach[0] : z - spec.breach[1]) > 2) continue;
      for (let y = spec.y0; y <= spec.y1 + 1; y++) {
        const name = level.nameAt(x, y, z);
        if (name && name !== 'air') this.cells.push({ x, y, z, name, rot: level.rotAt(x, y, z) });
      }
    }
    if (spec.kind === 'gate') {
      const cx = (spec.x0 + spec.x1) / 2, cz = (spec.z0 + spec.z1) / 2;
      this.solid = { x: cx, z: cz, hx: (spec.x1 - spec.x0 + 1) / 2, hz: (spec.z1 - spec.z0 + 1) / 2, rot: 0, h: 2 };
    } else this.solid = null;
  }

  /** Short id from the map (`meta.td.walls`) */
  get wallId(): string { return this.spec.id; }
  get alive(): boolean { return !this.dead; }
  /** Health fraction */
  get k(): number { return Math.max(0, this.hp / this.maxHp); }
  /** Hero at the wall: within 2.5 m of the rectangle (including on top of the wall itself) */
  near(p: THREE.Vector3): boolean {
    const s = this.spec;
    const dx = Math.max(s.x0 - 0.5 - p.x, 0, p.x - s.x1 - 0.5), dz = Math.max(s.z0 - 0.5 - p.z, 0, p.z - s.z1 - 0.5);
    return Math.hypot(dx, dz) < 2.5;
  }

  hurt(dmg: number, _from: THREE.Vector3): void {
    if (this.dead) return;
    const v = Math.round(dmg);
    this.hp = Math.max(0, this.hp - v);
    this.taken += v;
    this.w.emit({ t: 'wall.hurt', id: this.id, x: this.pos.x, y: 0, z: this.pos.z, n: v, ox: this.out.x, oz: this.out.z });
    if (this.hp <= 0) this.collapse();
    else if (this.k < 0.5 && !this.cracked) this.crack();
  }

  private crack(): void {
    this.cracked = true;
    if (this.kind !== 'wall') return;
    for (const c of this.cells) if (c.y <= this.spec.y1 && hash2(c.x + c.y * 7, c.z, 31) < 0.45 && this.level.nameAt(c.x, c.y, c.z) === c.name) this.level.set(c.x, c.y, c.z, 'bricks_cracked');
  }

  private collapse(): void {
    this.dead = true;
    this.w.emit({ t: 'wall.break', id: this.id, x: this.pos.x, y: 0, z: this.pos.z, kind: this.kind, title: this.title });
    if (this.kind === 'wall') {
      for (const c of this.cells) {
        this.level.set(c.x, c.y, c.z, 'air');
        if (c.y === this.spec.y0 && hash2(c.x, c.z, 32) < 0.4) this.level.set(c.x, c.y, c.z, hash2(c.x, c.z, 33) < 0.5 ? 'cobble_slab' : 'bricks_slab');
      }
      this.w.h.levelChanged?.();
    }
    this.onBreak?.();
  }

  repair(): void {
    const was = this.dead;
    this.hp = this.maxHp;
    this.dead = false;
    this.cracked = false;
    this.repairs++;
    if (this.kind === 'wall') {
      for (const c of this.cells) this.level.set(c.x, c.y, c.z, c.name, c.rot);
      this.w.h.levelChanged?.();
    }
    this.w.emit({ t: 'wall.repair', id: this.id, x: this.pos.x, y: 0, z: this.pos.z, ox: this.out.x, oz: this.out.z });
    if (was) this.onRepair?.();
  }

  /** Mirror of a network battle: state from the server snapshot — breach and repair blocks are replayed on the local level, without events */
  mirror(hp: number, dead: boolean, cracked: boolean): void {
    if (dead && !this.dead) {
      this.dead = true;
      if (this.kind === 'wall') {
        for (const c of this.cells) {
          this.level.set(c.x, c.y, c.z, 'air');
          if (c.y === this.spec.y0 && hash2(c.x, c.z, 32) < 0.4) this.level.set(c.x, c.y, c.z, hash2(c.x, c.z, 33) < 0.5 ? 'cobble_slab' : 'bricks_slab');
        }
        this.w.h.levelChanged?.();
      }
      this.onBreak?.();
    } else if (!dead && this.dead) {
      this.dead = false;
      this.cracked = false;
      if (this.kind === 'wall') { for (const c of this.cells) this.level.set(c.x, c.y, c.z, c.name, c.rot); this.w.h.levelChanged?.(); }
      this.onRepair?.();
    }
    if (cracked && !this.cracked) { this.hp = hp; this.crack(); }
    this.hp = hp;
    this.cracked = cracked;
  }

  entity(out: EntityState[]): void { out.push({ id: this.id, hp: Math.round(this.hp), maxHp: this.maxHp, dead: this.dead ? 1 : 0, cracked: this.cracked ? 1 : 0 }); }
}
