/** Deterministic xorshift32 generator — no DOM or three, the server (server/) imports it too */
export type Rand = () => number;

export function rng(seed = 1): Rand {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Game randomness (wiki/design-multiplayer.md): in battle every `Math.random` of the hero, gear and mobs goes through `rnd()`,
 * and for the duration of a world step (`SimWorld.step`) it is switched to the seeded world generator — one seed and the same commands give the same battle
 * on the server and in tests. Outside a step (menu, visuals) — ordinary randomness
 */
let current: Rand = Math.random;
export const rnd: Rand = () => current();
/** Switch game randomness to r; returns a revert function */
export function useRng(r: Rand): () => void {
  const prev = current;
  current = r;
  return () => { current = prev; };
}
