import type { Draw } from '../icons';

/** Пиксельные иконки 16 × 16 для заклинаний молнии и света (src/magic/storm-light.ts) */
export const ICONS: Record<string, Draw> = {
  thunderspear(p) {
    // копьё-молния по диагонали: белое ядро, голубой ореол, наконечник вверху справа
    p.l(2, 13, 11, 4, '#3a8ad8'); p.l(3, 13, 12, 4, '#7ad8ff'); p.l(3, 12, 11, 4, '#ffffff');
    p.s(10, 1, ['..aab', '.awwb', 'awwb.', 'aab..'], { a: '#3a8ad8', w: '#ffffff', b: '#7ad8ff' });
    p.p(5, 9, '#bff6ff'); p.p(8, 11, '#7ad8ff'); p.p(1, 10, '#bff6ff'); p.p(9, 13, '#bff6ff');
    p.l(1, 14, 3, 12, '#2a5a9a');
  },
  thunderleap(p) {
    // сапог над землёй, вниз бьют молнии
    p.s(5, 1, ['.aaa..', '.abba.', '.abba.', '.abbba', 'aabbbb', 'abbbbb', 'aaaaaa'], { a: '#3a2a1a', b: '#8a5a32' });
    p.l(2, 9, 4, 13, '#7ad8ff'); p.l(4, 13, 3, 15, '#ffffff');
    p.l(8, 9, 7, 12, '#ffffff'); p.l(7, 12, 9, 15, '#7ad8ff');
    p.l(13, 9, 12, 12, '#7ad8ff'); p.l(12, 12, 14, 15, '#ffffff');
    p.r(1, 15, 14, 1, '#5a8a4a');
  },
  stormcloud(p) {
    // туча и молния под ней
    p.s(1, 1, [
      '....aaaa......',
      '..aabbbbaa....',
      '.abbbccbbbaaa.',
      'abbccccbbbbbba',
      'abbbbbbbbbbbba',
      '.aaaaaaaaaaaa.',
    ], { a: '#4a5068', b: '#9aa4c0', c: '#c8d0e8' });
    p.s(6, 7, ['.ww', 'ww.', 'wyy', '.yw', '.w.', 'w..'], { w: '#ffffff', y: '#ffe24a' });
    p.p(3, 9, '#7ad8ff'); p.p(2, 11, '#7ad8ff'); p.p(12, 9, '#7ad8ff'); p.p(13, 12, '#7ad8ff');
  },
  starfall(p) {
    // три падающие звезды с хвостами
    const star = (x: number, y: number): void => { p.s(x, y, ['.w.', 'wyw', '.w.'], { w: '#ffffff', y: '#ffe27a' }); };
    p.l(1, 1, 6, 6, '#c08a2a'); p.l(2, 1, 7, 6, '#ffd25a'); star(6, 6);
    p.l(8, 0, 11, 3, '#c08a2a'); star(11, 3);
    p.l(2, 8, 5, 11, '#c08a2a'); p.l(3, 8, 6, 11, '#ffd25a'); star(6, 11);
    p.p(13, 10, '#ffffff'); p.p(10, 14, '#ffe27a'); p.p(14, 13, '#ffe27a');
  },
  starbeam(p) {
    // ладонь и широкий луч вправо
    p.s(0, 5, ['aa..', 'abba', 'abbb', 'abbb', 'abba', 'aa..'], { a: '#5a3a22', b: '#e8b088' });
    p.r(4, 6, 12, 4, '#ffd25a'); p.r(4, 7, 12, 2, '#ffffff');
    p.r(4, 5, 12, 1, '#c08a2a'); p.r(4, 10, 12, 1, '#c08a2a');
    p.p(8, 3, '#ffe27a'); p.p(12, 2, '#ffffff'); p.p(10, 13, '#ffe27a'); p.p(14, 12, '#ffffff');
  },
  judgement(p) {
    // столп света с неба в круг на земле
    p.r(6, 0, 4, 12, '#ffd25a'); p.r(7, 0, 2, 12, '#ffffff');
    p.r(5, 0, 1, 10, '#c08a2a'); p.r(10, 0, 1, 10, '#c08a2a');
    p.s(1, 11, ['...aaaaaaaa...', '.aabbbbbbbbaa.', 'abbbwwwwwwbbba', '.aabbbbbbbbaa.', '...aaaaaaaa...'], { a: '#c08a2a', b: '#ffd25a', w: '#ffffff' });
    p.p(2, 4, '#ffe27a'); p.p(13, 6, '#ffe27a'); p.p(3, 8, '#ffffff'); p.p(12, 2, '#ffffff');
  },
};
