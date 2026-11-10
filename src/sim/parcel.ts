import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import { addDecoy } from '../decoys.ts';
import type { EntityState } from '../net/snapshot.ts';
import type { TowerKind } from '../td/towers.ts';
import { r1 } from './entities.ts';
import { SimTower } from './tower.ts';
import type { SimWorld } from './world.ts';

/**
 * Parcels from the camp (wiki/design-expeditions.md, section 5) — the squad's called-in support. Three slots per hero, picked
 * in the camp; a parcel is called to a point near the hero, lands after a few seconds and then its slot rests. A tower parcel is
 * one of the defence's towers (src/sim/tower.ts) standing wherever it landed for a minute; a volley strikes an area; a healing
 * totem mends the heroes around it
 */

export type ParcelKind = 'tower:arrow' | 'tower:frost' | 'tower:splash' | 'tower:fire' | 'tower:magic' | 'volley' | 'heal';
/** Slot rest after a call, s */
export const PARCELS: Record<ParcelKind, { cd: number }> = {
  'tower:arrow': { cd: 70 }, 'tower:frost': { cd: 75 }, 'tower:splash': { cd: 90 }, 'tower:fire': { cd: 85 }, 'tower:magic': { cd: 90 },
  volley: { cd: 45 }, heal: { cd: 80 },
};
export const PARCEL_KINDS = Object.keys(PARCELS) as ParcelKind[];
export const PARCEL_SLOTS = 3;
export const DEFAULT_PARCELS: ParcelKind[] = ['tower:arrow', 'volley', 'heal'];
/** A parcel lands this long after the call, this far from the hero at most */
export const PARCEL_DELAY = 3;
export const PARCEL_RANGE = 16;
export const TOWER_LIFE = 60;
const VOLLEY_R = 4.5;
const VOLLEY_DMG = 70;
const HEAL_LIFE = 12;
const HEAL_R = 5;
const HEAL_PER_S = 8;

/** A loadout from the profile: known kinds only, three slots, the default where a slot is empty or unknown */
export function parcelLoadout(v: unknown): ParcelKind[] {
  const list = Array.isArray(v) ? v : [];
  return Array.from({ length: PARCEL_SLOTS }, (_, i) => (PARCEL_KINDS.includes(list[i] as ParcelKind) ? (list[i] as ParcelKind) : DEFAULT_PARCELS[i]));
}

interface Flying { id: string; kind: ParcelKind; x: number; z: number; t: number; seat: number }
interface Standing { tower: SimTower; life: number; undecoy: () => void }
interface Mending { id: string; x: number; y: number; z: number; t: number; tick: number }

export class Parcels {
  readonly towers: Standing[] = [];
  private readonly flying: Flying[] = [];
  private readonly heals: Mending[] = [];
  private readonly loadouts = new Map<number, ParcelKind[]>();
  private readonly cds = new Map<number, number[]>();
  private n = 0;
  private solidsCache: Obstacle[] | null = null;
  private readonly w: SimWorld;

  constructor(w: SimWorld) { this.w = w; }

  setLoadout(seat: number, v: unknown): void { this.loadouts.set(seat, parcelLoadout(v)); if (!this.cds.has(seat)) this.cds.set(seat, new Array<number>(PARCEL_SLOTS).fill(0)); }
  loadout(seat: number): ParcelKind[] { return this.loadouts.get(seat) ?? DEFAULT_PARCELS; }
  /** Seconds until each slot of a seat is ready again */
  cooldowns(seat: number): number[] { let c = this.cds.get(seat); if (!c) { c = new Array<number>(PARCEL_SLOTS).fill(0); this.cds.set(seat, c); } return c; }
  /** Mirror of a network battle */
  setCooldowns(seat: number, c: number[], kinds: unknown): void { this.cds.set(seat, c); this.loadouts.set(seat, parcelLoadout(kinds)); }

  get solids(): Obstacle[] { this.solidsCache ??= this.towers.map((s) => s.tower.solid); return this.solidsCache; }

  /** A hero calls the parcel of a slot to a point; false — the slot rests, the point is too far or he is down */
  call(seat: number, slot: number, x: number, z: number): boolean {
    const h = this.w.h.heroes().find((o) => o.seat === seat), cd = this.cooldowns(seat);
    if (!h || h.down || !Number.isInteger(slot) || slot < 0 || slot >= PARCEL_SLOTS || cd[slot] > 0) return false;
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x - h.pos.x, z - h.pos.z) > PARCEL_RANGE) return false;
    const kind = this.loadout(seat)[slot];
    cd[slot] = PARCELS[kind].cd;
    const p: Flying = { id: `parcel${++this.n}`, kind, x, z, t: PARCEL_DELAY, seat };
    this.flying.push(p);
    this.w.emit({ t: 'parcel.call', id: p.id, x, y: this.w.floor(x, z, h.pos.y + 2), z, kind, seat, sec: PARCEL_DELAY });
    return true;
  }

  private land(p: Flying): void {
    const y = this.w.floor(p.x, p.z, 40), at = new THREE.Vector3(p.x, y, p.z);
    this.w.emit({ t: 'parcel.land', id: p.id, x: p.x, y, z: p.z, kind: p.kind });
    if (p.kind === 'volley') {
      for (const f of this.w.h.foes()) {
        const d = Math.hypot(f.pos.x - p.x, f.pos.z - p.z);
        if (f.dead || d - f.radius > VOLLEY_R) continue;
        const dir = new THREE.Vector3(f.pos.x - p.x, 0, f.pos.z - p.z);
        if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
        f.hit(VOLLEY_DMG, dir.normalize(), f.pos.clone().setY(f.pos.y + 1), 4);
      }
    } else if (p.kind === 'heal') this.heals.push({ id: `heal${this.n}`, x: p.x, y, z: p.z, t: HEAL_LIFE, tick: 0 });
    else {
      // pad numbers from 100 up: the tower's record id `t<pad>` never meets a defence pad
      const tower = new SimTower(this.w, 100 + this.n, p.kind.slice(6) as TowerKind, at.x, at.z, y);
      this.towers.push({ tower, life: TOWER_LIFE, undecoy: addDecoy(tower, this.w.decoys) });
      this.solidsCache = null;
    }
  }

  update(dt: number): void {
    for (const c of this.cds.values()) for (let i = 0; i < c.length; i++) c[i] = Math.max(0, c[i] - dt);
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const p = this.flying[i];
      p.t -= dt;
      if (p.t > 0) continue;
      this.flying.splice(i, 1);
      this.land(p);
    }
    for (let i = this.towers.length - 1; i >= 0; i--) {
      const s = this.towers[i];
      s.tower.update(dt);
      s.life -= dt;
      if (s.life > 0) continue;
      this.w.emit({ t: 'parcel.gone', id: s.tower.id, x: s.tower.pos.x, y: s.tower.pos.y, z: s.tower.pos.z });
      s.tower.dispose();
      s.undecoy();
      this.towers.splice(i, 1);
      this.solidsCache = null;
    }
    for (let i = this.heals.length - 1; i >= 0; i--) {
      const m = this.heals[i];
      m.t -= dt;
      m.tick -= dt;
      if (m.tick <= 0) {
        m.tick = 1;
        for (const h of this.w.h.heroes()) if (!h.down && Math.hypot(h.pos.x - m.x, h.pos.z - m.z) <= HEAL_R) this.w.h.heal?.(h.seat, HEAL_PER_S);
      }
      if (m.t <= 0) this.heals.splice(i, 1);
    }
  }

  entities(out: EntityState[]): void {
    for (const p of this.flying) out.push({ id: p.id, x: p.x, z: p.z, kind: p.kind, t: r1(p.t) });
    for (const s of this.towers) { s.tower.entities(out); out.push({ id: `life${s.tower.pad}`, pad: s.tower.pad, t: Math.ceil(s.life) }); }
    for (const m of this.heals) out.push({ id: m.id, x: m.x, y: m.y, z: m.z, t: r1(m.t), r: HEAL_R });
    for (const [seat, c] of this.cds) out.push({ id: `cd${seat}`, seat, a: Math.ceil(c[0]), b: Math.ceil(c[1]), c: Math.ceil(c[2]), kinds: this.loadout(seat).join(',') });
  }
}
