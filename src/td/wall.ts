import * as THREE from 'three';
import type { FX } from '../fx';
import type { Level } from '../level/level.ts';
import type { Obstacle } from '../collision';
import { pixelTex } from '../textures';
import { C, UNIT } from '../bosses/kit';
import { hash2 } from '../level/kit.ts';
import { addDecoy, type Decoy } from '../decoys';
import { boom, hiss } from '../spell-audio';
import type { TdWall } from './types';

/**
 * Стена или ворота замка — осада (wiki/design-tower-defence.md, раздел 9). Для врагов это приманка (src/decoys.ts) с taunt:
 * дошедшие до конца дороги бьют её, подрывники взрывают. Здоровье кончилось — **пролом**: блоки стены (±2 клетки вдоль
 * стены, вся толщина) становятся воздухом с обломками, препятствия врагов пересчитываются, и дорога врагов продолжается
 * внутрь (`TowerDefense.breach`). Ворота — проём без блоков: створки закрыты для врагов (препятствие `solid`), герой проходит
 * через калитку; разбитые — створки падают. Починка (F у стены) возвращает здоровье и блоки.
 * Ниже половины здоровья кирпичи трескаются (`bricks_cracked`).
 */
interface Cell { x: number; y: number; z: number; name: string; rot: number }

const DUST = ['#8a8a90', '#6a6660', '#b8a890'];
const EMBER = C(3.4, 1.4, 0.3);

export class Wall implements Decoy {
  readonly pos: THREE.Vector3;
  readonly radius = 0.5;
  readonly taunt: number;
  readonly title: string;
  readonly id: string;
  readonly kind: 'wall' | 'gate';
  readonly out: THREE.Vector3;
  hp: number;
  readonly maxHp: number;
  dead = false;
  /** Всего получено урона и сколько раз чинили (для тестов) */
  taken = 0;
  repairs = 0;
  /** Пролом пробит (ворота разбиты) — вызывает режим: дорога продолжается */
  onBreak?: () => void;
  onRepair?: () => void;
  /** Препятствие для врагов (только у целых ворот) */
  readonly solid: Obstacle | null;
  readonly group = new THREE.Group();
  /** Клетки пролома как были на карте */
  private readonly cells: Cell[] = [];
  private cracked = false;
  private flashT = 0;
  private hurtT = 0;
  private time = 0;
  private readonly leaves: THREE.Group[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly unreg: () => void;

  constructor(private readonly scene: THREE.Scene, private readonly fx: FX, private readonly level: Level, readonly spec: TdWall, private readonly quiet: () => boolean, private readonly changed: () => void) {
    this.id = spec.id; this.title = spec.title; this.kind = spec.kind;
    this.hp = this.maxHp = spec.hp;
    this.taunt = spec.kind === 'gate' ? 12 : 6;
    this.out = new THREE.Vector3(spec.out[0], 0, spec.out[1]);
    this.pos = new THREE.Vector3(spec.breach[0], 0, spec.breach[1]);
    const alongX = spec.x1 - spec.x0 >= spec.z1 - spec.z0;
    for (let x = spec.x0; x <= spec.x1; x++) for (let z = spec.z0; z <= spec.z1; z++) {
      if (spec.kind === 'wall' && Math.abs(alongX ? x - spec.breach[0] : z - spec.breach[1]) > 2) continue;
      for (let y = spec.y0; y <= spec.y1 + 1; y++) {
        const name = level.nameAt(x, y, z);
        if (name && name !== 'air') this.cells.push({ x, y, z, name, rot: level.rotAt(x, y, z) });
      }
    }
    if (spec.kind === 'gate') {
      const cx = (spec.x0 + spec.x1) / 2, cz = (spec.z0 + spec.z1) / 2;
      this.solid = { x: cx, z: cz, hx: (spec.x1 - spec.x0 + 1) / 2, hz: (spec.z1 - spec.z0 + 1) / 2, rot: 0, h: 2 };
      this.buildGate(cx, cz, spec.x1 - spec.x0 + 1 >= spec.z1 - spec.z0 + 1);
    } else this.solid = null;
    scene.add(this.group);
    this.unreg = addDecoy(this);
  }

  get alive(): boolean { return !this.dead; }
  /** Доля здоровья */
  get k(): number { return Math.max(0, this.hp / this.maxHp); }
  /** Герой у стены: в 2,5 м от прямоугольника (в том числе на самой стене сверху) */
  near(p: THREE.Vector3): boolean {
    const s = this.spec;
    const dx = Math.max(s.x0 - 0.5 - p.x, 0, p.x - s.x1 - 0.5), dz = Math.max(s.z0 - 0.5 - p.z, 0, p.z - s.z1 - 0.5);
    return Math.hypot(dx, dz) < 2.5;
  }

  /** Створки ворот: две деревянные двери на петлях, приоткрытые внутрь — калитка для героя */
  private buildGate(cx: number, cz: number, alongX: boolean): void {
    const wood = new THREE.MeshLambertMaterial({ map: pixelTex('#6a4628', 10, 1201) }), iron = new THREE.MeshLambertMaterial({ color: '#3a3c42' });
    this.mats.push(wood, iron);
    const w = 1.5, h = 2;
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      // петля у края проёма на наружной грани
      g.position.set(alongX ? cx + s * 1.5 : cx + this.out.x * 1.4, 0, alongX ? cz + this.out.z * 1.4 : cz + s * 1.5);
      const leaf = new THREE.Group();
      g.add(leaf);
      const B = (mat: THREE.Material, sx: number, sy: number, sz: number, px: number, py: number, pz: number): void => {
        const m = new THREE.Mesh(UNIT, mat); m.scale.set(sx, sy, sz); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; leaf.add(m);
      };
      // створка от петли внутрь: доски, две железные полосы, заклёпки
      B(wood, w, h, 0.16, -s * w / 2, h / 2, 0);
      for (const y of [0.5, 1.5]) B(iron, w, 0.12, 0.2, -s * w / 2, y, 0);
      for (let i = 0; i < 3; i++) B(iron, 0.08, 0.08, 0.24, -s * (0.2 + i * 0.5), 1.0, 0);
      g.rotation.y = (alongX ? 0 : Math.PI / 2) + s * 1.1 * (alongX ? -this.out.z : this.out.x);
      this.group.add(g);
      this.leaves.push(g);
    }
  }

  /** Удар врага: урон, пыль, цифра; кончилось — пролом */
  hurt(dmg: number, _from: THREE.Vector3): void {
    if (this.dead) return;
    const v = Math.round(dmg);
    this.hp = Math.max(0, this.hp - v);
    this.taken += v;
    this.flashT = 0.1;
    this.hurtT = 0.4;
    const at = this.pos.clone().setY(1.2).addScaledVector(this.out, 0.6);
    this.fx.text(at.clone().setY(2.2), `−${v}`, 'bad');
    this.fx.burst(at, DUST, Math.min(16, 4 + v / 10), { speed: 2.5, up: 2, size: 0.1, life: 0.5, gravity: 8 });
    if (!this.quiet()) hiss({ dur: 0.1, vol: 0.07, f: 500, f1: 200, q: 1 });
    if (this.hp <= 0) this.collapse();
    else if (this.k < 0.5 && !this.cracked) this.crack();
  }

  /** Трещины: часть кирпичей пролома — треснутые */
  private crack(): void {
    this.cracked = true;
    if (this.kind !== 'wall') return;
    for (const c of this.cells) if (c.y <= this.spec.y1 && hash2(c.x + c.y * 7, c.z, 31) < 0.45 && this.level.nameAt(c.x, c.y, c.z) === c.name) this.level.set(c.x, c.y, c.z, 'bricks_cracked');
  }

  /** Пролом: блоки — в воздух, на полу обломки; ворота — створки падают */
  private collapse(): void {
    this.dead = true;
    const at = this.pos.clone().setY(1.5);
    this.fx.explosion(at, 3, C(2.0, 1.8, 1.4));
    this.fx.burst(at, DUST, 40, { speed: 5, up: 5, size: 0.16, life: 1.2, gravity: 9 });
    this.fx.shake = Math.max(this.fx.shake, 0.8);
    if (!this.quiet()) boom(90, 30, 1.0, 0.6);
    if (this.kind === 'wall') {
      for (const c of this.cells) {
        this.level.set(c.x, c.y, c.z, 'air');
        if (c.y === this.spec.y0 && hash2(c.x, c.z, 32) < 0.4) this.level.set(c.x, c.y, c.z, hash2(c.x, c.z, 33) < 0.5 ? 'cobble_slab' : 'bricks_slab');
      }
      this.changed();
    } else {
      for (const [i, g] of this.leaves.entries()) { g.rotation.x = 0.1; g.rotation.z = (i ? -1 : 1) * 1.3; g.position.y = -0.3; }
    }
    this.onBreak?.();
  }

  /** Починка: здоровье полное, блоки и створки на месте */
  repair(): void {
    const was = this.dead;
    this.hp = this.maxHp;
    this.dead = false;
    this.cracked = false;
    this.repairs++;
    if (this.kind === 'wall') {
      for (const c of this.cells) this.level.set(c.x, c.y, c.z, c.name, c.rot);
      this.changed();
    } else for (const g of this.leaves) { g.rotation.x = 0; g.rotation.z = 0; g.position.y = 0; }
    const at = this.pos.clone().setY(1.2).addScaledVector(this.out, -0.5);
    this.fx.burst(at, ['#ffffff', '#d8cfa8', '#9a8f70'], 24, { speed: 3, up: 3, size: 0.12, life: 0.7, gravity: 8 });
    this.fx.shock(this.pos.clone().setY(0.06), 3, C(1.6, 1.4, 0.8), 0.4, 0.14);
    if (!this.quiet()) boom(220, 80, 0.3, 0.3);
    if (was) this.onRepair?.();
  }

  dispose(): void {
    this.unreg();
    this.scene.remove(this.group);
    for (const m of this.mats) m.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    // битая стена сыплет пылью, у пролома тлеют угли
    const k = this.k;
    if (!this.dead && k < 0.6 && Math.random() < (0.6 - k) * 0.5) {
      this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3)).addScaledVector(this.out, 0.8), vel: new THREE.Vector3(0, -0.8, 0), life: 0.9, size: 0.07, color: DUST[Math.floor(Math.random() * 3)], gravity: 2 }, false);
    }
    if (this.dead && Math.random() < 0.15) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.2, (Math.random() - 0.5) * 2)), vel: new THREE.Vector3(0, 0.6 + Math.random(), 0), life: 0.8, size: 0.06, color: Math.random() < 0.5 ? EMBER : '#5a5650', gravity: 0 }, true);
    // створки дрожат от удара
    if (this.kind === 'gate' && !this.dead) for (const [i, g] of this.leaves.entries()) g.rotation.x = this.hurtT > 0 ? Math.sin(this.time * 40) * 0.04 * this.hurtT * (i ? -1 : 1) : 0;
  }
}

/** Цвет полосы стены в HUD */
export const wallBarColor = (k: number): string => k > 0.5 ? '#9ad87a' : k > 0.25 ? '#ffd25a' : '#ff6a5a';
