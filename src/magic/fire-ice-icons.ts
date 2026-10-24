import type { Draw } from '../icons';

/** Пиксельные иконки 16 × 16 для заклинаний огня и льда (src/magic/fire-ice.ts) */
export const ICONS: Record<string, Draw> = {
  meteor(p) {
    // пылающий камень летит сверху справа, хвост пламени
    p.l(1, 1, 7, 7, '#ffb43a'); p.l(2, 1, 8, 7, '#ff6a2a'); p.l(1, 2, 7, 8, '#ff6a2a'); p.l(3, 1, 8, 6, '#ffe27a');
    p.s(7, 6, [
      '..aaaa..',
      '.abbcba.',
      'abccbbca',
      'abcbbcba',
      'abbbcbba',
      'acbbbbba',
      '.abbcba.',
      '..aaaa..',
    ], { a: '#3a2418', b: '#6b4a30', c: '#ff7a2a' });
    p.p(9, 9, '#ffe27a'); p.p(12, 10, '#ffb43a');
  },
  flameserpent(p) {
    // змей из огненных квадратиков волной, голова с глазом
    const body: [number, number][] = [[1, 12], [2, 11], [3, 11], [4, 12], [5, 13], [6, 13], [7, 12], [8, 11], [9, 10], [9, 9], [8, 8], [7, 7], [7, 6], [8, 5], [9, 4]];
    body.forEach(([x, y], i) => { p.r(x, y, 2, 2, i % 2 ? '#ff6a2a' : '#ffb43a'); });
    p.s(9, 1, ['.aaaa.', 'abbbba', 'abwbbb', 'abbbba', '.aaaa.'], { a: '#c03a1a', b: '#ff8a2a', w: '#fff2b0' });
    p.p(15, 3, '#ff4a3a'); p.p(15, 4, '#ff4a3a');
  },
  ashcrown(p) {
    // корона из языков пламени на кольце
    p.r(2, 11, 12, 3, '#c03a1a'); p.r(3, 12, 10, 1, '#ff8a2a');
    for (const x of [2, 6, 10]) p.s(x, 3, ['.a..', '.ba.', 'abba', 'abca', 'abca', 'abba', 'abba', '.bb.'], { a: '#ff6a2a', b: '#ffb43a', c: '#fff2b0' });
    p.p(4, 12, '#fff2b0'); p.p(8, 12, '#fff2b0'); p.p(12, 12, '#fff2b0');
  },
  icetomb(p) {
    // фигурка внутри ледяного кристалла
    p.s(3, 1, [
      '...aaaa...',
      '..abbbba..',
      '.abbccbba.',
      'abbcddcbba',
      'abbcddcbba',
      'abbbccbbba',
      'abbceecbba',
      'abbceecbba',
      'abbceecbba',
      'abbbccbbba',
      'abbcbbcbba',
      '.abbbbbba.',
      '..abbbba..',
      '...aaaa...',
    ], { a: '#3a7ab8', b: '#a8e0ff', c: '#6aaad8', d: '#d8b08a', e: '#4a8a3a' });
    p.p(4, 3, '#ffffff'); p.p(5, 2, '#ffffff');
  },
  frostridge(p) {
    // веер ледяных шипов из земли
    p.r(0, 13, 16, 2, '#5a8ab8');
    for (const [x, h] of [[1, 4], [4, 7], [7, 10], [10, 7], [13, 4]] as const) {
      for (let j = 0; j < h; j++) { const w = Math.max(1, Math.round((j / h) * 2)); p.r(x + 1 - Math.floor(w / 2), 13 - h + j, w, 1, j < 2 ? '#ffffff' : '#a8e8ff'); }
      p.p(x + 1, 12, '#5ab8e8');
    }
  },
  absolutezero(p) {
    // снежинка под куполом
    p.q(1, 14, 1, 1, 8, 1, '#7ad8ff'); p.q(8, 1, 15, 1, 15, 14, '#7ad8ff'); p.r(0, 14, 16, 1, '#3a7ab8');
    p.l(8, 4, 8, 13, '#ffffff'); p.l(4, 6, 12, 11, '#ffffff'); p.l(12, 6, 4, 11, '#ffffff');
    p.p(7, 5, '#bff6ff'); p.p(9, 5, '#bff6ff'); p.p(7, 12, '#bff6ff'); p.p(9, 12, '#bff6ff');
    p.r(7, 8, 3, 2, '#bff6ff');
  },
};
