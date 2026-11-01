import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import type { Target } from '../target';
import { pixelTex } from '../textures';
import { C, glowMat, UNIT, wrap } from '../bosses/kit';
import { boom, hiss, voice } from '../spell-audio';
import { addDecoy, type Decoy } from '../decoys';
import { HpBar } from './hpbar';
import { MAX_LEVEL, REPAIR_COST, TOWERS, UPGRADE_DMG, UPGRADE_HP, UPGRADE_RANGE, upgradeCost, type TowerDef, type TowerKind } from './towers';

/**
 * Башня обороны куста (wiki/design-tower-defence.md): стоит на площадке, сама выбирает цель — того, кто дальше всех
 * прошёл по дороге, — и бьёт по-своему (src/td/towers.ts). Модель из кубиков в стиле мобов, уровни I–III меняют
 * урон, дальность и вид. Урон идёт в Target.hit, как от меча: мобы вспыхивают, рассыпаются, роняют малину.
 *
 * Пять видов (раздел 3 вики): стрелковая вышка — болты по одному; морозный шпиль — ледяной сгусток, замедляет;
 * катапульта — камень по дуге, взрыв по площади; огненная жаровня — струя пламени конусом, поджигает;
 * волшебный обелиск — сфера, бьёт цепью и ослабляет. Осада (раздел 9): стенная баллиста — тяжёлый болт по прямой сквозь
 * строй, пробивает броню (удар без направления, src/mobs/mob.ts); котёл со смолой — лужа под ногами: вязнут и горят.
 * Раздел 14, дорогие башни по площади: звездочёт — метеорит в самую плотную толпу; грозовой шпиль — молния цепью
 * по многим врагам; сердце зимы — вьюга вокруг: урон и замедление всем, каждый пятый удар — ледяная волна с оглушением.
 *
 * Прочность (раздел 10): для охотников на башни (Mob.hunter) башня — осадная приманка (src/decoys.ts). Сгрызли до нуля —
 * руины: не стреляет, дымит, чинится за малину с прежним уровнем. Ледяной колдунчик замораживает башню: не стреляет,
 * пока лёд не растает или герой не разобьёт его двумя ударами (лёд — цель меча, `ice`). Морозный шпиль не мёрзнет.
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
const TAR = '#1a1410', TAR_SHEEN = C(0.5, 0.35, 0.2);
const STAR = C(3.6, 2.6, 1.2), STAR_DEEP = C(2.4, 0.8, 2.8), VOLT = C(2.4, 3.0, 4), SNOW = C(2.6, 3.4, 4);
const _dir = new THREE.Vector3();
const ZERO = new THREE.Vector3();

/** Снаряд по прямой: летит к точке, где была цель, попадает — hit */
interface Bolt { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; hit: () => void }
/** Снаряд по дуге: камень катапульты */
interface Lob { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number; land: (at: THREE.Vector3) => void }
/** Горящий враг: тики урона */
interface Burn { foe: Foe; t: number; tick: number; dmg: number }
/** Лужа смолы: вязнут и горят, пока не высохла */
interface Pool { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; at: THREE.Vector3; t: number; tick: number; r: number }

/** Сколько ударов героя разбивают лёд на башне */
const ICE_HITS = 2;

export class Tower implements Decoy {
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
  readonly radius = 0.75;
  /** Охотник на башни видит её из этого радиуса */
  readonly taunt = 7;
  readonly siege = true;
  hp: number;
  maxHp: number;
  /** Заморожена ещё столько секунд */
  frozen = 0;
  /** Лёд на башне — цель меча героя, пока башня заморожена */
  readonly ice: Target;
  /** Башню ранили или заморозили — сигнал «башня в беде» (src/td/td.ts) */
  onAlarm?: (why: 'hurt' | 'frozen' | 'ruin') => void;
  private iceHits = 0;
  private readonly iceMesh: THREE.Mesh;
  private readonly bar = new HpBar(1.6, 3.4);
  private readonly dropDecoy: () => void;
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
  private readonly pools: Pool[] = [];
  private recoil = 0;
  private readonly h: TowerHooks;

  constructor(h: TowerHooks, kind: TowerKind, x: number, z: number, y = 0) {
    this.h = h;
    this.def = TOWERS[kind];
    this.spent = this.def.cost;
    this.pos = new THREE.Vector3(x, y, z);
    this.group.position.copy(this.pos);
    this.group.add(this.body);
    this.solid = { x, z, hx: 0.75, hz: 0.75, rot: 0, h: 2.5, y0: y };
    this.hp = this.maxHp = this.def.hp;
    this.build();
    this.iceMesh = new THREE.Mesh(UNIT, new THREE.MeshLambertMaterial({ color: '#bfe8ff', emissive: '#3a7aa8', transparent: true, opacity: 0.55 }));
    this.iceMesh.scale.set(2, 3, 2);
    this.iceMesh.position.y = 1.6;
    this.iceMesh.visible = false;
    this.group.add(this.iceMesh, this.bar.group);
    const me = this;
    this.ice = {
      pos: this.pos, radius: 1, topY: 3, prop: true,
      get alive() { return me.frozen > 0; },
      hit: () => me.chip(),
    };
    this.dropDecoy = addDecoy(this);
    h.scene.add(this.group);
  }

  /** Цела (для охотников): руины — уже не цель */
  get alive(): boolean { return this.hp > 0; }
  get ruined(): boolean { return this.hp <= 0; }
  /** Цена починки руин */
  get repairCost(): number { return Math.max(10, Math.round(this.spent * REPAIR_COST)); }

  /** Урон от охотника; до нуля — руины */
  hurt(dmg: number): void {
    if (this.ruined || dmg <= 0) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.h.fx.text(this.pos.clone().setY(this.pos.y + 3), `−${Math.round(dmg)}`, 'bad');
    this.h.fx.burst(this.pos.clone().setY(this.pos.y + 1), ['#9a8f70', '#5e3c22'], 5, { speed: 2, up: 2, size: 0.08, life: 0.4, gravity: 8 });
    if (this.hp > 0) { this.onAlarm?.('hurt'); return; }
    this.ruin();
  }

  private ruin(): void {
    this.target = null;
    this.thaw(false);
    this.body.rotation.z = 0.22;
    this.turret.rotation.x = 0.4;
    for (const m of this.lamps) m.color.setScalar(0.3);
    for (const m of this.glows) m.visible = false;
    this.h.fx.burst(this.pos.clone().setY(this.pos.y + 1.2), ['#4a4440', '#2a2624', '#9a8f70'], 30, { speed: 3, up: 3, size: 0.16, life: 0.9, gravity: 6 });
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.3);
    if (!this.h.quiet()) boom(90, 40, 0.5, 0.35);
    this.onAlarm?.('ruin');
  }

  /** Починить руины (или подлатать): полная прочность, прежний уровень */
  repair(): void {
    const was = this.ruined;
    this.hp = this.maxHp;
    if (!was) return;
    this.body.rotation.z = 0;
    this.turret.rotation.x = 0;
    for (const m of this.lamps) m.color.setScalar(1);
    for (const m of this.glows) m.visible = true;
    this.cd = 0.5;
    this.h.fx.burst(this.pos.clone().setY(this.pos.y + 0.6), ['#d8cfa8', '#9ad87a', '#ffffff'], 20, { speed: 3, up: 3, size: 0.1, life: 0.6, gravity: 6 });
    if (!this.h.quiet()) voice({ type: 'triangle', f: 440, f1: 880, dur: 0.25, vol: 0.05 });
  }

  /** Заморозить на sec секунд: не стреляет. Морозный шпиль и руины не мёрзнут */
  freeze(sec: number): boolean {
    if (this.def.id === 'frost' || this.ruined) return false;
    const fresh = this.frozen <= 0;
    this.frozen = Math.max(this.frozen, sec);
    this.iceHits = 0;
    this.iceMesh.visible = true;
    if (fresh) {
      this.h.fx.burst(this.pos.clone().setY(this.pos.y + 1.6), [ICE, '#ffffff'], 18, { speed: 2.5, up: 2, size: 0.1, life: 0.6, glow: true, gravity: 4 });
      if (!this.h.quiet()) hiss({ dur: 0.35, vol: 0.08, f: 5000, f1: 2000, q: 2 });
      this.onAlarm?.('frozen');
    }
    return true;
  }

  /** Удар героя по льду: со второго лёд разбит */
  private chip(): void {
    if (this.frozen <= 0) return;
    this.iceHits++;
    this.h.fx.burst(this.pos.clone().setY(this.pos.y + 1.6), [ICE, '#ffffff'], 8, { speed: 3, up: 2, size: 0.08, life: 0.4, gravity: 8 });
    if (this.iceHits >= ICE_HITS) this.thaw(true);
  }

  private thaw(loud: boolean): void {
    if (this.frozen <= 0 && !this.iceMesh.visible) return;
    this.frozen = 0;
    this.iceMesh.visible = false;
    if (!loud) return;
    this.h.fx.burst(this.pos.clone().setY(this.pos.y + 1.6), [ICE, '#ffffff', ICE_DEEP], 26, { speed: 4, up: 3, size: 0.12, life: 0.7, glow: true, gravity: 8 });
    if (!this.h.quiet()) hiss({ dur: 0.2, vol: 0.1, f: 6000, f1: 3000, q: 1 });
  }

  get kind(): TowerKind { return this.def.id; }
  get range(): number { return this.def.range + UPGRADE_RANGE[this.level - 1]; }
  get dmg(): number { return Math.round(this.def.dmg * UPGRADE_DMG[this.level - 1]); }
  get title(): string { return `${this.def.title} ${['I', 'II', 'III'][this.level - 1]}`; }
  /** Цена следующего улучшения; null — предел */
  get nextCost(): number | null { return this.level >= MAX_LEVEL ? null : upgradeCost(this.def, this.level + 1); }
  /** Сколько врагов горит (для тестов) */
  get burning(): number { return this.burns.length; }
  /** Сколько луж смолы на земле (для тестов) */
  get pooling(): number { return this.pools.length; }

  /** Улучшить на уровень: урон и дальность растут, модель получает знак уровня */
  upgrade(): boolean {
    const cost = this.nextCost;
    if (cost === null) return false;
    this.level++;
    this.spent += cost;
    // прочнее с уровнем: прибавка сразу и к запасу
    const max = Math.round(this.def.hp * UPGRADE_HP ** (this.level - 1));
    this.hp += max - this.maxHp;
    this.maxHp = max;
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
    for (const p of this.pools.splice(0)) { this.h.scene.remove(p.mesh); p.mat.dispose(); }
    this.burns.length = 0;
    this.dropDecoy();
    this.bar.dispose();
    (this.iceMesh.material as THREE.Material).dispose();
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
      case 'ballista': this.buildBallista(); break;
      case 'oil': this.buildOil(); break;
      case 'meteor': this.buildMeteor(); break;
      case 'storm': this.buildStorm(); break;
      case 'winter': this.buildWinter(); break;
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

  /** Звездочёт: круглая каменная башня, купол-обсерватория с прорезью, из неё — подзорная труба на цель; над куполом — звезда */
  private buildMeteor(): void {
    const B = this.box.bind(this);
    const stone = this.lam('#6a6278'), stoneD = this.lam('#4a4458'), brass = this.lam('#d8a040'), dome = this.lam('#3a3a6a'), star = this.glow(STAR), deep = this.glow(STAR_DEEP);
    B(this.body, stone, 1.5, 1.2, 1.5, 0, 1.1, 0);
    B(this.body, stone, 1.5, 1.2, 1.5, 0, 1.1, 0, 0, Math.PI / 4, 0);
    B(this.body, stoneD, 1.3, 1.0, 1.3, 0, 2.2, 0, 0, Math.PI / 8, 0);
    for (const y of [1.0, 1.9]) for (const s of [-1, 1]) B(this.body, deep, 0.2, 0.3, 0.04, s * 0.5, y, 0.72);
    this.turret.position.set(0, 2.75, 0);
    this.body.add(this.turret);
    B(this.turret, dome, 1.4, 0.5, 1.4, 0, 0.2, 0);
    B(this.turret, dome, 1.0, 0.35, 1.0, 0, 0.6, 0);
    B(this.turret, dome, 0.5, 0.2, 0.5, 0, 0.86, 0);
    B(this.turret, brass, 0.26, 0.26, 1.4, 0, 0.45, 0.5, -0.5, 0, 0);
    B(this.turret, star, 0.2, 0.2, 0.06, 0, 0.82, 1.15, -0.5, 0, 0);
    this.arm.position.set(0, 1.5, 0);
    this.turret.add(this.arm);
    B(this.arm, star, 0.34, 0.34, 0.34, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
    for (let i = 1; i < this.level; i++) B(this.arm, deep, 0.14, 0.14, 0.14, Math.cos(i * 2.1) * 0.5, 0, Math.sin(i * 2.1) * 0.5);
  }

  /** Грозовой шпиль: высокая каменная игла в медных кольцах, наверху — грозовой шар между тремя рогами-разрядниками */
  private buildStorm(): void {
    const B = this.box.bind(this);
    const stone = this.lam('#5c6470'), copper = this.lam('#c87a3a'), iron = this.lam(IRON, false), volt = this.glow(VOLT);
    B(this.body, stone, 1.0, 0.6, 1.0, 0, 0.8, 0);
    B(this.body, stone, 0.7, 1.4, 0.7, 0, 1.8, 0);
    B(this.body, stone, 0.45, 1.0, 0.45, 0, 3.0, 0);
    for (const y of [1.3, 1.9, 2.5, 3.1]) B(this.body, copper, y < 2.6 ? 0.82 : 0.56, 0.1, y < 2.6 ? 0.82 : 0.56, 0, y, 0);
    this.turret.position.set(0, 3.6, 0);
    this.body.add(this.turret);
    for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3; B(this.turret, iron, 0.08, 0.7, 0.08, Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.35, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); }
    this.arm.position.set(0, 0.55, 0);
    this.turret.add(this.arm);
    B(this.arm, volt, 0.4 + this.level * 0.06, 0.4 + this.level * 0.06, 0.4 + this.level * 0.06, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
  }

  /** Сердце зимы: ледяная глыба-постамент, над ней парит огромный кристалл, вокруг кружат осколки (их больше с уровнем) */
  private buildWinter(): void {
    const B = this.box.bind(this);
    const rime = this.lam('#dceeff', false), stone = this.lam('#7f8ea0'), ice = this.glow(SNOW), deep = this.glow(ICE_DEEP);
    B(this.body, stone, 1.2, 0.6, 1.2, 0, 0.8, 0);
    B(this.body, rime, 1.3, 0.2, 1.3, 0, 1.15, 0, 0, Math.PI / 4, 0);
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.3; B(this.body, deep, 0.2, 0.7, 0.2, Math.cos(a) * 0.55, 1.4, Math.sin(a) * 0.55, Math.sin(a) * 0.3, a, Math.cos(a) * 0.3); }
    this.turret.position.set(0, 2.6, 0);
    this.body.add(this.turret);
    B(this.turret, ice, 0.7, 1.4, 0.7, 0, 0, 0, 0, Math.PI / 4, 0);
    B(this.turret, deep, 0.4, 0.4, 0.4, 0, 0.9, 0, 0, Math.PI / 4, 0);
    B(this.turret, deep, 0.4, 0.4, 0.4, 0, -0.9, 0, 0, Math.PI / 4, 0);
    this.arm.position.set(0, 0, 0);
    this.turret.add(this.arm);
    for (let i = 0; i < 3 + this.level; i++) { const a = (i / (3 + this.level)) * Math.PI * 2; B(this.arm, ice, 0.16, 0.3, 0.16, Math.cos(a) * 1.1, Math.sin(i * 1.7) * 0.3, Math.sin(a) * 1.1, 0.4, a, 0.3); }
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

  /** Стенная баллиста: низкая станина с колёсами, на вертлюге — тяжёлый лук с воротом; болт лежит в жёлобе */
  private buildBallista(): void {
    const B = this.box.bind(this);
    const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK), iron = this.lam(IRON, false), rope = this.lam('#c8b890', false);
    B(this.body, woodD, 1.4, 0.2, 1.0, 0, 0.6, 0);
    for (const s of [-1, 1]) B(this.body, woodD, 0.12, 0.5, 0.5, s * 0.6, 0.55, 0);
    this.turret.position.set(0, 0.8, 0);
    this.body.add(this.turret);
    // ложе с жёлобом, дуги лука, тетива, ворот сзади
    B(this.turret, wood, 0.3, 0.2, 2.0, 0, 0.15, 0.2);
    B(this.turret, iron, 0.18, 0.06, 1.4, 0, 0.28, 0.4);
    for (const s of [-1, 1]) { B(this.turret, woodD, 1.0, 0.1, 0.12, s * 0.65, 0.25, 0.75, 0, 0, s * 0.25); B(this.turret, iron, 0.08, 0.14, 0.14, s * 1.1, 0.25, 0.63); }
    B(this.turret, rope, 2.1, 0.02, 0.02, 0, 0.25, 0.3);
    B(this.turret, iron, 0.3, 0.3, 0.2, 0, 0.3, -0.8);
    B(this.turret, woodD, 0.08, 0.6, 0.08, 0.2, 0.3, -0.8, 0, 0, 0.3);
    this.arm.position.set(0, 0.34, 0.3);
    this.turret.add(this.arm);
    B(this.arm, iron, 0.08, 0.08, 1.2, 0, 0, 0.3);
    B(this.arm, this.lam('#d8285a', false), 0.14, 0.14, 0.2, 0, 0, 0.95);
    if (this.level >= 2) for (const s of [-1, 1]) B(this.turret, iron, 0.06, 0.4, 0.06, s * 0.4, 0.4, 0.75);
    if (this.level >= 3) B(this.turret, this.lam('#d8285a', false), 0.03, 0.3, 0.5, 0, 0.6, -0.5);
  }

  /** Котёл со смолой: треножник над углями, чёрный котёл, из него валит дым; носик к цели */
  private buildOil(): void {
    const B = this.box.bind(this);
    const iron = this.lam(IRON, false), coal = this.glow(EMBER), tar = this.lam(TAR, false), wood = this.lam(WOOD_DARK);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; B(this.body, wood, 0.14, 1.6, 0.14, Math.cos(a) * 0.55, 1.3, Math.sin(a) * 0.55, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); }
    B(this.body, coal, 0.7, 0.2, 0.7, 0, 0.6, 0);
    B(this.body, iron, 0.5, 0.1, 0.5, 0, 2.1, 0);
    this.turret.position.set(0, 1.0, 0);
    this.body.add(this.turret);
    B(this.turret, iron, 1.0, 0.7, 1.0, 0, 0.35, 0);
    B(this.turret, iron, 1.1, 0.12, 1.1, 0, 0.75, 0);
    B(this.turret, tar, 0.8, 0.08, 0.8, 0, 0.78, 0);
    B(this.turret, iron, 0.3, 0.2, 0.5, 0, 0.7, 0.6);
    for (const s of [-1, 1]) B(this.turret, iron, 0.1, 0.4, 0.1, s * 0.56, 0.8, 0);
    B(this.turret, iron, 1.22, 0.06, 0.06, 0, 1.0, 0);
    if (this.level >= 2) B(this.turret, iron, 0.6, 0.6, 0.6, 0, 0.3, 0, 0, Math.PI / 4, 0);
    if (this.level >= 3) B(this.turret, this.lam('#d8285a', false), 0.5, 0.3, 0.03, -0.7, 1.5, 0);
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
  private strike(f: Foe, dmg: number, knock: number, point: THREE.Vector3, cls = '', pierce = false): void {
    if (!f.alive || dmg <= 0) return;
    _dir.set(f.pos.x - this.pos.x, 0, f.pos.z - this.pos.z).normalize();
    f.hit(dmg, pierce ? ZERO : _dir, point, knock);
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
      case 'ballista': this.fireBallista(t); break;
      case 'oil': this.fireOil(t); break;
      case 'meteor': this.fireMeteor(); break;
      case 'storm': this.fireStorm(t); break;
      case 'winter': this.fireWinter(); break;
      default: this.fireArrow(t); break;
    }
  }

  /** Тяжёлый болт: по прямой через цель до края дальности, бьёт всех в полосе 0,7 м; удар без направления — броню не гасит */
  private fireBallista(t: Foe): void {
    const dmg = this.dmg, from = this.muzzle(1.3, 1.0), fx = this.h.fx;
    const dir = new THREE.Vector3(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize();
    const len = this.range + 1;
    const end = this.pos.clone().addScaledVector(dir, len).setY(0.9);
    fx.streak({ path: (k, out) => out.lerpVectors(from, end, k), dur: 0.22, color: C(2.6, 2.2, 1.2), color2: C(1.4, 1.0, 0.5), width: 0.14, tail: 0.5, halo: 1.2, core: 0.8 });
    let n = 0;
    for (const f of this.h.foes()) {
      if (!f.alive || f.dead) continue;
      const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z, along = dx * dir.x + dz * dir.z;
      if (along < 0 || along > len) continue;
      const side = Math.abs(dx * dir.z - dz * dir.x);
      if (side > 0.7 + f.radius) continue;
      const at = this.chest(f);
      this.strike(f, n === 0 ? dmg : Math.round(dmg * 0.7), 0, at, 'crit', true);
      fx.burst(at, ['#ffffff', '#d8c8a0'], 6, { speed: 3, up: 2, size: 0.07, life: 0.3, glow: true, gravity: 8 });
      n++;
    }
    if (!this.h.quiet()) { hiss({ dur: 0.15, vol: 0.12, f: 1400, f1: 400, q: 1 }); boom(200, 90, 0.15, 0.25); }
  }

  /** Ковш смолы по дуге: лужа радиусом 2,2 м на 5 с — в ней вязнут (−50 %) и горят (тик урона раз в 0,5 с) */
  private fireOil(t: Foe): void {
    const from = this.muzzle(1.9, 0.6), dist = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    const to = t.pos.clone().setY(0);
    const mesh = new THREE.Mesh(UNIT, new THREE.MeshLambertMaterial({ color: TAR }));
    mesh.scale.set(0.5, 0.3, 0.5);
    mesh.position.copy(from);
    this.h.scene.add(mesh);
    this.lobs.push({ mesh, from, to, t: 0, dur: 0.5 + dist * 0.05, h: 2 + dist * 0.2, land: (at) => {
      const r = 2.2 + (this.level - 1) * 0.3;
      const mat = new THREE.MeshBasicMaterial({ color: TAR, transparent: true, opacity: 0.85, depthWrite: false });
      const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(at.x, 0.03, at.z);
      pool.renderOrder = 1;
      this.h.scene.add(pool);
      this.pools.push({ mesh: pool, mat, at: at.clone(), t: 5, tick: 0, r });
      this.h.fx.burst(at.clone().setY(0.2), [TAR, '#2a2018', TAR_SHEEN], 16, { speed: 3, up: 2.5, size: 0.12, life: 0.6, gravity: 9, glow: false });
      if (!this.h.quiet()) hiss({ dur: 0.3, vol: 0.1, f: 500, f1: 200, q: 0.8, type: 'lowpass' });
    } });
    if (!this.h.quiet()) hiss({ dur: 0.2, vol: 0.06, f: 400, f1: 250, q: 1 });
  }

  private bolt(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, size: number, speed: number, hit: () => void): void {
    const mesh = new THREE.Mesh(UNIT, glowMat(color));
    mesh.scale.set(size, size, size * 6);
    mesh.position.copy(from);
    mesh.lookAt(to);
    this.h.scene.add(mesh);
    this.bolts.push({ mesh, from, to, t: 0, dur: from.distanceTo(to) / speed, hit });
  }

  /** Метеорит: в самую плотную толпу в радиусе — с неба, взрыв 4,5 м (урон слабеет к краю, не меньше половины), отброс, поджог */
  private fireMeteor(): void {
    const R = 4.5, dmg = this.dmg, fx = this.h.fx;
    const foes = this.around(this.pos, this.range);
    if (!foes.length) return;
    // центр — враг, у которого больше всего соседей в радиусе взрыва; при равенстве — кто дальше по дороге
    let best = foes[0], bn = -1;
    for (const f of foes) {
      const n = foes.filter((o) => Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) < R).length + (f.progress ?? 0) * 0.5;
      if (n > bn) { bn = n; best = f; }
    }
    const to = best.pos.clone().setY(0), from = to.clone().add(new THREE.Vector3(-4, 22, -4));
    const mesh = new THREE.Mesh(UNIT, glowMat(STAR));
    mesh.scale.setScalar(0.9);
    mesh.position.copy(from);
    this.h.scene.add(mesh);
    fx.shock(to.clone().setY(0.08), R, STAR_DEEP, 0.8, 0.1);
    fx.streak({ path: (k, out) => out.lerpVectors(from, to, k), dur: 0.8, color: STAR, color2: STAR_DEEP, width: 0.5, tail: 0.6, halo: 3, core: 0.8 });
    this.lobs.push({ mesh, from, to, t: 0, dur: 0.8, h: 0, land: (at) => {
      fx.explosion(at.clone().setY(0.5), R, STAR);
      fx.shock(at.clone().setY(0.1), R, STAR, 0.6, 0.3);
      fx.burst(at.clone().setY(0.4), [STAR, STAR_DEEP, '#ffffff', '#5a4a3a'], 40, { speed: 7, up: 6, size: 0.16, life: 0.9, glow: true, gravity: 10 });
      fx.shake = Math.max(fx.shake, 0.7);
      for (const f of this.around(at, R)) {
        const d = Math.hypot(f.pos.x - at.x, f.pos.z - at.z), k = Math.max(0.5, 1 - d / R);
        this.strike(f, Math.round(dmg * k), 3 * k, f.pos.clone().setY(1), 'crit');
        const b = this.burns.find((x) => x.foe === f);
        if (b) b.t = 3; else this.burns.push({ foe: f, t: 3, tick: 1, dmg: Math.max(1, Math.round(dmg * 0.1)) });
      }
      if (!this.h.quiet()) { boom(55, 22, 0.9, 0.7); hiss({ dur: 0.6, vol: 0.12, f: 1200, f1: 200, q: 0.6, type: 'lowpass' }); }
    } });
    if (!this.h.quiet()) hiss({ dur: 0.8, vol: 0.08, f: 300, f1: 1800, q: 0.8 });
  }

  /** Молния: в цель и дальше цепью к ближайшему (до 5 м) — 6 врагов, на II — 8, на III — 10; каждый прыжок −8 % урона, оглушение 0,3 с */
  private fireStorm(t: Foe): void {
    const n = 4 + this.level * 2, dmg = this.dmg, fx = this.h.fx;
    const chain: Foe[] = [t];
    while (chain.length < n) {
      const last = chain[chain.length - 1];
      let next: Foe | null = null, bd = 5;
      for (const f of this.around(last.pos, 5)) { if (chain.includes(f)) continue; const d = Math.hypot(f.pos.x - last.pos.x, f.pos.z - last.pos.z); if (d < bd) { bd = d; next = f; } }
      if (!next) break;
      chain.push(next);
    }
    let from = this.pos.clone().setY(this.pos.y + 4.15);
    chain.forEach((f, i) => {
      const a = from.clone(), b = this.chest(f);
      // ломаная молния: смещение посередине, гаснет быстро
      const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2));
      fx.streak({ path: (k, out) => (k < 0.5 ? out.lerpVectors(a, mid, k * 2) : out.lerpVectors(mid, b, (k - 0.5) * 2)), dur: 0.12, color: VOLT, color2: C(3.6, 3.6, 4), width: 0.12, tail: 1, halo: 2, core: 0.9 });
      fx.flash(b, VOLT, 1.2, 0.12);
      this.strike(f, Math.round(dmg * Math.pow(0.92, i)), 0.2, b, i === 0 ? 'crit' : '');
      f.stun?.(0.3);
      from = b;
    });
    if (!this.h.quiet()) { hiss({ dur: 0.25, vol: 0.14, f: 5000, f1: 800, q: 0.7 }); boom(120, 60, 0.2, 0.3); }
  }

  /** Вьюга: всем в радиусе урон и −50 % скорости; каждый пятый удар — ледяная волна: урон ×3 и оглушение 1,2 с */
  private fireWinter(): void {
    const R = this.range, nova = this.shots % 5 === 0, dmg = nova ? this.dmg * 3 : this.dmg, fx = this.h.fx;
    for (const f of this.around(this.pos, R)) {
      this.strike(f, dmg, nova ? 1.5 : 0, f.pos.clone().setY(1), nova ? 'crit' : '');
      f.chill?.(0.5, 1.5);
      if (nova) f.stun?.(1.2);
    }
    if (nova) {
      fx.shock(this.pos.clone().setY(this.pos.y + 0.15), R, SNOW, 0.6, 0.3);
      fx.burst(this.pos.clone().setY(this.pos.y + 2.6), [SNOW, '#ffffff', ICE_DEEP], 40, { speed: 8, up: 2, size: 0.12, life: 0.8, glow: true, gravity: 2 });
      if (!this.h.quiet()) { hiss({ dur: 0.9, vol: 0.14, f: 6000, f1: 1200, q: 1 }); boom(90, 50, 0.4, 0.3); }
    } else if (!this.h.quiet()) hiss({ dur: 0.4, vol: 0.04, f: 3000, f1: 1500, q: 0.8 });
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
    this.bar.set(this.hp / this.maxHp, !this.ruined && this.hp < this.maxHp);
    if (this.frozen > 0) { this.frozen -= dt; if (this.frozen <= 0) this.thaw(true); }
    if (this.ruined && Math.random() < 0.3) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.2)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3), life: 1.2, size: 0.18, color: '#3a3634', gravity: -0.2 }, false);
    // руины и лёд — не стреляет; цель: держим прежнюю, пока жива и в радиусе, иначе — первого по дороге
    const idle = this.ruined || this.frozen > 0;
    if (idle) this.target = null;
    else if (!this.target || !this.inRange(this.target)) this.target = this.pick();
    const t = this.target;
    if (t) {
      const want = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), d = wrap(want - this.turret.rotation.y), m = (this.def.id === 'splash' ? 3 : 9) * dt;
      this.turret.rotation.y += Math.max(-m, Math.min(m, d));
      if (this.cd <= 0 && Math.abs(d) < 0.5) { this.cd = this.def.cd; this.fire(t); }
    }
    if (!idle) this.animate(dt);
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
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.t -= dt; p.tick -= dt;
      p.mat.opacity = Math.min(0.85, p.t * 0.6);
      if (p.t <= 0) { this.pools.splice(i, 1); this.h.scene.remove(p.mesh); p.mat.dispose(); p.mesh.geometry.dispose(); continue; }
      if (Math.random() < 0.4) this.h.fx.particle({ pos: p.at.clone().add(new THREE.Vector3((Math.random() - 0.5) * p.r * 1.6, 0.1, (Math.random() - 0.5) * p.r * 1.6)), vel: new THREE.Vector3(0, 0.6, 0), life: 0.6, size: 0.08, color: Math.random() < 0.5 ? FIRE : '#3a3028', gravity: 0 }, Math.random() < 0.5);
      if (p.tick > 0) continue;
      p.tick = 0.5;
      for (const f of this.around(p.at, p.r)) {
        f.chill?.(0.5, 0.6);
        this.strike(f, this.dmg, 0, f.pos.clone().setY(0.8));
        const b = this.burns.find((x) => x.foe === f);
        if (b) b.t = Math.max(b.t, 2); else this.burns.push({ foe: f, t: 2, tick: 1, dmg: Math.max(1, Math.round(this.dmg * 0.5)) });
      }
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
      case 'ballista': this.arm.position.z = 0.3 - this.recoil * 0.5; this.arm.visible = this.recoil < 0.9; break;
      case 'oil':
        this.turret.rotation.x = this.recoil > 0.5 ? (this.recoil - 0.5) * 1.2 : 0;
        if (Math.random() < 0.25) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.9, (Math.random() - 0.5) * 0.5)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3), life: 0.9, size: 0.1, color: '#3a3028', gravity: 0 }, false);
        break;
      case 'splash': this.arm.rotation.x = this.recoil > 0.7 ? -0.9 : 0.7 - (this.recoil / 0.7) * 1.6; break;
      case 'magic':
        this.arm.position.y = Math.sin(this.time * 2) * 0.12;
        this.arm.rotation.y += dt * (1 + this.recoil * 8);
        break;
      case 'fire':
        if (Math.random() < 0.3) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.9, (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2 + Math.random(), (Math.random() - 0.5) * 0.4), life: 0.5, size: 0.07, color: Math.random() < 0.6 ? FIRE : EMBER, gravity: 0 });
        break;
      case 'meteor': this.arm.rotation.y += dt * 1.5; this.arm.position.y = 1.5 + Math.sin(this.time * 2) * 0.1; break;
      case 'storm':
        this.arm.rotation.y += dt * (2 + this.recoil * 10);
        if (Math.random() < 0.15) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 4.1 + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2), life: 0.15, size: 0.05, color: VOLT, gravity: 0 });
        break;
      case 'winter': {
        this.arm.rotation.y += dt * 1.2;
        this.turret.position.y = 2.6 + Math.sin(this.time * 1.5) * 0.12;
        // снег кружит в радиусе вьюги
        const a = Math.random() * Math.PI * 2, r = Math.random() * this.range;
        if (Math.random() < 0.6) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 2.5, Math.sin(a) * r)), vel: new THREE.Vector3(-Math.sin(a) * 2, -0.4, Math.cos(a) * 2), life: 0.9, size: 0.06, color: SNOW, gravity: 0 }, false);
        break;
      }
      case 'frost':
        this.turret.rotation.z = Math.sin(this.time * 1.3) * 0.04;
        if (Math.random() < 0.1) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.2)), vel: new THREE.Vector3(0, -0.3, 0), life: 0.8, size: 0.05, color: ICE, gravity: 0 });
        break;
    }
  }
}
