import type { Draw } from '../icons';

/** Пиксельные иконки 16 × 16 для заклинаний тьмы и арканы (src/magic/dark-arcane.ts) */
export const ICONS: Record<string, Draw> = {
  deadchoir(p) {
    // две призрачные руки тянутся из лужи тьмы
    p.s(1, 12, ['..aaaaaaaaaa..', '.abbbbbbbbbba.', 'abbccbbbbccbba', '.aaaaaaaaaaaa.'], { a: '#3a1a6a', b: '#6a3ab8', c: '#9a6ad8' });
    p.s(2, 2, [
      '.a.a.a.',
      '.b.b.b.',
      '.bbbbb.',
      'bbbbbb.',
      '.bbbbb.',
      '..bbb..',
      '..bbb..',
      '..bbb..',
      '..bbb..',
      '..bbb..',
    ], { a: '#bff6ff', b: '#5ad8c8' });
    p.s(8, 4, [
      '.a.a.a.',
      '.b.b.b.',
      '.bbbbbb',
      '.bbbbb.',
      '..bbb..',
      '..bbb..',
      '..bbb..',
      '..bbb..',
    ], { a: '#d8b8ff', b: '#9a6ad8' });
  },
  gravitywell(p) {
    // тёмная сфера с наклонным светящимся диском
    p.s(4, 3, [
      '...aaaa...',
      '..abbbba..',
      '.abbbbbba.',
      '.abbccbba.',
      '.abbccbba.',
      '.abbbbbba.',
      '..abbbba..',
      '...aaaa...',
    ], { a: '#7a4ad8', b: '#2a1040', c: '#5a2a8a' });
    p.l(0, 9, 15, 5, '#5ad8e8'); p.l(0, 10, 15, 6, '#2a8aa8');
    p.p(7, 7, '#2a1040'); p.p(8, 7, '#2a1040');
    p.p(1, 2, '#d8b8ff'); p.p(14, 13, '#d8b8ff'); p.p(3, 14, '#9a6ad8'); p.p(13, 1, '#9a6ad8');
  },
  skullscythe(p) {
    // череп с фиолетовыми глазницами и лезвие косы дугой
    p.q(2, 4, 8, -1, 14, 5, '#5ad8c8'); p.q(2, 5, 8, 0, 14, 6, '#2a8aa8');
    p.s(4, 5, [
      '.aaaaaa.',
      'aaaaaaaa',
      'abbaabba',
      'abbaabba',
      'aaaccaaa',
      '.aaaaaa.',
      '..a.a.a.',
      '..aaaaa.',
    ], { a: '#e8e4d8', b: '#9a4ae8', c: '#5a3a8a' });
  },
  fallenguards(p) {
    // призрачный рыцарь: шлем с прорезью, щит и поднятый меч
    p.l(13, 1, 13, 9, '#bff6ff'); p.r(11, 9, 5, 1, '#9ad8ff'); p.r(13, 10, 1, 2, '#5a8ab8');
    p.s(3, 2, [
      '...aa...',
      '..aaaa..',
      '.abbbba.',
      '.awwwwa.',
      '.abbbba.',
      '..aaaa..',
      'aaaaaaaa',
      'abbbbbba',
      'abbbbbba',
      '.abbbba.',
      '.ab..ba.',
      '.ab..ba.',
      '.aa..aa.',
    ], { a: '#3a7ab8', b: '#6ad8e8', w: '#ffffff' });
    p.s(0, 8, ['aaa', 'aba', 'aba', 'aba', '.a.'], { a: '#2a5a8a', b: '#9a6ad8' });
  },
  blink(p) {
    // два пурпурных разрыва и след силуэтов между ними
    p.s(0, 9, ['.aa.', 'abba', 'abba', '.aa.'], { a: '#9a3ad8', b: '#ffd8ff' });
    p.s(11, 3, ['.aa.', 'abba', 'abba', '.aa.'], { a: '#d84a9a', b: '#ffe8f4' });
    p.s(4, 6, ['..c.', '.cc.', 'cc..'], { c: '#c88ae8' });
    p.s(7, 4, ['..c.', '.cc.', 'cc..'], { c: '#e8a8f0' });
  },
  bladephalanx(p) {
    // веер из пяти призрачных мечей
    const C = ['#ff8ae8', '#d86af8', '#ffb0f0', '#d86af8', '#ff8ae8'];
    [[2, 12, 3, 3], [4, 13, 5, 2], [8, 13, 8, 1], [12, 13, 11, 2], [14, 12, 13, 3]].forEach(([x0, y0, x1, y1], i) => {
      p.l(x0, y0 - 2, x1, y1, C[i]);
      p.p(x0, y0 - 1, '#ffd84a'); p.p(x0, y0, '#a87a2a');
    });
    p.p(8, 0, '#ffffff'); p.p(3, 2, '#ffffff'); p.p(13, 2, '#ffffff');
  },
};
