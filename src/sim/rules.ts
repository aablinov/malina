import type * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { ExpeditionSpec } from '../expedition/types.ts';
import type { Level } from '../level/level.ts';
import type { TdCommand } from '../net/protocol.ts';
import type { EntityState } from '../net/snapshot.ts';
import type { Target } from '../target.ts';
import type { TdSpec } from '../td/types.ts';

/**
 * Match rules (wiki/adr-006-expeditions.md): what the battle is about, when it ends and what it pays. The world, the headless
 * battle and the match know only this interface; Bush Defence (src/sim/td.ts) is one implementation, an expedition is another
 */

export type RulesState = 'play' | 'won' | 'lost';

/** What is played on a level: the mode and its description from the map */
export type SimMode = { kind: 'td'; td: TdSpec } | { kind: 'expedition'; spec: ExpeditionSpec };

/** A level with its mode — what a match is started on */
export interface MatchMap { level: Level; mode: SimMode }

/**
 * Expedition command (src/sim/expedition.ts): use what the hero stands next to — a beacon, the plot, a chest, the extraction pad;
 * or call the parcel of a slot to a point (src/sim/parcel.ts)
 */
export type ExpCommand = { t: 'exp'; a: 'use' } | { t: 'exp'; a: 'parcel'; slot: number; x: number; z: number };

/** A player's action addressed to the rules */
export type RulesCommand = TdCommand | ExpCommand;

export interface Rules {
  readonly state: RulesState;
  /** The step being played now (the running wave); 0 — nothing started yet */
  readonly stage: number;
  /** Steps completed — the match result for history and records */
  readonly progress: number;
  /** Steps in total; 0 — no end (an endless run) */
  readonly goal: number;
  /** Whether the match loot goes to the camp */
  readonly paid: boolean;
  /** The rules decide when a fallen hero gets up (`SimHooks.raise`); otherwise he rises by himself after a moment */
  readonly ownsDowned?: boolean;
  /** Hero obstacles the rules own (towers, the bush trunk) */
  readonly solids: Obstacle[];
  /** Enemy obstacles: the same plus what only enemies cannot pass */
  readonly foeSolids: Obstacle[];
  /** Where heroes appear when the level has no spawn point */
  readonly muster: [number, number, number];
  /** Extra targets of sword, arrows and spells besides enemies */
  targets(): Target[];
  setPlayers(n: number): void;
  setRating(r: number): void;
  /** Starting raspberries of a seat */
  fund(seat: number): void;
  /** Pay from the seat's battle purse; false — not enough */
  spend(seat: number, cost: number): boolean;
  /** A seat's match loot so far */
  lootOf(seat: number): number;
  /** An enemy fell: its pile, its own loot before scaling, its kind */
  killed(at: THREE.Vector3, pile: number, base: number, kind?: string): void;
  /** Action of the player in seat `seat`; false — it failed */
  command(seat: number, c: RulesCommand): boolean;
  update(dt: number): void;
  entities(out: EntityState[]): void;
}
