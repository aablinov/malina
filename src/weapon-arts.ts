import * as THREE from 'three';
import { rnd } from './rng.ts';
import { markShared, type FX } from './fx.ts';
import type { Knight, SpecialMove, Strike, SwingLook } from './knight.ts';
import type { Terrain } from './level/collide.ts';
import type { Target } from './target.ts';
import { SwordTrail } from './trail.ts';
import { RESONANCE, SPECIAL_HITS, synergiesOf, TEMPER_LOOK, WEAPON_SPECIAL, type MeleeEnchant, type Synergy, type TemperSlot } from './temper.ts';
import { buildWeaponModel, disposeWeaponModel, type WeaponCategory, type WeaponDef } from './weapons.ts';
import { SYNERGY_FX } from './weapon-synergies.ts';
import { specialSound, weaponHit, type SpecialCue } from './weapon-audio.ts';

/**
 * Weapon arts (wiki/design-weapon-arts.md): temper by enchantments and weapon arts.
 * — Look: the blade glows in the temper colour, sparks of the enchantment fall off the edge, the trail blends from colour
 *   to colour, every strike draws a crescent, every hit — the enchantment's effect.
 * — Synergies (src/weapon-synergies.ts): a pair of enchantments has its own, fires on the finisher and on the weapon art;
 *   three — resonance, all three at once.
 * — Weapon art (Q): the meter fills with hits (SPECIAL_HITS), each weapon category has its own art.
 * Data and texts — src/temper.ts; damage to targets, healing and souls — through the Gear hooks (src/gear.ts).
 */

const WHITE = new THREE.Color(1, 1, 1);

export interface ArtsHooks {
  scene: THREE.Scene;
  fx: FX;
  hero: Knight;
  terrain: Terrain;
  targets(): Target[];
  /** Effect damage to a target: number above the target, souls, XP; melee — count as a weapon strike (leeching, souls per strike) */
  hitTarget(t: Target, v: number, dir: THREE.Vector3, knock: number, melee: boolean): void;
  heal(v: number): void;
  souls(n: number): void;
  /** Melee damage multiplier (weapon power, sharpness, auras) */
  meleeMult(): number;
  sound(k: 'boom' | 'zap' | 'horn' | 'souls' | 'dash' | 'hit'): void;
  /** An explosion ignites barrels and hits crates */
  blast?(at: THREE.Vector3, r: number, dmg: number): void;
  /** No sound (a test drives the scene) */
  quiet?(): boolean;
}

/** What a synergy knows about the strike that fired it */
export interface ProcCtx {
  /** Impact point at foot level */
  at: THREE.Vector3;
  yaw: number;
  /** Whom the strike hit */
  hits: Target[];
  /** Synergy damage with power, tiers and resonance */
  dmg: number;
  /** Pair colours: the first and second temper */
  a: THREE.Color;
  b: THREE.Color;
  /** 0..1 — tiers of the pair (I+I → 0.33, III+III → 1): size and particle count */
  power: number;
}

interface Ent { t: number; dur: number; tick(dt: number, k: number): void; end?(): void }

/** Weapon art of a category: hero movement, duration and events by strike fraction */
interface SpecialRun { move: SpecialMove; dur: number; events: [number, () => void][] }

const DEFAULT_COLORS = [new THREE.Color(0.8, 1.8, 2.8), new THREE.Color(1.9, 1.0, 2.8)];
const rgb = (id: MeleeEnchant): THREE.Color => new THREE.Color(...TEMPER_LOOK[id].rgb);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Shared effect geometries: crescent, cube, ring */
let crescentGeo: THREE.BufferGeometry | null = null;
export const CRESCENT = (): THREE.BufferGeometry => crescentGeo ??= markShared(new THREE.RingGeometry(0.62, 1, 24, 1, -1.05, 2.1).rotateX(-Math.PI / 2));
let cubeGeo: THREE.BoxGeometry | null = null;
export const CUBE = (): THREE.BoxGeometry => cubeGeo ??= markShared(new THREE.BoxGeometry(1, 1, 1));

export const glowMat = (c: THREE.Color, opacity = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color: c, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
});

export class WeaponArts {
  /** Weapon art meter 0..1 */
  meter = 0;
  /** How many weapon arts were performed (for tests) */
  specials = 0;
  /** How many times synergies fired (for tests): id → count */
  readonly procs = new Map<string, number>();
  /** The next strikes are guaranteed crits ("Heart of the Star") */
  forcedCrits = 0;
  private def: WeaponDef | null = null;
  private temper: TemperSlot[] = [];
  private syn: Synergy[] = [];
  private colors: THREE.Color[] = DEFAULT_COLORS;
  private readonly ents: Ent[] = [];
  private run: { spec: SpecialRun; next: number } | null = null;
  private sparkAcc = 0;
  private boltAcc = 0;
  private time = 0;
  /** Trail of a flying weapon: boomerang, sky sword */
  private readonly flyTrail: SwordTrail;
  private flying: { obj: THREE.Object3D; base: number; tip: number } | null = null;
  private model: THREE.Group | null = null;

  private readonly h: ArtsHooks;
  constructor(h: ArtsHooks) { this.h = h;
    this.flyTrail = new SwordTrail(h.scene);
    this.flyTrail.life = 0.22;
  }

  get fx(): FX { return this.h.fx; }
  get hero(): Knight { return this.h.hero; }
  get synergies(): readonly Synergy[] { return this.syn; }
  get tempers(): readonly TemperSlot[] { return this.temper; }
  get category(): WeaponCategory { return this.def?.category ?? 'sword'; }
  get specialTitle(): string { return WEAPON_SPECIAL[this.category].title; }
  get ready(): boolean { return this.meter >= 1; }
  /** Main temper colour (or the default) — for the HUD */
  get color(): THREE.Color { return this.colors[0]; }
  get busy(): boolean { return this.ents.length > 0 || !!this.run; }

  /** A tempered weapon is equipped: blade and trail colours, synergies */
  set(def: WeaponDef, temper: TemperSlot[]): void {
    const same = this.def === def && temper.length === this.temper.length && temper.every((t, i) => t.id === this.temper[i].id && t.tier === this.temper[i].tier);
    if (same) return;
    if (this.def !== def && this.model) { disposeWeaponModel(this.model); this.model = null; }
    this.def = def;
    this.temper = temper.map((t) => ({ ...t }));
    this.syn = synergiesOf(this.temper);
    this.colors = temper.length ? temper.map((t) => rgb(t.id)) : DEFAULT_COLORS;
    const hero = this.h.hero;
    if (!temper.length) { hero.swingLooks = null; hero.setBladeTint(null); return; }
    const c = this.colors, n = c.length, tiers = temper.reduce((s, t) => s + t.tier, 0);
    const width = Math.min(1, 0.8 + tiers * 0.02), life = 0.2 + tiers * 0.01;
    const look = (x: THREE.Color, y: THREE.Color, w = width, l = life): SwingLook => ({ color: x, color2: y, width: w, life: l, core: 0.25 });
    const dim = (x: THREE.Color): THREE.Color => x.clone().multiplyScalar(0.55);
    hero.swingLooks = n === 1
      ? [look(c[0], dim(c[0])), look(c[0], dim(c[0])), look(c[0], dim(c[0]), 0.95, life + 0.06), look(c[0], dim(c[0]), 1, life + 0.08)]
      : n === 2
        ? [look(c[0], c[1]), look(c[1], c[0]), look(c[0], c[1], 0.95, life + 0.06), look(c[1], c[0], 1, life + 0.08)]
        : [look(c[0], c[1]), look(c[1], c[2]), look(c[2], c[0], 0.95, life + 0.06), look(c[0], c[2], 1, life + 0.08)];
    hero.setBladeTint(c[0], 1);
  }

  // ---------- melee ----------

  /** The strike reached its midpoint: a crescent along the arc, synergies on the finisher; the weapon art meter grows */
  onStrike(s: Strike, hits: Target[], impact: THREE.Vector3): void {
    const fx = this.h.fx, hero = this.h.hero;
    const c = this.swingColor(s.step);
    // every swing is slightly different: radius, angle, crescent height and where the sparks fly
    const j = (a: number) => (rnd() - 0.5) * a;
    const y = hero.pos.y + 0.85 + j(0.25), yaw = s.yaw + j(0.22), R = (s.range + 0.2) * (0.92 + rnd() * 0.16);
    const fin = s.step === 2;
    if (s.half < 0.5) {
      fx.line(s.from, yaw, s.range + 0.3, c.clone().multiplyScalar(0.35), fin ? 0.5 : 0.35, 0.18, y);
      this.sparks(s.from.clone().addScaledVector(this.dir(yaw), s.range).setY(y), this.dir(yaw), c, fin ? 5 : 3, 1.2, 0.5);
    } else {
      const half = Math.min(Math.PI, s.half) * (0.9 + rnd() * 0.2);
      // crescent: a thin bright edge, a soft wide one under it, a third layer on the finisher
      fx.arc(s.from, yaw, c.clone().multiplyScalar(0.32), R, half, y, 0.82);
      fx.arc(s.from, yaw, c.clone().multiplyScalar(0.12), R * 0.96, half, y - 0.05, 0.5);
      if (fin) fx.arc(s.from, yaw + j(0.3), c.clone().lerp(new THREE.Color(1, 1, 1), 0.4).multiplyScalar(0.2), R * 1.12, half * 0.8, y + 0.1, 0.9);
      // sparks fly off the crescent edge tangentially
      const n = fin ? 6 : 3 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const a = yaw + (rnd() * 2 - 1) * half;
        const p = s.from.clone().addScaledVector(this.dir(a), R).setY(y);
        this.sparks(p, this.dir(a + (rnd() < 0.5 ? 1.2 : -1.2)), c, 1, 1.1, 0.6);
      }
    }
    // anime sweep (wiki/style-guide.md, section "Impact"): a ribbon of light races along the swing and lingers — two on the finisher,
    // and when the finisher lands, a shaft of light from the sky into the point of impact and a star of rays
    const side = s.step === 1 ? -1 : 1, hot = c.clone().lerp(WHITE, 0.35);
    if (s.half >= 0.5) {
      const half = Math.min(Math.PI, s.half), ox = s.from.x, oz = s.from.z;
      const sweep = (r: number, yy: number, w: number, dur: number): void => fx.streak({ path: (k, out) => { const a = yaw + side * half * (1 - 2 * k); return out.set(ox + Math.sin(a) * r, yy, oz + Math.cos(a) * r); }, dur, color: hot, color2: c.clone().multiplyScalar(0.5), width: w, tail: 0.22, halo: 3, core: 0.9 });
      sweep(R, y, fin ? 0.2 : 0.13, 0.07);
      if (fin) sweep(R * 0.72, y + 0.25, 0.12, 0.09);
    } else fx.cut(s.from.clone().addScaledVector(this.dir(yaw), s.range * 0.55).setY(y), this.dir(yaw), s.range * 1.2, hot, fin ? 0.16 : 0.1);
    if (fin && hits.length) {
      fx.pillar(impact.clone(), hot, 7, 0.5);
      fx.shafts(impact.clone().setY(impact.y + 0.9), hot, 8, 3, 0.12, 0.8);
      fx.light(impact.clone().setY(impact.y + 1.4), '#' + c.clone().multiplyScalar(1 / Math.max(1, c.r, c.g, c.b)).getHexString(), 7, 9, 0.3);
      fx.shake = Math.max(fx.shake, 0.4);
    }
    if (hits.length) this.meter = Math.min(1, this.meter + (1 + 0.25 * (hits.length - 1)) / SPECIAL_HITS);
    if (s.step === 2 && this.syn.length) this.proc(impact.clone().setY(hero.pos.y), s.yaw, hits, 1);
  }

  /** A hit on a target: a flash and each enchantment's effect */
  onHitTarget(t: Target, point: THREE.Vector3, dir: THREE.Vector3, crit: boolean, finisher: boolean): void {
    const fx = this.h.fx, hero = this.h.hero;
    fx.flash(point, this.colors[0].clone().multiplyScalar(finisher ? 1.3 : 0.9), (finisher ? 2 : 1.3) * (0.85 + rnd() * 0.3), 0.16);
    // ribbon splashes from the hit: along the strike direction with spread, each temper in its own colour
    this.sparks(point, dir, this.temper.length ? this.colors[(rnd() * this.colors.length) | 0] : this.colors[0], finisher ? 6 : 3, finisher ? 1.8 : 1.2, 1.1);
    // anime impact: a star of light shafts out of the wound, a cut of light across the target, a spray of glowing sparks along the strike
    const c0 = this.colors[0], hot = c0.clone().lerp(WHITE, crit ? 0.6 : 0.4), big = finisher || crit;
    fx.shafts(point, hot, big ? 7 : 4, big ? 2.8 : 1.7, big ? 0.11 : 0.07);
    fx.cut(point, _v.set(dir.z + (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 1.2, -dir.x + (rnd() - 0.5) * 0.8).normalize().clone(), big ? 3.4 : 2.2, hot, big ? 0.13 : 0.08);
    fx.spray(point, dir, [c0, hot, '#ffffff'], big ? 16 : 8, { speed: big ? 9 : 6, size: 0.07, life: 0.3, gravity: 6, spread: 0.7 });
    fx.burst(point, [c0, hot], big ? 10 : 5, { speed: 2.5, up: 3, size: 0.06, life: 0.45, glow: true, gravity: 7 });
    if (crit) { fx.pillar(t.pos.clone(), hot, 6, 0.45); fx.shake = Math.max(fx.shake, 0.3); }
    const yaw = Math.atan2(dir.x, dir.z);
    for (const { id, tier } of this.temper) {
      const c = rgb(id), n = 2 + tier;
      switch (id) {
        case 'sharpness':
          for (const a of [yaw + Math.PI / 4, yaw - Math.PI / 4]) {
            const from = point.clone().addScaledVector(_v.set(Math.sin(a), 0, Math.cos(a)), -0.8);
            fx.line(from, a, 1.6, c.clone().multiplyScalar(0.7), 0.28, 0.16, point.y);
          }
          break;
        case 'critical':
          fx.burst(point, [c, new THREE.Color(3.4, 3.2, 2.4)], n + 2, { speed: 2.5, up: 2, size: 0.07, life: 0.45, glow: true, gravity: 2 });
          if (crit) {
            fx.flash(point, c.clone().multiplyScalar(1.4), 2.6, 0.22);
            for (let i = 0; i < 8; i++) fx.line(point, (i / 8) * Math.PI * 2, 1.5, c.clone().multiplyScalar(0.6), 0.16, 0.22, point.y);
          }
          break;
        case 'leeching': this.orbs(point, c, n, 0.6); break;
        case 'knockback':
          fx.spray(point.clone().setY(hero.pos.y + 0.3), dir, ['#e8dcb0', '#c9b98a', '#a89a70'], n * 2, { speed: 5, glow: false, gravity: 3, size: 0.12, life: 0.45, spread: 0.6 });
          fx.ring(t.pos.clone().setY(hero.pos.y + 0.05), 1.2, c, 0.25, 0.25);
          break;
        case 'swirling': this.swirl(t.pos.clone().setY(hero.pos.y + 0.2), c, 0.7, n * 3); break;
        case 'fireAspect':
          fx.burst(point, [new THREE.Color(3.4, 1.4, 0.3), new THREE.Color(3.4, 2.4, 0.6)], n * 2, { speed: 1.5, up: 2.5, size: 0.07, life: 0.5, glow: true, gravity: -1 });
          fx.fireCubes(point, 0.5, n, [c, new THREE.Color(3.4, 2.4, 0.5)], 0.16);
          break;
        case 'soulSiphon': this.orbs(point, c, 1 + Math.floor(tier / 2), 0.9); break;
        case 'smiting': fx.bolt(point.clone().add(_v.set((rnd() - 0.5) * 1.2, 2.2, (rnd() - 0.5) * 1.2)), point, c, 0.05, 1, 0.14); break;
      }
    }
  }

  /** Crescent colour on a combo step: as the trail of that swing (temper, weapon colour or the step default) */
  private swingColor(step: number): THREE.Color {
    return this.h.hero.swingLooks?.[step]?.color ?? this.h.hero.trail.color.clone();
  }

  /** Fire the temper synergies at a point: three tempers — resonance */
  proc(at: THREE.Vector3, yaw: number, hits: Target[], mult: number): void {
    if (!this.syn.length) return;
    const res = this.syn.length >= 3;
    const base = this.h.hero.tune.swings[2].dmg * this.h.meleeMult() * mult * (res ? 0.7 : 1);
    for (const [i, s] of this.syn.entries()) {
      const a = this.temper.find((t) => t.id === s.pair[0])!, b = this.temper.find((t) => t.id === s.pair[1])!;
      const power = (a.tier + b.tier) / 6;
      const fn = SYNERGY_FX[s.id];
      if (!fn) continue;
      fn(this, { at: at.clone(), yaw, hits: hits.filter((t) => t.alive), dmg: Math.max(1, Math.round(base * (0.3 + 0.4 * power))), a: rgb(a.id), b: rgb(b.id), power });
      this.h.fx.text(at.clone().setY(at.y + 1.6 + i * 0.45), s.title, 'syn');
      this.procs.set(s.id, (this.procs.get(s.id) ?? 0) + 1);
    }
    if (res) {
      // resonance: three rings of three colours spread one after another
      this.colors.forEach((c, i) => this.later(i * 0.08, () => this.fx.ring(at.clone().setY(at.y + 0.08), 3 + i, c, 0.5, 0.12)));
      this.fx.flash(at.clone().setY(at.y + 1), this.colors[0].clone().lerp(new THREE.Color(1, 1, 1), 0.3), 2.4, 0.25);
      this.procs.set('resonance', (this.procs.get('resonance') ?? 0) + 1);
      this.h.fx.text(at.clone().setY(at.y + 2.2), RESONANCE.title, 'syn res');
    }
  }

  // ---------- weapon art ----------

  /** Q: weapon art towards aim, if the meter is full */
  special(aim: THREE.Vector3): boolean {
    const hero = this.h.hero;
    if (this.run && hero.special === null) this.run = null; // the hero was moved mid-strike
    if (!this.ready || this.run || hero.down || hero.rolling || hero.weaponHidden) return false;
    const yaw = Math.atan2(aim.x - hero.pos.x, aim.z - hero.pos.z);
    const spec = this.specialRun(this.category, Number.isFinite(yaw) ? yaw : hero.yaw);
    if (!hero.startSpecial(spec.move, spec.dur, Number.isFinite(yaw) ? yaw : hero.yaw)) return false;
    this.meter = 0;
    this.specials++;
    this.run = { spec, next: 0 };
    this.fx.title(this.specialTitle, `#${this.colors[0].clone().multiplyScalar(1 / Math.max(this.colors[0].r, this.colors[0].g, this.colors[0].b)).getHexString()}`);
    this.cue('start');
    return true;
  }

  /** Weapon art sound of the weapon's category (src/weapon-audio.ts) */
  private cue(c: SpecialCue): void { if (!this.h.quiet?.()) specialSound(this.category, c); }

  /** Weapon art damage: from the weapon's finisher */
  private B(k: number): number { return Math.max(1, Math.round(this.h.hero.tune.swings[2].dmg * this.h.meleeMult() * k)); }

  private specialRun(cat: WeaponCategory, yaw: number): SpecialRun {
    const hero = this.h.hero, fx = this.h.fx, c = this.colors[0], c2 = this.colors[1 % this.colors.length];
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const start = hero.pos.clone();
    const R = this.h.hero.tune.swings[0].range + 0.6;
    const ground = (p: THREE.Vector3) => p.clone().setY(hero.pos.y + 0.06);
    switch (cat) {
      case 'sword': {
        // whirl: four strikes around, a ring on each
        const ring = (i: number) => () => {
          this.area(hero.pos, R, this.B(0.45), 0.9, true);
          fx.ring(ground(hero.pos), R, (i % 2 ? c2 : c).clone(), 0.3, 0.18);
          this.swirl(hero.pos.clone().setY(hero.pos.y + 0.9), c, R * 0.8, 10);
          this.cue('hit');
        };
        return { move: 'spin', dur: 0.85, events: [[0.22, ring(0)], [0.42, ring(1)], [0.62, ring(2)], [0.82, ring(3)], [0.93, () => { this.cue('end'); this.proc(hero.pos.clone(), hero.yaw, this.near(hero.pos, R), 1.2); }]] };
      }
      case 'axe':
        return { move: 'throw', dur: 0.6, events: [[0.55, () => this.boomerang(yaw)]] };
      case 'dagger':
        return {
          move: 'dash', dur: 0.5, events: [
            [0.14, () => {
              fx.burst(start.clone().setY(start.y + 0.8), [new THREE.Color(0.6, 0.3, 1.2), c], 16, { speed: 2, up: 1, size: 0.1, life: 0.5, glow: true, gravity: 0 });
              // the shadow trails behind the hero as a ribbon, weaving slightly
              const ph = rnd() * 6.28;
              fx.streak({ path: (k, out) => out.copy(hero.pos).setY(hero.pos.y + 0.8 + Math.sin(ph + k * 12) * 0.2), dur: 0.2, color: new THREE.Color(0.9, 0.4, 2), color2: c, width: 0.9, tail: 0.3, halo: 1.8 });
            }],
            [0.52, () => {
              const end = hero.pos.clone();
              fx.line(start.clone(), yaw, start.distanceTo(end) + 0.6, c.clone().multiplyScalar(0.8), 0.7, 0.35, start.y + 0.9);
              const victims = this.onSegment(start, end, 1.1);
              for (let i = 0; i < 3; i++) this.later(i * 0.09, () => {
                for (const t of victims) if (t.alive) {
                  const a = yaw + (i - 1) * 0.9 + Math.PI / 2;
                  const p = t.pos.clone().setY(hero.pos.y + 1);
                  fx.line(p.clone().addScaledVector(_v.set(Math.sin(a), 0, Math.cos(a)), -0.9), a, 1.8, (i % 2 ? c2 : c).clone().multiplyScalar(0.8), 0.3, 0.16, p.y);
                  this.hurt(t, this.B(0.5), end, 0.3, true);
                }
                this.cue('hit');
              });
              this.later(0.3, () => this.cue('end'));
              this.proc(end, yaw, victims, 1);
            }],
          ],
        };
      case 'spear':
        return {
          move: 'lunge', dur: 0.6, events: [[0.5, () => {
            const end = hero.pos.clone().addScaledVector(fwd, 1.4);
            fx.line(start.clone(), yaw, start.distanceTo(end) + 0.4, c.clone().multiplyScalar(0.9), 0.9, 0.3, start.y + 0.9);
            fx.spray(end.clone().setY(end.y + 0.9), fwd, [c, c2, new THREE.Color(3.4, 3.4, 3)], 24, { speed: 9, spread: 0.35, life: 0.4 });
            const victims = this.onSegment(start, end, 1.2);
            for (const t of victims) {
              // shoves aside from the lunge line
              const side = Math.sign((t.pos.x - start.x) * fwd.z - (t.pos.z - start.z) * fwd.x) || 1;
              this.hit(t, this.B(1.6), _w.set(fwd.z * side, 0, -fwd.x * side).add(fwd).normalize().clone(), 2.2, true);
            }
            fx.shake = Math.max(fx.shake, 0.5);
            this.cue('hit');
            this.cue('end');
            this.proc(end, yaw, victims, 1);
          }]],
        };
      case 'mace':
        return {
          move: 'slam', dur: 0.75, events: [[0.48, () => {
            const at = hero.pos.clone().addScaledVector(fwd, 1.2);
            const radii = [2.6, 4, 5.4];
            radii.forEach((r, i) => this.later(i * 0.18, () => {
              const inner = i ? radii[i - 1] - 0.4 : 0;
              for (const t of this.near(at, r)) if (Math.hypot(t.pos.x - at.x, t.pos.z - at.z) >= inner) this.hurt(t, this.B(0.6), at, 1.4 + i * 0.6, true);
              fx.ring(ground(at), r, (i % 2 ? c2 : c).clone(), 0.4, 0.2);
              fx.burst(ground(at), ['#d8cfa8', '#b9ad88', '#9a8f70'], 10 + i * 4, { speed: r * 1.2, up: 2.4, size: 0.13, life: 0.5, gravity: 7 });
              fx.shake = Math.max(fx.shake, 0.45 + i * 0.15);
              this.cue('hit');
            }));
            this.later(0.5, () => this.cue('end'));
            this.proc(at, yaw, this.near(at, 2.6), 1);
          }]],
        };
      case 'hammer':
        return {
          move: 'leap', dur: 1, events: [[0.62, () => {
            const at = hero.pos.clone().addScaledVector(fwd, 1);
            this.area(at, 5.5, this.B(2), 3, true);
            fx.ring(ground(at), 5.5, c.clone(), 0.5, 0.25);
            fx.ring(ground(at), 3.6, c2.clone(), 0.4, 0.18);
            fx.flash(at.clone().setY(at.y + 0.8), c.clone().multiplyScalar(1.3), 5, 0.3);
            fx.light(at.clone().setY(at.y + 1.5), c.clone().multiplyScalar(0.4), 6, 12, 0.5);
            // rocks out of the ground
            fx.burst(ground(at), ['#8a8f99', '#6e737c', '#a6a09a', '#5e5148'], 26, { speed: 5, up: 7, size: 0.26, life: 1.1, gravity: 14 });
            fx.burst(ground(at), ['#d8cfa8', '#b9ad88'], 20, { speed: 6, up: 2, size: 0.14, life: 0.6, gravity: 6 });
            fx.shake = Math.max(fx.shake, 1.2);
            fx.hitstop = Math.max(fx.hitstop, 0.08);
            this.h.blast?.(at, 4, this.B(1));
            this.cue('hit');
            this.later(0.4, () => this.cue('end'));
            this.proc(at, yaw, this.near(at, 5.5), 1.2);
          }]],
        };
      case 'staff':
        return {
          move: 'wave', dur: 0.65, events: [[0.45, () => {
            const from = hero.pos.clone().addScaledVector(fwd, 0.6);
            this.cue('hit');
            this.crescent(from, yaw, 16, 10, 1.6, this.B(1.4), 1.2, c, (end, hit) => { this.cue('end'); this.proc(end, yaw, hit, 1); });
          }]],
        };
      case 'scythe': {
        const reap = (first: boolean) => () => {
          const hit = this.near(hero.pos, 4);
          for (const t of hit) {
            // pulls towards the hero
            const d = _w.set(hero.pos.x - t.pos.x, 0, hero.pos.z - t.pos.z).normalize().clone();
            this.hit(t, this.B(0.6), d, 1.8, true);
            if (first) { this.h.souls(1); this.orbs(t.pos.clone().setY(hero.pos.y + 1), new THREE.Color(0.6, 2.5, 3.4), 2, 0.9); }
          }
          fx.ring(ground(hero.pos), 4, c.clone(), 0.4, 0.2);
          this.swirl(hero.pos.clone().setY(hero.pos.y + 0.6), c2, 3.2, 18, true);
          this.cue('hit');
        };
        return { move: 'reap', dur: 0.8, events: [[0.45, reap(true)], [0.72, reap(false)], [0.86, () => { this.cue('end'); this.proc(hero.pos.clone(), hero.yaw, this.near(hero.pos, 4), 1); }]] };
      }
      case 'katana': {
        const reach = this.h.hero.tune.swings[2].range + 1.6;
        return {
          move: 'iai', dur: 0.95, events: [
            [0.12, () => { fx.darken(0.45); this.swirl(hero.pos.clone().setY(hero.pos.y + 0.4), c, 1.4, 14, true); }],
            [0.6, () => {
              fx.arc(hero.pos, hero.yaw, c.clone().multiplyScalar(0.35), reach, 1.3, hero.pos.y + 0.9, 0.9);
              fx.screenFlash('#ffffff', 0.25, 0.12);
              fx.hitstop = Math.max(fx.hitstop, 0.07);
              this.cue('hit');
            }],
            // the cuts appear on the targets slightly after the swing itself
            [0.8, () => {
              // cuts those who stood in front of the hero before the step and those he passed by
              const victims = [...new Set([...this.cone(start, yaw, reach + 1, 1.1), ...this.onSegment(start, hero.pos, 1.2)])];
              for (const t of victims) {
                const p = t.pos.clone().setY(hero.pos.y + 1);
                for (const a of [hero.yaw + 0.5, hero.yaw - 0.9]) fx.line(p.clone().addScaledVector(_v.set(Math.sin(a), 0, Math.cos(a)), -1), a, 2, c2.clone().multiplyScalar(0.8), 0.3, 0.25, p.y);
                this.hurt(t, this.B(1.8), hero.pos, 1.4, true);
              }
              this.cue('end');
              this.proc(start.clone().addScaledVector(fwd, 2.5), yaw, victims, 1);
            }],
          ],
        };
      }
      case 'greatsword': {
        const R2 = this.h.hero.tune.swings[0].range + 0.8;
        const ring = (i: number) => () => {
          this.area(hero.pos, R2, this.B(0.55), 2, true);
          fx.ring(ground(hero.pos), R2, (i % 2 ? c2 : c).clone(), 0.35, 0.22);
          fx.burst(ground(hero.pos), ['#d8cfa8', '#9a8f70'], 10, { speed: 4, up: 1.6, size: 0.14, life: 0.5, gravity: 7 });
          fx.shake = Math.max(fx.shake, 0.5);
          this.cue('hit');
        };
        return {
          move: 'berserk', dur: 1.4, events: [[0.2, ring(0)], [0.37, ring(1)], [0.54, ring(2)], [0.71, ring(3)], [0.88, ring(4)], [0.95, () => {
            fx.ring(ground(hero.pos), R2 + 2, new THREE.Color(2.8, 0.3, 0.2), 0.5, 0.25);
            fx.flash(hero.pos.clone().setY(hero.pos.y + 1), new THREE.Color(2.8, 0.4, 0.3), 4, 0.3);
            fx.screenFlash('#a01818', 0.25, 0.25);
            this.area(hero.pos, R2 + 2, this.B(0.6), 3);
            this.cue('end');
            this.proc(hero.pos.clone(), hero.yaw, this.near(hero.pos, R2), 1.2);
          }]],
        };
      }
      case 'dual blades':
      case 'rapier':
      case 'knuckles':
        return this.flurry(cat);
      case 'halberd': {
        const sweep = (i: number) => () => {
          this.area(hero.pos, 3.3, this.B(0.5), 1.5, true);
          fx.ring(ground(hero.pos), 3.3, (i % 2 ? c2 : c).clone(), 0.3, 0.16);
          this.swirl(hero.pos.clone().setY(hero.pos.y + 0.9), c, 2.6, 12);
          this.cue('hit');
        };
        return { move: 'mill', dur: 1.1, events: [[0.22, sweep(0)], [0.42, sweep(1)], [0.62, sweep(2)], [0.82, sweep(3)], [0.92, () => { this.cue('end'); this.proc(hero.pos.clone(), hero.yaw, this.near(hero.pos, 3.3), 1); }]] };
      }
    }
  }

  /** Flurry: dual blades, rapier, knuckles — a series of short strikes and a final strong one */
  private flurry(cat: 'dual blades' | 'rapier' | 'knuckles'): SpecialRun {
    const hero = this.h.hero, fx = this.h.fx, c = this.colors[0], c2 = this.colors[1 % this.colors.length];
    // the pontiff blades without temper — flame on the right and light on the left
    const L = this.temper.length ? [c, c2] : cat === 'dual blades' ? [new THREE.Color(2.8, 0.8, 0.12), new THREE.Color(1.5, 0.9, 2.8)] : [c, c2];
    const n = cat === 'rapier' ? 7 : 8;
    const events: [number, () => void][] = [];
    for (let i = 0; i < n; i++) events.push([0.12 + (i / n) * 0.76, () => {
      const col = L[i % 2], f = this.dir(hero.yaw);
      if (cat === 'rapier') {
        const a = hero.yaw + (rnd() - 0.5) * 0.3, R2 = this.h.hero.tune.swings[0].range + 0.6;
        fx.line(hero.pos.clone().addScaledVector(f, 0.3), a, R2, col.clone().multiplyScalar(0.6), 0.22, 0.12, hero.pos.y + 1);
        for (const t of this.onSegment(hero.pos, hero.pos.clone().addScaledVector(this.dir(a), R2), 0.6)) this.hurt(t, this.B(0.32), hero.pos, 0.3, true);
      } else {
        const R2 = cat === 'knuckles' ? 1.9 : 2.6;
        fx.arc(hero.pos, hero.yaw + (i % 2 ? 0.5 : -0.5), col.clone().multiplyScalar(0.3), R2, 0.8, hero.pos.y + 0.9, 0.8);
        for (const t of this.cone(hero.pos, hero.yaw, R2, 0.9)) {
          this.hurt(t, this.B(cat === 'knuckles' ? 0.25 : 0.3), hero.pos, 0.4, true);
          fx.burst(t.pos.clone().setY(hero.pos.y + 1), [col], 5, { speed: 2.5, up: 1.5, size: 0.07, life: 0.35, glow: true, gravity: 4 });
        }
      }
      this.cue('hit');
    }]);
    events.push([0.94, () => {
      const f = this.dir(hero.yaw), at = hero.pos.clone().addScaledVector(f, 1.4);
      if (cat === 'rapier') {
        const R2 = this.h.hero.tune.swings[2].range + 1.5;
        fx.line(hero.pos.clone(), hero.yaw, R2, L[0].clone().multiplyScalar(0.9), 0.6, 0.3, hero.pos.y + 1);
        fx.spray(at.clone().setY(hero.pos.y + 1), f, [L[0], L[1]], 18, { speed: 9, spread: 0.2, life: 0.35 });
        const v = this.onSegment(hero.pos, hero.pos.clone().addScaledVector(f, R2), 0.7);
        for (const t of v) this.hurt(t, this.B(0.8), hero.pos, 2, true);
        this.proc(at, hero.yaw, v, 1);
      } else if (cat === 'knuckles') {
        fx.ring(at.clone().setY(hero.pos.y + 0.06), 2.6, L[0].clone(), 0.35, 0.25);
        fx.burst(at.clone().setY(hero.pos.y + 0.1), ['#d8cfa8', '#b9ad88'], 14, { speed: 4, up: 4, size: 0.12, life: 0.6, gravity: 8 });
        fx.shake = Math.max(fx.shake, 0.6);
        const v = this.area(at, 2.6, this.B(1), 3, true);
        this.cue('end');
        this.proc(at, hero.yaw, v, 1);
      } else {
        // criss-cross: flame and light, a two-colour explosion
        for (const [k, col] of [[1, L[0]], [-1, L[1]]] as const) fx.line(at.clone().addScaledVector(this.dir(hero.yaw + k * 0.8), -1.4), hero.yaw + k * 0.8, 2.8, col.clone().multiplyScalar(0.8), 0.45, 0.3, hero.pos.y + 1);
        fx.flash(at.clone().setY(hero.pos.y + 1), L[0].clone().lerp(L[1], 0.5), 3, 0.25);
        fx.fireCubes(at.clone().setY(hero.pos.y + 0.8), 1.4, 16, [L[0], L[1]], 0.24);
        fx.ring(at.clone().setY(hero.pos.y + 0.06), 3, L[1].clone(), 0.4, 0.2);
        const v = this.area(at, 3, this.B(0.8), 2, true);
        this.cue('end');
        this.proc(at, hero.yaw, v, 1);
      }
    }]);
    return { move: 'flurry', dur: cat === 'rapier' ? 0.9 : 1.1, events };
  }

  /** Targets in a cone from c: radius r, half-angle half */
  cone(c: THREE.Vector3, yaw: number, r: number, half: number): Target[] {
    return this.near(c, r).filter((t) => {
      const d = Math.hypot(t.pos.x - c.x, t.pos.z - c.z), a = Math.atan2(t.pos.x - c.x, t.pos.z - c.z) - yaw;
      return d < 0.8 || Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= half + Math.atan(t.radius / Math.max(d, 0.3));
    });
  }

  /** Axe boomerang: flies forward spinning and returns to the hand; cuts on the way there and back */
  private boomerang(yaw: number): void {
    const hero = this.h.hero, def = this.def;
    if (!def) return;
    const obj = new THREE.Group();
    const m = this.weaponModel(def);
    obj.add(m);
    m.position.z = -(def.bladeTip ?? 0.8) * 0.5;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const from = hero.pos.clone().setY(hero.pos.y + 1);
    const far = from.clone().addScaledVector(fwd, 8);
    const hitOut = new Set<Target>(), hitBack = new Set<Target>();
    hero.weaponHidden = true;
    this.flying = { obj: m, base: def.bladeBase ?? 0.3, tip: def.bladeTip ?? 0.8 };
    this.flyTrail.color.copy(this.colors[0]); this.flyTrail.color2.copy(this.colors[1 % this.colors.length]); this.flyTrail.width = 1; this.flyTrail.cut();
    let turned = false, spinAcc = 0;
    const T = 1.1;
    // a real boomerang: goes out in an arc one way, comes back the other; the bend differs every time
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar((rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * 1.6));
    const lift = rnd() * 0.6;
    this.ent(T, (_dt, k) => {
      const out = k < 0.5;
      const back = hero.pos.clone().setY(hero.pos.y + 1);
      const p = out ? from.clone().lerp(far, Math.sin((k / 0.5) * Math.PI / 2)) : far.clone().lerp(back, 1 - Math.cos(((k - 0.5) / 0.5) * Math.PI / 2));
      p.addScaledVector(side, Math.sin(k * Math.PI * 2) * (out ? 1 : 0.8)).setY(p.y + Math.sin(k * Math.PI) * lift);
      obj.position.copy(p);
      obj.rotation.set(0, k * 26, Math.PI / 2);
      if (!out && !turned) { turned = true; this.proc(far.clone().setY(hero.pos.y), yaw, this.near(far, 2), 0.8); }
      const set = out ? hitOut : hitBack;
      for (const t of this.near(p, 1.1)) if (!set.has(t)) { set.add(t); this.hurt(t, this.B(0.9), p, 1, true); if (!this.h.quiet?.()) weaponHit('axe', false); }
      // spin whistle: once per revolution
      spinAcc += _dt * 9;
      if (spinAcc >= 1) { spinAcc -= 1; this.cue('hit'); }
    }, () => {
      hero.weaponHidden = false;
      this.flying = null;
      this.cue('end');
      this.h.scene.remove(obj);
      obj.remove(m);
      this.h.fx.burst(hero.pos.clone().setY(hero.pos.y + 1), [this.colors[0]], 8, { speed: 1.5, up: 1, size: 0.07, life: 0.3, glow: true, gravity: 0 });
    });
    this.h.scene.add(obj);
  }

  /** Model of the equipped weapon for the throw (one per weapon) */
  private weaponModel(def: WeaponDef): THREE.Group {
    return this.model ??= buildWeaponModel(def);
  }

  // ---------- frame ----------

  update(dt: number): void {
    this.time += dt;
    const hero = this.h.hero, fx = this.h.fx;
    // weapon art events by fraction
    if (this.run) {
      const k = hero.specialK, ev = this.run.spec.events;
      if (k < 0) { while (this.run.next < ev.length) ev[this.run.next++][1](); this.run = null; }
      else while (this.run.next < ev.length && k >= ev[this.run.next][0]) ev[this.run.next++][1]();
      if (this.run && this.run.next >= ev.length && hero.specialK < 0) this.run = null;
    }
    for (let i = this.ents.length - 1; i >= 0; i--) {
      const e = this.ents[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.dur);
      e.tick(dt, k);
      if (e.t >= e.dur) { this.ents.splice(i, 1); e.end?.(); }
    }
    // trail of the flying weapon
    if (this.flying) {
      const f = this.flying;
      f.obj.updateMatrixWorld(true);
      this.flyTrail.push(_v.set(0, 0, f.base).applyMatrix4(f.obj.matrixWorld), _w.set(0, 0, f.tip).applyMatrix4(f.obj.matrixWorld), this.time);
    }
    this.flyTrail.update(this.time);
    // blade: the glow pulses, a full meter — brighter
    if (this.temper.length || this.ready) {
      const pulse = this.ready ? 1.35 + Math.sin(this.time * 9) * 0.35 : 1 + Math.sin(this.time * 3) * 0.12;
      hero.setBladeTint(this.ready && !this.temper.length ? DEFAULT_COLORS[0] : this.colors[0], pulse);
    } else hero.setBladeTint(null);
    if (hero.weaponHidden || hero.down || !this.temper.length && !this.ready) return;
    // sparks off the edge: of the enchantment, denser during a swing
    const swinging = hero.attacking || hero.special !== null;
    const tiers = this.temper.reduce((s, t) => s + t.tier, 0) || 2;
    this.sparkAcc += dt * (4 + tiers * 2) * (swinging ? 3 : 1);
    if (this.sparkAcc < 1) return;
    const { base, tip } = hero.blade();
    while (this.sparkAcc >= 1) {
      this.sparkAcc -= 1;
      const t = this.temper.length ? this.temper[(rnd() * this.temper.length) | 0] : null;
      const p = base.clone().lerp(tip, 0.25 + rnd() * 0.75);
      this.spark(t?.id ?? 'sharpness', p);
    }
    if (this.temper.some((t) => t.id === 'smiting')) {
      this.boltAcc += dt * (swinging ? 6 : 1.5);
      if (this.boltAcc >= 1) { this.boltAcc = 0; fx.bolt(base, tip.clone().add(_v.set((rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4)), rgb('smiting'), 0.025, 0, 0.1); }
    }
  }

  /** One temper spark at the edge */
  private spark(id: MeleeEnchant, p: THREE.Vector3): void {
    const fx = this.h.fx, c = rgb(id), r = () => (rnd() - 0.5);
    switch (id) {
      case 'sharpness': fx.particle({ pos: p, vel: _v.set(r() * 0.4, 0.3, r() * 0.4).clone(), life: 0.35, size: 0.04, color: new THREE.Color(3, 3.2, 3.4), gravity: 0, spin: 12 }); break;
      case 'critical': fx.particle({ pos: p, vel: _v.set(r() * 0.6, 0.6, r() * 0.6).clone(), life: 0.5, size: 0.055, color: c, gravity: -0.4, spin: 14 }); break;
      case 'leeching': fx.particle({ pos: p, vel: _v.set(r() * 0.2, -0.2, r() * 0.2).clone(), life: 0.5, size: 0.05, color: c, gravity: 7, spin: 2 }); break;
      case 'knockback': fx.particle({ pos: p, vel: _v.set(r() * 0.8, 0.2, r() * 0.8).clone(), life: 0.5, size: 0.06, color: '#e8dcb0', gravity: 0.5, drag: 2 }, false); break;
      case 'swirling': { const a = rnd() * 6.28; fx.particle({ pos: p, vel: _v.set(Math.cos(a) * 0.9, 0.4, Math.sin(a) * 0.9).clone(), life: 0.45, size: 0.045, color: c, gravity: 0, drag: 3 }); break; }
      case 'fireAspect': fx.particle({ pos: p, vel: _v.set(r() * 0.3, 0.9, r() * 0.3).clone(), life: 0.55, size: 0.06, color: rnd() < 0.5 ? c : new THREE.Color(3.4, 2.4, 0.5), gravity: -2 }); break;
      case 'soulSiphon': fx.particle({ pos: p, vel: _v.set(r() * 0.3, 0.5, r() * 0.3).clone(), life: 0.8, size: 0.06, color: c, gravity: -0.6, drag: 1.5, spin: 1 }); break;
      case 'smiting': fx.particle({ pos: p, vel: _v.set(r() * 1.6, r() * 1.6, r() * 1.6).clone(), life: 0.18, size: 0.04, color: c, gravity: 0, spin: 20 }); break;
    }
  }

  // ---------- primitives for synergies and weapon arts ----------

  /** Living targets within r of c (by height — like a sword strike) */
  near(c: THREE.Vector3, r: number): Target[] {
    const y = this.h.hero.pos.y;
    return this.h.targets().filter((t) => t.alive && Math.abs(t.pos.y - y) <= 1.6 && Math.hypot(t.pos.x - c.x, t.pos.z - c.z) - t.radius <= r);
  }

  /** The n nearest targets to c within r, except those already taken */
  nearest(c: THREE.Vector3, r: number, n: number, skip: ReadonlySet<Target> = new Set()): Target[] {
    return this.near(c, r).filter((t) => !skip.has(t)).sort((a, b) => a.pos.distanceToSquared(c) - b.pos.distanceToSquared(c)).slice(0, n);
  }

  /** Targets along the segment a → b (dash, lunge) */
  onSegment(a: THREE.Vector3, b: THREE.Vector3, w: number): Target[] {
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    return this.near(a.clone().lerp(b, 0.5), Math.sqrt(l2) / 2 + w).filter((t) => {
      const k = l2 > 0 ? THREE.MathUtils.clamp(((t.pos.x - a.x) * dx + (t.pos.z - a.z) * dz) / l2, 0, 1) : 0;
      return Math.hypot(a.x + dx * k - t.pos.x, a.z + dz * k - t.pos.z) - t.radius <= w;
    });
  }

  /** Damage to a target from point from (knocks back away from it) */
  hurt(t: Target, v: number, from: THREE.Vector3, knock: number, melee = false): void {
    const d = new THREE.Vector3(t.pos.x - from.x, 0, t.pos.z - from.z);
    if (d.lengthSq() < 1e-4) d.set(rnd() - 0.5, 0, rnd() - 0.5);
    this.h.hitTarget(t, v, d.normalize(), knock, melee);
  }

  /** Damage to a target with a given knockback direction (pull — towards the hero, shove — sideways) */
  hit(t: Target, v: number, dir: THREE.Vector3, knock: number, melee = false): void { this.h.hitTarget(t, v, dir, knock, melee); }

  /** Area damage: 30 % weaker towards the edge (falloff) */
  area(c: THREE.Vector3, r: number, v: number, knock: number, melee = false, falloff = true): Target[] {
    const hit = this.near(c, r);
    for (const t of hit) {
      const d = Math.hypot(t.pos.x - c.x, t.pos.z - c.z);
      this.hurt(t, Math.max(1, Math.round(v * (falloff ? 1 - Math.min(1, d / (r + t.radius)) * 0.3 : 1))), c, knock, melee);
    }
    return hit;
  }

  heal(v: number): void { this.h.heal(v); }
  souls(n: number): void { this.h.souls(n); }
  sound(k: Parameters<ArtsHooks['sound']>[0]): void { this.h.sound(k); }
  blast(at: THREE.Vector3, r: number, dmg: number): void { this.h.blast?.(at, r, dmg); }
  get scene(): THREE.Scene { return this.h.scene; }
  get maxHp(): number { return this.h.hero.maxHp; }
  get ground(): number { return this.h.hero.pos.y; }

  /** Temporary effect: tick every frame with fraction k, end — at the end */
  ent(dur: number, tick: (dt: number, k: number) => void, end?: () => void): void { this.ents.push({ t: 0, dur, tick, end }); }

  /** Call fn after sec seconds of game time */
  later(sec: number, fn: () => void): void {
    if (sec <= 0) { fn(); return; }
    this.ents.push({ t: 0, dur: sec, tick: () => {}, end: fn });
  }

  /** fn(i) n times with a step of step seconds, the first at once */
  repeat(n: number, step: number, fn: (i: number) => void): void {
    for (let i = 0; i < n; i++) this.later(i * step, () => fn(i));
  }

  /** A body in the scene for dur seconds: tick moves it, at the end — remove and free (shared geometries stay) */
  body(obj: THREE.Object3D, dur: number, tick: (k: number, dt: number) => void, end?: () => void): void {
    this.h.fx.custom(obj, dur, () => {});
    this.ent(dur, (dt, k) => tick(k, dt), end);
  }

  /**
   * Elemental trajectory (wiki/design-weapon-arts.md, section 7): from from to to (a point or a function — the target moves)
   * along an arc with a random sideways bend (bulge, fraction of the distance), lift (lift) and jitter (wobble) — different every time
   */
  curve(from: THREE.Vector3, to: THREE.Vector3 | (() => THREE.Vector3), bulge = 0.4, lift = 0.3, wobble = 0.15): (k: number, out: THREE.Vector3) => THREE.Vector3 {
    const p0 = from.clone(), side = rnd() < 0.5 ? -1 : 1;
    const bk = bulge * (0.5 + rnd()) * side, lk = lift * (0.4 + rnd() * 0.9);
    const ph = rnd() * 6.28, fq = 1.5 + rnd() * 2.5, sk = rnd() * 0.3;
    const end = typeof to === 'function' ? to : () => to;
    const tmp = new THREE.Vector3(), perp = new THREE.Vector3();
    return (k, out) => {
      const p2 = end();
      tmp.subVectors(p2, p0);
      const d = Math.hypot(tmp.x, tmp.z) || 1;
      perp.set(-tmp.z / d, 0, tmp.x / d);
      // the offset is strongest mid-path (sin), converges exactly on the target at the end
      const env = Math.sin(Math.PI * k), kk = k + sk * env * (k - 0.5);
      out.copy(p0).lerp(p2, kk);
      out.addScaledVector(perp, (bk * d + Math.sin(ph + k * fq * 6.28) * wobble * d) * env);
      out.y += (lk * d + Math.cos(ph + k * fq * 5) * wobble * 0.6 * d) * env;
      return out;
    };
  }

  /** A wisp entity: flies along its own curve with a ribbon tail, drops sparks on the way; onEnd — arrived */
  wisp(from: THREE.Vector3, to: THREE.Vector3 | (() => THREE.Vector3), c: THREE.Color, o: { dur?: number; width?: number; tail?: number; bulge?: number; lift?: number; wobble?: number; sparks?: number; c2?: THREE.Color; onEnd?: (p: THREE.Vector3) => void } = {}): void {
    const fx = this.h.fx, sp = o.sparks ?? 0.35;
    fx.streak({
      path: this.curve(from, to, o.bulge ?? 0.45, o.lift ?? 0.35, o.wobble ?? 0.08),
      dur: (o.dur ?? 0.5) * (0.8 + rnd() * 0.45), color: c, color2: o.c2 ?? c.clone().multiplyScalar(0.45),
      width: o.width ?? 0.14, tail: o.tail ?? 0.22,
      onHead: (p) => { if (rnd() < sp) fx.particle({ pos: p.clone(), vel: _v.set((rnd() - 0.5) * 1.2, rnd() * 0.8, (rnd() - 0.5) * 1.2).clone(), life: 0.3, size: 0.05, color: c, gravity: -0.5 }); },
      onEnd: (p) => { fx.flash(p, c.clone(), 0.9, 0.14); o.onEnd?.(p); },
    });
  }

  /** Wisps fly from a point to the hero (healing, souls): each along its own arc, catching up with the hero */
  orbs(from: THREE.Vector3, c: THREE.Color, n: number, size = 0.7): void {
    const hero = this.h.hero, chest = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = from.clone().add(_v.set((rnd() - 0.5) * 0.6, rnd() * 0.5, (rnd() - 0.5) * 0.6));
      this.wisp(p, () => chest.copy(hero.pos).setY(hero.pos.y + 1), c, { dur: 0.45 + rnd() * 0.25, width: 0.16 * size, bulge: 0.6, lift: 0.5, wobble: 0.06 });
    }
  }

  /** Ribbon sparks splashing from a point: short curved tails in all directions around dir */
  sparks(at: THREE.Vector3, dir: THREE.Vector3 | null, c: THREE.Color, n: number, len = 1.4, spread = Math.PI): void {
    const base = dir ? Math.atan2(dir.x, dir.z) : rnd() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = base + (rnd() - 0.5) * spread * 2, l = len * (0.5 + rnd() * 0.8);
      const to = at.clone().add(_v.set(Math.sin(a) * l, (rnd() - 0.3) * l * 0.6, Math.cos(a) * l));
      this.h.fx.streak({ path: this.curve(at, to, 0.35, 0.15, 0.05), dur: 0.12 + rnd() * 0.12, color: c, width: 0.06 + rnd() * 0.05, tail: 0.12, halo: 3 });
    }
  }

  /** Curl: particles circle c tangentially and rise */
  swirl(c: THREE.Vector3, col: THREE.Color, r: number, n: number, inward = false): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
      const p = c.clone().add(_v.set(Math.cos(a) * r, rnd() * 0.4, Math.sin(a) * r));
      const sp = 3 + r * 1.5;
      const tang = _w.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(sp);
      if (inward) tang.add(_v.set(-Math.cos(a), 0, -Math.sin(a)).multiplyScalar(sp * 0.5));
      this.h.fx.particle({ pos: p, vel: tang.clone().setY(1.2), life: 0.45, size: 0.07, color: col, gravity: 0, drag: 1.5 });
    }
  }

  /** Lightning from the sky at a point */
  skyBolt(at: THREE.Vector3, c: THREE.Color, width = 0.12): void {
    const fx = this.h.fx;
    // from a different side of the sky and with a different kink every time; a thick ribbon core over the polyline
    const top = at.clone().add(_v.set((rnd() - 0.5) * 4, 8 + rnd() * 3, (rnd() - 0.5) * 4));
    fx.bolt(top, at.clone(), c, width, 3 + Math.floor(rnd() * 3), 0.3);
    fx.streak({ path: this.curve(top, at.clone(), 0.12, 0, 0.05), dur: 0.08, color: c.clone().lerp(new THREE.Color(1, 1, 1), 0.3).multiplyScalar(1.3), width: width * 2.2, tail: 0.22, halo: 3.5 });
    fx.flash(at.clone().setY(at.y + 0.6), c.clone(), 2.6, 0.22);
    fx.ring(at.clone().setY(at.y + 0.06), 1.4 + rnd() * 0.4, c, 0.3, 0.3, 0.6);
    this.sparks(at.clone().setY(at.y + 0.3), null, c, 5, 1.2);
  }

  /** Chain lightning: from from across the n nearest targets, a jump up to range */
  chain(from: THREE.Vector3, n: number, range: number, c: THREE.Color, v: number, each?: (t: Target) => void): Target[] {
    const done = new Set<Target>();
    let p = from.clone().setY(from.y + 1);
    for (let i = 0; i < n; i++) {
      const [t] = this.nearest(p, range, 1, done);
      if (!t) break;
      done.add(t);
      const q = t.pos.clone().setY(this.ground + 1);
      this.later(i * (0.05 + rnd() * 0.05), ((a: THREE.Vector3, b: THREE.Vector3) => () => {
        // an arc sagging in a random direction: a juicy ribbon and a thin polyline over it
        this.h.fx.streak({ path: this.curve(a, b, 0.35, 0.25, 0.06), dur: 0.12, color: c.clone().multiplyScalar(1.2), color2: c, width: 0.2, tail: 0.3, halo: 3 });
        this.h.fx.bolt(a, b, c, 0.05, 1, 0.2);
        this.h.fx.flash(b, c.clone(), 1.6, 0.16);
        this.sparks(b, null, c, 3, 0.9);
        if (t.alive) { this.hurt(t, v, a, 0.6); each?.(t); }
      })(p.clone(), q));
      p = q;
    }
    if (done.size) this.h.sound('zap');
    return [...done];
  }

  /**
   * Flying crescent: from from along yaw at speed speed over range range, width w; pierces everyone, each once.
   * onEnd — where it ended and whom it hit
   */
  crescent(from: THREE.Vector3, yaw: number, speed: number, range: number, w: number, v: number, knock: number, c: THREE.Color, onEnd?: (end: THREE.Vector3, hit: Target[]) => void): void {
    const mat = glowMat(c.clone().multiplyScalar(0.75));
    const m = new THREE.Mesh(CRESCENT(), mat);
    m.scale.setScalar(w);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    m.rotation.y = yaw - Math.PI / 2;
    const p0 = from.clone().setY(this.ground + 0.8);
    const done = new Set<Target>();
    const T = range / speed;
    // every crescent curls its own way and sways slightly, turning as it goes
    const curl = (rnd() - 0.5) * range * 0.35, ph = rnd() * 6.28;
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const at = (k: number, out: THREE.Vector3): THREE.Vector3 => out.copy(p0).addScaledVector(fwd, range * k).addScaledVector(side, curl * Math.sin(Math.PI * k) + Math.sin(ph + k * 9) * 0.12);
    const tip = new THREE.Vector3(), prev = new THREE.Vector3();
    this.h.fx.streak({ path: at, dur: T, color: c.clone().multiplyScalar(0.9), width: w * 0.7, tail: 0.25, halo: 2 });
    this.body(m, T, (k) => {
      const p = at(k, tip).clone();
      at(Math.max(0, k - 0.02), prev);
      m.rotation.y = Math.atan2(p.x - prev.x, p.z - prev.z) - Math.PI / 2;
      m.position.copy(p).addScaledVector(fwd, -w * 0.6);
      mat.opacity = Math.min(1, (1 - k) * 4);
      if (rnd() < 0.8) this.h.fx.particle({ pos: p.clone().add(_v.set((rnd() - 0.5) * w, 0, (rnd() - 0.5) * w)), vel: fwd.clone().multiplyScalar(-2), life: 0.3, size: 0.07, color: c, gravity: 0 });
      for (const t of this.near(p, w * 0.9)) if (!done.has(t)) { done.add(t); this.hit(t, v, fwd.clone(), knock); }
    }, () => onEnd?.(at(1, tip).clone().setY(this.ground), [...done]));
  }

  /** Ghostly weapon model: one glowing material for the whole model */
  ghost(c: THREE.Color, scale = 1): THREE.Group {
    const g = new THREE.Group();
    if (!this.def) return g;
    const m = buildWeaponModel(this.def);
    const mat = glowMat(c.clone().multiplyScalar(0.6), 0.9);
    m.traverse((o) => { if (o instanceof THREE.Mesh) { (o.material as THREE.Material).dispose(); o.material = mat; o.castShadow = false; } });
    m.scale.setScalar(scale);
    g.add(m);
    g.userData.bladeTip = (this.def.bladeTip ?? 1) * scale;
    return g;
  }

  /** Direction yaw as a vector */
  dir(yaw: number): THREE.Vector3 { return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); }
  get up(): THREE.Vector3 { return UP; }
}
