import { rng } from '../rng.ts';
import { OBJECTIVES, type ExpeditionParams, type ObjectiveKind } from './types.ts';

/**
 * A mission as a map name (wiki/design-expeditions.md, section 2): `exp:<seed>:<difficulty>:<objective>:<landing>`. A room, a
 * match record and the battle page address carry it where a Bush Defence map carries its file name — nothing else in the lobby
 * protocol has to know about missions. The board offers three missions a day per difficulty, the same for everyone
 */

export const MISSION_PREFIX = 'exp:';
export const MAX_DIFFICULTY = 8;
export const LANDINGS = 3;

export const isMission = (map: string): boolean => map.startsWith(MISSION_PREFIX);

/** A mission with everything spelled out: the landing, and its place in an operation if it has one */
export type Mission = Required<Omit<ExpeditionParams, 'op'>> & { op?: { seed: number; index: number } };

export function missionId(p: ExpeditionParams): string {
  return `${MISSION_PREFIX}${p.seed}:${p.difficulty}:${p.objective}:${p.landing ?? 0}${p.op ? `:${p.op.seed}.${p.op.index}` : ''}`;
}

const seedOk = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 2 ** 31 - 1;

/** The mission of a map name; null — not a mission, a malformed one, or one that claims a place in an operation it does not have */
export function parseMission(map: string): Mission | null {
  if (!isMission(map)) return null;
  const [s, d, o, l, op, ...rest] = map.slice(MISSION_PREFIX.length).split(':');
  const seed = Number(s), difficulty = Number(d), landing = Number(l ?? 0);
  if (rest.length || !seedOk(seed)) return null;
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > MAX_DIFFICULTY) return null;
  if (!Number.isInteger(landing) || landing < 0 || landing >= LANDINGS) return null;
  if (!OBJECTIVES.includes(o as ObjectiveKind)) return null;
  const m: Mission = { seed, difficulty, objective: o as ObjectiveKind, landing };
  if (op === undefined) return m;
  const [os, oi] = op.split('.').map(Number);
  if (!seedOk(os) || !Number.isInteger(oi)) return null;
  // the place in an operation is not taken on trust: the operation of that seed must really have this mission there
  const real = operation(os, difficulty).missions[oi];
  if (!real || real.seed !== seed || real.objective !== o) return null;
  return { ...m, op: { seed: os, index: oi } };
}

/** The same mission with another landing point */
export const withLanding = (map: string, landing: number): string => { const p = parseMission(map); return p ? missionId({ ...p, landing }) : map; };

/** Day number in UTC — the board changes at midnight */
export const boardDay = (now = Date.now()): number => Math.floor(now / 86_400_000);

// ---------- operations (section 2) ----------
/** What changes a whole operation (section 9) */
export type Modifier = 'mist' | 'downpour' | 'fullmoon' | 'fury' | 'quiet';
export const MODIFIERS: readonly Modifier[] = ['mist', 'downpour', 'fullmoon', 'fury', 'quiet'];
/** Each next mission of an operation pays this much more; the last one — the bonus on top */
export const OP_STEP = 0.25;
export const OP_BONUS = 0.5;

export interface Operation { seed: number; difficulty: number; mods: Modifier[]; missions: Mission[] }

/** The operation of a seed: two or three missions with different objectives and one or two shared modifiers — the same everywhere */
export function operation(seed: number, difficulty: number): Operation {
  const r = rng(((seed * 2246822519) ^ (difficulty * 3266489917)) >>> 0 || 1);
  const kinds = OBJECTIVES.slice();
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  const length = r() < 0.5 ? 2 : 3;
  const pool = MODIFIERS.slice(), mods: Modifier[] = [];
  for (let i = 0, n = difficulty >= 4 && r() < 0.5 ? 2 : 1; i < n; i++) mods.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  const missions = kinds.slice(0, length).map((objective, index): Mission => ({ seed: 1 + Math.floor(r() * (2 ** 31 - 2)), difficulty, objective, landing: 0, op: { seed, index } }));
  return { seed, difficulty, mods, missions };
}

/** The modifiers of a mission: its operation's; a lone mission has none */
export const missionMods = (m: ExpeditionParams): Modifier[] => (m.op ? operation(m.op.seed, m.difficulty).mods : []);

/** How much more a mission pays for its place in an operation the squad is carrying through (index — missions already won in a row) */
export function operationMult(m: Mission, streak: { seed: number; difficulty: number; next: number } | null): number {
  if (!m.op || !streak || streak.seed !== m.op.seed || streak.difficulty !== m.difficulty || streak.next !== m.op.index) return 1;
  const last = m.op.index === operation(m.op.seed, m.difficulty).missions.length - 1;
  return 1 + OP_STEP * m.op.index + (last && m.op.index > 0 ? OP_BONUS : 0);
}

/** The board of a day: three operations of a difficulty, the same for every player */
export function dailyBoard(day: number, difficulty: number): Operation[] {
  const r = rng(((day * 2654435761) ^ (difficulty * 40503)) >>> 0 || 1);
  return [0, 1, 2].map(() => operation(1 + Math.floor(r() * (2 ** 31 - 2)), difficulty));
}

// ---------- the order of the day (section 10) ----------
export type OrderKind = 'lairs' | 'beacons' | 'seeds' | 'missions';
export interface Order { day: number; kind: OrderKind; need: number; berries: number; rare: number }
const ORDERS: readonly Omit<Order, 'day'>[] = [
  { kind: 'lairs', need: 5, berries: 150, rare: 1 }, { kind: 'beacons', need: 4, berries: 150, rare: 1 },
  { kind: 'seeds', need: 6, berries: 120, rare: 2 }, { kind: 'missions', need: 2, berries: 180, rare: 1 },
];
/** The order of a day — one for everyone */
export const dailyOrder = (day: number): Order => ({ day, ...ORDERS[((day % ORDERS.length) + ORDERS.length) % ORDERS.length] });

/** Two map names are one mission — the landing aside */
export const sameMission = (a: string, b: string): boolean => { const x = parseMission(a), y = parseMission(b); return !!x && !!y && x.seed === y.seed && x.difficulty === y.difficulty && x.objective === y.objective; };

/** Two map names are missions of one operation */
export const sameOperation = (a: string, b: string): boolean => { const x = parseMission(a), y = parseMission(b); return !!x?.op && !!y?.op && x.op.seed === y.op.seed && x.difficulty === y.difficulty; };
