import * as THREE from 'three';
import { rnd } from './rng.ts';
import { makeCanvas } from './headless.ts';
import { duck } from './audio.ts';
import { Sigil } from './sigils.ts';
import { ChargeSound, spellSfx } from './spell-audio.ts';
import type { FX } from './fx.ts';
import type { ArtifactStats } from './items.ts';
import type { Knight } from './knight.ts';
import type { Terrain } from './level/collide.ts';
import { additiveSprite, glowTex } from './loot-look.ts';
import { type Spell, type Tier } from './magic/registry.ts';
import type { Target } from './target.ts';

/**
 * Spells (wiki/design-spells.md): a charge as in Elden Ring and a cast in three phases — windup, impact, aftertaste.
 * Each phase is built from shared FX parts (flashes, screen flash, light, marks on the floor, hit stop) and layered sounds.
 * Numbers (damage, cooldown) — in src/items.ts, slots and souls — in src/gear.ts.
 */

export { spellOf } from './magic/registry.ts';

/** School: colours, circle pattern (src/sigils.ts) and charge sound (src/spell-audio.ts). Starters are named after their spell */
export type School = 'spark' | 'fireball' | 'icerain' | 'heal' | 'star' | 'void' | 'earth' | 'arcane' | 'summon' | 'blood';

export interface SpellHooks {
  scene: THREE.Scene;
  fx: FX;
  hero: Knight;
  terrain: Terrain;
  targets(): Target[];
  /** Damage to one target (the label, souls, XP — on the gear side) */
  damage(t: Target, dmg: number, from: THREE.Vector3, knock: number): void;
  /** Area damage; blast — ignite barrels, break crates */
  aoe(c: THREE.Vector3, r: number, dmg: number, knock: number, blast: boolean): number;
}

/** Charge multiplier: tap — ×1, full — ×2.5 */
export const chargeMult = (k: number): number => 1 + 1.5 * k;

const C = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
/** Element colours: brightness above 1 glows through bloom */
export interface SchoolLook { a: THREE.Color; b: THREE.Color; css: string }
const SCHOOL: Record<School, SchoolLook> = {
  spark: { a: C(1, 2, 4), b: C(2.2, 3, 4), css: '#b8dcff' },
  fireball: { a: C(4, 1.5, 0.35), b: C(4, 3, 1), css: '#ffb060' },
  icerain: { a: C(1.4, 2.8, 4), b: C(2.8, 3.6, 4), css: '#c8f0ff' },
  heal: { a: C(0.9, 3.6, 1.1), b: C(3.8, 3.2, 1.2), css: '#d0ffb0' },
  // light and stars — gold and white; darkness and souls — violet and turquoise; earth and nature — amber and green; arcane — purple and pink
  star: { a: C(4, 3.2, 1.2), b: C(3.8, 3.8, 3.4), css: '#fff0b0' },
  void: { a: C(2, 0.8, 4), b: C(0.6, 3, 3.4), css: '#b890ff' },
  earth: { a: C(3.6, 2.2, 0.7), b: C(1.4, 3.2, 0.8), css: '#ffd890' },
  arcane: { a: C(3.4, 0.9, 4), b: C(4, 1.6, 2.6), css: '#ff9ae8' },
  // summoning — turquoise and the mint green of portals; raspberry blood — thick raspberry and scarlet juice
  summon: { a: C(0.5, 3.4, 2.6), b: C(1.6, 4, 1.8), css: '#90ffd8' },
  blood: { a: C(3.6, 0.25, 0.9), b: C(4, 0.9, 1.4), css: '#ff5a8a' },
};

// ---------- textures, drawn by code once ----------

const canvasTex = (size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture => {
  const c = makeCanvas(size, size);
  draw(c.getContext('2d') as CanvasRenderingContext2D, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

let scorchT: THREE.Texture | null = null, frostT: THREE.Texture | null = null;

/** Scorch mark: a dark uneven circle with a ragged edge */
export const scorchTex = (): THREE.Texture => scorchT ??= canvasTex(128, (g, s) => {
  const c = s / 2;
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * c * 0.45, r = c * (0.25 + rnd() * 0.35);
    const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(48,30,18,0.22)'); gr.addColorStop(1, 'rgba(48,30,18,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
});

/** Rime: white crystal rays from the centre */
export const frostTex = (): THREE.Texture => frostT ??= canvasTex(256, (g, s) => {
  const c = s / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineCap = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number): void => {
    if (len < 6) return;
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
    for (const t of [0.4, 0.7]) {
      const bx = x + (x1 - x) * t, by = y + (y1 - y) * t;
      branch(bx, by, a + 0.7, len * 0.32, w * 0.6); branch(bx, by, a - 0.7, len * 0.32, w * 0.6);
    }
  };
  for (let i = 0; i < 9; i++) branch(c, c, (i / 9) * Math.PI * 2 + rnd() * 0.3, c * (0.6 + rnd() * 0.35), 3);
});

const rand = (a: number, b: number): number => a + rnd() * (b - a);

interface Charging { slot: number; spell: Spell; school: School; max: number; t: number; full: boolean; sound: ChargeSound; sigil: Sigil; orb: THREE.Sprite }
interface Job { t: number; fn: () => void }

/** Temporary hero buff from a spell (titan form): multipliers of damage, damage taken, speed and size */
export interface HeroBuff {
  id: string; t: number; melee?: number; taken?: number; speed?: number; scale?: number;
  /** A sword strike on a target while the buff lasts (raspberry blade — bleeding) */
  onMelee?: (t: Target, dmg: number) => void;
}

export class Spells {
  private charge: Charging | null = null;
  private readonly jobs: Job[] = [];
  /** Per-frame processes (ball flight, rain, embers): false — finished */
  private readonly procs: ((dt: number) => boolean)[] = [];
  /** Spell time, s (grows in update) */
  time = 0;
  /** Spell impacts (for tests): how many times the impact phase fired */
  impacts = 0;
  /** Where the cursor points now — for spells that sweep a beam */
  readonly aim = new THREE.Vector3();
  /** Hero buffs; the gear (src/gear.ts) multiplies the stats while they last */
  readonly buffs: HeroBuff[] = [];
  /** Buffs changed — recompute the stats */
  onBuffs?: () => void;
  /** Textures of marks on the floor */
  readonly tex = { scorch: (): THREE.Texture => scorchTex(), frost: (): THREE.Texture => frostTex(), glow: (): THREE.Texture => glowTex() };

  readonly h: SpellHooks;
  constructor(h: SpellHooks) { this.h = h;}

  /** School colours */
  color(s: School): SchoolLook { return SCHOOL[s]; }

  /** Per-frame process: called every frame while it returns true */
  proc(fn: (dt: number) => boolean): void { this.procs.push(fn); }

  /** Hero buff for dur seconds (a repeat with the same id extends it) */
  buff(b: Omit<HeroBuff, 't'>, dur: number): void {
    const was = this.buffs.find((x) => x.id === b.id);
    if (was) was.t = Math.max(was.t, dur); else this.buffs.push({ ...b, t: dur });
    this.onBuffs?.();
  }

  /** Which slot is charging now and how much (0..1) */
  get charging(): { slot: number; k: number } | null { return this.charge ? { slot: this.charge.slot, k: this.k(this.charge) } : null; }

  private k(c: Charging): number { return Math.min(1, c.t / c.max); }

  /** The hero's hand: slightly ahead and at shoulder level */
  hand(): THREE.Vector3 {
    const hero = this.h.hero;
    return new THREE.Vector3(hero.pos.x + Math.sin(hero.yaw) * 0.5, hero.pos.y + 1.15, hero.pos.z + Math.cos(hero.yaw) * 0.5);
  }

  /** Turn the hero to a point and extend the arm */
  face(at: THREE.Vector3, sec = 0.35): void {
    const hero = this.h.hero;
    const dx = at.x - hero.pos.x, dz = at.z - hero.pos.z;
    hero.shootPose(dx * dx + dz * dz > 0.01 ? Math.atan2(dx, dz) : hero.yaw, sec);
  }

  /** Do fn after t seconds of game time */
  later(t: number, fn: () => void): void { this.jobs.push({ t: this.time + t, fn }); }

  // ---------- charge ----------

  /** Start charging (key held) */
  start(slot: number, spell: Spell, a: ArtifactStats): void {
    this.cancel();
    const school = spell.school, s = SCHOOL[school];
    // cast circle underfoot: the layers unfold in stages by charge (src/sigils.ts)
    const sigil = new Sigil(school, 2.2, s.a, s.b, 0.32);
    sigil.group.position.copy(this.h.hero.pos);
    this.h.scene.add(sigil.group);
    const orb = new THREE.Sprite(additiveSprite(glowTex(), s.b.clone().multiplyScalar(0.6)));
    orb.scale.setScalar(0.3);
    this.h.scene.add(orb);
    this.charge = { slot, spell, school, max: a.charge ?? 1, t: 0, full: false, sound: new ChargeSound(school), sigil, orb };
  }

  /** Release the key: charge 0..1 and the slot; the charge visuals are removed */
  release(): { slot: number; k: number } | null {
    const c = this.charge;
    if (!c) return null;
    const k = this.k(c);
    this.drop(c, true);
    return { slot: c.slot, k };
  }

  cancel(): void { if (this.charge) this.drop(this.charge, false); }

  /** cast — the circle flashes and spreads; cancel — it just fades */
  private drop(c: Charging, cast: boolean): void {
    c.sound.stop(cast ? 0.06 : 0.25);
    if (cast) c.sigil.burst(this.h.fx); else c.sigil.dispose();
    this.h.scene.remove(c.orb);
    c.orb.material.dispose();
    this.charge = null;
  }

  private updateCharge(dt: number, aim: THREE.Vector3): void {
    const c = this.charge;
    if (!c) return;
    const hero = this.h.hero, fx = this.h.fx, s = SCHOOL[c.school];
    c.t += dt;
    const k = this.k(c);
    c.sound.set(k);
    this.face(c.spell.self ? hero.pos.clone().add(new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw))) : aim, 0.2);
    // the cast circle follows the hero and unfolds in stages; each stage is a "click" with a chime, a ring and sparks upward
    c.sigil.group.position.set(hero.pos.x, hero.pos.y, hero.pos.z);
    c.sigil.group.scale.setScalar(2.2 * (0.85 + k * 0.3));
    const opened = c.sigil.update(dt, k, c.full);
    if (opened >= 0) {
      c.sound.stage(opened);
      if (opened > 0) {
        const R = 2.2 * (0.85 + k * 0.3);
        fx.shock(hero.pos.clone().setY(hero.pos.y + 0.08), R * (0.6 + opened * 0.15), opened % 2 ? s.b : s.a, 0.3, 0.1);
        for (let i = 0; i < 10 + opened * 4; i++) {
          const a = rnd() * Math.PI * 2;
          fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(a) * R * 0.95, 0.1, Math.sin(a) * R * 0.95)), vel: new THREE.Vector3(0, rand(2, 4.5), 0), life: rand(0.4, 0.7), size: rand(0.05, 0.09), color: rnd() < 0.5 ? s.a : s.b, gravity: -1, shrink: true });
        }
        fx.shake = Math.max(fx.shake, 0.08 + opened * 0.05);
      }
    }
    // from the third stage lights rise along the circle edge
    if (c.sigil.stage >= 2 && rnd() < 0.5 + k * 0.4) {
      const a = rnd() * Math.PI * 2, R = 2.2 * (0.85 + k * 0.3);
      fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(a) * R, 0.1, Math.sin(a) * R)), vel: new THREE.Vector3(0, rand(1.5, 3), 0), life: 0.6, size: 0.05, color: s.b, gravity: -0.5 });
    }
    // the orb in the hand (size — per spell)
    const hand = this.hand();
    c.orb.position.copy(hand);
    c.orb.scale.setScalar((c.spell.orb?.(k) ?? 0.35 + k * 0.7) * (1 + Math.sin(this.time * 30) * 0.08));
    // particles converge on the hand: the stronger the charge, the denser and faster
    const n = 1 + Math.round(k * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, e = rand(-0.6, 0.9), r = rand(1.2, 2.2);
      const from = hand.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r));
      const life = rand(0.22, 0.35) / (1 + k);
      fx.particle({ pos: from, vel: hand.clone().sub(from).divideScalar(life), life, size: rand(0.05, 0.09), color: rnd() < 0.5 ? s.a : s.b, gravity: 0, shrink: false });
    }
    // the spell's own charge visuals: sparks in the palm, a growing ball
    c.spell.charging?.(this, hand, k);
    // full charge: a ringing flash and a ring — "ready"
    if (k >= 1 && !c.full) {
      c.full = true;
      fx.flash(hand, s.b.clone(), 1.8, 0.3);
      fx.shock(hero.pos.clone().setY(hero.pos.y + 0.1), 2.6, s.a, 0.35, 0.12);
      fx.light(hand, s.css, 6, 6, 0.35);
      c.sound.full();
    }
  }

  // ---------- cast ----------

  /** Cast the spell at point at; k — charge 0..1; power — damage or healing with item power (the charge is multiplied in here) */
  cast(spell: Spell, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
    const kk = Math.max(0, Math.min(1, k));
    spell.cast(this, a, power * chargeMult(kk), at, kk);
  }

  /**
   * Pomp by rarity (wiki/design-spells.md, section 5) — call at the moment of impact of a boss spell:
   * common — nothing beyond impact; rare — hit stop and shake always; legendary — plus a moment of slow motion and a wide shockwave;
   * mythic — plus the world darkens and desaturates, the camera pulls back, a large title on screen.
   * For mythic it is convenient to call pomp('mythic', …) at the start of the windup: the darkening holds for darken seconds.
   */
  pomp(tier: Tier, at: THREE.Vector3, school: School, title = '', darken = 0.6): void {
    const fx = this.h.fx, s = SCHOOL[school];
    if (tier === 'common') return;
    fx.hitstop = Math.max(fx.hitstop, tier === 'rare' ? 0.07 : 0.09);
    fx.shake = Math.max(fx.shake, tier === 'rare' ? 0.6 : 0.9);
    if (tier === 'rare') return;
    fx.slowmo = Math.max(fx.slowmo, tier === 'mythic' ? 0.5 : 0.35);
    fx.shock(at.clone().setY(at.y + 0.06), tier === 'mythic' ? 14 : 10, s.a, 0.7, 0.08);
    fx.shock(at.clone().setY(at.y + 0.06), tier === 'mythic' ? 9 : 6, s.b, 0.55, 0.12);
    if (tier !== 'mythic') return;
    fx.darken(darken);
    fx.zoom = Math.max(fx.zoom, 0.35);
    if (title) fx.title(title, s.css);
    spellSfx.mythic();
  }

  /** Shared moment of impact: silence before it, screen flash, light, shake, hit stop on full charge */
  impact(school: School, at: THREE.Vector3, k: number, light: number, shake: number): void {
    const fx = this.h.fx, s = SCHOOL[school];
    duck(0.18, 0.25 + k * 0.2, 0.6);
    fx.screenFlash(s.css, 0.1 + k * 0.18, 0.14 + k * 0.1);
    fx.light(at.clone().setY(at.y + 1.6), s.css, light * (1 + k), 10 + k * 6, 0.45 + k * 0.25);
    fx.shake = Math.max(fx.shake, shake * (1 + k * 0.9));
    if (k > 0.6) fx.hitstop = Math.max(fx.hitstop, 0.05 + k * 0.04);
    this.impacts++;
  }

  /** A short windup for a cast without charging (tap, slot click): a flash in the hand and a whoosh */
  windup(school: School, k: number): void {
    const s = SCHOOL[school], hand = this.hand();
    this.h.fx.flash(hand, s.b.clone().multiplyScalar(0.8), 1 + k * 0.6, 0.2);
    this.h.fx.burst(hand, [s.a, s.b], 8, { speed: 1.5, up: 1, size: 0.06, life: 0.3, glow: true, gravity: 0 });
    spellSfx.release(school, k);
  }

  /**
   * A cast circle on the ground at point c with radius R: unfolds over unfold seconds, holds for hold, then spreads.
   * Returns the circle itself (group.position can be moved)
   */
  groundSigil(school: School, c: THREE.Vector3, R: number, unfold: number, hold: number, glow = 0.3): Sigil {
    const s = SCHOOL[school], sigil = new Sigil(school, R, s.a, s.b, glow);
    sigil.group.position.copy(c);
    this.h.scene.add(sigil.group);
    let t = 0;
    this.proc((dt) => {
      t += dt;
      sigil.update(dt, Math.min(1, t / Math.max(0.01, unfold)), t > unfold);
      if (t < unfold + hold) return true;
      sigil.burst(this.h.fx, 0.6);
      return false;
    });
    return sigil;
  }

  /** Living targets within a circle of radius r around p */
  within(p: THREE.Vector3, r: number): Target[] {
    return this.h.targets().filter((t) => t.alive && Math.hypot(t.pos.x - p.x, t.pos.z - p.z) - t.radius <= r);
  }

  /** The nearest living target to a point within r (except those already hit) */
  nearest(p: THREE.Vector3, r: number, skip: Set<Target> = new Set()): Target | null {
    let best: Target | null = null, bd = Infinity;
    for (const t of this.h.targets()) {
      if (!t.alive || skip.has(t)) continue;
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z) - t.radius;
      if (d < r && d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /** A point on the ground no farther than max from the hero */
  ground(at: THREE.Vector3, max: number): THREE.Vector3 {
    const hero = this.h.hero;
    const d = new THREE.Vector3(at.x - hero.pos.x, 0, at.z - hero.pos.z);
    if (d.length() > max) d.setLength(max);
    const p = hero.pos.clone().add(d);
    const y = this.h.terrain.floorAt(p.x, p.z, hero.pos.y + 3);
    p.y = Number.isFinite(y) ? y : hero.pos.y;
    return p;
  }

  /** A jagged lightning bolt of glowing bars: a core and a soft halo, flickers and fades; branches — offshoots */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, width: number, branches: number, dur = 0.32): void {
    this.h.fx.bolt(from, to, color, width, branches, dur);
  }


  // ---------- loop ----------

  update(dt: number, aim: THREE.Vector3): void {
    this.time += dt;
    this.aim.copy(aim);
    if (this.buffs.length) {
      for (const b of this.buffs) b.t -= dt;
      if (this.buffs.some((b) => b.t <= 0)) { this.buffs.splice(0, this.buffs.length, ...this.buffs.filter((b) => b.t > 0)); this.onBuffs?.(); }
    }
    if (this.charge && this.h.hero.down) this.cancel();
    this.updateCharge(dt, aim);
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].t <= this.time) { const j = this.jobs[i]; this.jobs.splice(i, 1); j.fn(); }
    for (let i = this.procs.length - 1; i >= 0; i--) if (!this.procs[i](dt)) this.procs.splice(i, 1);
  }
}
