import type { ProfileData } from '../items.ts';
import { dailyOrder, MAX_DIFFICULTY, type OrderKind } from './mission.ts';
import { emptyBag, type SeedBag } from './types.ts';

/**
 * What expeditions leave in the hero's profile (wiki/design-expeditions.md, section 10): the difficulty ladder, the camp beds
 * planted with seeds, the order of the day. Pure functions over `ProfileData` — the server applies them when a match ends
 * (server/rooms.ts), the page — after a solo mission and when the player plants a bed in the camp
 */

export type BedKind = 'totem' | 'stash' | 'haste';
/** Camp beds: how many times each can be planted */
export const BEDS: Record<BedKind, { max: number }> = { totem: { max: 2 }, stash: { max: 3 }, haste: { max: 3 } };
export const BED_KINDS = Object.keys(BEDS) as BedKind[];
/** Raspberries a hero starts a mission with per stash level; parcel rest shortened per haste level */
export const STASH_BERRIES = 25;
export const HASTE_STEP = 0.1;

export type Beds = Record<BedKind, number>;
export const bedsOf = (d: ProfileData): Beds => {
  const b = (d.beds ?? {}) as Partial<Beds>, lv = (k: BedKind): number => Math.max(0, Math.min(BEDS[k].max, Math.round(Number(b[k]) || 0)));
  return { totem: lv('totem'), stash: lv('stash'), haste: lv('haste') };
};
export const seedsOf = (d: ProfileData): SeedBag => ({ ...emptyBag(), ...(d.seeds ?? {}) });

/** Seeds to plant a bed to level `level` (1, 2, 3): common ones always, rare from the second, a golden one for the third */
export const bedCost = (level: number): SeedBag => ({ common: 4 * level, rare: level >= 2 ? 2 * (level - 1) : 0, golden: level >= 3 ? 1 : 0 });

/** Plant a bed one level up if the seeds are there; false — at its limit or not enough seeds */
export function plantBed(d: ProfileData, bed: BedKind): boolean {
  const beds = bedsOf(d), next = beds[bed] + 1;
  if (!BEDS[bed] || next > BEDS[bed].max) return false;
  const cost = bedCost(next), have = seedsOf(d);
  if (have.common < cost.common || have.rare < cost.rare || have.golden < cost.golden) return false;
  d.seeds = { common: have.common - cost.common, rare: have.rare - cost.rare, golden: have.golden - cost.golden };
  d.beds = { ...beds, [bed]: next };
  return true;
}

/** The highest difficulty the hero may take: every won mission of the top one opens the next */
export const unlockedDifficulty = (d: ProfileData): number => Math.max(1, Math.min(MAX_DIFFICULTY, Math.round(d.expLevel ?? 1)));

/** What a mission added to the order of the day, by its kind */
export type MissionStats = Record<OrderKind, number>;

/** The hero's progress on the order of a day */
export function orderOf(d: ProfileData, day: number): { n: number; done: boolean } {
  return d.order && d.order.day === day ? { n: d.order.n, done: d.order.done } : { n: 0, done: false };
}

/**
 * A mission is over: a won one of the hero's top difficulty opens the next; its deeds count towards the order of the day, and a
 * fulfilled order pays once. Returns the order's reward if it was paid just now
 */
export function missionResult(d: ProfileData, r: { won: boolean; difficulty: number; stats: MissionStats; day: number }): { berries: number; rare: number } | null {
  if (r.won && r.difficulty >= unlockedDifficulty(d)) d.expLevel = Math.min(MAX_DIFFICULTY, r.difficulty + 1);
  const order = dailyOrder(r.day), was = orderOf(d, r.day);
  if (was.done) return null;
  const n = Math.min(order.need, was.n + Math.max(0, Math.round(r.stats[order.kind] ?? 0)));
  const done = n >= order.need;
  d.order = { day: r.day, n, done };
  if (!done) return null;
  d.berries += order.berries;
  const s = seedsOf(d);
  d.seeds = { ...s, rare: s.rare + order.rare };
  return { berries: order.berries, rare: order.rare };
}
