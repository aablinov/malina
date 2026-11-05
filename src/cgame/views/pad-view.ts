import * as THREE from 'three';
import { C, glowMat } from '../../bosses/kit.ts';
import type { TdPad } from '../../td/types.ts';

/** Tower pad: a ring on the ground, highlighted under the cursor and with the menu open; whether it is taken is told by TdView (from the tower record) */
export class PadView {
  readonly pos: THREE.Vector3;
  readonly group = new THREE.Group();
  hover = false;
  /** A tower stands on the pad (a `t<n>` record in the snapshot) */
  occupied = false;
  private readonly ring: THREE.MeshBasicMaterial;
  private readonly disc: THREE.Mesh;
  private readonly discMat: THREE.MeshBasicMaterial;

  private readonly scene: THREE.Scene;
  readonly spec: TdPad;
  readonly index: number;
  constructor(scene: THREE.Scene, spec: TdPad, index: number) { this.scene = scene; this.spec = spec; this.index = index;
    this.pos = new THREE.Vector3(spec.x, spec.y ?? 0, spec.z);
    this.group.position.copy(this.pos);
    // highlight ring: always dim, bright under the cursor; the pad's stone circle is drawn by the map in blocks
    this.ring = glowMat(C(1.2, 1.0, 0.5), 0.35, true);
    const r = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.45, 24), this.ring);
    r.rotation.x = -Math.PI / 2;
    r.position.y = 0.05;
    this.group.add(r);
    this.discMat = glowMat(C(1.2, 1.0, 0.5), 0.08, true);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), this.discMat);
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.045;
    this.group.add(this.disc);
    scene.add(this.group);
  }

  update(dt: number, t: number): void {
    const k = this.hover ? 1 : this.occupied ? 0.08 : 0.3 + Math.sin(t * 2 + this.index) * 0.08;
    this.ring.opacity += (k - this.ring.opacity) * Math.min(1, dt * 12);
    this.disc.visible = this.hover && !this.occupied;
  }

  /** The camera ray passes over the pad (at tower height if one stands) */
  hitBy(ray: THREE.Ray): boolean {
    const a = this.pos, b = this.pos.clone().setY(this.pos.y + (this.occupied ? 3 : 0.4));
    return ray.distanceSqToSegment(a, b) < 1.45 * 1.45;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.ring.dispose();
    this.discMat.dispose();
    for (const o of this.group.children) if (o instanceof THREE.Mesh) o.geometry.dispose();
  }
}
