import { MAX_PLAYERS } from '../bosses/scaling';

/**
 * Масштаб волн обороны куста (wiki/design-tower-defence.md, раздел 5). Враги крепчают с волнами и с числом игроков:
 *
 *   уровень стаи = 1 + 3·(волна − 1)                       — здоровье и урон как у стражей (src/bosses/scaling.ts): волна 10 — ур. 28
 *   врагов       = ⌈база · (1 + 0,5·(игроков − 1))⌉        — вдвое больше на троих, в 2,5 раза на четверых
 *   здоровье     = ещё × (1 + 0,5·(игроков − 1))            — через `pack.setScale`
 *   награда      = ⌈база · (1 + 0,5·(игроков − 1))⌉        — казна общая, башен нужно больше
 */
const pl = (players: number): number => Math.max(1, Math.min(MAX_PLAYERS, Math.round(players))) - 1;

/** Уровень стаи на волне (с 1) */
export const waveLevel = (wave: number): number => 1 + 3 * Math.max(0, wave - 1);
/** Множитель числа врагов и награды от числа игроков */
export const crowdMult = (players: number): number => 1 + 0.5 * pl(players);
export const scaledCount = (count: number, players: number): number => Math.ceil(count * crowdMult(players));
export const scaledBounty = (bounty: number, players: number): number => Math.ceil(bounty * crowdMult(players));
