import * as THREE from 'three';
import type { MobPost, MobRoomSpec } from '../level/playground-map.ts';
import type { MarchingMob, SimWorld } from './world.ts';

/**
 * Garrisons of an open map (wiki/design-expeditions.md, section 3): guards at posts, ambushes with a short sight, patrols on a
 * route. A garrison far from every hero sleeps — its mobs do not think and stay out of the snapshot; it wakes when a hero comes
 * within `WAKE_R` of its ground and stays awake while anyone in it has noticed a hero. The fallen do not return
 */

/** A mob at a post — what the garrison needs from the pack's mob (src/mobs/mob.ts) */
export interface PostedMob extends MarchingMob {
  readonly pos: THREE.Vector3;
  route: THREE.Vector3[] | null;
  readonly alerted: boolean;
  readonly dead: boolean;
  /** Does not think, is not jostled and is not sent to clients */
  asleep: boolean;
}

export const WAKE_R = 30;
/** How far a guard sees unless the post says otherwise */
const GUARD_AGGRO = 9;

export interface Garrison { spec: MobRoomSpec; mobs: PostedMob[]; awake: boolean }

export class Garrisons {
  readonly rooms: Garrison[];
  private readonly w: SimWorld;

  constructor(w: SimWorld, specs: readonly MobRoomSpec[]) {
    this.w = w;
    this.rooms = specs.map((spec) => ({ spec, mobs: spec.posts.map((p) => this.post(spec, p)).filter((m): m is PostedMob => m !== null), awake: false }));
  }

  private post(room: MobRoomSpec, p: MobPost): PostedMob | null {
    const m = this.w.h.spawnMob(p.kind, new THREE.Vector3(p.x, this.w.floor(p.x, p.z, 2), p.z)) as PostedMob | null;
    if (!m) return null;
    // they face the way in, see a hero up close (an ambush — closer still), a patrol walks its route
    m.yaw = Math.atan2(room.enter.x - p.x, room.enter.z - p.z);
    m.aggro = Math.min(m.aggro, p.aggro ?? GUARD_AGGRO);
    if (p.route) m.route = p.route.map(([x, z]) => new THREE.Vector3(x, this.w.floor(x, z, 2), z));
    m.asleep = true;
    return m;
  }

  /** Guards still standing */
  get alive(): number { return this.rooms.reduce((n, r) => n + r.mobs.filter((m) => !m.dead).length, 0); }
  room(id: string): Garrison | undefined { return this.rooms.find((r) => r.spec.id === id); }
  /** Whether a garrison has anyone left */
  cleared(id: string): boolean { const r = this.room(id); return !r || r.mobs.every((m) => m.dead); }

  update(): void {
    const heroes = this.w.h.heroes();
    for (const r of this.rooms) {
      const s = r.spec;
      const awake = r.mobs.some((m) => !m.dead && m.alerted)
        || heroes.some((h) => h.pos.x >= s.x0 - WAKE_R && h.pos.x <= s.x1 + WAKE_R && h.pos.z >= s.z0 - WAKE_R && h.pos.z <= s.z1 + WAKE_R);
      if (awake === r.awake) continue;
      r.awake = awake;
      for (const m of r.mobs) m.asleep = !awake;
    }
  }
}
