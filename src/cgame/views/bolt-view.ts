import * as THREE from 'three';
import { C, glowMat, UNIT } from '../../bosses/kit.ts';
import type { FX } from '../../fx.ts';
import type { EntityState } from '../../net/snapshot.ts';
import type { BoltEnt } from '../../sim/entities.ts';
import { ARCANE, ICE, STAR, TAR } from './colors.ts';

/**
 * Tower projectile (`b<n>`): position from the flight fraction `k` in the record: lerp(from, to, k) + sin(k·π)·h in height (arc).
 * Look per kind: bolt and ice clot — a glowing streak nose towards the target; rock and tar ladle — tumble;
 * meteor — a star lump (the trail and warning ring belong to the `tower.fire` event); the obelisk orb — a glowing ball with sparks
 */
export class BoltView {
  private readonly mesh: THREE.Mesh;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly kind: string;

  private readonly scene: THREE.Scene;
  private readonly fx: FX;
  constructor(scene: THREE.Scene, fx: FX, ent: EntityState) { this.scene = scene; this.fx = fx;
    const e = ent as BoltEnt;
    this.kind = e.kind;
    this.mesh = BoltView.build(e.kind);
    scene.add(this.mesh);
    this.set(ent);
  }

  private static build(kind: string): THREE.Mesh {
    let m: THREE.Mesh;
    switch (kind) {
      case 'frost': m = new THREE.Mesh(UNIT, glowMat(ICE)); m.scale.set(0.16, 0.16, 0.16 * 6); break;
      case 'splash': m = new THREE.Mesh(UNIT, new THREE.MeshLambertMaterial({ color: '#6a6a70' })); m.scale.setScalar(0.34); m.castShadow = true; break;
      case 'oil': m = new THREE.Mesh(UNIT, new THREE.MeshLambertMaterial({ color: TAR })); m.scale.set(0.5, 0.3, 0.5); break;
      case 'meteor': m = new THREE.Mesh(UNIT, glowMat(STAR)); m.scale.setScalar(0.9); break;
      case 'magic': m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glowMat(ARCANE)); break;
      default: m = new THREE.Mesh(UNIT, glowMat(C(2.4, 2.1, 1.2))); m.scale.set(0.06, 0.06, 0.06 * 6); break;
    }
    return m;
  }

  set(ent: EntityState): void {
    const e = ent as BoltEnt;
    this.from.set(e.fx, e.fy, e.fz);
    this.to.set(e.tx, e.ty, e.tz);
    const k = e.k;
    this.mesh.position.lerpVectors(this.from, this.to, k);
    this.mesh.position.y += Math.sin(k * Math.PI) * e.h;
    if (this.kind === 'arrow' || this.kind === 'frost') this.mesh.lookAt(this.to);
  }

  update(dt: number): void {
    switch (this.kind) {
      case 'splash': case 'oil': this.mesh.rotation.x += dt * 6; this.mesh.rotation.z += dt * 4; break;
      case 'magic':
        // orb trail: sparks behind the head
        if (Math.random() < 0.4) this.fx.particle({ pos: this.tmp.copy(this.mesh.position), vel: new THREE.Vector3(0, 0.3, 0), life: 0.3, size: 0.07, color: ARCANE, gravity: 0 });
        break;
      case 'meteor': this.mesh.rotation.x += dt * 4; this.mesh.rotation.y += dt * 3; break;
    }
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    (this.mesh.material as THREE.Material).dispose();
    if (this.mesh.geometry !== UNIT) this.mesh.geometry.dispose();
  }
}
