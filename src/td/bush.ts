import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import { pixelTex } from '../textures';
import { C, glowMat, RASP, UNIT } from '../bosses/kit';
import { addDecoy, type Decoy } from '../decoys';
import { boom, hiss } from '../spell-audio';

/**
 * Куст малины — что защищаем (wiki/design-tower-defence.md, раздел 4). Для мобов он приманка (src/decoys.ts) с taunt:
 * дошедшие до конца дороги бьют его, как героя, — урон идёт в hurt. Здоровье — из meta.td.bush; кончилось — куст засох.
 * Модель: пень-основание, тёмная листва кронами, гроздья малины-светильников и сердце-ягода, которое бьётся и тускнеет с уроном.
 */
export class RaspberryBush implements Decoy {
  readonly pos: THREE.Vector3;
  readonly radius = 1.3;
  readonly taunt = 7;
  readonly group = new THREE.Group();
  /** Ствол — препятствие для героя и врагов (крона — нет, чтобы мобы доставали) */
  readonly solid: Obstacle;
  hp: number;
  maxHp: number;
  dead = false;
  /** Всего получено урона */
  taken = 0;
  onDeath?: () => void;
  private readonly leaves: THREE.MeshLambertMaterial[] = [];
  private readonly berries: THREE.MeshBasicMaterial;
  private readonly heart: THREE.MeshBasicMaterial;
  private readonly crown = new THREE.Group();
  private flashT = 0;
  private time = 0;
  private hurtT = 0;
  private readonly unreg: () => void;

  constructor(private readonly scene: THREE.Scene, private readonly fx: FX, x: number, z: number, hp: number, private readonly quiet: () => boolean) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.hp = this.maxHp = hp;
    this.solid = { x, z, hx: 0.45, hz: 0.45, rot: 0, h: 1.2 };
    this.group.position.copy(this.pos);
    const B = (parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
      const m = new THREE.Mesh(UNIT, mat);
      m.scale.set(w, h, d); m.position.set(px, py, pz); m.rotation.set(rx, ry, rz);
      m.castShadow = !(mat instanceof THREE.MeshBasicMaterial); m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const lam = (c: string, seed: number): THREE.MeshLambertMaterial => { const m = new THREE.MeshLambertMaterial({ map: pixelTex(c, 10, seed) }); this.leaves.push(m); return m; };
    const soil = lam('#6a4a30', 951), bark = lam('#5a3a22', 952), leafD = lam('#2f6a2a', 953), leaf = lam('#4a9a3a', 954), leafL = lam('#6ab84a', 955);
    this.berries = glowMat(C(3.2, 0.5, 1.2));
    this.heart = glowMat(RASP);
    // холмик земли и пень с корнями
    B(this.group, soil, 2.6, 0.3, 2.6, 0, 0.15, 0, 0, Math.PI / 4, 0);
    B(this.group, soil, 2.6, 0.3, 2.6, 0, 0.15, 0);
    B(this.group, bark, 0.7, 0.9, 0.7, 0, 0.7, 0);
    for (let i = 0; i < 5; i++) { const a = i * 1.26; B(this.group, bark, 0.26, 0.26, 0.9, Math.cos(a) * 0.55, 0.36, Math.sin(a) * 0.55, 0, -a + Math.PI / 2, 0); }
    // крона: три яруса кубов-листвы с разворотом, светлее кверху
    this.group.add(this.crown);
    const tiers: [number, number, THREE.MeshLambertMaterial][] = [[2.4, 1.0, leafD], [1.9, 1.75, leaf], [1.2, 2.4, leafL]];
    for (const [w, y, mat] of tiers) { B(this.crown, mat, w, 0.8, w, 0, y, 0); B(this.crown, mat, w * 0.95, 0.8, w * 0.95, 0, y + 0.1, 0, 0, Math.PI / 4, 0); }
    for (let i = 0; i < 8; i++) { const a = i * 0.785 + 0.3, r = 1.0 + (i % 2) * 0.3; B(this.crown, i % 2 ? leaf : leafD, 0.5, 0.5, 0.5, Math.cos(a) * r, 1.3 + (i % 3) * 0.4, Math.sin(a) * r, 0.3, a, 0.3); }
    // гроздья малины по кроне и сердце наверху
    for (let i = 0; i < 14; i++) { const a = i * 0.9, r = 0.7 + (i % 3) * 0.3; B(this.crown, this.berries, 0.2, 0.22, 0.2, Math.cos(a) * r, 1.0 + (i % 4) * 0.45, Math.sin(a) * r); }
    B(this.crown, this.heart, 0.44, 0.5, 0.44, 0, 3.0, 0, 0, Math.PI / 4, 0);
    B(this.crown, this.heart, 0.3, 0.3, 0.3, 0, 3.3, 0);
    B(this.crown, leafL, 0.5, 0.06, 0.2, 0.1, 3.3, 0.1, 0, 0.5, 0.3);
    scene.add(this.group);
    this.unreg = addDecoy(this);
  }

  get alive(): boolean { return !this.dead; }

  /** Удар моба: урон, вспышка, цифра; кончилось — засох */
  hurt(dmg: number, from: THREE.Vector3): void {
    if (this.dead) return;
    const v = Math.round(dmg);
    this.hp = Math.max(0, this.hp - v);
    this.taken += v;
    this.flashT = 0.12;
    this.hurtT = 0.4;
    this.fx.text(this.pos.clone().setY(2.2), `−${v}`, 'bad');
    const dir = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z).normalize();
    this.fx.burst(this.pos.clone().setY(1.4).addScaledVector(dir, -0.8), ['#4a9a3a', '#2f6a2a', RASP], 8, { speed: 2.5, up: 2, size: 0.1, life: 0.5, gravity: 8 });
    if (!this.quiet()) hiss({ dur: 0.1, vol: 0.08, f: 700, f1: 300, q: 1 });
    if (this.hp <= 0) this.die();
  }

  private die(): void {
    this.dead = true;
    this.fx.flash(this.pos.clone().setY(2.5), RASP, 4, 0.5);
    this.fx.burst(this.pos.clone().setY(1.5), [RASP, '#4a9a3a', '#8a6a40'], 50, { speed: 5, up: 5, size: 0.12, life: 1.2, gravity: 7 });
    this.fx.shake = Math.max(this.fx.shake, 1);
    this.fx.darken(1.2);
    if (!this.quiet()) boom(120, 30, 1.2, 0.5);
    this.onDeath?.();
  }

  /** Заново: здоровье полное, крона на месте */
  reset(): void {
    this.hp = this.maxHp;
    this.dead = false;
    this.crown.scale.setScalar(1);
    this.crown.position.y = 0;
  }

  dispose(): void {
    this.unreg();
    this.scene.remove(this.group);
    for (const m of this.leaves) m.dispose();
    this.berries.dispose();
    this.heart.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    for (const m of this.leaves) m.emissive.setScalar(this.flashT > 0 ? 0.5 : 0);
    const k = this.hp / this.maxHp;
    // сердце бьётся: чем меньше здоровья, тем чаще и тусклее; ягоды гаснут вместе с ним
    const beat = 0.75 + 0.25 * Math.max(0, Math.sin(this.time * (2 + (1 - k) * 4)));
    this.heart.color.copy(RASP).multiplyScalar(this.dead ? 0.15 : (0.35 + k * 0.65) * beat);
    this.berries.color.set(3.2, 0.5, 1.2).multiplyScalar(this.dead ? 0.2 : 0.5 + k * 0.5);
    if (this.dead) {
      // засох: крона съёживается и темнеет
      this.crown.scale.setScalar(Math.max(0.55, this.crown.scale.x - dt * 0.4));
      for (const m of this.leaves) m.color.lerp(new THREE.Color('#6a5a3a'), Math.min(1, dt * 0.6));
      return;
    }
    for (const m of this.leaves) m.color.lerp(new THREE.Color('#ffffff'), Math.min(1, dt * 0.6));
    // трясётся от удара, покачивается на ветру
    const sway = Math.sin(this.time * 1.1) * 0.02 + (this.hurtT > 0 ? Math.sin(this.time * 40) * 0.05 * this.hurtT : 0);
    this.crown.rotation.z = sway; this.crown.rotation.x = Math.cos(this.time * 0.9) * 0.015;
    if (k < 0.5 && Math.random() < (0.5 - k) * 0.4) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, -0.6, (Math.random() - 0.5) * 0.5), life: 1.2, size: 0.09, color: '#8a6a40', gravity: 1 }, false);
  }
}
