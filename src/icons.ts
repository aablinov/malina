// Пиксельные иконки для интерфейса
const PAL: Record<string, string> = {
  g: '#3f8a2a', G: '#6cc23f', R: '#e0284f', r: '#a8123a', w: '#ffb0c0',
  B: '#b07a45', D: '#6b4a2b', W: '#e8d2a0', p: '#ff6a9a', P: '#ff3d74', Y: '#ffe9a0',
  d: '#5a3a22', k: '#151820', K: '#2b3f6a', b: '#4a7fb0', E: '#ff3030',
  s: '#e6eaf0', S: '#9aa3b0', h: '#6b4a2b', o: '#d4a53a', n: '#1c1c22',
  x: '#3a2a50', X: '#a45be8', q: '#e0203a', Q: '#7a0a1c', i: '#bff0ff', I: '#4aa8d8',
  y: '#ffd84a', O: '#ff9a2a', m: '#eef1fa', M: '#9aa6c8', H: '#e83a4a'
};

export type IconName =
  | 'berry' | 'gun' | 'club' | 'burst' | 'sprout' | 'bush' | 'bug' | 'sun' | 'moon' | 'heart'
  | 'rifle' | 'uzi' | 'shotgun' | 'chaingun' | 'plasma' | 'launcher' | 'superShotgun' | 'bfg'
  | 'bullets' | 'shells' | 'cells' | 'grenades' | 'health' | 'spitter';

const ICONS: Record<IconName, string[]> = {
  rifle: [
    '............', '.....nn.....', '....nnnn....', 'nnnnnnnnnnnS', 'nOOOOOnnnnnS', 'nnnnnnnnnnnS',
    '..nn..nn....', '..nn..nn....', '..n...n.....', '............', '............', '............',
  ],
  uzi: [
    '............', '............', '..nnnnnnS...', '..nOOnnnSS..', '..nnnnnnS...', '..nn.nn.....',
    '.....nn.....', '.....nn.....', '.....nn.....', '............', '............', '............',
  ],
  shotgun: [
    '............', '............', '............', 'nnnnSSSSSSSS', 'nnnnOOOnnnn.', 'nnnn..nnnnn.',
    'nn.n........', 'nn..........', '............', '............', '............', '............',
  ],
  chaingun: [
    '............', '..nnnn......', '.nnnnnSSSSSS', '.nOOnnSnnnnn', '.nnnnnSSSSSS', '.nnnnnnnnnnn',
    '.nnnnnSSSSSS', '..nn........', '..nn........', '............', '............', '............',
  ],
  plasma: [
    '............', '..ibibib....', '.nnnnnnnnnS.', '.nKKKKKnniSi', '.nnnnnnnnnS.', '...nn.......',
    '...nn.......', '............', '............', '............', '............', '............',
  ],
  launcher: [
    '............', '...SSSSSSSS.', '..SSSSSSSSSq', '..SSOOSSSSSq', '..SSSSSSSSS.', '..nnn.......',
    '..nnn.......', '...n........', '............', '............', '............', '............',
  ],
  superShotgun: [
    '............', '............', 'nnnyyySSSSSS', 'nnnyyy......', 'nnnyyySSSSSS', 'nn..........',
    'nn..........', '............', '............', '............', '............', '............',
  ],
  bfg: [
    '............', '..SSSSSSS...', '.SSGGGGGSS..', '.SSGgggGSSGG', '.SSGGGGGSSGG', '.SSSSSSSSS..',
    '...nn.......', '...nn.......', '............', '............', '............', '............',
  ],
  bullets: [
    '............', '..y...y...y.', '.yyy.yyy.yyy', '.yyy.yyy.yyy', '.yyy.yyy.yyy', '.ooo.ooo.ooo',
    '.ooo.ooo.ooo', '.ooo.ooo.ooo', '.ooo.ooo.ooo', '.ooo.ooo.ooo', '............', '............',
  ],
  shells: [
    '............', '..qqq..qqq..', '..qQq..qQq..', '..qQq..qQq..', '..qQq..qQq..', '..qQq..qQq..',
    '..qQq..qQq..', '..ooo..ooo..', '..ooo..ooo..', '............', '............', '............',
  ],
  cells: [
    '............', '...SSSSSS...', '..SiiiiiiS..', '..SibbbbiS..', '..SiiiiiiS..', '..SibbbbiS..',
    '..SiiiiiiS..', '..SibbbbiS..', '..SiiiiiiS..', '...SSSSSS...', '............', '............',
  ],
  grenades: [
    '............', '.....SS.....', '....nnnn....', '...nnnnnn...', '..nnnqqnnn..', '..nnqqqqnn..',
    '..nnnqqnnn..', '...nnnnnn...', '....nnnn....', '............', '............', '............',
  ],
  health: [
    '............', '....bbbb....', '....bmmb....', '....bmmb....', '.bbbbmmbbbb.', '.bmmmmmmmmb.',
    '.bmmmmmmmmb.', '.bbbbmmbbbb.', '....bmmb....', '....bmmb....', '....bbbb....', '............',
  ],
  spitter: [
    '..k......k..', '...k....k...', '....kEEk....', '....kkkk....', '.k.gGGGGg.k.', '..gGGGGGGg..',
    '.kgGGGGGGgk.', '..gGGGGGGg..', '.kgGGGGGGgk.', '..gGGGGGGg..', '...gGGGGg...', '............',
  ],
  sun: [
    '.....y......',
    '.y...y...y..',
    '..y.....y...',
    '....yyy.....',
    '...yOOOy....',
    'yy.yOOOy.yy.',
    '...yOOOy....',
    '....yyy.....',
    '..y.....y...',
    '.y...y...y..',
    '.....y......',
    '............',
  ],
  moon: [
    '....mmm.....',
    '..mmmM......',
    '.mmmM.......',
    '.mmM........',
    'mmmM........',
    'mmmM........',
    'mmmM........',
    '.mmmM.......',
    '.mmmmM....m.',
    '..mmmmmmmm..',
    '....mmmm....',
    '............',
  ],
  heart: [
    '............',
    '.HHH...HHH..',
    'HHwHH.HHHHH.',
    'HwHHHHHHHHH.',
    'HHHHHHHHHHH.',
    'HHHHHHHHHHH.',
    '.HHHHHHHHH..',
    '..HHHHHHH...',
    '...HHHHH....',
    '....HHH.....',
    '.....H......',
    '............',
  ],
  berry: [
    '....g..g....',
    '.....gg.....',
    '...gGGGGg...',
    '...RrRrRr...',
    '..rRwRrRrR..',
    '..RrRrRrRr..',
    '..rRrRrRrR..',
    '..RrRrRrRr..',
    '...rRrRrR...',
    '....RrRr....',
    '.....rR.....',
    '............',
  ],
  gun: [
    '............',
    '.B........B.',
    '.BrrrrrrrrB.',
    '.BB..RR..BB.',
    '..BB.RR.BB..',
    '...BBBBBB...',
    '....BBBB....',
    '.....DD.....',
    '.....DD.....',
    '.....DD.....',
    '.....DD.....',
    '............',
  ],
  club: [
    '........WWW.',
    '.......WWWWW',
    '......WWWWW.',
    '.....WWWWW..',
    '....BWWWW...',
    '...BBWWW....',
    '..BBB.......',
    '.DBB........',
    'DDB.........',
    'DD..........',
    '............',
    '............',
  ],
  burst: [
    '.....p......',
    '.....P......',
    '..p..P..p...',
    '...P.Y.P....',
    '....YYY.....',
    'pPPYYWYYPPp.',
    '....YYY.....',
    '...P.Y.P....',
    '..p..P..p...',
    '.....P......',
    '.....p......',
    '............',
  ],
  sprout: [
    '............',
    '.GG......GG.',
    'GGgG....GgGG',
    'GgggG..GgggG',
    '.GgggGGgggG.',
    '...GGGGGG...',
    '.....GG.....',
    '.....GG.....',
    '..dddddddd..',
    '.dDdDdDdDdd.',
    'dDdDdDdDdDdD',
    '............',
  ],
  bush: [
    '....GGGG....',
    '..GGgGGgGG..',
    '.GgRGGGgRGG.',
    '.GGGgRGGGgG.',
    'GgRGGGGgRGGG',
    'GGGgGRGGGgGG',
    '.GRGGgGGRGg.',
    '.GGgGGGgGGG.',
    '..GGGgGGG...',
    '.....DD.....',
    '....DDDD....',
    '............',
  ],
  bug: [
    '..k......k..',
    '...k....k...',
    '....kEEk....',
    '....kkkk....',
    '.k.KKKKKK.k.',
    '..KKbKKbKK..',
    '.kKKbKKbKKk.',
    '..KKKKKKKK..',
    '.kKKbKKbKKk.',
    '..KKKKKKKK..',
    '...KKKKKK...',
    '............',
  ],
};

function toURL(rows: readonly string[]): string {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const g = c.getContext('2d');
  if (!g) return '';
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    g.fillStyle = PAL[ch] || '#f0f';
    g.fillRect(x, y, 1, 1);
  }));
  return c.toDataURL();
}

export const ICON_URL: Partial<Record<IconName, string>> = {};

export function installIcons(): void {
  let css = '';
  for (const [k, rows] of Object.entries(ICONS) as [IconName, string[]][]) {
    ICON_URL[k] = toURL(rows);
    css += `.ic-${k}{background-image:url(${ICON_URL[k]})}`;
  }
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}
