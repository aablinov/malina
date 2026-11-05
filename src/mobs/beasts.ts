import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { C, glowMat, rand, RASP, UNIT } from '../bosses/kit.ts';
import { Mob, type MobHooks } from './mob.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Beasts of the Order (wiki/design-mobs.md, family E): berry boarlet, berry beetle, vine weaver, hive with bumblebees.
 * The raspberry wolf is in critters.ts.
 */

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };
const WEB = C(1.2, 2.4, 0.8);

/** 22. Berry Boarlet — ram: a charge along a strip, knocks the hero down and runs on; hit a wall — stunned */
export class Boarlet extends Mob {
  readonly kind = 'boarlet';
  readonly title = t('Berry Boarlet');
  readonly cost = 4;
  readonly radius = 0.55;
  override readonly topY = 1.3;
  private readonly legs: THREE.Group[];
  private readonly head = new THREE.Group();
  private readonly dir = new THREE.Vector3();
  private ran = 0;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 45, at);
    this.speed = 2.6;
    this.turn = 3.5;
    this.keep = 5;
    this.mass = 1.6;
    this.loot = 2;
    const hide = this.lam('#8a5a4a', pixelTex('#8a5a4a', 12, 811)), bristle = this.lam('#c8245a', pixelTex('#c8245a', 10, 812));
    const snout = this.lam('#e0a0a0'), tusk = this.lam('#f4ecd8'), hoof = this.lam('#3a2a24'), eye = this.shimmer(C(3.4, 1.4, 2), RASP, 0, 2);
    const B = this.box.bind(this);
    B(this.body, hide, 0.7, 0.62, 1.1, 0, 0.72, 0);
    // a raspberry bristle crest and a leaf caparison with the Order's berry
    for (let i = 0; i < 4; i++) B(this.body, bristle, 0.18, 0.16, 0.2, 0, 1.08, 0.36 - i * 0.24);
    B(this.body, this.lam('#5aa03a'), 0.74, 0.08, 0.5, 0, 1.04, -0.12);
    B(this.body, bristle, 0.16, 0.16, 0.04, 0.38, 0.8, 0, 0, Math.PI / 2, 0);
    B(this.body, hide, 0.08, 0.3, 0.08, 0, 0.82, -0.6, 0.6);
    this.head.position.set(0, 0.78, 0.6);
    this.body.add(this.head);
    B(this.head, hide, 0.56, 0.5, 0.42, 0, 0, 0.12);
    B(this.head, snout, 0.3, 0.22, 0.12, 0, -0.08, 0.38);
    for (const x of [-0.18, 0.18]) { B(this.head, tusk, 0.07, 0.2, 0.07, x, 0.02, 0.36); B(this.head, eye, 0.07, 0.06, 0.02, x * 0.8, 0.12, 0.335); B(this.head, hide, 0.1, 0.16, 0.06, x, 0.3, 0.06); }
    this.legs = [[-0.22, 0.34], [0.22, 0.34], [-0.22, -0.34], [0.22, -0.34]].map(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0.44, z);
      this.body.add(g);
      B(g, hide, 0.18, 0.36, 0.2, 0, -0.18, 0);
      B(g, hoof, 0.2, 0.1, 0.22, 0, -0.39, 0);
      return g;
    });
    this.place();
  }

  protected choose(dist: number, rel: number): string | null { return dist < 11 && Math.abs(rel) < 0.25 ? 'charge' : null; }
  protected override rest(): number { return rand(1.4, 2.2); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      this.dir.copy(this.fwd());
      this.ran = 0;
      if (!this.quiet) voice({ type: 'sawtooth', f: 120, f1: 180, dur: 0.6, vol: 0.05, lp: 900 });
      this.field.markLine(this.pos.clone(), this.dir, 10, 1.3, 0.8, () => undefined);
    }
    // paws the ground for 0.8 s — and charges 10 m
    if (t < 0.8) { if (rnd() < 0.3) this.h.fx.particle({ pos: this.pos.clone().setY(0.1), vel: new THREE.Vector3(rand(-1, 1), 1.5, rand(-1, 1)), life: 0.4, size: 0.08, color: '#8a6a40', gravity: 6 }); return false; }
    const blocked = this.dash(this.dir, 10, dt);
    this.ran += 10 * dt;
    if (!this.hitDone && this.inCircle(this.pos, this.radius + 0.2)) { this.hitDone = true; this.hurt(10, this.pos.clone().addScaledVector(this.dir, -1), 8); if (!this.quiet) boom(160, 60, 0.3, 0.35); }
    if (blocked) {
      if (!this.quiet) boom(90, 30, 0.6, 0.6);
      this.h.fx.shake = Math.max(this.h.fx.shake, 0.3);
      this.move(this.dir, -0.4);
      this.daze(1.8);
      return false;
    }
    return this.ran >= 10;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 16), run = this.state === 'attack' && this.st > 0.8;
    const s = this.stride(run ? 22 : 12), a = run || walk ? s * 0.7 : 0;
    lerpTo(this.legs[0], a, k); lerpTo(this.legs[3], a, k);
    lerpTo(this.legs[1], -a, k); lerpTo(this.legs[2], -a, k);
    // paws the ground — head down; running — head forward and down, tusks first
    this.head.rotation.x = this.state === 'attack' ? 0.3 : 0;
    this.body.rotation.x = this.state === 'attack' && !run ? Math.sin(this.time * 18) * 0.05 : 0;
    this.head.rotation.y = this.state === 'daze' ? Math.sin(this.time * 18) * 0.4 : 0;
  }
}

/** 23. Berry Beetle — ambush: burrows, a mound crawls toward the hero, surfaces on a mark; surfaced — open */
export class BurrowBeetle extends Mob {
  readonly kind = 'beetle';
  readonly title = t('Berry Beetle');
  readonly cost = 4;
  readonly radius = 0.5;
  override readonly topY = 1;
  private readonly legs: THREE.Group[];
  private readonly mound: THREE.Mesh;
  /** Underground: invisible, hits miss */
  burrowed = false;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 40, at);
    this.speed = 2.2;
    this.keep = 4;
    this.mass = 1.2;
    const shell = this.lam('#b8204a', pixelTex('#b8204a', 12, 821)), drupe = this.lam('#e0306a'), dark = this.lam('#2a1a24');
    const leaf = this.lam('#5aa03a'), eye = this.shimmer(C(3.4, 2.6, 1), RASP, 0, 2);
    const B = this.box.bind(this);
    // berry shell: a dome of drupelets, little leaves on top
    B(this.body, shell, 0.84, 0.42, 0.96, 0, 0.5, -0.04);
    for (const [x, z] of [[-0.24, 0.2], [0.24, 0.2], [-0.24, -0.2], [0.24, -0.2], [0, 0], [0, 0.36], [0, -0.38]] as const) B(this.body, drupe, 0.2, 0.12, 0.2, x, 0.74, z);
    B(this.body, leaf, 0.36, 0.05, 0.16, 0, 0.82, -0.3, 0, 0.6, 0);
    B(this.body, dark, 0.5, 0.3, 0.3, 0, 0.42, 0.52);
    for (const x of [-0.14, 0.14]) { B(this.body, eye, 0.08, 0.06, 0.02, x, 0.48, 0.675); B(this.body, dark, 0.06, 0.06, 0.22, x * 1.2, 0.34, 0.74, 0.3, x * 2, 0); }
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.42, 0.4, 0);
      this.body.add(g);
      for (const z of [-0.3, 0, 0.3]) B(g, dark, 0.3, 0.06, 0.06, s * 0.14, -0.14, z, 0, 0, -s * 0.6);
      return g;
    });
    this.mound = new THREE.Mesh(UNIT, this.lam('#7a5a3a', pixelTex('#7a5a3a', 12, 822)));
    this.mound.scale.set(0.9, 0.25, 0.9);
    this.mound.visible = false;
    h.scene.add(this.mound);
    this.place();
  }

  override dispose(): void { super.dispose(); this.h.scene.remove(this.mound); }

  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void { if (!this.burrowed) super.hit(dmg, dir, point, knock); }

  protected choose(dist: number): string | null { return dist < 12 ? 'burrow' : null; }
  protected override rest(): number { return rand(1.2, 2); }

  protected act(_name: string, t: number, dt: number): boolean {
    // 0–0.4: burrows; until 2.4 s the mound crawls toward the hero; a 0.5 s mark — surfaces; miss or not — stunned 1.2 s
    if (t < 0.4) return false;
    if (t - dt < 0.4) { this.burrowed = true; if (!this.quiet) hiss({ dur: 0.4, vol: 0.12, f: 600, f1: 200, q: 0.5, type: 'lowpass' }); this.h.fx.burst(this.pos.clone().setY(0.2), ['#7a5a3a', '#5a4428'], 10, { speed: 2, up: 2.5, size: 0.1, life: 0.5, gravity: 8 }); }
    const hero = this.h.hero.pos, dx = hero.x - this.pos.x, dz = hero.z - this.pos.z, d = Math.hypot(dx, dz);
    if (t < 2.4 && d > 0.3 && !this.hitDone) {
      const sp = 4.5 * dt;
      this.pos.x += (dx / d) * Math.min(sp, d); this.pos.z += (dz / d) * Math.min(sp, d);
      if (rnd() < 0.4) this.h.fx.particle({ pos: this.pos.clone().setY(0.15), vel: new THREE.Vector3(rand(-1, 1), 1.5, rand(-1, 1)), life: 0.4, size: 0.08, color: '#7a5a3a', gravity: 6 });
      return false;
    }
    if (!this.hitDone) {
      this.hitDone = true;
      const c = this.pos.clone();
      this.field.markCircle(c, 1.4, 0.5, () => {
        if (this.dead) return;
        this.burrowed = false;
        if (!this.quiet) boom(140, 50, 0.4, 0.45);
        this.h.fx.burst(c.clone().setY(0.3), ['#7a5a3a', '#b8204a'], 16, { speed: 4, up: 5, size: 0.12, life: 0.6, gravity: 10 });
        if (this.inCircle(c, 1.4)) this.hurt(9, c, 5);
        this.daze(1.2);
      });
    }
    return false;
  }

  protected override die(): void { this.burrowed = false; super.die(); }

  protected animate(_dt: number, walk: boolean): void {
    const s = this.stride(16);
    this.legs[0].rotation.y = walk ? s * 0.3 : 0;
    this.legs[1].rotation.y = walk ? -s * 0.3 : 0;
    this.body.visible = !this.burrowed;
    this.mound.visible = this.burrowed && !this.dead;
    this.mound.position.set(this.pos.x, 0.08 + Math.sin(this.time * 12) * 0.03, this.pos.z);
  }
}

/** 24. Vine Weaver — control: a spider of vines weaves a web on the floor that slows; bites up close */
export class VineSpider extends Mob {
  readonly kind = 'spider';
  readonly title = t('Vine Weaver');
  readonly cost = 4;
  readonly radius = 0.6;
  override readonly topY = 1.1;
  private readonly legs: THREE.Group[];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 35, at);
    this.speed = 3.2;
    this.turn = 6;
    this.keep = 6;
    this.mass = 1;
    const vine = this.lam('#3f6a2a', pixelTex('#3f6a2a', 14, 831)), leaf = this.lam('#5aa03a'), thorn = this.lam('#c8245a');
    const eye = this.shimmer(C(3.4, 1.4, 2.4), C(3.4, 3, 1.4), 0, 2.4);
    const B = this.box.bind(this);
    B(this.body, vine, 0.7, 0.42, 0.8, 0, 0.62, -0.1);
    B(this.body, leaf, 0.5, 0.06, 0.5, 0, 0.86, -0.1, 0, 0.7, 0);
    B(this.body, thorn, 0.2, 0.2, 0.2, 0, 0.92, -0.1);
    B(this.body, vine, 0.44, 0.32, 0.34, 0, 0.6, 0.42);
    for (const [x, y] of [[-0.12, 0.66], [0.12, 0.66], [-0.06, 0.56], [0.06, 0.56]] as const) B(this.body, eye, 0.07, 0.07, 0.02, x, y, 0.6);
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.32, 0.6, 0);
      this.body.add(g);
      for (const z of [-0.36, -0.12, 0.12, 0.36]) { B(g, vine, 0.6, 0.08, 0.08, s * 0.3, 0.06, z, 0, 0, -s * 0.4); B(g, vine, 0.08, 0.6, 0.08, s * 0.62, -0.22, z); }
      return g;
    });
    this.place();
  }

  protected choose(dist: number): string | null {
    if (dist < 1.8) return 'bite';
    return dist < 11 ? 'web' : null;
  }
  protected override rest(): number { return rand(1.6, 2.4); }

  protected act(name: string, t: number, dt: number): boolean {
    if (name === 'bite') {
      if (t - dt <= 0) {
        const c = this.pos.clone().addScaledVector(this.fwd(), 0.9);
        this.field.markCircle(c, 0.9, 0.35, () => { if (!this.dead && this.inCircle(c, 0.9)) this.hurt(6, this.pos, 3); });
      }
      return t > 0.6;
    }
    // a ball of vines in an arc — a 2.4 m web on the floor for 5 s: slows by 45 %
    if (t >= 0.4 && t - dt < 0.4) {
      const to = this.heroAt();
      const ball = new THREE.Mesh(UNIT, glowMat(WEB));
      ball.scale.setScalar(0.35);
      if (!this.quiet) hiss({ dur: 0.3, vol: 0.08, f: 1400, f1: 600, q: 0.8, type: 'bandpass' });
      this.field.markCircle(to, 2.4, 0.8, () => undefined, WEB);
      this.field.lob(ball, this.pos.clone().setY(0.9), to, 0.8, 2, WEB, (p) => {
        this.h.fx.burst(p.clone().setY(0.2), ['#5aa03a', '#3f6a2a'], 12, { speed: 3, up: 1.5, size: 0.08, life: 0.5, gravity: 6 });
        if (this.inCircle(p, 2.4)) this.hurt(3, p, 0);
        this.field.hazard(p, 2.4, 5, 0, WEB, 0.45);
      });
    }
    return t > 0.9;
  }

  protected animate(_dt: number, walk: boolean): void {
    const s = this.stride(18);
    this.legs[0].rotation.x = walk ? s * 0.2 : 0;
    this.legs[1].rotation.x = walk ? -s * 0.2 : 0;
    // weaving — rises on its hind legs
    this.body.rotation.x = this.state === 'attack' && this.attack === 'web' && this.st < 0.4 ? -0.3 : 0;
  }
}

/** Hive bumblebee: tiny, flies to the hero and stings; falls from one hit */
export class Bee extends Mob {
  readonly kind = 'bee';
  readonly title = t('Bumblebee');
  readonly cost = 0;
  readonly radius = 0.25;
  override readonly topY = 1.4;
  private readonly wings: THREE.Mesh[] = [];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 4, at);
    this.speed = 5.5;
    this.turn = 10;
    this.keep = 0.6;
    this.mass = 0.15;
    this.aggro = 20;
    this.loot = 0;
    const B = this.box.bind(this);
    const fur = this.lam('#e8b84a'), stripe = this.lam('#2a2028'), wing = new THREE.MeshLambertMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.6 });
    this.flashMats.push(wing);
    B(this.body, fur, 0.3, 0.26, 0.4, 0, 1.1, 0);
    B(this.body, stripe, 0.31, 0.27, 0.08, 0, 1.1, -0.06);
    B(this.body, this.lam('#c8245a'), 0.06, 0.06, 0.1, 0, 1.08, -0.24);
    B(this.body, stripe, 0.2, 0.2, 0.1, 0, 1.12, 0.22);
    for (const s of [-1, 1]) this.wings.push(B(this.body, wing, 0.3, 0.02, 0.18, s * 0.18, 1.28, 0));
    this.place();
  }

  protected choose(dist: number): string | null { return dist < 1 ? 'sting' : null; }
  protected override rest(): number { return rand(0.6, 1); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const c = this.pos.clone().addScaledVector(this.fwd(), 0.5);
      this.field.markCircle(c, 0.5, 0.25, () => { if (!this.dead && this.inCircle(c, 0.5)) this.hurt(2, this.pos, 0.5); });
    }
    return t > 0.35;
  }

  protected animate(): void {
    const f = Math.sin(this.time * 60) * 0.6;
    this.wings[0].rotation.z = f; this.wings[1].rotation.z = -f;
    this.body.position.y = Math.sin(this.time * 5) * 0.1;
  }
}

/** 25. Order Hive — spawner: stands in place and releases bumblebees while intact (no more than 5); the hive fell — the bumblebees fall */
export class Hive extends Mob {
  readonly kind = 'hive';
  readonly title = t('Order Hive');
  readonly cost = 5;
  readonly radius = 0.6;
  override readonly topY = 1.9;
  private readonly bees: Mob[] = [];
  private readonly hive = new THREE.Group();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 60, at);
    this.speed = 0;
    this.keep = 0;
    this.mass = 99;
    this.loot = 3;
    this.aggro = 10;
    const wood = this.lam('#7a5232'), straw = this.lam('#e0b850', pixelTex('#e0b850', 12, 841)), band = this.lam('#b08030'), dark = this.lam('#3a2414');
    const B = this.box.bind(this);
    // a stump stand, a stepped straw hive, an entrance hole, the Order's berry on the roof
    B(this.body, wood, 0.7, 0.5, 0.7, 0, 0.25, 0);
    this.hive.position.y = 0.5;
    this.body.add(this.hive);
    for (const [w, y] of [[0.9, 0.18], [1.0, 0.48], [0.9, 0.78], [0.66, 1.04], [0.36, 1.22]] as const) { B(this.hive, straw, w, 0.3, w, 0, y, 0); B(this.hive, band, w + 0.02, 0.05, w + 0.02, 0, y + 0.15, 0); }
    B(this.hive, dark, 0.2, 0.14, 0.04, 0, 0.3, 0.5);
    B(this.hive, this.shimmer(RASP, C(3.4, 2.4, 1), 0, 2), 0.18, 0.18, 0.18, 0, 1.44, 0);
    this.place();
  }

  protected override steer(): boolean { return false; }
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void { const p = this.pos.clone(); super.hit(dmg, dir, point, knock); this.pos.copy(p); }

  protected override die(): void {
    super.die();
    for (const b of this.bees) b.vanish();
  }

  protected choose(): string | null {
    for (let i = this.bees.length - 1; i >= 0; i--) if (this.bees[i].dead) this.bees.splice(i, 1);
    return this.bees.length < 5 ? 'swarm' : null;
  }
  protected override rest(): number { return 3.5; }

  protected act(_name: string, t: number, dt: number): boolean {
    // the hive buzzes and shakes — two bumblebees fly out of the entrance
    if (t >= 0.6 && t - dt < 0.6) {
      if (!this.quiet) voice({ type: 'sawtooth', f: 180, f1: 220, dur: 0.6, vol: 0.03, lp: 700 });
      for (let i = 0; i < Math.min(2, 5 - this.bees.length); i++) {
        const b = this.mh.spawn('bee', this.pos.clone().addScaledVector(this.fwd(), 0.8).add(new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3))));
        if (!b) continue;
        b.summoned = true;
        b.notice();
        this.bees.push(b);
      }
    }
    return t > 0.8;
  }

  protected animate(): void {
    const buzz = this.state === 'attack' ? Math.sin(this.time * 40) * 0.05 : 0;
    this.hive.rotation.z = buzz;
  }
}
