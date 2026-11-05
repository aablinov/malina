import type { EntityState } from './snapshot.ts';
import type { GearAction, TdCommand } from './protocol.ts';

/**
 * Battle protocol (wiki/design-multiplayer.md, section 7) — a separate WebSocket `/game` over `Channel` (src/net/channel.ts):
 * the unreliable lane carries input commands (`Cmd`) from the client and snapshot deltas (`Delta`) from the server; the reliable one — joining the match,
 * builds, gear actions, kits, the result. The server runs the battle (src/game/match.ts), the client predicts its own hero
 */

/** Input command — usercmd: number, acknowledged snapshot, movement, aim, attack, roll (once), bow, ping */
export interface Cmd {
  seq: number;
  /** Last applied snapshot (its number is the base of the next delta) */
  snap: number;
  move: [number, number];
  aim: [number, number, number];
  attack: boolean;
  roll: boolean;
  bow: boolean;
  ping: number;
}

export type GameClientMsg =
  | { t: 'hello'; token: string; matchId: string; protocol: number }
  | ({ t: 'td' } & Omit<TdCommand, 't'>)
  /** seq — the client's last command before the action: the server executes it in the same order with movement */
  | ({ t: 'act'; seq?: number } & GearAction)
  /** Own gear kit (items and equipped) — bought from the sutler for cost battle raspberries */
  | { t: 'kit'; items: unknown[]; equip: unknown; cost?: number };

export type GameServerMsg =
  | { t: 'welcome'; seat: number; tick: number }
  | { t: 'kit'; seat: number; items: unknown[]; equip: unknown }
  | ({ t: 'act'; seat: number } & GearAction)
  | { t: 'toast'; text: string }
  | { t: 'over'; result: 'won' | 'lost' | 'abandoned'; wave: number }
  | { t: 'error'; text: string };

/** Hero in the snapshot: `h<seat>` */
export type HeroEnt = EntityState & { seat: number; x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; down: 0 | 1; mx: number; mz: number; ax: number; az: number; attack: 0 | 1; roll: 0 | 1; bow: 0 | 1; ack: number; ping: number };
/** Enemy in the snapshot: `m<network id>` */
export type MobEnt = EntityState & { kind: string; x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; flags: number; attack: string; seq: number; ax: number; az: number; lane: string; marchI: number; mx: number; mz: number };
/** Enemy flags in the snapshot: summoned (no raspberries), stunned, slowed by cold, inspired by a banner, noticed the hero */
export const MOB_FLAG = { summoned: 1, daze: 2, chill: 4, rally: 8, alerted: 16 } as const;

/** Physics tick and server frame (a snapshot after every frame) */
export const TICK = 1 / 60;
export const FRAME_MS = 50;
export const CMD_BACKLOG = 8;
/** Commands per client frame over a lossy transport (cl_packetdup): the latest and the previous ones — a lost frame does not lose input; over TCP — one */
export const CMD_DUP = 3;
/** Unreliable part of a client frame — a batch of the latest commands in ascending seq */
export type CmdBatch = Cmd[];
/** Snapshots in the server ring */
export const SNAP_RING = 32;
/** Battle end → result after this many seconds: the harvest reaches the purses */
export const LOOT_DELAY = 4.5;
