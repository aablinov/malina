import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { C, rand, RASP, wrap } from '../bosses/kit.ts';
import { Mob, type MobHooks } from './mob.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Unarmoured rank-and-file (wiki/design-mobs.md): berryling (bush spawn, C), withered gardener (fallen gardeners, D),
 * raspberry wolf (beasts of the Order, E).
 */

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };

/** 10. Berryling — swarm: a little berry on legs, bites with a hop; falls from one hit */
export class Berryling extends Mob {
  readonly kind = 'berryling';
  readonly title = t('Berryling');
  readonly cost = 1;
  readonly radius = 0.35;
  override readonly topY = 0.9;
  private readonly legs: THREE.Group[];
  private readonly bob = new THREE.Group();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 12, at);
    this.speed = 3.8;
    this.keep = 0.9;
    this.mass = 0.4;
    this.aggro = 16;
    const berry = this.lam('#d0245a', pixelTex('#d0245a', 14, 631)), deep = this.lam('#9a1240');
    const leaf = this.lam('#5aa03a', pixelTex('#5aa03a', 10, 632)), stem = this.lam('#3a7a2a');
    const eye = this.lam('#2a1420'), glint = this.lam('#ffffff');
    const B = this.box.bind(this);
    this.body.add(this.bob);
    // a berry of drupelets: core and bumps on the sides
    B(this.bob, berry, 0.56, 0.52, 0.5, 0, 0.5, 0);
    for (const [x, y, z] of [[0.28, 0.42, 0.1], [-0.28, 0.42, 0.1], [0.2, 0.62, -0.2], [-0.2, 0.62, -0.2], [0, 0.28, 0.18], [0, 0.72, 0.16]] as const) B(this.bob, deep, 0.16, 0.16, 0.16, x, y, z);
    // a crown of leaves and a little tail
    for (const r of [0, 2.1, 4.2]) B(this.bob, leaf, 0.3, 0.05, 0.12, Math.sin(r) * 0.12, 0.79, Math.cos(r) * 0.12, 0, r, 0.25);
    B(this.bob, stem, 0.05, 0.14, 0.05, 0, 0.86, 0);
    for (const x of [-0.12, 0.12]) { B(this.bob, eye, 0.1, 0.12, 0.03, x, 0.55, 0.26); B(this.bob, glint, 0.04, 0.04, 0.03, x + 0.02, 0.58, 0.275); }
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.13, 0.25, 0);
      this.body.add(g);
      B(g, stem, 0.08, 0.25, 0.08, 0, -0.12, 0);
      return g;
    });
    this.place();
  }

  protected choose(dist: number): string | null { return dist < 1.5 ? 'bite' : null; }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const at = this.pos.clone().addScaledVector(this.fwd(), 0.8);
      this.field.markCircle(at, 0.7, 0.35, () => {
        if (this.dead) return;
        this.move(this.fwd(), 0.35);
        if (!this.quiet) voice({ type: 'square', f: rand(600, 760), f1: 300, dur: 0.08, vol: 0.03, lp: 2400 });
        if (this.inCircle(at, 0.7)) this.hurt(4, this.pos, 2);
      });
    }
    return t > 0.55;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 16);
    const s = this.stride(16);
    lerpTo(this.legs[0], walk ? s * 0.8 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 0.8 : 0, k);
    // bounces while running; crouches before the bite, leaps in the bite
    const hop = this.state === 'attack' ? (this.st < 0.35 ? -0.08 : Math.sin(Math.min(1, (this.st - 0.35) / 0.2) * Math.PI) * 0.3) : walk ? Math.abs(s) * 0.06 : 0;
    this.bob.position.y = hop;
    this.bob.scale.y = this.state === 'attack' && this.st < 0.35 ? 0.85 : 1;
  }
}

/** 16. Withered Gardener — crowd: a slow zombie with a hoe; after the hit the hoe gets stuck */
export class WitheredGardener extends Mob {
  readonly kind = 'gardener';
  readonly title = t('Withered Gardener');
  readonly cost = 2;
  readonly radius = 0.45;
  override readonly topY = 2.1;
  private readonly legs: THREE.Group[];
  private readonly arms = new THREE.Group();
  private readonly head = new THREE.Group();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 40, at);
    this.speed = 1.6;
    this.turn = 2.5;
    this.keep = 1.8;
    this.mass = 1.2;
    const skin = this.lam('#7aa060', pixelTex('#7aa060', 12, 641)), shirt = this.lam('#3e8f8a', pixelTex('#3e8f8a', 10, 642));
    const pants = this.lam('#4a4a8a', pixelTex('#4a4a8a', 8, 643)), stain = this.lam('#a8204a');
    const straw = this.lam('#e0c060', pixelTex('#e0c060', 12, 644)), wood = this.lam('#7a5232'), iron = this.lam('#9aa0a8');
    const eye = this.shimmer(C(1.2, 3.4, 1), RASP, rnd() * 6, 1.4);
    const B = this.box.bind(this);
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.14, 0.7, 0);
      this.body.add(g);
      B(g, pants, 0.26, 0.7, 0.28, 0, -0.35, 0);
      return g;
    });
    B(this.body, shirt, 0.6, 0.72, 0.34, 0, 1.06, 0);
    B(this.body, pants, 0.62, 0.22, 0.36, 0, 0.78, 0);
    // raspberry juice stains on the shirt
    for (const [x, y] of [[0.12, 1.2], [-0.16, 0.96], [0.2, 0.9]] as const) B(this.body, stain, 0.1, 0.1, 0.02, x, y, 0.18);
    this.head.position.y = 1.42;
    this.body.add(this.head);
    B(this.head, skin, 0.48, 0.48, 0.48, 0, 0.24, 0);
    for (const x of [-0.11, 0.11]) B(this.head, eye, 0.1, 0.06, 0.02, x, 0.28, 0.245);
    // straw hat with a raspberry ribbon
    B(this.head, straw, 0.86, 0.06, 0.86, 0, 0.5, 0);
    B(this.head, straw, 0.5, 0.2, 0.5, 0, 0.6, 0);
    B(this.head, stain, 0.52, 0.06, 0.52, 0, 0.53, 0);
    // arms stretched forward and meeting at the handle: the hoe stands upright in the fists, the blade on top faces forward
    this.arms.position.y = 1.36;
    this.body.add(this.arms);
    for (const s of [-1, 1]) B(this.arms, skin, 0.16, 0.16, 0.6, s * 0.2, 0, 0.28, 0, -s * 0.28, 0);
    B(this.arms, wood, 0.08, 1.5, 0.08, 0, 0.15, 0.58);
    B(this.arms, iron, 0.12, 0.1, 0.12, 0, 0.86, 0.58);
    B(this.arms, iron, 0.3, 0.08, 0.36, 0, 0.86, 0.78);
    this.place();
  }

  protected choose(dist: number, rel: number): string | null { return dist < 2.8 && Math.abs(rel) < 0.6 ? 'hoe' : null; }
  protected override rest(): number { return rand(1.2, 1.8); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const from = this.pos.clone(), dir = this.fwd();
      this.field.markLine(from, dir, 2.6, 1.2, 0.85, () => {
        if (this.dead) return;
        if (!this.quiet) boom(110, 50, 0.3, 0.35);
        this.h.fx.burst(from.clone().addScaledVector(dir, 2).setY(this.ground + 0.1), ['#8a6a40', '#5a4428'], 8, { speed: 2, up: 2, size: 0.1, life: 0.4, gravity: 8 });
        if (this.inLine(from, dir, 2.6, 1.2)) this.hurt(11, from, 3);
      });
    }
    // the hoe is in the ground for 0.6 s — a window
    return t > 1.5;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 8), s = this.stride(5);
    lerpTo(this.legs[0], walk ? s * 0.4 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 0.4 : 0, k);
    // shuffles, waddling; a windup over the head — and down
    const chop = this.state === 'attack' ? (this.st < 0.85 ? -1.1 * Math.min(1, this.st / 0.5) : 1.35) : 0;
    lerpTo(this.arms, chop, this.state === 'attack' && this.st > 0.85 ? 1 : k);
    this.body.rotation.z = walk ? s * 0.08 : 0;
    this.head.rotation.z = Math.sin(this.time * 1.3) * 0.12;
    this.body.rotation.x = this.state === 'attack' && this.st > 0.85 ? 0.2 : 0;
  }
}

/** 21. Raspberry Wolf — packs of 3: circle the hero and leap onto a mark; missed — open */
export class RaspWolf extends Mob {
  readonly kind = 'wolf';
  readonly title = t('Raspberry Wolf');
  readonly cost = 3;
  readonly radius = 0.5;
  override readonly topY = 1.2;
  private readonly legs: THREE.Group[];
  private readonly head = new THREE.Group();
  /** Which way it circles */
  private readonly side = rnd() < 0.5 ? -1 : 1;
  private readonly leapDir = new THREE.Vector3();
  private leapLen = 0;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 30, at);
    this.speed = 4.6;
    this.turn = 7;
    this.keep = 3.6;
    this.mass = 0.9;
    const fur = this.lam('#8d8f96', pixelTex('#8d8f96', 12, 651)), light = this.lam('#c9cbd0'), mane = this.lam('#b8285a', pixelTex('#b8285a', 12, 652));
    const dark = this.lam('#3a3a40'), gold = this.lam('#e8b84a');
    const eye = this.shimmer(C(3.4, 1.6, 2.6), RASP, rnd() * 6, 2);
    const B = this.box.bind(this);
    B(this.body, fur, 0.5, 0.48, 1.0, 0, 0.72, 0);
    // a raspberry mane along the spine and an Order collar with a berry
    B(this.body, mane, 0.6, 0.6, 0.42, 0, 0.8, 0.32);
    for (const z of [-0.1, -0.3]) B(this.body, mane, 0.16, 0.12, 0.16, 0, 1.0, z);
    B(this.body, gold, 0.1, 0.1, 0.04, 0, 0.6, 0.54);
    // tail
    B(this.body, fur, 0.16, 0.16, 0.5, 0, 0.84, -0.66, 0.5);
    B(this.body, light, 0.17, 0.17, 0.14, 0, 0.98, -0.86, 0.5);
    this.head.position.set(0, 0.92, 0.56);
    this.body.add(this.head);
    B(this.head, fur, 0.42, 0.4, 0.36, 0, 0, 0.12);
    B(this.head, light, 0.22, 0.18, 0.24, 0, -0.08, 0.38);
    B(this.head, dark, 0.08, 0.06, 0.04, 0, -0.02, 0.5);
    for (const x of [-0.14, 0.14]) { B(this.head, fur, 0.1, 0.16, 0.06, x, 0.26, 0.04); B(this.head, eye, 0.08, 0.06, 0.02, x * 0.8, 0.06, 0.305); }
    this.legs = [[-0.16, 0.36], [0.16, 0.36], [-0.16, -0.36], [0.16, -0.36]].map(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0.5, z);
      this.body.add(g);
      B(g, fur, 0.14, 0.5, 0.16, 0, -0.25, 0);
      return g;
    });
    this.place();
  }

  /** The pack circles at a distance: beside the hero, each on its own side */
  protected override steer(dt: number, dist: number, dx: number, dz: number, rel: number): boolean {
    if (dist > this.keep + 1.5) return super.steer(dt, dist, dx, dz, rel);
    const nx = dx / dist, nz = dz / dist, out = (this.keep - dist) * 0.8;
    const vx = -nz * this.side - nx * out, vz = nx * this.side - nz * out;
    const sp = this.speed * 0.6 * dt;
    this.pos.x += vx * sp; this.pos.z += vz * sp;
    const want = Math.atan2(dx, dz), m = this.turn * dt, d = wrap(want - this.yaw);
    this.yaw += Math.max(-m, Math.min(m, d));
    return true;
  }

  protected choose(dist: number, rel: number): string | null { return dist < 6 && Math.abs(rel) < 0.4 ? 'pounce' : null; }
  protected override rest(): number { return rand(1.8, 3.2); }

  protected act(_name: string, t: number, dt: number, dist: number): boolean {
    if (t - dt <= 0) {
      this.leapDir.copy(this.fwd());
      this.leapLen = Math.min(6, dist + 1);
      if (!this.quiet) voice({ type: 'sawtooth', f: 160, f1: 110, dur: 0.5, vol: 0.04, lp: 900, verb: 0.3 });
      this.field.markLine(this.pos.clone(), this.leapDir, this.leapLen, 1.1, 0.6, () => undefined);
    }
    // crouched — a leap along a strip; touched the hero — a bite, missed — stunned
    if (t > 0.6 && t < 0.95) {
      this.move(this.leapDir, (this.leapLen / 0.35) * dt);
      this.flyY = Math.sin(((t - 0.6) / 0.35) * Math.PI) * 0.7;
      if (!this.hitDone && this.inCircle(this.pos, 0.8)) {
        this.hitDone = true;
        if (!this.quiet) hiss({ dur: 0.15, vol: 0.15, f: 1600, f1: 500, q: 0.8, type: 'bandpass' });
        this.hurt(9, this.pos, 4);
      }
    }
    if (t >= 0.95) {
      this.flyY = 0;
      if (!this.hitDone) { this.daze(1.1); return false; }
      return true;
    }
    return false;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 16), s = this.stride(14);
    const leap = this.state === 'attack' && this.st > 0.6;
    const a = leap ? 0.9 : walk ? s * 0.7 : 0;
    lerpTo(this.legs[0], a, k); lerpTo(this.legs[3], a, k);
    lerpTo(this.legs[1], leap ? 0.9 : -a, k); lerpTo(this.legs[2], leap ? -0.9 : -a, k);
    // crouches before the leap, head down; when stunned shakes its head
    this.body.position.y = this.state === 'attack' && this.st < 0.6 ? -0.15 : 0;
    this.body.rotation.x = this.state === 'attack' && this.st < 0.6 ? 0.12 : leap ? -0.15 : 0;
    this.head.rotation.y = this.state === 'daze' ? Math.sin(this.time * 20) * 0.4 : 0;
  }
}
