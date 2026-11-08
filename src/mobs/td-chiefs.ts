import * as THREE from 'three';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { C, rand, RASP } from '../bosses/kit.ts';
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

