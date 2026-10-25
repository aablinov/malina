import * as THREE from 'three';
import { pixelTex } from '../textures';
import { bell, boom, hiss, voice } from '../spell-audio';
import type { Rect } from './arena';
import { C, glowMat, rand, RASP, type BossHooks } from './kit';
import { MiniBoss } from './mini';

/**
 * Морозный кабан — мини-босс (wiki/design-bosses.md, раздел 2): громадный кабан-опустошитель в инее, на спине — ледяные
 * кристаллы, на лбу — сердце-ягода, на макушке — малиновый венец из кубиков-костянок. Атаки: таран по полосе (влетел в стену —
 * оглушён, сердце открыто), удар клыками вблизи, топот — ледяные шипы из-под земли по меткам у героя; кого шип задел, тот
 * вмёрз в глыбу на 1,2 с, на полу остаётся скользкий лёд. В ярости таранит дважды подряд. Роняет «Ледяную гробницу».
 * Подвижных частей: туловище, голова, четыре ноги, хвост.
 */

const ICE = C(1.4, 2.8, 4), FROST = C(2.6, 3.4, 4), PINK = C(4, 1.7, 2.4);
const SHARDS = ['#cfe8ff', '#9fc8e8', '#ffffff', '#7f97a8'];
/** Таран: метка, длина, ширина, скорость; заморозка шипом */
const SCRAPE = 0.8, DASH_LEN = 14, DASH_W = 2.2, DASH_SPEED = 16, FREEZE = 1.2;

const sfx = {
  /** Скребёт копытом: короткие шорохи */
  scrape() { for (let i = 0; i < 3; i++) hiss({ dur: 0.12, vol: 0.12, f: 900, f1: 400, q: 1.2, delay: i * 0.22 }); },
  /** Храп и рёв перед тараном */
  roar() { voice({ type: 'sawtooth', f: 160, f1: 70, dur: 0.6, vol: 0.07, detune: 20, lp: 1400, lp1: 300, verb: 0.4 }); boom(90, 40, 0.4, 0.4); },
  /** Удар о стену: гул и звон расколотого льда */
  crash() {
    boom(60, 22, 1.2, 0.9, 0, 0.5);
    for (const [f, d] of [[1760, 0], [2349, 0.03], [2960, 0.06], [3520, 0.1]] as const) bell(f, 0.8, 0.03, d, 0.6);
  },
  /** Клыки: свист замаха */
  gore() { hiss({ dur: 0.25, vol: 0.18, f: 600, f1: 2200, q: 0.8 }); voice({ type: 'sawtooth', f: 120, f1: 80, dur: 0.25, vol: 0.05, lp: 900 }); },
  /** Топот */
  stomp() { boom(70, 28, 0.7, 0.7, 0, 0.4); },
  /** Шипы прорвались: хруст и звон */
  spike() { hiss({ dur: 0.3, vol: 0.18, f: 3000, f1: 1200, q: 0.7, type: 'highpass' }); bell(rand(1500, 2100), 0.6, 0.03); },
  /** Вмёрз */
  freeze() { bell(2637, 1.2, 0.04, 0, 0.7); bell(3136, 1.2, 0.03, 0.05, 0.7); },
};

export class FrostBoar extends MiniBoss {
  readonly radius = 1.6;
  readonly title = 'Морозный кабан';
  override readonly topY = 2.8;
  readonly drop = 'icetomb';
  private readonly trunk = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly tail = new THREE.Group();
  private readonly emblem = new THREE.Group();
  /** Ледяная глыба вокруг вмёрзшего героя и материал шипов */
  private readonly iceBlock: THREE.Mesh;
  private readonly spikeMat = glowMat(FROST, 0.85);
  private trotT = 0;
  // таран
  private phase: 'scrape' | 'dash' | 'skid' = 'scrape';
  private phaseT = 0;
  private chargesLeft = 0;
  private dashLeft = 0;
  private rammed = false;
  private readonly dashDir = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private hasWant = false;
  // топот и заморозка
  private spikeHit = false;
  private freezeT = 0;
  private readonly freezeAt = new THREE.Vector3();

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 850, home, yaw, arena);
    this.speed = 3.8;
    this.keep = 3;
    this.iceBlock = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 1.3), glowMat(ICE.clone().multiplyScalar(0.5), 0.4));
    this.iceBlock.visible = false;
    h.scene.add(this.iceBlock);
    this.build();
    this.reset();
  }

  protected build(): void {
    const fur = this.lam('#7f97a8', pixelTex('#7f97a8', 10, 501));
    const dark = this.lam('#4a5a6a', pixelTex('#4a5a6a', 8, 502));
    const bone = this.lam('#e8e0c8');
    const hoof = this.lam('#2e3640');
    const gold = this.lam('#e8b84a');
    const eye = glowMat(ICE);
    const heart = this.shimmer(RASP, PINK, 0, 3);
    const B = this.box.bind(this);
    this.body.add(this.trunk);
    // туловище: глыба шерсти, тёмное брюхо, грива-гребень вдоль спины
    B(this.trunk, fur, 2.2, 1.4, 3, 0, 1.35, 0);
    B(this.trunk, dark, 2.0, 0.3, 2.8, 0, 0.6, 0);
    B(this.trunk, dark, 1.0, 0.35, 2.4, 0, 2.2, -0.1);
    B(this.trunk, dark, 2.3, 1.2, 0.5, 0, 1.45, 1.3);
    // ледяные кристаллы на спине — переливаются «лёд ↔ малина»
    for (const [x, z, hgt, rz, rx] of [[0, 0.8, 0.9, 0, 0.2], [-0.45, 0.2, 0.7, 0.35, 0], [0.45, -0.1, 0.75, -0.35, 0], [0, -0.6, 0.6, 0, -0.25], [-0.3, -1.1, 0.45, 0.3, 0]] as const) {
      B(this.trunk, this.shimmer(ICE, RASP, x * 4 + z, 2), 0.28, hgt, 0.28, x, 2.3 + hgt / 2, z, rx, 0.78, rz);
    }
    // голова: лоб, рыло, пятак, клыки, глаза; на лбу — сердце-ягода, на макушке — малиновый венец
    this.head.position.set(0, 1.45, 1.5);
    this.trunk.add(this.head);
    B(this.head, fur, 1.4, 1.1, 1.2, 0, 0.05, 0.5);
    B(this.head, dark, 1.0, 0.6, 0.5, 0, -0.25, 1.3);
    B(this.head, hoof, 0.6, 0.35, 0.08, 0, -0.22, 1.56);
    for (const s of [-1, 1]) {
      B(this.head, bone, 0.18, 0.18, 0.8, s * 0.55, -0.2, 1.4, -0.7, 0, 0);
      B(this.head, bone, 0.14, 0.14, 0.35, s * 0.55, 0.15, 1.75, -1.3, 0, 0);
      B(this.head, eye, 0.18, 0.12, 0.05, s * 0.42, 0.28, 1.11);
      B(this.head, dark, 0.3, 0.4, 0.15, s * 0.6, 0.65, 0.2, 0, 0, s * -0.4);
    }
    this.emblem.position.set(0, 0.32, 1.13);
    this.head.add(this.emblem);
    for (const [x, y, k] of [[0, 0, 0.24], [0.15, 0.13, 0.16], [-0.15, 0.13, 0.16], [0.15, -0.13, 0.16], [-0.15, -0.13, 0.16], [0, 0.24, 0.13], [0, -0.24, 0.13]] as const) B(this.emblem, heart, k, k, 0.1, x, y, 0);
    B(this.head, gold, 0.9, 0.1, 0.7, 0, 0.65, 0.4);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, k = i % 2 ? 0.16 : 0.22;
      B(this.head, this.shimmer(RASP, PINK, i, 2.4), k, k, k, Math.sin(a) * 0.36, 0.78 + (i % 2 ? 0.05 : 0.12), 0.4 + Math.cos(a) * 0.28);
    }
    // ноги: короткие столбы с копытами, качаются на шарнире у брюха
    for (const [x, z] of [[-0.7, 1.0], [0.7, 1.0], [-0.7, -1.0], [0.7, -1.0]]) {
      const g = new THREE.Group();
      g.position.set(x, 0.7, z);
      this.body.add(g);
      B(g, dark, 0.55, 0.6, 0.55, 0, -0.3, 0);
      B(g, hoof, 0.6, 0.18, 0.6, 0, -0.62, 0.02);
      this.legs.push(g);
    }
    // хвостик-крючок
    this.tail.position.set(0, 1.8, -1.5);
    this.trunk.add(this.tail);
    B(this.tail, dark, 0.15, 0.15, 0.5, 0, 0, -0.22, 0.6, 0, 0);
  }

  override reset(): void {
    super.reset();
    this.unfreeze(false);
    this.trunk.rotation.set(0, 0, 0);
  }

  protected override die(): void {
    super.die();
    this.unfreeze(true);
  }

  protected choose(dist: number): string | null {
    if (dist < 3.5) return 'gore';
    return Math.random() < 0.55 ? 'charge' : 'frost';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'charge': {
        if (!this.hitDone) { this.hitDone = true; this.chargesLeft = this.enraged ? 2 : 1; this.startScrape(); }
        this.phaseT += dt;
        if (this.phase === 'scrape') {
          // скребёт копытом: пыль и иней из-под ноги, полоса наливается
          if (Math.random() < 0.4) fx.burst(this.pos.clone().add(this.dashDir.clone().multiplyScalar(1.2)).setY(0.1), ['#9fb4c4', '#e8f4ff'], 2, { speed: 1.5, up: 1.5, size: 0.08, life: 0.4, gravity: 6 });
          if (this.phaseT >= SCRAPE) {
            this.phase = 'dash'; this.phaseT = 0; this.dashLeft = DASH_LEN; this.rammed = false; this.hasWant = false;
            if (!this.quiet) sfx.roar();
          }
          return false;
        }
        if (this.phase === 'dash') {
          // упёрся (стена, колонна) — тело не дошло, куда бежало
          const a = this.arena, R = this.radius;
          const blocked = this.hasWant && Math.hypot(this.pos.x - this.want.x, this.pos.z - this.want.z) > 0.25;
          if (blocked || this.pos.x <= a.x0 + R || this.pos.x >= a.x1 - R || this.pos.z <= a.z0 + R || this.pos.z >= a.z1 - R) return this.crash();
          const step = Math.min(DASH_SPEED * dt, this.dashLeft);
          this.move(this.dashDir, step);
          this.dashLeft -= step;
          this.want.copy(this.pos); this.hasWant = true;
          if (!this.rammed && this.inCircle(this.pos.clone().addScaledVector(this.dashDir, 1.2), 1.5)) {
            this.rammed = true;
            this.hurt(20, this.pos.clone(), 10);
            fx.hitstop = Math.max(fx.hitstop, 0.05);
          }
          if (Math.random() < 0.8) fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0.2, rand(-1, 1))), vel: new THREE.Vector3(0, rand(0.5, 1.5), 0), life: 0.5, size: rand(0.08, 0.15), color: ICE, gravity: -0.5 });
          if (this.dashLeft <= 0) { this.phase = 'skid'; this.phaseT = 0; }
          return false;
        }
        // занос: доскальзывает и тормозит; в ярости — сразу второй таран
        this.move(this.dashDir, Math.max(0, 1 - this.phaseT / 0.45) * 6 * dt);
        if (this.phaseT < 0.45) return false;
        if (--this.chargesLeft > 0) { this.startScrape(); return false; }
        return true;
      }
      case 'gore': {
        // голову вниз — и снизу вверх клыками по конусу перед собой
        if (t < 0.45) { this.face(dt, 1.3); return false; }
        if (!this.hitDone) {
          this.hitDone = true;
          if (!this.quiet) sfx.gore();
          fx.arc(this.pos.clone(), this.yaw, FROST, 3.4, 0.9, 1.1);
          if (this.inCone(this.pos, this.yaw, 3.6, 0.9)) this.hurt(14, this.pos.clone(), 6);
        }
        return t > 0.9;
      }
      case 'frost': {
        // встаёт на дыбы → топот → метки у героя → из-под земли ледяные шипы
        if (t < 0.4) return false;
        if (!this.hitDone) {
          this.hitDone = true;
          this.spikeHit = false;
          if (!this.quiet) sfx.stomp();
          fx.shake = Math.max(fx.shake, 0.5);
          fx.shock(this.pos.clone().setY(0.1), 4, ICE, 0.4, 0.2);
          fx.burst(this.pos.clone().setY(0.2), SHARDS, 14, { speed: 4, up: 3, size: 0.12, life: 0.6, gravity: 10 });
          const n = this.enraged ? 5 : 3;
          for (let i = 0; i < n; i++) {
            const p = this.clampIn(this.heroAt().add(i === 0 ? new THREE.Vector3() : new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3))));
            this.markCircle(p, 1.4, 0.9 + i * 0.08, () => this.spikes(p, 1.4), ICE);
          }
        }
        return t > 1.8;
      }
    }
    return true;
  }

  private startScrape(): void {
    const hero = this.heroAt();
    this.dashDir.set(hero.x - this.pos.x, 0, hero.z - this.pos.z);
    if (this.dashDir.lengthSq() < 1e-4) this.dashDir.copy(this.fwd());
    this.dashDir.normalize();
    this.yaw = Math.atan2(this.dashDir.x, this.dashDir.z);
    this.phase = 'scrape'; this.phaseT = 0;
    this.markLine(this.pos.clone(), this.dashDir, DASH_LEN, DASH_W, SCRAPE, () => undefined);
    if (!this.quiet) sfx.scrape();
  }

  /** Влетел в стену: лёд со спины осыпается, кабан оглушён — сердце открыто */
  private crash(): boolean {
    const fx = this.h.fx, at = this.pos.clone().addScaledVector(this.dashDir, this.radius).setY(1.4);
    if (!this.quiet) sfx.crash();
    fx.shake = Math.max(fx.shake, 1.1);
    fx.hitstop = Math.max(fx.hitstop, 0.08);
    fx.flash(at, FROST, 2.5, 0.2);
    fx.burst(at, SHARDS, 30, { speed: 7, up: 5, size: 0.16, life: 1, gravity: 12 });
    fx.burst(this.pos.clone().setY(2.5), [ICE, RASP], 18, { speed: 4, up: 5, size: 0.1, life: 0.8, glow: true, gravity: 6 });
    fx.shock(this.pos.clone().setY(0.1), 3, ICE, 0.4, 0.2);
    fx.text(this.pos.clone().setY(this.topY + 0.8), 'оглушён!', 'crit');
    this.daze(2);
    return true;
  }

  /** Шипы из-под земли: кто в круге — урон и вмерзает; на полу — скользкий лёд */
  private spikes(p: THREE.Vector3, r: number): void {
    const fx = this.h.fx;
    if (this.dead) return;
    if (!this.quiet) sfx.spike();
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2), d = i === 0 ? 0 : rand(0.3, r * 0.85), hgt = rand(1.2, 2.2);
      this.box(g, this.spikeMat, rand(0.25, 0.4), hgt, rand(0.25, 0.4), Math.cos(a) * d, hgt / 2, Math.sin(a) * d, rand(-0.3, 0.3), rand(0, 1.5), rand(-0.3, 0.3));
    }
    g.scale.y = 0.01;
    // материал общий, геометрия UNIT — ничего не освобождаем
    fx.custom(g, 1.1, (k) => { g.scale.y = Math.max(0.01, k < 0.12 ? k / 0.12 : k > 0.7 ? (1 - k) / 0.3 : 1); }, () => undefined);
    fx.burst(p.clone().setY(0.5), SHARDS, 12, { speed: 3, up: 5, size: 0.12, life: 0.7, gravity: 12 });
    fx.shock(p.clone().setY(0.06), r, ICE, 0.3, 0.12);
    this.hazard(p, r * 1.15, 4, 0, ICE, 0.35);
    if (!this.spikeHit && this.inCircle(p, r)) {
      this.spikeHit = true;
      this.hurt(12, p, 0);
      this.freeze();
    }
  }

  private freeze(): void {
    this.freezeT = FREEZE;
    this.freezeAt.copy(this.h.hero.pos);
    this.iceBlock.visible = true;
    if (!this.quiet) sfx.freeze();
    this.h.fx.text(this.freezeAt.clone().setY(2.6), 'вмёрз!', '');
  }

  private unfreeze(shatter: boolean): void {
    if (shatter && this.freezeT > 0) this.h.fx.burst(this.freezeAt.clone().setY(1), SHARDS, 20, { speed: 4, up: 4, size: 0.14, life: 0.8, gravity: 12 });
    this.freezeT = 0;
    this.iceBlock.visible = false;
  }

  override update(dt: number): void {
    super.update(dt);
    if (this.freezeT <= 0) return;
    // вмёрзший герой стоит, где застал шип
    this.freezeT -= dt;
    const hero = this.h.hero;
    hero.pos.copy(this.freezeAt);
    hero.vel.set(0, 0, 0);
    this.iceBlock.position.set(this.freezeAt.x, this.freezeAt.y + 1, this.freezeAt.z);
    this.iceBlock.rotation.y = 0.3;
    if (this.freezeT <= 0) this.unfreeze(true);
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, atk = this.state === 'attack' ? this.attack : '';
    const dash = atk === 'charge' && this.phase === 'dash';
    // рысь: диагональные пары ног вперёд-назад; на таране — галоп
    let swing = 0;
    if (walk || dash) {
      this.trotT += dt * (dash ? 16 : this.speed * this.speedK * 2.4);
      swing = Math.sin(this.trotT) * (dash ? 0.9 : 0.6);
    }
    this.legs.forEach((g, i) => { g.rotation.x = (i === 0 || i === 3 ? 1 : -1) * swing; });
    let lean = 0, bob = walk || dash ? Math.abs(Math.sin(this.trotT)) * (dash ? 0.18 : 0.08) : 0;
    let headX = Math.sin(t * 1.8) * 0.05, headY = 0, sx = 1, sy = 1;
    if (this.state === 'sleep') { lean = 0.08; headX = 0.35; sy = 1 + Math.sin(t * 1.5) * 0.03; }
    if (atk === 'charge') {
      if (this.phase === 'scrape') {
        // роет копытом, голову к земле, приседает на задние
        this.legs[0].rotation.x = Math.sin(this.phaseT * 16) * 0.8;
        lean = -0.08; headX = 0.4; sy = 0.94; sx = 1.04;
      } else if (dash) { lean = 0.14; headX = 0.45; }
      else { lean = -0.12; headX = 0.2; this.legs.forEach((g, i) => { g.rotation.x = i < 2 ? -0.5 : 0.3; }); }
    }
    if (atk === 'gore') {
      if (S < 0.45) { headX = 0.55 * (S / 0.45); lean = 0.05; }
      else { const k = Math.min(1, (S - 0.45) / 0.15); headX = 0.55 - k * 1.2; headY = Math.sin(k * Math.PI) * 0.4; lean = -0.1 * k; }
    }
    if (atk === 'frost') {
      // на дыбы — и всем весом вниз
      if (S < 0.4) { lean = -0.4 * (S / 0.4); headX = -0.3; this.legs[0].rotation.x = this.legs[1].rotation.x = -0.9 * (S / 0.4); }
      else { const k = Math.min(1, (S - 0.4) / 0.25); lean = 0; sy = 0.85 + 0.15 * k; sx = 1.1 - 0.1 * k; headX = 0.3 * (1 - k); }
    }
    if (this.state === 'daze') {
      // шатается, голова повисла, сердце бьётся крупно
      lean = 0.1; headX = 0.5; this.trunk.rotation.z = Math.sin(t * 5) * 0.12;
    } else this.trunk.rotation.z *= 0.85;
    if (this.state !== 'dead') {
      this.body.rotation.x += (lean - this.body.rotation.x) * Math.min(1, dt * 14);
      this.body.position.y = bob;
      this.body.scale.lerp(new THREE.Vector3(sx, sy, sx), 0.3);
    }
    this.head.rotation.x += (headX - this.head.rotation.x) * Math.min(1, dt * 16);
    this.head.rotation.y = headY;
    this.tail.rotation.y = Math.sin(t * (walk ? 14 : 6)) * 0.45;
    // иней с кристаллов
    if (this.state !== 'dead' && this.state !== 'sleep' && Math.random() < 0.15) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.6, 0.6), 2.6 + bob, rand(-1, 1))), vel: new THREE.Vector3(0, rand(0.3, 0.8), 0), life: 0.6, size: rand(0.06, 0.12), color: Math.random() < 0.7 ? ICE : RASP, gravity: -0.3 });
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.emblem.scale.setScalar(beat * (this.heartOpen ? 1.6 : 1));
  }
}
