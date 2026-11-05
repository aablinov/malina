import type { Draw } from '../icons.ts';

/** Pixel icons 16 × 16 for src/magic/base-summon.ts */
export const ICONS: Record<string, Draw> = {
  wolves(p) {
    // spirit wolf head in profile: turquoise fur, glowing eye, mane
    p.s(1, 2, [
      '...a..a.......',
      '..aba.aba.....',
      '..abbaabba....',
      '.abbbbbbbaa...',
      'cabbbbwbbbbaa.',
      'cabbbbbbbbbbba',
      'ccabbbbbddddda',
      'ccabbbbbda....',
      'cccabbbba.....',
      'cccaabba......',
      '.cccaaa.......',
      '..ccc.........',
    ], { a: '#2a5a55', b: '#86bdb4', c: '#5ad8b8', d: '#557f7a', w: '#e8fff8' });
    p.p(13, 13, '#5ad8b8'); p.p(14, 11, '#a8ffe0');
  },
  elemental(p) {
    // fire core in a shell and three elemental satellite cubes
    p.s(4, 4, [
      '..aaaa..',
      '.abbbba.',
      'abbccbba',
      'abcwwcba',
      'abcwwcba',
      'abbccbba',
      '.abbbba.',
      '..aaaa..',
    ], { a: '#2a6a6a', b: '#5ad8b8', c: '#ffb43a', w: '#fff2b0' });
    p.r(1, 2, 2, 2, '#ff6a2a'); p.p(1, 2, '#ffe27a');
    p.r(13, 3, 2, 2, '#7ad8ff'); p.p(13, 3, '#ffffff');
    p.r(7, 13, 2, 2, '#ffe24a'); p.p(8, 13, '#ffffff');
  },
  golem(p) {
    // stone golem: square head, turquoise eyes and a rune, moss on the shoulders
    p.s(2, 1, [
      '....aaaa....',
      '....abba....',
      '....awwa....',
      '.mmmmmmmmmm.',
      'aabbbbbbbbaa',
      'abbbbccbbbba',
      'abbbbccbbbba',
      'abbbbbbbbbba',
      'dd.abbbba.dd',
      'dd.abbbba.dd',
      '...aa..aa...',
      '...dd..dd...',
      '...dd..dd...',
      '..ddd..ddd..',
    ], { a: '#5a554c', b: '#9a9284', c: '#5ad8b8', d: '#6f695e', m: '#5f8a3a', w: '#a8ffe8' });
  },
};
