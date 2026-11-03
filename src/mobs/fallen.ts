import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { hiss, voice } from '../spell-audio.ts';
import { C, rand, RASP } from '../bosses/kit.ts';
import { Mob, type MobHooks } from './mob.ts';

/**
 * Павшие садовники (wiki/design-mobs.md, семья D): нежить Ордена — сборщик с серпом, костяной лучник, огонёк-плакальщик,
 * пугало с воронами. Увядший садовник — в critters.ts.
 */

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };
const BONE = '#e8e2c8';
const SOUL = C(1.4, 3, 3.4);

/** Части скелета */
interface Bones { legs: THREE.Group[]; arms: THREE.Group[]; head: THREE.Group }

/** Скелет: тонкие ноги и руки, рёбра под рваной малиновой накидкой, череп со светящимися глазами */
function buildSkeleton(m: Mob, body: THREE.Group, seed: number): Bones {
  const bone = m.lam(BONE, pixelTex(BONE, 8, seed)), dark = m.lam('#3a3430'), rag = m.lam('#7a2a3a', pixelTex('#7a2a3a', 10, seed + 1));
  const eye = m.shimmer(C(3.4, 1.2, 2.2), SOUL, rnd() * 6, 1.8);
  const B = m.box.bind(m);
  const legs = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.13, 0.72, 0);
    body.add(g);
    B(g, bone, 0.12, 0.72, 0.12, 0, -0.36, 0);
    return g;
  });
  B(body, bone, 0.1, 0.4, 0.1, 0, 0.92, 0);
  B(body, bone, 0.5, 0.42, 0.26, 0, 1.24, 0);
  for (const y of [1.12, 1.24, 1.36]) B(body, dark, 0.44, 0.04, 0.27, 0, y, 0.005);
  // рваная накидка: плечи и спина
  B(body, rag, 0.62, 0.16, 0.34, 0, 1.46, 0);
  B(body, rag, 0.56, 0.6, 0.04, 0, 1.12, -0.17, 0.1);
  const head = new THREE.Group();
  head.position.y = 1.52;
  body.add(head);
  B(head, bone, 0.44, 0.42, 0.42, 0, 0.22, 0);
  B(head, dark, 0.34, 0.1, 0.02, 0, 0.06, 0.21);
  for (const x of [-0.1, 0.1]) { B(head, dark, 0.12, 0.12, 0.02, x, 0.26, 0.211); B(head, eye, 0.06, 0.06, 0.02, x, 0.26, 0.215); }
  const arms = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.33, 1.44, 0);
    body.add(g);
    B(g, bone, 0.1, 0.62, 0.1, 0, -0.3, 0);
    return g;
  });
  return { legs, arms, head };
}

function stepPose(r: Bones, s: number, walk: boolean, dt: number): void {
  const k = Math.min(1, dt * 14);
  lerpTo(r.legs[0], walk ? s * 0.6 : 0, k);
  lerpTo(r.legs[1], walk ? -s * 0.6 : 0, k);
}

/** 17. Сборщик с серпом — натиск: быстрый скелет, двойной взмах; хрупкий */
export class Reaper extends Mob {
  readonly kind = 'reaper';
  readonly title = 'Сборщик с серпом';
  readonly cost = 3;
  readonly radius = 0.4;
  override readonly topY = 2;
  private readonly rig: Bones;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 28, at);
    this.speed = 4;
    this.turn = 7;
    this.keep = 1.4;
    this.mass = 0.7;
    this.rig = buildSkeleton(this, this.body, 781);
    // серп в правой руке, корзинка увядших ягод на спине
    const wood = this.lam('#6a4a2a'), steel = this.lam('#c8ccd2'), basket = this.lam('#a07a40', pixelTex('#a07a40', 10, 783)), dry = this.lam('#6a2a3a');
    const B = this.box.bind(this);
    const arm = this.rig.arms[1];
    B(arm, wood, 0.06, 0.06, 0.5, 0, -0.62, 0.2);
    B(arm, steel, 0.06, 0.08, 0.5, 0.18, -0.62, 0.48, 0, 1.0, 0);
    B(this.body, basket, 0.44, 0.36, 0.3, 0, 1.2, -0.34);
    for (const x of [-0.1, 0.08]) B(this.body, dry, 0.12, 0.12, 0.12, x, 1.42, -0.34);
    this.place();
  }

  protected choose(dist: number): string | null { return dist < 2.2 ? 'reap' : null; }

  protected act(_name: string, t: number, dt: number): boolean {
    for (const at of [0, 0.4]) {
      if (t >= at && t - dt < at) {
        const c = this.pos.clone().addScaledVector(this.fwd(), 1);
        this.field.markCircle(c, 1.3, 0.3, () => {
          if (this.dead) return;
          if (!this.quiet) hiss({ dur: 0.15, vol: 0.12, f: 3200, f1: 1200, q: 1.4, type: 'bandpass' });
          if (this.inCircle(c, 1.3)) this.hurt(5, this.pos, 2);
        });
      }
    }
    if (t < 0.3) this.face(dt, 0.8);
    return t > 0.9;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 16), r = this.rig;
    stepPose(r, this.stride(13), walk, dt);
    const swing = this.state === 'attack' ? ((this.st % 0.4) < 0.3 ? -2.2 : 0.2) : walk ? -0.5 : -0.3;
    lerpTo(r.arms[1], swing, this.state === 'attack' ? Math.min(1, dt * 30) : k);
    lerpTo(r.arms[0], walk ? -this.stride(13) * 0.5 : 0, k);
    // бежит, пригнувшись
    this.body.rotation.x = walk ? 0.15 : 0;
  }
}

/** 18. Костяной лучник — стрелок: две колючие стрелы по полосе, держит дистанцию; вплотную — беззащитен */
export class BoneArcher extends Mob {
  readonly kind = 'archer';
  readonly title = 'Костяной лучник';
  readonly cost = 3;
  readonly radius = 0.4;
  override readonly topY = 2;
  private readonly rig: Bones;
  private readonly aim = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 30, at);
    this.speed = 2.8;
    this.keep = 8;
    this.aggro = 16;
    this.rig = buildSkeleton(this, this.body, 791);
    // лук из лозы с шипами в левой руке
    const vine = this.lam('#4a7a2a'), thorn = this.lam('#c8245a');
    const B = this.box.bind(this);
    const arm = this.rig.arms[0];
    B(arm, vine, 0.06, 1.1, 0.06, 0, -0.62, 0.12);
    for (const y of [-0.2, -1.04]) B(arm, vine, 0.06, 0.06, 0.2, 0, y, 0.04);
    B(arm, thorn, 0.08, 0.08, 0.08, 0, -0.62, 0.17);
    this.place();
  }

  protected choose(dist: number, rel: number): string | null { return dist < 13 && Math.abs(rel) < 0.3 ? 'shoot' : null; }
  protected override rest(): number { return rand(1.4, 2.2); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const from = this.pos.clone();
      this.aim.copy(this.fwd());
      // две стрелы подряд по одной полосе
      for (const [k, delay] of [[0, 0.6], [1, 0.85]] as const) {
        this.field.markLine(from, this.aim, 12, 0.45, delay, () => {
          if (this.dead) return;
          if (!this.quiet) voice({ type: 'triangle', f: 330 - k * 40, f1: 140, dur: 0.1, vol: 0.05 });
          this.field.shot(from, this.aim, 12, C(3.4, 1.4, 2), 50, 1.35);
          if (this.inLine(from, this.aim, 12, 0.45)) this.hurt(6, from, 2);
        }, k ? C(2.2, 0.35, 0.18) : undefined);
      }
    }
    return t > 1.2;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 12), r = this.rig;
    stepPose(r, this.stride(), walk, dt);
    const draw = this.state === 'attack';
    // лук вперёд, правая рука натягивает тетиву
    lerpTo(r.arms[0], draw ? -1.5 : -0.4, k);
    lerpTo(r.arms[1], draw ? -1.4 + Math.min(1, (this.st % 0.85) / 0.5) * 0.4 : walk ? -this.stride() * 0.4 : 0, k);
    r.arms[1].position.z = draw ? -0.1 : 0;
  }
}

/** 19. Огонёк-плакальщик — охотник: летит сквозь стены прямо к герою, лопается рядом холодной вспышкой; сбить на подлёте */
export class Wisp extends Mob {
  readonly kind = 'wisp';
  readonly title = 'Огонёк-плакальщик';
  readonly cost = 2;
  readonly radius = 0.35;
  override readonly topY = 1.8;
  private readonly flame = new THREE.Group();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 10, at);
    this.speed = 3.4;
    this.turn = 9;
    this.keep = 0.6;
    this.mass = 0.3;
    this.aggro = 12;
    this.ghost = true;
    // язычок пламени: три светящихся куба друг над другом, внутри — личико
    this.flame.position.y = 1.1;
    this.body.add(this.flame);
    const B = this.box.bind(this);
    B(this.flame, this.shimmer(SOUL, C(2.4, 1.2, 3.4), 0, 3), 0.5, 0.45, 0.5, 0, 0, 0);
    B(this.flame, this.shimmer(C(2, 3.2, 3.4), SOUL, 1, 3), 0.32, 0.3, 0.32, 0, 0.36, 0);
    B(this.flame, this.shimmer(C(3, 3.4, 3.4), SOUL, 2, 3), 0.16, 0.2, 0.16, 0.04, 0.6, 0);
    const face = this.lam('#1a2a40');
    for (const x of [-0.1, 0.1]) B(this.flame, face, 0.07, 0.1, 0.02, x, 0.04, 0.255);
    B(this.flame, face, 0.12, 0.04, 0.02, 0, -0.1, 0.255);
    this.place();
  }

  protected choose(dist: number): string | null { return dist < 1.4 ? 'pop' : null; }
  protected override rest(): number { return 0.1; }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const c = this.pos.clone();
      if (!this.quiet) voice({ type: 'sine', f: 880, f1: 1320, dur: 0.4, vol: 0.04, verb: 0.6 });
      this.field.markCircle(c, 1.6, 0.45, () => {
        if (this.dead) return;
        if (!this.quiet) hiss({ dur: 0.4, vol: 0.15, f: 4000, f1: 800, q: 0.7, type: 'bandpass' });
        this.h.fx.burst(c.clone().setY(1), [SOUL, '#ffffff'], 16, { speed: 4, up: 2, size: 0.1, life: 0.5, glow: true, gravity: 0 });
        if (this.inCircle(c, 1.6)) this.hurt(6, c, 3);
        // холодная лужица: недолго замедляет
        this.field.hazard(c, 1.4, 1.5, 0, SOUL, 0.35);
        // лопнул сам — малины нет, его не сбили
        this.summoned = true;
        this.vanish();
      }, SOUL);
    }
    return t > 0.6;
  }

  protected animate(): void {
    const swell = this.state === 'attack' ? 1 + this.st * 0.8 : 1;
    this.flame.position.y = 1.1 + Math.sin(this.time * 3) * 0.12;
    this.flame.scale.setScalar(swell);
    this.flame.rotation.y = this.time * 1.5;
  }
}

/** Ворона пугала: летит над землёй к герою, клюёт; два удара — и нет её */
export class Crow extends Mob {
  readonly kind = 'crow';
  readonly title = 'Ворона';
  readonly cost = 0;
  readonly radius = 0.3;
  override readonly topY = 1.6;
  private readonly wings: THREE.Group[];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 6, at);
    this.speed = 5;
    this.turn = 9;
    this.keep = 0.7;
    this.mass = 0.2;
    this.aggro = 20;
    this.loot = 0;
    const black = this.lam('#2a2830'), beak = this.lam('#e8b84a'), eye = this.shimmer(RASP, C(3.4, 1.6, 2.2), 0, 3);
    const B = this.box.bind(this);
    B(this.body, black, 0.26, 0.24, 0.5, 0, 1.2, 0);
    B(this.body, black, 0.22, 0.22, 0.22, 0, 1.32, 0.3);
    B(this.body, beak, 0.08, 0.06, 0.16, 0, 1.3, 0.48);
    for (const x of [-0.08, 0.08]) B(this.body, eye, 0.04, 0.04, 0.02, x, 1.36, 0.41);
    B(this.body, black, 0.2, 0.04, 0.24, 0, 1.2, -0.34, -0.2);
    this.wings = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.13, 1.28, 0);
      this.body.add(g);
      B(g, black, 0.5, 0.04, 0.3, s * 0.25, 0, 0);
      return g;
    });
    this.place();
  }

  protected choose(dist: number): string | null { return dist < 1.2 ? 'peck' : null; }
  protected override rest(): number { return rand(0.7, 1.1); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const c = this.pos.clone().addScaledVector(this.fwd(), 0.6);
      this.field.markCircle(c, 0.6, 0.3, () => {
        if (this.dead) return;
        if (!this.quiet) voice({ type: 'square', f: 900, f1: 600, dur: 0.06, vol: 0.02, lp: 2600 });
        if (this.inCircle(c, 0.6)) this.hurt(3, this.pos, 1);
      });
    }
    return t > 0.45;
  }

  protected animate(): void {
    const flap = Math.sin(this.time * 22) * 0.7;
    this.wings[0].rotation.z = flap;
    this.wings[1].rotation.z = -flap;
    this.body.position.y = Math.sin(this.time * 4) * 0.08 - (this.state === 'attack' && this.st > 0.2 ? 0.25 : 0);
  }
}

/** 20. Пугало — призыв: каждые 6 с из шляпы вылетают 3 вороны; вплотную оживает и бьёт по кругу */
export class Scarecrow extends Mob {
  readonly kind = 'scarecrow';
  readonly title = 'Пугало';
  readonly cost = 5;
  readonly radius = 0.5;
  override readonly topY = 2.4;
  private readonly hat = new THREE.Group();
  private readonly arms = new THREE.Group();
  private readonly crows: Mob[] = [];
  private crowCd = 1.5;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 60, at);
    this.speed = 0.9;
    this.turn = 2;
    this.keep = 1.6;
    this.mass = 2;
    this.loot = 2;
    this.aggro = 9;
    const straw = this.lam('#e0c060', pixelTex('#e0c060', 14, 801)), sack = this.lam('#c8a070', pixelTex('#c8a070', 8, 802));
    const pole = this.lam('#6a4a2a'), coat = this.lam('#7a2a3a', pixelTex('#7a2a3a', 8, 803)), stitch = this.lam('#3a2414');
    const eye = this.shimmer(C(3.4, 2, 0.6), RASP, 0, 1.4);
    const B = this.box.bind(this);
    // кол, кафтан с малиновой заплатой, соломенные кисти, голова-мешок с шитым ртом, шляпа
    B(this.body, pole, 0.14, 1.2, 0.14, 0, 0.6, 0);
    B(this.body, coat, 0.62, 0.8, 0.36, 0, 1.4, 0);
    B(this.body, this.lam('#c8245a'), 0.16, 0.16, 0.02, 0.14, 1.5, 0.185);
    for (const x of [-0.18, 0.18]) B(this.body, straw, 0.14, 0.24, 0.14, x, 0.92, 0);
    B(this.body, sack, 0.5, 0.48, 0.46, 0, 2.06, 0);
    for (const x of [-0.11, 0.11]) B(this.body, eye, 0.1, 0.1, 0.02, x, 2.12, 0.235);
    B(this.body, stitch, 0.28, 0.04, 0.02, 0, 1.94, 0.235);
    this.arms.position.y = 1.62;
    this.body.add(this.arms);
    B(this.arms, pole, 1.6, 0.1, 0.1, 0, 0, 0);
    B(this.arms, coat, 1.3, 0.24, 0.3, 0, -0.04, 0);
    for (const x of [-0.82, 0.82]) B(this.arms, straw, 0.2, 0.26, 0.2, x, -0.08, 0);
    this.hat.position.y = 2.3;
    this.body.add(this.hat);
    B(this.hat, this.lam('#3a3040'), 0.9, 0.06, 0.9, 0, 0, 0);
    B(this.hat, this.lam('#3a3040'), 0.46, 0.4, 0.46, 0, 0.22, 0);
    B(this.hat, this.lam('#c8245a'), 0.48, 0.08, 0.48, 0, 0.06, 0);
    this.place();
  }

  override update(dt: number): void { this.crowCd -= dt; super.update(dt); }

  protected override die(): void {
    super.die();
    // пугало пало — вороны разлетаются
    for (const c of this.crows) c.vanish();
  }

  protected choose(dist: number): string | null {
    if (dist < 2.6) return 'spin';
    for (let i = this.crows.length - 1; i >= 0; i--) if (this.crows[i].dead) this.crows.splice(i, 1);
    return this.crowCd <= 0 && this.crows.length < 6 ? 'crows' : null;
  }
  protected override rest(): number { return rand(0.8, 1.2); }

  protected act(name: string, t: number, dt: number): boolean {
    if (name === 'spin') {
      if (t - dt <= 0) this.field.markCircle(this.pos.clone(), 2.3, 0.6, () => {
        if (this.dead) return;
        if (!this.quiet) hiss({ dur: 0.4, vol: 0.12, f: 900, f1: 2400, q: 0.8, type: 'bandpass' });
        this.h.fx.burst(this.pos.clone().setY(1.6), ['#e0c060', '#c8a070'], 14, { speed: 4, up: 1, size: 0.1, life: 0.5, gravity: 4 });
        if (this.inCircle(this.pos, 2.3)) this.hurt(8, this.pos, 6);
      });
      return t > 1.1;
    }
    // шляпа подпрыгивает — из неё три вороны
    if (t >= 0.5 && t - dt < 0.5) {
      if (!this.quiet) { for (let i = 0; i < 3; i++) voice({ type: 'sawtooth', f: rand(500, 700), f1: 300, dur: 0.15, vol: 0.03, delay: i * 0.08, lp: 1800 }); }
      for (let i = 0; i < 3; i++) {
        const a = this.yaw + (i - 1) * 0.8;
        const c = this.mh.spawn('crow', this.pos.clone().add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a))));
        if (!c) continue;
        c.summoned = true;
        c.notice();
        this.crows.push(c);
      }
      this.h.fx.burst(this.hat.getWorldPosition(new THREE.Vector3()), ['#2a2830', '#4a4850'], 12, { speed: 3, up: 3, size: 0.1, life: 0.5, gravity: 2 });
      this.crowCd = 6;
    }
    return t > 0.9;
  }

  protected animate(_dt: number, walk: boolean): void {
    // скачет на колу; кружится в ударе; шляпа подпрыгивает, выпуская ворон
    this.body.position.y = walk ? Math.abs(Math.sin(this.time * 6)) * 0.2 : 0;
    const spin = this.state === 'attack' && this.attack === 'spin';
    this.body.rotation.y = spin && this.st > 0.6 ? Math.min(1, (this.st - 0.6) / 0.3) * Math.PI * 2 : 0;
    const pop = this.state === 'attack' && this.attack === 'crows';
    this.hat.position.y = 2.3 + (pop ? Math.max(0, Math.sin(this.st * Math.PI / 0.9)) * 0.5 : 0);
    this.arms.rotation.z = Math.sin(this.time * 2) * 0.06;
  }
}
