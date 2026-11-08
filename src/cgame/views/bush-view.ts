import * as THREE from 'three';
import { C, glowMat, RASP, UNIT } from '../../bosses/kit.ts';
import type { FX } from '../../fx.ts';
import type { EntityState } from '../../net/snapshot.ts';
import type { SimEvent } from '../../sim/events.ts';
import type { TdBush } from '../../td/types.ts';
import { pixelTex } from '../../textures.ts';

/**
 * The raspberry bush (`bush`) — what we defend. Model: a stump base, dark foliage in crowns, clusters of raspberry lamps
 * and a heart berry that beats and dims with damage. Health from the record, a hit is the `bush.hurt` event (foliage flash, shiver);
 * withered (`dead`) — the crown shrivels and darkens; revived (reset) — it rises back
 */
export class BushView {
  readonly pos: THREE.Vector3;
  readonly group = new THREE.Group();
  private hp: number;
  private maxHp: number;
  private dead = false;
  private readonly leaves: THREE.MeshLambertMaterial[] = [];
  private readonly berries: THREE.MeshBasicMaterial;
  private readonly heart: THREE.MeshBasicMaterial;
  private readonly crown = new THREE.Group();
  private flashT = 0;
  private time = 0;
  private hurtT = 0;

  private readonly scene: THREE.Scene;
  private readonly fx: FX;
  constructor(scene: THREE.Scene, fx: FX, spec: TdBush, ent: EntityState) { this.scene = scene; this.fx = fx;
    this.pos = new THREE.Vector3(spec.x, spec.y ?? 0, spec.z);
    this.hp = this.maxHp = spec.hp;
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
    // a mound of earth and a stump with roots
    B(this.group, soil, 2.6, 0.3, 2.6, 0, 0.15, 0, 0, Math.PI / 4, 0);
    B(this.group, soil, 2.6, 0.3, 2.6, 0, 0.15, 0);
    B(this.group, bark, 0.7, 0.9, 0.7, 0, 0.7, 0);
    for (let i = 0; i < 5; i++) { const a = i * 1.26; B(this.group, bark, 0.26, 0.26, 0.9, Math.cos(a) * 0.55, 0.36, Math.sin(a) * 0.55, 0, -a + Math.PI / 2, 0); }
    // crown: three tiers of rotated foliage cubes, lighter towards the top
    this.group.add(this.crown);
    const tiers: [number, number, THREE.MeshLambertMaterial][] = [[2.4, 1.0, leafD], [1.9, 1.75, leaf], [1.2, 2.4, leafL]];
    for (const [w, y, mat] of tiers) { B(this.crown, mat, w, 0.8, w, 0, y, 0); B(this.crown, mat, w * 0.95, 0.8, w * 0.95, 0, y + 0.1, 0, 0, Math.PI / 4, 0); }
    for (let i = 0; i < 8; i++) { const a = i * 0.785 + 0.3, r = 1.0 + (i % 2) * 0.3; B(this.crown, i % 2 ? leaf : leafD, 0.5, 0.5, 0.5, Math.cos(a) * r, 1.3 + (i % 3) * 0.4, Math.sin(a) * r, 0.3, a, 0.3); }
    // raspberry clusters over the crown and the heart on top
    for (let i = 0; i < 14; i++) { const a = i * 0.9, r = 0.7 + (i % 3) * 0.3; B(this.crown, this.berries, 0.2, 0.22, 0.2, Math.cos(a) * r, 1.0 + (i % 4) * 0.45, Math.sin(a) * r); }
    B(this.crown, this.heart, 0.44, 0.5, 0.44, 0, 3.0, 0, 0, Math.PI / 4, 0);
    B(this.crown, this.heart, 0.3, 0.3, 0.3, 0, 3.3, 0);
    B(this.crown, leafL, 0.5, 0.06, 0.2, 0.1, 3.3, 0.1, 0, 0.5, 0.3);
    scene.add(this.group);
    this.set(ent);
  }

  set(ent: EntityState): void {
    this.hp = ent.hp as number; this.maxHp = ent.maxHp as number;
    const dead = ent.dead === 1;
    if (dead === this.dead) return;
    this.dead = dead;
    // revived (everything anew): the crown is back
    if (!dead) { this.crown.scale.setScalar(1); this.crown.position.y = 0; }
  }

  onEvent(e: SimEvent): void {
    if (e.t === 'bush.hurt') { this.flashT = 0.08; this.hurtT = 0.4; }
  }

  update(dt: number): void {
    this.time += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    for (const m of this.leaves) m.emissive.setScalar(this.flashT > 0 ? 0.25 : 0);
    const k = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    // the heart beats: the less health, the faster and dimmer; the berries fade with it
    const beat = 0.75 + 0.25 * Math.max(0, Math.sin(this.time * (2 + (1 - k) * 4)));
    this.heart.color.copy(RASP).multiplyScalar(this.dead ? 0.15 : (0.35 + k * 0.65) * beat);
    this.berries.color.set(3.2, 0.5, 1.2).multiplyScalar(this.dead ? 0.2 : 0.5 + k * 0.5);
    if (this.dead) {
      // withered: the crown shrivels and darkens
      this.crown.scale.setScalar(Math.max(0.55, this.crown.scale.x - dt * 0.4));
      for (const m of this.leaves) m.color.lerp(new THREE.Color('#6a5a3a'), Math.min(1, dt * 0.6));
      return;
    }
    for (const m of this.leaves) m.color.lerp(new THREE.Color('#ffffff'), Math.min(1, dt * 0.6));
    // shakes from a hit, sways in the wind
    const sway = Math.sin(this.time * 1.1) * 0.02 + (this.hurtT > 0 ? Math.sin(this.time * 40) * 0.05 * this.hurtT : 0);
    this.crown.rotation.z = sway; this.crown.rotation.x = Math.cos(this.time * 0.9) * 0.015;
    if (k < 0.5 && Math.random() < (0.5 - k) * 0.4) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, -0.6, (Math.random() - 0.5) * 0.5), life: 1.2, size: 0.09, color: '#8a6a40', gravity: 1 }, false);
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const m of this.leaves) m.dispose();
    this.berries.dispose();
    this.heart.dispose();
  }
}
