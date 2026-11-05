/**
 * All tunable numbers of the hero and melee weapons.
 * Read by the game and the playground panel (F1). The objects are mutable: the panel edits them on the fly.
 * Units: metres, seconds, degrees (where "°" is written).
 */

export const HERO = {
  hp: 100,
  /** Body radius for collisions, m */
  radius: 0.34,

  // ---------- Movement, m/s ----------
  walk: 5,
  /** Speed during a strike, fraction of walking */
  attackMove: 0.3,
  /** Acceleration and braking, m/s² */
  accel: 40,
  decel: 46,
  /** Turn rate towards the target, 1/s */
  turnRate: 16,

  // ---------- Falling off a cliff ----------
  gravity: 30,
  /** Air control, fraction of ground control */
  airControl: 0.8,
  /** A click closer than this to the hero counts as arrived, m */
  arrive: 0.15,

  // ---------- Dodge roll ----------
  rollDist: 4.2,
  rollTime: 0.38,
  /** Invulnerability from the start of the roll, s */
  rollIframes: 0.25,
  rollCd: 0.9,

  // ---------- Animation ----------
  /** Stride length, m */
  step: 1.1,
};

/** Combo hit: damage, duration, reach, arc width, lunge */
export interface SwingTuning {
  dmg: number;
  /** Strike duration, s (wind-up + strike + return) */
  time: number;
  /** Fraction of time for the wind-up; the strike runs from windup to windup + strike */
  windup: number;
  strike: number;
  /** Reach from the hero's centre, m */
  range: number;
  /** Arc width, ° (full) */
  arc: number;
  /** Lunge forward, m */
  lunge: number;
  /** Target knockback */
  knock: number;
}

/** Standard sword: a three-hit combo */
export const SWORD = {
  /** A press still continues the combo this long after the strike ends, s */
  comboWindow: 0.35,
  /** From which fraction of the strike the next one can start */
  chainFrom: 0.62,
  /** Pause after the finisher, s */
  finisherCd: 0.22,
  /** Hit-stop on contact, s */
  hitStop: 0.055,
  /** Finisher: shockwave radius, m */
  shockR: 2.4,
  swings: [
    { dmg: 10, time: 0.36, windup: 0.22, strike: 0.3, range: 2.1, arc: 160, lunge: 0.35, knock: 0.6 },
    { dmg: 12, time: 0.36, windup: 0.2, strike: 0.3, range: 2.1, arc: 160, lunge: 0.35, knock: 0.6 },
    { dmg: 24, time: 0.56, windup: 0.36, strike: 0.2, range: 2.5, arc: 90, lunge: 0.7, knock: 1.6 },
  ] as SwingTuning[],
};

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

let DEFAULTS: { HERO: typeof HERO; SWORD: typeof SWORD } | null = null;
/** Remember the starting values (called at startup) */
export function snapshotTuning(): void {
  DEFAULTS ??= { HERO: clone(HERO), SWORD: clone(SWORD) };
}

export function resetTuning(): void {
  if (!DEFAULTS) return;
  Object.assign(HERO, clone(DEFAULTS.HERO));
  const { swings, ...rest } = clone(DEFAULTS.SWORD);
  Object.assign(SWORD, rest);
  swings.forEach((s, i) => Object.assign(SWORD.swings[i], s));
}

export function tuningJSON(): string {
  return JSON.stringify({ HERO, SWORD }, null, 2);
}
