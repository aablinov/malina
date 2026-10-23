/**
 * Все настраиваемые числа героя и оружия ближнего боя.
 * Их читают игра и панель плейграунда (F1). Объекты изменяемые: панель правит их на лету.
 * Единицы: метры, секунды, градусы (где написано «°»).
 */

export const HERO = {
  hp: 100,
  /** Радиус тела для коллизий, м */
  radius: 0.34,

  // ---------- Движение, м/с ----------
  walk: 5,
  /** Скорость во время удара, доля от ходьбы */
  attackMove: 0.3,
  /** Разгон и торможение, м/с² */
  accel: 40,
  decel: 46,
  /** Скорость поворота к цели, 1/с */
  turnRate: 16,

  // ---------- Падение с обрыва ----------
  gravity: 30,
  /** Управление в воздухе, доля от земли */
  airControl: 0.8,
  /** Клик ближе этого к герою — уже пришёл, м */
  arrive: 0.15,

  // ---------- Перекат-уклонение ----------
  rollDist: 4.2,
  rollTime: 0.38,
  /** Неуязвимость с начала переката, с */
  rollIframes: 0.25,
  rollCd: 0.9,

  // ---------- Анимация ----------
  /** Длина шага, м */
  step: 1.1,
};

/** Удар комбо: урон, длительность, дальность, ширина дуги, выпад */
export interface SwingTuning {
  dmg: number;
  /** Длительность удара, с (замах + удар + возврат) */
  time: number;
  /** Доля времени на замах; удар проходит с windup до windup + strike */
  windup: number;
  strike: number;
  /** Дальность от центра героя, м */
  range: number;
  /** Ширина дуги, ° (полная) */
  arc: number;
  /** Выпад вперёд, м */
  lunge: number;
  /** Отбрасывание цели */
  knock: number;
}

/** Стандартный меч: комбо из трёх ударов */
export const SWORD = {
  /** Нажатие ещё успевает продолжить комбо после конца удара, с */
  comboWindow: 0.35,
  /** С какой доли удара можно начать следующий */
  chainFrom: 0.62,
  /** Пауза после добивающего, с */
  finisherCd: 0.22,
  /** Заминка при попадании (hit-stop), с */
  hitStop: 0.055,
  /** Добивающий: радиус ударной волны, м */
  shockR: 2.4,
  swings: [
    { dmg: 10, time: 0.36, windup: 0.22, strike: 0.3, range: 2.1, arc: 160, lunge: 0.35, knock: 0.6 },
    { dmg: 12, time: 0.36, windup: 0.2, strike: 0.3, range: 2.1, arc: 160, lunge: 0.35, knock: 0.6 },
    { dmg: 24, time: 0.56, windup: 0.36, strike: 0.2, range: 2.5, arc: 90, lunge: 0.7, knock: 1.6 },
  ] as SwingTuning[],
};

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

let DEFAULTS: { HERO: typeof HERO; SWORD: typeof SWORD } | null = null;
/** Запомнить стартовые значения (вызывается при запуске) */
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
