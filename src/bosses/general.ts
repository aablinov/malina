import * as THREE from 'three';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';

/**
 * Генерал Рдян — легендарный босс этажа (wiki/design-bosses.md, разделы 1–4): огромный рыцарь Ордена в ржаво-алых латах,
 * заросших малиновой лозой с горящими ягодами, верхом на смешно крошечной лошадке (ноги мелькают в беге). Два изогнутых
 * меча, красный плащ-грива, на шлеме малиновая корона, на нагруднике — сердце-ягода. Гравитация: свет переливается
 * фиолетовым ↔ малиной. Атаки: «притяжение» (кольцо тянет героя, потом удар двумя мечами), два широких взмаха, прыжок через
 * арену (каждый второй — застрял, оглушён), веер терновых стрел; в ярости — фиолетовая аура, тернии кругом и «метеор»:
 * улетает ввысь, тень гонится за героем, падает, застревает в кратере (оглушён). Роняет «Гравитационный колодец» или
 * ауру «Терновый венец». Подвижных частей: лошадка, передние ноги, задние ноги, рыцарь, две руки с мечами, плащ, сердце.
 */

const GRAV = C(2.6, 1, 4), THORN = C(1.2, 3, 0.6), METEOR = C(3.6, 0.8, 2.6), EMBER = C(4, 1.4, 0.4);
const DUST = ['#9a8f70', '#6b5a4a', '#5a5a5a'];
const PULL_R = 9, PULL_T = 1.2, PULL_SPEED = 3, SLAM_R = 3.5, SLAM_AIM = 0.5;
const LEAP_R = 4, LEAP_CROUCH = 0.4, LEAP_AIR = 1.1;
const ARROW_LEN = 16, ARROW_W = 1, ARROW_AIM = 0.9;
const MET_R = 5, MET_RISE = 0.6, MET_CHASE = 1.8, MET_LOCK = 0.7, MET_FALL = 0.3, MET_H = 18;

const sfx = {
  /** Копытца: частая мелкая дробь — лошадка крошечная */
  hoof() { boom(180, 90, 0.08, 0.12); boom(160, 80, 0.07, 0.1, 0.05); },
  /** Гравитация: низкий гул, уходящий вниз, и свист воздуха */
  grav() { voice({ type: 'sawtooth', f: 90, f1: 45, dur: 1.2, vol: 0.06, lp: 600, lp1: 200, verb: 0.6 }); hiss({ dur: 1.2, vol: 0.18, f: 300, f1: 1400, q: 0.6, attack: 0.3, verb: 0.5 }); },
  /** Взмах мечом */
  swing() { hiss({ dur: 0.4, vol: 0.28, f: 500, f1: 2400, q: 1.3 }); },
  /** Удар о землю */
  slam() { boom(60, 22, 1.1, 0.9, 0, 0.5); hiss({ dur: 0.6, vol: 0.22, f: 1600, f1: 200, q: 0.5, type: 'lowpass' }); },
  /** Терновые стрелы сорвались */
  arrows() { for (let i = 0; i < 5; i++) hiss({ dur: 0.2, vol: 0.1, f: 2600, f1: 900, q: 1.2, delay: i * 0.03 }); },
  /** Метеор: нарастающий вой сверху */
  fall() { voice({ type: 'sawtooth', f: 900, f1: 120, dur: 0.9, vol: 0.05, lp: 2500, lp1: 400, verb: 0.5 }); hiss({ dur: 0.9, vol: 0.25, f: 3000, f1: 300, q: 0.5, type: 'lowpass' }); },
};

export class GeneralRdyan extends MiniBoss {
  readonly radius = 2;
  readonly title = 'Генерал Рдян';
  override readonly subtitle = 'полководец Ордена малины';
  override readonly topY = 5.4;
  readonly drop = 'gravitywell';
  override readonly tier = 'boss' as const;
  /** Ауры на выбор после победы, шанс % — терн, тень гравитации, кратер метеора */
  override readonly auras = [['thorns', 40], ['shade', 30], ['quake', 30]] as const;
  private readonly horse = new THREE.Group();
  private readonly legsF = new THREE.Group();
  private readonly legsB = new THREE.Group();
  private readonly knight = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly cape = new THREE.Group();
  private readonly emblem = new THREE.Group();
  /** Фиолетовое кольцо ярости под ногами */
  private readonly auraRing: THREE.Mesh;
  /** Тень метеора: гонится за героем по полу */
  private readonly shadow: THREE.Mesh;
  private gait = 0;
  private leaps = 0;
  private last = '';
  private meteorCd = 0;
  private thornT = 0;
  private arrowHit = false;
  private readonly jumpFrom = new THREE.Vector3();
  private readonly jumpAt = new THREE.Vector3();

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 2000, home, yaw, arena);
    this.speed = 3.6;
    this.keep = 3.5;
    this.turn = 2.4;
    this.auraRing = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.7, 40), glowMat(GRAV.clone().multiplyScalar(0.5), 0.8, true));
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(MET_R, 40), glowMat(METEOR.clone().multiplyScalar(0.3), 0.7, true));
    this.build();
    this.reset();
  }

  protected build(): void {
    const armor = this.lam('#8a3a2a', pixelTex('#8a3a2a', 10, 501));
    const dark = this.lam('#3a2420', pixelTex('#3a2420', 6, 502));
    const coat = this.lam('#d8c8a8', pixelTex('#d8c8a8', 6, 503));
    const cloth = this.lam('#b0203a', pixelTex('#b0203a', 8, 504));
    const steel = this.lam('#b8b4c0');
    const gold = this.lam('#c89a3a');
    const vine = this.lam('#3f6a2a');
    const berry = this.shimmer(RASP, C(4, 1.7, 2.4), 1, 3);
    const heart = this.shimmer(RASP, GRAV, 0, 3);
    const edge = this.shimmer(GRAV, RASP, 2, 2);
    const B = this.box.bind(this);
    this.body.add(this.horse);
    // лошадка: маленький корпус под малиновой попоной, головка с гривой, хвостик
    B(this.horse, coat, 0.8, 0.6, 1.3, 0, 0.75, 0);
    B(this.horse, cloth, 0.86, 0.3, 1.0, 0, 0.86, 0);
    B(this.horse, coat, 0.38, 0.45, 0.55, 0, 1.15, 0.78);
    B(this.horse, coat, 0.3, 0.25, 0.3, 0, 1.0, 1.08);
    B(this.horse, cloth, 0.1, 0.35, 0.45, 0, 1.38, 0.66);
    for (const s of [-1, 1]) B(this.horse, glowMat(GRAV), 0.05, 0.06, 0.08, s * 0.2, 1.22, 0.98);
    B(this.horse, dark, 0.14, 0.5, 0.14, 0, 0.72, -0.72, -0.5);
    // ножки парами — мелькают в беге
    for (const [g, z] of [[this.legsF, 0.45], [this.legsB, -0.45]] as const) {
      g.position.set(0, 0.5, z);
      this.horse.add(g);
      for (const s of [-1, 1]) { B(g, coat, 0.18, 0.46, 0.18, s * 0.26, -0.23, 0); B(g, dark, 0.2, 0.1, 0.2, s * 0.26, -0.45, 0); }
    }
    // рыцарь: огромный, ноги в латах свисают почти до земли, торс, наплечники, шлем с короной
    this.knight.position.set(0, 1.05, -0.05);
    this.body.add(this.knight);
    for (const s of [-1, 1]) { B(this.knight, armor, 0.55, 0.45, 1.0, s * 0.62, 0.1, 0.25); B(this.knight, armor, 0.5, 0.85, 0.5, s * 0.78, -0.35, 0.6); }
    B(this.knight, dark, 1.5, 0.4, 1.0, 0, 0.35, 0);
    B(this.knight, armor, 1.7, 1.5, 1.1, 0, 1.25, 0);
    B(this.knight, dark, 1.2, 0.95, 0.1, 0, 1.35, 0.58);
    for (const s of [-1, 1]) B(this.knight, armor, 0.85, 0.6, 0.95, s * 1.05, 1.95, 0);
    B(this.knight, armor, 0.95, 0.95, 0.95, 0, 2.5, 0.05);
    B(this.knight, dark, 0.75, 0.16, 0.05, 0, 2.5, 0.54);
    B(this.knight, edge, 0.6, 0.05, 0.03, 0, 2.5, 0.57);
    // корона из малины: обод и пять ягод-зубцов
    B(this.knight, gold, 1.0, 0.14, 1.0, 0, 3.02, 0.05);
    for (const [x, z, k] of [[0, 0.05, 0.26], [0.4, 0.45, 0.2], [-0.4, 0.45, 0.2], [0.4, -0.35, 0.2], [-0.4, -0.35, 0.2]] as const) B(this.knight, berry, k, k, k, x, 3.18 + k * 0.3, z);
    // лоза с ягодами: по торсу, наплечникам и бёдрам
    for (const [x, y, z, rz] of [[0.5, 1.7, 0.57, 0.7], [-0.55, 0.9, 0.57, -0.6], [1.05, 2.27, 0.2, 0.2], [-1.05, 2.27, -0.1, -0.3], [0.62, 0.36, 0.76, 0.4]] as const) {
      B(this.knight, vine, 0.6, 0.12, 0.12, x, y, z, 0, 0, rz);
      B(this.knight, berry, 0.16, 0.16, 0.16, x + 0.15, y + 0.1, z + 0.06);
    }
    // сердце-ягода на нагруднике: по нему ×2, когда генерал оглушён
    this.emblem.position.set(0, 1.35, 0.66);
    this.knight.add(this.emblem);
    for (const [x, y, k] of [[0, 0, 0.36], [0.24, 0.2, 0.24], [-0.24, 0.2, 0.24], [0.24, -0.2, 0.24], [-0.24, -0.2, 0.24], [0, 0.38, 0.2], [0, -0.38, 0.2]] as const) B(this.emblem, heart, k, k, 0.12, x, y, 0);
    B(this.emblem, vine, 0.16, 0.22, 0.1, 0, 0.6, 0);
    // руки с изогнутыми мечами: клинок вперёд из кулака, конец загнут вверх, по кромке — свет гравитации
    for (const [g, s] of [[this.armL, 1], [this.armR, -1]] as const) {
      g.position.set(s * 1.2, 1.9, 0);
      this.knight.add(g);
      B(g, armor, 0.5, 1.3, 0.5, 0, -0.6, 0);
      B(g, dark, 0.56, 0.4, 0.56, 0, -1.3, 0);
      B(g, gold, 0.5, 0.12, 0.16, 0, -1.3, 0.34);
      B(g, steel, 0.1, 0.36, 1.9, 0, -1.3, 1.35);
      B(g, steel, 0.1, 0.3, 0.9, 0, -1.12, 2.6, -0.45);
      B(g, edge, 0.12, 0.06, 1.9, 0, -1.12, 1.35);
    }
    // плащ-грива: косматый ворот и полотнище за спиной
    this.cape.position.set(0, 2.15, -0.6);
    this.knight.add(this.cape);
    B(this.cape, cloth, 1.9, 0.45, 0.5, 0, 0, 0.05);
    B(this.cape, cloth, 1.7, 2.1, 0.12, 0, -1.05, -0.1);
    // аура ярости и тень метеора
    this.auraRing.rotation.x = -Math.PI / 2;
    this.auraRing.position.y = 0.08;
    this.group.add(this.auraRing);
    this.shadow.rotation.x = -Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.RingGeometry(MET_R * 0.92, MET_R, 48), glowMat(METEOR, 0.9, true));
    rim.position.z = 0.004;
    this.shadow.add(rim);
    this.h.scene.add(this.shadow);
  }

  override reset(): void {
    super.reset();
    this.leaps = 0; this.last = ''; this.meteorCd = 0; this.thornT = 0;
    this.shadow.visible = false;
  }

  protected override die(): void { this.shadow.visible = false; super.die(); }
  protected override cry(): void { if (!this.quiet) { voice({ type: 'sawtooth', f: 98, f1: 70, dur: 1.2, vol: 0.08, detune: 20, lp: 900, verb: 0.6 }); boom(55, 25, 1, 0.6, 0.1, 0.5); } }

  /** Ярость: фиолетовая аура, тернии кругом, открыт метеор */
  protected override onEnrage(): void {
    this.meteorCd = 2;
    this.thornT = 0.5;
    this.h.fx.shock(this.pos.clone().setY(0.1), 7, GRAV, 0.7, 0.2);
    this.h.fx.burst(this.pos.clone().setY(3), [GRAV, RASP, THORN], 30, { speed: 5, up: 4, size: 0.12, life: 0.9, glow: true, gravity: 3 });
  }

  protected choose(dist: number): string | null {
    if (this.enraged && this.meteorCd <= 0) return this.pick('meteor');
    const r = Math.random();
    if (dist < 5) return this.pick(r < 0.5 ? 'swords' : r < 0.8 ? 'pull' : 'arrows');
    if (dist > 8) return this.pick(r < 0.5 ? 'leap' : r < 0.8 ? 'arrows' : 'pull');
    return this.pick(r < 0.35 ? 'pull' : r < 0.7 ? 'arrows' : 'leap');
  }

  /** Не повторять атаку два раза подряд (кроме метеора) */
  private pick(a: string): string {
    if (a === this.last && a !== 'meteor') a = a === 'swords' ? 'pull' : a === 'leap' ? 'arrows' : 'swords';
    this.last = a;
    return a;
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx, at = (x: number) => t >= x && t - dt < x;
    switch (name) {
      case 'pull': {
        // меч вверх — фиолетовое кольцо тянет героя к генералу; потом удар двумя мечами вокруг
        if (!this.hitDone) { this.hitDone = true; this.markCircle(this.pos, PULL_R, PULL_T, () => undefined, GRAV); if (!this.quiet) sfx.grav(); }
        if (t < PULL_T) {
          const hero = this.h.hero.pos, dx = this.pos.x - hero.x, dz = this.pos.z - hero.z, d = Math.hypot(dx, dz);
          if (d < PULL_R && d > this.radius + 1) { hero.x += (dx / d) * PULL_SPEED * dt; hero.z += (dz / d) * PULL_SPEED * dt; }
          if (Math.random() < 0.6) fx.particle({ pos: hero.clone().setY(rand(0.3, 1.5)), vel: new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(3), life: 0.4, size: 0.1, color: GRAV, gravity: 0 });
        }
        if (at(PULL_T)) this.markCircle(this.pos, SLAM_R, SLAM_AIM, () => undefined);
        if (at(PULL_T + SLAM_AIM)) {
          if (!this.quiet) sfx.slam();
          fx.shake = Math.max(fx.shake, 0.9);
          fx.hitstop = Math.max(fx.hitstop, 0.06);
          fx.shock(this.pos.clone().setY(0.1), SLAM_R + 0.3, GRAV, 0.45, 0.25);
          fx.burst(this.pos.clone().addScaledVector(this.fwd(), 2).setY(0.4), [...DUST, GRAV], 22, { speed: 5, up: 5, size: 0.14, life: 0.8, gravity: 10 });
          if (this.inCircle(this.pos, SLAM_R)) this.hurt(22, this.pos, 10);
        }
        return t > PULL_T + SLAM_AIM + 0.45;
      }
      case 'swords': {
        // два широких взмаха перед собой: справа налево и обратно
        for (const [mk, hit] of [[0, 0.6], [0.65, 1.15]] as const) {
          if (at(mk)) this.markCircle(this.pos.clone().addScaledVector(this.fwd(), 2.4), 2.6, hit - mk, () => undefined);
          if (at(hit)) {
            if (!this.quiet) sfx.swing();
            fx.arc(this.pos, this.yaw, RASP, 4.6, 1.2, 1.6);
            fx.arc(this.pos, this.yaw, GRAV, 4.2, 1.1, 1.2);
            if (this.inCone(this.pos, this.yaw, 4.6, 1.15)) this.hurt(16, this.pos, 6);
          }
        }
        if (t < 0.65) this.face(dt, 0.6);
        return t > 1.5;
      }
      case 'leap': {
        // присел → прыжок через арену на героя → удар, кольца; каждый второй (в ярости — третий) — застрял, оглушён
        if (t < LEAP_CROUCH) { this.face(dt, 2); return false; }
        if (!this.hitDone) {
          this.hitDone = true;
          this.jumpFrom.copy(this.pos).setY(0);
          this.jumpAt.copy(this.clampIn(this.heroAt(), 2.5));
          this.markCircle(this.jumpAt, LEAP_R, LEAP_AIR, () => undefined);
          if (!this.quiet) boom(90, 40, 0.3, 0.4);
        }
        const k = Math.min(1, (t - LEAP_CROUCH) / LEAP_AIR);
        this.pos.x = THREE.MathUtils.lerp(this.jumpFrom.x, this.jumpAt.x, k);
        this.pos.z = THREE.MathUtils.lerp(this.jumpFrom.z, this.jumpAt.z, k);
        this.flyY = Math.sin(Math.PI * k) * 5;
        if (k < 1) return false;
        this.flyY = 0;
        if (!this.quiet) sfx.slam();
        fx.shake = Math.max(fx.shake, 1);
        fx.hitstop = Math.max(fx.hitstop, 0.06);
        for (const [r, d] of [[2.5, 0.3], [4.4, 0.45], [6.5, 0.7]] as const) fx.shock(this.jumpAt.clone().setY(0.08), r, r > 5 ? GRAV : RASP, d, 0.2);
        fx.burst(this.jumpAt.clone().setY(0.4), DUST, 24, { speed: 6, up: 5, size: 0.18, life: 1, gravity: 12 });
        if (this.inCircle(this.jumpAt, LEAP_R)) this.hurt(24, this.jumpAt, 10);
        this.leaps++;
        if (this.leaps % (this.enraged ? 3 : 2) === 0) { this.h.fx.text(this.pos.clone().setY(this.topY + 0.6), 'застрял!', ''); this.daze(1.8); }
        return true;
      }
      case 'arrows': {
        // веер полос → терновые стрелы летят по ним; герой ловит не больше одной
        const n = this.enraged ? 7 : 5;
        if (!this.hitDone) {
          this.hitDone = true;
          this.arrowHit = false;
          const base = Math.atan2(this.h.hero.pos.x - this.pos.x, this.h.hero.pos.z - this.pos.z);
          this.yaw = base;
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.24, dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
            const from = this.pos.clone().setY(0);
            this.markLine(from, dir, ARROW_LEN, ARROW_W, ARROW_AIM, () => this.bolt(from, dir), THORN);
          }
        }
        if (at(ARROW_AIM) && !this.quiet) sfx.arrows();
        return t > ARROW_AIM + 0.4;
      }
      case 'meteor': {
        // взлёт за край неба → тень гонится за героем → замерла → падение метеором, кратер, огонь; застрял — оглушён
        if (!this.hitDone) {
          this.hitDone = true;
          this.meteorCd = 14;
          this.jumpFrom.copy(this.pos).setY(0);
          this.jumpAt.copy(this.jumpFrom);
          if (!this.quiet) sfx.grav();
          fx.shock(this.pos.clone().setY(0.1), 4, GRAV, 0.5, 0.2);
          fx.burst(this.pos.clone().setY(0.4), [...DUST, GRAV], 20, { speed: 5, up: 6, size: 0.16, life: 0.9, gravity: 10 });
        }
        if (t < MET_RISE) { this.flyY = (t / MET_RISE) ** 2 * MET_H; return false; }
        this.flyY = MET_H;
        if (t < MET_RISE + MET_CHASE) {
          // тень бежит к герою
          const to = this.heroAt().sub(this.jumpAt), d = to.length(), step = 7 * dt;
          if (d > 1e-3) this.jumpAt.addScaledVector(to, Math.min(1, step / d));
          this.clampIn(this.jumpAt, 2.5);
          this.shadow.visible = true;
          this.shadow.position.set(this.jumpAt.x, 0.07, this.jumpAt.z);
          this.shadow.scale.setScalar(0.6 + 0.4 * Math.sin(this.time * 8) ** 2);
        } else if (at(MET_RISE + MET_CHASE)) {
          this.shadow.visible = false;
          this.markCircle(this.jumpAt, MET_R, MET_LOCK + MET_FALL, () => undefined, METEOR);
          if (!this.quiet) sfx.fall();
        }
        this.pos.x = this.jumpAt.x; this.pos.z = this.jumpAt.z;
        const f0 = MET_RISE + MET_CHASE + MET_LOCK;
        if (t < f0) return false;
        const k = Math.min(1, (t - f0) / MET_FALL);
        this.flyY = MET_H * (1 - k);
        if (Math.random() < 0.9) fx.particle({ pos: this.pos.clone().setY(this.flyY + 2), vel: new THREE.Vector3(rand(-1, 1), 3, rand(-1, 1)), life: 0.5, size: 0.2, color: Math.random() < 0.5 ? METEOR : EMBER, gravity: -2 });
        if (k < 1) return false;
        this.flyY = 0;
        this.shadow.visible = false;
        if (!this.quiet) { sfx.slam(); boom(40, 18, 1.6, 1, 0.05, 0.7); }
        fx.shake = Math.max(fx.shake, 1.4);
        fx.hitstop = Math.max(fx.hitstop, 0.1);
        fx.screenFlash('#c080ff', 0.3, 0.25);
        fx.explosion(this.jumpAt.clone().setY(0.3), MET_R, METEOR);
        for (const [r, d] of [[3, 0.35], [5.5, 0.55], [8, 0.8]] as const) fx.shock(this.jumpAt.clone().setY(0.08), r, r > 5 ? GRAV : EMBER, d, 0.25);
        if (this.inCircle(this.jumpAt, MET_R)) this.hurt(32, this.jumpAt, 12);
        // кратер: огненное кольцо по краю
        for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; this.hazard(this.jumpAt.clone().add(new THREE.Vector3(Math.cos(a) * 4, 0, Math.sin(a) * 4)), 1.2, 4, 10, EMBER); }
        this.h.fx.text(this.pos.clone().setY(this.topY + 0.6), 'застрял!', '');
        this.daze(2.5);
        return true;
      }
    }
    return true;
  }

  /** Терновая стрела: летит по полосе; герой в полосе — 12, не больше одной за залп */
  private bolt(from: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.state === 'dead') return;
    const mat = glowMat(THORN);
    const m = new THREE.Mesh(UNIT, mat);
    m.scale.set(0.14, 0.14, 1.1);
    m.rotation.y = Math.atan2(dir.x, dir.z);
    const y = 1.2;
    this.h.fx.custom(m, 0.4, (k) => { m.position.copy(from).addScaledVector(dir, 1 + k * (ARROW_LEN - 1)).setY(y); }, () => mat.dispose());
    if (!this.arrowHit && this.inLine(from, dir, ARROW_LEN, ARROW_W)) { this.arrowHit = true; this.hurt(12, from, 4); }
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, A = this.state === 'attack' ? this.attack : '';
    if (this.awake && this.enraged) this.meteorCd -= dt;
    // ярость: аура и терновое кольцо раз в 4 с (пока на земле)
    this.auraRing.visible = this.enraged && this.state !== 'dead' && this.flyY < 2;
    if (this.auraRing.visible) { this.auraRing.rotation.z = t * 0.8; this.auraRing.scale.setScalar(1 + Math.sin(t * 4) * 0.06); }
    if (this.enraged && this.state !== 'dead' && this.flyY < 1) {
      this.thornT -= dt;
      if (this.thornT <= 0) {
        this.thornT = 4;
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + t; this.hazard(this.pos.clone().add(new THREE.Vector3(Math.cos(a) * (this.radius + 1.3), 0, Math.sin(a) * (this.radius + 1.3))), 0.9, 4, 8, THORN); }
        this.h.fx.burst(this.pos.clone().setY(0.5), [THORN, RASP, '#3f6a2a'], 16, { speed: 4, up: 3, size: 0.12, life: 0.6, gravity: 8 });
      }
      if (Math.random() < 0.4) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-1.5, 1.5), rand(0.5, 4.5), rand(-1.5, 1.5))), vel: new THREE.Vector3(0, 0.8, 0), life: 0.6, size: 0.1, color: GRAV, gravity: 0 });
    }
    // бег: ножки лошадки мелькают, рыцарь подскакивает в седле
    if (walk) {
      const was = this.gait % 1;
      this.gait += dt * 5.5 * this.speedK;
      const k = this.gait % 1, ph = k * Math.PI * 2;
      this.legsF.rotation.x = Math.sin(ph) * 0.95;
      this.legsB.rotation.x = -Math.sin(ph) * 0.95;
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.12;
      this.knight.position.y = 1.05 + Math.abs(Math.sin(ph + 0.8)) * 0.08;
      if (k < was) { if (!this.quiet) sfx.hoof(); this.h.fx.burst(this.pos.clone().setY(0.1), DUST, 3, { speed: 1, up: 0.6, size: 0.08, life: 0.4, gravity: 6 }); }
    } else if (this.state !== 'dead') {
      this.legsF.rotation.x *= 0.8; this.legsB.rotation.x *= 0.8;
      this.body.position.y *= 0.8;
      this.knight.position.y = 1.05 + Math.sin(t * 2) * 0.03;
    }
    // руки и корпус по атаке
    let aL = -0.3, aR = -0.3, twist = 0, lean = 0, crouch = 1;
    if (A === 'pull') {
      if (S < PULL_T) { aR = -2.9; lean = -0.15; }
      else if (S < PULL_T + SLAM_AIM) { aL = aR = -3; lean = -0.2; }
      else { aL = aR = -0.6; lean = 0.25; }
    } else if (A === 'swords') {
      aL = aR = -1.1;
      twist = S < 0.6 ? -0.9 * Math.min(1, S / 0.4) : S < 0.75 ? -0.9 + 1.8 * ((S - 0.6) / 0.15) : S < 1.15 ? 0.9 : 0.9 - 1.8 * Math.min(1, (S - 1.15) / 0.15);
    } else if (A === 'leap') {
      if (S < LEAP_CROUCH) crouch = 0.8; else { aL = aR = -2.7; }
    } else if (A === 'arrows') { aL = -2.2; aR = -1.4; lean = -0.1; }
    else if (A === 'meteor') { aL = aR = -3; }
    if (this.state === 'daze') { aL = aR = 0.2; lean = 0.45; }
    const ease = Math.min(1, dt * 12);
    this.armL.rotation.x += (aL - this.armL.rotation.x) * ease;
    this.armR.rotation.x += (aR - this.armR.rotation.x) * ease;
    this.knight.rotation.y += (twist - this.knight.rotation.y) * ease;
    this.knight.rotation.x += (lean - this.knight.rotation.x) * ease;
    if (this.state !== 'dead') this.body.scale.set(1, this.body.scale.y + (crouch - this.body.scale.y) * ease, 1);
    // лошадка в оглушении припала, ножки разъехались
    if (this.state === 'daze') { this.horse.rotation.x = 0.15; this.legsF.rotation.x = -0.6; this.legsB.rotation.x = 0.6; } else this.horse.rotation.x *= 0.85;
    // плащ-грива: колышется, в беге и полёте развевается назад
    this.cape.rotation.x = (walk || this.flyY > 0.5 ? 0.45 : 0.08) + Math.sin(t * 3) * 0.06;
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.emblem.scale.setScalar(beat * (this.heartOpen ? 1.5 : 1));
  }
}
