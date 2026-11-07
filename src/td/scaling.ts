import { MAX_PLAYERS } from '../bosses/scaling.ts';

/**
 * Bush Defence wave scaling (wiki/design-tower-defence.md, section 5). Enemies get tougher with waves and with the player count:
 *
 *   pack level   = base + 3·(wave − 1)                     — base 1 (`meta.td.level`), health and damage like the wardens' (src/bosses/scaling.ts): wave 10 — lvl 28; on Crystal Glade the base is 7
 *   enemies      = ⌈base · (1 + 0.5·(players − 1))⌉        — twice as many for three, 2.5 times for four
 *   health       = also × (1 + 0.5·(players − 1))          — via `pack.setScale`
 *   bounty       = ⌈base · (1 + 0.5·(players − 1))⌉        — the treasury is shared, more towers are needed
 */
const pl = (players: number): number => Math.max(1, Math.min(MAX_PLAYERS, Math.round(players))) - 1;

/**
 * Match loot (wiki/design-tower-defence.md, section 13): a fallen enemy — its own loot (1–5, chief 25), a beaten wave —
 * a quarter of its bounty, victory — +50 % of everything collected. Only paid out on victory
 */
export const LOOT_WAVE = 0.25;
export const LOOT_WIN = 0.5;

/** Pack level on a wave: base — the level of the map's first wave (`meta.td.level`, 1 by default) */
export const waveLevel = (wave: number, base = 1): number => base + 3 * Math.max(0, wave - 1);
/** Multiplier of enemy count and bounty by player count */
export const crowdMult = (players: number): number => 1 + 0.5 * pl(players);
export const scaledCount = (count: number, players: number): number => Math.ceil(count * crowdMult(players));
export const scaledBounty = (bounty: number, players: number): number => Math.ceil(bounty * crowdMult(players));
