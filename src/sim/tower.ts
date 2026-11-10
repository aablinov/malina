import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { Decoy } from '../decoys.ts';
import type { EntityState } from '../net/snapshot.ts';
import type { Target } from '../target.ts';
import { HEAD_Y, LEVEL_RISE, MAX_LEVEL, REPAIR_COST, TOWERS, UPGRADE_DMG, UPGRADE_HP, UPGRADE_RANGE, upgradeCost, type TowerDef, type TowerKind } from '../td/towers.ts';
import { r1, r2 } from './entities.ts';
import type { Foe, SimWorld } from './world.ts';

/**
 * Defence tower — logic (wiki/design-tower-defence.md): picks its own target — the one furthest along the lane —
 * and hits in its own way (src/td/towers.ts). Model, sparks and sound belong to the view (src/cgame/views/tower-view.ts), driven by events and the record.
 * Projectiles (`bolts`) and pools (`pools`) are snapshot entities; the simulation resolves hits by flight time.
 * Durability: for tower hunters the tower is a siege decoy (src/decoys.ts); gnawed down — ruins; the ice warlock freezes it
 */

/** Angle wrapped into [−π, π] */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const _dir = new THREE.Vector3();
const ZERO = new THREE.Vector3();
/** How many hero hits break the ice on a tower */
const ICE_HITS = 2;

/** Projectile: straight (h = 0) or along an arc of height h; on arrival — arrive */
export interface Bolt { id: string; kind: string; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number; homing: Foe | null; arrive: (at: THREE.Vector3) => void }
/** Burning enemy: damage ticks */
interface Burn { foe: Foe; t: number; tick: number; dmg: number; fxT: number }
/** Tar pool: they get stuck and burn until it dries */
export interface Pool { id: string; at: THREE.Vector3; t: number; tick: number; r: number }

export class SimTower implements Decoy {
  readonly id: string;
  readonly pad: number;
  readonly def: TowerDef;
  readonly pos: THREE.Vector3;
  level = 1;
  /** Total raspberries invested (build and upgrades) — for selling */
  spent: number;
  target: Foe | null = null;
  /** Rotation of the firing part towards the target */
  yaw = 0;
  /** Counters for tests and the label */
  shots = 0;
  dealt = 0;
  kills = 0;
  readonly solid: Obstacle;
  readonly radius = 0.75;
  readonly taunt = 7;
  readonly siege = true;
  hp: number;
  maxHp: number;
  frozen = 0;
  /** Ice on the tower — a target for the hero's sword while the tower is frozen */
  readonly ice: Target;
  onAlarm?: (why: 'hurt' | 'frozen' | 'ruin') => void;
  readonly bolts: Bolt[] = [];
  readonly pools: Pool[] = [];
  private readonly burns: Burn[] = [];
  private iceHits = 0;
  /** Channelled beams (frost spire, arcane obelisk): seconds the beam has stayed on each target — the ramp */
  private ramps = new Map<Foe, number>();
  private cd = 0.3;
  private time = 0;
  private readonly w: SimWorld;

  constructor(w: SimWorld, pad: number, kind: TowerKind, x: number, z: number, y = 0) {
    this.w = w;
    this.pad = pad;
    this.id = `t${pad}`;
    this.def = TOWERS[kind];
    this.spent = this.def.cost;
    this.pos = new THREE.Vector3(x, y, z);
    this.solid = { x, z, hx: 0.75, hz: 0.75, rot: 0, h: 2.5, y0: y };
    this.hp = this.maxHp = this.def.hp;
    const me = this;
    this.ice = { pos: this.pos, radius: 1, topY: 3, prop: true, get alive() { return me.frozen > 0; }, hit: () => me.chip() };
  }

  get alive(): boolean { return this.hp > 0; }
  get ruined(): boolean { return this.hp <= 0; }
  get repairCost(): number { return Math.max(10, Math.round(this.spent * REPAIR_COST)); }
  get kind(): TowerKind { return this.def.id; }
  get range(): number { return this.def.range + UPGRADE_RANGE[this.level - 1]; }
  get dmg(): number { return Math.round(this.def.dmg * UPGRADE_DMG[this.level - 1]); }
  get title(): string { return `${this.def.title} ${['I', 'II', 'III'][this.level - 1]}`; }
  get nextCost(): number | null { return this.level >= MAX_LEVEL ? null : upgradeCost(this.def, this.level + 1); }
  /** How many enemies are burning (for tests) */
  get burning(): number { return this.burns.length; }
  get pooling(): number { return this.pools.length; }

  private ev(t: string, extra: Record<string, unknown> = {}): void { this.w.emit({ t, id: this.id, x: this.pos.x, y: this.pos.y, z: this.pos.z, kind: this.def.id, level: this.level, ...extra }); }

  hurt(dmg: number): void {
    if (this.ruined || dmg <= 0) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.ev('tower.hurt', { n: Math.round(dmg) });
    if (this.hp > 0) { this.onAlarm?.('hurt'); return; }
    this.target = null;
    this.thaw(false);
    this.ev('tower.ruin');
    this.onAlarm?.('ruin');
  }

  repair(): void {
    const was = this.ruined;
    this.hp = this.maxHp;
    if (!was) return;
    this.cd = 0.5;
    this.ev('tower.repair');
  }

  freeze(sec: number): boolean {
    if (this.def.id === 'frost' || this.ruined) return false;
    const fresh = this.frozen <= 0;
    this.frozen = Math.max(this.frozen, sec);
    this.iceHits = 0;
    if (fresh) { this.ev('tower.freeze'); this.onAlarm?.('frozen'); }
    return true;
  }

  private chip(): void {
    if (this.frozen <= 0) return;
    this.iceHits++;
    this.ev('tower.chip');
    if (this.iceHits >= ICE_HITS) this.thaw(true);
  }

  private thaw(loud: boolean): void {
    if (this.frozen <= 0) return;
    this.frozen = 0;
    this.ev('tower.thaw', { loud });
  }

  upgrade(): boolean {
    const cost = this.nextCost;
    if (cost === null) return false;
    this.level++;
    this.spent += cost;
    const max = Math.round(this.def.hp * UPGRADE_HP ** (this.level - 1));
    this.hp += max - this.maxHp;
    this.maxHp = max;
    this.ev('tower.upgrade');
    return true;
  }

  /** Demolished or sold: projectiles and pools vanish */
  dispose(): void {
    this.bolts.length = 0;
    this.pools.length = 0;
    this.burns.length = 0;
    this.ramps.clear();
  }

  // ---------- combat ----------
  private pick(): Foe | null {
    let best: Foe | null = null, bp = -Infinity;
    const r = this.range;
    for (const f of this.w.h.foes()) {
      if (!f.alive || f.dead) continue;
      const d = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) - f.radius;
      if (d > r) continue;
      const p = f.progress ?? 0;
      if (p > bp) { bp = p; best = f; }
    }
    return best;
  }

  private inRange(f: Foe): boolean { return f.alive && !f.dead && Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) - f.radius <= this.range + 0.5; }

  /** Damage to the target from the tower; the damage number goes as a `dmg` event */
  private strike(f: Foe, dmg: number, knock: number, point: THREE.Vector3, cls = '', pierce = false): void {
    if (!f.alive || dmg <= 0) return;
    _dir.set(f.pos.x - this.pos.x, 0, f.pos.z - this.pos.z).normalize();
    f.hit(dmg, pierce ? ZERO : _dir, point, knock);
    this.dealt += dmg;
    this.w.emit({ t: 'dmg', x: point.x, y: point.y + 0.3, z: point.z, n: dmg, cls });
    if (!f.alive) this.kills++;
  }

  private around(at: THREE.Vector3, r: number, except: Foe | null = null): Foe[] {
    return this.w.h.foes().filter((f) => f !== except && f.alive && !f.dead && Math.hypot(f.pos.x - at.x, f.pos.z - at.z) - f.radius <= r);
  }

  /** Height of the turning head: grows with the level, as the model does (src/cgame/views/tower-view.ts) */
  get headY(): number { return HEAD_Y[this.def.id] + (this.level - 1) * LEVEL_RISE; }
  /** A point of the head: dy above its pivot, `ahead` metres towards the target */
  private muzzle(dy: number, ahead: number): THREE.Vector3 {
    return this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * ahead, this.headY + dy, Math.cos(this.yaw) * ahead));
  }
  /** The next targets after `first` — the ones furthest along the lane within range */
  private others(first: Foe, n: number): Foe[] {
    if (n <= 0) return [];
    return this.around(this.pos, this.range, first).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0)).slice(0, n);
  }
  /** Seconds a channelled beam has been on each of `list` after this tick (others are forgotten), capped at `max` */
  private channel(list: Foe[], max: number): number[] {
    const next = new Map<Foe, number>();
    for (const f of list) next.set(f, Math.min(max, (this.ramps.get(f) ?? 0) + this.def.cd));
    this.ramps = next;
    return list.map((f) => next.get(f)!);
  }
  private chest(t: Foe): THREE.Vector3 { return t.pos.clone().setY(t.pos.y + Math.min(1, (t.topY ?? 1.4) * 0.6)); }

  private burn(f: Foe, t: number, dmg: number, extend = false): void {
    const b = this.burns.find((x) => x.foe === f);
    if (b) b.t = extend ? Math.max(b.t, t) : t;
    else this.burns.push({ foe: f, t, tick: 1, dmg: Math.max(1, dmg), fxT: 0 });
  }

  private bolt(kind: string, from: THREE.Vector3, to: THREE.Vector3, dur: number, h: number, homing: Foe | null, arrive: (at: THREE.Vector3) => void): void {
    this.bolts.push({ id: this.w.id('b'), kind, from, to, t: 0, dur, h, homing, arrive });
  }

  private fire(t: Foe): void {
    this.shots++;
    switch (this.def.id) {
      case 'frost': this.fireFrost(t); break;
      case 'splash': this.fireSplash(t); break;
      case 'fire': this.fireFlame(); break;
      case 'magic': this.fireMagic(t); break;
      case 'ballista': this.fireBallista(t); break;
      case 'oil': this.fireOil(t); break;
      case 'meteor': this.fireMeteor(); break;
      case 'storm': this.fireStorm(t); break;
      case 'winter': this.fireWinter(); break;
      default: this.fireArrow(t); break;
    }
  }

  /** Heavy bolt: straight through the target to the edge of the range, hits everyone in a 0.7 m strip; a hit without direction — does not block armour */
  private fireBallista(t: Foe): void {
    const dmg = this.dmg, from = this.muzzle(0.3, 1.0), lvl = this.level;
    const dir = new THREE.Vector3(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize();
    const len = this.range + 1;
    const end = this.pos.clone().addScaledVector(dir, len); end.y = this.w.floor(end.x, end.z, t.pos.y) + 0.9;
    this.ev('tower.fire', { fx: from.x, fy: from.y, fz: from.z, tx: end.x, ty: end.y, tz: end.z });
    let n = 0;
    for (const f of this.w.h.foes()) {
      if (!f.alive || f.dead) continue;
      const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z, along = dx * dir.x + dz * dir.z;
      if (along < 0 || along > len) continue;
      if (Math.abs(dx * dir.z - dz * dir.x) > 0.7 + f.radius) continue;
      const at = this.chest(f);
      // II — the bolt loses nothing on the way through; III — it also staggers everyone it passes
      this.strike(f, n === 0 || lvl >= 2 ? dmg : Math.round(dmg * 0.7), 0, at, 'crit', true);
      if (lvl >= 3) f.stun?.(0.4);
      this.w.emit({ t: 'hit.ballista', x: at.x, y: at.y, z: at.z, dx: dir.x, dz: dir.z });
      n++;
    }
  }

  /** A ladle of tar along an arc: a pool of radius 2.2 m for 5 s — in it they get stuck (−50 %) and burn (a damage tick every 0.5 s) */
  private fireOil(t: Foe): void {
    const from = this.muzzle(0.7, 0.6), dist = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    this.ev('tower.fire', { fx: from.x, fy: from.y, fz: from.z });
    this.bolt('oil', from, t.pos.clone().setY(this.w.floor(t.pos.x, t.pos.z, t.pos.y)), 0.5 + dist * 0.05, 2 + dist * 0.2, null, (at) => {
      const r = 2.2 + (this.level - 1) * 0.3;
      this.pools.push({ id: this.w.id('pool'), at: at.clone(), t: 5, tick: 0, r });
      this.w.emit({ t: 'hit.oil', x: at.x, y: at.y, z: at.z, r });
    });
  }

  /** Meteor: into the densest crowd within range — from the sky, 4.5 m blast (damage fades towards the edge, no less than half), knockback, sets on fire */
  private fireMeteor(): void {
    const lvl = this.level, R = lvl >= 3 ? 5.5 : 4.5, dmg = this.dmg;
    const foes = this.around(this.pos, this.range);
    if (!foes.length) return;
    let best = foes[0], bn = -1;
    for (const f of foes) {
      const n = foes.filter((o) => Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) < R).length + (f.progress ?? 0) * 0.5;
      if (n > bn) { bn = n; best = f; }
    }
    const to = best.pos.clone().setY(this.w.floor(best.pos.x, best.pos.z, best.pos.y)), from = to.clone().add(new THREE.Vector3(-4, 22, -4));
    this.ev('tower.fire', { tx: to.x, ty: to.y, tz: to.z, r: R });
    this.bolt('meteor', from, to, 0.8, 0, null, (at) => {
      this.w.emit({ t: 'hit.meteor', x: at.x, y: at.y, z: at.z, r: R });
      for (const f of this.around(at, R)) {
        const d = Math.hypot(f.pos.x - at.x, f.pos.z - at.z), k = Math.max(0.5, 1 - d / R);
        this.strike(f, Math.round(dmg * k), 3 * k, f.pos.clone().setY(1), 'crit');
        this.burn(f, lvl >= 2 ? 5 : 3, Math.round(dmg * 0.1));
        if (lvl >= 3 && k > 0.7) f.stun?.(0.8);
      }
    });
  }

  /** Lightning: into the target and on in a chain to the nearest (up to 5 m) — 6 enemies, 8 at II, 10 at III; each jump −8 % damage, 0.3 s stun */
  private fireStorm(t: Foe): void {
    const n = 4 + this.level * 2, dmg = this.dmg;
    const chain: Foe[] = [t];
    while (chain.length < n) {
      const last = chain[chain.length - 1];
      let next: Foe | null = null, bd = 5;
      for (const f of this.around(last.pos, 5)) { if (chain.includes(f)) continue; const d = Math.hypot(f.pos.x - last.pos.x, f.pos.z - last.pos.z); if (d < bd) { bd = d; next = f; } }
      if (!next) break;
      chain.push(next);
    }
    const pts: number[] = [this.pos.x, this.pos.y + this.headY + 1.0, this.pos.z];
    chain.forEach((f, i) => {
      const b = this.chest(f);
      pts.push(b.x, b.y, b.z);
      this.strike(f, Math.round(dmg * Math.pow(0.92, i)), 0.2, b, i === 0 ? 'crit' : '');
      f.stun?.(0.3);
    });
    this.ev('tower.fire', { pts });
  }

  /** Blizzard: damage and −50 % speed to everyone within range; every fifth hit is an ice wave: damage ×3 and 1.2 s stun */
  private fireWinter(): void {
    const lvl = this.level, R = this.range, nova = this.shots % (lvl >= 2 ? 4 : 5) === 0, dmg = nova ? this.dmg * 3 : this.dmg;
    for (const f of this.around(this.pos, R)) {
      this.strike(f, dmg, nova ? 1.5 : 0, f.pos.clone().setY(1), nova ? 'crit' : '');
      f.chill?.(0.5, 1.5);
      if (nova) f.stun?.(lvl >= 3 ? 1.8 : 1.2);
    }
    this.ev('tower.fire', { nova, r: R });
  }

  /** Bolt: flies straight at the target. II — every third bolt is a heavy one (×2); III — a volley: two more bolts at the next targets */
  private fireArrow(t: Foe): void {
    const lvl = this.level, heavy = lvl >= 2 && this.shots % 3 === 0;
    const from = this.muzzle(0.45, 0.6);
    this.ev('tower.fire', { fx: from.x, fy: from.y, fz: from.z, heavy });
    const shoot = (f: Foe, dmg: number, crit: boolean, side: number): void => {
      const to = this.chest(f), a = from.clone();
      a.x += Math.cos(this.yaw) * side; a.z -= Math.sin(this.yaw) * side;
      this.bolt('arrow', a, to, a.distanceTo(to) / 34, 0, null, () => { this.strike(f, dmg, crit ? 0.9 : 0.4, to, crit ? 'crit' : ''); this.w.emit({ t: 'hit.arrow', x: to.x, y: to.y, z: to.z, heavy: crit }); });
    };
    shoot(t, heavy ? this.dmg * 2 : this.dmg, heavy, 0);
    if (lvl >= 3) this.others(t, 2).forEach((f, i) => shoot(f, Math.round(this.dmg * 0.6), false, i ? 0.3 : -0.3));
  }

  /**
   * Freezing beam: the spire holds a ray of cold on its target — damage every tick, the slow grows the longer the ray stays
   * (−30 % → −60 % over 2 s, at II over 1 s). III — a second ray at the next enemy, and a target chilled to the limit freezes solid
   */
  private fireFrost(t: Foe): void {
    const lvl = this.level, FULL = lvl >= 2 ? 1 : 2, dmg = this.dmg;
    const list = [t, ...this.others(t, lvl >= 3 ? 1 : 0)], held = this.channel(list, FULL);
    const from = this.muzzle(1.1, 0), pts: number[] = [from.x, from.y, from.z];
    let ramp = 0;
    list.forEach((f, i) => {
      const k = held[i] / FULL, at = this.chest(f);
      ramp = Math.max(ramp, k);
      pts.push(at.x, at.y, at.z);
      this.strike(f, i ? Math.max(1, Math.round(dmg * 0.6)) : dmg, 0, at);
      f.chill?.(0.3 + 0.3 * k, 0.8);
      if (lvl >= 3 && k >= 1) {
        f.stun?.(1);
        this.ramps.set(f, FULL * 0.3);
        this.w.emit({ t: 'hit.frost', x: at.x, y: at.y, z: at.z, area: true });
      }
    });
    this.ev('tower.fire', { pts, ramp: r2(ramp) });
  }

  /**
   * Arcane tether: the obelisk latches onto its target and drains it — damage every tick grows the longer the tether holds
   * (×1 → ×2.5 over 3 s), the target is weakened (+30 % damage taken). One tether per level: II — two targets, III — three
   */
  private fireMagic(t: Foe): void {
    const FULL = 3, dmg = this.dmg;
    const list = [t, ...this.others(t, this.level - 1)], held = this.channel(list, FULL);
    const from = this.muzzle(1.2, 0), pts: number[] = [from.x, from.y, from.z];
    let ramp = 0;
    list.forEach((f, i) => {
      const k = held[i] / FULL, at = this.chest(f);
      ramp = Math.max(ramp, k);
      pts.push(at.x, at.y, at.z);
      f.expose?.(0.3, 1);
      this.strike(f, Math.max(1, Math.round(dmg * (1 + 1.5 * k) * (i ? 0.6 : 1))), 0, at, k >= 1 && !i ? 'crit' : '');
      if (k >= 1 && this.shots % 4 === 0) this.w.emit({ t: 'hit.magic', x: at.x, y: at.y, z: at.z, pts: [] });
    });
    this.ev('tower.fire', { pts, ramp: r2(ramp) });
  }

  /** Rock along an arc: area blast with knockback, damage fades towards the edge */
  private fireSplash(t: Foe): void {
    const lvl = this.level, dmg = this.dmg, R = lvl >= 2 ? 3 : 2.4;
    const from = this.muzzle(1.2, -0.3), dist = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    this.ev('tower.fire', { fx: from.x, fy: from.y, fz: from.z });
    this.bolt('splash', from, t.pos.clone().setY(this.w.floor(t.pos.x, t.pos.z, t.pos.y)), 0.6 + dist * 0.05, 3 + dist * 0.25, null, (at) => {
      this.w.emit({ t: 'hit.splash', x: at.x, y: at.y, z: at.z, r: R });
      for (const f of this.around(at, R)) {
        const d = Math.hypot(f.pos.x - at.x, f.pos.z - at.z), k = Math.max(0.4, 1 - d / R);
        this.strike(f, Math.round(dmg * k), 2.5 * k, f.pos.clone().setY(1), k > 0.8 ? 'crit' : '');
        if (lvl >= 3 && k > 0.6) f.stun?.(0.6);
      }
    });
  }

  /** Jet of flame: everyone in the cone in front of the brazier takes damage and burns for 3 more s */
  private fireFlame(): void {
    const dmg = this.dmg, R = this.range, yaw = this.yaw;
    const from = this.muzzle(0.4, 1.0), lvl = this.level, half = lvl >= 3 ? 0.62 : 0.42;
    this.ev('tower.fire', { fx: from.x, fy: from.y, fz: from.z, yaw, half });
    for (const f of this.w.h.foes()) {
      if (!f.alive || f.dead) continue;
      const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d - f.radius > R || Math.abs(wrap(Math.atan2(dx, dz) - yaw)) > half + Math.atan(f.radius / Math.max(d, 0.5))) continue;
      this.strike(f, dmg, 0.1, f.pos.clone().setY(1));
      this.burn(f, lvl >= 2 ? 5 : 3, Math.round(dmg * 0.3));
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.cd -= dt;
    if (this.frozen > 0) { this.frozen -= dt; if (this.frozen <= 0) { this.frozen = 0.0001; this.thaw(true); } }
    const idle = this.ruined || this.frozen > 0;
    if (idle) { this.target = null; this.ramps.clear(); }
    else if (!this.target || !this.inRange(this.target)) this.target = this.pick();
    const t = this.target;
    if (t) {
      const want = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), d = wrap(want - this.yaw), m = (this.def.id === 'splash' ? 3 : 9) * dt;
      this.yaw = wrap(this.yaw + Math.max(-m, Math.min(m, d)));
      if (this.cd <= 0 && Math.abs(d) < 0.5) { this.cd = this.def.cd; this.fire(t); }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.homing && b.homing.alive) b.to.copy(this.chest(b.homing));
      if (b.t >= b.dur) { this.bolts.splice(i, 1); b.arrive(b.to); }
    }
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.t -= dt; p.tick -= dt;
      if (p.t <= 0) { this.pools.splice(i, 1); continue; }
      if (p.tick > 0) continue;
      p.tick = 0.5;
      for (const f of this.around(p.at, p.r)) {
        f.chill?.(0.5, 0.6);
        this.strike(f, this.dmg, 0, f.pos.clone().setY(f.pos.y + 0.8));
        this.burn(f, 2, Math.round(this.dmg * 0.5), true);
      }
    }
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i];
      b.t -= dt; b.tick -= dt; b.fxT -= dt;
      if (!b.foe.alive || b.foe.dead || b.t <= 0) { this.burns.splice(i, 1); continue; }
      if (b.fxT <= 0) { b.fxT = 0.2; this.w.emit({ t: 'burn', x: b.foe.pos.x, y: b.foe.pos.y, z: b.foe.pos.z, top: b.foe.topY ?? 1.2 }); }
      if (b.tick <= 0) { b.tick = 1; this.strike(b.foe, b.dmg, 0, b.foe.pos.clone().setY(b.foe.pos.y + 1.2)); }
    }
  }

  entities(out: EntityState[]): void {
    out.push({ id: this.id, pad: this.pad, kind: this.def.id, level: this.level, hp: Math.round(this.hp), maxHp: this.maxHp, frozen: r1(this.frozen), yaw: r2(this.yaw), x: this.pos.x, y: this.pos.y, z: this.pos.z, spent: this.spent, shots: this.shots });
    for (const b of this.bolts) out.push({ id: b.id, kind: b.kind, fx: r2(b.from.x), fy: r2(b.from.y), fz: r2(b.from.z), tx: r2(b.to.x), ty: r2(b.to.y), tz: r2(b.to.z), k: r2(Math.min(1, b.t / b.dur)), h: r2(b.h) });
    for (const p of this.pools) out.push({ id: p.id, x: r2(p.at.x), y: r2(p.at.y), z: r2(p.at.z), r: r2(p.r), t: r1(p.t) });
  }
}
