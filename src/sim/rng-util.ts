import type { Rand } from '../rng.ts';

/** Random in [a, b) from the world generator — game decisions only through it (determinism, wiki/design-multiplayer.md) */
export const randIn = (r: Rand, a: number, b: number): number => a + r() * (b - a);
/** Random element */
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))];
/** True with probability p */
export const chance = (r: Rand, p: number): boolean => r() < p;
