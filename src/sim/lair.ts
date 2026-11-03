import * as THREE from 'three';
import type { EntityState } from '../net/snapshot.ts';
import type { TdLane } from '../td/types.ts';
import { r2 } from './entities.ts';
import type { SimWorld } from './world.ts';

/** Логово (раздел 6): начало дороги; тревога 0..1 перед волной по этой дороге, вспышка на каждый выход */
export class SimLair {
  readonly id: string;
  readonly lane: TdLane;
  readonly pos: THREE.Vector3;
  warn = 0;
  /** Сколько врагов вышло (для тестов) */
  spawned = 0;
  private readonly w: SimWorld;

  constructor(w: SimWorld, lane: TdLane) {
    this.w = w;
    this.lane = lane;
    this.id = `lair:${lane.id}`;
    this.pos = new THREE.Vector3(lane.points[0][0], 0, lane.points[0][1]);
  }

  burst(): void {
    this.spawned++;
    this.w.emit({ t: 'lair.burst', id: this.id, x: this.pos.x, y: 0, z: this.pos.z });
  }

  entity(out: EntityState[]): void { out.push({ id: this.id, lane: this.lane.id, warn: r2(this.warn) }); }
}
