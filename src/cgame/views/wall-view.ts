import * as THREE from 'three';
import { UNIT } from '../../bosses/kit.ts';
import type { FX } from '../../fx.ts';
import type { EntityState } from '../../net/snapshot.ts';
import type { WallEnt } from '../../sim/entities.ts';
import type { SimEvent } from '../../sim/events.ts';
import type { TdWall } from '../../td/types.ts';
import { pixelTex } from '../../textures.ts';
import { DUST, WALL_EMBER } from './colors.ts';

/**
 * Стена или ворота замка (`w:<id>`): блоки стены рисует карта (пролом и починка меняют уровень в симуляции),
 * здесь — створки ворот (приоткрытые внутрь, разбитые — лежат), дрожь от удара, пыль битой стены и угли пролома.
 * Здоровье и пролом — из записи, удар — событие `wall.hurt`
 */
export class WallView {
  readonly pos: THREE.Vector3;
  readonly out: THREE.Vector3;
  readonly group = new THREE.Group();
  private hp: number;
  private maxHp: number;
  private dead = false;
  private hurtT = 0;
  private time = 0;
  private readonly leaves: THREE.Group[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly fx: FX, readonly spec: TdWall, ent: EntityState) {
    this.out = new THREE.Vector3(spec.out[0], 0, spec.out[1]);
    this.pos = new THREE.Vector3(spec.breach[0], 0, spec.breach[1]);
    this.hp = this.maxHp = spec.hp;
    if (spec.kind === 'gate') {
      const cx = (spec.x0 + spec.x1) / 2, cz = (spec.z0 + spec.z1) / 2;
      this.buildGate(cx, cz, spec.x1 - spec.x0 + 1 >= spec.z1 - spec.z0 + 1);
    }
    scene.add(this.group);
    this.set(ent);
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

  /** Доля здоровья */
  get k(): number { return Math.max(0, this.hp / this.maxHp); }

  set(ent: EntityState): void {
    const e = ent as WallEnt;
    this.hp = e.hp; this.maxHp = e.maxHp;
    const dead = e.dead === 1;
    if (dead === this.dead) return;
    this.dead = dead;
    // разбитые ворота: створки падают; починены — встают на петли
    if (dead) for (const [i, g] of this.leaves.entries()) { g.rotation.x = 0.1; g.rotation.z = (i ? -1 : 1) * 1.3; g.position.y = -0.3; }
    else for (const g of this.leaves) { g.rotation.x = 0; g.rotation.z = 0; g.position.y = 0; }
  }

  onEvent(e: SimEvent): void {
    if (e.t === 'wall.hurt') this.hurtT = 0.4;
  }

  update(dt: number): void {
    this.time += dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    // битая стена сыплет пылью, у пролома тлеют угли
    const k = this.k;
    if (!this.dead && k < 0.6 && Math.random() < (0.6 - k) * 0.5) {
      this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3)).addScaledVector(this.out, 0.8), vel: new THREE.Vector3(0, -0.8, 0), life: 0.9, size: 0.07, color: DUST[Math.floor(Math.random() * 3)], gravity: 2 }, false);
    }
    if (this.dead && Math.random() < 0.15) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.2, (Math.random() - 0.5) * 2)), vel: new THREE.Vector3(0, 0.6 + Math.random(), 0), life: 0.8, size: 0.06, color: Math.random() < 0.5 ? WALL_EMBER : '#5a5650', gravity: 0 }, true);
    // створки дрожат от удара
    if (this.spec.kind === 'gate' && !this.dead) for (const [i, g] of this.leaves.entries()) g.rotation.x = this.hurtT > 0 ? Math.sin(this.time * 40) * 0.04 * this.hurtT * (i ? -1 : 1) : 0;
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const m of this.mats) m.dispose();
  }
}
