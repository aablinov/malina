/** Детерминированный генератор xorshift32 — без DOM и three, его импортирует и сервер (server/) */
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
