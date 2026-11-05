/**
 * Warden scaling (wiki/design-bosses.md, section 7): health, damage and raspberries grow with the warden's level and the number of players —
 * gently: this is a friendly adventure, not Dark Souls. On the playground the level is the hero's level (or from the F1 panel), in the dungeon —
 * by floor. The numbers are starting values, tuned by play.
 *
 *   health      = base · (1 + 0.06·(lv − 1)) · (1 + 0.5·(players − 1))
 *   damage      = base · (1 + 0.03·(lv − 1))                  — does not grow with the number of players
 *   raspberries = base · (1 + 0.05·(lv − 1)) · players        — raspberries are shared, so each gets the same
 */

export const MAX_LEVEL = 30;
export const MAX_PLAYERS = 4;

export interface BossScale { level: number; players: number }

const lv = (s: BossScale): number => Math.max(1, Math.min(MAX_LEVEL, Math.round(s.level))) - 1;
const pl = (s: BossScale): number => Math.max(1, Math.min(MAX_PLAYERS, Math.round(s.players))) - 1;

/** Health multiplier */
export const hpMult = (s: BossScale): number => (1 + 0.06 * lv(s)) * (1 + 0.5 * pl(s));
/** Multiplier of damage to heroes */
export const dmgMult = (s: BossScale): number => 1 + 0.03 * lv(s);
/** Multiplier of raspberries from the heart */
export const lootMult = (s: BossScale): number => (1 + 0.05 * lv(s)) * (1 + pl(s));
