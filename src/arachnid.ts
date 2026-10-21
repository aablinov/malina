import * as THREE from 'three';
import { raycastObstacles, resolveCircle, type Obstacle } from './collision';
import type { FX } from './fx';
import type { Rand, Shootable } from './gunplay';
import { aimSegment, solveIK } from './ik';
import type { NavGrid } from './nav';
import { ARACHNID_LENGTH, ARACHNIDS, type ArachnidKind, type ArachnidTuning } from './tuning';

/**
 * Арахниды в духе «Звёздного десанта»: длинные ноги-копья, вытянутый панцирь, передние клешни.
 * Блочные (ADR-003), жёлтые полосы светятся и дают bloom.
 *
 * ИИ:
 * - видит, что на него навели ствол (угол между стволом и направлением на него меньше его углового размера + разброс),
 *   и через время реакции отпрыгивает вбок; попадание и пролетевшая рядом пуля тоже пугают;
 * - каждый прыжок проверяется по навигационной сетке: нельзя перелететь стену или укрытие и нельзя приземлиться в них;
 * - ходит в обход стен по A*; на перезарядке героя давит сильнее.
 */

export type ArachnidState = 'спит' | 'просыпается' | 'охота' | 'фланг' | 'уклон' | 'замах' | 'удар' | 'отскок' | 'плевок' | 'прыжок' | 'оглушён';

export const ARACHNID_NAMES: Record<ArachnidKind, string> = { warrior: 'Воин', spinner: 'Ткач', leaper: 'Прыгун' };

/** Что арахнид знает о герое и мире в этом кадре */
export interface ArachnidContext {
  hero: {
    pos: THREE.Vector3; vel: THREE.Vector3; upperYaw: number; aiming: boolean; running: boolean; rolling: boolean;
    down: boolean; reloading: boolean; muzzle: THREE.Vector3; spread: number; range: number;
  };
  /** Герой стрелял в последние 0,25 с */
  firing: boolean;
  nav: NavGrid;
  obstacles: readonly Obstacle[];
  others: readonly Arachnid[];
  /** Удар по герою; false — промах (перекат, бессмертие) */
  hurtHero(dmg: number, from: THREE.Vector3, what: 'melee' | 'pounce'): boolean;
  /** Паутина: из точки from со скоростью vel */
  web(from: THREE.Vector3, vel: THREE.Vector3, t: ArachnidTuning): void;
  sound(key: 'screech' | 'leap' | 'slash' | 'web' | 'land'): void;
  /** Гранаты на поле: от лежащих рядом отпрыгивает */
  dangers: readonly { pos: THREE.Vector3; fuse: number }[];
}

interface Jump { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number; kind: 'dodge' | 'pounce' | 'hop' }

interface Leg {
  femur: THREE.Group; tibia: THREE.Group;
  /** Тазобедренный сустав в системе тела */
  hip: THREE.Vector3;
  /** Где стоит нога в покое, в системе по курсу (на земле) */
  home: THREE.Vector3;
  foot: THREE.Vector3;
  stepFrom: THREE.Vector3; stepTo: THREE.Vector3; stepT: number;
  group: 0 | 1;
  side: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (k: number, dt: number): number => 1 - Math.exp(-k * dt);
const ease = (t: number): number => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };

const STRIPE_COLORS: Record<ArachnidKind, THREE.Color> = {
  warrior: new THREE.Color(2.6, 1.75, 0.2),
  spinner: new THREE.Color(0.55, 2.6, 0.35),
  leaper: new THREE.Color(2.4, 0.8, 2.4),
};

export class Arachnid implements Shootable {
  readonly kind: ArachnidKind;
  readonly T: ArachnidTuning;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly spawn = new THREE.Vector3();
  readonly spawnYaw: number;
  yaw: number;
  hp: number;
  dead = false;
  state: ArachnidState = 'спит';
  /** Сколько уклонов сделал — для телеметрии и тестов */
  dodges = 0;
  readonly name: string;

  private stateT = 0;
  private jump: Jump | null = null;
  private dodgeCd = 0;
  private attackCd = 1;
  private threatT = 0;
  private path: THREE.Vector3[] = [];
  private repathT = 0;
  private flankSide = 1;
  private flankT = 0;
  private strafeSide = 1;
  private strafeT = 0;
  private zigT = 0;
  private hitFlash = 0;
  private struck = false;
  private time = 0;
  private readonly lungeDir = new THREE.Vector3();
  private readonly aimPerp = new THREE.Vector3();
  private aimSide = 0;

  // модель
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly jawL: THREE.Mesh;
  private readonly jawR: THREE.Mesh;
  private readonly claws: THREE.Group[] = [];
  private horns: THREE.Group[] = [];
  private readonly legs: Leg[] = [];
  private readonly shell: THREE.MeshStandardMaterial;
  private readonly stripe: THREE.MeshBasicMaterial;
  private readonly stripeBase: THREE.Color;
  private readonly sac: THREE.Mesh | null = null;
  private bodyY: number;
  private readonly FEMUR: number;
  private readonly TIBIA: number;

  constructor(private readonly scene: THREE.Scene, kind: ArachnidKind, x: number, z: number, yaw: number, private readonly rand: Rand, private readonly fx: FX) {
    this.kind = kind;
    this.T = ARACHNIDS[kind];
    this.name = ARACHNID_NAMES[kind];
    this.hp = this.T.hp;
    this.pos.set(x, 0, z);
    this.spawn.set(x, 0, z);
    this.yaw = this.spawnYaw = yaw;
    const s = this.T.scale;
    const leaper = kind === 'leaper', spinner = kind === 'spinner';
    // как на референсах: корпус высоко, колени выше спины, ноги-копья длиннее тела
    this.bodyY = 2.15 * s;
    this.FEMUR = (leaper ? 1.75 : 1.6) * s;
    this.TIBIA = (leaper ? 3.2 : 2.9) * s;

    this.shell = new THREE.MeshStandardMaterial({ color: '#1a1d22', roughness: 0.34, metalness: 0.4 });
    const under = new THREE.MeshStandardMaterial({ color: '#5a1d18', roughness: 0.6, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.45, metalness: 0.35 });
    this.stripeBase = STRIPE_COLORS[kind].clone();
    this.stripe = new THREE.MeshBasicMaterial({ color: this.stripeBase.clone(), toneMapped: false });

    scene.add(this.root);
    this.root.add(this.body);
    this.body.scale.setScalar(s);
    this.body.rotation.order = 'YXZ';

    const box = (p: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(px, py, pz);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      p.add(mesh);
      return mesh;
    };
    const glow = (p: THREE.Object3D, w: number, h: number, d: number, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => {
      const m = box(p, w, h, d, this.stripe, px, py, pz, rx, ry, rz);
      m.castShadow = false;
      return m;
    };
    const group = (p: THREE.Object3D, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.set(rx, ry, rz);
      p.add(g);
      return g;
    };

    // ---------- грудь ----------
    const w = leaper ? 0.85 : 1;
    box(this.body, 0.85 * w, 0.6, 1.1, this.shell, 0, 0, 0);
    box(this.body, 0.6 * w, 0.3, 0.9, under, 0, -0.36, 0.05);
    box(this.body, 0.95 * w, 0.14, 0.5, dark, 0, 0.3, 0.25); // воротник за головой

    // ---------- голова: клин вперёд и вниз, плоский гребень-«молот», пасть с клыками ----------
    this.head.position.set(0, 0.06, 0.5);
    this.head.rotation.x = 0.16;
    this.body.add(this.head);
    box(this.head, 0.8 * w, 0.55, 0.55, this.shell, 0, 0, 0.28);
    box(this.head, 0.62 * w, 0.45, 0.5, this.shell, 0, -0.03, 0.72);
    box(this.head, 0.44 * w, 0.34, 0.45, this.shell, 0, -0.06, 1.12);
    box(this.head, 0.26, 0.22, 0.35, dark, 0, -0.08, 1.46);
    // гребень: широкая плоская пластина с заострёнными краями
    box(this.head, 1.15 * w, 0.08, 0.75, this.shell, 0, 0.31, 0.45);
    for (const sd of [1, -1]) box(this.head, 0.3, 0.06, 0.3, dark, sd * 0.68 * w, 0.29, 0.3, 0, sd * 0.7, 0);
    for (const [z, ww] of [[0.18, 1.05], [0.42, 0.8], [0.64, 0.55]] as const) glow(this.head, ww * w, 0.02, z === 0.42 ? 0.1 : 0.07, 0, 0.36, z);
    glow(this.head, 0.06, 0.02, 0.5, 0.18, 0.36, 0.95, 0, 0.12); glow(this.head, 0.06, 0.02, 0.5, -0.18, 0.36, 0.95, 0, -0.12);
    // пасть и клыки
    box(this.head, 0.42, 0.26, 0.34, under, 0, -0.3, 0.88);
    this.jawL = box(this.head, 0.08, 0.36, 0.08, dark, 0.13, -0.5, 1.0, 0.35);
    this.jawR = box(this.head, 0.08, 0.36, 0.08, dark, -0.13, -0.5, 1.0, 0.35);
    glow(this.head, 0.06, 0.06, 0.04, 0.26, 0.08, 0.98); glow(this.head, 0.06, 0.06, 0.04, -0.26, 0.08, 0.98); // глаза

    // ---------- большие рога-серпы: толстые у основания, дугой вверх и назад над спиной ----------
    this.horns = [];
    const hornK = spinner ? 0.7 : leaper ? 0.55 : 1;
    const segs: [number, number, number][] = [
      // длина, толщина, изгиб относительно предыдущего
      [0.8, 0.24, 0], [0.75, 0.19, -0.75], [0.7, 0.14, -0.7], [0.5, 0.08, -0.6],
    ];
    for (const sd of [1, -1]) {
      const a = group(this.head, sd * 0.3 * w, 0.3, 0.42, 0.2, 0, -sd * 0.28);
      let parent: THREE.Group = a;
      segs.forEach(([len, th, bend], i) => {
        const g = i === 0 ? a : group(parent, 0, segs[i - 1][0] * hornK, 0, bend);
        const L = len * hornK;
        box(g, th, L + th * 0.5, th * 1.15, i === 3 ? dark : this.shell, 0, L / 2, 0);
        // светящаяся внутренняя кромка серпа (со стороны головы)
        if (i < 3) glow(g, th * 0.35, L * 0.55, 0.03, 0, L * 0.5, th * 0.6);
        parent = g;
      });
      this.horns.push(a);
    }

    // ---------- малые клешни под головой (ими бьёт) ----------
    for (const sd of [1, -1]) {
      const c = group(this.body, sd * 0.24, -0.32, 0.75);
      box(c, 0.11, 0.55, 0.11, this.shell, 0, -0.27, 0);
      const blade = group(c, 0, -0.54, 0);
      box(blade, 0.08, 0.08, 0.5, this.shell, 0, 0, 0.24);
      box(blade, 0.05, 0.05, 0.26, dark, 0, 0.06, 0.55, -0.5);
      glow(blade, 0.1, 0.03, 0.22, 0, 0.05, 0.2);
      c.userData.blade = blade;
      this.claws.push(c);
    }

    // ---------- спинной панцирь со скатом назад и хвостовой шип ----------
    const back = group(this.body, 0, 0.32, -0.45, -0.16);
    box(back, 1.2 * w, 0.16, 1.7, this.shell, 0, 0, -0.2);
    box(back, 0.14, 0.24, 1.4, dark, 0, 0.16, -0.25); // киль
    for (const sd of [1, -1]) box(back, 0.3, 0.1, 1.0, dark, sd * 0.68 * w, -0.06, -0.3, 0, sd * 0.22, sd * 0.25);
    // тигровые полосы рваной ширины поперёк панциря и по бокам
    // тигровые полосы: рваные «языки пламени» от киля к краям, разной длины и наклона
    const stripes: [number, number, number, number][] = [[0.45, 0.42, 0.07, 0.5], [0.15, 0.55, 0.11, 0.38], [-0.12, 0.34, 0.06, 0.6], [-0.42, 0.52, 0.1, 0.42], [-0.72, 0.4, 0.07, 0.55], [-0.98, 0.28, 0.05, 0.5]];
    stripes.forEach(([z, len, d, ang], i) => {
      for (const sd of [1, -1]) {
        const jit = ((i * 7 + (sd > 0 ? 3 : 0)) % 5) * 0.03;
        glow(back, len * w, 0.02, d, sd * (0.13 + len * w * 0.45), 0.09, z - Math.sin(ang) * len * 0.3 + jit, 0, sd * ang, 0);
      }
    });
    for (const sd of [1, -1]) for (const z of [0.1, -0.4]) glow(back, 0.04, 0.12, 0.18, sd * 0.61 * w, 0.0, z);
    if (spinner) {
      // брюшко с прядильными железами — светится зелёным
      this.sac = box(this.body, 0.95, 0.85, 1.05, this.shell, 0, -0.05, -1.25);
      for (const z of [-0.95, -1.3, -1.62]) glow(this.body, 0.98, 0.88, 0.05, 0, -0.05, z);
      glow(this.body, 0.3, 0.3, 0.12, 0, -0.15, -1.8);
    } else {
      box(this.body, 0.7 * w, 0.5, 1.0, this.shell, 0, 0.0, -1.0, -0.12);
      const tail = group(this.body, 0, 0.12, -1.5, 0.75);
      box(tail, 0.22, 0.22, 0.85, this.shell, 0, 0, -0.4);
      box(tail, 0.1, 0.1, 0.5, dark, 0, -0.12, -0.95, 0.5);
      glow(tail, 0.24, 0.02, 0.1, 0, 0.12, -0.35);
    }
    if (leaper) {
      // гребень шипов вдоль спины, загнутых назад
      for (const [z, h] of [[0.0, 0.5], [-0.4, 0.62], [-0.8, 0.5], [-1.15, 0.35]] as const) {
        box(back, 0.08, h, 0.12, dark, 0, 0.25 + h / 2 - 0.15, z, -0.6);
      }
    }

    // ---------- ноги: 4 копья, колени высоко над спиной ----------
    const legDefs: [number, number, number, number, 0 | 1][] = [
      // side, hipZ, homeZ, homeX, group
      [1, 0.4, 2.0, 1.85, 0], [-1, 0.4, 2.0, 1.85, 1],
      [1, -0.45, leaper ? -2.5 : -2.2, 2.0, 1], [-1, -0.45, leaper ? -2.5 : -2.2, 2.0, 0],
    ];
    const F = this.FEMUR, Tb = this.TIBIA;
    for (const [side, hz, homeZ, homeX, grp] of legDefs) {
      const femur = new THREE.Group(), tibia = new THREE.Group();
      box(femur, 0.26 * s, F, 0.26 * s, this.shell, 0, -F / 2, 0);
      box(femur, 0.34 * s, 0.3 * s, 0.34 * s, dark, 0, -F, 0); // колено
      glow(femur, 0.28 * s, 0.07 * s, 0.28 * s, 0, -F * 0.55, 0);
      // голень сужается к игле
      box(tibia, 0.24 * s, Tb * 0.34, 0.24 * s, this.shell, 0, -Tb * 0.17, 0);
      box(tibia, 0.15 * s, Tb * 0.36, 0.15 * s, this.shell, 0, -Tb * 0.51, 0);
      box(tibia, 0.08 * s, Tb * 0.3, 0.08 * s, dark, 0, -Tb * 0.84, 0);
      glow(tibia, 0.26 * s, 0.07 * s, 0.26 * s, 0, -Tb * 0.12, 0);
      glow(tibia, 0.26 * s, 0.05 * s, 0.26 * s, 0, -Tb * 0.26, 0);
      glow(tibia, 0.17 * s, 0.05 * s, 0.17 * s, 0, -Tb * 0.5, 0);
      this.root.add(femur, tibia);
      const home = new THREE.Vector3(side * homeX * s, 0, homeZ * s);
      const leg: Leg = {
        femur, tibia, hip: new THREE.Vector3(side * 0.44 * w, -0.1, hz), home,
        foot: new THREE.Vector3(), stepFrom: new THREE.Vector3(), stepTo: new THREE.Vector3(), stepT: 1, group: grp, side,
      };
      this.legs.push(leg);
    }
    this.plantFeet();
    this.pose(0);
  }

  get radius(): number { return 0.9 * this.T.scale; }
  get alive(): boolean { return !this.dead; }
  get active(): boolean { return this.state !== 'спит'; }
  get bodyLength(): number { return ARACHNID_LENGTH * this.T.scale; }
  get pounceRange(): number { return this.T.pounceMul * this.bodyLength; }

  // ---------- реакции на стрельбу ----------

  wake(): void {
    if (this.state !== 'спит' || this.dead) return;
    this.state = 'просыпается';
    this.stateT = 0.3;
  }

  hit(dmg: number, dir: THREE.Vector3, _point: THREE.Vector3, knock: number): void {
    if (this.dead) return;
    this.hp -= dmg;
    this.hitFlash = 0.08;
    if (this.state === 'спит') this.wake();
    if (!this.jump) this.vel.addScaledVector(dir, knock * 3);
    if (this.hp <= 0) { this.dead = true; return; }
    // попали — шанс отпрыгнуть сразу, не дожидаясь реакции
    this.threatT = Math.max(this.threatT, this.T.reaction);
  }

  /** Пуля прошла рядом */
  nearMiss(): void {
    if (this.dead) return;
    if (this.state === 'спит') this.wake();
    this.threatT = Math.max(this.threatT, this.T.reaction);
  }

  // ---------- ИИ ----------

  update(dt: number, ctx: ArachnidContext): void {
    if (this.dead) return;
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);

    if (this.state === 'спит') { this.pose(dt); return; }
    if (this.state === 'просыпается') {
      this.stateT -= dt;
      this.faceTo(ctx.hero.pos, dt, 6);
      // разбуженный выстрелом сразу уходит с линии огня
      if (this.threatT >= this.T.reaction && this.dodgeCd <= 0 && this.aimedAt(ctx) && this.tryDodge(ctx)) { this.pose(dt); return; }
      if (this.stateT <= 0) this.state = 'охота';
      this.pose(dt);
      return;
    }

    const H = ctx.hero;
    const toHero = new THREE.Vector3(H.pos.x - this.pos.x, 0, H.pos.z - this.pos.z);
    const dist = toHero.length();

    // прыжок в полёте
    if (this.jump) { this.flyJump(dt, ctx); this.pose(dt); return; }

    // граната рядом — отпрыгнуть от неё (умные)
    if (this.dodgeCd <= 0 && this.state !== 'замах' && this.state !== 'удар') {
      for (const g of ctx.dangers) {
        if (g.pos.y > 1.6 || g.fuse > 2.4) continue;
        if (Math.hypot(g.pos.x - this.pos.x, g.pos.z - this.pos.z) < 4.6 && this.hopFrom(g.pos, ctx)) { this.pose(dt); return; }
      }
    }

    // угроза: на меня навели ствол?
    const aimed = this.aimedAt(ctx);
    if (aimed) this.threatT += dt; else this.threatT = Math.max(0, this.threatT - dt * 1.5);
    const canDodge = this.state === 'охота' || this.state === 'фланг' || this.state === 'отскок' || (this.state === 'плевок' && this.stateT > 0.12);
    if (canDodge && this.dodgeCd <= 0 && this.threatT >= this.T.reaction && (aimed || this.threatT > this.T.reaction * 1.5)) {
      const dangerous = ctx.firing || H.aiming || this.threatT > this.T.reaction * 2.5;
      if (dangerous) {
        if (this.rand() < this.T.dodgeChance && this.tryDodge(ctx)) { this.pose(dt); return; }
        this.dodgeCd = 0.35; // не успел — пробует чуть позже
      }
    }

    switch (this.state) {
      case 'замах': this.windup(dt, ctx, dist); break;
      case 'удар': this.strike(dt, ctx); break;
      case 'плевок': this.spit(dt, ctx, dist); break;
      case 'оглушён':
        this.stateT -= dt;
        this.move(dt, ctx, null, 0);
        if (this.stateT <= 0) { this.state = 'отскок'; this.stateT = 0.6; this.hopAway(ctx, 2.6); }
        break;
      default: this.hunt(dt, ctx, dist, toHero);
    }
    this.pose(dt);
  }

  private aimedAt(ctx: ArachnidContext): boolean {
    const H = ctx.hero;
    if (H.down || H.running || H.rolling) return false;
    const dx = this.pos.x - H.muzzle.x, dz = this.pos.z - H.muzzle.z;
    const d = Math.hypot(dx, dz);
    if (d > H.range * 1.6 || d < 0.5) return false;
    const signed = wrap(Math.atan2(dx, dz) - H.upperYaw);
    const ang = Math.abs(signed);
    const width = Math.atan((this.radius * 1.3) / d) + H.spread + 0.05;
    if (ang > width) { this.aimSide = 0; return false; }
    // куда уходить с линии огня: в ту сторону, где уже стоит
    this.aimPerp.set(Math.cos(H.upperYaw), 0, -Math.sin(H.upperYaw));
    this.aimSide = signed >= 0 ? -1 : 1;
    // за стеной — не видит угрозы
    return !raycastObstacles(H.muzzle.x, H.muzzle.z, dx / d, dz / d, d, 1.2, ctx.obstacles);
  }

  /** Отпрыгнуть вбок от линии огня; прыжок только по свободной прямой */
  private tryDodge(ctx: ArachnidContext): boolean {
    const H = ctx.hero;
    const aimDir = new THREE.Vector3(Math.sin(H.upperYaw), 0, Math.cos(H.upperYaw));
    const perp = new THREE.Vector3(aimDir.z, 0, -aimDir.x);
    const toward = aimDir.clone().negate();
    // воин и прыгун отпрыгивают вбок-вперёд (сокращают дистанцию), ткач — вбок-назад
    const fwdBias = this.kind === 'spinner' ? -0.45 : 0.4;
    const cands: THREE.Vector3[] = [];
    for (const side of [1, -1]) {
      for (const b of [fwdBias, 0, -fwdBias * 0.6]) cands.push(perp.clone().multiplyScalar(side).addScaledVector(toward, b).normalize());
    }
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (const dir of cands) {
      for (const k of [1, 0.65]) {
        const d = this.T.dodgeDist * k;
        const to = this.pos.clone().addScaledVector(dir, d);
        if (!this.canLeap(this.pos, to, ctx)) continue;
        // насколько далеко от линии огня окажется
        const dx = to.x - H.muzzle.x, dz = to.z - H.muzzle.z;
        const off = Math.abs(wrap(Math.atan2(dx, dz) - H.upperYaw)) * Math.hypot(dx, dz);
        let score = off + d * 0.3 + this.rand() * 0.6;
        // воин предпочитает сторону своего фланга
        if (this.kind === 'warrior' && Math.sign(dir.dot(perp)) === this.flankSide) score += 0.8;
        // не прыгать в стаю
        for (const o of ctx.others) if (o !== this && !o.dead && o.pos.distanceTo(to) < 1.6) score -= 2;
        if (score > bestScore) { bestScore = score; best = to; }
        break;
      }
    }
    if (!best) return false;
    this.startJump(best, this.T.dodgeTime, 0.55 * this.T.scale, 'dodge');
    this.state = 'уклон';
    this.dodgeCd = this.T.dodgeCd * (0.85 + this.rand() * 0.3);
    this.threatT = 0;
    this.dodges++;
    ctx.sound('leap');
    if (this.kind === 'warrior' && this.rand() < 0.5) this.flankSide = -this.flankSide;
    return true;
  }

  /** Прыжок допустим: внутри поля, по прямой без стен и укрытий, приземление на свободное место */
  canLeap(from: THREE.Vector3, to: THREE.Vector3, ctx: ArachnidContext): boolean {
    return ctx.nav.walkable(to.x, to.z) && ctx.nav.clearLine(from.x, from.z, to.x, to.z);
  }

  private startJump(to: THREE.Vector3, dur: number, h: number, kind: Jump['kind']): void {
    this.jump = { from: this.pos.clone(), to: to.clone(), t: 0, dur, h, kind };
    for (const l of this.legs) l.stepT = 1;
  }

  private flyJump(dt: number, ctx: ArachnidContext): void {
    const j = this.jump as Jump;
    j.t += dt;
    const k = Math.min(1, j.t / j.dur);
    const e = j.kind === 'pounce' ? k : ease(k);
    const prev = this.pos.clone();
    this.pos.lerpVectors(j.from, j.to, e);
    this.vel.copy(this.pos).sub(prev).divideScalar(Math.max(dt, 1e-4));
    const dir = new THREE.Vector3().subVectors(j.to, j.from);
    if (j.kind === 'pounce' || j.kind === 'hop') this.yaw = wrap(this.yaw + wrap(Math.atan2(dir.x, dir.z) - this.yaw) * damp(14, dt));
    else this.faceTo(ctx.hero.pos, dt, 10);
    if (k >= 1) {
      this.jump = null;
      this.keepOffHero(ctx);
      resolveCircle(this.pos, this.radius * 0.8, ctx.obstacles);
      this.plantFeet();
      this.vel.multiplyScalar(0.2);
      ctx.sound('land');
      this.fx.burst(this.pos.clone().setY(0.1), ['#6a6f78', '#4a4f57'], 5, { speed: 2, up: 1.5, size: 0.08, life: 0.4 });
      if (j.kind === 'pounce') {
        const H = ctx.hero;
        const d = Math.hypot(H.pos.x - this.pos.x, H.pos.z - this.pos.z);
        if (d < 1.4 * this.T.scale + 0.4 && !H.down) ctx.hurtHero(this.T.pounceDmg, this.pos, 'pounce');
        this.state = 'оглушён';
        this.stateT = 0.55; // после прыжка уязвим — окно для героя
        this.attackCd = this.T.pounceCd;
      } else if (j.kind === 'dodge') {
        this.state = 'охота';
      } else {
        this.state = this.state === 'отскок' ? 'охота' : this.state === 'прыжок' ? 'охота' : this.state;
      }
    }
  }

  private hunt(dt: number, ctx: ArachnidContext, dist: number, toHero: THREE.Vector3): void {
    const H = ctx.hero;
    const T = this.T;
    const los = dist > 0.1 && !raycastObstacles(this.pos.x, this.pos.z, toHero.x / dist, toHero.z / dist, dist, 1.0, ctx.obstacles);
    const aggressive = H.reloading || H.down; // умные: давят, пока герой перезаряжается
    let goal: THREE.Vector3 = H.pos;
    let speed = T.speed;
    this.state = 'охота';

    if (this.kind === 'warrior') {
      this.flankT -= dt;
      if (this.flankT <= 0) { this.flankT = 2.5 + this.rand() * 2; if (this.rand() < 0.35) this.flankSide = -this.flankSide; }
      if (!aggressive && dist > 4.5) {
        // заход с фланга: точка сбоку от линии прицела героя
        const a = H.upperYaw + this.flankSide * 1.75;
        goal = H.pos.clone().add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(Math.min(dist * 0.6, 4)));
        this.state = 'фланг';
      }
      if (dist < T.meleeRange + 0.3 && this.attackCd <= 0 && los) { this.beginWindup(); return; }
    } else if (this.kind === 'spinner') {
      if (dist < 2.6 && this.attackCd <= 0) { this.beginWindup(); return; }
      if (dist < T.keepMin - (aggressive ? 2 : 0)) {
        // слишком близко — отходит или отпрыгивает
        if (this.dodgeCd <= 0 && this.hopAway(ctx, T.dodgeDist)) { this.state = 'отскок'; this.dodgeCd = T.dodgeCd * 0.6; return; }
        goal = this.pos.clone().addScaledVector(toHero, -3 / Math.max(dist, 0.1));
      } else if (dist < T.keepMax && los) {
        // на дистанции: кружит и плюётся
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = 1 + this.rand() * 1.6; this.strafeSide = -this.strafeSide; }
        const perp = new THREE.Vector3(toHero.z, 0, -toHero.x).normalize().multiplyScalar(this.strafeSide);
        goal = this.pos.clone().addScaledVector(perp, 2);
        speed = T.speed * 0.6;
        if (this.attackCd <= 0 && dist < T.webRange) { this.state = 'плевок'; this.stateT = 0.35; this.vel.multiplyScalar(0.3); return; }
      }
    } else {
      // прыгун
      const range = this.pounceRange;
      if (dist < T.meleeRange + 0.2 && this.attackCd <= 0) { this.beginWindup(); return; }
      if (dist < range && dist > 2 && this.attackCd <= 0 && ctx.nav.clearLine(this.pos.x, this.pos.z, H.pos.x, H.pos.z)) {
        this.state = 'замах';
        this.stateT = T.pounceWindup;
        this.struck = false;
        this.vel.multiplyScalar(0.2);
        return;
      }
      // скачками сближается, зигзагом
      this.zigT -= dt;
      if (this.zigT <= 0 && dist > range * 1.1 && los) {
        this.zigT = 0.9 + this.rand() * 0.8;
        const fwd = toHero.clone().normalize();
        const perp = new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(this.rand() < 0.5 ? 1 : -1);
        const to = this.pos.clone().addScaledVector(fwd, 2.2).addScaledVector(perp, 1.4);
        if (this.canLeap(this.pos, to, ctx)) { this.startJump(to, 0.32, 0.5 * T.scale, 'hop'); this.state = 'прыжок'; return; }
      }
    }
    if (aggressive) speed *= 1.15;
    this.move(dt, ctx, goal, speed);
  }

  private beginWindup(): void {
    this.state = 'замах';
    this.stateT = this.T.meleeWindup;
    this.struck = false;
    this.vel.multiplyScalar(0.3);
  }

  private windup(dt: number, ctx: ArachnidContext, dist: number): void {
    this.stateT -= dt;
    this.faceTo(ctx.hero.pos, dt, 14);
    this.move(dt, ctx, null, 0);
    if (this.stateT > 0) return;
    const H = ctx.hero;
    if (this.kind === 'leaper' && dist > this.T.meleeRange + 0.4) {
      // прыжок на героя с упреждением, не дальше 3 длин тела и только по свободной прямой
      const lead = H.pos.clone().addScaledVector(H.vel, this.T.pounceTime * 0.6);
      const dir = lead.clone().sub(this.pos);
      const d = Math.min(dir.length(), this.pounceRange);
      dir.setLength(Math.max(0.1, d - 0.6));
      let to = this.pos.clone().add(dir);
      if (!this.canLeap(this.pos, to, ctx)) {
        to = this.pos.clone().add(H.pos.clone().sub(this.pos).setLength(Math.max(0.1, Math.min(dist, this.pounceRange) - 0.6)));
        if (!this.canLeap(this.pos, to, ctx)) { this.state = 'охота'; this.attackCd = 0.4; return; }
      }
      this.startJump(to, this.T.pounceTime, 1.1 * this.T.scale, 'pounce');
      this.state = 'прыжок';
      ctx.sound('leap');
      return;
    }
    this.state = 'удар';
    this.stateT = 0.18;
    this.lungeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    ctx.sound('slash');
  }

  private strike(dt: number, ctx: ArachnidContext): void {
    this.stateT -= dt;
    // выпад вперёд
    this.vel.copy(this.lungeDir).multiplyScalar(7 * this.T.scale);
    this.move(dt, ctx, null, -1);
    const H = ctx.hero;
    if (!this.struck && this.stateT < 0.1) {
      this.struck = true;
      const dx = H.pos.x - this.pos.x, dz = H.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const ang = Math.abs(wrap(Math.atan2(dx, dz) - this.yaw));
      if (d < this.T.meleeRange + 0.5 && ang < 1.1 && !H.down) ctx.hurtHero(this.T.meleeDmg, this.pos, 'melee');
    }
    if (this.stateT <= 0) {
      this.attackCd = this.T.meleeCd * (0.8 + this.rand() * 0.4);
      // ударил — отскочил (бей и беги)
      this.state = 'отскок';
      if (!this.hopAway(ctx, 2.4)) this.state = 'охота';
    }
  }

  private spit(dt: number, ctx: ArachnidContext, dist: number): void {
    this.stateT -= dt;
    this.faceTo(ctx.hero.pos, dt, 12);
    this.move(dt, ctx, null, 0);
    if (this.stateT > 0) return;
    const H = ctx.hero;
    const from = this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(1.1 * this.T.scale)).setY(1.0);
    // упреждение: куда герой придёт, пока летит паутина
    const t = dist / this.T.webSpeed;
    const aim = H.pos.clone().addScaledVector(H.vel, t * 0.85).setY(1.0);
    const vel = aim.sub(from).setY(0).setLength(this.T.webSpeed);
    ctx.web(from, vel, this.T);
    ctx.sound('web');
    this.attackCd = this.T.webCd * (0.85 + this.rand() * 0.3);
    this.state = 'охота';
  }

  /** Отпрыгнуть подальше от точки (граната): самый дальний допустимый прыжок */
  private hopFrom(p: THREE.Vector3, ctx: ArachnidContext): boolean {
    const away = new THREE.Vector3(this.pos.x - p.x, 0, this.pos.z - p.z);
    if (away.lengthSq() < 1e-4) away.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    away.normalize();
    const perp = new THREE.Vector3(away.z, 0, -away.x);
    let best: THREE.Vector3 | null = null, bestD = 0;
    for (const k of [0, 0.7, -0.7, 1.4, -1.4]) {
      const dir = away.clone().addScaledVector(perp, k).normalize();
      const to = this.pos.clone().addScaledVector(dir, this.T.dodgeDist * 1.3);
      if (!this.canLeap(this.pos, to, ctx)) continue;
      const d = to.distanceTo(p);
      if (d > bestD) { bestD = d; best = to; }
    }
    if (!best) return false;
    this.startJump(best, this.T.dodgeTime * 1.2, 0.6 * this.T.scale, 'dodge');
    this.state = 'уклон';
    this.dodgeCd = this.T.dodgeCd * 0.5;
    this.dodges++;
    ctx.sound('leap');
    return true;
  }

  /** Отпрыгнуть от героя на dist (по свободной прямой) */
  private hopAway(ctx: ArachnidContext, dist: number): boolean {
    const away = new THREE.Vector3(this.pos.x - ctx.hero.pos.x, 0, this.pos.z - ctx.hero.pos.z).normalize();
    const perp = new THREE.Vector3(away.z, 0, -away.x);
    for (const k of [0, 0.6, -0.6, 1.2, -1.2]) {
      const dir = away.clone().addScaledVector(perp, k).normalize();
      const to = this.pos.clone().addScaledVector(dir, dist);
      if (this.canLeap(this.pos, to, ctx)) { this.startJump(to, 0.3, 0.45 * this.T.scale, 'hop'); return true; }
    }
    return false;
  }

  /** Движение к цели по пути в обход стен; speed −1 — сохранить текущую скорость */
  private move(dt: number, ctx: ArachnidContext, goal: THREE.Vector3 | null, speed: number): void {
    const want = new THREE.Vector3();
    if (goal && speed > 0) {
      this.repathT -= dt;
      const direct = ctx.nav.clearLine(this.pos.x, this.pos.z, goal.x, goal.z);
      if (direct) this.path = [goal.clone()];
      else if (this.repathT <= 0 || !this.path.length) { this.path = ctx.nav.path(this.pos, goal); this.repathT = 0.35; }
      while (this.path.length > 1 && Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 0.6) this.path.shift();
      const wp = this.path[0];
      if (wp) {
        want.set(wp.x - this.pos.x, 0, wp.z - this.pos.z);
        const d = want.length();
        if (d > 0.05) want.multiplyScalar(speed / d * Math.min(1, d / 0.4));
      }
      // под прицелом, но уклон ещё не готов — смещается с линии огня
      if (this.threatT > 0 && this.aimSide !== 0) {
        want.addScaledVector(this.aimPerp, this.aimSide * speed * (this.kind === 'spinner' ? 0.9 : 0.6));
        if (want.length() > speed) want.setLength(speed);
      }
      // зигзаг воина, чтобы в него было труднее попасть
      if (this.kind === 'warrior' && want.lengthSq() > 1) {
        const perp = new THREE.Vector3(want.z, 0, -want.x).normalize();
        want.addScaledVector(perp, Math.sin(this.time * 5.5) * speed * 0.35);
      }
    }
    // не толпиться
    for (const o of ctx.others) {
      if (o === this || o.dead || !o.active) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      const min = this.radius + o.radius + 0.3;
      if (d < min && d > 1e-3) want.add(new THREE.Vector3(dx / d, 0, dz / d).multiplyScalar((min - d) * 6));
    }
    if (speed >= 0) this.vel.lerp(want, damp(10, dt));
    this.pos.addScaledVector(this.vel, dt);
    this.keepOffHero(ctx);
    resolveCircle(this.pos, this.radius * 0.8, ctx.obstacles);
    if (speed > 0 && this.vel.lengthSq() > 0.3) this.yaw = wrap(this.yaw + wrap(Math.atan2(this.vel.x, this.vel.z) - this.yaw) * damp(9, dt));
    else if (goal) this.faceTo(ctx.hero.pos, dt, 6);
  }

  /** Не залезать на героя: тела не пересекаются */
  private keepOffHero(ctx: ArachnidContext): void {
    const H = ctx.hero.pos;
    const dx = this.pos.x - H.x, dz = this.pos.z - H.z;
    const d = Math.hypot(dx, dz);
    const min = this.radius * 0.8 + 0.4;
    if (d < min) {
      const k = d > 1e-3 ? 1 / d : 0;
      this.pos.x = H.x + (d > 1e-3 ? dx * k : Math.sin(this.yaw + Math.PI)) * min;
      this.pos.z = H.z + (d > 1e-3 ? dz * k : Math.cos(this.yaw + Math.PI)) * min;
    }
  }

  private faceTo(p: THREE.Vector3, dt: number, rate: number): void {
    const a = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw = wrap(this.yaw + wrap(a - this.yaw) * damp(rate, dt));
  }

  // ---------- анимация ----------

  private plantFeet(): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    for (const l of this.legs) {
      l.foot.copy(l.home).applyQuaternion(q).add(this.pos).setY(0);
      l.stepT = 1;
    }
  }

  private pose(dt: number): void {
    const s = this.T.scale;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const j = this.jump;
    const jk = j ? Math.min(1, j.t / j.dur) : 0;
    const air = j ? Math.sin(jk * Math.PI) * j.h : 0;
    const crouch = this.state === 'замах' ? 0.25 : this.state === 'оглушён' ? 0.3 : 0;
    const sleep = this.state === 'спит' ? 0.12 + Math.sin(this.time * 1.6 + this.spawn.x) * 0.02 : 0;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const bob = j ? 0 : Math.sin(this.time * 14) * 0.03 * Math.min(1, speed / 3);
    const wantY = this.bodyY - crouch * s - sleep * s + air + bob;
    this.bodyY0 += (wantY - this.bodyY0) * (j ? 1 : damp(14, dt || 1));

    this.root.position.set(0, 0, 0);
    this.body.position.set(this.pos.x, this.bodyY0, this.pos.z);
    const pitch = this.state === 'просыпается' ? -0.35 : this.state === 'замах' ? -0.2 : this.state === 'удар' ? 0.15 : j?.kind === 'pounce' ? -0.25 + jk * 0.5 : 0;
    this.body.rotation.set(pitch, this.yaw, Math.sin(this.time * 7) * 0.02 * Math.min(1, speed / 3));

    // клешни: подняты; на замахе — выше, на ударе — рубят вниз
    const t = this.time;
    for (let i = 0; i < 2; i++) {
      const c = this.claws[i];
      const blade = c.userData.blade as THREE.Group;
      // клешни висят под головой: на замахе вскидываются вперёд-вверх, ударом рубят вниз
      let rx = -0.35 + Math.sin(t * 2 + i) * 0.06, br = 0;
      if (this.state === 'замах' || this.state === 'просыпается') { rx = -1.75; br = 0.5; }
      if (this.state === 'удар') { rx = -0.25; br = -0.6; }
      if (this.state === 'спит') { rx = -0.12; br = 0.2; }
      c.rotation.x += (rx - c.rotation.x) * damp(20, dt || 1);
      blade.rotation.x += (br - blade.rotation.x) * damp(20, dt || 1);
      c.rotation.z = (i ? -1 : 1) * 0.12;
    }
    // челюсти
    const open = this.state === 'замах' || this.state === 'просыпается' || this.state === 'плевок' ? 0.5 : 0.12 + Math.sin(t * 9) * 0.05;
    this.jawL.rotation.z = 0.1 + open * 0.8; this.jawR.rotation.z = -0.1 - open * 0.8;
    // рога поднимаются на замахе
    const hornUp = this.state === 'замах' || this.state === 'просыпается' ? -0.35 : this.state === 'спит' ? 0.45 : 0.2 + Math.sin(t * 1.7) * 0.04;
    for (const h of this.horns) h.rotation.x += (hornUp - h.rotation.x) * damp(10, dt || 1);

    // свечение полос: пульс, ярче на замахе; у прыгуна — переливается
    let glowK = 0.85 + Math.sin(t * 3 + this.spawn.x) * 0.15;
    if (this.state === 'замах' || this.state === 'плевок') glowK = 1.6;
    if (this.state === 'спит') glowK = 0.55;
    if (this.kind === 'leaper') {
      const hue = (t * 0.25 + this.spawn.x * 0.05) % 1;
      this.stripe.color.setHSL(hue, 1, 0.5).multiplyScalar(2.5 * glowK);
    } else this.stripe.color.copy(this.stripeBase).multiplyScalar(glowK);
    this.shell.emissive.setScalar(this.hitFlash > 0 ? 0.6 : 0);
    if (this.sac) this.sac.scale.setScalar(1 + (this.state === 'плевок' ? 0.15 : 0) + Math.sin(t * 4) * 0.03);

    // ноги: шагают двумя группами, в прыжке поджаты
    this.body.updateMatrixWorld(true);
    const stepDist = (0.7 + Math.min(1, speed / 6) * 0.6) * s;
    const stepTime = Math.max(0.07, 0.16 - speed * 0.01);
    for (const l of this.legs) {
      const hip = l.hip.clone().applyMatrix4(this.body.matrixWorld);
      const home = l.home.clone().applyQuaternion(yawQ).add(this.pos).setY(0);
      if (j) {
        // в полёте ноги тянутся вперёд-вниз за телом
        const tuck = l.home.clone().multiplyScalar(0.75).applyQuaternion(yawQ).add(this.pos);
        tuck.y = Math.max(0, this.bodyY0 - 1.5 * s);
        l.foot.lerp(tuck, damp(18, dt || 1));
      } else if (this.state === 'спит') {
        l.foot.copy(home);
      } else {
        if (l.stepT < 1) {
          l.stepT = Math.min(1, l.stepT + (dt || 0) / stepTime);
          l.foot.lerpVectors(l.stepFrom, l.stepTo, ease(l.stepT));
          l.foot.y = Math.sin(l.stepT * Math.PI) * 0.5 * s;
        } else {
          const lead = home.clone().addScaledVector(this.vel, stepTime * 1.2);
          const busy = this.legs.some((o) => o.group !== l.group && o.stepT < 1);
          if (!busy && l.foot.distanceTo(lead) > stepDist) {
            l.stepFrom.copy(l.foot);
            l.stepTo.copy(lead).setY(0);
            l.stepT = 0;
          }
        }
      }
      const pole = new THREE.Vector3(l.side * 0.6, 1.4, 0).applyQuaternion(yawQ);
      const knee = new THREE.Vector3();
      solveIK(hip, l.foot, this.FEMUR, this.TIBIA, pole, knee);
      aimSegment(l.femur, hip, knee);
      aimSegment(l.tibia, knee, l.foot);
    }
  }
  private bodyY0 = 2.15;

  /** Обломки панциря и светящиеся осколки полос */
  explode(): void {
    const p = this.pos.clone().setY(this.bodyY0);
    const c = this.stripe.color.clone();
    this.fx.burst(p, ['#1b1e24', '#0f1114', '#4a1c16'], 22, { speed: 4.5, up: 5, size: 0.2 * this.T.scale, life: 1.4 });
    this.fx.burst(p, [c], 16, { speed: 4, up: 4, size: 0.08, life: 0.8, glow: true, gravity: 8 });
    this.fx.flash(p, c.clone().multiplyScalar(0.6), 2.4, 0.25);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.shell.dispose();
    this.stripe.dispose();
  }

  /** Текущий путь — для оверлея F2 */
  get debugPath(): readonly THREE.Vector3[] { return this.path; }
}
