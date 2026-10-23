import type * as THREE from 'three';

/** Цель для ударов и взрывов: чучела, бочки, ящики, позже — враги */
export interface Target {
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly alive: boolean;
  /** Высота цели (ящик, бочка), м */
  readonly topY?: number;
  hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void;
}
