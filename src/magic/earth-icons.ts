import type { Draw } from '../icons';

/** Пиксельные иконки 16 × 16 для заклинаний земли и природы (src/magic/earth.ts) */
export const ICONS: Record<string, Draw> = {
  rift(p) {
    // трещина с янтарным светом и каменные шипы по краям
    p.l(2, 14, 6, 10, '#5a3a22'); p.l(6, 10, 9, 8, '#5a3a22'); p.l(9, 8, 13, 3, '#5a3a22');
    p.l(3, 14, 7, 10, '#ffb43a'); p.l(7, 10, 10, 8, '#ffd27a'); p.l(10, 8, 13, 4, '#ffb43a');
    p.s(1, 6, ['.a.', 'aba', 'aba', 'abb'], { a: '#7a6a58', b: '#a89880' });
    p.s(10, 9, ['..a.', '.aba', '.abb', 'abbb', 'abbb'], { a: '#7a6a58', b: '#a89880' });
    p.s(5, 2, ['.a', 'ab', 'ab'], { a: '#7a6a58', b: '#a89880' });
    p.p(12, 2, '#ffe27a'); p.p(4, 9, '#ffe27a');
  },
  raspberrybush(p) {
    // куст: листва, колючки, малина
    p.s(2, 4, [
      '...aaaaa....',
      '..abbbbbaa..',
      '.abbcbbbbba.',
      'abbbbbbcbbba',
      'abcbbbbbbbba',
      'abbbbcbbbbba',
      '.abbbbbbcba.',
      '..aaaaaaaa..',
    ], { a: '#2f6a2a', b: '#4fa83a', c: '#6aca4a' });
    for (const [x, y] of [[5, 6], [9, 5], [11, 8], [6, 9], [9, 10], [4, 8]] as const) { p.r(x, y, 2, 2, '#e0285a'); p.p(x, y, '#ff8aa8'); }
    for (const [x, y] of [[1, 6], [14, 7], [3, 3], [12, 3]] as const) p.p(x, y, '#d8e8a8');
    p.r(7, 12, 2, 3, '#6a4a2a');
  },
  titanform(p) {
    // каменная голова великана с янтарными глазами и трещиной
    p.s(2, 1, [
      '...aaaaaa...',
      '..abbbbbba..',
      '.abccbbccba.',
      'abbbbbbbbbba',
      'abbddbbddbba',
      'abbddbbddbba',
      'abbbbebbbbba',
      'abcbbebbbcba',
      'abbbbbbbbbba',
      '.abbaaaabba.',
      '.abbbbbbbba.',
      '..abbbbbba..',
      '...aaaaaa...',
    ], { a: '#4a3e32', b: '#9a8a74', c: '#c8b898', d: '#ffb43a', e: '#ffd27a' });
    p.p(0, 14, '#a89880'); p.p(15, 13, '#a89880'); p.p(1, 12, '#7a6a58');
  },
};
