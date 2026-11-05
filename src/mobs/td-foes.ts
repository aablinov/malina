import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { C, rand, RASP } from '../bosses/kit.ts';
import { Mob, type MobHooks } from './mob.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Bush Defence foes (wiki/design-tower-defence.md, section 5): born for roads and towers, they barely notice the hero.
 * The courier is fast and fragile, slips past slow towers; the battering ram — bark in front absorbs damage, catapult and obelisk
 * from behind or by chain; the moth flies straight over fences and obstacles, weak to frost.
 */

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };
const FROST_ORB = C(1.6, 3.0, 4);

/** 32. Berry Courier — runner: a berry with a sack on long legs, 5.5 m/s, 14 health; nibbles at the bush bit by bit */
export class BerryRunner extends Mob {
  readonly kind = 'runner';
  readonly title = t('Berry Courier');
  readonly cost = 1;
  readonly radius = 0.32;
  override readonly topY = 1.1;
  private readonly legs: THREE.Group[];
  private readonly bob = new THREE.Group();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 14, at);
    this.speed = 5.5;
    this.turn = 8;
    this.keep = 0.8;
    this.mass = 0.4;
    this.aggro = 3;
    this.loot = 1;
    const berry = this.lam('#e0306a', pixelTex('#e0306a', 14, 961)), deep = this.lam('#a81848');
    const leaf = this.lam('#5aa03a'), stem = this.lam('#3a7a2a'), sack = this.lam('#c8a060', pixelTex('#c8a060', 10, 962)), eye = this.lam('#2a1420');
    const B = this.box.bind(this);
    this.body.add(this.bob);
    B(this.bob, berry, 0.46, 0.44, 0.42, 0, 0.72, 0);
    for (const [x, y, z] of [[0.22, 0.66, 0.08], [-0.22, 0.66, 0.08], [0, 0.9, -0.12], [0.14, 0.52, 0.16]] as const) B(this.bob, deep, 0.14, 0.14, 0.14, x, y, z);
    B(this.bob, leaf, 0.3, 0.05, 0.12, 0, 0.96, 0, 0, 0.5, 0.2);
    B(this.bob, stem, 0.05, 0.12, 0.05, 0, 1.0, 0);
    // sack on the back — steals raspberries from the bush
    B(this.bob, sack, 0.34, 0.4, 0.26, 0, 0.7, -0.3, 0.15, 0, 0);
    B(this.bob, this.lam('#7a5232'), 0.04, 0.3, 0.04, 0.16, 0.86, -0.1, 0.4, 0, -0.5);
    for (const x of [-0.1, 0.1]) B(this.bob, eye, 0.08, 0.1, 0.03, x, 0.78, 0.22);
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.11, 0.5, 0);
      this.body.add(g);
      B(g, stem, 0.07, 0.5, 0.07, 0, -0.25, 0);
      B(g, leaf, 0.14, 0.05, 0.18, 0, -0.5, 0.04);
      return g;
    });
    this.place();
  }

  protected choose(dist: number): string | null { return dist < 1.3 ? 'nip' : null; }
  protected override rest(): number { return rand(0.5, 0.8); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const at = this.pos.clone().addScaledVector(this.fwd(), 0.6);
      this.field.markCircle(at, 0.5, 0.25, () => {
        if (this.dead) return;
        if (!this.quiet) voice({ type: 'square', f: rand(900, 1100), f1: 500, dur: 0.06, vol: 0.025, lp: 3000 });
        if (this.inCircle(at, 0.6)) this.hurt(3, this.pos, 1);
      });
    }
    return t > 0.4;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 18), s = this.stride(22);
    lerpTo(this.legs[0], walk ? s * 1.1 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 1.1 : 0, k);
    this.bob.position.y = walk ? Math.abs(s) * 0.1 : 0;
    this.bob.rotation.x = walk ? 0.25 : 0;
  }
}

/** 33. Vine Battering Ram — heavy: a boar of logs and vine with a bark shield on the forehead; damage from the front ×0.35, 160 health, 1.6 m/s */
export class VineRam extends Mob {
  readonly kind = 'ram';
  readonly title = t('Vine Battering Ram');
  readonly cost = 6;
  readonly radius = 0.7;
  override readonly topY = 1.6;
  private readonly legs: THREE.Group[];
  private readonly head = new THREE.Group();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 160, at);
    this.speed = 1.6;
    this.turn = 2.5;
    this.keep = 1.6;
    this.mass = 3;
    this.aggro = 3.5;
    this.loot = 4;
    const log = this.lam('#6a4a2a', pixelTex('#6a4a2a', 12, 971)), bark = this.lam('#4a3018', pixelTex('#4a3018', 10, 972));
    const vine = this.lam('#4a8a2a', pixelTex('#4a8a2a', 10, 973)), berry = this.shimmer(RASP, C(3.4, 1.2, 0.6), 0, 1.5), moss = this.lam('#7aa848');
    const B = this.box.bind(this);
    // body — a bundle of logs wrapped in vine
    B(this.body, log, 0.9, 0.8, 1.5, 0, 0.9, 0);
    B(this.body, log, 0.7, 0.3, 1.5, 0, 1.4, 0);
    for (const z of [-0.5, -0.1, 0.3]) B(this.body, vine, 0.96, 0.1, 0.12, 0, 1.0 + (z + 0.5) * 0.3, z);
    for (const z of [-0.4, 0.2]) B(this.body, vine, 0.12, 0.86, 0.12, 0.44, 0.9, z);
    B(this.body, moss, 0.5, 0.1, 0.9, 0.1, 1.58, -0.2);
    for (let i = 0; i < 4; i++) B(this.body, berry, 0.14, 0.14, 0.14, Math.sin(i * 1.9) * 0.4, 1.3 + (i % 2) * 0.3, -0.5 + i * 0.3);
    // head — a stump with a bark shield forward and two root tusks
    this.head.position.set(0, 0.95, 0.8);
    this.body.add(this.head);
    B(this.head, bark, 0.8, 0.7, 0.5, 0, 0, 0.1);
    B(this.head, bark, 1.0, 0.9, 0.16, 0, 0.05, 0.4);
    B(this.head, bark, 0.5, 0.5, 0.12, 0, 0.05, 0.5, 0, Math.PI / 4, 0);
    for (const x of [-0.3, 0.3]) B(this.head, this.lam('#d8c8a0'), 0.1, 0.1, 0.4, x, -0.22, 0.5, -0.4, 0, 0);
    for (const x of [-0.22, 0.22]) B(this.head, this.shimmer(C(3.4, 2.4, 1), RASP, 0, 2), 0.1, 0.06, 0.02, x, 0.2, 0.49);
    this.legs = [[-0.3, 0.45], [0.3, 0.45], [-0.3, -0.45], [0.3, -0.45]].map(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0.5, z);
      this.body.add(g);
      B(g, log, 0.24, 0.5, 0.24, 0, -0.25, 0);
      return g;
    });
    this.place();
  }

  /** Bark on the forehead: a hit coming head-on is absorbed */
  protected override guard(dir: THREE.Vector3): number {
    const f = this.fwd();
    return dir.x * f.x + dir.z * f.z < -0.3 ? 0.35 : 1;
  }

  protected choose(dist: number, rel: number): string | null { return dist < 2.4 && Math.abs(rel) < 0.5 ? 'butt' : null; }
  protected override rest(): number { return rand(1.2, 1.8); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const from = this.pos.clone(), dir = this.fwd();
      this.field.markLine(from, dir, 2.2, 1.4, 0.7, () => {
        if (this.dead) return;
        this.move(dir, 0.5);
        if (!this.quiet) boom(90, 40, 0.35, 0.4);
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.2);
        this.h.fx.burst(from.clone().addScaledVector(dir, 1.6).setY(0.2), ['#8a6a40', '#4a8a2a'], 10, { speed: 2.5, up: 2.5, size: 0.12, life: 0.5, gravity: 8 });
        if (this.inLine(from, dir, 2.2, 1.4)) this.hurt(14, from, 6);
      });
    }
    return t > 1.1;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 8), s = this.stride(5);
    const a = walk ? s * 0.4 : 0;
    lerpTo(this.legs[0], a, k); lerpTo(this.legs[3], a, k);
    lerpTo(this.legs[1], -a, k); lerpTo(this.legs[2], -a, k);
    // rear back — and a downward headbutt
    const butt = this.state === 'attack' ? (this.st < 0.7 ? 0.5 * Math.min(1, this.st / 0.5) : -0.5) : 0;
    lerpTo(this.head, butt, this.state === 'attack' && this.st > 0.7 ? 1 : k);
    this.body.rotation.z = walk ? s * 0.05 : 0;
  }
}

/** 34. Pollen Moth — flyer: wings with raspberry eyespots, flies straight over fences and pits; 22 health; pollen at the bush */
export class PollenMoth extends Mob {
  readonly kind = 'moth';
  readonly title = t('Pollen Moth');
  readonly cost = 2;
  readonly radius = 0.45;
  override readonly topY = 2.0;
  private readonly wings: THREE.Group[];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 22, at);
    this.speed = 3.2;
    this.turn = 5;
    this.keep = 1.2;
    this.mass = 0.5;
    this.aggro = 3.5;
    this.ghost = true;
    this.loot = 2;
    this.flyY = 1.3;
    const fur = this.lam('#d8c8a0', pixelTex('#d8c8a0', 12, 981)), dark = this.lam('#5a4a3a');
    const wing = this.lam('#e8d8b8', pixelTex('#e8d8b8', 8, 982)), spot = this.shimmer(RASP, C(3.4, 1.6, 0.8), 0, 1.8), dust = this.lam('#f0e070');
    const B = this.box.bind(this);
    B(this.body, fur, 0.36, 0.36, 0.9, 0, 0, 0);
    B(this.body, dark, 0.3, 0.3, 0.3, 0, 0.04, 0.5);
    for (const x of [-0.1, 0.1]) { B(this.body, dark, 0.03, 0.4, 0.03, x * 2, 0.3, 0.6, -0.5, 0, x * 3); B(this.body, spot, 0.07, 0.07, 0.03, x, 0.08, 0.66); }
    for (let i = 0; i < 3; i++) B(this.body, dust, 0.1, 0.1, 0.1, Math.sin(i * 2) * 0.2, 0.2, -0.3 + i * 0.25);
    this.wings = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.18, 0.12, 0.05);
      this.body.add(g);
      B(g, wing, 1.0, 0.04, 0.7, s * 0.5, 0, 0.1);
      B(g, wing, 0.7, 0.04, 0.5, s * 0.4, -0.01, -0.45);
      B(g, spot, 0.26, 0.05, 0.26, s * 0.6, 0.01, 0.1);
      B(g, dark, 0.12, 0.05, 0.12, s * 0.4, 0.01, -0.45);
      return g;
    });
    this.place();
  }

  protected choose(dist: number): string | null { return dist < 1.8 ? 'puff' : null; }
  protected override rest(): number { return rand(0.9, 1.4); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const at = this.pos.clone().setY(0);
      this.field.markCircle(at, 1.1, 0.45, () => {
        if (this.dead) return;
        if (!this.quiet) hiss({ dur: 0.25, vol: 0.08, f: 2000, f1: 800, q: 1 });
        this.h.fx.burst(this.pos.clone().setY(this.flyY), ['#f0e070', '#ffd040', RASP], 14, { speed: 2, up: 0.5, size: 0.08, life: 0.7, gravity: 2 });
        if (this.inCircle(at, 1.1)) this.hurt(5, this.pos, 1);
      });
    }
    return t > 0.7;
  }

  protected animate(_dt: number, walk: boolean): void {
    const f = Math.sin(this.time * 24) * 0.7;
    this.wings[0].rotation.z = f; this.wings[1].rotation.z = -f;
    // hovers at height, swaying; drops lower when stunned
    this.flyY = (this.state === 'daze' ? 0.5 : 1.3) + Math.sin(this.time * 3) * 0.15;
    this.body.rotation.x = walk ? 0.2 : 0;
    this.body.rotation.z = Math.sin(this.time * 1.7) * 0.1;
  }
}

// ---------- second map: Crystal Glade (wiki/design-tower-defence.md, section 8) ----------

const CRYSTAL = C(1.6, 3.2, 3.4), SPORE = C(2.2, 1.2, 3.4), RAINBOW = [C(3.4, 1.2, 1.2), C(3.4, 2.8, 1.0), C(1.2, 3.4, 1.4), C(1.2, 1.8, 3.4), C(2.8, 1.2, 3.4)];
// bodies in restrained tones (below the bloom threshold), bright HDR colours only in sparks and eyes
const GEM = C(0.45, 0.95, 1.05), GEM_LIGHT = C(0.7, 1.3, 1.4), CAP = C(0.8, 0.4, 1.05), CAP_LIGHT = C(1.1, 0.7, 1.35);

/** 35. Crystal Shellback — a beetle in a crystal shell: the shell absorbs the first 6 hits entirely (a crack per hit), then shatters; 90 health, 2.2 m/s */
export class CrystalShellback extends Mob {
  readonly kind = 'shellback';
  readonly title = t('Crystal Shellback');
  readonly cost = 5;
  readonly radius = 0.6;
  override readonly topY = 1.3;
  /** How many more hits the shell can take */
  shell = 6;
  private readonly shellMesh = new THREE.Group();
  private readonly shards: THREE.Mesh[] = [];
  private readonly legs: THREE.Group[];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 90, at);
    this.speed = 2.2;
    this.turn = 3;
    this.keep = 1.4;
    this.mass = 2;
    this.aggro = 3.5;
    this.loot = 3;
    const chitin = this.lam('#2a3a4a', pixelTex('#2a3a4a', 10, 991)), pale = this.lam('#8aa0b0'), eye = this.shimmer(CRYSTAL, C(2.4, 3.4, 3.4), 0, 2);
    const gem = this.shimmer(GEM, GEM_LIGHT, 0, 1.2);
    const B = this.box.bind(this);
    B(this.body, chitin, 0.9, 0.5, 1.2, 0, 0.55, 0);
    B(this.body, pale, 0.5, 0.3, 0.5, 0, 0.5, 0.75);
    for (const x of [-0.14, 0.14]) B(this.body, eye, 0.08, 0.08, 0.04, x, 0.6, 1.0);
    for (const x of [-0.2, 0.2]) B(this.body, pale, 0.04, 0.04, 0.5, x, 0.7, 1.1, -0.6, 0, 0);
    // shell — a cluster of crystals on the back; one vanishes with each hit
    this.body.add(this.shellMesh);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05, r = 0.25 + (i % 2) * 0.12;
      const m = B(this.shellMesh, gem, 0.3, 0.6 + (i % 3) * 0.2, 0.3, Math.cos(a) * r, 1.0, Math.sin(a) * r - 0.1, (rnd() - 0.5) * 0.5, a, (rnd() - 0.5) * 0.5);
      this.shards.push(m);
    }
    B(this.shellMesh, gem, 0.36, 0.9, 0.36, 0, 1.1, -0.15, 0, Math.PI / 4, 0);
    this.legs = [[-0.4, 0.4], [0.4, 0.4], [-0.4, -0.4], [0.4, -0.4]].map(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0.4, z);
      this.body.add(g);
      B(g, pale, 0.12, 0.4, 0.12, x > 0 ? 0.1 : -0.1, -0.2, 0, 0, 0, x > 0 ? -0.4 : 0.4);
      return g;
    });
    this.place();
  }

  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.dead || this.state === 'spawn') return;
    if (this.shell > 0) {
      this.shell--;
      const m = this.shards[this.shell];
      if (m) m.visible = false;
      this.h.fx.text(point.clone().setY(point.y + 0.5), this.shell ? t('shell') : t('cracked'), '');
      this.h.fx.burst(point, [CRYSTAL, '#ffffff'], this.shell ? 5 : 20, { speed: 3, up: 3, size: 0.08, life: 0.4, glow: true, gravity: 8 });
      if (!this.quiet) boom(this.shell ? 1200 : 700, 400, 0.1, 0.14);
      if (!this.shell) { this.shellMesh.visible = false; this.h.fx.flash(this.pos.clone().setY(1), CRYSTAL, 2, 0.2); }
      this.notice(true);
      return;
    }
    super.hit(dmg, dir, point, knock);
  }

  protected choose(dist: number, rel: number): string | null { return dist < 2 && Math.abs(rel) < 0.6 ? 'slam' : null; }
  protected override rest(): number { return rand(1.0, 1.5); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const at = this.pos.clone().addScaledVector(this.fwd(), 0.9);
      this.field.markCircle(at, 0.9, 0.5, () => {
        if (this.dead) return;
        if (!this.quiet) boom(120, 50, 0.3, 0.3);
        this.h.fx.burst(at.clone().setY(0.2), ['#8aa0b0', CRYSTAL], 10, { speed: 2.5, up: 2.5, size: 0.1, life: 0.5, gravity: 8 });
        if (this.inCircle(at, 0.9)) this.hurt(12, this.pos, 4);
      });
    }
    return t > 0.9;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 10), s = this.stride(9);
    this.legs.forEach((g, i) => lerpTo(g, walk ? s * 0.5 * (i % 2 ? 1 : -1) : 0, k));
    this.body.position.y = walk ? Math.abs(s) * 0.04 : 0;
    this.shellMesh.rotation.y = Math.sin(this.time * 0.8) * 0.05;
    const slam = this.state === 'attack' ? (this.st < 0.4 ? -0.3 : 0.35) : 0;
    this.body.rotation.x += (slam - this.body.rotation.x) * k;
  }
}

/** 36. Sporeling — a walking mushroom: neighbours near it heal (3 per second within 3 m), and when it bursts a spore cloud heals everyone around by 30 %; 40 health, 2.6 m/s */
export class Sporeling extends Mob {
  readonly kind = 'sporeling';
  readonly title = t('Sporeling');
  readonly cost = 3;
  readonly radius = 0.4;
  override readonly topY = 1.3;
  /** Total healed to neighbours (for tests) */
  given = 0;
  private readonly cap = new THREE.Group();
  private readonly legs: THREE.Group[];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 40, at);
    this.speed = 2.6;
    this.turn = 4;
    this.keep = 1.2;
    this.mass = 0.8;
    this.aggro = 3;
    this.loot = 2;
    const stem = this.lam('#e8dcc0', pixelTex('#e8dcc0', 8, 992)), capM = this.shimmer(CAP, CAP_LIGHT, 0, 1.0), dot = this.lam('#f4e8ff'), eye = this.lam('#2a1430');
    const B = this.box.bind(this);
    B(this.body, stem, 0.4, 0.7, 0.4, 0, 0.55, 0);
    for (const x of [-0.08, 0.08]) B(this.body, eye, 0.06, 0.08, 0.03, x, 0.62, 0.21);
    this.cap.position.y = 0.9;
    this.body.add(this.cap);
    B(this.cap, capM, 0.9, 0.3, 0.9, 0, 0.15, 0);
    B(this.cap, capM, 0.6, 0.25, 0.6, 0, 0.4, 0);
    B(this.cap, capM, 0.9, 0.3, 0.9, 0, 0.15, 0, 0, Math.PI / 4, 0);
    for (let i = 0; i < 5; i++) { const a = i * 1.26; B(this.cap, dot, 0.12, 0.06, 0.12, Math.cos(a) * 0.32, 0.31, Math.sin(a) * 0.32); }
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.12, 0.25, 0);
      this.body.add(g);
      B(g, stem, 0.12, 0.25, 0.12, 0, -0.12, 0);
      return g;
    });
    this.place();
  }

  override update(dt: number): void {
    super.update(dt);
    if (this.dead || this.state === 'spawn') return;
    // spores: neighbours within 3 m heal bit by bit
    for (const m of this.mh.allies()) {
      if (m === this || m.dead || m.hp >= m.maxHp) continue;
      if (Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) < 3) { const v = Math.min(3 * dt, m.maxHp - m.hp); m.heal(v); this.given += v; }
    }
    if (rnd() < 0.15) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 1.2, rand(-0.4, 0.4))), vel: new THREE.Vector3(rand(-0.4, 0.4), 0.6, rand(-0.4, 0.4)), life: 1, size: 0.07, color: SPORE, gravity: -0.1 }, false);
  }

  /** Burst: spore cloud — all neighbours within 3.5 m heal by 30 % */
  protected override die(): void {
    super.die();
    this.h.fx.flash(this.pos.clone().setY(1), SPORE, 2.5, 0.3);
    this.h.fx.shock(this.pos.clone().setY(0.1), 3.5, SPORE, 0.5, 0.2);
    this.h.fx.burst(this.pos.clone().setY(1), [SPORE, '#f4e8ff', C(1.6, 3.2, 2.0)], 30, { speed: 2.5, up: 2, size: 0.1, life: 1.2, glow: true, gravity: 0.5 });
    if (!this.quiet) hiss({ dur: 0.5, vol: 0.1, f: 1200, f1: 300, q: 1 });
    for (const m of this.mh.allies()) {
      if (m === this || m.dead) continue;
      if (Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) < 3.5) { const v = Math.min(m.maxHp * 0.3, m.maxHp - m.hp); m.heal(v); this.given += v; }
    }
  }

  protected choose(dist: number): string | null { return dist < 1.6 ? 'puff' : null; }
  protected override rest(): number { return rand(0.9, 1.3); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const at = this.pos.clone().setY(0);
      this.field.markCircle(at, 1.0, 0.4, () => {
        if (this.dead) return;
        if (!this.quiet) hiss({ dur: 0.2, vol: 0.07, f: 1600, f1: 600, q: 1 });
        this.h.fx.burst(this.pos.clone().setY(1.2), [SPORE, '#f4e8ff'], 12, { speed: 2, up: 0.5, size: 0.08, life: 0.7, gravity: 1 });
        if (this.inCircle(at, 1.0)) this.hurt(5, this.pos, 1);
      });
    }
    return t > 0.6;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 14), s = this.stride(14);
    lerpTo(this.legs[0], walk ? s * 0.8 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 0.8 : 0, k);
    this.cap.rotation.z = Math.sin(this.time * 2) * 0.08 + (walk ? s * 0.06 : 0);
    const puff = this.state === 'attack' ? 1 + 0.25 * Math.sin(Math.min(1, this.st / 0.4) * Math.PI) : 1;
    this.cap.scale.set(puff, 1 / puff, puff);
  }
}

/** 37. Rainbow Hopper — a hare of light: every 3 s on the march hops 5 m forward along the road (frost does not hold it), leaving a rainbow trail; 30 health */
export class RainbowHopper extends Mob {
  readonly kind = 'hopper';
  readonly title = t('Rainbow Hopper');
  readonly cost = 2;
  readonly radius = 0.35;
  override readonly topY = 1.0;
  /** How many times it hopped (for tests) */
  hops = 0;
  private hopCd = 1.5;
  private hopT = 0;
  private readonly ears: THREE.Group[];
  private readonly bob = new THREE.Group();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 30, at);
    this.speed = 3.4;
    this.turn = 7;
    this.keep = 1.0;
    this.mass = 0.5;
    this.aggro = 3;
    this.loot = 2;
    const fur = this.lam('#f0e8ff', pixelTex('#f0e8ff', 8, 993)), eye = this.shimmer(C(1.2, 1.8, 3.4), C(3.4, 1.2, 3.4), 0, 2.4), glow = this.shimmer(C(1.4, 0.6, 0.6), C(0.6, 0.8, 1.4), 0, 0.8);
    const B = this.box.bind(this);
    this.body.add(this.bob);
    B(this.bob, fur, 0.4, 0.4, 0.6, 0, 0.5, 0);
    B(this.bob, fur, 0.34, 0.3, 0.3, 0, 0.75, 0.3);
    for (const x of [-0.08, 0.08]) B(this.bob, eye, 0.06, 0.08, 0.03, x, 0.8, 0.46);
    B(this.bob, glow, 0.14, 0.14, 0.14, 0, 0.55, -0.34);
    for (let i = 0; i < 3; i++) B(this.bob, this.shimmer(RAINBOW[i + 1].clone().multiplyScalar(0.45), RAINBOW[(i + 3) % 5].clone().multiplyScalar(0.45), i, 1.2), 0.1, 0.06, 0.1, Math.sin(i * 2.1) * 0.15, 0.72, -0.1 - i * 0.12);
    this.ears = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.1, 0.9, 0.3);
      this.bob.add(g);
      B(g, fur, 0.08, 0.36, 0.05, 0, 0.18, 0, s * 0.1, 0, s * 0.2);
      B(g, glow, 0.04, 0.2, 0.02, 0, 0.18, 0.03);
      return g;
    });
    for (const [x, z] of [[-0.14, 0.15], [0.14, 0.15], [-0.14, -0.2], [0.14, -0.2]]) B(this.body, fur, 0.12, 0.3, 0.14, x, 0.15, z);
    this.place();
  }

  /** Hop: 5 m forward along the road points, points on the way count as passed */
  private hop(): void {
    const r = this.march;
    if (!r) return;
    let left = 5;
    const from = this.pos.clone();
    while (left > 0 && this.marchI < r.length) {
      const t = r[this.marchI], dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d <= left) { this.pos.x = t.x; this.pos.z = t.z; left -= d; this.marchI++; continue; }
      this.pos.x += (dx / d) * left; this.pos.z += (dz / d) * left; left = 0;
    }
    this.yaw = Math.atan2(this.pos.x - from.x, this.pos.z - from.z) || this.yaw;
    this.hops++;
    this.hopT = 0.35;
    const a = from.clone().setY(0.6), b = this.pos.clone().setY(0.6), c1 = RAINBOW[this.hops % 5], c2 = RAINBOW[(this.hops + 2) % 5];
    this.h.fx.streak({ path: (k, out) => { out.lerpVectors(a, b, k); out.y += Math.sin(k * Math.PI) * 1.2; return out; }, dur: 0.3, color: c1, color2: c2, width: 0.12, tail: 0.5, halo: 1.6, core: 0.5 });
    for (let i = 0; i < 5; i++) this.h.fx.particle({ pos: from.clone().lerp(this.pos, i / 5).setY(0.6), vel: new THREE.Vector3(0, 1, 0), life: 0.6, size: 0.08, color: RAINBOW[i], gravity: 0 });
    if (!this.quiet) voice({ type: 'triangle', f: 700, f1: 1400, dur: 0.12, vol: 0.03, lp: 4000 });
  }

  override update(dt: number): void {
    super.update(dt);
    if (this.dead) return;
    this.hopT = Math.max(0, this.hopT - dt);
    if (this.march && !this.alerted && (this.state === 'walk' || this.state === 'idle') && this.marchI < this.march.length) {
      this.hopCd -= dt;
      if (this.hopCd <= 0) { this.hopCd = 3; this.hop(); }
    }
  }

  protected choose(dist: number): string | null { return dist < 1.4 ? 'kick' : null; }
  protected override rest(): number { return rand(0.6, 1.0); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const at = this.pos.clone().addScaledVector(this.fwd(), 0.6);
      this.field.markCircle(at, 0.6, 0.3, () => {
        if (this.dead) return;
        if (!this.quiet) voice({ type: 'square', f: 500, f1: 900, dur: 0.08, vol: 0.03, lp: 3000 });
        this.h.fx.burst(at.clone().setY(0.5), RAINBOW, 8, { speed: 2, up: 2, size: 0.07, life: 0.4, glow: true, gravity: 6 });
        if (this.inCircle(at, 0.7)) this.hurt(6, this.pos, 2);
      });
    }
    return t > 0.45;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 16), s = this.stride(16);
    this.bob.position.y = (walk ? Math.abs(s) * 0.12 : 0) + this.hopT * 1.6;
    this.bob.rotation.x += ((walk ? -0.15 : 0) - this.bob.rotation.x) * k;
    const e = walk ? Math.sin(this.time * 16) * 0.2 : Math.sin(this.time * 2) * 0.08;
    this.ears[0].rotation.x = -0.3 + e; this.ears[1].rotation.x = -0.3 - e;
  }
}

// ---------- third map: castle siege (wiki/design-tower-defence.md, section 9) ----------

const POWDER = C(3.4, 1.0, 0.3), FUSE = C(3.4, 3.0, 1.2);

/**
 * 38. Stump Sapper — a walking stump in bark armour with a keg of berry powder on its back: the armour reduces any hit to ×0.3,
 * except a piercing one (wall ballista); ignores the hero — walks to the wall, lights the fuse there (1.6 s) and explodes:
 * 160 to the wall, 30 to heroes within 3 m, 40 to allies within 2.5 m. Fell earlier — explodes where it fell. 120 health, 1.5 m/s
 */
export class StumpSapper extends Mob {
  readonly kind = 'sapper';
  readonly title = t('Stump Sapper');
  readonly cost = 7;
  readonly radius = 0.55;
  override readonly topY = 1.5;
  /** Exploded (for tests) */
  blasted = false;
  private readonly keg = new THREE.Group();
  private readonly spark: THREE.MeshBasicMaterial;
  private readonly legs: THREE.Group[];
  private fuseT = 0;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 120, at);
    this.speed = 1.5;
    this.turn = 2.5;
    this.keep = 1.2;
    this.mass = 3;
    this.aggro = 0;
    this.leash = 4;
    this.loot = 4;
    const bark = this.lam('#4a3018', pixelTex('#4a3018', 10, 1011)), plate = this.lam('#6a5a4a', pixelTex('#6a5a4a', 8, 1012)), wood = this.lam('#8a6a3a', pixelTex('#8a6a3a', 10, 1013));
    const iron = this.lam('#3a3c42'), eye = this.shimmer(POWDER, C(3.4, 2.0, 0.6), 0, 2.4);
    this.spark = this.shimmer(FUSE, POWDER, 0, 6);
    const B = this.box.bind(this);
    // a stump with bark and iron plates, two ember eyes
    B(this.body, bark, 0.9, 1.0, 0.8, 0, 0.9, 0);
    B(this.body, bark, 0.7, 0.3, 0.6, 0, 1.45, 0.05);
    for (const [x, z] of [[0.46, 0], [-0.46, 0], [0, 0.41]]) B(this.body, plate, x ? 0.08 : 0.6, 0.7, x ? 0.6 : 0.08, x, 0.95, z);
    for (const [x, y] of [[-0.25, 0.7], [0.3, 1.2], [0, 0.45]]) B(this.body, iron, 0.08, 0.08, 0.08, x, y, 0.45);
    for (const x of [-0.16, 0.16]) B(this.body, eye, 0.12, 0.1, 0.04, x, 1.1, 0.42);
    // keg on the back with a fuse
    this.keg.position.set(0, 1.1, -0.55);
    this.body.add(this.keg);
    B(this.keg, wood, 0.6, 0.7, 0.5, 0, 0, 0);
    for (const y of [-0.22, 0.22]) B(this.keg, iron, 0.64, 0.08, 0.54, 0, y, 0);
    B(this.keg, iron, 0.12, 0.12, 0.12, 0, 0.4, 0);
    B(this.keg, this.lam('#d8c8a0'), 0.04, 0.3, 0.04, 0.05, 0.55, 0, 0.2, 0, 0.4);
    B(this.keg, this.spark, 0.1, 0.1, 0.1, 0.1, 0.7, 0);
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.28, 0.45, 0);
      this.body.add(g);
      B(g, bark, 0.26, 0.45, 0.3, 0, -0.22, 0);
      return g;
    });
    this.place();
  }

  /** Bark armour: any hit ×0.3 (a piercing one — without direction — goes through entirely, see Mob.hit) */
  protected override guard(): number { return 0.3; }

  protected choose(dist: number): string | null { return dist < 2.3 ? 'fuse' : null; }

  protected act(_name: string, t: number): boolean {
    this.fuseT = t;
    if (t > 1.6) { this.blast(); return true; }
    return false;
  }

  /** Explosion: 160 to the wall (decoy), 30 to heroes within 3 m, 40 to allies within 2.5 m; crumbles itself */
  blast(): void {
    if (this.blasted) return;
    this.blasted = true;
    const at = this.pos.clone().setY(0.9);
    this.h.fx.explosion(at, 3, POWDER);
    this.h.fx.burst(at, [POWDER, RASP, '#4a3018', '#ffffff'], 30, { speed: 5, up: 4, size: 0.12, life: 0.8, gravity: 8 });
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.6);
    if (!this.quiet) boom(70, 25, 0.8, 0.6);
    const f = this.focus;
    if (f?.alive && Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) < 3) f.hurt(160, this.pos);
    const hero = this.mh.hero.pos;
    if (Math.hypot(hero.x - this.pos.x, hero.z - this.pos.z) < 3 && Math.abs(hero.y - this.pos.y) < 2) this.mh.hurtHero(30 * this.dmgMult, this.pos, 6);
    for (const m of this.mh.allies()) {
      if (m === this || m.dead) continue;
      const d = Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z);
      if (d < 2.5) m.hit(40, new THREE.Vector3(m.pos.x - this.pos.x, 0, m.pos.z - this.pos.z).normalize(), m.pos.clone().setY(1), 2);
    }
    if (!this.dead) this.vanish();
  }

  protected override die(): void {
    super.die();
    // fell — the powder went off anyway
    if (!this.blasted) this.blast();
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 8), s = this.stride(6);
    lerpTo(this.legs[0], walk ? s * 0.5 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 0.5 : 0, k);
    this.body.rotation.z = walk ? s * 0.06 : 0;
    // the fuse burns: the spark blinks faster and faster, the keg shakes
    const fusing = this.state === 'attack';
    const f = fusing ? this.fuseT / 1.6 : 0;
    this.spark.color.copy(FUSE).multiplyScalar(fusing ? 1 + Math.sin(this.time * (20 + f * 40)) : 0.6 + Math.sin(this.time * 6) * 0.3);
    this.keg.rotation.x = fusing ? Math.sin(this.time * 30) * 0.08 * f : 0;
    if (fusing && rnd() < 0.5) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(-Math.sin(this.yaw) * 0.55, 1.8, -Math.cos(this.yaw) * 0.55)), vel: new THREE.Vector3((rnd() - 0.5) * 1.5, 1 + rnd(), (rnd() - 0.5) * 1.5), life: 0.3, size: 0.06, color: rnd() < 0.5 ? FUSE : POWDER, gravity: 4 });
  }
}

/**
 * 39. Vine Ballista — the Order's siege engine on root legs: keeps 9 m from the target and fires a heavy bolt every 3.4 s —
 * 24 to gates and walls, 14 to the hero. The gate is a decoy for it (taunt 12): stops on the road and fires until it breaks it.
 * 140 health, 1.3 m/s, turns slowly
 */
export class VineBallista extends Mob {
  readonly kind = 'ballista';
  readonly title = t('Vine Ballista');
  readonly cost = 8;
  readonly radius = 0.7;
  override readonly topY = 1.9;
  /** Shots (for tests) */
  shots = 0;
  private readonly bow = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly legs: THREE.Group[];
  private readonly aim = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 140, at);
    this.speed = 1.3;
    this.turn = 1.8;
    this.keep = 9;
    this.mass = 4;
    this.aggro = 3.5;
    this.loot = 5;
    const wood = this.lam('#7a5232', pixelTex('#7a5232', 10, 1021)), woodD = this.lam('#4a3018'), vine = this.lam('#4a8a2a', pixelTex('#4a8a2a', 10, 1022)), iron = this.lam('#3a3c42'), rope = this.lam('#d8c8a0');
    const B = this.box.bind(this);
    // a frame of logs wrapped in vine
    B(this.body, wood, 1.2, 0.3, 1.6, 0, 0.75, 0);
    for (const z of [-0.5, 0.4]) B(this.body, vine, 1.26, 0.1, 0.14, 0, 0.8, z);
    for (let i = 0; i < 3; i++) B(this.body, this.shimmer(RASP, C(3.4, 1.2, 0.6), i, 1.5), 0.12, 0.12, 0.12, -0.5 + i * 0.5, 0.95, -0.6);
    // bow on a swivel: stock, limbs, string, winch; bolt in the groove
    this.bow.position.set(0, 1.0, 0);
    this.body.add(this.bow);
    B(this.bow, woodD, 0.3, 0.24, 2.0, 0, 0.2, 0.2);
    for (const s of [-1, 1]) B(this.bow, woodD, 1.0, 0.12, 0.14, s * 0.65, 0.35, 0.8, 0, 0, s * 0.3);
    B(this.bow, rope, 2.0, 0.03, 0.03, 0, 0.35, 0.35);
    B(this.bow, iron, 0.3, 0.3, 0.2, 0, 0.4, -0.75);
    B(this.bow, woodD, 0.08, 0.5, 0.08, 0.2, 0.45, -0.75, 0, 0, 0.4);
    this.arm.position.set(0, 0.4, 0.3);
    this.bow.add(this.arm);
    B(this.arm, iron, 0.1, 0.1, 1.3, 0, 0, 0.3);
    B(this.arm, this.lam('#d8285a'), 0.16, 0.16, 0.2, 0, 0, 1.0);
    this.legs = [[-0.5, 0.6], [0.5, 0.6], [-0.5, -0.6], [0.5, -0.6]].map(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0.6, z);
      this.body.add(g);
      B(g, vine, 0.16, 0.6, 0.16, x > 0 ? 0.15 : -0.15, -0.3, 0, 0, 0, x > 0 ? -0.5 : 0.5);
      B(g, woodD, 0.3, 0.12, 0.3, x > 0 ? 0.3 : -0.3, -0.58, 0);
      return g;
    });
    this.place();
  }

  protected choose(dist: number, rel: number): string | null { return dist < 13 && Math.abs(rel) < 0.25 ? 'shoot' : null; }
  protected override rest(): number { return rand(1.6, 2.0); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const from = this.pos.clone();
      this.aim.copy(this.fwd());
      this.field.markLine(from, this.aim, 14, 0.7, 0.9, () => {
        if (this.dead) return;
        this.shots++;
        if (!this.quiet) { boom(160, 70, 0.2, 0.3); hiss({ dur: 0.25, vol: 0.12, f: 1600, f1: 500, q: 1 }); }
        this.field.shot(from, this.aim, 14, C(3.4, 2.2, 1.0));
        // the gate (decoy) stands still — the bolt will not miss it; the hero — only in the strip
        if (this.inLine(from, this.aim, 14, 0.7)) this.hurt(this.focus?.alive ? 24 : 14, from, 4);
      });
    }
    return t > 1.4;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 8), s = this.stride(5);
    this.legs.forEach((g, i) => lerpTo(g, walk ? s * 0.4 * (i % 2 ? 1 : -1) : 0, k));
    this.body.position.y = walk ? Math.abs(s) * 0.05 : 0;
    // shot: the bolt leaves, then a new one settles into the groove
    const fired = this.state === 'attack' && this.st > 0.9;
    this.arm.visible = !(fired && this.st < 1.3);
    this.bow.rotation.x = this.state === 'attack' ? -0.1 : 0;
  }
}

/**
 * 40. Gnawer Beaver — tower hunter (wiki section 10): walks the road, and on seeing an intact tower within 7 m turns off and gnaws
 * it — 9 durability per bite (×wave strength); gnawed it down — back to the road. Bites the hero only if nearby and there is no tower.
 * 45 health, 3 m/s
 */
export class BeaverGnawer extends Mob {
  readonly kind = 'gnawer';
  readonly title = t('Gnawer Beaver');
  readonly cost = 3;
  readonly radius = 0.45;
  override readonly topY = 1.0;
  /** Bites on towers (for tests) */
  bites = 0;
  private readonly head = new THREE.Group();
  private readonly tail = new THREE.Group();
  private readonly legs: THREE.Group[];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 45, at);
    this.speed = 3;
    this.turn = 6;
    this.keep = 1;
    this.mass = 1.2;
    this.aggro = 3;
    this.loot = 3;
    this.hunter = true;
    const fur = this.lam('#7a4e2a', pixelTex('#7a4e2a', 10, 1031)), belly = this.lam('#b08050'), tooth = this.lam('#f4ecd0', undefined), eye = this.lam('#1a1010'), tailM = this.lam('#4a3020', pixelTex('#4a3020', 6, 1032));
    const B = this.box.bind(this);
    // a chubby body, head with two big incisors, flat paddle tail
    B(this.body, fur, 0.7, 0.55, 0.85, 0, 0.45, 0);
    B(this.body, belly, 0.5, 0.3, 0.05, 0, 0.4, 0.43);
    this.head.position.set(0, 0.6, 0.45);
    this.body.add(this.head);
    B(this.head, fur, 0.5, 0.42, 0.4, 0, 0.05, 0.12);
    B(this.head, belly, 0.3, 0.16, 0.1, 0, -0.04, 0.33);
    for (const x of [-0.05, 0.05]) B(this.head, tooth, 0.08, 0.14, 0.04, x, -0.16, 0.34);
    for (const x of [-0.14, 0.14]) { B(this.head, eye, 0.07, 0.08, 0.03, x, 0.14, 0.33); B(this.head, fur, 0.1, 0.1, 0.06, x * 1.4, 0.28, 0.05); }
    this.tail.position.set(0, 0.3, -0.42);
    this.body.add(this.tail);
    B(this.tail, tailM, 0.42, 0.08, 0.6, 0, 0, -0.3);
    this.legs = [[-0.24, 0.25], [0.24, 0.25], [-0.24, -0.25], [0.24, -0.25]].map(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0.22, z);
      this.body.add(g);
      B(g, fur, 0.16, 0.24, 0.18, 0, -0.1, 0);
      return g;
    });
    this.place();
  }

  protected choose(dist: number): string | null { return dist < (this.focus?.siege ? 2 : 1.3) ? 'gnaw' : null; }
  protected override rest(): number { return rand(0.6, 0.9); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t >= 0.3 && t - dt < 0.3) {
      const f = this.focus;
      if (f?.siege && f.alive) {
        if (Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) < 2.4) {
          this.bites++;
          f.hurt(9 * this.dmgMult, this.pos);
          if (!this.quiet) voice({ type: 'square', f: rand(300, 380), f1: 180, dur: 0.07, vol: 0.03, lp: 2000 });
          this.h.fx.burst(this.pos.clone().addScaledVector(this.fwd(), 0.7).setY(f.pos.y + 0.7), ['#c8a060', '#8a5a34'], 4, { speed: 2, up: 2, size: 0.06, life: 0.35, gravity: 8 });
        }
      } else {
        const at = this.pos.clone().addScaledVector(this.fwd(), 0.6);
        if (this.inCircle(at, 0.6)) this.hurt(5, this.pos, 1);
      }
    }
    return t > 0.5;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 14), s = this.stride(12);
    this.legs.forEach((g, i) => lerpTo(g, walk ? s * 0.8 * (i % 3 ? 1 : -1) : 0, k));
    this.tail.rotation.x = walk ? Math.sin(this.time * 12) * 0.15 : Math.sin(this.time * 2) * 0.08;
    // gnawing — the head bobs up and down
    this.head.rotation.x = this.state === 'attack' ? Math.sin(this.st * 30) * 0.25 : 0;
  }
}

/**
 * 41. Ice Warlock — tower hunter (wiki section 10): keeps 6 m away and every ~7 s throws a snowball — the tower freezes
 * for 4 s and does not fire; two hero hits break the ice. The frost spire does not freeze. Reaches towers on walls too.
 * Without a tower nearby throws a snowball at the hero (5 damage). 35 health, 2.6 m/s
 */
export class FrostImp extends Mob {
  readonly kind = 'frostling';
  readonly title = t('Ice Warlock');
  readonly cost = 3;
  readonly radius = 0.38;
  override readonly topY = 1.3;
  /** Towers frozen (for tests) */
  froze = 0;
  private readonly staff = new THREE.Group();
  private readonly orb: THREE.MeshBasicMaterial;
  private readonly legs: THREE.Group[];
  private readonly aim = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 35, at);
    this.speed = 2.6;
    this.turn = 5;
    this.keep = 6;
    this.mass = 0.6;
    this.aggro = 3;
    this.loot = 3;
    this.hunter = true;
    this.reachY = 5;
    const robe = this.lam('#4a7ab8', pixelTex('#4a7ab8', 10, 1041)), trim = this.lam('#e8f4ff'), face = this.lam('#a8d8f0'), eye = this.lam('#1a2a4a'), wood = this.lam('#6a4a2a');
    this.orb = this.shimmer(FROST_ORB, C(3.4, 3.6, 4), 0, 3);
    const B = this.box.bind(this);
    // a cone robe of cubes, a cap with a snow pompom, a staff with a snowball
    B(this.body, robe, 0.6, 0.5, 0.55, 0, 0.35, 0);
    B(this.body, robe, 0.48, 0.35, 0.44, 0, 0.75, 0);
    B(this.body, trim, 0.62, 0.08, 0.57, 0, 0.12, 0);
    B(this.body, face, 0.36, 0.28, 0.3, 0, 1.0, 0.05);
    for (const x of [-0.08, 0.08]) B(this.body, eye, 0.06, 0.07, 0.03, x, 1.02, 0.21);
    B(this.body, robe, 0.42, 0.14, 0.4, 0, 1.18, 0);
    B(this.body, robe, 0.26, 0.2, 0.26, 0, 1.33, -0.04, -0.3, 0, 0);
    B(this.body, trim, 0.14, 0.14, 0.14, 0, 1.45, -0.14);
    this.staff.position.set(0.38, 0.6, 0.1);
    this.body.add(this.staff);
    B(this.staff, wood, 0.06, 1.1, 0.06, 0, 0.2, 0);
    B(this.staff, this.orb, 0.2, 0.2, 0.2, 0, 0.8, 0);
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.13, 0.15, 0);
      this.body.add(g);
      B(g, trim, 0.14, 0.12, 0.2, 0, -0.08, 0.04);
      return g;
    });
    this.place();
  }

  protected choose(dist: number, rel: number): string | null {
    if (Math.abs(rel) > 0.4) return null;
    return this.focus?.siege ? (dist < 9 ? 'freeze' : null) : dist < 7 ? 'snow' : null;
  }
  protected override rest(): number { return this.focus?.siege ? rand(6.5, 7.5) : rand(2.5, 3.5); }

  protected act(name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      // snowball in an arc: 0.5 s of flight
      const from = this.pos.clone().setY(this.pos.y + 1.4), to = this.h.hero.pos.clone();
      to.y += name === 'freeze' ? 1.6 : 0.8;
      this.aim.copy(to);
      this.h.fx.streak({ path: (k, out) => { out.lerpVectors(from, to, k); out.y += Math.sin(k * Math.PI) * 1.5; return out; }, dur: 0.5, color: FROST_ORB, color2: C(3.4, 3.6, 4), width: 0.18, tail: 0.4, halo: 1.4, core: 0.6 });
      if (!this.quiet) voice({ type: 'sine', f: 1200, f1: 600, dur: 0.15, vol: 0.04 });
    }
    if (t >= 0.5 && t - dt < 0.5) {
      this.h.fx.burst(this.aim.clone(), [FROST_ORB, '#ffffff'], 10, { speed: 2.5, up: 1.5, size: 0.08, life: 0.4, glow: true, gravity: 6 });
      const f = this.focus;
      if (name === 'freeze') { if (f?.alive && f.freeze?.(4)) this.froze++; }
      else if (this.inCircle(this.aim, 0.6)) this.hurt(5, this.pos, 1);
    }
    return t > 0.8;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 12), s = this.stride(10);
    lerpTo(this.legs[0], walk ? s * 0.8 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 0.8 : 0, k);
    this.body.rotation.z = walk ? s * 0.05 : 0;
    // staff windup
    lerpTo(this.staff, this.state === 'attack' ? (this.st < 0.3 ? -1.2 : 0.6) : 0, k);
  }
}
