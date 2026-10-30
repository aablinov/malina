import * as THREE from 'three';
import type { FX } from '../fx';
import { C, glowMat, RASP } from '../bosses/kit';
import { boom, hiss } from '../spell-audio';
import type { TdLane } from './types';

/**
 * Логово (wiki/design-tower-defence.md, раздел 6): начало дороги врагов. В пещере на карте — завеса малинового света
 * и рунное кольцо на полу; перед волной по этой дороге кольцо разгорается и пульсирует (warn), каждый выход врага —
 * вспышка, кольцо-волна и искры. Так видно, откуда и когда ждать.
 */
export class Lair {
  readonly pos: THREE.Vector3;
  /** Куда выходят: единичный вектор к первой точке дороги */
  readonly dir: THREE.Vector3;
  readonly group = new THREE.Group();
  /** Тревога 0..1: волна по этой дороге вот-вот */
  warn = 0;
  /** Сколько врагов вышло (для тестов) */
  spawned = 0;
  private readonly ring: THREE.MeshBasicMaterial;
  private readonly veil: THREE.MeshBasicMaterial;
  private readonly runes: THREE.MeshBasicMaterial;
  private readonly veilMesh: THREE.Mesh;
  private time = 0;
  private burstT = 0;

  constructor(private readonly scene: THREE.Scene, private readonly fx: FX, readonly lane: TdLane, private readonly quiet: () => boolean) {
    const [x, z] = lane.points[0], [nx, nz] = lane.points[1];
    this.pos = new THREE.Vector3(x, 0, z);
    this.dir = new THREE.Vector3(nx - x, 0, nz - z).normalize();
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
  }

  /** Враг вышел: вспышка, волна по полу, искры, низкий гул */
  burst(): void {
    this.spawned++;
    this.burstT = 1;
    this.fx.flash(this.pos.clone().setY(1.2), RASP, 2.2, 0.25);
    this.fx.shock(this.pos.clone().setY(0.06), 2.2, RASP, 0.4, 0.14);
    this.fx.burst(this.pos.clone().setY(0.8), [RASP, '#ffffff', C(3.4, 1.2, 2.2)], 14, { speed: 3, up: 3, size: 0.09, life: 0.6, glow: true, gravity: 6 });
    if (!this.quiet()) { boom(110, 50, 0.3, 0.2); hiss({ dur: 0.2, vol: 0.06, f: 1800, f1: 600, q: 1 }); }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.ring.dispose(); this.veil.dispose(); this.runes.dispose();
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
}
