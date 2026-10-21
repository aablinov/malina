export const CFG = {
  FIELD: 14.3,          // половина размера поля, по которому ходит игрок
  PLANT_COST: 5,        // сколько ягод стоит посадить куст
  GROW_TIME: 20,        // секунды от ростка до взрослого куста
  HARVEST_TIME: 60,     // раз в минуту куст даёт урожай
  HARVEST_YIELD: 10,    // сколько ягод даёт урожай
  BUSH_HP: 24,
  /** Больше ягод в корзину не влезет */
  BERRY_MAX: 2000,
  /** Для тестов — 1000; для обычной игры верни 30 */
  START_BERRIES: 1000,

  PLAYER_SPEED: 5.4,
  PLAYER_HP: 100,
  RESPAWN_TIME: 5,
  /** Сколько здоровья в секунду восстанавливается днём */
  DAY_REGEN: 2.5,
  /** Укус ближнего жука по герою: множитель к его урону по кусту */
  BITE_TO_PLAYER: 3.5,
  /** Пули сами копятся до этого числа, по столько в секунду */
  BULLET_REGEN_CAP: 60,
  BULLET_REGEN: 2,
  /** Доля пуль и дробин, которые отскакивают от стен и препятствий */
  RICOCHET_CHANCE: 0.5,

  // День и ночь, секунды
  FIRST_DAY: 45,
  DAY_LENGTH: 75,
  NIGHT_LENGTH: 55,
  /** Сколько длится закат или рассвет */
  TWILIGHT: 5,

  INTERACT_DIST: 1.9,
  SHOP_DIST: 2.4,
} as const;

/** Лавка торговца: где стоит прилавок и где встать покупателю */
export const SHOP = { x: 11, z: -11.6, standX: 11, standZ: -9.6 } as const;
/** Где очнуться после обморока — у двери домика */
export const RESPAWN = { x: -11, z: -7.6 } as const;

export interface Plot { x: number; z: number }
export type Vec2 = readonly [number, number];
export type EntranceName = 'север' | 'запад' | 'юг' | 'восток';
export interface Entrance { name: EntranceName; spawn: Vec2; gate: Vec2 }
export interface Collider { x: number; z: number; r: number }

// Грядки: 3 ряда по 4 места
export const PLOTS: Plot[] = [];
for (const z of [-4, 0, 4]) for (const x of [-6, -2, 2, 6]) PLOTS.push({ x, z });

// Входы, откуда ползут жуки: точка появления и точка входа на поле
export const ENTRANCES: readonly Entrance[] = [
  { name: 'север', spawn: [0, -23], gate: [0, -13] },
  { name: 'запад', spawn: [-23, 0], gate: [-13, 0] },
  { name: 'юг', spawn: [0, 23], gate: [0, 13] },
  { name: 'восток', spawn: [23, 0], gate: [13, 0] },
];
