import type { TdWave, TdWaveGroup } from './types.ts';

/**
 * Endless waves of the Misty Clearing (wiki/design-tower-defence.md, section 18): the fifth map has no wave list —
 * wave `n` is built from its number alone (a pure function: the server, the host and the guests get the same wave).
 * Mostly weak mobs in a random mix, out of the mist from two to four sides at once; heavier kinds join later;
 * every fifth wave a chief comes with its own cloud; every wave may carry a modifier (section 18.3).
 */

/** Cheap: the bulk of every wave */
const WEAK = ['berryling', 'runner', 'gardener', 'squire', 'hopper', 'moth'];
/** From the fourth wave */
const MID = ['wolf', 'sporeling', 'slime', 'shellback', 'frostling', 'hedgehog'];
/** From the eighth wave, a few at a time */
const HEAVY = ['ram', 'gnawer', 'vine'];
const CHIEFS = ['chief_brute', 'chief_slime', 'chief_frost'];

/** Wave modifiers (section 18.3): what the mist does this wave */
export type FogMod = 'thick' | 'moon' | 'quiet' | 'swarm' | 'fireflies';
export const FOG_MODS: readonly FogMod[] = ['thick', 'moon', 'quiet', 'swarm', 'fireflies'];
export const FOG_MOD_TITLE: Record<FogMod, string> = {
  thick: 'Thick mist', moon: 'Moonlight', quiet: 'Quiet steps', swarm: 'The swarm', fireflies: 'Fireflies',
};

/** Deterministic 0..1 from the wave number and a salt */
const rnd = (n: number, s: number): number => {
  let h = (n * 374761393 + s * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const pick = <T>(a: readonly T[], v: number): T => a[Math.floor(v * a.length) % a.length];

/** Modifier of wave n: none on the first three, then one wave in two */
export function fogMod(n: number): FogMod | undefined {
  if (n < 4 || rnd(n, 1) < 0.5) return undefined;
  return pick(FOG_MODS, rnd(n, 2));
}

/** Wave n (from 1) of the endless mode; lanes — the ids of the map's directions out of the mist */
export function fogWave(n: number, lanes: readonly string[]): TdWave {
  const mod = fogMod(n);
  // sides: two on the first waves, up to four later; neighbours are allowed — sometimes the Order presses from one quarter
  const sides = Math.min(4, 2 + Math.floor(n / 6) + (rnd(n, 3) < 0.3 ? 1 : 0));
  const start = Math.floor(rnd(n, 4) * lanes.length);
  const spread = rnd(n, 5) < 0.35 ? 1 : Math.max(1, Math.floor(lanes.length / sides));
  const from = Array.from({ length: sides }, (_, i) => lanes[(start + i * spread + Math.floor(rnd(n, 6 + i) * 2)) % lanes.length]);
  // budget in "weak heads": grows by ~3 a wave; the swarm — more but cheaper and quicker
  const budget = Math.round((10 + n * 3) * (mod === 'swarm' ? 1.4 : 1));
  const groups: TdWaveGroup[] = [];
  let left = budget, salt = 20;
  for (let i = 0; left > 0 && i < 8; i++) {
    const lane = from[i % from.length];
    const r = rnd(n, salt++);
    const pool = mod === 'swarm' ? WEAK : n >= 8 && r < 0.12 ? HEAVY : n >= 4 && r < 0.4 ? MID : WEAK;
    const cost = pool === HEAVY ? 4 : pool === MID ? 2 : 1;
    const kind = mod === 'swarm' ? pick(['runner', 'hopper', 'moth', 'berryling'], rnd(n, salt++)) : pick(pool, rnd(n, salt++));
    const count = Math.max(1, Math.min(Math.ceil(left / cost), Math.round((pool === HEAVY ? 2 : 4) + rnd(n, salt++) * (pool === HEAVY ? 2 : 8))));
    left -= count * cost;
    groups.push({ kind, count, every: +(pool === HEAVY ? 2.2 : mod === 'swarm' ? 0.35 : 0.6 + rnd(n, salt++) * 0.5).toFixed(2), lane, delay: Math.round(i * 2.5 + rnd(n, salt++) * 3) });
  }
  // a chief every fifth wave, from the tenth — two
  if (n % 5 === 0) {
    const chiefs = n >= 10 ? 2 : 1;
    for (let i = 0; i < chiefs; i++) groups.push({ kind: pick(CHIEFS, rnd(n, 40 + i)), count: 1, every: 1, lane: from[i % from.length], delay: 10 + i * 6 });
  }
  const title = n % 5 === 0 ? 'A chief in the mist' : 'Out of the mist';
  return { title, groups, bounty: 30 + n * 8, ...(mod ? { mod } : {}) };
}
