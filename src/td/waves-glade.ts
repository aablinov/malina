import type { TdWave } from './types.ts';

/**
 * Crystal Glade waves (wiki/design-tower-defence.md, section 8): the second map, a level stronger — twelve waves,
 * the pack starts at level 7 (`meta.td.level`), and the shellback, sporeling and hopper join the lava map's enemies.
 * Numbers are for one player (src/td/scaling.ts).
 */
const g = (kind: string, count: number, every: number, lane: string, delay = 0) => ({ kind, count, every, lane, delay });

export const TD_GLADE_WAVES: TdWave[] = [
  { title: 'Scouting the glade', groups: [g('runner', 13, 0.8, 'west'), g('hopper', 6, 1.5, 'north', 6)], bounty: 60 },
  { title: 'Sporelings', groups: [g('sporeling', 7, 1.6, 'east'), g('berryling', 13, 0.9, 'east', 2), g('hopper', 8, 1.2, 'west', 8)], bounty: 70 },
  { title: 'Shellbacks', groups: [g('shellback', 4, 3, 'north'), g('runner', 13, 0.6, 'west', 4), g('moth', 8, 1, 'east', 8), g('gnawer', 2, 1.5, 'east', 10), g('chief_slime', 1, 1, 'west', 12)], bounty: 85 },
  { title: 'Couriers and hoppers', groups: [g('hopper', 13, 0.9, 'west'), g('runner', 16, 0.6, 'east', 3), g('sporeling', 6, 1.6, 'north', 6), g('frostling', 2, 2, 'north', 8)], bounty: 100 },
  { title: 'Wolves under spores', groups: [g('wolf', 8, 1, 'north'), g('sporeling', 6, 2, 'north', 1), g('shellback', 2, 3, 'east', 6), g('moth', 11, 0.9, 'west', 10), g('gnawer', 3, 1.4, 'east', 6)], bounty: 115 },
  { title: 'Ram and shell', groups: [g('ram', 2, 4, 'west'), g('shellback', 6, 2.5, 'west', 2), g('hopper', 11, 0.9, 'east', 6), g('gardener', 8, 1.3, 'north', 10), g('frostling', 3, 1.8, 'north', 4), g('chief_frost', 1, 1, 'east', 12)], bounty: 135 },
  { title: 'Moths and spores', groups: [g('moth', 16, 0.8, 'north'), g('sporeling', 8, 1.5, 'east', 4), g('runner', 19, 0.5, 'west', 8), g('shellback', 2, 3, 'north', 14), g('gnawer', 3, 1.4, 'west', 6), g('frostling', 2, 2, 'east', 10)], bounty: 155 },
  { title: 'Guard of the glade', groups: [g('shield', 6, 2, 'east'), g('spear', 8, 1.2, 'east', 1), g('crossbow', 6, 2, 'east', 4), g('sporeling', 6, 2, 'east', 6), g('hopper', 13, 0.8, 'north', 8), g('ram', 2, 3, 'west', 12), g('gnawer', 4, 1.3, 'north', 3)], bounty: 185 },
  { title: 'Shellback march', groups: [g('shellback', 8, 2, 'west'), g('shellback', 6, 2, 'north', 4), g('sporeling', 8, 1.4, 'east', 6), g('runner', 21, 0.5, 'east', 10), g('moth', 11, 0.9, 'west', 14), g('frostling', 4, 1.6, 'north', 6), g('gnawer', 3, 1.4, 'east', 12), g('chief_brute', 1, 1, 'west', 14)], bounty: 210 },
  { title: 'Hoppers', groups: [g('hopper', 24, 0.6, 'north'), g('hopper', 13, 0.7, 'west', 6), g('wolf', 8, 1, 'east', 8), g('sporeling', 7, 1.5, 'west', 12), g('ram', 4, 3, 'east', 16), g('gnawer', 4, 1.2, 'west', 4), g('frostling', 3, 1.6, 'east', 10)], bounty: 240 },
  { title: 'Brambles and spores', groups: [g('hedgehog', 8, 1.2, 'west'), g('vine', 7, 1.8, 'east', 3), g('horror', 1, 1, 'north', 6), g('sporeling', 11, 1.2, 'north', 8), g('shellback', 7, 2, 'east', 12), g('runner', 26, 0.4, 'west', 16), g('gnawer', 5, 1.2, 'north', 4), g('frostling', 4, 1.5, 'west', 10)], bounty: 280 },
  { title: 'Masters of the glade', groups: [g('ram', 6, 2.5, 'west'), g('ram', 6, 2.5, 'east', 2), g('shellback', 11, 1.5, 'north', 4), g('sporeling', 13, 1, 'north', 6), g('hopper', 21, 0.6, 'west', 12), g('moth', 19, 0.7, 'east', 14), g('horror', 2, 4, 'north', 24), g('runner', 32, 0.35, 'east', 28), g('gnawer', 6, 1.0, 'west', 6), g('frostling', 5, 1.4, 'east', 8), g('chief_frost', 1, 1, 'north', 20)], bounty: 400 },
];
