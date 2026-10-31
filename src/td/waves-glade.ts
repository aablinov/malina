import type { TdWave } from './types';

/**
 * Волны кристальной поляны (wiki/design-tower-defence.md, раздел 8): вторая карта, на уровень сильнее — двенадцать волн,
 * стая стартует с уровня 7 (`meta.td.level`), и к врагам лавовой карты добавились панцирник, споровик и скакун.
 * Числа — для одного игрока (src/td/scaling.ts).
 */
const g = (kind: string, count: number, every: number, lane: string, delay = 0) => ({ kind, count, every, lane, delay });

export const TD_GLADE_WAVES: TdWave[] = [
  { title: 'Разведка поляны', groups: [g('runner', 10, 0.8, 'west'), g('hopper', 4, 1.5, 'north', 6)], bounty: 60 },
  { title: 'Споровики', groups: [g('sporeling', 5, 1.6, 'east'), g('berryling', 10, 0.9, 'east', 2), g('hopper', 6, 1.2, 'west', 8)], bounty: 70 },
  { title: 'Панцирники', groups: [g('shellback', 3, 3, 'north'), g('runner', 10, 0.6, 'west', 4), g('moth', 6, 1, 'east', 8)], bounty: 85 },
  { title: 'Гонцы и скакуны', groups: [g('hopper', 10, 0.9, 'west'), g('runner', 12, 0.6, 'east', 3), g('sporeling', 4, 1.6, 'north', 6)], bounty: 100 },
  { title: 'Волки под спорами', groups: [g('wolf', 6, 1, 'north'), g('sporeling', 4, 2, 'north', 1), g('shellback', 2, 3, 'east', 6), g('moth', 8, 0.9, 'west', 10)], bounty: 115 },
  { title: 'Таран и панцирь', groups: [g('ram', 2, 4, 'west'), g('shellback', 4, 2.5, 'west', 2), g('hopper', 8, 0.9, 'east', 6), g('gardener', 6, 1.3, 'north', 10)], bounty: 135 },
  { title: 'Мотыльки и споры', groups: [g('moth', 12, 0.8, 'north'), g('sporeling', 6, 1.5, 'east', 4), g('runner', 14, 0.5, 'west', 8), g('shellback', 2, 3, 'north', 14)], bounty: 155 },
  { title: 'Гвардия поляны', groups: [g('shield', 4, 2, 'east'), g('spear', 6, 1.2, 'east', 1), g('crossbow', 4, 2, 'east', 4), g('sporeling', 4, 2, 'east', 6), g('hopper', 10, 0.8, 'north', 8), g('ram', 2, 3, 'west', 12)], bounty: 185 },
  { title: 'Панцирный марш', groups: [g('shellback', 6, 2, 'west'), g('shellback', 4, 2, 'north', 4), g('sporeling', 6, 1.4, 'east', 6), g('runner', 16, 0.5, 'east', 10), g('moth', 8, 0.9, 'west', 14)], bounty: 210 },
  { title: 'Скакуны', groups: [g('hopper', 18, 0.6, 'north'), g('hopper', 10, 0.7, 'west', 6), g('wolf', 6, 1, 'east', 8), g('sporeling', 5, 1.5, 'west', 12), g('ram', 3, 3, 'east', 16)], bounty: 240 },
  { title: 'Терновник и споры', groups: [g('hedgehog', 6, 1.2, 'west'), g('vine', 5, 1.8, 'east', 3), g('horror', 1, 1, 'north', 6), g('sporeling', 8, 1.2, 'north', 8), g('shellback', 5, 2, 'east', 12), g('runner', 20, 0.4, 'west', 16)], bounty: 280 },
  { title: 'Хозяева поляны', groups: [g('ram', 4, 2.5, 'west'), g('ram', 4, 2.5, 'east', 2), g('shellback', 8, 1.5, 'north', 4), g('sporeling', 10, 1, 'north', 6), g('hopper', 16, 0.6, 'west', 12), g('moth', 14, 0.7, 'east', 14), g('horror', 2, 4, 'north', 24), g('runner', 24, 0.35, 'east', 28)], bounty: 400 },
];
