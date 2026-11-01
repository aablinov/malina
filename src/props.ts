import * as THREE from 'three';
import { obstacle, type Obstacle } from './collision';
import type { FX } from './fx';
import { disposeOwned, markShared } from './fx';
import type { Target } from './target';
import type { Rand } from './textures';
import { distToObstacle } from './nav';
import { pixelTex } from './textures';
import { additive, additiveSprite, glowTex, groundGlow, lightBeam, rainbow, raysTex, starTex, type LootData } from './loot-look';

/**
 * Интерактивные предметы карты:
 * - красные бочки с горючим: от ударов загораются и через секунду взрываются, задевая соседние бочки (цепная реакция);
 * - волшебные сундуки: подойти и нажать F — сундук трясётся, крышка распахивается со вспышкой, лут вылетает фонтаном,
 *   его подбирают проходя (малина и трофеи сами тянутся к герою);
 * - терминал здоровья: E — лечит, пока стоишь рядом, запас заряда восстанавливается;
 * - деревянные ящики: разбиваются мечом и взрывами.
 *
 * Предметы — препятствия для движения (через solids), бочки и деревянные ящики — ещё и цели для ударов.
 */

/** Малина, лечение; стрелы и предметы снаряжения — их вид и данные даёт сцена (PropsHooks.chestExtra) */
export type LootKind = 'berry' | 'med' | 'arrows' | 'item';

export const PROPS = {
  barrelHp: 20,
  /** Сколько горит до взрыва (после цепной реакции — быстрее) */
  barrelFuse: 1.1,
  barrelChainFuse: 0.3,
  barrelBlastR: 3.6,
  barrelBlastDmg: 75,
  crateHp: 45,
  /** Терминал: лечение в секунду, запас заряда и восстановление в секунду */
  healRate: 30,
  healCharge: 100,
  healRecharge: 6,
};

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const MAT = markSharedAll({
  barrel: new THREE.MeshLambertMaterial({ map: pixelTex('#b3261e', 7, 61) }),
  barrelRing: new THREE.MeshLambertMaterial({ color: '#5a1410' }),
  hazard: new THREE.MeshLambertMaterial({ color: '#e3bd1c' }),
  dark: new THREE.MeshLambertMaterial({ color: '#202226' }),
  chest: new THREE.MeshLambertMaterial({ map: pixelTex('#3c2c98', 12, 62), emissive: '#2a1670', emissiveIntensity: 0.55 }),
  chestTop: new THREE.MeshLambertMaterial({ map: pixelTex('#4b38b8', 12, 63), emissive: '#2a1670', emissiveIntensity: 0.55 }),
  chestInside: new THREE.MeshLambertMaterial({ color: '#2a1a66', emissive: '#5a2aa0', emissiveIntensity: 0.6 }),
  gold: new THREE.MeshLambertMaterial({ map: pixelTex('#f4bd2e', 14, 67), emissive: '#7a4a00', emissiveIntensity: 0.6 }),
  goldDark: new THREE.MeshLambertMaterial({ map: pixelTex('#d99a1c', 12, 68), emissive: '#5a3400', emissiveIntensity: 0.5 }),
  wood: new THREE.MeshLambertMaterial({ map: pixelTex('#9a6a3a', 10, 64) }),
  woodDark: new THREE.MeshLambertMaterial({ map: pixelTex('#6e4824', 8, 65) }),
  terminal: new THREE.MeshLambertMaterial({ map: pixelTex('#3a3f48', 6, 66) }),
});
function markSharedAll<T extends Record<string, THREE.Material>>(o: T): T { for (const m of Object.values(o)) markShared(m); return o; }

// ---------- бочка ----------

/** Предмет из региона мира (src/world/regions.ts): id — стабильный, region — ключ, чтобы убрать с выгрузкой */
export interface Placed { id?: string; region?: string }

export class Barrel implements Target, Placed {
  id?: string; region?: string;
  readonly pos: THREE.Vector3;
  readonly radius = 0.36;
  readonly topY = 0.95;
  readonly prop = true;
  hp = PROPS.barrelHp;
  /** Горит: сколько осталось до взрыва; −1 — не горит */
  fuse = -1;
  exploded = false;
  readonly group = new THREE.Group();
  readonly solid: Obstacle;

  constructor(scene: THREE.Scene, x: number, z: number) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.pos);
    this.group.rotation.y = (x * 7.3 + z * 3.1) % Math.PI;
    this.group.add(box(0.62, 0.9, 0.62, MAT.barrel, 0, 0.45, 0));
    this.group.add(box(0.66, 0.06, 0.66, MAT.barrelRing, 0, 0.22, 0), box(0.66, 0.06, 0.66, MAT.barrelRing, 0, 0.68, 0));
    this.group.add(box(0.5, 0.04, 0.5, MAT.barrelRing, 0, 0.92, 0));
    this.group.add(box(0.1, 0.06, 0.1, MAT.dark, 0.14, 0.96, 0.1)); // пробка
    // знак «огнеопасно»: жёлтый ромб с красным пламенем
    const sign = box(0.26, 0.26, 0.02, MAT.hazard, 0, 0.47, 0.32);
    sign.rotation.z = Math.PI / 4;
    this.group.add(sign, box(0.08, 0.14, 0.025, MAT.barrelRing, 0, 0.46, 0.33));
    scene.add(this.group);
    this.solid = obstacle(x, z, 0.62, 0.62, 0.95);
  }

  get alive(): boolean { return !this.exploded; }

  hit(dmg: number): void {
    if (this.exploded) return;
    this.hp -= dmg;
    if (this.hp <= 0 && this.fuse < 0) this.fuse = PROPS.barrelFuse;
  }

  /** Взрыв рядом: поджечь с коротким фитилём */
  ignite(): void {
    if (this.exploded) return;
    this.fuse = this.fuse < 0 ? PROPS.barrelChainFuse : Math.min(this.fuse, PROPS.barrelChainFuse);
  }

  /** true — пора взрываться */
  update(dt: number, fx: FX, rand: Rand): boolean {
    if (this.exploded) return false;
    if (this.fuse >= 0) {
      this.fuse -= dt;
      // течь горит: пламя и искры, бочка подрагивает
      const p = this.pos.clone().add(new THREE.Vector3((rand() - 0.5) * 0.3, 0.95, (rand() - 0.5) * 0.3));
      fx.burst(p, [new THREE.Color(3.4, 1.5, 0.3), new THREE.Color(3.4, 2.6, 0.6)], 2, { speed: 0.6, up: 2.5, size: 0.11, life: 0.45, glow: true, gravity: -2 });
      if (rand() < 0.3) fx.burst(p.clone().setY(1.3), ['#2a2622', '#3a3430'], 1, { speed: 0.3, up: 1.2, size: 0.22, life: 1, gravity: -1.5, drag: 2 });
      this.group.position.x = this.pos.x + (rand() - 0.5) * 0.04;
      this.group.position.z = this.pos.z + (rand() - 0.5) * 0.04;
      if (this.fuse <= 0) return true;
    }
    return false;
  }

  remove(scene: THREE.Scene): void {
    this.exploded = true;
    scene.remove(this.group);
  }
}

// ---------- деревянный ящик ----------

export class BreakCrate implements Target, Placed {
  id?: string; region?: string;
  readonly pos: THREE.Vector3;
  readonly radius = 0.56;
  readonly topY = 1.0;
  readonly prop = true;
  hp = PROPS.crateHp;
  broken = false;
  readonly group = new THREE.Group();
  readonly solid: Obstacle;
  private shake = 0;
  private readonly mats: THREE.MeshLambertMaterial[] = [];

  constructor(scene: THREE.Scene, x: number, z: number, rotDeg = 0) {
    this.pos = new THREE.Vector3(x, 0, z);
    const wood = MAT.wood.clone(), dark = MAT.woodDark.clone();
    this.mats.push(wood, dark);
    this.group.position.copy(this.pos);
    this.group.rotation.y = THREE.MathUtils.degToRad(rotDeg);
    this.group.add(box(0.96, 0.96, 0.96, wood, 0, 0.48, 0));
    // рёбра каркаса и диагональ
    for (const [w, h, d, px, py, pz] of [
      [1, 0.1, 0.1, 0, 0.05, 0.46], [1, 0.1, 0.1, 0, 0.91, 0.46], [1, 0.1, 0.1, 0, 0.05, -0.46], [1, 0.1, 0.1, 0, 0.91, -0.46],
      [0.1, 1, 0.1, 0.46, 0.48, 0.46], [0.1, 1, 0.1, -0.46, 0.48, 0.46], [0.1, 1, 0.1, 0.46, 0.48, -0.46], [0.1, 1, 0.1, -0.46, 0.48, -0.46],
    ] as const) this.group.add(box(w, h, d, dark, px, py, pz));
    const diag = box(1.2, 0.09, 0.03, dark, 0, 0.48, 0.49);
    diag.rotation.z = Math.PI / 4;
    this.group.add(diag);
    scene.add(this.group);
    this.solid = obstacle(x, z, 0.98, 0.98, 1.0, rotDeg);
  }

  get alive(): boolean { return !this.broken; }

  hit(dmg: number): void {
    if (this.broken) return;
    this.hp -= dmg;
    this.shake = 0.12;
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt);
    const k = this.shake > 0 ? 0.5 : 0;
    for (const m of this.mats) m.emissive.setRGB(k * 0.3, k * 0.2, 0);
    this.group.position.x = this.pos.x + (this.shake > 0 ? (Math.random() - 0.5) * 0.04 : 0);
    // трещины: темнеет по мере повреждения
    const dmgK = 1 - Math.max(0, this.hp) / PROPS.crateHp;
    this.mats[0].color.setScalar(1 - dmgK * 0.35);
  }

  /** Разлетается досками */
  shatter(scene: THREE.Scene, fx: FX): void {
    this.broken = true;
    scene.remove(this.group);
    const c = this.pos.clone().setY(0.5);
    fx.burst(c, ['#9a6a3a', '#7a522c', '#6e4824', '#b0834e'], 22, { speed: 3.5, up: 4, size: 0.18, life: 1.6 });
    fx.burst(c, ['#c9a77a'], 10, { speed: 2, up: 2, size: 0.06, life: 0.8 });
  }
}

// ---------- сундук ----------

/** Сколько сундук копит силу (трясётся, втягивает искры) до взрыва света */
const CHEST_CHARGE = 0.6;
/** Пауза между предметами, вылетающими фонтаном */
const CHEST_POP_GAP = 0.08;

/**
 * Волшебный сундук: тёмно-синий с золотом, по углам и на крышке — камни, переливающиеся радугой, из-под крышки сочится свет.
 * Открытие: сундук трясётся и втягивает искры (CHEST_CHARGE), потом крышка распахивается, бьёт столб света,
 * разлетаются конфетти и кольца, лут вылетает фонтаном по одному (Props.update).
 */
export class SupplyCrate implements Placed {
  id?: string; region?: string;
  readonly pos: THREE.Vector3;
  readonly group = new THREE.Group();
  readonly solid: Obstacle;
  opened = false;
  /** Время с начала открытия; −1 — закрыт */
  openT = -1;
  /** Вспыхнул (крышка распахнулась) — лут летит */
  burst = false;
  private readonly body = new THREE.Group();
  private readonly lid = new THREE.Group();
  private lidAng = 0;
  private lidVel = 0;
  private readonly gems: THREE.MeshBasicMaterial[] = [];
  private readonly seamMat: THREE.MeshBasicMaterial;
  private readonly seam: THREE.Mesh;
  private readonly innerMat: THREE.MeshBasicMaterial;
  private readonly halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private t = Math.random() * 10;
  readonly yaw: number;

  constructor(scene: THREE.Scene, x: number, z: number, yawDeg = 0) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.add(this.body);
    const B = this.body;
    const gem = (w: number, h: number, d: number, px: number, py: number, pz: number, parent: THREE.Object3D = B): void => {
      const m = new THREE.MeshBasicMaterial({ color: '#fff', toneMapped: false });
      this.gems.push(m);
      const g = box(w, h, d, m, px, py, pz);
      g.castShadow = false;
      parent.add(g);
    };
    // корпус и золотая оковка
    B.add(box(1.22, 0.54, 0.74, MAT.chest, 0, 0.3, 0));
    B.add(box(1.3, 0.08, 0.82, MAT.gold, 0, 0.04, 0), box(1.3, 0.06, 0.82, MAT.gold, 0, 0.57, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(box(0.09, 0.6, 0.09, MAT.gold, sx * 0.62, 0.3, sz * 0.38));
    for (const x0 of [-0.36, 0.36]) B.add(box(0.1, 0.58, 0.79, MAT.goldDark, x0, 0.3, 0));
    // замок с малиновым камнем и камни по бокам
    B.add(box(0.26, 0.3, 0.05, MAT.gold, 0, 0.42, 0.4));
    gem(0.12, 0.12, 0.04, 0, 0.42, 0.43);
    for (const sx of [-1, 1]) gem(0.04, 0.14, 0.14, sx * 0.62, 0.3, 0);
    // камни по нижним углам
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) gem(0.13, 0.13, 0.13, sx * 0.63, 0.07, sz * 0.39);
    // щель под крышкой: из неё сочится свет
    this.seamMat = new THREE.MeshBasicMaterial({ color: '#fff', toneMapped: false });
    this.seam = box(1.2, 0.03, 0.72, this.seamMat, 0, 0.6, 0);
    this.seam.castShadow = false;
    B.add(this.seam, box(1.12, 0.02, 0.64, MAT.chestInside, 0, 0.58, 0));
    // свет изнутри — виден, когда крышка открыта
    this.innerMat = additive(glowTex(), new THREE.Color(3, 2.2, 2.6), 0);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), this.innerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.62;
    B.add(inner);
    // крышка на петлях по заднему краю: ступенькой, с золотыми полосами, камнями по углам и сверху
    this.lid.position.set(0, 0.6, -0.41);
    this.lid.add(box(1.32, 0.15, 0.84, MAT.chest, 0, 0.075, 0.42), box(1.12, 0.09, 0.62, MAT.chestTop, 0, 0.19, 0.42));
    for (const x0 of [-0.36, 0.36]) this.lid.add(box(0.11, 0.26, 0.86, MAT.goldDark, x0, 0.11, 0.42));
    this.lid.add(box(1.34, 0.05, 0.06, MAT.gold, 0, 0.03, 0.84), box(1.34, 0.05, 0.06, MAT.gold, 0, 0.03, 0.0));
    this.lid.add(box(0.2, 0.16, 0.06, MAT.gold, 0, -0.02, 0.86)); // накладка замка
    for (const sx of [-1, 1]) for (const sz of [0.02, 0.82]) gem(0.13, 0.13, 0.13, sx * 0.63, 0.12, sz, this.lid);
    for (const sx of [-1, 1]) gem(0.13, 0.05, 0.13, sx * 0.18, 0.25, 0.42, this.lid);
    B.add(this.lid);
    // ореол на земле
    this.halo = groundGlow(new THREE.Color('#fff'), 3.2, 0.8);
    this.halo.position.y = 0.03;
    this.group.add(this.halo);
    scene.add(this.group);
    this.solid = obstacle(x, z, 1.3, 0.8, 0.7, yawDeg);
  }

  /** Открыть: возвращает true, если только что открыт */
  open(): boolean {
    if (this.opened) return false;
    this.opened = true;
    this.openT = 0;
    return true;
  }

  /** Точка над сундуком, откуда вылетает лут */
  get mouth(): THREE.Vector3 { return this.pos.clone().setY(0.8); }

  /** true — именно в этот кадр крышка распахнулась */
  update(dt: number, fx: FX, rand: Rand): boolean {
    this.t += dt;
    const t = this.t;
    let fired = false;
    if (this.openT >= 0) {
      this.openT += dt;
      if (!this.burst && this.openT >= CHEST_CHARGE) { this.burst = true; fired = true; this.lidVel = -16; }
    }
    const charge = this.openT < 0 ? 0 : Math.min(1, this.openT / CHEST_CHARGE);
    const after = this.burst ? this.openT - CHEST_CHARGE : -1;
    // тряска и подпрыгивание
    const B = this.body;
    if (!this.burst) {
      const a = charge * charge;
      B.position.set((rand() - 0.5) * 0.08 * a, a * 0.06, (rand() - 0.5) * 0.06 * a);
      B.rotation.z = (rand() - 0.5) * 0.12 * a;
      B.scale.set(1 + a * 0.05, 1 - a * 0.08, 1 + a * 0.05);
      // крышка подскакивает — видно свет внутри
      this.lidAng = -Math.max(0, Math.sin(t * 38)) * 0.12 * a;
    } else {
      const j = Math.max(0, 1 - after / 0.45);
      B.position.set(0, Math.abs(Math.sin(after * 14)) * 0.18 * j, 0);
      B.rotation.z = 0;
      const sq = Math.sin(after * 18) * 0.1 * j;
      B.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
      // крышка — пружина с перелётом
      this.lidVel += ((-1.95 - this.lidAng) * 140 - this.lidVel * 9) * dt;
      this.lidAng += this.lidVel * dt;
    }
    this.lid.rotation.x = this.lidAng;
    // камни переливаются радугой; при открытии — быстрее и ярче, потом гаснут
    const spent = after < 0 ? 0 : Math.min(1, after / 3);
    const speed = 0.12 + charge * 0.6 * (1 - spent);
    const bright = (2.2 + Math.sin(t * 3) * 0.5 + charge * 2) * (1 - spent * 0.75);
    this.gems.forEach((m, i) => m.color.copy(rainbow(t * speed + i * 0.09, bright)));
    this.seam.visible = !this.burst;
    const seamK = this.burst ? 0 : (1.2 + Math.sin(t * 2.5) * 0.4) * (1 + charge * 3);
    this.seamMat.color.copy(rainbow(t * 0.1 + 0.9, seamK)).lerp(new THREE.Color(seamK, seamK, seamK), charge);
    this.innerMat.opacity = after < 0 ? charge * 0.4 : Math.max(0.25, 1.2 - after * 0.5);
    this.innerMat.color.copy(rainbow(t * 0.2, 1.8)).lerp(new THREE.Color(3, 2.6, 2.6), 0.6);
    this.halo.material.color.copy(rainbow(t * 0.08 + 0.6, (0.55 + Math.sin(t * 2) * 0.15 + charge * 1.2) * (1 - spent * 0.7)));
    this.halo.scale.setScalar(1 + charge * 0.4 + Math.sin(t * 2) * 0.05);
    // искры: закрытый — поднимаются вокруг, копит силу — втягиваются в щель
    const c = this.pos.clone().setY(0.62);
    if (!this.opened) {
      if (rand() < dt * 9) {
        const a = rand() * Math.PI * 2, r = 0.5 + rand() * 0.5;
        fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, -0.5 + rand() * 0.6, Math.sin(a) * r)), vel: new THREE.Vector3(0, 0.6 + rand() * 0.6, 0), life: 1.1, size: 0.06, color: rainbow(rand(), 3), gravity: -0.3, spin: 3 });
      }
    } else if (!this.burst) {
      for (let i = 0; i < 4; i++) {
        const a = rand() * Math.PI * 2, r = 1.4 + rand() * 0.8, life = 0.3;
        const from = c.clone().add(new THREE.Vector3(Math.cos(a) * r, rand() * 1.2, Math.sin(a) * r));
        fx.particle({ pos: from, vel: c.clone().sub(from).divideScalar(life), life, size: 0.07, color: rainbow(rand(), 3.4), gravity: 0, shrink: false });
      }
    } else if (after < 2.5 && rand() < dt * 25 * (1 - after / 2.5)) {
      // открытый ещё долго искрится изнутри
      fx.particle({ pos: c.clone().add(new THREE.Vector3((rand() - 0.5) * 0.9, 0, (rand() - 0.5) * 0.5)), vel: new THREE.Vector3((rand() - 0.5) * 0.6, 1.5 + rand() * 2, (rand() - 0.5) * 0.6), life: 0.9, size: 0.06, color: rainbow(rand(), 3), gravity: 0.5 });
    }
    return fired;
  }
}

// ---------- терминал здоровья ----------

export class HealthTerminal implements Placed {
  id?: string;
  region?: string;
  readonly pos: THREE.Vector3;
  readonly group = new THREE.Group();
  readonly solid: Obstacle;
  charge = PROPS.healCharge;
  /** Лечит сейчас */
  active = false;
  private readonly bar: THREE.Mesh;
  private readonly screenMat: THREE.MeshBasicMaterial;
  private readonly barMat: THREE.MeshBasicMaterial;
  private readonly cross: THREE.Group;
  private t = 0;
  readonly yaw: number;

  constructor(scene: THREE.Scene, x: number, z: number, yawDeg = 0) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.add(box(0.8, 0.12, 0.6, MAT.dark, 0, 0.06, 0));
    this.group.add(box(0.7, 1.3, 0.45, MAT.terminal, 0, 0.75, -0.02));
    this.group.add(box(0.74, 0.1, 0.5, MAT.dark, 0, 1.42, -0.02));
    // экран и полоса заряда
    this.screenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.6, 0.6), toneMapped: false });
    const screen = box(0.52, 0.38, 0.02, this.screenMat, 0, 1.05, 0.21);
    screen.castShadow = false;
    this.group.add(screen, box(0.56, 0.42, 0.015, MAT.dark, 0, 1.05, 0.205));
    this.barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3, 0.8), toneMapped: false });
    this.bar = box(0.44, 0.05, 0.02, this.barMat, 0, 0.62, 0.22);
    this.bar.castShadow = false;
    this.group.add(this.bar, box(0.48, 0.08, 0.015, MAT.dark, 0, 0.62, 0.215));
    // светящийся крест сверху
    this.cross = new THREE.Group();
    const cm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.5, 0.5), toneMapped: false });
    this.cross.add(box(0.26, 0.08, 0.08, cm), box(0.08, 0.26, 0.08, cm));
    this.cross.position.set(0, 1.72, 0);
    this.group.add(this.cross);
    scene.add(this.group);
    this.solid = obstacle(x, z, 0.75, 0.55, 1.45, yawDeg);
  }

  /** Лечение за кадр: сколько здоровья выдать (с учётом заряда) */
  give(dt: number, need: number): number {
    if (!this.active) return 0;
    const n = Math.min(PROPS.healRate * dt, need, this.charge);
    this.charge -= n;
    if (n <= 0 || this.charge <= 0) this.active = false;
    return n;
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.active) this.charge = Math.min(PROPS.healCharge, this.charge + PROPS.healRecharge * dt);
    const k = this.charge / PROPS.healCharge;
    this.bar.scale.x = Math.max(0.01, k);
    this.bar.position.x = -0.22 * (1 - k);
    this.barMat.color.setRGB(k < 0.25 ? 3 : 0.4, k < 0.25 ? 0.6 : 3, 0.5);
    const pulse = this.active ? 1.3 + Math.sin(this.t * 12) * 0.4 : 0.8 + Math.sin(this.t * 2) * 0.1;
    this.screenMat.color.setRGB(0.25 * pulse, 1.6 * pulse, 0.6 * pulse);
    this.cross.rotation.y += dt * (this.active ? 4 : 1);
  }
}

// ---------- лут на полу ----------

export interface Pickup {
  kind: LootKind;
  amount: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Group;
  /** Пока не подобрать: только вылетел */
  lock: number;
  t: number;
  /** Уже коснулся земли (вспышка и звук приземления — один раз) */
  landed?: boolean;
  /** Что именно (предмет снаряжения) — для сцены */
  data?: unknown;
}

const LOOT_LOOK: Record<Exclude<LootKind, 'berry'>, { color: string; glow: [number, number, number]; size: [number, number, number] }> = {
  med: { color: '#eeeeee', glow: [3, 0.6, 0.6], size: [0.3, 0.2, 0.24] },
  arrows: { color: '#a8774a', glow: [2.4, 2.4, 2.6], size: [0.1, 0.1, 0.5] },
  item: { color: '#8a5cff', glow: [2.4, 1.2, 3.4], size: [0.3, 0.3, 0.3] },
};

/** Цвет свечения малины */
export const BERRY_GLOW = new THREE.Color(3.4, 0.45, 1.1);

let berryGeo: THREE.BufferGeometry | null = null;
let berryMat: THREE.MeshLambertMaterial | null = null;

/** Малина из косточек-кубиков: конус из колец, сверху зелёная чашечка с хвостиком. Одна сетка на все ягоды */
function berryGeometry(): THREE.BufferGeometry {
  if (berryGeo) return berryGeo;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const cube = (w: number, h: number, d: number, x: number, y: number, z: number, ry: number, hex: string): void => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(ry);
    g.translate(x, y, z);
    const base = pos.length / 3;
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    c.set(hex);
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]);
      // верх граней светлее — косточки блестят
      const k = n[i + 1] > 0.5 ? 1.25 : n[i + 1] < -0.5 ? 0.7 : 1;
      col.push(c.r * k, c.g * k, c.b * k);
    }
    for (const j of g.index!.array) idx.push(base + j);
    g.dispose();
  };
  const tones = ['#e8245a', '#ff4a7e', '#c8124a', '#ff6a94'];
  // кольца снизу вверх: высота, радиус, сколько косточек
  const rings: [number, number, number][] = [[-0.15, 0.08, 5], [-0.07, 0.15, 8], [0.02, 0.18, 9], [0.11, 0.17, 9], [0.19, 0.12, 7]];
  rings.forEach(([y, r, n], ri) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ri * 0.35;
      cube(0.11, 0.1, 0.11, Math.cos(a) * r, y, Math.sin(a) * r, -a, tones[(i + ri) % tones.length]);
    }
  });
  cube(0.26, 0.34, 0.26, 0, 0.03, 0, 0, '#a80e3c'); // сердцевина
  cube(0.07, 0.05, 0.07, 0.05, 0.13, 0.17, 0, '#ffc2d4'); // блик
  // чашечка: четыре листика крестом и хвостик
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    cube(0.2, 0.035, 0.07, Math.cos(a) * 0.09, 0.245, Math.sin(a) * 0.09, -a, i % 2 ? '#4fbf3a' : '#3c9a2e');
  }
  cube(0.05, 0.11, 0.05, 0, 0.3, 0, 0, '#3a7d26');
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return berryGeo = markShared(g);
}

/** Малина на полу: крупная ягода, ореол, блик-звёздочка и розовое пятно света на земле */
function berryMesh(): THREE.Group {
  const g = new THREE.Group();
  berryMat ??= markShared(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#ff1a5e', emissiveIntensity: 0.35 }));
  const body = new THREE.Mesh(berryGeometry(), berryMat);
  body.castShadow = true;
  g.add(body);
  const halo = new THREE.Sprite(additiveSprite(glowTex(), BERRY_GLOW.clone().multiplyScalar(0.5), 0.9));
  halo.scale.setScalar(1.1);
  g.add(halo);
  const glint = new THREE.Sprite(additiveSprite(starTex(), new THREE.Color(3, 2.6, 2.8)));
  glint.position.set(0.12, 0.16, 0.12);
  g.add(glint);
  const floor = groundGlow(BERRY_GLOW.clone().multiplyScalar(0.35), 1.1);
  g.add(floor);
  const phase = Math.random() * 6;
  const ud: LootData = {
    glow: BERRY_GLOW,
    tick: (t, grounded) => {
      halo.material.opacity = 0.7 + Math.sin(t * 4 + phase) * 0.25;
      halo.scale.setScalar(1 + Math.sin(t * 4 + phase) * 0.12);
      // блик вспыхивает раз в пару секунд
      const k = ((t + phase) % 2.2) / 2.2;
      glint.scale.setScalar(k < 0.15 ? Math.sin((k / 0.15) * Math.PI) * 0.45 : 0);
      glint.material.rotation = t * 3;
      // пятно света лежит на земле, пока ягода парит
      floor.visible = grounded;
      floor.position.y = 0.02 - g.position.y;
    },
  };
  g.userData = ud;
  return g;
}

export function lootMesh(kind: LootKind): THREE.Group {
  if (kind === 'berry') return berryMesh();
  const L = LOOT_LOOK[kind];
  const g = new THREE.Group();
  const body = box(L.size[0], L.size[1], L.size[2], new THREE.MeshLambertMaterial({ color: L.color, emissive: L.color, emissiveIntensity: 0.25 }));
  g.add(body);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(...L.glow), toneMapped: false });
  if (kind === 'med') {
    g.add(box(0.16, 0.04, 0.05, glow, 0, L.size[1] / 2 + 0.01, 0), box(0.05, 0.04, 0.16, glow, 0, L.size[1] / 2 + 0.01, 0));
  } else {
    g.add(box(L.size[0] + 0.02, 0.04, L.size[2] + 0.02, glow, 0, L.size[1] / 2 - 0.03, 0));
  }
  return g;
}

// ---------- менеджер предметов ----------

export interface PropsHooks {
  /** Взрыв бочки: урон всем вокруг (и предметам — через Props.blast) */
  explode(at: THREE.Vector3, r: number, dmg: number): void;
  /** Подобран лут */
  give(kind: LootKind, amount: number, at: THREE.Vector3, data?: unknown): void;
  /** Сверх малины и лечения сундук выбрасывает это (стрелы, предмет); mesh — вид на полу */
  chestExtra?(): ChestLoot[];
  /** Звук; v — номер предмета в фонтане, серия малины или редкость трофея */
  sound(k: PropSound, v?: number): void;
  /** Предмет региона исчерпан (бочка взорвалась, ящик разбит, сундук открыт) — запомнить по id */
  changed?(id: string): void;
}

/**
 * charge — сундук копит силу, burst — распахнулся, pop — вылетел предмет (v — номер), land — лут стукнулся о землю,
 * itemLand — трофей приземлился (v — редкость), berry — подобрана малина (v — серия подряд), item — подобран трофей (v — редкость)
 */
export type PropSound = 'charge' | 'burst' | 'pop' | 'land' | 'itemLand' | 'berry' | 'item' | 'pickup' | 'break' | 'heal' | 'ignite';

/** Что лежит в сундуке; mesh — свой вид на полу (иначе lootMesh) */
export interface ChestLoot { kind: LootKind; amount: number; data?: unknown; mesh?: THREE.Group }

export interface Interactable {
  kind: 'supply' | 'terminal';
  prompt: string;
  target: SupplyCrate | HealthTerminal;
}

/** Где что стоит: [x, z, поворот°] */
export interface PropsLayout {
  barrels: [number, number][];
  crates: [number, number, number][];
  supplies: [number, number, number][];
  terminals: [number, number, number][];
}

/** Фонтан малины: не больше кучек на полу и сколько вылетает за тик (волна ≈ 0,13 с на 60 кучек) */
const MAX_FOUNTAIN = 60;
const FOUNTAIN_PER_TICK = 8;

const LOOT_TABLE: [LootKind, number][] = [['berry', 3], ['berry', 3], ['berry', 5], ['berry', 5], ['med', 25], ['med', 15]];

export class Props {
  barrels: Barrel[] = [];
  crates: BreakCrate[] = [];
  supplies: SupplyCrate[] = [];
  terminals: HealthTerminal[] = [];
  readonly pickups: Pickup[] = [];
  /** Растёт, когда меняются препятствия (ящик разбит, бочка взорвалась) — пора пересобрать навигацию */
  version = 0;
  private solidsCache: Obstacle[] = [];
  private solidsVer = -1;
  /** Лут сундуков, ещё не вылетевший: сундук → очередь */
  private readonly chestLoot = new Map<SupplyCrate, { items: ChestLoot[]; next: number }>();
  /** Серия малины: сколько подобрано подряд (звук всё выше) */
  private berryCombo = 0;
  private lastBerry = -10;
  /** Последняя вспышка подбора малины: эффекты не чаще раза в 0,1 с, иначе десяток ягод за кадр ослепляет и грузит */
  private lastBerryFx = -10;
  /** Откуда малину тянет к герою, м (оборона куста — дальше: в бою некогда бегать за каждой кучкой) */
  berryReach = 2.4;
  /** Сбор урожая: ещё столько секунд вся малина на земле летит к герою, откуда угодно */
  private harvestT = 0;
  private clock = 0;
  private frame = 0;
  /** Фонтан малины: ягоды, ещё не вылетевшие — выпускаются волнами по FOUNTAIN_PER_TICK за тик */
  private readonly fountainQueue: { at: THREE.Vector3; amount: number; i: number; n: number }[] = [];

  constructor(
    private readonly scene: THREE.Scene, private readonly fx: FX, private readonly rand: Rand,
    private readonly hooks: PropsHooks, private readonly layout: PropsLayout,
  ) { this.spawn(); }

  private spawn(): void {
    this.barrels = this.layout.barrels.map(([x, z]) => new Barrel(this.scene, x, z));
    this.crates = this.layout.crates.map(([x, z, r]) => new BreakCrate(this.scene, x, z, r));
    this.supplies = this.layout.supplies.map(([x, z, r]) => new SupplyCrate(this.scene, x, z, r));
    this.terminals = this.layout.terminals.map(([x, z, r]) => new HealthTerminal(this.scene, x, z, r));
    this.version++;
  }

  /** Поставить предметы региона мира (ключ key); у каждого — id для сохранения состояния */
  addGroup(key: string, items: { id: string; kind: 'barrel' | 'crate' | 'chest' | 'terminal'; x: number; z: number; rot: number }[]): void {
    for (const it of items) {
      const o = it.kind === 'barrel' ? new Barrel(this.scene, it.x, it.z) : it.kind === 'crate' ? new BreakCrate(this.scene, it.x, it.z, it.rot) : it.kind === 'terminal' ? new HealthTerminal(this.scene, it.x, it.z, it.rot) : new SupplyCrate(this.scene, it.x, it.z, it.rot);
      o.id = it.id; o.region = key;
      if (o instanceof Barrel) this.barrels.push(o); else if (o instanceof BreakCrate) this.crates.push(o); else if (o instanceof HealthTerminal) this.terminals.push(o); else this.supplies.push(o);
    }
    this.version++;
  }

  /** Убрать предметы региона (выгрузка): из сцены и из памяти, кроме общих материалов */
  removeGroup(key: string): void {
    const gone = (o: Placed & { group: THREE.Group }) => { if (o.region !== key) return false; this.scene.remove(o.group); disposeOwned(o.group); return true; };
    this.barrels = this.barrels.filter((b) => !gone(b));
    this.crates = this.crates.filter((c) => !gone(c));
    for (const s of this.supplies) if (s.region === key) this.chestLoot.delete(s);
    this.supplies = this.supplies.filter((c) => !gone(c));
    this.terminals = this.terminals.filter((t) => !gone(t));
    this.version++;
  }

  reset(): void {
    for (const b of this.barrels) if (!b.exploded) this.scene.remove(b.group);
    for (const c of this.crates) if (!c.broken) this.scene.remove(c.group);
    for (const s of this.supplies) this.scene.remove(s.group);
    for (const t of this.terminals) this.scene.remove(t.group);
    for (const p of this.pickups) { this.scene.remove(p.mesh); disposeOwned(p.mesh); }
    this.pickups.length = 0;
    this.chestLoot.clear();
    this.fountainQueue.length = 0;
    this.spawn();
  }

  /** Препятствия от предметов (для движения и навигации) */
  get solids(): Obstacle[] {
    if (this.solidsVer !== this.version) {
      this.solidsCache = [
        ...this.barrels.filter((b) => !b.exploded).map((b) => b.solid),
        ...this.crates.filter((c) => !c.broken).map((c) => c.solid),
        ...this.supplies.map((s) => s.solid),
        ...this.terminals.map((t) => t.solid),
      ];
      this.solidsVer = this.version;
    }
    return this.solidsCache;
  }

  /** Цели для ударов: бочки и деревянные ящики */
  get targets(): Target[] {
    return [...this.barrels.filter((b) => !b.exploded), ...this.crates.filter((c) => !c.broken)];
  }

  /** Взрыв рядом: ящики получают урон, бочки загораются */
  blast(at: THREE.Vector3, r: number, dmg: number): void {
    for (const b of this.barrels) if (!b.exploded && b.fuse < 0 && Math.hypot(b.pos.x - at.x, b.pos.z - at.z) < r) b.ignite();
    for (const c of this.crates) {
      if (c.broken) continue;
      const d = Math.hypot(c.pos.x - at.x, c.pos.z - at.z);
      if (d < r) c.hit(dmg * (1 - (d / r) * 0.5));
    }
  }

  /** Что рядом можно использовать (E) */
  nearest(pos: THREE.Vector3, heroHp: number, heroMax: number): Interactable | null {
    let best: Interactable | null = null, bd = 0.9;
    for (const s of this.supplies) {
      if (s.opened) continue;
      const d = distToObstacle(pos.x, pos.z, s.solid);
      if (d < bd) { bd = d; best = { kind: 'supply', prompt: 'Открыть сундук', target: s }; }
    }
    for (const t of this.terminals) {
      const d = distToObstacle(pos.x, pos.z, t.solid);
      if (d < bd) {
        bd = d;
        const p = t.active ? 'Лечение…' : t.charge < 5 ? 'Терминал заряжается' : heroHp >= heroMax ? 'Здоровье полное' : 'Лечиться у терминала';
        best = { kind: 'terminal', prompt: p, target: t };
      }
    }
    return best;
  }

  /** Нажали E рядом с предметом */
  interact(it: Interactable, heroHp: number, heroMax: number): void {
    if (it.kind === 'supply') {
      const s = it.target as SupplyCrate;
      if (!s.open()) return;
      if (s.id) this.hooks.changed?.(s.id);
      this.hooks.sound('charge');
      // что выпадет — решено сразу, вылетит, когда крышка распахнётся (Props.update)
      this.chestLoot.set(s, { items: [...LOOT_TABLE.map(([kind, amount]): ChestLoot => ({ kind, amount })), ...(this.hooks.chestExtra?.() ?? [])], next: 0 });
    } else {
      const t = it.target as HealthTerminal;
      if (t.charge >= 5 && heroHp < heroMax) { t.active = true; this.hooks.sound('heal'); }
    }
  }

  /** Возвращает, сколько здоровья выдал терминал */
  update(dt: number, hero: { pos: THREE.Vector3; hp: number; maxHp: number; down: boolean }): number {
    // бочки: горят и взрываются
    for (const b of this.barrels) {
      if (b.exploded) continue;
      const wasBurning = b.fuse >= 0;
      if (b.update(dt, this.fx, this.rand)) {
        b.remove(this.scene);
        this.version++;
        if (b.id) this.hooks.changed?.(b.id);
        this.hooks.explode(b.pos.clone().setY(0.5), PROPS.barrelBlastR, PROPS.barrelBlastDmg);
      } else if (!wasBurning && b.fuse >= 0) this.hooks.sound('ignite');
    }
    // деревянные ящики
    for (const c of this.crates) {
      if (c.broken) continue;
      c.update(dt);
      if (c.hp <= 0) {
        c.shatter(this.scene, this.fx);
        this.version++;
        if (c.id) this.hooks.changed?.(c.id);
        this.hooks.sound('break');
        // иногда в ящике малина
        if (this.rand() < 0.35) {
          this.drop('berry', 3, c.pos.clone().setY(0.5), new THREE.Vector3((this.rand() - 0.5) * 2, 4, (this.rand() - 0.5) * 2), 0.5);
          this.fx.flash(c.pos.clone().setY(0.6), BERRY_GLOW, 1.6, 0.3);
        }
      }
    }
    this.clock += dt;
    this.harvestT = Math.max(0, this.harvestT - dt);
    for (const s of this.supplies) {
      if (s.update(dt, this.fx, this.rand)) this.chestBurst(s);
      // лут вылетает фонтаном по одному
      const q = this.chestLoot.get(s);
      if (q && s.burst) {
        while (q.next < q.items.length && s.openT - CHEST_CHARGE >= q.next * CHEST_POP_GAP) this.chestPop(s, q.items[q.next], q.next++, q.items.length);
        if (q.next >= q.items.length) this.chestLoot.delete(s);
      }
    }
    // терминал лечит, пока герой рядом
    let healed = 0;
    for (const t of this.terminals) {
      if (t.active && (hero.down || distToObstacle(hero.pos.x, hero.pos.z, t.solid) > 1.4)) t.active = false;
      const n = t.give(dt, hero.maxHp - hero.hp);
      if (n > 0) {
        healed += n;
        if (this.rand() < 0.5) {
          const from = t.pos.clone().setY(1.1);
          const dir = hero.pos.clone().setY(1.1).sub(from);
          this.fx.spray(from, dir, [new THREE.Color(0.4, 3, 0.8)], 1, { speed: dir.length() * 2.2, spread: 0.08, life: 0.45, size: 0.07, gravity: 0 });
        }
      }
      t.update(dt);
    }
    // фонтан: очередная волна ягод
    this.frame++;
    for (let k = 0; k < FOUNTAIN_PER_TICK && this.fountainQueue.length; k++) {
      const q = this.fountainQueue.shift()!;
      const a = (q.i / q.n) * Math.PI * 2 * 3 + this.rand() * 0.6, sp = 1.5 + this.rand() * 4;
      const vel = new THREE.Vector3(Math.cos(a) * sp, 5 + this.rand() * 5, Math.sin(a) * sp);
      this.drop('berry', q.amount, q.at.clone().setY(1.2 + this.rand() * 0.6), vel, 0.7 + q.i * 0.01);
    }
    // лут: летит, падает, крутится; подбирается проходя мимо, вблизи притягивается (малина — издалека)
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      const ud = p.mesh.userData as LootData;
      p.t += dt;
      p.lock -= dt;
      p.vel.y -= 12 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.14) {
        p.pos.y = 0.14;
        if (!p.landed && p.vel.y < -1) { p.landed = true; this.land(p); }
        if (Math.abs(p.vel.y) > 1.5) { p.vel.y = -p.vel.y * 0.3; p.vel.x *= 0.5; p.vel.z *= 0.5; }
        else { p.vel.y = 0; const k = Math.exp(-6 * dt); p.vel.x *= k; p.vel.z *= k; }
      }
      // низко над полом лут не лежит на сундуках и бочках — соскальзывает в сторону (пока ещё движется)
      if (p.pos.y < 1 && Math.abs(p.vel.x) + Math.abs(p.vel.z) > 0.05) for (const o of this.solids) {
        if (distToObstacle(p.pos.x, p.pos.z, o) > 0.2) continue;
        const dx = p.pos.x - o.x, dz = p.pos.z - o.z, l = Math.hypot(dx, dz) || 1;
        p.pos.x += (dx / l) * 4 * dt; p.pos.z += (dz / l) * 4 * dt;
      }
      const grounded = p.pos.y <= 0.15 && p.vel.lengthSq() < 0.3;
      // в полёте — светящийся хвост, на земле — искры вокруг
      if (ud.glow) {
        if (!grounded) { if ((this.frame + i) & 1) this.fx.particle({ pos: p.pos.clone(), vel: new THREE.Vector3(0, 0.3, 0), life: 0.35, size: 0.07, color: ud.glow, gravity: 0 }); }
        else if (this.rand() < dt * (ud.rarity !== undefined ? 10 + ud.rarity * 6 : 3)) {
          const a = this.rand() * Math.PI * 2, r = 0.2 + this.rand() * 0.3;
          this.fx.particle({ pos: p.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, this.rand() * 0.3, Math.sin(a) * r)), vel: new THREE.Vector3(0, 0.7 + this.rand() * 0.6, 0), life: 0.9, size: 0.05, color: this.rand() < 0.3 ? new THREE.Color(3, 3, 3) : ud.glow, gravity: -0.4, spin: 3 });
        }
      }
      const d = Math.hypot(hero.pos.x - p.pos.x, hero.pos.z - p.pos.z);
      const reach = p.kind === 'berry' ? (this.harvestT > 0 ? Infinity : this.berryReach) : 1.7;
      if (p.lock <= 0 && !hero.down && d < reach) {
        // притягивается к герою, всё быстрее
        const pull = hero.pos.clone().setY(0.6).sub(p.pos).setLength((reach === Infinity ? 14 + d : Math.min(10, 3 + (reach - d) * 6)) * dt);
        p.pos.add(pull);
        if (d < 0.6) {
          this.scene.remove(p.mesh);
          disposeOwned(p.mesh);
          this.pickups.splice(i, 1);
          this.hooks.give(p.kind, p.amount, p.pos, p.data);
          this.collect(p);
          continue;
        }
      }
      p.mesh.position.copy(p.pos);
      if (grounded) p.mesh.position.y = 0.2 + Math.sin(p.t * 3) * 0.05;
      p.mesh.rotation.y += dt * (grounded ? 1.8 : 6);
      if (!grounded) p.mesh.rotation.x += dt * 5;
      else p.mesh.rotation.x *= Math.exp(-8 * dt);
      ud.tick?.(p.t, grounded);
    }
    return healed;
  }

  /** Бросить предмет на пол */
  /**
   * Фонтан малины — страж повержен (wiki/design-bosses.md): total ягод кучками по per разлетаются кольцом из точки,
   * волнами по 0,05 с; подобрать — пройти рядом (малину тянет издалека)
   */
  fountain(at: THREE.Vector3, total: number, per = 5): void {
    // не больше MAX_FOUNTAIN кучек: у сильного стража кучки крупнее, малины столько же
    per = Math.max(per, Math.ceil(total / MAX_FOUNTAIN));
    const n = Math.max(1, Math.ceil(total / per));
    for (let i = 0; i < n; i++) {
      const amount = i === n - 1 ? total - per * (n - 1) : per;
      this.fountainQueue.push({ at: at.clone(), amount, i, n });
    }
    this.fx.flash(at.clone().setY(1.2), BERRY_GLOW, 3, 0.4);
    this.fx.burst(at.clone().setY(1.2), ['#ff4a7e', '#c8124a', '#ffd0e0'], 30, { speed: 5, up: 6, size: 0.1, life: 1, glow: true, gravity: 6 });
  }

  /** Сбор урожая (оборона куста, волна отбита): вся малина на земле летит к герою */
  harvest(sec = 4): void { this.harvestT = Math.max(this.harvestT, sec); }
  /** Малины на земле (кучек) — для тестов */
  get berriesOnGround(): number { return this.pickups.filter((p) => p.kind === 'berry').length; }

  /** Малина с рядового моба (wiki/design-mobs.md): одна кучка подскакивает из точки, без фонтана */
  berries(at: THREE.Vector3, amount: number): void {
    if (amount <= 0) return;
    this.drop('berry', amount, at.clone().setY(0.8), new THREE.Vector3((this.rand() - 0.5) * 2, 4, (this.rand() - 0.5) * 2), 0.4);
  }

  private drop(kind: LootKind, amount: number, pos: THREE.Vector3, vel: THREE.Vector3, lock: number, mesh = lootMesh(kind), data?: unknown): Pickup {
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const p: Pickup = { kind, amount, pos, vel, mesh, lock, t: this.rand() * 6, data };
    this.pickups.push(p);
    return p;
  }

  /** Крышка распахнулась: вспышка, столб света, звезда из лучей, кольца и конфетти */
  private chestBurst(s: SupplyCrate): void {
    const fx = this.fx, c = s.mouth, r = this.rand;
    this.hooks.sound('burst');
    fx.flash(c, new THREE.Color(9, 7, 8), 6, 0.4);
    fx.shock(s.pos, 4.5, rainbow(0.9, 3), 0.55, 0.2);
    fx.shock(s.pos, 3, rainbow(0.15, 3), 0.75, 0.15);
    fx.shock(s.pos, 6, rainbow(0.55, 3), 1, 0.1);
    fx.burst(c, Array.from({ length: 8 }, (_, i) => rainbow(i / 8, 3.2)), 80, { speed: 4.5, up: 7, size: 0.09, life: 1.5, glow: true, gravity: 6, drag: 0.6 });
    fx.burst(c, ['#ff4a7e', '#ffd23a', '#4ad8ff', '#8a5cff', '#5aff7a', '#ffffff'], 40, { speed: 3.5, up: 6, size: 0.1, life: 2, gravity: 5, drag: 1.2 });
    fx.shake = Math.max(fx.shake, 0.5);
    // столб света из сундука: выстреливает вверх и тает
    const beam = lightBeam(new THREE.Color(3, 2.5, 2.2), 7, 2.2);
    beam.group.position.copy(s.pos).setY(0.5);
    fx.custom(beam.group, 1.8, (k) => {
      beam.group.scale.set(1 - k * 0.6, Math.min(1, k * 8), 1 - k * 0.6);
      for (const m of beam.mats) m.opacity = Math.pow(1 - k, 1.5);
    });
    // звезда из лучей над сундуком
    const rays = new THREE.Sprite(additiveSprite(raysTex(), new THREE.Color(3, 2.6, 2)));
    rays.position.copy(c).setY(1.2);
    fx.custom(rays, 1.2, (k) => {
      rays.scale.setScalar(1.5 + k * 4);
      rays.material.rotation = k * 2;
      rays.material.opacity = 1 - k;
      rays.material.color.copy(rainbow(k * 0.8, 3));
    });
    // искорки-звёздочки вспыхивают вокруг
    for (let i = 0; i < 14; i++) {
      const st = new THREE.Sprite(additiveSprite(starTex(), rainbow(r(), 3.5)));
      st.position.copy(c).add(new THREE.Vector3((r() - 0.5) * 3.5, r() * 2.5, (r() - 0.5) * 3.5));
      const delay = r() * 0.6;
      fx.custom(st, 1.4, (k) => {
        const q = (k * 1.4 - delay) / 0.5;
        st.scale.setScalar(q > 0 && q < 1 ? Math.sin(q * Math.PI) * 0.7 : 0);
        st.material.rotation = k * 4;
      });
    }
  }

  /** Один предмет вылетает из сундука высокой дугой */
  private chestPop(s: SupplyCrate, l: ChestLoot, i: number, total: number): void {
    const a = s.yaw + (i / Math.max(1, total - 1) - 0.5) * 3.2 + (this.rand() - 0.5) * 0.3;
    const sp = 2.2 + this.rand() * 1.4;
    const vel = new THREE.Vector3(Math.sin(a) * sp, 5.5 + this.rand() * 2, Math.cos(a) * sp);
    const pos = s.mouth.add(new THREE.Vector3((this.rand() - 0.5) * 0.3, 0, (this.rand() - 0.5) * 0.2));
    // трофей даётся не сразу — пусть столб света успеет вырасти
    const p = this.drop(l.kind, l.amount, pos, vel, l.kind === 'item' ? 1.8 : 1, l.mesh ?? lootMesh(l.kind), l.data);
    const glow = (p.mesh.userData as LootData).glow ?? new THREE.Color(3, 2.6, 1.6);
    this.fx.flash(pos, glow, 1.4, 0.2);
    this.fx.burst(pos, [glow, new THREE.Color(3, 3, 3)], 8, { speed: 1.5, up: 2, size: 0.06, life: 0.4, glow: true, gravity: 2 });
    this.hooks.sound('pop', i);
  }

  /** Первое касание земли: трофей — кольцо и звон, остальное — стук и облачко */
  private land(p: Pickup): void {
    const ud = p.mesh.userData as LootData;
    const at = p.pos.clone().setY(0.1);
    if (ud.rarity !== undefined && ud.glow) {
      this.fx.shock(at, 1.6 + ud.rarity * 0.6, ud.glow, 0.5, 0.25);
      this.fx.flash(at.clone().setY(0.5), ud.glow, 2.4 + ud.rarity, 0.3);
      this.fx.burst(at, [ud.glow, new THREE.Color(3, 3, 3)], 16 + ud.rarity * 10, { speed: 2.5, up: 3, size: 0.07, life: 0.7, glow: true, gravity: 4 });
      this.hooks.sound('itemLand', ud.rarity);
    } else {
      if (ud.glow) this.fx.burst(at, [ud.glow], 5, { speed: 1.2, up: 1, size: 0.05, life: 0.3, glow: true, gravity: 3 });
      this.hooks.sound('land');
    }
  }

  /** Подобран: вспышка, брызги и звук — малина сочно лопается, трофей взрывается радугой */
  private collect(p: Pickup): void {
    const ud = p.mesh.userData as LootData;
    const at = p.pos.clone();
    const fx = this.fx;
    if (p.kind === 'berry') {
      this.berryCombo = this.clock - this.lastBerry < 0.9 ? this.berryCombo + 1 : 0;
      this.lastBerry = this.clock;
      // вспышка, кольцо и звезда — не чаще раза в 0,1 с; брызги — у каждой ягоды
      if (this.clock - this.lastBerryFx >= 0.1) {
        this.lastBerryFx = this.clock;
        fx.flash(at, BERRY_GLOW, 2.4, 0.25);
        fx.shock(at.clone().setY(0.1), 1.3, BERRY_GLOW, 0.35, 0.3);
        const st = new THREE.Sprite(additiveSprite(starTex(), new THREE.Color(3.4, 2, 2.6)));
        st.position.copy(at).setY(at.y + 0.3);
        fx.custom(st, 0.4, (k) => { st.scale.setScalar(Math.sin(k * Math.PI) * 1.4); st.material.rotation = k * 3; });
      }
      fx.burst(at, [BERRY_GLOW, new THREE.Color(3.4, 2.4, 2.8), new THREE.Color(3.2, 1.2, 1.8)], 22, { speed: 2.8, up: 3.5, size: 0.08, life: 0.6, glow: true, gravity: 5 });
      fx.burst(at, ['#e8245a', '#ff4a7e', '#a80e3c'], 10, { speed: 2.2, up: 3, size: 0.09, life: 0.6, gravity: 10 });
      this.hooks.sound('berry', this.berryCombo);
    } else if (p.kind === 'item' && ud.glow) {
      const r = ud.rarity ?? 0;
      fx.flash(at, ud.glow, 4 + r, 0.4);
      fx.shock(at.clone().setY(0.1), 2.5 + r, ud.glow, 0.5, 0.2);
      fx.burst(at, [ud.glow, new THREE.Color(3.2, 2.8, 1), new THREE.Color(3, 3, 3), ...Array.from({ length: r * 3 }, (_, i) => rainbow(i / 6, 3))], 40 + r * 20, { speed: 3.5, up: 5, size: 0.08, life: 1, glow: true, gravity: 4 });
      const rays = new THREE.Sprite(additiveSprite(raysTex(), ud.glow));
      rays.position.copy(at).setY(at.y + 0.5);
      fx.custom(rays, 0.8, (k) => { rays.scale.setScalar(1 + k * 3); rays.material.rotation = k * 2; rays.material.opacity = 1 - k; });
      this.hooks.sound('item', r);
    } else {
      fx.flash(at, ud.glow ?? new THREE.Color(3, 2.6, 1.6), 1.4, 0.2);
      fx.burst(at, [new THREE.Color(3, 2.6, 1.6), new THREE.Color(3, 3, 3)], 10, { speed: 2, up: 2.5, size: 0.06, life: 0.4, glow: true, gravity: 4 });
      this.hooks.sound('pickup');
    }
  }
}
