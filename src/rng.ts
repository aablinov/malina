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

/**
 * Игровая случайность (wiki/design-multiplayer.md): в бою все `Math.random` героя, снаряжения и мобов идут через `rnd()`,
 * а на время шага мира (`SimWorld.step`) он переключён на генератор мира с сидом — один сид и те же команды дают тот же бой
 * на сервере и в тестах. Вне шага (меню, вид) — обычная случайность
 */
let current: Rand = Math.random;
export const rnd: Rand = () => current();
/** Переключить игровую случайность на r; вернёт откат */
export function useRng(r: Rand): () => void {
  const prev = current;
  current = r;
  return () => { current = prev; };
}
