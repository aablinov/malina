import type * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { Level } from '../level/level.ts';
import { terrainOf, type Terrain } from '../level/collide.ts';
import type { EntityState } from '../net/snapshot.ts';
import { useDecoys, type Decoy } from '../decoys.ts';
import { rng, useRng, type Rand } from '../rng.ts';
import type { Target } from '../target.ts';
import type { SimEvent } from './events.ts';
import { Drops } from './drops.ts';
import { SimExpedition } from './expedition.ts';
import { Piles } from './pile.ts';
import type { Rules, SimMode } from './rules.ts';
import { SimTd } from './td.ts';

/**
 * Simulation world — the Quake 3 "game" (wiki/design-multiplayer.md): no scene, DOM, sound or system randomness; the same code
 * runs on the server and in the browser (single player is a listen server). Everything visible is events (`events`) and entity records (`entities()`).
 * While heroes and enemies live in the old classes (src/knight.ts, src/mobs/), the world reaches them through the `SimHooks` hooks
 */

/** Enemy for towers and projectiles: a target with its share of the lane travelled (closer to the bush — first) */
export interface Foe extends Target {
  readonly progress?: number;
  readonly dead: boolean;
}

/** Hero as a target for raspberry piles and alarms: position, whether exhausted, seat in the party */
export interface HeroLike { readonly pos: THREE.Vector3; readonly down: boolean; readonly seat: number }

/** Enemy that left a lair onto a lane (src/mobs/mob.ts): the defence sets its route and wariness */
export interface MarchingMob {
  march: THREE.Vector3[] | null;
  laneId: string | null;
  marchI: number;
  aggro: number;
  yaw: number;
  readonly ghost: boolean;
  extendMarch(points: THREE.Vector3[]): void;
  readonly title: string;
}

export interface SimHooks {
  /** Living enemies on the map (tower targets) */
  foes(): readonly Foe[];
  /** Party heroes — the raspberry gatherers */
  heroes(): readonly HeroLike[];
  /** Enemy from the roster at a point; null — no such kind */
  spawnMob(kind: string, at: THREE.Vector3): MarchingMob | null;
  /** Enemies get tougher with waves and players */
  setScale(level: number, players: number): void;
  /** Level blocks changed (breach, repair): recompute obstacles */
  levelChanged?(): void;
  /** A fallen hero gets up — where he lies or at a point (rules that own the downed state: src/sim/expedition.ts) */
  raise?(seat: number, at?: THREE.Vector3): void;
  /** A hero on his feet gets health back (a healing totem, src/sim/parcel.ts) */
  heal?(seat: number, n: number): void;
  /** Step of heroes and the pack inside the world step — under this world's game randomness and decoys */
  step?(dt: number): void;
}

export interface SimWorldOpts {
  seed: number;
  level: Level | null;
  /** What is played (src/sim/rules.ts); none — a bare world: enemies, piles, drops */
  mode?: SimMode;
  players?: number;
  /** Shared battle: each seat has its own raspberries */
  personal?: boolean;
  /** A network battle's client: the rules only mirror the server's — they post no enemies and do not tick */
  mirror?: boolean;
}

export class SimWorld {
  tick = 0;
  time = 0;
  readonly rng: Rand;
  readonly seed: number;
  readonly level: Level | null;
  /** Level terrain (floors of the plateau, terraces, ramps); null — an empty test world on the y = 0 plane */
  readonly terrain: Terrain | null;
  readonly h: SimHooks;
  /** The match rules of the mode; null — a bare world */
  readonly rules: Rules | null;
  /** The same rules when the mode is Bush Defence — for its views and menus */
  readonly td: SimTd | null;
  /** The same rules when the mode is an expedition */
  readonly expedition: SimExpedition | null;
  readonly piles: Piles;
  /** Items from fallen enemies (src/sim/drops.ts) */
  readonly drops: Drops;
  /** This world's mob decoys: bush, walls, towers, summons (src/decoys.ts) */
  readonly decoys: Decoy[] = [];
  events: SimEvent[] = [];
  private nextId = 0;

  constructor(h: SimHooks, o: SimWorldOpts) {
    this.h = h;
    this.seed = o.seed;
    this.rng = rng(o.seed);
    this.level = o.level;
    this.terrain = o.level ? terrainOf(o.level) : null;
    this.piles = new Piles(this);
    this.drops = new Drops(this);
    const mode = o.mode, players = o.players ?? 1, personal = o.personal ?? false;
    // the rules may post enemies right away (garrisons): under this world's randomness, like everything in a step
    this.td = mode?.kind === 'td' ? this.scoped(() => new SimTd(this, mode.td, players, personal)) : null;
    this.expedition = mode?.kind === 'expedition' ? this.scoped(() => new SimExpedition(this, mode.spec, players, personal, !!o.mirror)) : null;
    this.rules = this.td ?? this.expedition;
  }

  /** Floor under a point no higher than y + step (the bush on the plateau, a splash on a terrace, a landed pile); a chasm or no level — 0 */
  floor(x: number, z: number, y = 0): number {
    const f = this.terrain?.floorAt(x, z, y) ?? 0;
    return f > -Infinity ? f : 0;
  }

  emit(e: SimEvent): void { this.events.push(e); }
  /** Number of a new entity with the kind prefix */
  id(prefix: string): string { return `${prefix}${++this.nextId}`; }

  /** Hero obstacles: the bush trunk and towers */
  get solids(): Obstacle[] { return this.rules?.solids ?? []; }
  /** Enemy obstacles: the same plus intact gates */
  get foeSolids(): Obstacle[] { return this.rules?.foeSolids ?? []; }

  /** Events since the last pickup — the view and the snapshot take them after the step; what happened between steps (hero hits) is here too */
  takeEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }

  /** Run something of the game outside a step (a command that spawns enemies) under this world's randomness and decoys */
  scoped<T>(fn: () => T): T {
    const r1 = useRng(this.rng), r2 = useDecoys(this.decoys);
    try { return fn(); } finally { r2(); r1(); }
  }

  /** World step: game randomness and decoys are this world's, then heroes and the pack (hook), the rules, piles */
  step(dt: number): void {
    const r1 = useRng(this.rng), r2 = useDecoys(this.decoys);
    try {
      this.tick++;
      this.time += dt;
      this.h.step?.(dt);
      this.rules?.update(dt);
      this.piles.update(dt);
      this.drops.update(dt);
    } finally { r2(); r1(); }
  }

  /** Records of all entities for the snapshot (src/sim/entities.ts) */
  entities(): EntityState[] {
    const out: EntityState[] = [];
    this.rules?.entities(out);
    this.piles.entities(out);
    this.drops.entities(out);
    return out;
  }
}
