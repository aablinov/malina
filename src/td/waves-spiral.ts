import type { TdWave } from './types.ts';

/**
 * Raspberry Spiral waves (wiki/design-tower-defence.md, section 17): the fourth map, "Medium" — twelve waves, the pack starts at
 * level 4 (`meta.td.level`), between the lava (1) and the glade (7). One long road (`north`); from the fifth wave the west portal
 * opens the shortcut (`west`), which skips three quarters of the first turn. Mini-bosses on 3, 6 and 9; the twelfth wave is the
 * Golden Warden (`chief_warden`) with an escort. Numbers are for one player (src/td/scaling.ts).
 */
const g = (kind: string, count: number, every: number, lane: string, delay = 0) => ({ kind, count, every, lane, delay });

export const TD_SPIRAL_WAVES: TdWave[] = [
  { title: 'Up the spiral', groups: [g('berryling', 12, 1.0, 'north'), g('runner', 6, 0.9, 'north', 8)], bounty: 55 },
  { title: 'Gardeners', groups: [g('gardener', 8, 1.4, 'north'), g('runner', 10, 0.7, 'north', 6), g('hopper', 5, 1.4, 'north', 10)], bounty: 65 },
  { title: 'The first chief', groups: [g('squire', 8, 1.2, 'north'), g('berryling', 12, 0.8, 'north', 4), g('gnawer', 2, 1.5, 'north', 8), g('chief_brute', 1, 1, 'north', 12)], bounty: 80 },
  { title: 'Moths over the turns', groups: [g('moth', 10, 1.0, 'north'), g('shellback', 4, 2.5, 'north', 4), g('runner', 12, 0.6, 'north', 10)], bounty: 95 },
  { title: 'The west portal', groups: [g('wolf', 6, 1.0, 'west'), g('gardener', 10, 1.2, 'north', 2), g('hopper', 8, 1.0, 'west', 8), g('frostling', 2, 1.8, 'north', 6)], bounty: 110 },
  { title: 'Slimes on the climb', groups: [g('slime', 6, 1.8, 'north'), g('sporeling', 6, 1.6, 'west', 3), g('runner', 14, 0.6, 'west', 8), g('gnawer', 3, 1.4, 'north', 6), g('chief_slime', 1, 1, 'north', 12)], bounty: 135 },
  { title: 'Battering rams', groups: [g('ram', 2, 4, 'north'), g('squire', 10, 1.1, 'north', 2), g('shellback', 6, 2, 'west', 4), g('moth', 8, 1.0, 'west', 10)], bounty: 155 },
  { title: 'Two roads', groups: [g('wolf', 8, 0.9, 'west'), g('gardener', 12, 1.1, 'north'), g('sporeling', 8, 1.4, 'north', 6), g('hopper', 12, 0.8, 'west', 8), g('frostling', 3, 1.6, 'west', 6)], bounty: 175 },
  { title: 'Frost on the plateau', groups: [g('shellback', 8, 1.8, 'north'), g('ram', 2, 3.5, 'west', 3), g('runner', 18, 0.5, 'north', 8), g('gnawer', 4, 1.3, 'west', 6), g('chief_frost', 1, 1, 'north', 14)], bounty: 210 },
  { title: 'Brambles', groups: [g('hedgehog', 8, 1.2, 'north'), g('vine', 6, 1.8, 'west', 3), g('moth', 12, 0.8, 'north', 8), g('sporeling', 8, 1.3, 'west', 10), g('frostling', 4, 1.5, 'north', 6)], bounty: 240 },
  { title: 'The Order gathers', groups: [g('ram', 4, 3, 'north'), g('shellback', 10, 1.5, 'west', 2), g('wolf', 10, 0.8, 'north', 6), g('hopper', 16, 0.6, 'west', 10), g('horror', 1, 1, 'north', 18), g('gnawer', 5, 1.1, 'north', 6)], bounty: 300 },
  { title: 'The Golden Warden', groups: [g('squire', 12, 1.0, 'north'), g('shellback', 8, 1.6, 'west', 2), g('moth', 12, 0.8, 'west', 8), g('runner', 20, 0.4, 'north', 10), g('frostling', 4, 1.5, 'west', 6), g('chief_warden', 1, 1, 'north', 16), g('ram', 2, 3, 'north', 20)], bounty: 420 },
];
