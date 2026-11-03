import * as THREE from 'three';
import { C, glowMat, RASP } from '../../bosses/kit.ts';
import type { FX } from '../../fx.ts';
import type { EntityState } from '../../net/snapshot.ts';
import type { LairEnt } from '../../sim/entities.ts';
import type { SimEvent } from '../../sim/events.ts';
import type { TdLane } from '../../td/types.ts';

/**
 * Логово (`lair:<дорога>`): начало дороги врагов — завеса малинового света и рунное кольцо на полу;
 * тревога `warn` из записи (перед волной кольцо разгорается и пульсирует), выход врага — событие `lair.burst` (вспышка поверх)
 */
export class LairView {
  readonly pos: THREE.Vector3;
  /** Куда выходят: единичный вектор к первой точке дороги */
  readonly dir: THREE.Vector3;
  readonly group = new THREE.Group();
  private warn = 0;
  private readonly ring: THREE.MeshBasicMaterial;
  private readonly veil: THREE.MeshBasicMaterial;
  private readonly runes: THREE.MeshBasicMaterial;
  private readonly veilMesh: THREE.Mesh;
  private time = 0;
  private burstT = 0;

  constructor(private readonly scene: THREE.Scene, private readonly fx: FX, readonly lane: TdLane, ent: EntityState) {
    const [x, z] = lane.points[0], [nx, nz] = lane.points[1] ?? lane.points[0];
    this.pos = new THREE.Vector3(x, 0, z);
    this.dir = new THREE.Vector3(nx - x, 0, nz - z);
    if (this.dir.lengthSq() < 1e-6) this.dir.set(0, 0, 1); else this.dir.normalize();
    this.group.position.copy(this.pos);
    this.ring = glowMat(RASP, 0.5, true);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 32), this.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    this.group.add(ring);
    // руны: четыре штриха по кольцу
    this.runes = glowMat(C(3.4, 1.2, 2.2), 0.7, true);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const r = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.14), this.runes);
      r.rotation.x = -Math.PI / 2; r.rotation.z = -a;
      r.position.set(Math.cos(a) * 1.2, 0.055, Math.sin(a) * 1.2);
      this.group.add(r);
    }
    // завеса: вертикальная плоскость поперёк выхода, за ней — вглубь пещеры; светится тускло, при выходе вспыхивает
    this.veil = glowMat(RASP, 0.22, true);
    this.veil.side = THREE.DoubleSide;
    this.veilMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), this.veil);
    this.veilMesh.position.set(-this.dir.x * 1.2, 1.5, -this.dir.z * 1.2);
    this.veilMesh.rotation.y = Math.atan2(this.dir.x, this.dir.z);
    this.group.add(this.veilMesh);
    scene.add(this.group);
    this.set(ent);
  }

  set(ent: EntityState): void { this.warn = (ent as LairEnt).warn; }

  onEvent(e: SimEvent): void {
    if (e.t === 'lair.burst') this.burstT = 1;
  }

  update(dt: number): void {
    this.time += dt;
    this.burstT = Math.max(0, this.burstT - dt * 2.5);
    // тихое дыхание; тревога — чаще и ярче; вспышка выхода — поверх
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (1.5 + this.warn * 6));
    const k = 0.3 + this.warn * 0.5 * pulse + this.burstT * 0.6;
    this.ring.opacity = Math.min(1, k);
    this.runes.opacity = Math.min(1, 0.5 + this.warn * 0.5 * pulse + this.burstT * 0.5);
    this.veil.opacity = Math.min(0.9, 0.18 + this.warn * 0.25 * pulse + this.burstT * 0.7);
    this.veilMesh.scale.setScalar(1 + this.burstT * 0.15);
    if (this.warn > 0 && Math.random() < this.warn * 0.25) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.4, 0.1, (Math.random() - 0.5) * 2.4)), vel: new THREE.Vector3(0, 1 + Math.random(), 0), life: 0.7, size: 0.07, color: RASP, gravity: 0 });
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.ring.dispose(); this.veil.dispose(); this.runes.dispose();
    for (const o of this.group.children) if (o instanceof THREE.Mesh) o.geometry.dispose();
  }
}
