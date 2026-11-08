import * as THREE from 'three';
import { pixelTex } from '../textures.ts';
import { bell, boom, deg, hiss, voice } from '../spell-audio.ts';
import { C, rand, RASP, wrap } from '../bosses/kit.ts';
import { riderModel, type RiderParts } from '../bosses/golden-rider.ts';
import { winterModel, type WinterParts } from '../bosses/winter-mistress.ts';
import { decoyList, type Decoy } from '../decoys.ts';
import { HpBar } from '../td/hpbar.ts';
import { Mob, type MobHooks } from './mob.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Bush Defence mini-bosses (wiki/design-tower-defence.md, section 11): every third wave one marches along with the pack.
 * Large, with a health bar over the head, with a big reward; each has its own ability on the march — once every few seconds,
 * without leaving the road: the giant stomps on nearby towers, the slime queen drops slimes, the snow shaman freezes towers around.
 */

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };
const ICE = C(1.6, 3.0, 4);

/** Shared by mini-bosses: health bar, ability on the march once every `every` seconds */
abstract class TdChief extends Mob {
  readonly cost = 10;
  /** How many times the ability was used (for tests) */
  casts = 0;
  protected abstract readonly every: number;
  private castCd = 3;
  private readonly bar: HpBar;

  constructor(h: MobHooks, hp: number, at: THREE.Vector3, barY: number) {
    super(h, hp, at);
    this.bar = new HpBar(2.2, barY, '#ff5a8a');
    this.group.add(this.bar.group);
  }

  /** Ability on the march; false — nothing to use it on now (will try a bit later) */
  protected abstract ability(): boolean;

  override update(dt: number): void {
    super.update(dt);
    this.bar.set(this.hp / this.maxHp, !this.dead);
    if (this.dead || !this.march || this.state === 'spawn') return;
    this.castCd -= dt;
    if (this.castCd > 0) return;
    if (this.ability()) { this.casts++; this.castCd = this.every; } else this.castCd = 1;
  }

  protected override die(): void { super.die(); this.bar.set(0, false); }
  /** A mini-boss cannot be stunned (heart of winter, storm spire hit with damage only) */
  override stun(): void { /* not stunnable */ }

  /** Intact towers within radius r */
  protected towersNear(r: number): Decoy[] {
    return decoyList().filter((d) => d.siege && d.alive && Math.hypot(d.pos.x - this.pos.x, d.pos.z - this.pos.z) < r);
  }
}

/** Raspberry Giant — tank: 600 health, 1.3 m/s; every 6 s on the march a stomp — 40 to towers within 4 m, 18 to the hero */
export class RaspberryBrute extends TdChief {
  readonly kind = 'chief_brute';
  readonly title = t('Raspberry Giant');
  readonly radius = 0.95;
  override readonly topY = 3.1;
  protected readonly every = 6;
  private readonly arms: THREE.Group[];
  private readonly legs: THREE.Group[];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 600, at, 3.6);
    this.speed = 1.3;
    this.turn = 2;
    this.keep = 1.6;
    this.mass = 8;
    this.aggro = 3;
    this.loot = 25;
    const berry = this.lam('#c8245a', pixelTex('#c8245a', 12, 1101)), deep = this.lam('#8a1040'), leaf = this.lam('#5aa03a', pixelTex('#5aa03a', 10, 1102)), eye = this.shimmer(C(3.4, 2.6, 0.8), C(3.4, 1.6, 0.4), 0, 2);
    const B = this.box.bind(this);
    // a huge berry torso of drupelets, leaf pauldrons, berry fists
    B(this.body, berry, 1.6, 1.5, 1.3, 0, 1.75, 0);
    for (const [x, y, z] of [[0.7, 2.1, 0.5], [-0.7, 1.5, 0.5], [0.2, 2.4, -0.55], [-0.5, 2.2, 0.62], [0.6, 1.3, -0.6]] as const) B(this.body, deep, 0.36, 0.36, 0.36, x, y, z);
    B(this.body, leaf, 1.9, 0.18, 0.7, 0, 2.6, 0, 0, 0, 0.1);
    B(this.body, leaf, 0.5, 0.4, 0.5, 0, 2.85, 0);
    for (const x of [-0.32, 0.32]) B(this.body, eye, 0.24, 0.16, 0.05, x, 2.15, 0.66);
    this.arms = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 1.0, 2.2, 0);
      this.body.add(g);
      B(g, leaf, 0.36, 1.0, 0.36, 0, -0.5, 0);
      B(g, berry, 0.6, 0.6, 0.6, 0, -1.1, 0.05);
      return g;
    });
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.45, 1.0, 0);
      this.body.add(g);
      B(g, leaf, 0.5, 1.0, 0.55, 0, -0.5, 0);
      return g;
    });
    this.place();
  }

  /** Stomp: a red 4 m circle, after 0.8 s — a hit on towers and the hero */
  protected ability(): boolean {
    if (!this.towersNear(5).length) return false;
    this.slam(4, 0.8);
    return true;
  }

  private slam(r: number, delay: number): void {
    const at = this.pos.clone();
    this.field.markCircle(at, r, delay, () => {
      if (this.dead) return;
      this.h.fx.shock(at.clone().setY(this.ground + 0.1), r, C(3.2, 0.8, 1.4), 0.5, 0.2);
      this.h.fx.burst(at.clone().setY(this.ground + 0.3), ['#c8245a', '#8a5a34', RASP], 24, { speed: 5, up: 3, size: 0.12, life: 0.6, gravity: 8 });
      this.h.fx.shake = Math.max(this.h.fx.shake, 0.5);
      if (!this.quiet) boom(60, 30, 0.6, 0.5);
      // the client puppet (src/cgame/net-battle.ts) hits for show: the server breaks towers
      if (!this.puppet) for (const d of decoyList()) if (d.siege && d.alive && Math.hypot(d.pos.x - at.x, d.pos.z - at.z) < r + 0.75) d.hurt(40 * this.dmgMult, at);
      if (this.inCircle(at, r)) this.hurt(18, at, 6);
    });
  }

  protected choose(dist: number): string | null { return dist < 3 ? 'slam' : null; }
  protected override rest(): number { return rand(1.8, 2.4); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) this.slam(3, 0.7);
    return t > 1.1;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 8), s = this.stride(4);
    lerpTo(this.legs[0], walk ? s * 0.5 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 0.5 : 0, k);
    const up = this.state === 'attack' && this.st < 0.7;
    for (const a of this.arms) lerpTo(a, up ? -2.6 : walk ? s * 0.3 : 0, k);
    this.body.position.y = walk ? Math.abs(s) * 0.08 : 0;
  }
}

/** Slime Queen: 450 health, 1.5 m/s in hops; every 6 s drops a medium slime that follows the same road; fell — three medium ones */
export class SlimeQueen extends TdChief {
  readonly kind = 'chief_slime';
  readonly title = t('Slime Queen');
  readonly radius = 0.9;
  override readonly topY = 2.4;
  protected readonly every = 6;
  private readonly jelly = new THREE.Group();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 450, at, 2.9);
    this.speed = 0;
    this.keep = 1.4;
    this.mass = 6;
    this.aggro = 3;
    this.loot = 25;
    const jam = new THREE.MeshLambertMaterial({ color: '#e0306a', transparent: true, opacity: 0.75 });
    this.flashMats.push(jam);
    const core = this.lam('#9a1240'), eye = this.lam('#2a1420'), gold = this.lam('#f2c94a', pixelTex('#f2c94a', 8, 1111)), gem = this.shimmer(C(3.4, 0.8, 1.6), C(3.4, 2.4, 3), 0, 2);
    const B = this.box.bind(this);
    this.body.add(this.jelly);
    B(this.jelly, jam, 2.0, 1.6, 2.0, 0, 0.8, 0);
    B(this.jelly, core, 0.7, 0.7, 0.7, 0, 0.75, 0);
    for (const x of [-0.4, 0.4]) B(this.jelly, eye, 0.24, 0.3, 0.04, x, 1.05, 1.0);
    // crown: a rim and four prongs with a gem
    B(this.jelly, gold, 1.0, 0.18, 1.0, 0, 1.7, 0);
    for (const [x, z] of [[0.4, 0.4], [-0.4, 0.4], [0.4, -0.4], [-0.4, -0.4]]) B(this.jelly, gold, 0.16, 0.36, 0.16, x, 1.92, z);
    B(this.jelly, gem, 0.2, 0.2, 0.06, 0, 1.75, 0.52);
    this.place();
  }

  protected override get marchPace(): number { return 1.5 * this.slowMul; }
  protected override steer(dt: number): boolean { this.face(dt); return false; }

  protected ability(): boolean {
    const m = this.mh.spawn('slime_mid', this.pos.clone().addScaledVector(this.fwd(), -1.4));
    if (!m) return false;
    m.summoned = true;
    m.joinMarch(this);
    this.h.fx.burst(this.pos.clone().setY(this.ground + 0.6), ['#e0306a', '#9a1240'], 12, { speed: 2.5, up: 2, size: 0.1, life: 0.5, gravity: 8 });
    if (!this.quiet) voice({ type: 'sine', f: 140, f1: 70, dur: 0.25, vol: 0.06 });
    return true;
  }

  protected override die(): void {
    super.die();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const m = this.mh.spawn('slime_mid', this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2)));
      if (!m) continue;
      m.summoned = true;
      if (this.march) m.joinMarch(this); else m.notice();
    }
  }

  protected choose(dist: number): string | null { return dist < 2.8 ? 'squash' : null; }
  protected override rest(): number { return rand(1.4, 2); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const at = this.pos.clone().addScaledVector(this.fwd(), 1.2);
      this.field.markCircle(at, 2, 0.6, () => {
        if (this.dead) return;
        this.h.fx.burst(at.clone().setY(this.ground + 0.1), ['#e0306a', '#9a1240'], 14, { speed: 3, up: 2, size: 0.1, life: 0.5, gravity: 8 });
        if (!this.quiet) voice({ type: 'sine', f: 120, f1: 60, dur: 0.2, vol: 0.07 });
        if (this.inCircle(at, 2)) this.hurt(14, at, 4);
      });
    }
    return t > 0.9;
  }

  protected animate(): void {
    const a = this.state === 'attack' ? (this.st < 0.4 ? 0.75 : 1.15) : 1 + Math.sin(this.time * 3) * 0.05;
    this.jelly.scale.set(1 / Math.sqrt(a), a, 1 / Math.sqrt(a));
    if (this.state !== 'attack') this.flyY = this.state === 'walk' ? Math.abs(Math.sin(this.time * 3.5)) * 0.4 : 0;
  }
}

/** Snow Shaman: 380 health, 1.7 m/s; every 10 s a blizzard — all towers within 9 m freeze for 4 s (not the spire) */
export class SnowShaman extends TdChief {
  readonly kind = 'chief_frost';
  readonly title = t('Snow Shaman');
  readonly radius = 0.7;
  override readonly topY = 2.8;
  protected readonly every = 10;
  private readonly staff = new THREE.Group();
  private readonly legs: THREE.Group[];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 380, at, 3.3);
    this.speed = 1.7;
    this.turn = 3;
    this.keep = 1.4;
    this.mass = 4;
    this.aggro = 3;
    this.loot = 25;
    const robe = this.lam('#3a5a9a', pixelTex('#3a5a9a', 10, 1121)), fur = this.lam('#eef6ff', pixelTex('#eef6ff', 8, 1122)), face = this.lam('#a8d8f0'), wood = this.lam('#6a4a2a');
    const eye = this.shimmer(ICE, C(3.6, 3.8, 4), 0, 2.4), crystal = this.shimmer(ICE, C(3.4, 3.6, 4), 1, 1.6);
    const B = this.box.bind(this);
    // a floor-length fur coat with a fur collar, an icicle beard, a horned hood
    B(this.body, robe, 1.2, 1.4, 1.0, 0, 1.2, 0);
    B(this.body, fur, 1.3, 0.2, 1.1, 0, 0.5, 0);
    B(this.body, fur, 1.3, 0.35, 1.1, 0, 1.95, 0);
    B(this.body, face, 0.7, 0.55, 0.6, 0, 2.3, 0.1);
    B(this.body, fur, 0.4, 0.5, 0.1, 0, 2.0, 0.42);
    for (const x of [-0.16, 0.16]) B(this.body, eye, 0.12, 0.08, 0.04, x, 2.38, 0.41);
    B(this.body, robe, 0.8, 0.3, 0.7, 0, 2.65, 0);
    for (const s of [-1, 1]) B(this.body, crystal, 0.14, 0.5, 0.14, s * 0.35, 2.95, 0, 0, 0, -s * 0.4);
    this.staff.position.set(0.75, 1.3, 0.2);
    this.body.add(this.staff);
    B(this.staff, wood, 0.1, 2.2, 0.1, 0, 0.2, 0);
    B(this.staff, crystal, 0.36, 0.5, 0.36, 0, 1.45, 0, 0, Math.PI / 4, 0);
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.3, 0.5, 0);
      this.body.add(g);
      B(g, fur, 0.35, 0.5, 0.45, 0, -0.25, 0.05);
      return g;
    });
    this.place();
  }

  protected ability(): boolean {
    const towers = this.towersNear(9);
    if (!towers.length) return false;
    this.h.fx.shock(this.pos.clone().setY(this.ground + 0.2), 9, ICE, 0.7, 0.25);
    this.h.fx.burst(this.pos.clone().setY(this.ground + 2.5), [ICE, '#ffffff'], 40, { speed: 6, up: 2, size: 0.12, life: 0.9, glow: true, gravity: 2 });
    if (!this.quiet) hiss({ dur: 0.8, vol: 0.14, f: 5000, f1: 1500, q: 1 });
    for (const t of towers) t.freeze?.(4);
    return true;
  }

  protected choose(dist: number): string | null { return dist < 3 ? 'nova' : null; }
  protected override rest(): number { return rand(1.6, 2.2); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const at = this.pos.clone();
      this.field.markCircle(at, 3, 0.7, () => {
        if (this.dead) return;
        this.h.fx.shock(at.clone().setY(this.ground + 0.2), 3, ICE, 0.4, 0.15);
        if (this.inCircle(at, 3)) this.hurt(12, at, 3);
      }, ICE);
    }
    return t > 1;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 10), s = this.stride(6);
    lerpTo(this.legs[0], walk ? s * 0.5 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 0.5 : 0, k);
    lerpTo(this.staff, this.state === 'attack' ? (this.st < 0.6 ? -0.8 : 0.3) : walk ? s * 0.15 : 0, k);
  }
}

const GOLD = C(4, 3, 1), SPECTRAL = C(2.6, 3, 4), DUST = ['#c8b890', '#9a8f70'];

/**
 * Golden Warden on the march — the final boss of the Raspberry Spiral (map 4, wiki/design-tower-defence.md, section 17): the arena
 * mini-boss's horse and rider (src/bosses/golden-rider.ts) on the road. 1600 health, 1.5 m/s; the shield takes a hit from the front
 * (±60°) at ×0.3 — towers that hit him in the back and the flank are worth more; a piercing bolt goes through. Every 6 s on the march:
 * towers within 5 m — a halberd sweep (45 to towers, 16 to the hero); farther, within 13 m — a phalanx: up to seven ghostly swords fall
 * on towers one by one (22 each); no towers around — a gallop: 2.5 s at 2.4× speed. At the bush — the sweep
 */
export class GoldenWardenChief extends TdChief {
  readonly kind = 'chief_warden';
  readonly title = t('Golden Warden');
  readonly radius = 1.3;
  override readonly topY = 3.9;
  protected readonly every = 6;
  /** How many swords have fallen (for tests) */
  blades = 0;
  private readonly p: RiderParts;
  private gait = 0;
  private gallopT = 0;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 1600, at, 4.6);
    this.speed = 1.5;
    this.turn = 2.2;
    this.keep = 2.4;
    this.mass = 12;
    this.aggro = 3;
    this.loot = 60;
    this.p = riderModel(this, this.body);
    this.place();
  }

  /** Shield on the left arm: a blow from the front (±60°) — ×0.3; dazed never, stunned never */
  protected override guard(dir: THREE.Vector3): number {
    const from = Math.atan2(-dir.x, -dir.z);
    return Math.abs(wrap(from - this.yaw)) < Math.PI / 3 ? 0.3 : 1;
  }

  /** Gallop: the march speed ×2.4 */
  protected override get marchPace(): number { return this.pace * (this.gallopT > 0 ? 2.4 : 1); }

  override update(dt: number): void {
    this.gallopT -= dt;
    super.update(dt);
  }

  protected ability(): boolean {
    if (this.towersNear(5).length) { this.sweep(4, 0.8, 45); return true; }
    const far = this.towersNear(13);
    if (far.length) { this.phalanx(far); return true; }
    this.gallopT = 2.5;
    if (!this.quiet) { voice({ type: 'sawtooth', f: 196, f1: 262, dur: 0.6, vol: 0.05, lp: 1400, verb: 0.5 }); boom(70, 35, 0.5, 0.5); }
    return true;
  }

  /** Halberd sweep: a circle of radius r, after `delay` — damage to towers and 16 to the hero (and the bush) */
  private sweep(r: number, delay: number, toTowers: number): void {
    const at = this.pos.clone();
    this.field.markCircle(at, r, delay, () => {
      if (this.dead) return;
      if (!this.quiet) hiss({ dur: 0.45, vol: 0.25, f: 600, f1: 2600, q: 1.4 });
      for (let i = 0; i < 4; i++) this.h.fx.arc(at.clone().setY(this.ground), this.yaw + i * Math.PI / 2, GOLD, r - 0.1, 1.6, 2.2);
      this.h.fx.shock(at.clone().setY(this.ground + 0.1), r, GOLD, 0.35, 0.18);
      if (!this.puppet) for (const d of decoyList()) if (d.siege && d.alive && Math.hypot(d.pos.x - at.x, d.pos.z - at.z) < r + 0.75) d.hurt(toTowers * this.dmgMult, at);
      if (this.inCircle(at, r)) this.hurt(16, at, 7);
    });
  }

  /** Phalanx: up to seven swords one by one onto the towers around (the nearest first), each with its own note of the chord */
  private phalanx(towers: Decoy[]): void {
    towers.sort((a, b) => Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) - Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z));
    for (let i = 0; i < 7; i++) {
      const tw = towers[i % towers.length], to = tw.pos.clone();
      this.field.markCircle(to, 1.1, 0.5 + i * 0.18, () => {
        if (this.dead) return;
        const sky = to.clone().add(new THREE.Vector3(0, 7, 0));
        this.h.fx.streak({ path: (k, out) => out.lerpVectors(sky, to, k), dur: 0.15, color: SPECTRAL, color2: i % 2 ? GOLD : RASP, width: 0.12, tail: 0.6, halo: 1.2, core: 0.9 });
        this.h.fx.burst(to.clone().setY(to.y + 0.4), [SPECTRAL, GOLD, RASP], 10, { speed: 3, up: 3, size: 0.08, life: 0.5, glow: true, gravity: 6 });
        if (!this.quiet) { bell(deg(392, i), 1.6, 0.05, 0, 0.6); boom(160, 70, 0.18, 0.2); }
        this.blades++;
        if (!this.puppet && tw.alive) tw.hurt(22 * this.dmgMult, to);
        if (this.inCircle(to, 1.1)) this.hurt(10, to, 3);
      });
    }
  }

  protected choose(dist: number): string | null { return dist < 3.5 ? 'sweep' : null; }
  protected override rest(): number { return rand(1.8, 2.4); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) this.sweep(3.5, 0.6, 30);
    return t > 1.05;
  }

  protected animate(dt: number, walk: boolean): void {
    const { horse, head, legsF, legsB, rider, halberd, emblem } = this.p, S = this.st;
    if (walk) {
      const was = this.gait % 1;
      this.gait += dt * (this.gallopT > 0 ? 3.2 : 1.6);
      const k = this.gait % 1, ph = k * Math.PI * 2;
      legsF.rotation.x = Math.sin(ph) * 0.7;
      legsB.rotation.x = -Math.sin(ph + 0.6) * 0.7;
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.18;
      horse.rotation.x = Math.sin(ph) * 0.06;
      head.rotation.x = Math.sin(ph + 1) * 0.18;
      if (k < was) {
        if (!this.quiet) { boom(95, 45, 0.16, 0.22); boom(80, 40, 0.14, 0.18, 0.07); }
        this.h.fx.burst(this.pos.clone().setY(this.ground + 0.1), DUST, this.gallopT > 0 ? 8 : 4, { speed: 1.2, up: 0.8, size: 0.1, life: 0.45, gravity: 6 });
      }
    } else if (this.state !== 'dead') {
      legsF.rotation.x *= 0.85; legsB.rotation.x *= 0.85;
      this.body.position.y *= 0.85;
      horse.rotation.x *= 0.85;
      head.rotation.x = Math.sin(this.time * 1.5) * 0.06;
    }
    // halberd: up at rest, levelled in the gallop, sideways and a full turn in the sweep
    const hb = halberd.rotation;
    if (this.state === 'attack') {
      const wind = Math.min(1, S / 0.5), spin = S < 0.6 ? -0.5 * wind : -0.5 + Math.min(1, (S - 0.6) / 0.3) * Math.PI * 2;
      hb.set(0, spin, 1.35 * wind);
    } else if (this.gallopT > 0) hb.set(Math.min(1.35, hb.x + dt * 3), 0, 0);
    else { hb.x *= 0.85; hb.y = wrap(hb.y) * 0.85; hb.z *= 0.85; }
    rider.rotation.x = -horse.rotation.x * 0.5;
    rider.position.y = 2.3 + Math.sin(this.time * 2) * 0.03;
    emblem.scale.setScalar(1 + Math.max(0, Math.sin(this.time * 5)) * 0.08);
  }
}

/**
 * Frost Queen on the march — the second final boss of the Raspberry Spiral, from the west portal (wiki/design-tower-defence.md,
 * section 17): the Mistress of Eternal Winter's model (src/bosses/winter-mistress.ts) hovering along the road. 1400 health, 1.4 m/s;
 * frost does not slow her. Every 6 s on the march: towers within 12 m — icicles on up to five of them one by one (25 each and
 * a 2.5 s freeze); no towers around — two ice warlocks join her road (six at most). At the bush — a frost nova
 */
export class FrostQueenChief extends TdChief {
  readonly kind = 'chief_frostqueen';
  readonly title = t('Frost Queen');
  readonly radius = 1.0;
  override readonly topY = 4.6;
  protected readonly every = 6;
  /** Icicles fallen and warlocks called (for tests) */
  icicles = 0;
  called = 0;
  private readonly arms: THREE.Group[] = [];
  private readonly shards: THREE.Mesh[] = [];
  private readonly p: WinterParts;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 1400, at, 5.2);
    this.speed = 1.4;
    this.turn = 2.4;
    this.keep = 2.2;
    this.mass = 10;
    this.aggro = 3;
    this.loot = 60;
    this.p = winterModel(this, this.body, this.arms, this.shards);
    this.place();
  }

  /** Ice does not slow the queen of ice */
  override chill(): void { /* immune */ }

  protected ability(): boolean {
    const towers = this.towersNear(12);
    if (towers.length) { this.iciclesOn(towers); return true; }
    if (this.called >= 6 || this.puppet) return false;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    for (const s of [-1, 1]) {
      const m = this.mh.spawn('frostling', this.pos.clone().addScaledVector(side, s * 1.6));
      if (m) { m.joinMarch(this); this.called++; }
    }
    this.h.fx.shock(this.pos.clone().setY(this.ground + 0.1), 3, ICE, 0.5, 0.2);
    if (!this.quiet) bell(98, 1.5, 0.06, 0, 0.8);
    return true;
  }

  /** Icicles: up to five towers, the nearest first; a mark, then the icicle — damage and a freeze */
  private iciclesOn(towers: Decoy[]): void {
    towers.sort((a, b) => Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) - Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z));
    towers.slice(0, 5).forEach((tw, i) => {
      const to = tw.pos.clone();
      this.field.markCircle(to, 1.2, 0.7 + i * 0.15, () => {
        if (this.dead) return;
        const sky = to.clone().add(new THREE.Vector3(0, 6, 0));
        this.h.fx.streak({ path: (k, out) => out.lerpVectors(sky, to, k), dur: 0.15, color: ICE, color2: C(3, 3.6, 4), width: 0.18, tail: 0.6, halo: 1.4, core: 0.9 });
        this.h.fx.burst(to.clone().setY(to.y + 0.4), [ICE, '#ffffff'], 14, { speed: 3, up: 3, size: 0.1, life: 0.5, glow: true, gravity: 6 });
        if (!this.quiet) { bell(1760 + (i % 3) * 440, 0.4, 0.025, 0, 0.6); hiss({ dur: 0.18, vol: 0.12, f: 5000, f1: 1500, q: 0.9, type: 'bandpass' }); }
        this.icicles++;
        if (!this.puppet && tw.alive) { tw.hurt(25 * this.dmgMult, to); tw.freeze?.(2.5); }
        if (this.inCircle(to, 1.2)) this.hurt(10, to, 2);
      });
    });
  }

  protected choose(dist: number): string | null { return dist < 3.5 ? 'nova' : null; }
  protected override rest(): number { return rand(1.6, 2.2); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const at = this.pos.clone();
      this.field.markCircle(at, 3.5, 0.7, () => {
        if (this.dead) return;
        this.h.fx.shock(at.clone().setY(this.ground + 0.2), 3.5, ICE, 0.45, 0.18);
        this.h.fx.burst(at.clone().setY(this.ground + 1.5), [ICE, '#ffffff', RASP], 30, { speed: 5, up: 2, size: 0.1, life: 0.7, glow: true, gravity: 3 });
        if (!this.quiet) hiss({ dur: 0.6, vol: 0.14, f: 5000, f1: 1500, q: 1 });
        if (this.inCircle(at, 3.5)) this.hurt(18, at, 3);
      });
    }
    return t > 1.05;
  }

  protected animate(dt: number, walk: boolean): void {
    const { head, staff, ring, heart } = this.p, S = this.st, t = this.time, cast = this.state === 'attack';
    this.body.position.y = 0.6 + Math.sin(t * 1.2) * 0.15;
    this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, walk ? 0.08 : 0, 0.1);
    head.rotation.x = cast ? -0.4 : Math.sin(t * 0.8) * 0.05;
    this.arms.forEach((g, i) => g.rotation.set(cast ? -2.4 + Math.sin(S * 6 + i) * 0.15 : -0.2, 0, (i ? 1 : -1) * 0.12));
    staff.rotation.x = THREE.MathUtils.lerp(staff.rotation.x, cast ? -0.2 : 0.08, 0.2);
    ring.rotation.y += dt * (cast ? 4 : 1.1);
    for (const [i, m] of this.shards.entries()) m.position.y = Math.sin(t * 2 + i) * 0.15;
    heart.scale.setScalar(1 + Math.max(0, Math.sin(t * 4)) * 0.1);
  }
}
