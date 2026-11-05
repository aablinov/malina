import type * as THREE from 'three';

/** A target for strikes and explosions: dummies, barrels, crates, later — enemies */
export interface Target {
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly alive: boolean;
  /** Target height (crate, barrel), m */
  readonly topY?: number;
  /** A thing, not an enemy (barrel, crate): offensive auras leave it alone */
  readonly prop?: boolean;
  hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void;
  /** Slow: k — the fraction of speed it loses (0.3 = −30 %), for sec seconds */
  chill?(k: number, sec: number): void;
  /** Weaken: damage to the target ×(1 + k) for sec seconds */
  expose?(k: number, sec: number): void;
  /** Stun for sec seconds (regular mobs; not bosses) */
  stun?(sec: number): void;
}
