import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import type { Target } from '../target';
import { pixelTex } from '../textures';
import { C, glowMat, UNIT, wrap } from '../bosses/kit';
import { boom, hiss, voice } from '../spell-audio';
import { MAX_LEVEL, TOWERS, UPGRADE_DMG, UPGRADE_RANGE, upgradeCost, type TowerDef, type TowerKind } from './towers';

/**
 * Башня обороны куста (wiki/design-tower-defence.md): стоит на площадке, сама выбирает цель — того, кто дальше всех
 * прошёл по дороге, — и бьёт по-своему (src/td/towers.ts). Модель из кубиков в стиле мобов, уровни I–III меняют
 * урон, дальность и вид. Урон идёт в Target.hit, как от меча: мобы вспыхивают, рассыпаются, роняют малину.
 *
 * Пять видов (раздел 3 вики): стрелковая вышка — болты по одному; морозный шпиль — ледяной сгусток, замедляет;
 * катапульта — камень по дуге, взрыв по площади; огненная жаровня — струя пламени конусом, поджигает;
 * волшебный обелиск — сфера, бьёт цепью и ослабляет.
 */

/** Враг для башни: цель с долей пройденной дороги (кто ближе к кусту — тот первый) */
export interface Foe extends Target {
  readonly progress?: number;
  readonly dead: boolean;
}

export interface TowerHooks {
  scene: THREE.Scene;
  fx: FX;
  quiet(): boolean;
  /** Живые враги на карте */
  foes(): readonly Foe[];
}

const WOOD = '#8a5a34', WOOD_DARK = '#5e3c22', STONE = '#8d939b', STONE_DARK = '#5c6168', IRON = '#3a3c42';
const ICE = C(1.6, 3.2, 4), ICE_DEEP = C(0.6, 1.4, 3), FIRE = C(3.6, 1.6, 0.4), EMBER = C(3.2, 0.8, 0.2), ARCANE = C(2.6, 1.2, 4), ARCANE_DEEP = C(1.2, 0.4, 2.6);
const _dir = new THREE.Vector3();

/** Снаряд по прямой: летит к точке, где была цель, попадает — hit */
interface Bolt { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; hit: () => void }
/** Снаряд по дуге: камень катапульты */
interface Lob { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number; land: (at: THREE.Vector3) => void }
/** Горящий враг: тики урона */
interface Burn { foe: Foe; t: number; tick: number; dmg: number }

export class Tower {
  readonly def: TowerDef;
  readonly pos: THREE.Vector3;
  readonly group = new THREE.Group();
  level = 1;
  /** Всего вложено малины (постройка и улучшения) — для продажи */
  spent: number;
  /** Текущая цель */
  target: Foe | null = null;
  /** Счётчики для тестов и подписи */
  shots = 0;
  dealt = 0;
  kills = 0;
  readonly solid: Obstacle;
  private cd = 0.3;
  private time = 0;
  private readonly body = new THREE.Group();
  /** Поворотная часть (арбалет, рычаг, кристалл) — смотрит на цель */
  private readonly turret = new THREE.Group();
  /** Подвижная деталь внутри поворотной: рычаг катапульты, парящая руна */
  private readonly arm = new THREE.Group();
  private readonly lamps: THREE.MeshLambertMaterial[] = [];
  private readonly glows: THREE.MeshBasicMaterial[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly lobs: Lob[] = [];
  private readonly burns: Burn[] = [];
  private recoil = 0;
  private readonly h: TowerHooks;

  constructor(h: TowerHooks, kind: TowerKind, x: number, z: number) {
    this.h = h;
    this.def = TOWERS[kind];
    this.spent = this.def.cost;
    this.pos = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.pos);
    this.group.add(this.body);
    this.solid = { x, z, hx: 0.75, hz: 0.75, rot: 0, h: 2.5 };
    this.build();
    h.scene.add(this.group);
  }

  get kind(): TowerKind { return this.def.id; }
  get range(): number { return this.def.range + UPGRADE_RANGE[this.level - 1]; }
  get dmg(): number { return Math.round(this.def.dmg * UPGRADE_DMG[this.level - 1]); }
  get title(): string { return `${this.def.title} ${['I', 'II', 'III'][this.level - 1]}`; }
  /** Цена следующего улучшения; null — предел */
  get nextCost(): number | null { return this.level >= MAX_LEVEL ? null : upgradeCost(this.def, this.level + 1); }
  /** Сколько врагов горит (для тестов) */
  get burning(): number { return this.burns.length; }

  /** Улучшить на уровень: урон и дальность растут, модель получает знак уровня */
  upgrade(): boolean {
    const cost = this.nextCost;
    if (cost === null) return false;
    this.level++;
    this.spent += cost;
    this.build();
    const c = new THREE.Color(this.def.color);
    this.h.fx.flash(this.pos.clone().setY(1.6), c.clone().multiplyScalar(2.5), 2.4, 0.3);
    this.h.fx.burst(this.pos.clone().setY(0.6), [c.clone().multiplyScalar(2.2), '#ffffff'], 18, { speed: 3, up: 4, size: 0.1, life: 0.7, glow: true, gravity: 6 });
    this.h.fx.shock(this.pos.clone().setY(0.06), 2.2, c.clone().multiplyScalar(2), 0.4, 0.14);
    if (!this.h.quiet()) voice({ type: 'triangle', f: 520, f1: 1040, dur: 0.3, vol: 0.06 });
    return true;
  }

  dispose(): void {
    for (const b of this.bolts.splice(0)) this.dropMesh(b.mesh);
    for (const l of this.lobs.splice(0)) this.dropMesh(l.mesh);
    this.burns.length = 0;
    this.h.scene.remove(this.group);
    for (const m of this.lamps) m.dispose();
    for (const m of this.glows) m.dispose();
  }

  private dropMesh(m: THREE.Mesh): void { this.h.scene.remove(m); (m.material as THREE.Material).dispose(); }

  // ---------- модель ----------
  private lam(color: string, tex = true, seed = 0): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial(tex ? { map: pixelTex(color, 10, 900 + seed + this.lamps.length) } : { color });
    this.lamps.push(m);
    return m;
  }
  private glow(c: THREE.Color): THREE.MeshBasicMaterial { const m = glowMat(c); this.glows.push(m); return m; }
  private box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(UNIT, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = !(mat instanceof THREE.MeshBasicMaterial);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** Собрать модель заново (постройка, улучшение) */
  private build(): void {
    this.body.clear();
    this.turret.clear();
    this.arm.clear();
    this.arm.position.set(0, 0, 0); this.arm.rotation.set(0, 0, 0);
    for (const m of this.lamps.splice(0)) m.dispose();
    for (const m of this.glows.splice(0)) m.dispose();
    const B = this.box.bind(this);
    const stone = this.lam(STONE), dark = this.lam(STONE_DARK);
    // каменное основание: восьмиугольник из двух повёрнутых плит и бортик
    B(this.body, dark, 2.2, 0.3, 2.2, 0, 0.15, 0);
    B(this.body, dark, 2.2, 0.3, 2.2, 0, 0.15, 0, 0, Math.PI / 4, 0);
    B(this.body, stone, 1.7, 0.2, 1.7, 0, 0.4, 0);
    B(this.body, stone, 1.7, 0.2, 1.7, 0, 0.4, 0, 0, Math.PI / 4, 0);
    switch (this.def.id) {
      case 'frost': this.buildFrost(); break;
      case 'splash': this.buildSplash(); break;
      case 'fire': this.buildFire(); break;
      case 'magic': this.buildMagic(); break;
      default: this.buildArrow(); break;
    }
    // знак уровня: малиновые ягоды-светильники на углах основания — одна, две
    const berry = this.glow(C(3.2, 0.5, 1.2));
    for (let i = 0; i < this.level - 1; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      B(this.body, berry, 0.16, 0.16, 0.16, Math.cos(a) * 1.05, 0.58, Math.sin(a) * 1.05);
    }
  }

  /** Стрелковая вышка: четыре столба, площадка с перилами, навес; на ней — арбалет на вертлюге */
  private buildArrow(): void {
    const B = this.box.bind(this);
    const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK), iron = this.lam(IRON, false);
    const H = 2.0;
    for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) B(this.body, woodD, 0.16, H, 0.16, x, 0.5 + H / 2, z);
    for (const s of [-1, 1]) { B(this.body, woodD, 0.08, 1.5, 0.08, s * 0.55, 1.2, 0, 0.6, 0, 0); B(this.body, woodD, 0.08, 1.5, 0.08, 0, 1.2, s * 0.55, 0, 0, 0.6); }
    B(this.body, wood, 1.4, 0.14, 1.4, 0, 0.5 + H, 0);
    for (const s of [-1, 1]) { B(this.body, woodD, 1.4, 0.08, 0.08, 0, 0.5 + H + 0.4, s * 0.66); B(this.body, woodD, 0.08, 0.08, 1.4, s * 0.66, 0.5 + H + 0.4, 0); }
    for (const [x, z] of [[-0.66, -0.66], [0.66, -0.66], [-0.66, 0.66], [0.66, 0.66]]) B(this.body, woodD, 0.1, 0.5, 0.1, x, 0.5 + H + 0.25, z);
    if (this.level >= 2) {
      for (const [x, z] of [[-0.6, -0.6], [0.6, 0.6]]) B(this.body, woodD, 0.08, 1.1, 0.08, x, 0.5 + H + 0.55, z);
      B(this.body, this.lam('#a8443a'), 1.7, 0.1, 1.7, 0, 0.5 + H + 1.12, 0, 0.12, 0, 0);
    }
    if (this.level >= 3) { B(this.body, woodD, 0.06, 0.9, 0.06, 0.6, 0.5 + H + 1.6, -0.6); B(this.body, this.lam('#d8285a', false), 0.44, 0.24, 0.03, 0.82, 0.5 + H + 1.9, -0.6); }
    this.turret.position.set(0, 0.5 + H + 0.25, 0);
    this.body.add(this.turret);
    B(this.turret, iron, 0.12, 0.3, 0.12, 0, 0.1, 0);
    B(this.turret, woodD, 0.14, 0.12, 0.9, 0, 0.32, 0.1);
    B(this.turret, iron, 0.9, 0.06, 0.08, 0, 0.34, 0.4);
    B(this.turret, this.lam('#e8e0c8', false), 0.84, 0.02, 0.02, 0, 0.36, 0.26);
    B(this.turret, this.glow(C(2.2, 2.0, 1.2)), 0.05, 0.05, 0.5, 0, 0.4, 0.3);
  }

  /** Морозный шпиль: каменный постамент, ледяной кристалл из наклонных граней, осколки вокруг; кристалл поворачивается к цели */
  private buildFrost(): void {
    const B = this.box.bind(this);
    const stone = this.lam('#7f8ea0'), ice = this.glow(ICE), deep = this.glow(ICE_DEEP), rime = this.lam('#dceeff', false);
    B(this.body, stone, 1.0, 0.5, 1.0, 0, 0.75, 0);
    B(this.body, stone, 0.7, 0.3, 0.7, 0, 1.15, 0, 0, Math.PI / 4, 0);
    this.turret.position.set(0, 1.3, 0);
    this.body.add(this.turret);
    // главный кристалл: две призмы крестом, сужаются кверху; наклонён вперёд
    const h = 1.6 + this.level * 0.25;
    B(this.turret, deep, 0.5, h, 0.5, 0, h / 2, 0, 0.18, Math.PI / 4, 0);
    B(this.turret, ice, 0.3, h * 1.15, 0.3, 0, h * 0.55, 0.05, 0.22, 0, 0);
    B(this.turret, ice, 0.14, 0.4, 0.14, 0, h * 1.12, 0.2, 0.3, Math.PI / 4, 0);
    // осколки по кругу: больше с уровнем
    for (let i = 0; i < 3 + this.level * 2; i++) {
      const a = (i / (3 + this.level * 2)) * Math.PI * 2, r = 0.7 + (i % 2) * 0.2;
      B(this.body, i % 3 === 0 ? ice : deep, 0.16, 0.4 + (i % 2) * 0.3, 0.16, Math.cos(a) * r, 0.7, Math.sin(a) * r, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
    }
    // иней на постаменте
    for (const s of [-1, 1]) B(this.body, rime, 0.5, 0.06, 0.2, s * 0.3, 1.02, 0.4);
  }

  /** Катапульта: рама из брёвен, рычаг с ковшом и противовесом; рычаг отбрасывает камень */
  private buildSplash(): void {
    const B = this.box.bind(this);
    const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK), iron = this.lam(IRON, false), rock = this.lam('#6a6a70');
    this.turret.position.set(0, 0.5, 0);
    this.body.add(this.turret);
    // станина с колёсами, две стойки с осью
    B(this.turret, woodD, 1.3, 0.16, 0.5, 0, 0.1, -0.2);
    for (const s of [-1, 1]) { B(this.turret, woodD, 0.2, 0.5, 0.2, s * 0.55, 0.3, -0.5, 0, 0, 0); B(this.turret, woodD, 0.16, 1.0, 0.16, s * 0.4, 0.6, -0.2, 0.3, 0, 0); }
    B(this.turret, iron, 1.0, 0.1, 0.1, 0, 1.05, -0.35);
    for (const s of [-1, 1]) B(this.turret, wood, 0.12, 0.5, 0.5, s * 0.72, 0.25, -0.2, 0, 0, 0);
    // рычаг на оси: ковш впереди, противовес сзади; в покое ковш опущен назад (взведён)
    this.arm.position.set(0, 1.05, -0.35);
    this.turret.add(this.arm);
    B(this.arm, wood, 0.14, 0.14, 2.0, 0, 0, 0.4);
    B(this.arm, woodD, 0.44, 0.2, 0.44, 0, 0.1, 1.35);
    B(this.arm, rock, 0.28, 0.28, 0.28, 0, 0.26, 1.35);
    B(this.arm, iron, 0.5, 0.5, 0.4, 0, -0.1, -0.5);
    if (this.level >= 2) B(this.arm, iron, 0.6, 0.6, 0.3, 0, -0.1, -0.75);
    if (this.level >= 3) B(this.turret, this.lam('#d8285a', false), 0.5, 0.3, 0.03, 0.9, 1.35, -0.4);
    this.arm.rotation.x = 0.7;
    // запас камней у основания
    for (const [x, z] of [[0.75, 0.55], [0.55, 0.75], [0.68, 0.72]]) B(this.body, rock, 0.26, 0.26, 0.26, x, 0.63, z);
  }

  /** Огненная жаровня: железная чаша на каменных ногах, в ней угли и пламя; чаша с носиком поворачивается к цели */
  private buildFire(): void {
    const B = this.box.bind(this);
    const iron = this.lam(IRON, false), stone = this.lam(STONE_DARK), coal = this.glow(EMBER), flame = this.glow(FIRE);
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; B(this.body, stone, 0.26, 0.7, 0.26, Math.cos(a) * 0.5, 0.85, Math.sin(a) * 0.5, 0, a, 0); }
    this.turret.position.set(0, 1.2, 0);
    this.body.add(this.turret);
    // чаша: кольцо из четырёх стенок и дно, угли сверху, носик вперёд
    B(this.turret, iron, 1.1, 0.12, 1.1, 0, 0, 0);
    for (const s of [-1, 1]) { B(this.turret, iron, 1.2, 0.5, 0.1, 0, 0.25, s * 0.55); B(this.turret, iron, 0.1, 0.5, 1.2, s * 0.55, 0.25, 0); }
    B(this.turret, coal, 0.9, 0.3, 0.9, 0, 0.25, 0);
    B(this.turret, flame, 0.5, 0.5 + this.level * 0.15, 0.5, 0, 0.6, 0, 0, Math.PI / 4, 0);
    B(this.turret, flame, 0.3, 0.9 + this.level * 0.2, 0.3, 0.1, 0.75, -0.1);
    B(this.turret, iron, 0.4, 0.2, 0.5, 0, 0.3, 0.75);
    B(this.turret, iron, 0.5, 0.24, 0.1, 0, 0.3, 1.0);
    if (this.level >= 2) B(this.turret, iron, 1.4, 0.06, 0.06, 0, 0.55, 0, 0, Math.PI / 4, 0);
    if (this.level >= 3) for (const s of [-1, 1]) B(this.turret, flame, 0.2, 0.5, 0.2, s * 0.45, 0.6, -0.45);
    // кочерга у ног
    B(this.body, iron, 0.06, 1.2, 0.06, -0.8, 1.0, 0.6, 0.3, 0, 0.25);
  }

  /** Волшебный обелиск: тёмный столб с сужением и резьбой, над ним парит светящаяся руна */
  private buildMagic(): void {
    const B = this.box.bind(this);
    const obs = this.lam('#2e2440'), trim = this.glow(ARCANE_DEEP), rune = this.glow(ARCANE);
    B(this.body, obs, 0.8, 0.4, 0.8, 0, 0.7, 0);
    B(this.body, obs, 0.6, 1.8, 0.6, 0, 1.8, 0);
    B(this.body, obs, 0.4, 0.5, 0.4, 0, 2.95, 0);
    // резьба: светящиеся полосы
    for (const y of [1.2, 1.8, 2.4]) for (const s of [-1, 1]) { B(this.body, trim, 0.3, 0.06, 0.02, 0, y, s * 0.31); B(this.body, trim, 0.02, 0.06, 0.3, s * 0.31, y, 0); }
    this.turret.position.set(0, 3.5, 0);
    this.body.add(this.turret);
    this.turret.add(this.arm);
    B(this.arm, rune, 0.36, 0.36, 0.36, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
    B(this.arm, trim, 0.5, 0.08, 0.08, 0, 0, 0, 0, Math.PI / 4, 0);
    for (let i = 1; i < this.level; i++) B(this.arm, rune, 0.14, 0.14, 0.14, Math.cos(i * 2.1) * 0.55, 0.1 * i, Math.sin(i * 2.1) * 0.55);
    // камни-спутники у основания
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4; B(this.body, obs, 0.2, 0.5 + (i % 2) * 0.3, 0.2, Math.cos(a) * 0.85, 0.7, Math.sin(a) * 0.85, 0.2, a, 0); }
  }

  // ---------- бой ----------
  /** Цель: кто дальше всех прошёл по дороге из тех, кто в радиусе */
  private pick(): Foe | null {
    let best: Foe | null = null, bp = -Infinity;
    const r = this.range;
    for (const f of this.h.foes()) {
      if (!f.alive || f.dead) continue;
      const d = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) - f.radius;
      if (d > r) continue;
      const p = f.progress ?? 0;
      if (p > bp) { bp = p; best = f; }
    }
    return best;
  }

  private inRange(f: Foe): boolean { return f.alive && !f.dead && Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) - f.radius <= this.range + 0.5; }

  /** Нанести урон цели от башни (учёт для подписи и тестов) */
  private strike(f: Foe, dmg: number, knock: number, point: THREE.Vector3, cls = ''): void {
    if (!f.alive || dmg <= 0) return;
    _dir.set(f.pos.x - this.pos.x, 0, f.pos.z - this.pos.z).normalize();
    f.hit(dmg, _dir, point, knock);
    this.dealt += dmg;
    this.h.fx.text(point.clone().setY(point.y + 0.3), String(dmg), cls);
    if (!f.alive) this.kills++;
  }

  /** Враги в радиусе r от точки (кроме except) */
  private around(at: THREE.Vector3, r: number, except: Foe | null = null): Foe[] {
    return this.h.foes().filter((f) => f !== except && f.alive && !f.dead && Math.hypot(f.pos.x - at.x, f.pos.z - at.z) - f.radius <= r);
  }

  /** Откуда вылетает снаряд: вершина башни, чуть вперёд по повороту */
  private muzzle(y: number, ahead: number): THREE.Vector3 {
    return this.pos.clone().add(new THREE.Vector3(Math.sin(this.turret.rotation.y) * ahead, y, Math.cos(this.turret.rotation.y) * ahead));
  }
  private chest(t: Foe): THREE.Vector3 { return t.pos.clone().setY(t.pos.y + Math.min(1, (t.topY ?? 1.4) * 0.6)); }

  private fire(t: Foe): void {
    this.shots++;
    this.recoil = 1;
    switch (this.def.id) {
      case 'frost': this.fireFrost(t); break;
      case 'splash': this.fireSplash(t); break;
      case 'fire': this.fireFlame(); break;
      case 'magic': this.fireMagic(t); break;
      default: this.fireArrow(t); break;
    }
  }

  private bolt(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, size: number, speed: number, hit: () => void): void {
    const mesh = new THREE.Mesh(UNIT, glowMat(color));
    mesh.scale.set(size, size, size * 6);
    mesh.position.copy(from);
    mesh.lookAt(to);
    this.h.scene.add(mesh);
    this.bolts.push({ mesh, from, to, t: 0, dur: from.distanceTo(to) / speed, hit });
  }

  /** Болт: летит по прямой к цели, попал — урон */
  private fireArrow(t: Foe): void {
    const to = this.chest(t), dmg = this.dmg;
    this.bolt(this.muzzle(2.9, 0.5), to, C(2.4, 2.1, 1.2), 0.06, 34, () => this.strike(t, dmg, 0.4, to));
    if (!this.h.quiet()) hiss({ dur: 0.08, vol: 0.08, f: 2600, f1: 900, q: 1.2 });
  }

  /** Ледяной сгусток: урон и замедление; на III — иней по площади вокруг цели */
  private fireFrost(t: Foe): void {
    const to = this.chest(t), dmg = this.dmg, lvl = this.level;
    const from = this.muzzle(2.9 + lvl * 0.2, 0.3);
    this.bolt(from, to, ICE, 0.16, 22, () => {
      const at = t.pos.clone().setY(0.6);
      this.h.fx.burst(at, [ICE, '#ffffff', ICE_DEEP], 12, { speed: 2.5, up: 2, size: 0.08, life: 0.5, glow: true, gravity: 6 });
      this.strike(t, dmg, 0.2, to);
      t.chill?.(0.45, 2.2);
      if (lvl >= 3) {
        for (const f of this.around(at, 2, t)) { this.strike(f, Math.round(dmg * 0.5), 0, f.pos.clone().setY(1)); f.chill?.(0.45, 2.2); }
        this.h.fx.shock(at.clone().setY(0.06), 2.2, ICE, 0.35, 0.12);
      }
      if (!this.h.quiet()) hiss({ dur: 0.18, vol: 0.1, f: 3200, f1: 1400, q: 1.5 });
    });
    this.h.fx.particle({ pos: from, vel: new THREE.Vector3(0, 0.5, 0), life: 0.3, size: 0.12, color: ICE, gravity: 0 });
    if (!this.h.quiet()) voice({ type: 'triangle', f: 1400, f1: 900, dur: 0.15, vol: 0.04 });
  }

  /** Камень по дуге: взрыв по площади с отбросом, урон слабеет к краю */
  private fireSplash(t: Foe): void {
    const dmg = this.dmg, R = 2.4;
    const from = this.muzzle(2.0, -0.3), dist = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    const dur = 0.6 + dist * 0.05;
    const to = t.pos.clone().setY(0);
    const mesh = new THREE.Mesh(UNIT, new THREE.MeshLambertMaterial({ color: '#6a6a70' }));
    mesh.scale.setScalar(0.34);
    mesh.castShadow = true;
    mesh.position.copy(from);
    this.h.scene.add(mesh);
    this.lobs.push({ mesh, from, to, t: 0, dur, h: 3 + dist * 0.25, land: (at) => {
      this.h.fx.explosion(at.clone().setY(0.4), R, C(2.2, 1.6, 1.0));
      this.h.fx.burst(at.clone().setY(0.3), ['#8a8a90', '#5a5a60', '#c8b890'], 16, { speed: 4, up: 4, size: 0.14, life: 0.7, gravity: 10 });
      this.h.fx.shake = Math.max(this.h.fx.shake, 0.3);
      for (const f of this.around(at, R)) {
        const d = Math.hypot(f.pos.x - at.x, f.pos.z - at.z), k = Math.max(0.4, 1 - d / R);
        this.strike(f, Math.round(dmg * k), 2.5 * k, f.pos.clone().setY(1), k > 0.8 ? 'crit' : '');
      }
      if (!this.h.quiet()) boom(140, 40, 0.5, 0.45);
    } });
    if (!this.h.quiet()) { hiss({ dur: 0.2, vol: 0.08, f: 600, f1: 300, q: 1 }); boom(300, 120, 0.12, 0.2); }
  }

  /** Струя пламени: все в конусе перед жаровней получают урон и горят ещё 3 с */
  private fireFlame(): void {
    const dmg = this.dmg, R = this.range;
    const yaw = this.turret.rotation.y, dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const from = this.muzzle(1.6, 0.9);
    this.h.fx.spray(from, dir.clone().setY(0.05), [FIRE, EMBER, '#ffd060'], 14, { speed: 9, size: 0.14, life: 0.55, gravity: -1, spread: 0.22 });
    this.h.fx.light(from.clone().addScaledVector(dir, 2), FIRE, 6, 7, 0.25);
    for (const f of this.h.foes()) {
      if (!f.alive || f.dead) continue;
      const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d - f.radius > R || Math.abs(wrap(Math.atan2(dx, dz) - yaw)) > 0.42 + Math.atan(f.radius / Math.max(d, 0.5))) continue;
      this.strike(f, dmg, 0.1, f.pos.clone().setY(1));
      const b = this.burns.find((x) => x.foe === f);
      if (b) b.t = 3; else this.burns.push({ foe: f, t: 3, tick: 1, dmg: Math.max(1, Math.round(dmg * 0.3)) });
    }
    if (!this.h.quiet()) hiss({ dur: 0.35, vol: 0.12, f: 900, f1: 400, q: 0.6, type: 'lowpass' });
  }

  /** Сфера: летит к цели по дуге, ослабляет и бьёт; цепью — ещё по соседям (столько, какой уровень) */
  private fireMagic(t: Foe): void {
    const dmg = this.dmg, lvl = this.level, from = this.muzzle(3.5, 0), fx = this.h.fx;
    const dist = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z), up = 1.5 + dist * 0.15;
    const o = new THREE.Vector3();
    fx.streak({
      path: (k, out) => { const to = this.chest(t); out.lerpVectors(from, to, k); out.y += Math.sin(k * Math.PI) * up; return out; },
      dur: 0.25 + dist * 0.035, color: ARCANE, color2: ARCANE_DEEP, width: 0.16, tail: 0.3, halo: 2.4, core: 0.6,
      onHead: (p) => { if (Math.random() < 0.4) fx.particle({ pos: o.copy(p), vel: new THREE.Vector3(0, 0.3, 0), life: 0.3, size: 0.07, color: ARCANE, gravity: 0 }); },
      onEnd: () => {
        const at = this.chest(t);
        fx.flash(at, ARCANE, 1.6, 0.2);
        fx.burst(at, [ARCANE, '#ffffff', ARCANE_DEEP], 14, { speed: 3, up: 2, size: 0.08, life: 0.5, glow: true, gravity: 4 });
        t.expose?.(0.3, 3);
        this.strike(t, dmg, 0.3, at, 'crit');
        let prev = t, n = 0;
        for (const f of this.around(t.pos, 4, t).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))) {
          if (n++ >= lvl) break;
          fx.bolt(this.chest(prev), this.chest(f), ARCANE, 0.08, 2, 0.25);
          f.expose?.(0.3, 3);
          this.strike(f, Math.round(dmg * 0.6), 0.2, this.chest(f));
          prev = f;
        }
        if (!this.h.quiet()) { voice({ type: 'sine', f: 880, f1: 440, dur: 0.25, vol: 0.06 }); if (n) hiss({ dur: 0.1, vol: 0.06, f: 4000, f1: 2000, q: 2 }); }
      },
    });
    if (!this.h.quiet()) voice({ type: 'sine', f: 440, f1: 880, dur: 0.2, vol: 0.05 });
  }

  update(dt: number): void {
    this.time += dt;
    this.cd -= dt;
    this.recoil = Math.max(0, this.recoil - dt * (this.def.id === 'splash' ? 1.2 : 6));
    // цель: держим прежнюю, пока жива и в радиусе, иначе — первого по дороге
    if (!this.target || !this.inRange(this.target)) this.target = this.pick();
    const t = this.target;
    if (t) {
      const want = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), d = wrap(want - this.turret.rotation.y), m = (this.def.id === 'splash' ? 3 : 9) * dt;
      this.turret.rotation.y += Math.max(-m, Math.min(m, d));
      if (this.cd <= 0 && Math.abs(d) < 0.5) { this.cd = this.def.cd; this.fire(t); }
    }
    this.animate(dt);
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.mesh.position.lerpVectors(b.from, b.to, k);
      if (k >= 1) { this.bolts.splice(i, 1); this.dropMesh(b.mesh); b.hit(); }
    }
    for (let i = this.lobs.length - 1; i >= 0; i--) {
      const l = this.lobs[i];
      l.t += dt;
      const k = Math.min(1, l.t / l.dur);
      l.mesh.position.lerpVectors(l.from, l.to, k);
      l.mesh.position.y += Math.sin(k * Math.PI) * l.h;
      l.mesh.rotation.x += dt * 6; l.mesh.rotation.z += dt * 4;
      if (k >= 1) { this.lobs.splice(i, 1); this.dropMesh(l.mesh); l.land(l.to); }
    }
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i];
      b.t -= dt; b.tick -= dt;
      if (!b.foe.alive || b.foe.dead || b.t <= 0) { this.burns.splice(i, 1); continue; }
      if (Math.random() < 0.35) this.h.fx.particle({ pos: b.foe.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * (b.foe.topY ?? 1.2), (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3(0, 1.5, 0), life: 0.4, size: 0.1, color: Math.random() < 0.5 ? FIRE : EMBER, gravity: 0 });
      if (b.tick <= 0) { b.tick = 1; this.strike(b.foe, b.dmg, 0, b.foe.pos.clone().setY(1.2)); }
    }
  }

  /** Живая деталь: отдача арбалета, рычаг катапульты, парящая руна, искры жаровни, покачивание кристалла */
  private animate(dt: number): void {
    switch (this.def.id) {
      case 'arrow': this.turret.position.z = -this.recoil * 0.12; break;
      case 'splash': this.arm.rotation.x = this.recoil > 0.7 ? -0.9 : 0.7 - (this.recoil / 0.7) * 1.6; break;
      case 'magic':
        this.arm.position.y = Math.sin(this.time * 2) * 0.12;
        this.arm.rotation.y += dt * (1 + this.recoil * 8);
        break;
      case 'fire':
        if (Math.random() < 0.3) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.9, (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2 + Math.random(), (Math.random() - 0.5) * 0.4), life: 0.5, size: 0.07, color: Math.random() < 0.6 ? FIRE : EMBER, gravity: 0 });
        break;
      case 'frost':
        this.turret.rotation.z = Math.sin(this.time * 1.3) * 0.04;
        if (Math.random() < 0.1) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.2)), vel: new THREE.Vector3(0, -0.3, 0), life: 0.8, size: 0.05, color: ICE, gravity: 0 });
        break;
    }
  }
}
