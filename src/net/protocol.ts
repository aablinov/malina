import { MAX_PLAYERS } from '../bosses/scaling.ts';

/**
 * Network game protocol (wiki/design-multiplayer.md): shared by the browser (src/net/client.ts) and the server (server/).
 * Types and constants only — no DOM or three, the server imports the file directly.
 *
 * The model is server-authoritative: the server runs the battle (src/game/match.ts) and sends snapshots over a separate WebSocket `/game`
 * (src/net/game-protocol.ts); here — lobby, rooms, chat, profiles and the battle result.
 */

/** Protocol version: on mismatch the server closes the connection with code CLOSE.protocol */
export const PROTOCOL = 5;

/** Up to four heroes in a party, as with the wardens */
export { MAX_PLAYERS };

export const NET_LIMITS = {
  /** Largest message, bytes */
  maxMessage: 64 * 1024,
  /**
   * Largest battle frame on `/game`, bytes after inflate: a frame carries every reliable in flight, and a `kit` is the whole
   * inventory (up to maxProfile) — room for a couple of those plus the rest
   */
  maxGameFrame: 1024 * 1024,
  /** Messages per second per connection */
  perSecond: 100,
  /** How long to hold a disconnected player's seat, ms */
  graceMs: 30_000,
  /** The same during a battle: closed the tab — the hero waits this long for "Return to battle" */
  battleGraceMs: 120_000,
  /** Chat message: characters, and no more than once per this many ms */
  chatMax: 200,
  chatMs: 400,
  /** Client ping, ms */
  pingMs: 15_000,
  /** Largest profile, bytes */
  maxProfile: 256 * 1024,
  /** Voice signalling (src/net/voice.ts): SDP and ICE candidate length, characters */
  sdpMax: 16 * 1024,
  iceMax: 1024,
  /** Room password, characters */
  passMax: 32,
} as const;

/** STUN by default; the server may replace it with its own list (env RTC_ICE_SERVERS, given in /api/health) */
export const DEFAULT_ICE: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
export interface IceServer { urls: string | string[]; username?: string; credential?: string }

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
  /** Join code: five digits */
  code: string;
  /** Host name (the crown; changes if the host leaves) */
  host: string;
  hostId: string;
  /** Who created the room */
  creator: string;
  map: string;
  players: number;
  max: number;
  /** Closed with a password */
  locked: boolean;
  state: RoomState;
  /** Current wave of the running battle; 0 — lobby */
  wave: number;
  /** Waves on the map */
  waves: number;
}

export interface SeatInfo {
  seat: number;
  playerId: string;
  name: string;
  ready: boolean;
  /** Connection alive; false — the seat is held for NET_LIMITS.graceMs */
  online: boolean;
  host: boolean;
  /** Microphone on (voice chat, key T) */
  voice: boolean;
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
  /** password '' — an open room */
  | { t: 'room.create'; map: string; max: number; password: string }
  /** password — for a locked room; not needed for a player of its running match (reconnect) */
  | { t: 'room.join'; code: string; password?: string }
  | { t: 'room.leave' }
  | { t: 'room.ready'; ready: boolean }
  | { t: 'room.map'; map: string }
  | { t: 'room.kick'; playerId: string }
  | { t: 'room.start' }
  /** "Again" after a battle — host only: a new battle with the same party, no ready check */
  | { t: 'room.again' }
  /** Room chat (camp and battle) */
  | { t: 'chat'; text: string }
  /** Voice: WebRTC signal to the seat `to` in one's room — the server only forwards it */
  | { t: 'rtc'; to: number; data: RtcSignal }
  /** Voice: one's microphone on / off — goes into SeatInfo.voice */
  | { t: 'voice'; on: boolean };

/** WebRTC signalling between two seats of a room (src/net/voice.ts) */
export type RtcSignal =
  | { k: 'offer' | 'answer'; sdp: string }
  | { k: 'ice'; c: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; name: string }
  | { t: 'pong' }
  | { t: 'error'; code: ErrorCode; text: string }
  /** The room changed; you — your seat */
  | { t: 'room.state'; room: RoomInfo; seats: SeatInfo[]; you: number }
  | { t: 'room.left'; reason: 'leave' | 'kick' | 'closed' }
  /**
   * The battle started: the battle page joins the match over `/game` (src/net/game-protocol.ts); hostSeat — the crown in the list.
   * resume — you are already in this running match (reconnected after closing the tab): the camp offers "Return to battle"
   */
  | { t: 'battle.start'; matchId: string; map: string; players: number; seed: number; hostSeat: number; seats: SeatInfo[]; resume?: boolean }
  | { t: 'battle.over'; matchId: string; result: MatchResult; wave: number }
  | { t: 'chat'; seat: number; name: string; text: string }
  | { t: 'rtc'; from: number; data: RtcSignal }
  | { t: 'profile.updated'; version: number; data: unknown };

export type ErrorCode =
  | 'bad-message' | 'no-room' | 'room-full' | 'not-host' | 'not-ready' | 'bad-map' | 'in-room' | 'not-in-battle'
  | 'need-password' | 'bad-password';

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
