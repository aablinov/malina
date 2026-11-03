import * as THREE from 'three';
import { disposeOwned, type FX } from '../../fx.ts';
import type { LootData } from '../../loot-look.ts';
import type { EntityState } from '../../net/snapshot.ts';
import { lootMesh } from '../../props.ts';
import type { PileEnt } from '../../sim/entities.ts';

/**
 * Кучка малины с павшего врага (`p<n>`): ягода из src/props.ts (`lootMesh('berry')`), место — из записи, вью его догоняет;
 * на земле (y ≤ 0,15) покачивается и крутится, в полёте кувыркается и светит хвостом — как лут в Props
 */
export class PileView {
  private readonly mesh: THREE.Group;
  private readonly target = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private t = 0;
  private first = true;

  private readonly scene: THREE.Scene;
  private readonly fx: FX;
  constructor(scene: THREE.Scene, fx: FX, ent: EntityState) { this.scene = scene; this.fx = fx;
    this.mesh = lootMesh('berry');
    scene.add(this.mesh);
    this.set(ent);
  }

  set(ent: EntityState): void {
    const e = ent as PileEnt;
    this.target.set(e.x, e.y, e.z);
    if (this.first) { this.first = false; this.pos.copy(this.target); this.mesh.position.copy(this.pos); }
  }

  update(dt: number): void {
    this.t += dt;
    const far = this.pos.distanceToSquared(this.target) > 4;
    if (far) this.pos.copy(this.target); else this.pos.lerp(this.target, Math.min(1, dt * 18));
    const grounded = this.target.y <= 0.15 && !far && this.pos.distanceToSquared(this.target) < 0.01;
    this.mesh.position.copy(this.pos);
    if (grounded) this.mesh.position.y = 0.2 + Math.sin(this.t * 3) * 0.05;
    this.mesh.rotation.y += dt * (grounded ? 1.8 : 6);
    if (!grounded) this.mesh.rotation.x += dt * 5;
    else this.mesh.rotation.x *= Math.exp(-8 * dt);
    const ud = this.mesh.userData as LootData;
    // в полёте — светящийся хвост, на земле — искры вокруг
    if (ud.glow) {
      if (!grounded) { if (Math.random() < 0.5) this.fx.particle({ pos: this.pos.clone(), vel: new THREE.Vector3(0, 0.3, 0), life: 0.35, size: 0.07, color: ud.glow, gravity: 0 }); }
      else if (Math.random() < dt * 3) {
        const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.3;
        this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.random() * 0.3, Math.sin(a) * r)), vel: new THREE.Vector3(0, 0.7 + Math.random() * 0.6, 0), life: 0.9, size: 0.05, color: Math.random() < 0.3 ? new THREE.Color(3, 3, 3) : ud.glow, gravity: -0.4, spin: 3 });
      }
    }
    ud.tick?.(this.t, grounded);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    disposeOwned(this.mesh);
  }
}
