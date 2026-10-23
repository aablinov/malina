import * as THREE from 'three';
import { obstacle, type Obstacle } from './collision';
import type { FX } from './fx';
import type { Target } from './target';
import type { Rand } from './textures';
import { distToObstacle } from './nav';
import { pixelTex } from './textures';

/**
 * Интерактивные предметы карты:
 * - красные бочки с горючим: от ударов загораются и через секунду взрываются, задевая соседние бочки (цепная реакция);
 * - ящики с припасами: подойти и нажать E — крышка откидывается, лут вываливается на пол, его подбирают проходя;
 * - терминал здоровья: E — лечит, пока стоишь рядом, запас заряда восстанавливается;
 * - деревянные ящики: разбиваются мечом и взрывами.
 *
 * Предметы — препятствия для движения (через solids), бочки и деревянные ящики — ещё и цели для ударов.
 */

export type LootKind = 'berry' | 'med';

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

const MAT = {
  barrel: new THREE.MeshLambertMaterial({ map: pixelTex('#b3261e', 7, 61) }),
  barrelRing: new THREE.MeshLambertMaterial({ color: '#5a1410' }),
  hazard: new THREE.MeshLambertMaterial({ color: '#e3bd1c' }),
  dark: new THREE.MeshLambertMaterial({ color: '#202226' }),
  supply: new THREE.MeshLambertMaterial({ map: pixelTex('#4f5b33', 7, 62) }),
  supplyLid: new THREE.MeshLambertMaterial({ map: pixelTex('#5b6a3a', 7, 63) }),
  strap: new THREE.MeshLambertMaterial({ color: '#2a2d22' }),
  wood: new THREE.MeshLambertMaterial({ map: pixelTex('#9a6a3a', 10, 64) }),
  woodDark: new THREE.MeshLambertMaterial({ map: pixelTex('#6e4824', 8, 65) }),
  terminal: new THREE.MeshLambertMaterial({ map: pixelTex('#3a3f48', 6, 66) }),
};

// ---------- бочка ----------

export class Barrel implements Target {
  readonly pos: THREE.Vector3;
  readonly radius = 0.36;
  readonly topY = 0.95;
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

export class BreakCrate implements Target {
  readonly pos: THREE.Vector3;
  readonly radius = 0.56;
  readonly topY = 1.0;
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

// ---------- ящик с припасами ----------

export class SupplyCrate {
  readonly pos: THREE.Vector3;
  readonly group = new THREE.Group();
  readonly solid: Obstacle;
  opened = false;
  /** Анимация крышки 0..1 */
  private openK = 0;
  private readonly lid = new THREE.Group();
  private readonly beacon: THREE.Mesh;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private t = 0;
  readonly yaw: number;

  constructor(scene: THREE.Scene, x: number, z: number, yawDeg = 0) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.add(box(1.3, 0.62, 0.8, MAT.supply, 0, 0.31, 0));
    for (const x0 of [-0.42, 0.42]) this.group.add(box(0.1, 0.64, 0.82, MAT.strap, x0, 0.31, 0));
    this.group.add(box(0.12, 0.12, 0.06, MAT.dark, -0.62, 0.42, 0), box(0.12, 0.12, 0.06, MAT.dark, 0.62, 0.42, 0)); // ручки
    // крышка на петлях по заднему краю
    this.lid.position.set(0, 0.62, -0.4);
    this.lid.add(box(1.34, 0.12, 0.84, MAT.supplyLid, 0, 0.06, 0.42));
    this.lid.add(box(0.1, 0.13, 0.86, MAT.strap, -0.42, 0.06, 0.42), box(0.1, 0.13, 0.86, MAT.strap, 0.42, 0.06, 0.42));
    this.lid.add(box(0.2, 0.06, 0.06, MAT.dark, 0, 0.0, 0.85)); // замок
    this.group.add(this.lid);
    // маячок: светится, пока ящик не открыт
    this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 0.5), toneMapped: false });
    this.beacon = box(0.12, 0.08, 0.12, this.beaconMat, 0, 0.12, 0.42);
    this.beacon.castShadow = false;
    this.lid.add(this.beacon);
    scene.add(this.group);
    this.solid = obstacle(x, z, 1.3, 0.8, 0.7, yawDeg);
  }

  /** Открыть: возвращает true, если только что открыт */
  open(): boolean {
    if (this.opened) return false;
    this.opened = true;
    return true;
  }

  /** Точка над ящиком, откуда вылетает лут */
  get mouth(): THREE.Vector3 { return this.pos.clone().setY(0.8); }

  update(dt: number): void {
    this.t += dt;
    if (this.opened) this.openK = Math.min(1, this.openK + dt / 0.35);
    // крышка откидывается назад с перелётом
    const k = this.openK;
    const over = k < 1 ? Math.sin(k * Math.PI) * 0.15 : 0;
    this.lid.rotation.x = -(k * 1.95 + over);
    this.beaconMat.color.setRGB(3, 2.4, 0.5).multiplyScalar(this.opened ? 0 : 0.6 + 0.4 * Math.sin(this.t * 4));
    this.beacon.visible = !this.opened;
  }
}

// ---------- терминал здоровья ----------

export class HealthTerminal {
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
}

const LOOT_LOOK: Record<LootKind, { color: string; glow: [number, number, number]; size: [number, number, number] }> = {
  berry: { color: '#c4284f', glow: [3.2, 0.5, 1], size: [0.2, 0.2, 0.2] },
  med: { color: '#eeeeee', glow: [3, 0.6, 0.6], size: [0.3, 0.2, 0.24] },
};

export function lootMesh(kind: LootKind): THREE.Group {
  const L = LOOT_LOOK[kind];
  const g = new THREE.Group();
  const body = box(L.size[0], L.size[1], L.size[2], new THREE.MeshLambertMaterial({ color: L.color, emissive: L.color, emissiveIntensity: 0.25 }));
  g.add(body);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(...L.glow), toneMapped: false });
  if (kind === 'med') {
    g.add(box(0.16, 0.04, 0.05, glow, 0, L.size[1] / 2 + 0.01, 0), box(0.05, 0.04, 0.16, glow, 0, L.size[1] / 2 + 0.01, 0));
  } else if (kind === 'berry') {
    g.add(box(0.06, 0.08, 0.06, new THREE.MeshLambertMaterial({ color: '#3e8a33' }), 0, 0.13, 0));
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
  give(kind: LootKind, amount: number, at: THREE.Vector3): void;
  sound(k: 'open' | 'pickup' | 'break' | 'heal' | 'ignite'): void;
}

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

  reset(): void {
    for (const b of this.barrels) if (!b.exploded) this.scene.remove(b.group);
    for (const c of this.crates) if (!c.broken) this.scene.remove(c.group);
    for (const s of this.supplies) this.scene.remove(s.group);
    for (const t of this.terminals) this.scene.remove(t.group);
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups.length = 0;
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
      if (d < bd) { bd = d; best = { kind: 'supply', prompt: 'Открыть ящик с припасами', target: s }; }
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
      this.hooks.sound('open');
      // лут вываливается веером из-под крышки
      LOOT_TABLE.forEach(([kind, amount], i) => {
        const a = s.yaw + (i / (LOOT_TABLE.length - 1) - 0.5) * 2.6 + (this.rand() - 0.5) * 0.3;
        const sp = 2.2 + this.rand() * 1.8;
        const vel = new THREE.Vector3(Math.sin(a) * sp, 3.6 + this.rand() * 1.6, Math.cos(a) * sp);
        const mesh = lootMesh(kind);
        const pos = s.mouth.add(new THREE.Vector3((this.rand() - 0.5) * 0.4, 0, (this.rand() - 0.5) * 0.3));
        mesh.position.copy(pos);
        this.scene.add(mesh);
        this.pickups.push({ kind, amount, pos, vel, mesh, lock: 0.7 + i * 0.03, t: this.rand() * 6 });
      });
      this.fx.burst(s.mouth, [new THREE.Color(3, 2.4, 0.6)], 14, { speed: 2, up: 3, size: 0.06, life: 0.6, glow: true, gravity: 5 });
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
        this.hooks.sound('break');
        // иногда в ящике малина
        if (this.rand() < 0.35) {
          const mesh = lootMesh('berry');
          const pos = c.pos.clone().setY(0.5);
          mesh.position.copy(pos);
          this.scene.add(mesh);
          this.pickups.push({ kind: 'berry', amount: 3, pos, vel: new THREE.Vector3((this.rand() - 0.5) * 2, 3, (this.rand() - 0.5) * 2), mesh, lock: 0.5, t: 0 });
        }
      }
    }
    for (const s of this.supplies) s.update(dt);
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
    // лут: летит, падает, крутится; подбирается проходя мимо, вблизи притягивается
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.lock -= dt;
      p.vel.y -= 12 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.14) {
        p.pos.y = 0.14;
        if (Math.abs(p.vel.y) > 1.5) { p.vel.y = -p.vel.y * 0.3; p.vel.x *= 0.5; p.vel.z *= 0.5; }
        else { p.vel.y = 0; const k = Math.exp(-6 * dt); p.vel.x *= k; p.vel.z *= k; }
      }
      const grounded = p.pos.y <= 0.15 && p.vel.lengthSq() < 0.3;
      const d = Math.hypot(hero.pos.x - p.pos.x, hero.pos.z - p.pos.z);
      if (p.lock <= 0 && !hero.down && d < 1.7) {
        // притягивается к герою
        const pull = hero.pos.clone().setY(0.6).sub(p.pos).setLength(Math.min(8, 3 + (1.7 - d) * 6) * dt);
        p.pos.add(pull);
        if (d < 0.6) {
          this.scene.remove(p.mesh);
          this.pickups.splice(i, 1);
          this.hooks.give(p.kind, p.amount, p.pos);
          this.hooks.sound('pickup');
          continue;
        }
      }
      p.mesh.position.copy(p.pos);
      if (grounded) p.mesh.position.y = 0.2 + Math.sin(p.t * 3) * 0.05;
      p.mesh.rotation.y += dt * (grounded ? 1.8 : 6);
      if (!grounded) p.mesh.rotation.x += dt * 5;
      else p.mesh.rotation.x *= Math.exp(-8 * dt);
    }
    return healed;
  }
}
