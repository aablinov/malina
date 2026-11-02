import { MAX_PLAYERS } from '../bosses/scaling.ts';

/**
 * Протокол сетевой игры (wiki/design-multiplayer.md): общий для браузера (src/net/client.ts) и сервера (server/).
 * Только типы и константы — без DOM и three, сервер импортирует файл напрямую.
 *
 * Модель — хост-авторитарная: бой считает браузер хоста, сервер держит лобби, ретранслирует сообщения боя
 * и хранит профили и историю. Содержимое `relay` сервер не разбирает.
 */

/** Версия протокола: не совпала — сервер закрывает соединение с кодом CLOSE.protocol */
export const PROTOCOL = 1;

/** До четырёх героев в партии, как у стражей */
export { MAX_PLAYERS };

export const NET_LIMITS = {
  /** Наибольшее сообщение, байт */
  maxMessage: 64 * 1024,
  /** Сообщений в секунду на соединение */
  perSecond: 100,
  /** Ввода гостя в секунду — лишний отбрасывается */
  inputPerSecond: 60,
  /** Сколько держать место отключившегося игрока, мс */
  graceMs: 30_000,
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

/** Награда героя за бой — её прибавляет сервер */
export interface Reward { playerId: string; berries: number; xp: number }

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
  /** Бой: гость шлёт хосту (to не задан), хост — всем гостям или одному месту `to` */
  | { t: 'relay'; to?: number; d: unknown }
  /** Итог боя — только хост */
  | { t: 'battle.end'; result: 'won' | 'lost'; wave: number; rewards: Reward[] };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; name: string }
  | { t: 'pong' }
  | { t: 'error'; code: ErrorCode; text: string }
  /** Комната изменилась; you — твоё место */
  | { t: 'room.state'; room: RoomInfo; seats: SeatInfo[]; you: number }
  | { t: 'room.left'; reason: 'leave' | 'kick' | 'closed' }
  | { t: 'battle.start'; matchId: string; map: string; players: number; seed: number; hostSeat: number; seats: SeatInfo[] }
  | { t: 'battle.over'; matchId: string; result: MatchResult; wave: number }
  | { t: 'relay'; from: number; d: unknown }
  | { t: 'profile.updated'; version: number; data: unknown };

export type ErrorCode =
  | 'bad-message' | 'no-room' | 'room-full' | 'not-host' | 'not-ready' | 'bad-map' | 'in-room' | 'not-in-battle';

/**
 * Ввод гостя в `relay.d` — сериализованный `KnightInput` (src/knight.ts): move — по x/z, aim — точка на земле
 */
export interface GuestInput {
  t: 'in';
  seq: number;
  move: [number, number];
  aim: [number, number, number];
  attack: boolean;
  roll: boolean;
}

// ---------- REST ----------

export interface AuthReply { playerId: string; name: string; token: string }
export interface ProfileReply { version: number; data: unknown }

/** Имя героя: 2–16 букв, цифр, пробелов, _ и - */
export const NAME_RE = /^[\p{L}\p{N}_\- ]{2,16}$/u;
export const validName = (s: unknown): s is string => typeof s === 'string' && s.trim() === s && NAME_RE.test(s);

// ---------- Общий бой (relay.d) ----------
// Хост считает бой; гости шлют ввод (`GuestInput`) и команды обороны (`TdCommand`), хост 20 раз в секунду — снимок (`BattleSnap`).
// Числа в снимке — массивами, чтобы сообщение было коротким

/** Герой: место, x, y, z, взгляд, здоровье, наибольшее, без сил (0/1), ввод — move x/z, aim x/z, удар (0/1), перекат был (0/1) */
export type HeroSnap = [seat: number, x: number, y: number, z: number, yaw: number, hp: number, maxHp: number, down: number, mx: number, mz: number, ax: number, az: number, attack: number, roll: number];
/** Враг: сетевой id, вид, x, y (полёт), z, взгляд, здоровье, наибольшее */
export type MobSnap = [id: number, kind: string, x: number, y: number, z: number, yaw: number, hp: number, maxHp: number];
/** Башня на площадке: вид, уровень, прочность; 0 — площадка пуста */
export type TowerSnap = [kind: string, level: number, hp: number] | 0;

export interface TdSnap {
  state: 'play' | 'lost' | 'won';
  wave: number;
  next: number;
  /** Идёт волна (группы выходят или враги живы) */
  running: boolean;
  /** Общая казна */
  berries: number;
  bush: number;
  /** Прочность стен по порядку `meta.td.walls` */
  walls: number[];
  /** Башни по номеру площадки */
  towers: TowerSnap[];
}

export interface BattleSnap { t: 'snap'; tick: number; heroes: HeroSnap[]; mobs: MobSnap[]; td: TdSnap | null }

/** Команда обороны от гостя: действие меню площадки (build:вид, upgrade, sell, repair), починка стены, волна сейчас */
export interface TdCommand { t: 'td'; a: string; pad?: number; wall?: string }
