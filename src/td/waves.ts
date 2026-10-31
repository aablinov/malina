import type { TdWave } from './types';

/**
 * Волны обороны куста (wiki/design-tower-defence.md, раздел 5): десять волн по трём дорогам — west, north, east.
 * Каждая группа: kind × count с шагом every секунд, delay — через сколько от начала волны выходит. Награда — малина
 * сразу в казну, когда волна отбита. Лежат в карте (`meta.td.waves`), поэтому их можно править и в JSON.
 * Числа — для одного игрока; с игроками врагов и награды больше (src/td/scaling.ts).
 */
const g = (kind: string, count: number, every: number, lane: string, delay = 0) => ({ kind, count, every, lane, delay });

export const TD_WAVES: TdWave[] = [
  { title: 'Разведка', groups: [g('berryling', 10, 1.0, 'west')], bounty: 50 },
  { title: 'Гонцы', groups: [g('runner', 8, 0.7, 'north'), g('berryling', 8, 1.0, 'west', 4)], bounty: 60 },
  { title: 'Садовники', groups: [g('gardener', 7, 1.4, 'east'), g('runner', 7, 0.7, 'west', 5), g('berryling', 6, 1, 'north', 8)], bounty: 70 },
  { title: 'Волки и слизни', groups: [g('wolf', 5, 1.1, 'west'), g('slime', 5, 1.8, 'north', 3), g('berryling', 10, 0.8, 'east', 6)], bounty: 85 },
  { title: 'Мотыльки', groups: [g('moth', 10, 1.0, 'north'), g('gardener', 6, 1.4, 'west', 4), g('runner', 10, 0.6, 'east', 8)], bounty: 100 },
  { title: 'Таран', groups: [g('ram', 2, 4, 'east'), g('squire', 6, 1.2, 'east', 2), g('berryling', 12, 0.8, 'north', 5), g('runner', 6, 0.7, 'west', 10)], bounty: 120 },
  { title: 'Кабанчики и жуки', groups: [g('boarlet', 5, 1.3, 'west'), g('beetle', 6, 1.1, 'north', 3), g('moth', 8, 0.9, 'east', 6), g('runner', 10, 0.6, 'west', 12)], bounty: 140 },
  { title: 'Гвардия', groups: [g('shield', 3, 2, 'north'), g('spear', 5, 1.3, 'north', 1), g('crossbow', 3, 2, 'north', 4), g('ram', 2, 3, 'west', 6), g('moth', 10, 0.9, 'east', 8), g('gardener', 6, 1.2, 'east', 14)], bounty: 170 },
  { title: 'Терновник', groups: [g('hedgehog', 6, 1.2, 'east'), g('vine', 5, 1.8, 'west', 3), g('slime', 6, 1.6, 'north', 5), g('runner', 16, 0.5, 'east', 10), g('ram', 2, 3, 'north', 14), g('wolf', 5, 1, 'west', 18)], bounty: 200 },
  { title: 'Последний натиск', groups: [g('ram', 3, 2.5, 'west'), g('ram', 3, 2.5, 'east', 2), g('moth', 12, 0.8, 'north', 4), g('gardener', 10, 1.0, 'west', 10), g('wolf', 6, 1, 'east', 14), g('runner', 20, 0.4, 'north', 18), g('squire', 6, 1.2, 'west', 24), g('horror', 2, 4, 'north', 28)], bounty: 320 },
];
