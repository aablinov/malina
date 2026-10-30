import * as THREE from 'three';
import { pixelTex } from '../textures';
import { boom, hiss, voice } from '../spell-audio';
import { C, rand, RASP } from '../bosses/kit';
import { Mob, type MobHooks } from './mob';

/**
 * Враги обороны куста (wiki/design-tower-defence.md, раздел 5): рождены под дороги и башни, героя почти не замечают.
 * Гонец — быстрый и хрупкий, проскакивает мимо медленных башен; таран — кора спереди гасит урон, катапульта и обелиск
 * с тыла или цепью; мотылёк — летит над заборами и препятствиями напрямик, слаб к инею.
 */

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };

/** 32. Ягодный гонец — бегун: ягода с мешком на длинных ножках, 5,5 м/с, 14 здоровья; у куста щиплет понемногу */
export class BerryRunner extends Mob {
  readonly kind = 'runner';
  readonly title = 'Ягодный гонец';
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
    // мешок за спиной — крадёт малину с куста
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

/** 33. Лозовый таран — тяжёлый: кабан из брёвен и лозы с корой-щитом на лбу; спереди урон ×0,35, 160 здоровья, 1,6 м/с */
export class VineRam extends Mob {
  readonly kind = 'ram';
  readonly title = 'Лозовый таран';
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
    // тело — связка брёвен, обвитая лозой
    B(this.body, log, 0.9, 0.8, 1.5, 0, 0.9, 0);
    B(this.body, log, 0.7, 0.3, 1.5, 0, 1.4, 0);
    for (const z of [-0.5, -0.1, 0.3]) B(this.body, vine, 0.96, 0.1, 0.12, 0, 1.0 + (z + 0.5) * 0.3, z);
    for (const z of [-0.4, 0.2]) B(this.body, vine, 0.12, 0.86, 0.12, 0.44, 0.9, z);
    B(this.body, moss, 0.5, 0.1, 0.9, 0.1, 1.58, -0.2);
    for (let i = 0; i < 4; i++) B(this.body, berry, 0.14, 0.14, 0.14, Math.sin(i * 1.9) * 0.4, 1.3 + (i % 2) * 0.3, -0.5 + i * 0.3);
    // голова — пень с корой-щитом вперёд и двумя корнями-бивнями
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

  /** Кора на лбу: удар навстречу взгляду гасится */
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
    // замах назад — и удар головой вниз
    const butt = this.state === 'attack' ? (this.st < 0.7 ? 0.5 * Math.min(1, this.st / 0.5) : -0.5) : 0;
    lerpTo(this.head, butt, this.state === 'attack' && this.st > 0.7 ? 1 : k);
    this.body.rotation.z = walk ? s * 0.05 : 0;
  }
}

/** 34. Пыльцевой мотылёк — летун: крылья с малиновыми глазками, летит напрямик над заборами и ямами; 22 здоровья; пыльца у куста */
export class PollenMoth extends Mob {
  readonly kind = 'moth';
  readonly title = 'Пыльцевой мотылёк';
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
    // парит на высоте, покачиваясь; в оглушении падает ниже
    this.flyY = (this.state === 'daze' ? 0.5 : 1.3) + Math.sin(this.time * 3) * 0.15;
    this.body.rotation.x = walk ? 0.2 : 0;
    this.body.rotation.z = Math.sin(this.time * 1.7) * 0.1;
  }
}
