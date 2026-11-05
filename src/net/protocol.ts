import { MAX_PLAYERS } from '../bosses/scaling.ts';

/**
 * Network game protocol (wiki/design-multiplayer.md): shared by the browser (src/net/client.ts) and the server (server/).
 * Types and constants only — no DOM or three, the server imports the file directly.
 *
 * The model is server-authoritative: the server runs the battle (src/game/match.ts) and sends snapshots over a separate WebSocket `/game`
 * (src/net/game-protocol.ts); here — lobby, rooms, chat, profiles and the battle result.
 */

/** Protocol version: on mismatch the server closes the connection with code CLOSE.protocol */
export const PROTOCOL = 2;

/** Up to four heroes in a party, as with the wardens */
export { MAX_PLAYERS };

export const NET_LIMITS = {
  /** Largest message, bytes */
  maxMessage: 64 * 1024,
  /** Messages per second per connection */
  perSecond: 100,
  /** How long to hold a disconnected player's seat, ms */
  graceMs: 30_000,
  /** Chat message: characters, and no more than once per this many ms */
  chatMax: 200,
  chatMs: 400,
  /** Client ping, ms */
  pingMs: 15_000,
  /** Largest profile, bytes */
  maxProfile: 256 * 1024,
} as const;

/** WebSocket close codes */
export const CLOSE = {
  protocol: 4001,
  /** Did not send hello in time (the page was busy) — reconnect, keep the login */
  hello: 4002,
  auth: 4003,
  flood: 4008,
  /** The same player logged in from another tab */
  replaced: 4009,
  /** Reliable message window overflowed — the client is not acknowledging (as Q3 drops a client) */
  overflow: 4010,
} as const;

export type RoomState = 'lobby' | 'battle' | 'closed';
export type MatchResult = 'won' | 'lost' | 'abandoned';

/** Room in the lobby list and in `room.state` (continues `OnlineLobby` from src/menu/session.ts) */
export interface RoomInfo {
  id: string;
  /** Join code: six letters */
  code: string;
  /** Host name */
  host: string;
  hostId: string;
  map: string;
  players: number;
  max: number;
  private: boolean;
  state: RoomState;
}

export interface SeatInfo {
  seat: number;
  playerId: string;
  name: string;
  ready: boolean;
  /** Connection alive; false — the seat is held for NET_LIMITS.graceMs */
  online: boolean;
  host: boolean;
}

export interface MatchSummary {
  id: string;
  map: string;
  players: number;
  startedAt: number;
  endedAt: number | null;
  result: MatchResult | null;
  wave: number;
  berries: number;
  xp: number;
}

/** Friend: name, whether online, room (join by code — both a lobby and a running battle, if there is a seat) */
export interface FriendInfo { playerId: string; name: string; online: boolean; room: RoomInfo | null }

export interface MapRecord { map: string; bestWave: number; wins: number; fastestWinMs: number | null }

// ---------- Messages ----------

export type ClientMsg =
  | { t: 'hello'; token: string; protocol: number }
  | { t: 'ping' }
  | { t: 'room.create'; map: string; max: number; private: boolean }
  | { t: 'room.join'; code: string }
  | { t: 'room.leave' }
  | { t: 'room.ready'; ready: boolean }
  | { t: 'room.map'; map: string }
  | { t: 'room.kick'; playerId: string }
  | { t: 'room.start' }
  /** "Again" after a battle — host only: a new battle with the same party, no ready check */
  | { t: 'room.again' }
  /** Room chat (camp and battle) */
  | { t: 'chat'; text: string };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; name: string }
  | { t: 'pong' }
  | { t: 'error'; code: ErrorCode; text: string }
  /** The room changed; you — your seat */
  | { t: 'room.state'; room: RoomInfo; seats: SeatInfo[]; you: number }
  | { t: 'room.left'; reason: 'leave' | 'kick' | 'closed' }
  /** The battle started: the battle page joins the match over `/game` (src/net/game-protocol.ts); hostSeat — the crown in the list */
  | { t: 'battle.start'; matchId: string; map: string; players: number; seed: number; hostSeat: number; seats: SeatInfo[] }
  | { t: 'battle.over'; matchId: string; result: MatchResult; wave: number }
  | { t: 'chat'; seat: number; name: string; text: string }
  | { t: 'profile.updated'; version: number; data: unknown };

export type ErrorCode =
  | 'bad-message' | 'no-room' | 'room-full' | 'not-host' | 'not-ready' | 'bad-map' | 'in-room' | 'not-in-battle';

// ---------- REST ----------

export interface AuthReply { playerId: string; name: string; token: string }
export interface ProfileReply { version: number; data: unknown }

/** Hero name: 2–16 letters, digits, spaces, _ and - */
export const NAME_RE = /^[\p{L}\p{N}_\- ]{2,16}$/u;
export const validName = (s: unknown): s is string => typeof s === 'string' && s.trim() === s && NAME_RE.test(s);

// ---------- Battle: commands and actions (shared by the simulation and the battle protocol, src/net/game-protocol.ts) ----------

/**
 * Hero action (src/gear.ts, `Gear.onAction`): the artifact of slot i at point at with charge c, potion, aura flash, weapon art.
 * The client sends it to the server, the server replays it with the hero's gear (damage) and forwards it to the others with seat (view)
 */
export type GearAction =
  | { k: 'art'; i: number; at: [number, number]; c: number }
  /** Spell charge started (visibly building up) and dropped without a cast */
  | { k: 'charge'; i: number; at: [number, number] }
  | { k: 'cancel' }
  | { k: 'potion' }
  | { k: 'aura' }
  | { k: 'special'; at: [number, number] };

/** Defence command (src/sim/td.ts): a pad menu action (build:kind, upgrade, sell, repair), wall repair, wave now */
export interface TdCommand { t: 'td'; a: string; pad?: number; wall?: string }
