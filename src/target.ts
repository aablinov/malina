import type * as THREE from 'three';

/** Цель для ударов и взрывов: чучела, бочки, ящики, позже — враги */
export interface Target {
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly alive: boolean;
  /** Высота цели (ящик, бочка), м */
  readonly topY?: number;
  /** Вещь, а не враг (бочка, ящик): наступательные ауры её не трогают */
  readonly prop?: boolean;
  hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void;
  /** Замедлить: k — доля скорости, которую теряет (0,3 = −30 %), на sec секунд */
  chill?(k: number, sec: number): void;
  /** Ослабить: урон по цели ×(1 + k) на sec секунд */
  expose?(k: number, sec: number): void;
  /** Оглушить на sec секунд (рядовые мобы; боссы — нет) */
  stun?(sec: number): void;
}
