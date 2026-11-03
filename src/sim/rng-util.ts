import type { Rand } from '../rng.ts';

/** Случайное в [a, b) от генератора мира — игровые решения только через него (детерминизм, wiki/design-multiplayer.md) */
export const randIn = (r: Rand, a: number, b: number): number => a + r() * (b - a);
/** Случайный элемент */
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))];
/** Истина с вероятностью p */
export const chance = (r: Rand, p: number): boolean => r() < p;
