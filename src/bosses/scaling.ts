/**
 * Масштаб стражей (wiki/design-bosses.md, раздел 7): здоровье, урон и малина растут с уровнем стража и числом игроков —
 * мягко: это доброе приключение, а не Dark Souls. Уровень на плейграунде — уровень героя (или из панели F1), в подземелье —
 * по этажу. Числа — стартовые, подбираются игрой.
 *
 *   здоровье = база · (1 + 0,06·(ур − 1)) · (1 + 0,5·(игроков − 1))
 *   урон     = база · (1 + 0,03·(ур − 1))                  — от числа игроков не растёт
 *   малина   = база · (1 + 0,05·(ур − 1)) · игроков        — малину делят, поэтому на каждого столько же
 */

export const MAX_LEVEL = 30;
export const MAX_PLAYERS = 4;

export interface BossScale { level: number; players: number }

const lv = (s: BossScale): number => Math.max(1, Math.min(MAX_LEVEL, Math.round(s.level))) - 1;
const pl = (s: BossScale): number => Math.max(1, Math.min(MAX_PLAYERS, Math.round(s.players))) - 1;

/** Множитель здоровья */
export const hpMult = (s: BossScale): number => (1 + 0.06 * lv(s)) * (1 + 0.5 * pl(s));
/** Множитель урона по героям */
export const dmgMult = (s: BossScale): number => 1 + 0.03 * lv(s);
/** Множитель малины из сердца */
export const lootMult = (s: BossScale): number => (1 + 0.05 * lv(s)) * (1 + pl(s));
