import type { TdWave } from './types.ts';

/**
 * Bush Defence waves (wiki/design-tower-defence.md, section 5): ten waves along three lanes — west, north, east.
 * Each group: kind × count every `every` seconds, delay — how long after the wave starts it comes out. The bounty is raspberries
 * straight into the treasury once the wave is beaten. They live in the map (`meta.td.waves`), so they can be edited in JSON too.
 * Numbers are for one player; with more players there are more enemies and bigger bounties (src/td/scaling.ts).
 */
const g = (kind: string, count: number, every: number, lane: string, delay = 0) => ({ kind, count, every, lane, delay });

export const TD_WAVES: TdWave[] = [
  { title: 'Scouts', groups: [g('berryling', 13, 1.0, 'west')], bounty: 50 },
  { title: 'Couriers', groups: [g('runner', 11, 0.7, 'north'), g('berryling', 11, 1.0, 'west', 4)], bounty: 60 },
  { title: 'Gardeners', groups: [g('gardener', 10, 1.4, 'east'), g('runner', 10, 0.7, 'west', 5), g('berryling', 8, 1, 'north', 8), g('gnawer', 2, 1.5, 'east', 10), g('chief_brute', 1, 1, 'west', 12)], bounty: 70 },
  { title: 'Wolves and slimes', groups: [g('wolf', 7, 1.1, 'west'), g('slime', 7, 1.8, 'north', 3), g('berryling', 13, 0.8, 'east', 6), g('frostling', 2, 2, 'west', 8)], bounty: 85 },
  { title: 'Moths', groups: [g('moth', 13, 1.0, 'north'), g('gardener', 8, 1.4, 'west', 4), g('runner', 13, 0.6, 'east', 8), g('gnawer', 3, 1.4, 'north', 6), g('frostling', 2, 2, 'east', 10)], bounty: 100 },
  { title: 'Battering ram', groups: [g('ram', 2, 4, 'east'), g('squire', 8, 1.2, 'east', 2), g('berryling', 16, 0.8, 'north', 5), g('runner', 8, 0.7, 'west', 10), g('gnawer', 3, 1.4, 'west', 8), g('chief_slime', 1, 1, 'north', 12)], bounty: 120 },
  { title: 'Boarlets and beetles', groups: [g('boarlet', 7, 1.3, 'west'), g('beetle', 8, 1.1, 'north', 3), g('moth', 11, 0.9, 'east', 6), g('runner', 13, 0.6, 'west', 12), g('frostling', 3, 1.8, 'north', 5), g('gnawer', 3, 1.4, 'east', 9)], bounty: 140 },
  { title: 'The Guard', groups: [g('shield', 4, 2, 'north'), g('spear', 7, 1.3, 'north', 1), g('crossbow', 4, 2, 'north', 4), g('ram', 2, 3, 'west', 6), g('moth', 13, 0.9, 'east', 8), g('gardener', 8, 1.2, 'east', 14), g('gnawer', 4, 1.3, 'west', 3), g('frostling', 3, 1.8, 'east', 10)], bounty: 170 },
  { title: 'Brambles', groups: [g('hedgehog', 8, 1.2, 'east'), g('vine', 7, 1.8, 'west', 3), g('slime', 8, 1.6, 'north', 5), g('runner', 21, 0.5, 'east', 10), g('ram', 2, 3, 'north', 14), g('wolf', 7, 1, 'west', 18), g('gnawer', 5, 1.2, 'east', 4), g('frostling', 4, 1.6, 'west', 8), g('chief_frost', 1, 1, 'north', 16)], bounty: 200 },
  { title: 'Last onslaught', groups: [g('ram', 4, 2.5, 'west'), g('ram', 4, 2.5, 'east', 2), g('moth', 16, 0.8, 'north', 4), g('gardener', 13, 1.0, 'west', 10), g('wolf', 8, 1, 'east', 14), g('runner', 26, 0.4, 'north', 18), g('squire', 8, 1.2, 'west', 24), g('horror', 2, 4, 'north', 28), g('gnawer', 6, 1.0, 'west', 6), g('frostling', 5, 1.5, 'east', 12)], bounty: 320 },
];
