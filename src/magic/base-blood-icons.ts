import type { Draw } from '../icons.ts';

/** Pixel icons 16 × 16 for src/magic/base-blood.ts */
export const ICONS: Record<string, Draw> = {
  bloodclaws(p) {
    // three curved raspberry claws out of a puddle of juice
    for (const [x0, h] of [[3, 9], [7, 12], [11, 9]] as const) {
      p.q(x0, 14, x0 - 1, 14 - h * 0.6, x0 + 2, 14 - h, '#ff4a7a');
      p.q(x0 + 1, 14, x0, 14 - h * 0.6, x0 + 3, 14 - h + 1, '#c8103a');
      p.p(x0 + 2, 14 - h, '#ffd0dc');
    }
    p.r(1, 14, 14, 2, '#8a0a2a'); p.r(2, 14, 4, 1, '#d8204a'); p.r(9, 14, 5, 1, '#d8204a');
  },
  bloodswarm(p) {
    // swarm of raspberry midges around a berry
    p.s(5, 6, [
      '.aab.',
      'abbab',
      'babba',
      'abbab',
      '.bab.',
    ], { a: '#ff4a7a', b: '#b8103a' });
    p.p(7, 5, '#5aa84a'); p.p(8, 5, '#3a7a2a');
    for (const [x, y] of [[1, 2], [3, 4], [13, 3], [11, 1], [14, 8], [1, 10], [3, 13], [12, 13], [14, 11], [9, 14], [6, 2]] as const) {
      p.p(x, y, '#ff6a90'); p.p(x + 1, y - 1, '#ffd0dc');
    }
  },
  bloodblade(p) {
    // blade in raspberry juice: drops run down to the point and fall
    p.l(3, 12, 12, 3, '#e8e2ee'); p.l(4, 12, 13, 3, '#b8b2c6'); p.l(4, 11, 12, 3, '#ff4a7a');
    p.p(13, 2, '#ffffff');
    p.l(1, 12, 4, 15, '#7a5230'); p.r(2, 11, 3, 1, '#f2b632'); p.r(4, 13, 1, 3, '#f2b632');
    p.r(7, 9, 1, 2, '#d8204a'); p.p(7, 11, '#ff4a7a');
    p.r(10, 6, 1, 3, '#d8204a'); p.p(10, 9, '#ff4a7a');
    p.p(9, 13, '#ff4a7a'); p.p(12, 11, '#d8204a'); p.p(12, 12, '#ff6a90');
  },
};
