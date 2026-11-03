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
  /** Сколько после конца боя ещё принимается награда игрока (`battle.loot`), мс */
  lootMs: 10 * 60_000,
  /** Сколько держать место отключившегося игрока, мс */
  graceMs: 30_000,
  /** Хост пропал посреди боя: через столько хостом станет следующий на связи, мс */
  hostGraceMs: 5_000,
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
  | { t: 'chat'; text: string }
  /** Бой: гость шлёт хосту (to не задан), хост — всем гостям или одному месту `to` */
  | { t: 'relay'; to?: number; d: unknown }
  /** Итог боя — только хост */
  | { t: 'battle.end'; result: 'won' | 'lost'; wave: number; rewards: Reward[] }
  /** Своя награда за бой — каждый игрок сам, один раз: собранная и не потраченная малина и опыт */
  | { t: 'battle.loot'; matchId: string; berries: number; xp: number };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; name: string }
  | { t: 'pong' }
  | { t: 'error'; code: ErrorCode; text: string }
  /** Комната изменилась; you — твоё место */
  | { t: 'room.state'; room: RoomInfo; seats: SeatInfo[]; you: number }
  | { t: 'room.left'; reason: 'leave' | 'kick' | 'closed' }
  | { t: 'battle.start'; matchId: string; map: string; players: number; seed: number; hostSeat: number; seats: SeatInfo[] }
  | { t: 'battle.over'; matchId: string; result: MatchResult; wave: number }
  /** Хост ушёл посреди боя — хост теперь на этом месте (он и считает бой дальше, src/net/coop.ts) */
  | { t: 'battle.host'; matchId: string; hostSeat: number }
  | { t: 'chat'; seat: number; name: string; text: string }
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
  /** Держит ПКМ — стреляет из лука */
  bow: boolean;
  /** Пинг гостя до сервера, мс (список игроков в бою) */
  ping: number;
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

/**
 * Герой: место, x, y, z, взгляд, здоровье, наибольшее, без сил (0/1), ввод — move x/z, aim x/z, удар (0/1), перекат был (0/1), лук (0/1),
 * последний учтённый ввод гостя (`GuestInput.seq`, сверка своего героя у гостя), пинг игрока, мс
 */
export type HeroSnap = [seat: number, x: number, y: number, z: number, yaw: number, hp: number, maxHp: number, down: number, mx: number, mz: number, ax: number, az: number, attack: number, roll: number, bow: number, ack: number, ping: number];
/**
 * Враг: сетевой id, вид, x, y (полёт), z, взгляд, здоровье, наибольшее, флаги (MOB_FLAG), атака (имя или ''),
 * её номер (растёт с каждой новой), куда целится x/z, дорога и шаг марша (новый хост продолжит марш)
 */
export type MobSnap = [id: number, kind: string, x: number, y: number, z: number, yaw: number, hp: number, maxHp: number, flags: number, attack: string, seq: number, ax: number, az: number, lane: string, marchI: number];
/** Флаги врага в снимке: призван (без малины), оглушён, замедлен холодом, воодушевлён знаменем, заметил героя */
export const MOB_FLAG = { summoned: 1, daze: 2, chill: 4, rally: 8, alerted: 16 } as const;
/** Башня на площадке: вид, уровень, прочность, заморожена ещё (с); 0 — площадка пуста */
export type TowerSnap = [kind: string, level: number, hp: number, frozen: number] | 0;
/** Группа волны, которая ещё выходит: вид, дорога, сколько осталось, до следующего (с), раз в (с) — новый хост продолжит волну */
export type QueueSnap = [kind: string, lane: string, left: number, t: number, every: number];

export interface TdSnap {
  state: 'play' | 'lost' | 'won';
  wave: number;
  next: number;
  /** Идёт волна (группы выходят или враги живы) */
  running: boolean;
  bush: number;
  /** Прочность стен по порядку `meta.td.walls` */
  walls: number[];
  /** Башни по номеру площадки */
  towers: TowerSnap[];
  queue: QueueSnap[];
  /** Число игроков, под которое выходят волны */
  players: number;
}

/** Кучка малины на земле или в полёте: номер, x, y, z — малина общая, подбирает кто первый (у хоста) */
export type PileSnap = [id: number, x: number, y: number, z: number];

export interface BattleSnap { t: 'snap'; tick: number; heroes: HeroSnap[]; mobs: MobSnap[]; td: TdSnap | null; piles: PileSnap[] }

/**
 * Действие героя (src/gear.ts, `Gear.onAction`): артефакт гнезда i в точку at с зарядом c, зелье, вспышка ауры, спец-удар.
 * Гость шлёт хосту, хост повторяет его снаряжением героя гостя (урон) и пересылает остальным с местом seat (вид)
 */
export type GearAction =
  | { k: 'art'; i: number; at: [number, number]; c: number }
  /** Заряд заклинания начался (видно, как набирает) и сброшен без каста */
  | { k: 'charge'; i: number; at: [number, number] }
  | { k: 'cancel' }
  | { k: 'potion' }
  | { k: 'aura' }
  | { k: 'special'; at: [number, number] };
export type ActMsg = { t: 'act'; seat?: number } & GearAction;

/** Снаряжение героя для его снаряжения у других игроков: предметы и надетое (`ProfileData.items`, `equip`) */
export interface KitMsg { t: 'kit'; seat?: number; items: unknown[]; equip: unknown }

/** Команда обороны от гостя: действие меню площадки (build:вид, upgrade, sell, repair), починка стены, волна сейчас; малина — его (`paid`) */
export interface TdCommand { t: 'td'; a: string; pad?: number; wall?: string; /** Сколько гость уже заплатил из своей малины */ paid?: number }

/** Хост → гость: удар моба отбросил его героя — скорость отброса (у хоста герой гостя уже летит) */
export interface KnockMsg { t: 'knock'; vx: number; vz: number }

/** Хост → гость: малина в кошелёк — награда за волну, подобрал кучку, возврат и выручка по его команде */
export interface GainMsg { t: 'gain'; n: number; why: 'wave' | 'pick' | 'back' }
