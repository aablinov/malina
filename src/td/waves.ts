import type { TdWave } from './types';

/**
 * Волны обороны куста (wiki/design-tower-defence.md, раздел 5): десять волн по трём дорогам — west, north, east.
 * Каждая группа: kind × count с шагом every секунд, delay — через сколько от начала волны выходит. Награда — малина
 * сразу в казну, когда волна отбита. Лежат в карте (`meta.td.waves`), поэтому их можно править и в JSON.
 */
const g = (kind: string, count: number, every: number, lane: string, delay = 0) => ({ kind, count, every, lane, delay });

export const TD_WAVES: TdWave[] = [
  { title: 'Разведка', groups: [g('berryling', 6, 1.2, 'west')], bounty: 40 },
  { title: 'Гонцы', groups: [g('runner', 5, 0.8, 'north'), g('berryling', 4, 1.2, 'west', 4)], bounty: 50 },
  { title: 'Садовники', groups: [g('gardener', 5, 1.6, 'east'), g('runner', 4, 0.8, 'west', 6)], bounty: 60 },
  { title: 'Волки и слизни', groups: [g('wolf', 3, 1.2, 'west'), g('slime', 3, 2, 'north', 3), g('berryling', 6, 1, 'east', 8)], bounty: 70 },
  { title: 'Мотыльки', groups: [g('moth', 6, 1.1, 'north'), g('gardener', 4, 1.6, 'west', 5), g('runner', 6, 0.7, 'east', 10)], bounty: 80 },
  { title: 'Таран', groups: [g('ram', 1, 1, 'east'), g('squire', 4, 1.4, 'east', 2), g('berryling', 8, 0.9, 'north', 6)], bounty: 100 },
  { title: 'Кабанчики и жуки', groups: [g('boarlet', 3, 1.5, 'west'), g('beetle', 4, 1.2, 'north', 4), g('moth', 5, 1, 'east', 8), g('runner', 6, 0.7, 'west', 14)], bounty: 110 },
  { title: 'Гвардия', groups: [g('shield', 2, 2, 'north'), g('spear', 3, 1.5, 'north', 1), g('crossbow', 2, 2, 'north', 5), g('ram', 1, 1, 'west', 8), g('moth', 6, 1, 'east', 10)], bounty: 130 },
  { title: 'Терновник', groups: [g('hedgehog', 4, 1.4, 'east'), g('vine', 3, 2, 'west', 3), g('slime', 4, 1.8, 'north', 5), g('runner', 10, 0.6, 'east', 12), g('ram', 1, 1, 'north', 16)], bounty: 150 },
  { title: 'Последний натиск', groups: [g('ram', 2, 3, 'west'), g('ram', 2, 3, 'east', 2), g('moth', 8, 0.9, 'north', 4), g('gardener', 6, 1.2, 'west', 10), g('wolf', 4, 1, 'east', 14), g('runner', 12, 0.5, 'north', 18), g('horror', 1, 1, 'north', 26)], bounty: 250 },
];
