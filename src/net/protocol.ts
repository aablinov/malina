import { MAX_PLAYERS } from '../bosses/scaling.ts';

/**
 * Протокол сетевой игры (wiki/design-multiplayer.md): общий для браузера (src/net/client.ts) и сервера (server/).
 * Только типы и константы — без DOM и three, сервер импортирует файл напрямую.
 *
 * Модель — серверно-авторитарная: бой считает сервер (src/game/match.ts) и шлёт снимки по отдельному WebSocket `/game`
 * (src/net/game-protocol.ts); здесь — лобби, комнаты, чат, профили и итог боя.
 */

/** Версия протокола: не совпала — сервер закрывает соединение с кодом CLOSE.protocol */
export const PROTOCOL = 2;

/** До четырёх героев в партии, как у стражей */
export { MAX_PLAYERS };

export const NET_LIMITS = {
  /** Наибольшее сообщение, байт */
  maxMessage: 64 * 1024,
  /** Сообщений в секунду на соединение */
  perSecond: 100,
  /** Сколько держать место отключившегося игрока, мс */
  graceMs: 30_000,
  /** Сообщение чата: символов и не чаще раза в столько мс */
  chatMax: 200,
  chatMs: 400,
  /** Пинг клиента, мс */
  pingMs: 15_000,
  /** Наибольший профиль, байт */
  maxProfile: 256 * 1024,
} as const;

/** Коды закрытия WebSocket */
export const CLOSE = {
  protocol: 4001,
  /** Не прислал hello вовремя (страница была занята) — переподключиться, вход не забывать */
  hello: 4002,
  auth: 4003,
  flood: 4008,
  /** Тот же игрок вошёл с другой вкладки */
  replaced: 4009,
  /** Окно надёжных сообщений переполнено — клиент не подтверждает (как Q3 роняет клиента) */
  overflow: 4010,
} as const;

export type RoomState = 'lobby' | 'battle' | 'closed';
export type MatchResult = 'won' | 'lost' | 'abandoned';

/** Комната в списке лобби и в `room.state` (продолжение `OnlineLobby` из src/menu/session.ts) */
export interface RoomInfo {
  id: string;
  /** Код для входа: шесть букв */
  code: string;
  /** Имя хоста */
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
  /** Соединение живо; false — место держится NET_LIMITS.graceMs */
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

/** Друг: имя, на связи ли, комната (войти по коду — и в лобби, и в идущий бой, если есть место) */
export interface FriendInfo { playerId: string; name: string; online: boolean; room: RoomInfo | null }

export interface MapRecord { map: string; bestWave: number; wins: number; fastestWinMs: number | null }

// ---------- Сообщения ----------

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
  /** «Ещё раз» после боя — только хост: новый бой тем же составом, без готовности */
  | { t: 'room.again' }
  /** Чат комнаты (лагерь и бой) */
  | { t: 'chat'; text: string };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; name: string }
  | { t: 'pong' }
  | { t: 'error'; code: ErrorCode; text: string }
  /** Комната изменилась; you — твоё место */
  | { t: 'room.state'; room: RoomInfo; seats: SeatInfo[]; you: number }
  | { t: 'room.left'; reason: 'leave' | 'kick' | 'closed' }
  /** Бой начался: страница боя входит в матч по `/game` (src/net/game-protocol.ts); hostSeat — корона в списке */
  | { t: 'battle.start'; matchId: string; map: string; players: number; seed: number; hostSeat: number; seats: SeatInfo[] }
  | { t: 'battle.over'; matchId: string; result: MatchResult; wave: number }
  | { t: 'chat'; seat: number; name: string; text: string }
  | { t: 'profile.updated'; version: number; data: unknown };

export type ErrorCode =
  | 'bad-message' | 'no-room' | 'room-full' | 'not-host' | 'not-ready' | 'bad-map' | 'in-room' | 'not-in-battle';

// ---------- REST ----------

export interface AuthReply { playerId: string; name: string; token: string }
export interface ProfileReply { version: number; data: unknown }

/** Имя героя: 2–16 букв, цифр, пробелов, _ и - */
export const NAME_RE = /^[\p{L}\p{N}_\- ]{2,16}$/u;
export const validName = (s: unknown): s is string => typeof s === 'string' && s.trim() === s && NAME_RE.test(s);

// ---------- Бой: команды и действия (общие для симуляции и протокола боя, src/net/game-protocol.ts) ----------

/**
 * Действие героя (src/gear.ts, `Gear.onAction`): артефакт гнезда i в точку at с зарядом c, зелье, вспышка ауры, спец-удар.
 * Клиент шлёт серверу, сервер повторяет снаряжением героя (урон) и пересылает остальным с местом seat (вид)
 */
export type GearAction =
  | { k: 'art'; i: number; at: [number, number]; c: number }
  /** Заряд заклинания начался (видно, как набирает) и сброшен без каста */
  | { k: 'charge'; i: number; at: [number, number] }
  | { k: 'cancel' }
  | { k: 'potion' }
  | { k: 'aura' }
  | { k: 'special'; at: [number, number] };

/** Команда обороны (src/sim/td.ts): действие меню площадки (build:вид, upgrade, sell, repair), починка стены, волна сейчас */
export interface TdCommand { t: 'td'; a: string; pad?: number; wall?: string }
