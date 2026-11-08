import type { TdWave } from './types.ts';

/**
 * Raspberry Spiral waves (wiki/design-tower-defence.md, section 17): the fourth map, "Medium" — twelve waves, the pack starts at
 * level 4 (`meta.td.level`), between the lava (1) and the glade (7). One long road (`north`); from the fifth wave the west portal
 * opens the shortcut (`west`), which skips three quarters of the first turn. The map has many pads, so the waves are dense (≈ 1.6× the
 * glade's), and from the third wave every wave brings a mini-boss, from the sixth — two or three. The twelfth wave — two final bosses
 * from both portals: the Golden Warden (`chief_warden`) from the north and the Frost Queen (`chief_frostqueen`) from the west.
 * Numbers are for one player (src/td/scaling.ts).
 */
const g = (kind: string, count: number, every: number, lane: string, delay = 0) => ({ kind, count, every, lane, delay });

export const TD_SPIRAL_WAVES: TdWave[] = [
  { title: 'Up the spiral', groups: [g('berryling', 20, 0.7, 'north'), g('runner', 10, 0.6, 'north', 8)], bounty: 55 },
  { title: 'Gardeners', groups: [g('gardener', 13, 1.0, 'north'), g('runner', 16, 0.5, 'north', 6), g('hopper', 8, 1.0, 'north', 10)], bounty: 65 },
  { title: 'The first chief', groups: [g('squire', 13, 0.9, 'north'), g('berryling', 20, 0.6, 'north', 4), g('gnawer', 3, 1.3, 'north', 8), g('chief_brute', 1, 1, 'north', 12)], bounty: 80 },
  { title: 'Moths over the turns', groups: [g('moth', 16, 0.7, 'north'), g('shellback', 7, 1.8, 'north', 4), g('runner', 20, 0.45, 'north', 10), g('chief_slime', 1, 1, 'north', 16)], bounty: 95 },
  { title: 'The west portal', groups: [g('wolf', 10, 0.8, 'west'), g('gardener', 16, 0.9, 'north', 2), g('hopper', 13, 0.8, 'west', 8), g('frostling', 3, 1.5, 'north', 6), g('chief_brute', 1, 1, 'west', 14)], bounty: 110 },
  { title: 'Slimes on the climb', groups: [g('slime', 10, 1.3, 'north'), g('sporeling', 10, 1.2, 'west', 3), g('runner', 22, 0.45, 'west', 8), g('gnawer', 5, 1.2, 'north', 6), g('chief_slime', 1, 1, 'north', 12), g('chief_frost', 1, 1, 'west', 18)], bounty: 135 },
  { title: 'Battering rams', groups: [g('ram', 4, 3, 'north'), g('squire', 16, 0.8, 'north', 2), g('shellback', 10, 1.5, 'west', 4), g('moth', 13, 0.7, 'west', 10), g('chief_slime', 1, 1, 'west', 8), g('chief_brute', 1, 1, 'north', 16)], bounty: 155 },
  { title: 'Two roads', groups: [g('wolf', 13, 0.7, 'west'), g('gardener', 20, 0.8, 'north'), g('sporeling', 13, 1.0, 'north', 6), g('hopper', 20, 0.6, 'west', 8), g('frostling', 5, 1.3, 'west', 6), g('chief_slime', 1, 1, 'west', 12), g('chief_brute', 1, 1, 'north', 16)], bounty: 175 },
  { title: 'Frost on the plateau', groups: [g('shellback', 13, 1.3, 'north'), g('ram', 3, 3, 'west', 3), g('runner', 29, 0.4, 'north', 8), g('gnawer', 6, 1.1, 'west', 6), g('chief_frost', 1, 1, 'north', 12), g('chief_frost', 1, 1, 'west', 16)], bounty: 210 },
  { title: 'Brambles', groups: [g('hedgehog', 13, 0.9, 'north'), g('vine', 10, 1.4, 'west', 3), g('moth', 20, 0.6, 'north', 8), g('sporeling', 13, 1.0, 'west', 10), g('frostling', 6, 1.2, 'north', 6), g('chief_slime', 1, 1, 'north', 10), g('chief_brute', 1, 1, 'west', 14)], bounty: 240 },
  { title: 'The Order gathers', groups: [g('ram', 6, 2.5, 'north'), g('shellback', 16, 1.1, 'west', 2), g('wolf', 16, 0.6, 'north', 6), g('hopper', 26, 0.45, 'west', 10), g('horror', 2, 6, 'north', 18), g('gnawer', 8, 0.9, 'north', 6), g('chief_frost', 1, 1, 'west', 8), g('chief_brute', 1, 1, 'north', 14), g('chief_slime', 1, 1, 'west', 20)], bounty: 300 },
  { title: 'Gold and frost', groups: [g('squire', 20, 0.7, 'north'), g('shellback', 13, 1.2, 'west', 2), g('moth', 20, 0.6, 'west', 8), g('runner', 32, 0.35, 'north', 10), g('frostling', 6, 1.2, 'west', 6), g('chief_brute', 1, 1, 'west', 10), g('chief_warden', 1, 1, 'north', 16), g('chief_frostqueen', 1, 1, 'west', 18), g('ram', 4, 2.5, 'north', 22), g('chief_slime', 1, 1, 'north', 26)], bounty: 420 },
];
