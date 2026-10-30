import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import type { Target } from '../target';
import { pixelTex } from '../textures';
import { C, glowMat, UNIT, wrap } from '../bosses/kit';
import { hiss, voice } from '../spell-audio';
import { MAX_LEVEL, TOWERS, UPGRADE_DMG, UPGRADE_RANGE, upgradeCost, type TowerDef, type TowerKind } from './towers';

/**
 * Башня обороны куста (wiki/design-tower-defence.md): стоит на площадке, сама выбирает цель — того, кто дальше всех
 * прошёл по дороге, — и бьёт по-своему (src/td/towers.ts). Модель из кубиков в стиле мобов, уровни I–III меняют
 * урон, дальность и вид. Урон идёт в Target.hit, как от меча: мобы вспыхивают, рассыпаются, роняют малину.
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
const _dir = new THREE.Vector3();

/** Снаряд по прямой: летит к точке, где была цель, попадает — hit */
interface Bolt { mesh: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; hit: () => void }

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
  private readonly lamps: THREE.MeshLambertMaterial[] = [];
  private readonly glows: THREE.MeshBasicMaterial[] = [];
  private readonly bolts: Bolt[] = [];
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
    for (const b of this.bolts.splice(0)) this.h.scene.remove(b.mesh);
    this.h.scene.remove(this.group);
    for (const m of this.lamps) m.dispose();
    for (const m of this.glows) m.dispose();
  }

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
      case 'arrow': this.buildArrow(); break;
      default: this.buildArrow(); break;
    }
    // знак уровня: малиновые ягоды-светильники на углах основания — одна, две, три
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
    // раскосы
    for (const s of [-1, 1]) { B(this.body, woodD, 0.08, 1.5, 0.08, s * 0.55, 1.2, 0, 0.6, 0, 0); B(this.body, woodD, 0.08, 1.5, 0.08, 0, 1.2, s * 0.55, 0, 0, 0.6); }
    B(this.body, wood, 1.4, 0.14, 1.4, 0, 0.5 + H, 0);
    for (const s of [-1, 1]) { B(this.body, woodD, 1.4, 0.08, 0.08, 0, 0.5 + H + 0.4, s * 0.66); B(this.body, woodD, 0.08, 0.08, 1.4, s * 0.66, 0.5 + H + 0.4, 0); }
    for (const [x, z] of [[-0.66, -0.66], [0.66, -0.66], [-0.66, 0.66], [0.66, 0.66]]) B(this.body, woodD, 0.1, 0.5, 0.1, x, 0.5 + H + 0.25, z);
    // навес на уровне II, флажок на III
    if (this.level >= 2) {
      for (const [x, z] of [[-0.6, -0.6], [0.6, 0.6]]) B(this.body, woodD, 0.08, 1.1, 0.08, x, 0.5 + H + 0.55, z);
      B(this.body, this.lam('#a8443a'), 1.7, 0.1, 1.7, 0, 0.5 + H + 1.12, 0, 0.12, 0, 0);
    }
    if (this.level >= 3) { B(this.body, woodD, 0.06, 0.9, 0.06, 0.6, 0.5 + H + 1.6, -0.6); B(this.body, this.lam('#d8285a', false), 0.44, 0.24, 0.03, 0.82, 0.5 + H + 1.9, -0.6); }
    // арбалет: ложе, дуга, тетива, болт
    this.turret.position.set(0, 0.5 + H + 0.25, 0);
    this.body.add(this.turret);
    B(this.turret, iron, 0.12, 0.3, 0.12, 0, 0.1, 0);
    B(this.turret, woodD, 0.14, 0.12, 0.9, 0, 0.32, 0.1);
    B(this.turret, iron, 0.9, 0.06, 0.08, 0, 0.34, 0.4);
    B(this.turret, this.lam('#e8e0c8', false), 0.84, 0.02, 0.02, 0, 0.36, 0.26);
    B(this.turret, this.glow(C(2.2, 2.0, 1.2)), 0.05, 0.05, 0.5, 0, 0.4, 0.3);
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
  private strike(f: Foe, dmg: number, knock: number, point: THREE.Vector3): void {
    if (!f.alive) return;
    const wasAlive = f.alive;
    _dir.set(f.pos.x - this.pos.x, 0, f.pos.z - this.pos.z).normalize();
    f.hit(dmg, _dir, point, knock);
    this.dealt += dmg;
    this.h.fx.text(point.clone().setY(point.y + 0.3), String(dmg), '');
    if (wasAlive && !f.alive) this.kills++;
  }

  private fire(t: Foe): void {
    this.shots++;
    this.recoil = 1;
    switch (this.def.id) {
      default: this.fireArrow(t); break;
    }
  }

  /** Болт: летит по прямой к цели, попал — урон */
  private fireArrow(t: Foe): void {
    const from = this.pos.clone().add(new THREE.Vector3(Math.sin(this.turret.rotation.y) * 0.5, 2.9, Math.cos(this.turret.rotation.y) * 0.5));
    const to = t.pos.clone().setY(t.pos.y + Math.min(1, (t.topY ?? 1.4) * 0.6));
    const mesh = new THREE.Mesh(UNIT, glowMat(C(2.4, 2.1, 1.2)));
    mesh.scale.set(0.06, 0.06, 0.5);
    mesh.position.copy(from);
    mesh.lookAt(to);
    this.h.scene.add(mesh);
    const dmg = this.dmg;
    this.bolts.push({ mesh, from, to, t: 0, dur: from.distanceTo(to) / 34, hit: () => this.strike(t, dmg, 0.4, to) });
    if (!this.h.quiet()) hiss({ dur: 0.08, vol: 0.08, f: 2600, f1: 900, q: 1.2 });
  }

  update(dt: number): void {
    this.time += dt;
    this.cd -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    // цель: держим прежнюю, пока жива и в радиусе, иначе — первого по дороге
    if (!this.target || !this.inRange(this.target)) this.target = this.pick();
    const t = this.target;
    if (t) {
      const want = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), d = wrap(want - this.turret.rotation.y), m = 9 * dt;
      this.turret.rotation.y += Math.max(-m, Math.min(m, d));
      if (this.cd <= 0 && Math.abs(d) < 0.5) { this.cd = this.def.cd; this.fire(t); }
    }
    this.turret.position.z = -this.recoil * 0.12;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.mesh.position.lerpVectors(b.from, b.to, k);
      if (k >= 1) { this.bolts.splice(i, 1); this.h.scene.remove(b.mesh); (b.mesh as THREE.Mesh).material && ((b.mesh as THREE.Mesh).material as THREE.Material).dispose(); b.hit(); }
    }
  }
}
