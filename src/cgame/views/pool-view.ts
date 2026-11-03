import * as THREE from 'three';
import type { FX } from '../../fx.ts';
import type { EntityState } from '../../net/snapshot.ts';
import type { PoolEnt } from '../../sim/entities.ts';
import { FIRE, TAR } from './colors.ts';

/** Лужа смолы котла (`pool<n>`): чёрный круг на земле, тает по остатку времени `t`, над ней дымок и язычки огня */
export class PoolView {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly at = new THREE.Vector3();
  private r = 2.2;

  constructor(private readonly scene: THREE.Scene, private readonly fx: FX, ent: EntityState) {
    const e = ent as PoolEnt;
    this.r = e.r;
    this.mat = new THREE.MeshBasicMaterial({ color: TAR, transparent: true, opacity: 0.85, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(e.r, 20), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.set(ent);
  }

  set(ent: EntityState): void {
    const e = ent as PoolEnt;
    this.at.set(e.x, 0, e.z);
    this.mesh.position.set(e.x, 0.03, e.z);
    if (e.r !== this.r) { this.r = e.r; this.mesh.geometry.dispose(); this.mesh.geometry = new THREE.CircleGeometry(e.r, 20); }
    this.mat.opacity = Math.min(0.85, e.t * 0.6);
  }

  update(_dt: number): void {
    if (Math.random() < 0.4) this.fx.particle({ pos: this.at.clone().add(new THREE.Vector3((Math.random() - 0.5) * this.r * 1.6, 0.1, (Math.random() - 0.5) * this.r * 1.6)), vel: new THREE.Vector3(0, 0.6, 0), life: 0.6, size: 0.08, color: Math.random() < 0.5 ? FIRE : '#3a3028', gravity: 0 }, Math.random() < 0.5);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}
