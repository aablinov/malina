import * as THREE from 'three';
import { pixelTex } from '../textures.ts';
import { bell, boom, deg, hiss, pluck, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, wrap, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';

/**
 * Золотой страж — мини-босс (wiki/design-bosses.md, раздел 2): всадник Ордена в золотых латах на бело-золотом коне под
 * малиновой попоной, в руке алебарда, на левой руке круглый щит, заросший малиновой лозой. Атаки: таран по полосе через
 * всю арену (врезался в стену — конь спотыкается, оглушён, герб-ягода на груди коня открыт); круговой взмах алебардой;
 * «фаланга» — веер из семи призрачных мечей, летят по одному, каждый со своей нотой пентатоники — вместе аккорд.
 * Щит: удар спереди (±60°) — урон ×0,3. Роняет «Фалангу клинков».
 * Подвижных частей: конь, голова коня, передняя пара ног, задняя пара ног, всадник, алебарда, герб (+ семь мечей отдельно).
 */

const GOLD = C(4, 3, 1), SPECTRAL = C(2.6, 3, 4), DUST = ['#c8b890', '#9a8f70'];
/** Корень аккорда мечей: соль первой октавы */
const ROOT = 392;
const LANCE_LEN = 16, LANCE_W = 2.4, LANCE_SPEED = 15;
const BLADES = 7, BLADE_GAP = 0.18, BLADE_FLY = 0.45, BLADE_R = 1.1;

const sfx = {
  /** Копыта: два глухих удара */
  hoof() { boom(95, 45, 0.16, 0.22); boom(80, 40, 0.14, 0.18, 0.07); },
  /** Ржание: пила с вибрато вниз */
  neigh() {
    for (let i = 0; i < 4; i++) voice({ type: 'sawtooth', f: 620 - i * 60, f1: 480 - i * 70, dur: 0.16, vol: 0.035, delay: i * 0.12, detune: 25, lp: 2400, verb: 0.4 });
    hiss({ dur: 0.6, vol: 0.08, f: 2400, f1: 900, q: 0.8, verb: 0.3 });
  },
  /** Щит: металлический звон, обертоны не кратные */
  clink() { for (const [f, d] of [[1240, 0], [1870, 0.005], [2630, 0.01]] as const) voice({ type: 'triangle', f, dur: 0.35, vol: 0.035, delay: d, verb: 0.35 }); hiss({ dur: 0.08, vol: 0.12, f: 5000, q: 1.2 }); },
  /** Взмах алебарды: свист */
  swing() { hiss({ dur: 0.45, vol: 0.25, f: 600, f1: 2600, q: 1.4 }); },
  /** Таран пошёл: рог и топот */
  charge() { voice({ type: 'sawtooth', f: 196, f1: 262, dur: 0.6, vol: 0.05, lp: 1400, verb: 0.5 }); boom(70, 35, 0.5, 0.5); },
  /** Врезался в стену */
  crash() { boom(65, 22, 1, 0.9, 0, 0.5); hiss({ dur: 0.7, vol: 0.25, f: 1800, f1: 200, q: 0.5, type: 'lowpass' }); this.clink(); },
  /** Меч сорвался: своя ступень пентатоники, колокольчики складываются в аккорд */
  note(i: number) { bell(deg(ROOT, i), 1.6, 0.05, 0, 0.6); pluck(deg(ROOT / 2, i), 0.04); },
  /** Меч вонзился */
  stab() { boom(160, 70, 0.18, 0.2); hiss({ dur: 0.15, vol: 0.1, f: 3000, f1: 800, q: 0.9 }); },
};

/** Призрачный меч фаланги: висит в веере → летит по прямой в метку */
interface Blade { g: THREE.Group; phase: 'off' | 'hover' | 'fly'; t: number; from: THREE.Vector3; to: THREE.Vector3 }

export class GoldenRider extends MiniBoss {
  readonly radius = 1.6;
  readonly title = 'Золотой страж';
  override readonly topY = 3.9;
  readonly drop = 'bladephalanx';
  private readonly horse = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legsF = new THREE.Group();
  private readonly legsB = new THREE.Group();
  private readonly rider = new THREE.Group();
  private readonly halberd = new THREE.Group();
  private readonly emblem = new THREE.Group();
  private readonly blades: Blade[] = [];
  private gait = 0;
  private readonly lanceDir = new THREE.Vector3();
  private lanceRun = 0;
  private lanceHit = false;

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 900, home, yaw, arena);
    this.speed = 4.5;
    this.keep = 3;
    this.turn = 2.6;
    this.build();
    this.reset();
  }

  protected build(): void {
    const coat = this.lam('#d9d2c0', pixelTex('#d9d2c0', 6, 431));
    const gold = this.lam('#e8b84a', pixelTex('#e8b84a', 8, 432));
    const cloth = this.lam('#a8143e', pixelTex('#a8143e', 8, 433));
    const dark = this.lam('#4a3a2e');
    const wood = this.lam('#7a5232');
    const steel = this.lam('#c9c6cf');
    const vine = this.lam('#3f7a34');
    const berry = this.shimmer(RASP, C(4, 1.7, 2.4), 1, 3);
    const heart = this.shimmer(GOLD, RASP, 0, 3);
    const glow = this.shimmer(GOLD, RASP, 2, 2);
    const B = this.box.bind(this);
    this.body.add(this.horse);
    // конь: корпус, латы на крупе и груди, малиновая попона по бокам, хвост
    B(this.horse, coat, 1.3, 1.1, 2.6, 0, 1.75, 0);
    B(this.horse, gold, 1.36, 0.5, 0.7, 0, 1.95, 1.0);
    B(this.horse, gold, 1.36, 0.45, 0.8, 0, 2.05, -0.95);
    for (const s of [-1, 1]) {
      B(this.horse, cloth, 0.08, 0.9, 2.2, s * 0.7, 1.55, 0);
      B(this.horse, gold, 0.1, 0.12, 2.2, s * 0.71, 1.12, 0);
    }
    B(this.horse, dark, 0.25, 0.9, 0.25, 0, 1.5, -1.4, -0.4);
    // герб Ордена на груди коня — ягода из кубиков: сердце, по нему ×2, когда конь споткнулся
    this.emblem.position.set(0, 1.6, 1.34);
    this.horse.add(this.emblem);
    for (const [x, y, k] of [[0, 0, 0.32], [0.21, 0.18, 0.22], [-0.21, 0.18, 0.22], [0.21, -0.18, 0.22], [-0.21, -0.18, 0.22], [0, 0.34, 0.18], [0, -0.34, 0.18]] as const) B(this.emblem, heart, k, k, 0.12, x, y, 0);
    B(this.emblem, gold, 0.14, 0.2, 0.1, 0, 0.54, 0);
    // голова: шея, морда в золотом налобнике, грива, глаза
    this.head.position.set(0, 2.1, 1.2);
    this.horse.add(this.head);
    B(this.head, coat, 0.6, 1.0, 0.6, 0, 0.45, 0.15, 0.45);
    B(this.head, coat, 0.55, 0.5, 1.0, 0, 0.95, 0.6);
    B(this.head, gold, 0.6, 0.2, 0.7, 0, 1.22, 0.55);
    B(this.head, gold, 0.12, 0.35, 0.12, 0, 1.45, 0.4);
    B(this.head, cloth, 0.16, 0.9, 0.3, 0, 0.75, -0.1, 0.45);
    for (const s of [-1, 1]) B(this.head, glowMat(GOLD), 0.06, 0.08, 0.12, s * 0.28, 1.02, 0.75);
    // ноги парами: каждая пара — одна часть, качается в галопе
    for (const [g, z] of [[this.legsF, 0.95], [this.legsB, -0.95]] as const) {
      g.position.set(0, 1.3, z);
      this.horse.add(g);
      for (const s of [-1, 1]) { B(g, coat, 0.32, 1.15, 0.32, s * 0.38, -0.6, 0); B(g, gold, 0.36, 0.2, 0.36, s * 0.38, -1.15, 0); }
    }
    // всадник: латы, шлем с плюмажем, на левой руке (+x) — щит с лозой и ягодами
    this.rider.position.set(0, 2.3, -0.15);
    this.body.add(this.rider);
    B(this.rider, gold, 0.8, 0.9, 0.55, 0, 0.55, 0);
    B(this.rider, cloth, 0.84, 0.2, 0.58, 0, 0.15, 0);
    B(this.rider, gold, 0.56, 0.55, 0.55, 0, 1.3, 0);
    B(this.rider, dark, 0.42, 0.08, 0.05, 0, 1.3, 0.28);
    B(this.rider, glowMat(GOLD), 0.3, 0.04, 0.03, 0, 1.3, 0.31);
    B(this.rider, cloth, 0.14, 0.45, 0.7, 0, 1.72, -0.1);
    for (const s of [-1, 1]) B(this.rider, gold, 0.3, 0.3, 0.4, s * 0.52, 0.95, 0);
    const shield = new THREE.Group();
    shield.position.set(0.62, 0.6, 0.15);
    this.rider.add(shield);
    B(shield, gold, 0.12, 0.95, 0.95, 0, 0, 0, Math.PI / 4);
    B(shield, gold, 0.14, 1.0, 0.7, 0);
    B(shield, glow, 0.16, 0.24, 0.24, 0.02, 0, 0);
    for (const [y, z] of [[0.35, -0.3], [0.1, 0.38], [-0.3, -0.15], [-0.4, 0.3]] as const) { B(shield, vine, 0.18, 0.12, 0.42, 0.04, y, z, 0.6); B(shield, berry, 0.14, 0.14, 0.14, 0.1, y + 0.08, z); }
    // алебарда: опора у центра всадника, древко справа (−x); порядок YXZ — наклон, потом вращение
    this.halberd.position.set(0, 0.7, 0);
    this.halberd.rotation.order = 'YXZ';
    this.rider.add(this.halberd);
    B(this.halberd, wood, 0.12, 3.0, 0.12, -0.7, 0.6, 0);
    B(this.halberd, steel, 0.08, 0.55, 0.7, -0.7, 1.75, 0.3);
    B(this.halberd, steel, 0.08, 0.5, 0.08, -0.7, 2.3, 0);
    B(this.halberd, glow, 0.1, 0.1, 0.5, -0.7, 1.75, 0.3);
    // семь призрачных мечей — в сцене, спрятаны до «фаланги»
    for (let i = 0; i < BLADES; i++) {
      const g = new THREE.Group();
      const m = this.shimmer(SPECTRAL, i % 2 ? GOLD : RASP, i * 0.6, 4);
      B(g, m, 0.1, 1.3, 0.04, 0, 0.65, 0);
      B(g, m, 0.42, 0.07, 0.07, 0, 0, 0);
      B(g, m, 0.07, 0.3, 0.07, 0, -0.18, 0);
      g.visible = false;
      this.h.scene.add(g);
      this.blades.push({ g, phase: 'off', t: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
  }

  override reset(): void { super.reset(); this.hideBlades(); }
  protected override die(): void { this.hideBlades(); super.die(); }
  protected override cry(): void { if (!this.quiet) { sfx.neigh(); boom(70, 30, 0.8, 0.4, 0.1, 0.5); } }

  /**
   * Щит: удар, пока герой спереди (±60°), — урон ×0,3. Только удары с толчком (меч, стрелы, заклинания); зоны и служебный
   * урон без толчка щит не ловит. Оглушённый страж щит опустил.
   */
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.awake && !this.dead && this.state !== 'daze' && knock > 0) {
      const hero = this.h.hero.pos;
      if (Math.abs(wrap(Math.atan2(hero.x - this.pos.x, hero.z - this.pos.z) - this.yaw)) < Math.PI / 3) {
        dmg *= 0.3;
        const at = this.pos.clone().addScaledVector(this.fwd(), 0.9).setY(this.topY - 1);
        this.h.fx.text(at.clone().setY(at.y + 0.6), 'щит', '');
        this.h.fx.burst(at, [GOLD, '#fff2c0'], 8, { speed: 4, up: 2, size: 0.07, life: 0.3, glow: true, gravity: 8 });
        if (!this.quiet) sfx.clink();
      }
    }
    super.hit(dmg, dir, point, knock);
  }

  protected choose(dist: number): string | null {
    if (dist < 4) return 'sweep';
    if (dist > 6 && Math.random() < 0.55) return 'lance';
    return Math.random() < 0.5 ? 'blades' : 'lance';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'lance': {
        // встал на дыбы, полоса через арену → галоп насквозь; упёрся в стену — споткнулся, оглушён
        const AIM = 0.7;
        if (!this.hitDone) {
          this.hitDone = true;
          const to = this.heroAt().sub(this.pos.clone().setY(0));
          this.lanceDir.copy(to.lengthSq() > 1e-4 ? to.normalize() : this.fwd());
          this.yaw = Math.atan2(this.lanceDir.x, this.lanceDir.z);
          this.lanceRun = 0; this.lanceHit = false;
          this.markLine(this.pos, this.lanceDir, LANCE_LEN, LANCE_W, AIM, () => undefined);
          if (!this.quiet) sfx.neigh();
        }
        if (t < AIM) return false;
        if (t - dt < AIM && !this.quiet) sfx.charge();
        const step = LANCE_SPEED * this.speedK * dt, a = this.arena, R = this.radius + 0.15;
        const nx = this.pos.x + this.lanceDir.x * step, nz = this.pos.z + this.lanceDir.z * step;
        const wall = nx < a.x0 + R || nx > a.x1 - R || nz < a.z0 + R || nz > a.z1 - R;
        if (!wall) { this.move(this.lanceDir, step); this.lanceRun += step; }
        // копьё и грудь коня: полоса перед стражем
        if (!this.lanceHit && this.inLine(this.pos.clone().addScaledVector(this.lanceDir, -this.radius), this.lanceDir, this.radius * 2 + 1.6, LANCE_W)) {
          this.lanceHit = true;
          this.hurt(20, this.pos, 10);
          fx.hitstop = Math.max(fx.hitstop, 0.05);
        }
        if (Math.random() < 0.6) fx.burst(this.pos.clone().setY(0.15), DUST, 2, { speed: 1.5, up: 1, size: 0.12, life: 0.5, gravity: 5 });
        if (wall && this.lanceRun < LANCE_LEN - 0.5) {
          if (!this.quiet) sfx.crash();
          fx.shake = Math.max(fx.shake, 0.9);
          fx.shock(this.pos.clone().addScaledVector(this.lanceDir, this.radius).setY(0.1), 2.5, GOLD, 0.4, 0.2);
          fx.burst(this.pos.clone().addScaledVector(this.lanceDir, this.radius).setY(1.5), [...DUST, GOLD], 20, { speed: 5, up: 4, size: 0.14, life: 0.8, gravity: 10 });
          this.daze(2);
          return true;
        }
        if (wall || this.lanceRun >= LANCE_LEN) return true;
        return false;
      }
      case 'sweep': {
        // алебарда в сторону — круг; на исходе полный оборот
        if (!this.hitDone) { this.hitDone = true; this.markCircle(this.pos, 3.5, 0.6, () => undefined); }
        if (t >= 0.6 && t - dt < 0.6) {
          if (!this.quiet) sfx.swing();
          for (let i = 0; i < 4; i++) fx.arc(this.pos, this.yaw + i * Math.PI / 2, GOLD, 3.4, 1.6, 2.2);
          fx.shock(this.pos.clone().setY(0.1), 3.6, GOLD, 0.35, 0.18);
          if (this.inCircle(this.pos, 3.5)) this.hurt(16, this.pos, 7);
        }
        return t > 1.05;
      }
      case 'blades': {
        // веер мечей над всадником; по одному срываются в героя, у каждого своя нота
        if (!this.hitDone) {
          this.hitDone = true;
          for (const b of this.blades) { b.phase = 'hover'; b.t = 0; b.g.visible = true; }
          if (!this.quiet) bell(deg(ROOT, -5), 1.2, 0.04);
        }
        const gap = BLADE_GAP / this.speedK;
        for (let i = 0; i < BLADES; i++) {
          const at = 0.6 + i * gap, b = this.blades[i];
          if (t >= at && t - dt < at && b.phase === 'hover') {
            b.phase = 'fly'; b.t = 0;
            b.from.copy(b.g.position);
            b.to.copy(this.clampIn(this.heroAt().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(i === 0 ? 0 : 0.9)), 0.8));
            this.markCircle(b.to, BLADE_R, BLADE_FLY, () => undefined);
            if (!this.quiet) sfx.note(i);
          }
        }
        return t > 0.6 + BLADES * gap + 0.2;
      }
    }
    return true;
  }

  private hideBlades(): void { for (const b of this.blades) { b.phase = 'off'; b.g.visible = false; } }

  /** Мечи: висят веером над всадником, летят по прямой, вонзаются */
  private tickBlades(dt: number): void {
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const center = this.pos.clone().setY(this.flyY + this.body.position.y + 4.4).addScaledVector(this.fwd(), -0.3);
    this.blades.forEach((b, i) => {
      if (b.phase === 'off') return;
      b.t += dt;
      if (b.phase === 'hover') {
        const a = ((i - (BLADES - 1) / 2) / ((BLADES - 1) / 2)) * 1.05;
        const dir = side.clone().multiplyScalar(Math.sin(a)).addScaledVector(up, Math.cos(a));
        b.g.position.copy(center).addScaledVector(dir, 1.3).addScaledVector(up, Math.sin(this.time * 4 + i) * 0.06);
        b.g.quaternion.setFromUnitVectors(up, dir);
        b.g.scale.setScalar(Math.min(1, b.t / 0.35));
        return;
      }
      const k = Math.min(1, b.t / BLADE_FLY);
      const d = b.to.clone().setY(0.2).sub(b.from).normalize();
      b.g.position.lerpVectors(b.from, b.to.clone().setY(0.2), k);
      b.g.quaternion.setFromUnitVectors(up, d.negate());
      if (Math.random() < 0.8) this.h.fx.particle({ pos: b.g.position.clone(), vel: new THREE.Vector3(0, 0.3, 0), life: 0.3, size: 0.08, color: i % 2 ? GOLD : RASP, gravity: 0 });
      if (k >= 1) {
        b.phase = 'off'; b.g.visible = false;
        if (!this.quiet) sfx.stab();
        this.h.fx.burst(b.to.clone().setY(0.3), [SPECTRAL, GOLD, RASP], 10, { speed: 3, up: 3, size: 0.08, life: 0.5, glow: true, gravity: 6 });
        this.h.fx.shock(b.to.clone().setY(0.06), BLADE_R, SPECTRAL, 0.25, 0.1);
        if (this.state !== 'dead' && this.inCircle(b.to, BLADE_R)) this.hurt(10, b.to, 3);
      }
    });
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st;
    const charging = this.state === 'attack' && this.attack === 'lance' && S >= 0.7;
    const rearing = this.state === 'attack' && this.attack === 'lance' && S < 0.7;
    // галоп: ноги парами вразнобой, корпус качается, голова кивает, на каждом такте — топот и пыль
    if (walk || charging) {
      const was = this.gait % 1;
      this.gait += dt * (charging ? 3.2 : 2.1) * this.speedK;
      const k = this.gait % 1, ph = k * Math.PI * 2;
      this.legsF.rotation.x = Math.sin(ph) * 0.7;
      this.legsB.rotation.x = -Math.sin(ph + 0.6) * 0.7;
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.18;
      this.horse.rotation.x = Math.sin(ph) * 0.06;
      this.head.rotation.x = Math.sin(ph + 1) * 0.18;
      if (k < was) {
        if (!this.quiet) sfx.hoof();
        this.h.fx.burst(this.pos.clone().setY(0.1), DUST, 4, { speed: 1.2, up: 0.8, size: 0.1, life: 0.45, gravity: 6 });
      }
    } else if (this.state !== 'dead') {
      this.legsF.rotation.x *= 0.85; this.legsB.rotation.x *= 0.85;
      this.body.position.y *= 0.85;
      this.horse.rotation.x *= 0.85;
      this.head.rotation.x = Math.sin(t * 1.5) * 0.06;
    }
    // на дыбы перед тараном: корпус назад, передние ноги вперёд
    if (rearing) { const k = Math.sin(Math.min(1, S / 0.7) * Math.PI); this.horse.rotation.x = -0.45 * k; this.legsF.rotation.x = -0.9 * k; this.body.position.y = 0.4 * k; }
    // алебарда: в покое — вверх; таран — наперевес; взмах — вбок и полный оборот
    const hb = this.halberd.rotation;
    if (this.state === 'attack' && this.attack === 'lance') hb.set(Math.min(1, S / 0.6) * 1.35, 0, 0);
    else if (this.state === 'attack' && this.attack === 'sweep') {
      const wind = Math.min(1, S / 0.5), spin = S < 0.6 ? -0.5 * wind : -0.5 + Math.min(1, (S - 0.6) / 0.3) * Math.PI * 2;
      hb.set(0, spin, 1.35 * wind);
    } else if (this.state === 'attack' && this.attack === 'blades') hb.set(-0.3, 0, -0.25);
    else { hb.x *= 0.85; hb.y = wrap(hb.y) * 0.85; hb.z *= 0.85; }
    // всадник: качается в седле, при «фаланге» поднимает голову
    this.rider.rotation.x = this.state === 'attack' && this.attack === 'blades' ? -0.15 : -this.horse.rotation.x * 0.5;
    this.rider.position.y = 2.3 + (this.state === 'sleep' ? 0 : Math.sin(t * 2) * 0.03);
    // оглушён: конь припал на передние ноги, всадник обмяк, герб бьётся крупно
    if (this.state === 'daze') { this.horse.rotation.x = 0.22; this.legsF.rotation.x = 0.5; this.head.rotation.x = 0.4; this.rider.rotation.x = 0.35; }
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.emblem.scale.setScalar(beat * (this.heartOpen ? 1.4 : 1));
    this.tickBlades(dt);
  }
}
