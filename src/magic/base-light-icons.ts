import type { Draw } from '../icons';

/** Пиксельные иконки 16 × 16 для src/magic/base-light.ts */
export const ICONS: Record<string, Draw> = {
  blindflash(p) {
    // вспышка-звезда: белое ядро, золотые лучи крестом и наискось
    for (let i = 1; i < 15; i++) { p.p(i, 7, '#ffd84a'); p.p(i, 8, '#ffd84a'); p.p(7, i, '#ffd84a'); p.p(8, i, '#ffd84a'); }
    p.l(3, 3, 12, 12, '#fff2a0'); p.l(3, 12, 12, 3, '#fff2a0');
    p.s(5, 5, [
      '..aaaa..',
      '.abbbba.',
      'abbwwbba',
      'abwwwwba',
      'abwwwwba',
      'abbwwbba',
      '.abbbba.',
      '..aaaa..',
    ], { a: '#ffb020', b: '#ffe88a', w: '#ffffff' });
    p.p(0, 7, '#fff2a0'); p.p(15, 8, '#fff2a0'); p.p(7, 0, '#fff2a0'); p.p(8, 15, '#fff2a0');
  },
};
