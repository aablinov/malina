import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { C, glowMat, rand, RASP, UNIT } from '../bosses/kit.ts';
import { Mob, type MobHooks } from './mob.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Bush spawn (wiki/design-mobs.md, family C): living raspberries — slime, prickle ball, whip vine, spitting bud,
 * bramble horror. The berryling is in critters.ts.
 */

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };
const LEAF = '#5aa03a', STEM = '#3a7a2a';
const JAM = C(2.4, 0.3, 0.8);

/** 11. Berry Slime — crowd: hops and sticks; on death splits in 2, then once more */
export class BerrySlime extends Mob {
  readonly kind: string = 'slime';
  readonly title = t('Berry Slime');
  readonly cost = 3;
  readonly radius: number;
  override readonly topY: number;
  private readonly jelly = new THREE.Group();
  private readonly hopTo = new THREE.Vector3();
  private readonly hopFrom = new THREE.Vector3();

  /** size: 2 — big, 1 — medium, 0 — small */
  readonly size: number;
  constructor(h: MobHooks, at: THREE.Vector3, size: number = 2) {
    super(h, [8, 16, 36][size], at); this.size = size;
    const s = [0.5, 0.72, 1][size];
    this.radius = 0.55 * s;
    this.topY = 1.1 * s;
    this.speed = 0;
    this.keep = 1;
    this.mass = 0.5 + s;
    this.loot = size === 2 ? 2 : 0;
    // translucent jelly with a berry core inside, little eyes on the front face
    const jam = new THREE.MeshLambertMaterial({ color: '#e0306a', transparent: true, opacity: 0.72 });
    this.flashMats.push(jam);
    const core = this.lam('#9a1240'), eye = this.lam('#2a1420'), glint = this.lam('#ffffff');
    const B = this.box.bind(this);
    this.jelly.scale.setScalar(s);
    this.body.add(this.jelly);
    B(this.jelly, jam, 1.1, 0.9, 1.1, 0, 0.45, 0);
    B(this.jelly, core, 0.4, 0.4, 0.4, 0, 0.4, 0);
    for (const x of [-0.22, 0.22]) { B(this.jelly, eye, 0.14, 0.18, 0.03, x, 0.58, 0.56); B(this.jelly, glint, 0.05, 0.05, 0.03, x + 0.03, 0.62, 0.575); }
    B(this.jelly, this.lam(LEAF), 0.3, 0.06, 0.16, 0.1, 0.92, 0, 0, 0.5, 0.2);
    this.place();
  }

  /** Moves only by hopping */
  protected override steer(dt: number): boolean { this.face(dt); return false; }
  /** Along the road it bounces in small hops */
  protected override get marchPace(): number { return 1.8 * this.slowMul; }

  protected choose(dist: number): string | null { return dist < 9 ? 'hop' : null; }
  protected override rest(): number { return rand(0.3, 0.7); }

  protected act(_name: string, t: number, dt: number, dist: number): boolean {
    if (t - dt <= 0) {
      // a hop toward the hero, no farther than 2.5 m; if it reaches — a mark under the hero
      this.hopFrom.copy(this.pos);
      const hop = Math.min(2.5, Math.max(0, dist - 0.4));
      this.hopTo.copy(this.pos).addScaledVector(this.fwd(), hop);
      const r = this.radius + 0.4;
      this.field.markCircle(this.hopTo, r, 0.55, () => {
        if (this.dead) return;
        if (!this.quiet) voice({ type: 'sine', f: 180 + 80 * (2 - this.size), f1: 90, dur: 0.15, vol: 0.05 });
        this.h.fx.burst(this.hopTo.clone().setY(this.ground + 0.1), ['#e0306a', '#9a1240'], 6, { speed: 2, up: 1.5, size: 0.08, life: 0.4, gravity: 8 });
        if (this.inCircle(this.hopTo, r)) this.hurt([3, 4, 6][this.size], this.hopTo, 2);
        // sticky puddle
        if (this.size > 0) this.field.hazard(this.hopTo, r * 0.8, 1.5, 2, JAM);
      });
    }
    if (t > 0.25 && t < 0.55) {
      const k = (t - 0.25) / 0.3;
      this.pos.lerpVectors(this.hopFrom, this.hopTo, k);
      this.flyY = Math.sin(k * Math.PI) * 0.9;
    }
    if (t >= 0.55) { this.flyY = 0; return t > 0.7; }
    return false;
  }

  /** Died — splits into two smaller ones (no raspberries) */
  protected override die(): void {
    super.die();
    if (this.size === 0) return;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    for (const s of [-1, 1]) {
      const m = this.mh.spawn(this.size === 2 ? 'slime_mid' : 'slime_small', this.pos.clone().addScaledVector(side, s * this.radius));
      if (!m) continue;
      m.summoned = true;
      // on the march the halves hop on along the same road, otherwise — straight to the hero
      if (this.march) m.joinMarch(this); else m.notice();
    }
  }

  protected animate(): void {
    // flattens before the hop, stretches in flight, wobbles in place
    const a = this.state === 'attack' ? (this.st < 0.25 ? 0.7 : this.st < 0.55 ? 1.25 : 0.8) : 1 + Math.sin(this.time * 4) * 0.05;
    this.jelly.scale.y = this.jelly.scale.x * a;
    // on the march bounces as it goes
    if (this.state !== 'attack') this.flyY = this.state === 'walk' ? Math.abs(Math.sin(this.time * 5)) * 0.35 : 0;
  }
}

export class BerrySlimeMid extends BerrySlime {
  override readonly kind = 'slime_mid';
  constructor(h: MobHooks, at: THREE.Vector3) { super(h, at, 1); }
}

export class BerrySlimeSmall extends BerrySlime {
  override readonly kind = 'slime_small';
  constructor(h: MobHooks, at: THREE.Vector3) { super(h, at, 0); }
}

/** 12. Prickle Ball — charge: curls up like a hedgehog and rolls along a strip; hit a wall — stunned */
export class ThornBall extends Mob {
  readonly kind = 'hedgehog';
  readonly title = t('Prickle Ball');
  readonly cost = 3;
  readonly radius = 0.5;
  override readonly topY = 1.1;
  private readonly ball = new THREE.Group();
  private readonly face_ = new THREE.Group();
  private readonly legs: THREE.Group[];
  private readonly dir = new THREE.Vector3();
  private rolled = 0;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 30, at);
    this.speed = 2.6;
    this.keep = 5;
    this.mass = 1.2;
    const fur = this.lam('#7a4a3a', pixelTex('#7a4a3a', 12, 741)), thorn = this.lam('#c8245a'), tip = this.lam('#f4d0dc');
    const snout = this.lam('#d8b8a0'), eye = this.lam('#1a1014'), leg = this.lam('#5a3428');
    const B = this.box.bind(this);
    this.ball.position.y = 0.5;
    this.body.add(this.ball);
    B(this.ball, fur, 0.8, 0.7, 0.9, 0, 0, 0);
    // drupelet spikes along the back: raspberry with a white tip
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, x = Math.cos(a) * 0.36, z = Math.sin(a) * 0.38;
      B(this.ball, thorn, 0.14, 0.24, 0.14, x, 0.36, z, z * 0.6, 0, -x * 0.6);
      B(this.ball, tip, 0.08, 0.08, 0.08, x * 1.15, 0.5, z * 1.15);
    }
    B(this.ball, thorn, 0.16, 0.28, 0.16, 0, 0.42, 0);
    this.face_.position.set(0, -0.05, 0.45);
    this.ball.add(this.face_);
    B(this.face_, snout, 0.36, 0.28, 0.2, 0, 0, 0.05);
    B(this.face_, eye, 0.1, 0.06, 0.04, 0, 0.02, 0.17);
    for (const x of [-0.13, 0.13]) B(this.face_, eye, 0.07, 0.07, 0.02, x, 0.12, 0.15);
    this.legs = [[-0.22, 0.25], [0.22, 0.25], [-0.22, -0.25], [0.22, -0.25]].map(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0.18, z);
      this.body.add(g);
      B(g, leg, 0.14, 0.18, 0.14, 0, -0.09, 0);
      return g;
    });
    this.place();
  }

  protected choose(dist: number, rel: number): string | null { return dist < 10 && Math.abs(rel) < 0.3 ? 'roll' : null; }
  protected override rest(): number { return rand(1, 1.8); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      this.dir.copy(this.fwd());
      this.rolled = 0;
      if (!this.quiet) hiss({ dur: 0.6, vol: 0.06, f: 500, f1: 1400, q: 0.8, type: 'bandpass' });
      this.field.markLine(this.pos.clone(), this.dir, 9, 1.2, 0.7, () => undefined);
    }
    if (t < 0.7) return false;
    // rolls at 11 m/s to the end of the strip or to a wall
    const blocked = this.dash(this.dir, 11, dt);
    this.rolled += 11 * dt;
    // touched the hero — knocked him down and stopped
    if (this.inCircle(this.pos, this.radius + 0.2)) { this.hurt(9, this.pos, 6); if (!this.quiet) boom(200, 80, 0.2, 0.25); return true; }
    if (rnd() < 0.5) this.h.fx.particle({ pos: this.pos.clone().setY(this.ground + 0.1), vel: new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1)), life: 0.3, size: 0.08, color: '#8a6a40', gravity: 6 });
    if (blocked) {
      // into a wall: bounce and stars
      if (!this.quiet) boom(120, 40, 0.4, 0.5);
      this.h.fx.shake = Math.max(this.h.fx.shake, 0.2);
      this.move(this.dir, -0.4);
      this.daze(1.5);
      return false;
    }
    return this.rolled >= 9;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 14), s = this.stride(14);
    const curled = this.state === 'attack';
    // curled up: snout and legs hidden, the ball spins
    this.face_.visible = !curled;
    for (const [i, l] of this.legs.entries()) { l.visible = !curled; lerpTo(l, walk ? (i % 3 === 0 ? s : -s) * 0.6 : 0, k); }
    this.ball.rotation.x = curled ? this.ball.rotation.x + dt * (this.st < 0.7 ? 6 : 18) : 0;
    this.ball.scale.setScalar(curled ? 0.9 : 1);
    this.ball.rotation.z = this.state === 'daze' ? Math.sin(this.time * 18) * 0.2 : 0;
  }
}

/** 13. Whip Vine — trap: grows out of the ground, does not walk, lashes in a 3 m circle */
export class VineWhip extends Mob {
  readonly kind = 'vine';
  readonly title = t('Whip Vine');
  readonly cost = 3;
  readonly radius = 0.45;
  override readonly topY = 2.2;
  private readonly segs: THREE.Group[] = [];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 35, at);
    this.speed = 0;
    this.keep = 0;
    this.mass = 99;
    this.aggro = 7;
    const stem = this.lam(STEM, pixelTex(STEM, 10, 751)), leaf = this.lam(LEAF), thorn = this.lam('#c8245a');
    const B = this.box.bind(this);
    // a root hummock, three stem joints, a thorny bud at the end
    B(this.body, this.lam('#5a4428'), 0.9, 0.2, 0.9, 0, 0.1, 0);
    let parent: THREE.Object3D = this.body;
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.y = i === 0 ? 0.2 : 0.65;
      parent.add(g);
      B(g, stem, 0.26 - i * 0.04, 0.68, 0.26 - i * 0.04, 0, 0.34, 0);
      B(g, thorn, 0.08, 0.14, 0.08, 0.16, 0.3, 0, 0, 0, -0.6);
      B(g, leaf, 0.3, 0.05, 0.16, -0.2, 0.5, 0, 0, 0, 0.4);
      this.segs.push(g);
      parent = g;
    }
    B(parent, thorn, 0.36, 0.36, 0.36, 0, 0.8, 0);
    B(parent, this.shimmer(RASP, C(3.4, 1.6, 2.2), rnd() * 6, 2), 0.16, 0.16, 0.06, 0, 0.82, 0.19);
    this.place();
  }

  /** Does not walk — only turns */
  protected override steer(dt: number): boolean { this.face(dt); return false; }
  /** Along the road it crawls slowly, putting down roots */
  protected override get marchPace(): number { return 1.2 * this.slowMul; }
  /** Roots hold: no knockback */
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void { const p = this.pos.clone(); super.hit(dmg, dir, point, knock); this.pos.copy(p); }

  protected choose(dist: number): string | null { return dist < 3.4 ? 'whip' : null; }
  protected override rest(): number { return rand(0.8, 1.3); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) this.field.markCircle(this.pos.clone(), 3, 0.6, () => {
      if (this.dead) return;
      if (!this.quiet) hiss({ dur: 0.25, vol: 0.14, f: 2600, f1: 600, q: 1, type: 'bandpass' });
      this.h.fx.shock(this.pos.clone().setY(this.ground + 0.4), 3, C(1, 2, 0.6), 0.3, 0.12);
      if (this.inCircle(this.pos, 3)) this.hurt(7, this.pos, 5);
    });
    return t > 1;
  }

  protected animate(dt: number): void {
    const k = Math.min(1, dt * 12);
    // sways; in the windup bends back, the lash is a full turn around
    const whip = this.state === 'attack';
    this.segs.forEach((g, i) => {
      lerpTo(g, whip ? (this.st < 0.6 ? -0.35 : 0.5) : Math.sin(this.time * 1.6 + i) * 0.12, whip ? k * 1.5 : k);
      g.rotation.z = Math.sin(this.time * 1.2 + i * 0.7) * 0.08;
    });
    this.body.rotation.y = whip && this.st > 0.6 ? Math.min(1, (this.st - 0.6) / 0.25) * Math.PI * 2 : 0;
  }
}

/** 14. Spitting Bud — turret: spits seeds in an arc onto marks; closed while spitting, hit it in the pause */
export class BudSpitter extends Mob {
  readonly kind = 'bud';
  readonly title = t('Spitting Bud');
  readonly cost = 4;
  readonly radius = 0.5;
  override readonly topY = 1.9;
  private readonly head = new THREE.Group();
  private readonly petals: THREE.Group[] = [];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 30, at);
    this.speed = 0;
    this.keep = 0;
    this.mass = 99;
    this.aggro = 12;
    const stem = this.lam(STEM), leaf = this.lam(LEAF, pixelTex(LEAF, 10, 761)), petal = this.lam('#e0306a', pixelTex('#e0306a', 10, 762));
    const B = this.box.bind(this);
    B(this.body, stem, 0.18, 1.2, 0.18, 0, 0.6, 0);
    for (const [x, rz] of [[-0.3, 0.5], [0.3, -0.5]] as const) B(this.body, leaf, 0.5, 0.06, 0.3, x, 0.35, 0, 0, 0, rz);
    this.head.position.y = 1.3;
    this.body.add(this.head);
    B(this.head, this.lam('#9a1240'), 0.4, 0.3, 0.4, 0, 0.1, 0);
    B(this.head, this.shimmer(RASP, C(3.4, 2.4, 1.2), 0, 2.4), 0.2, 0.08, 0.2, 0, 0.26, 0);
    // four petals: open in the pause, closed while spitting
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.rotation.y = (i / 4) * Math.PI * 2;
      this.head.add(g);
      const p = new THREE.Group();
      p.position.z = 0.2;
      g.add(p);
      B(p, petal, 0.36, 0.5, 0.06, 0, 0.25, 0);
      this.petals.push(p);
    }
    this.place();
  }

  protected override steer(dt: number): boolean { this.face(dt); return false; }
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void { const p = this.pos.clone(); super.hit(dmg, dir, point, knock); this.pos.copy(p); }
  /** Closed — the petals hold hits from all sides */
  protected override guard(): number { return this.state === 'attack' ? 0.25 : 1; }

  protected choose(dist: number): string | null { return dist < 12 ? 'spit' : null; }
  protected override rest(): number { return rand(1.6, 2.4); }

  protected act(_name: string, t: number, dt: number): boolean {
    for (let i = 0; i < 3; i++) {
      const at = 0.4 + i * 0.3;
      if (t >= at && t - dt < at) {
        const to = this.heroAt().add(new THREE.Vector3(rand(-1.4, 1.4), 0, rand(-1.4, 1.4)).multiplyScalar(i === 0 ? 0.1 : 1));
        const seed = new THREE.Mesh(UNIT, glowMat(C(3, 2.6, 1.6)));
        seed.scale.set(0.16, 0.22, 0.16);
        if (!this.quiet) voice({ type: 'square', f: 520, f1: 260, dur: 0.06, vol: 0.03, lp: 1800 });
        this.field.markCircle(to, 1, 0.8, () => undefined);
        this.field.lob(seed, this.head.getWorldPosition(new THREE.Vector3()).setY(this.ground + 1.7), to, 0.8, 2.4, C(1.6, 0.6, 0.8), (p) => {
          this.h.fx.burst(p.clone().setY(this.ground + 0.2), ['#f4e0b0', '#c8245a'], 6, { speed: 2, up: 2, size: 0.07, life: 0.4, gravity: 8 });
          if (this.inCircle(p, 1)) this.hurt(6, p, 2);
        });
      }
    }
    return t > 1.3;
  }

  protected animate(dt: number): void {
    const k = Math.min(1, dt * 10), shut = this.state === 'attack';
    for (const p of this.petals) lerpTo(p, shut ? -0.05 : 0.9, k);
    // spit — the bud nods
    this.head.rotation.x = shut ? Math.max(0, Math.sin((this.st - 0.3) * 10)) * 0.25 : Math.sin(this.time * 1.4) * 0.06;
  }
}

/** 15. Bramble Horror — tank: tall, made of vines; pulls the hero in with a vine and hits; stunned after the pull */
export class ThornHorror extends Mob {
  readonly kind = 'horror';
  readonly title = t('Bramble Horror');
  readonly cost = 8;
  readonly radius = 0.8;
  override readonly topY = 3.2;
  private readonly legs: THREE.Group[];
  private readonly arms: THREE.Group[];
  private readonly head = new THREE.Group();
  private readonly lash: THREE.Mesh;
  private readonly lashDir = new THREE.Vector3();
  private caught = false;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 140, at);
    this.speed = 2;
    this.turn = 2.5;
    this.keep = 2.4;
    this.mass = 3;
    this.loot = 3;
    const moss = this.lam('#6f8a3a', pixelTex('#6f8a3a', 16, 771)), dark = this.lam('#3f5a22', pixelTex('#3f5a22', 14, 772));
    const maw = this.lam('#c8202a'), thorn = this.lam('#a8d060'), crystal = this.lam('#7a4ac8', pixelTex('#7a4ac8', 10, 773));
    const core = this.shimmer(C(3.4, 2, 3.2), RASP, 0, 2.2);
    const B = this.box.bind(this);
    // long legs of vines
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.4, 1.6, 0);
      this.body.add(g);
      B(g, dark, 0.34, 1.6, 0.34, 0, -0.8, 0);
      for (let i = 0; i < 3; i++) B(g, thorn, 0.3, 0.06, 0.12, s * 0.2, -0.3 - i * 0.45, 0.1, 0, 0, s * 0.5);
      return g;
    });
    // torso: a glowing core between the legs, a maw head with a crystal on top
    B(this.body, dark, 0.9, 0.7, 0.6, 0, 1.85, 0);
    B(this.body, core, 0.3, 0.3, 0.1, 0, 1.8, 0.31);
    this.head.position.y = 2.2;
    this.body.add(this.head);
    B(this.head, moss, 1.2, 0.5, 1, 0, 0.75, 0);
    B(this.head, maw, 1.0, 0.36, 0.8, 0, 0.3, 0.05);
    B(this.head, moss, 1.1, 0.16, 0.9, 0, 0.08, 0);
    B(this.head, crystal, 0.36, 0.3, 0.36, 0, 1.12, 0);
    B(this.head, this.lam('#b0a0f0'), 0.12, 0.2, 0.12, 0.05, 1.32, 0);
    for (const [x, z] of [[-0.6, 0.3], [0.6, -0.2], [0.2, 0.5], [-0.3, -0.5]] as const) B(this.head, thorn, 0.3, 0.06, 0.14, x, 0.9, z, 0, Math.atan2(x, z), 0.4);
    // vine arms
    this.arms = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.75, 2.6, 0);
      this.body.add(g);
      B(g, dark, 0.24, 1.3, 0.24, 0, -0.65, 0);
      B(g, thorn, 0.36, 0.06, 0.14, s * 0.14, -1.1, 0.1, 0, 0, s * 0.4);
      return g;
    });
    // lasso vine: reaches for the hero
    this.lash = new THREE.Mesh(UNIT, this.lam('#4a6a2a'));
    this.lash.visible = false;
    h.scene.add(this.lash);
    this.place();
  }

  override dispose(): void { super.dispose(); this.h.scene.remove(this.lash); }

  protected choose(dist: number, rel: number): string | null {
    if (dist < 2.8) return 'stomp';
    return dist < 7 && Math.abs(rel) < 0.35 ? 'grab' : null;
  }
  protected override rest(): number { return rand(1.4, 2.2); }

  protected act(name: string, t: number, dt: number): boolean {
    if (name === 'stomp') {
      if (t - dt <= 0) this.field.markCircle(this.pos.clone(), 2.6, 0.7, () => {
        if (this.dead) return;
        if (!this.quiet) boom(60, 25, 0.6, 0.7);
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.4);
        this.h.fx.shock(this.pos.clone().setY(this.ground + 0.1), 2.6, C(1.2, 1.6, 0.6), 0.35, 0.15);
        if (this.inCircle(this.pos, 2.6)) this.hurt(10, this.pos, 7);
      });
      return t > 1;
    }
    // lasso: a 7 m strip → the vine flies; caught — pulls the hero in and hits with both arms; miss — stunned
    if (t - dt <= 0) {
      this.caught = false;
      const from = this.pos.clone();
      this.lashDir.copy(this.fwd());
      this.field.markLine(from, this.lashDir, 7, 1, 0.8, () => {
        if (this.dead) return;
        if (!this.quiet) hiss({ dur: 0.3, vol: 0.15, f: 1800, f1: 500, q: 1, type: 'bandpass' });
        if (this.inLine(from, this.lashDir, 7, 1)) {
          this.caught = true;
          // pulls: knockback "from a point behind the hero" — toward the horror
          const behind = this.h.hero.pos.clone().addScaledVector(this.lashDir, 1);
          this.hurt(6, behind, 9);
        }
      });
    }
    const len = t < 0.8 ? 0 : t < 1 ? (t - 0.8) / 0.2 * 7 : Math.max(0, 7 - (t - 1) * 14);
    this.lash.visible = len > 0.05;
    if (this.lash.visible) {
      const a = this.pos.clone().setY(this.ground + 2).addScaledVector(this.lashDir, 0.6);
      this.lash.position.copy(a).addScaledVector(this.lashDir, len / 2).setY(this.ground + 1.6);
      this.lash.rotation.set(0, Math.atan2(this.lashDir.x, this.lashDir.z), 0);
      this.lash.scale.set(0.16, 0.16, len);
    }
    if (t >= 1.1 && t - dt < 1.1 && this.caught) {
      const at = this.pos.clone().addScaledVector(this.lashDir, 1.6);
      this.field.markCircle(at, 1.8, 0.45, () => { if (!this.dead && this.inCircle(at, 1.8)) this.hurt(12, at, 6); });
    }
    if (t >= 1.7) {
      this.lash.visible = false;
      if (!this.caught) { this.daze(1.4); return false; }
      return true;
    }
    return false;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 8), s = this.stride(4.5);
    lerpTo(this.legs[0], walk ? s * 0.35 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 0.35 : 0, k);
    const grab = this.state === 'attack' && this.attack === 'grab';
    const smash = grab && this.st > 1.1 && this.caught;
    lerpTo(this.arms[0], smash ? (this.st < 1.55 ? -2.6 : -0.6) : grab ? -1.5 : Math.sin(this.time * 1.5) * 0.15, k);
    lerpTo(this.arms[1], smash ? (this.st < 1.55 ? -2.6 : -0.6) : grab ? -0.2 : -Math.sin(this.time * 1.5) * 0.15, k);
    // the maw is open when hitting; the body waddles
    this.head.rotation.x = this.state === 'attack' ? -0.25 : this.state === 'daze' ? 0.3 : 0;
    this.body.rotation.z = walk ? s * 0.06 : 0;
  }
}
