import type { Draw } from '../icons.ts';

/** Pixel icons 16 × 16 for src/magic/base-fire.ts */
export const ICONS: Record<string, Draw> = {
  firewall(p) {
    // row of three flame pillars over a strip of scorched ground
    p.r(1, 13, 14, 2, '#5a2a14'); p.r(1, 13, 14, 1, '#c03a1a');
    for (const [x, h] of [[1, 9], [6, 11], [11, 9]] as const) {
      p.r(x, 13 - h, 4, h, '#ff6a2a');
      p.r(x + 1, 14 - h, 2, h - 2, '#ffb43a');
      p.r(x + 1, 15 - h, 1, h - 5, '#fff2b0');
      p.p(x + 1, 12 - h, '#ff6a2a'); p.p(x + 2, 11 - h, '#ffb43a');
    }
  },
  firestorm(p) {
    // whirlwind of fire ribbons: wider at the top
    const rows: [number, number, string][] = [[1, 12, '#ff6a2a'], [3, 10, '#ffb43a'], [5, 9, '#ff6a2a'], [7, 7, '#ffb43a'], [9, 6, '#ff6a2a'], [11, 4, '#ffb43a'], [13, 3, '#ff6a2a']];
    rows.forEach(([y, w, c], i) => { const x = 8 - Math.ceil(w / 2) + (i % 2 ? 1 : 0); p.r(x, y, w, 1, c); p.p(x + w - 1, y + 1, '#fff2b0'); });
    p.p(2, 4, '#ffe27a'); p.p(13, 6, '#ffe27a'); p.p(3, 9, '#ff8a2a');
  },
  armageddon(p) {
    // three falling balls with tails
    for (const [x, y] of [[2, 3], [8, 1], [10, 8]] as const) {
      p.l(x - 2, y - 2, x, y, '#ff6a2a');
      p.r(x, y, 3, 3, '#ff6a2a'); p.r(x + 1, y + 1, 1, 1, '#fff2b0'); p.p(x + 2, y, '#ffb43a');
    }
    p.r(1, 14, 14, 1, '#c03a1a'); p.p(4, 13, '#ffb43a'); p.p(11, 13, '#ff6a2a');
  },
};
