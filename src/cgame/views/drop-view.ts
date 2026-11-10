import * as THREE from 'three';
import { UNIT } from '../../bosses/kit.ts';
import type { FX } from '../../fx.ts';
import { itemDef, RARITY } from '../../items.ts';
import type { EntityState } from '../../net/snapshot.ts';

/**
 * An item a fallen enemy left (`d<n>`, src/sim/drops.ts): a spinning cube in the rarity colour under a pillar of light, as loot in
 * Minecraft Dungeons. A relic's pillar is taller, golden-white inside, with sparks rising along it
 */
const BEAM = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true).translate(0, 0.5, 0);
const RELIC = new THREE.Color(3.6, 2.2, 0.6);

export class DropView {
  private readonly group = new THREE.Group();
  private readonly cube: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly core: THREE.Mesh;
  private readonly mats: THREE.Material[] = [];
  private readonly color: THREE.Color;
  private readonly relic: boolean;
  private time = Math.random() * 6;
  private readonly scene: THREE.Scene;
  private readonly fx: FX;

  constructor(scene: THREE.Scene, fx: FX, ent: EntityState) {
    this.scene = scene; this.fx = fx;
    this.relic = !!ent.relic;
    let css = '#a7abb3';
    try { css = RARITY[itemDef(String(ent.def)).rarity].color; } catch { /* an item this build does not know */ }
    this.color = this.relic ? RELIC.clone() : new THREE.Color(css).multiplyScalar(2.2);
    const glow = (c: THREE.Color, opacity: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      this.mats.push(m);
      return m;
    };
    const solid = new THREE.MeshBasicMaterial({ color: this.color, toneMapped: false });
    this.mats.push(solid);
    this.cube = new THREE.Mesh(UNIT, solid);
    this.cube.scale.setScalar(this.relic ? 0.42 : 0.32);
    this.beam = new THREE.Mesh(BEAM, glow(this.color.clone().multiplyScalar(0.16), 0.4));
    this.core = new THREE.Mesh(BEAM, glow(this.color.clone().multiplyScalar(0.5), 0.6));
    const h = this.relic ? 7 : 4;
    this.beam.scale.set(this.relic ? 0.36 : 0.24, h, this.relic ? 0.36 : 0.24);
    this.core.scale.set(0.05, h * 0.8, 0.05);
    this.group.add(this.cube, this.beam, this.core);
    scene.add(this.group);
    this.set(ent);
  }

  set(ent: EntityState): void { this.group.position.set(ent.x as number, ent.y as number, ent.z as number); }

  update(dt: number): void {
    this.time += dt;
    this.cube.rotation.y += dt * 2.4;
    this.cube.rotation.x = 0.6;
    this.cube.position.y = 0.15 + Math.sin(this.time * 3) * 0.12;
    const pulse = 0.85 + Math.sin(this.time * 5) * 0.15;
    this.beam.scale.x = this.beam.scale.z = (this.relic ? 0.36 : 0.24) * pulse;
    this.beam.rotation.y += dt;
    if (Math.random() < (this.relic ? 0.5 : 0.15)) {
      const a = Math.random() * Math.PI * 2, p = this.group.position;
      this.fx.particle({ pos: new THREE.Vector3(p.x + Math.cos(a) * 0.3, p.y, p.z + Math.sin(a) * 0.3), vel: new THREE.Vector3(0, 2 + Math.random() * 2, 0), life: 0.9, size: 0.06, color: Math.random() < 0.5 ? this.color : '#ffffff', gravity: 0 });
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const m of this.mats) m.dispose();
  }
}
