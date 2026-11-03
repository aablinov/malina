import type { Draw } from './icons.ts';

/** Пиксельные иконки 16 × 16 для наступательных аур (src/aura-offense.ts) */
export const ICONS: Record<string, Draw> = {
  'a-inferno'(p) {
    // кольцо углей и пламя в середине
    p.q(2, 10, 2, 15, 8, 15, '#8a2a0a'); p.q(8, 15, 14, 15, 14, 10, '#8a2a0a');
    p.q(3, 10, 3, 14, 8, 14, '#ff6a1a'); p.q(8, 14, 13, 14, 13, 10, '#ff6a1a');
    p.s(4, 1, [
      '...a....',
      '...aa...',
      '..aba.a.',
      '..abba.a',
      '.abbcba.',
      '.abccba.',
      'abccwcba',
      'abcwwcba',
      'abcwwcba',
      '.abccba.',
      '..aaaa..',
    ], { a: '#9a1a0a', b: '#ff5a1a', c: '#ffaa3a', w: '#fff2a0' });
    p.p(2, 9, '#ffd27a'); p.p(13, 9, '#ffd27a'); p.p(1, 12, '#ffaa3a'); p.p(14, 12, '#ffaa3a');
  },
  'a-frost'(p) {
    // снежинка
    const c = '#bfe6ff', d = '#4aa8f8', w = '#ffffff';
    p.l(8, 1, 8, 14, d); p.l(2, 4, 14, 11, d); p.l(2, 11, 14, 4, d);
    p.l(7, 1, 7, 14, c); p.l(2, 5, 13, 11, c); p.l(2, 10, 13, 4, c);
    for (const [x, y] of [[6, 2], [9, 2], [6, 13], [9, 13], [3, 3], [12, 3], [3, 12], [12, 12]] as const) p.p(x, y, c);
    p.r(6, 6, 4, 4, d); p.r(7, 7, 2, 2, w);
  },
  'a-storm'(p) {
    // молния в венце искр
    p.s(5, 1, [
      '....aa',
      '...aba',
      '..abba',
      '.abba.',
      'abbaaa',
      'abbbba',
      'aaabba',
      '..abba',
      '.abba.',
      '.aba..',
      'aba...',
      'aa....',
    ], { a: '#3a3a8a', b: '#fff27a' });
    for (const [x, y] of [[2, 3], [13, 4], [1, 9], [14, 10], [3, 14], [12, 14]] as const) { p.p(x, y, '#c8c0ff'); p.p(x + 1, y, '#8a8aff'); }
  },
  'a-halo'(p) {
    // золотой нимб и луч вниз
    p.q(2, 4, 8, 0, 14, 4, '#d8a82a'); p.q(2, 4, 8, 8, 14, 4, '#d8a82a');
    p.q(3, 4, 8, 1, 13, 4, '#ffe08a'); p.q(3, 4, 8, 7, 13, 4, '#ffe08a');
    p.r(7, 7, 2, 7, '#ffe08a'); p.r(6, 9, 1, 5, '#d8a82a'); p.r(9, 9, 1, 5, '#d8a82a');
    p.r(4, 14, 8, 1, '#fff6c8'); p.p(3, 13, '#ffe08a'); p.p(12, 13, '#ffe08a'); p.p(8, 13, '#ffffff');
  },
  'a-shade'(p) {
    // фиолетовое око в дымке
    p.s(2, 4, [
      '....aaaa....',
      '..aabbbbaa..',
      '.abbccccbba.',
      'abbcwwddcbba',
      'abbcwddddbba',
      '.abbccccbba.',
      '..aabbbbaa..',
      '....aaaa....',
    ], { a: '#2a1a4a', b: '#6a3ab0', c: '#b07aff', d: '#4ae0d0', w: '#e8d8ff' });
    for (const [x, y] of [[1, 13], [4, 14], [7, 13], [10, 14], [13, 13]] as const) { p.p(x, y, '#6a3ab0'); p.p(x + 1, y, '#9a6ad8'); }
  },
  'a-quake'(p) {
    // трещина и прыгающие камни
    p.r(0, 11, 16, 5, '#7a6a58'); p.r(0, 11, 16, 1, '#a8906a');
    p.l(3, 15, 6, 12, '#3a2a1a'); p.l(6, 12, 9, 14, '#3a2a1a'); p.l(9, 14, 13, 11, '#3a2a1a');
    p.l(4, 15, 7, 12, '#ffb43a');
    p.s(2, 4, ['.aa.', 'abba', 'abbb', '.bb.'], { a: '#a8906a', b: '#7a6a58' });
    p.s(10, 2, ['.aa', 'abb', 'abb'], { a: '#a8906a', b: '#7a6a58' });
    p.s(7, 7, ['aa', 'ab'], { a: '#a8906a', b: '#7a6a58' });
    p.p(5, 2, '#e0b060'); p.p(13, 7, '#e0b060');
  },
  'a-blades'(p) {
    // три призрачных меча по кругу
    p.l(8, 1, 8, 8, '#ffb0ee'); p.l(9, 1, 9, 7, '#c83aa8'); p.r(6, 8, 5, 1, '#ffe08a'); p.r(8, 9, 1, 2, '#8a2a7a');
    p.l(1, 12, 6, 9, '#ffb0ee'); p.l(1, 13, 6, 10, '#c83aa8'); p.l(5, 8, 7, 11, '#ffe08a');
    p.l(14, 12, 9, 9, '#ffb0ee'); p.l(14, 13, 9, 10, '#c83aa8'); p.l(10, 11, 12, 8, '#ffe08a');
    p.q(2, 6, 3, 2, 7, 1, '#ff8ae0'); p.q(14, 6, 13, 2, 10, 1, '#ff8ae0'); p.q(3, 15, 8, 16, 13, 15, '#ff8ae0');
  },
};
