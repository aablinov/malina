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

export function missionId(p: ExpeditionParams): string {
  return `${MISSION_PREFIX}${p.seed}:${p.difficulty}:${p.objective}:${p.landing ?? 0}`;
}

/** The mission of a map name; null — not a mission or a malformed one */
export function parseMission(map: string): Required<ExpeditionParams> | null {
  if (!isMission(map)) return null;
  const [s, d, o, l, ...rest] = map.slice(MISSION_PREFIX.length).split(':');
  const seed = Number(s), difficulty = Number(d), landing = Number(l ?? 0);
  if (rest.length || !Number.isInteger(seed) || seed < 1 || seed > 2 ** 31 - 1) return null;
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > MAX_DIFFICULTY) return null;
  if (!Number.isInteger(landing) || landing < 0 || landing >= LANDINGS) return null;
  if (!OBJECTIVES.includes(o as ObjectiveKind)) return null;
  return { seed, difficulty, objective: o as ObjectiveKind, landing };
}

/** The same mission with another landing point */
export const withLanding = (map: string, landing: number): string => { const p = parseMission(map); return p ? missionId({ ...p, landing }) : map; };

/** Day number in UTC — the board changes at midnight */
export const boardDay = (now = Date.now()): number => Math.floor(now / 86_400_000);

/** The board of a day: three missions of a difficulty, one of each objective, the same for every player */
export function dailyBoard(day: number, difficulty: number): Required<ExpeditionParams>[] {
  const r = rng(((day * 2654435761) ^ (difficulty * 40503)) >>> 0 || 1);
  // shuffle the objectives so the first card is not always the same kind
  const kinds = OBJECTIVES.slice();
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  return kinds.map((objective) => ({ seed: 1 + Math.floor(r() * (2 ** 31 - 2)), difficulty, objective, landing: 0 }));
}

/** Two map names are one mission — the landing aside */
export const sameMission = (a: string, b: string): boolean => { const x = parseMission(a), y = parseMission(b); return !!x && !!y && x.seed === y.seed && x.difficulty === y.difficulty && x.objective === y.objective; };
