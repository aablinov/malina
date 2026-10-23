import * as THREE from 'three';

export type Rand = () => number;
type Ctx = CanvasRenderingContext2D;
type Painter = (g: Ctx, size: number, r: Rand) => void;

export function rng(seed = 1): Rand {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbStr(r: number, g: number, b: number): string {
  return `rgb(${Math.max(0, Math.min(255, r | 0))},${Math.max(0, Math.min(255, g | 0))},${Math.max(0, Math.min(255, b | 0))})`;
}
function jitter(hex: string, r: Rand, amt = 10): string {
  const [a, b, c] = hexToRgb(hex);
  const d = (r() - 0.5) * 2 * amt;
  return rgbStr(a + d, b + d, c + d);
}
const pick = <T>(arr: readonly T[], r: Rand): T => arr[Math.floor(r() * arr.length)];

function ctx2d(c: HTMLCanvasElement): Ctx {
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D недоступен');
  return g;
}

function canvasTex(size: number, paint: Painter, seed = 1, { alpha = false } = {}): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = ctx2d(c);
  if (!alpha) { g.fillStyle = '#000'; g.fillRect(0, 0, size, size); }
  paint(g, size, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (alpha) { t.generateMipmaps = false; t.minFilter = THREE.NearestFilter; }
  return t;
}
function px(g: Ctx, x: number, y: number, col: string): void { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
function noiseFill(g: Ctx, s: number, r: Rand, pal: readonly string[], amt = 8): void {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(pick(pal, r), r, amt));
}

const GRASS = ['#6dab43', '#5f9c39', '#79b84f', '#548f31', '#67a63f'];
const DIRT = ['#8b5e3c', '#7a5134', '#966844', '#6b452c'];

export interface Textures {
  grassTop: THREE.Texture; grassSide: THREE.Texture; dirt: THREE.Texture; farm: THREE.Texture;
  path: THREE.Texture; stone: THREE.Texture; mossy: THREE.Texture; logSide: THREE.Texture;
  logTop: THREE.Texture; leaves: THREE.Texture; bushLeaves: THREE.Texture; planks: THREE.Texture;
  roof: THREE.Texture; berry: THREE.Texture; awning: THREE.Texture; sign: THREE.Texture; tallGrass: THREE.Texture; flowers: THREE.Texture[];
  face: THREE.Texture; skin: THREE.Texture; hair: THREE.Texture; shirt: THREE.Texture;
  overalls: THREE.Texture; straw: THREE.Texture; square: THREE.Texture; glow: THREE.Texture;
  /** Текстуры блоков уровня (палитра — src/level/palette.ts) */
  gravel: THREE.Texture; sand: THREE.Texture; cobble: THREE.Texture; stoneBricks: THREE.Texture;
  stoneBricksMossy: THREE.Texture; stoneBricksCracked: THREE.Texture; stoneBricksOld: THREE.Texture; tiles: THREE.Texture;
  planksDark: THREE.Texture; roofDark: THREE.Texture; crate: THREE.Texture; berryBush: THREE.Texture; fern: THREE.Texture;
  hay: THREE.Texture; hayTop: THREE.Texture; ash: THREE.Texture; leavesCut: THREE.Texture; acid: THREE.Texture; hole: THREE.Texture;
  flowerRed: THREE.Texture; flowerBlue: THREE.Texture; flowerWhite: THREE.Texture; flowerYellow: THREE.Texture;
  /** Служебные блоки плейграунда: серая сетка 1 м (два тона, разметка каждые 5 м) и клетчатые стены */
  devLight: THREE.Texture; devDark: THREE.Texture; devLightLine: THREE.Texture; devDarkLine: THREE.Texture;
  devLightCorner: THREE.Texture; devDarkCorner: THREE.Texture; devWall: THREE.Texture; devCover: THREE.Texture;
  /** Дом: штукатурка, кирпич, бетон, окно, ржавые перила; мебель */
  plasterTeal: THREE.Texture; plasterWhite: THREE.Texture; plasterRust: THREE.Texture; brickBrown: THREE.Texture;
  concrete: THREE.Texture; window: THREE.Texture; rustMetal: THREE.Texture;
  fabricRed: THREE.Texture; blanket: THREE.Texture; pillow: THREE.Texture; rug: THREE.Texture; lampShade: THREE.Texture;
  ironDark: THREE.Texture; cabinet: THREE.Texture; bookshelf: THREE.Texture; counterTop: THREE.Texture;
  stoveTop: THREE.Texture; fridge: THREE.Texture; fridgeTop: THREE.Texture;
  /** Вода: 16 × 16, двигается смещением UV */
  water: THREE.Texture;
  /** Огонь: 3 кадра по 16 × 16 друг над другом */
  fire: THREE.Texture;
}

/** Текстура по имени — для атласа блоков */
export function textureByName(T: Textures, name: string): THREE.Texture {
  const t = (T as unknown as Record<string, THREE.Texture | undefined>)[name];
  if (!t) throw new Error(`Нет текстуры «${name}»`);
  return t;
}

export function makeTextures(): Textures {
  const T = {} as Textures;
  T.grassTop = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, GRASS, 8);
    for (let i = 0; i < 10; i++) px(g, (r() * s) | 0, (r() * s) | 0, '#86c45a');
  }, 11);
  T.grassSide = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, DIRT, 8);
    for (let x = 0; x < s; x++) {
      const d = 3 + ((r() * 3) | 0);
      for (let y = 0; y < d; y++) px(g, x, y, jitter(pick(GRASS, r), r, 8));
    }
  }, 12);
  T.dirt = canvasTex(16, (g, s, r) => noiseFill(g, s, r, DIRT, 8), 13);
  T.farm = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#5a3a22', '#4e321d', '#634127'], 6);
    for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x++) {
      px(g, x, y, jitter('#3a2414', r, 5));
      px(g, x, y + 1, jitter('#70482c', r, 6));
    }
  }, 14);
  T.path = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#8a6a48', '#7b5d3e', '#9a7a55', '#7a7470', '#857560', '#6f655c'], 8);
  }, 15);
  T.stone = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#7d7d7d', '#717171', '#888888', '#666666'], 6);
    for (let i = 0; i < 5; i++) {
      let x = (r() * s) | 0, y = (r() * s) | 0;
      for (let k = 0; k < 4; k++) { px(g, x, y, '#555'); x += (r() * 3 - 1) | 0; y += 1; }
    }
  }, 16);
  T.mossy = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#7d7d7d', '#717171', '#888888', '#666666'], 6);
    for (let i = 0; i < 70; i++) px(g, (r() * s) | 0, (r() * s) | 0, jitter(pick(['#4f7d33', '#5d8f3a', '#3f6a2a'], r), r, 8));
  }, 17);
  T.logSide = canvasTex(16, (g, s, r) => {
    for (let x = 0; x < s; x++) {
      const base = pick(['#6b4a2b', '#5a3d22', '#77543a', '#4f351e'], r);
      for (let y = 0; y < s; y++) px(g, x, y, jitter(base, r, 6));
    }
  }, 18);
  T.logTop = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const col = d > 6.5 ? '#5a3d22' : (Math.floor(d) % 2 ? '#a07a4c' : '#b38a58');
      px(g, x, y, jitter(col, r, 5));
    }
  }, 19);
  T.leaves = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#3f7d2c', '#356b25', '#4b8f35', '#2c5a1e', '#457f2f'], 10);
    for (let i = 0; i < 18; i++) px(g, (r() * s) | 0, (r() * s) | 0, '#1f4415');
  }, 20);
  T.bushLeaves = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#3e8a33', '#4c9b3a', '#367a2c', '#58a845'], 10);
    for (let i = 0; i < 14; i++) px(g, (r() * s) | 0, (r() * s) | 0, '#285e20');
  }, 21);
  T.planks = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) {
      const board = Math.floor(y / 4);
      const base = ['#a7824f', '#9c7746', '#b08b57', '#97723f'][board % 4];
      for (let x = 0; x < s; x++) px(g, x, y, jitter(base, r, 6));
    }
    for (let y = 3; y < s; y += 4) for (let x = 0; x < s; x++) px(g, x, y, '#6e5230');
    for (let b = 0; b < 4; b++) { const x = (r() * s) | 0; for (let y = b * 4; y < b * 4 + 3; y++) px(g, x, y, '#6e5230'); }
  }, 22);
  T.roof = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(y % 4 === 3 ? '#4a2a22' : pick(['#8c3b2e', '#7e3428', '#97443a'], r), r, 6));
  }, 23);
  T.awning = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(Math.floor(x / 4) % 2 ? '#f2ece0' : '#c4284f', r, 6));
  }, 25);
  T.sign = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 40;
    const g = ctx2d(c);
    g.fillStyle = '#4a321c'; g.fillRect(0, 0, 128, 40);
    g.fillStyle = '#6b4a2b'; g.fillRect(3, 3, 122, 34);
    g.fillStyle = '#ffd25a'; g.font = 'bold 22px Rubik, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ОРУЖИЕ', 64, 21);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  T.berry = canvasTex(8, (g, s) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, ((x + y) % 2) ? '#ffffff' : '#c8c8c8');
  }, 24);

  // Трава и цветы (с прозрачностью)
  T.tallGrass = canvasTex(16, (g, s, r) => {
    for (let i = 0; i < 9; i++) {
      let x = 1 + ((r() * 14) | 0); const h = 6 + ((r() * 9) | 0);
      const col = pick(['#6fb048', '#5b9b38', '#82c25a', '#4f8a30'], r);
      for (let k = 0; k < h; k++) { px(g, x, s - 1 - k, jitter(col, r, 6)); if (r() < 0.2) x += r() < 0.5 ? -1 : 1; x = Math.max(0, Math.min(15, x)); }
    }
  }, 30, { alpha: true });
  const flower = (head: string, seed: number) => canvasTex(16, (g, s, r) => {
    for (let k = 0; k < 9; k++) px(g, 7 + (k > 5 ? 1 : 0), s - 1 - k, '#4f8a30');
    px(g, 6, 11, '#5f9c39'); px(g, 5, 10, '#5f9c39'); px(g, 9, 12, '#5f9c39'); px(g, 10, 11, '#5f9c39');
    const cx = 8, cy = 5;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [-2, 0], [2, 0], [0, 2]]) px(g, cx + dx, cy + dy, jitter(head, r, 12));
    px(g, cx, cy, '#ffd84a');
  }, seed, { alpha: true });
  T.flowers = [flower('#e2384d', 31), flower('#5aa7ff', 32), flower('#f4f4f4', 33), flower('#ffcf3a', 34)];

  T.face = canvasTex(8, (g) => {
    g.fillStyle = '#e8b48c'; g.fillRect(0, 0, 8, 8);
    g.fillStyle = '#6b3d1f'; g.fillRect(0, 0, 8, 2);
    g.fillStyle = '#fff'; g.fillRect(1, 3, 2, 1); g.fillRect(5, 3, 2, 1);
    g.fillStyle = '#2f5bd0'; g.fillRect(2, 3, 1, 1); g.fillRect(5, 3, 1, 1);
    g.fillStyle = '#c98d6b'; g.fillRect(3, 4, 2, 1);
    g.fillStyle = '#7a3b2a'; g.fillRect(2, 6, 4, 1);
  }, 40);
  T.skin = canvasTex(8, (g, s, r) => noiseFill(g, s, r, ['#e8b48c', '#e0aa82'], 4), 41);
  T.hair = canvasTex(8, (g, s, r) => {
    noiseFill(g, s, r, ['#e8b48c', '#e0aa82'], 4);
    g.fillStyle = '#6b3d1f'; g.fillRect(0, 0, 8, 4);
  }, 42);
  T.shirt = canvasTex(8, (g) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(g, x, y, ((x >> 1) + (y >> 1)) % 2 ? '#c4284f' : '#e04a6a');
  }, 43);
  T.overalls = canvasTex(8, (g, s, r) => noiseFill(g, s, r, ['#3b5fa8', '#34559a', '#4167b3'], 5), 44);
  T.straw = canvasTex(8, (g, _s, r) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(g, x, y, jitter((x + y) % 3 ? '#e8c35a' : '#cfa43f', r, 8));
  }, 45);

  // ---------- блоки уровня ----------
  T.gravel = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#8a8580', '#7a756f', '#96908a', '#6e6a66', '#a39c93'], 7);
    for (let i = 0; i < 14; i++) { const x = (r() * s) | 0, y = (r() * s) | 0; px(g, x, y, '#5a5652'); px(g, x + 1, y, '#b3ada4'); }
  }, 50);
  T.sand = canvasTex(16, (g, s, r) => noiseFill(g, s, r, ['#dccb8f', '#d2c184', '#e3d39b', '#c9b87b'], 6), 51);
  const stoneyCells = (g: Ctx, s: number, r: Rand, pal: readonly string[], mortar: string, cell: number, rows: number) => {
    noiseFill(g, s, r, pal, 5);
    for (let row = 0; row < rows; row++) {
      const y0 = (row * s) / rows, off = row % 2 ? cell / 2 : 0;
      for (let x = 0; x < s; x++) px(g, x, y0 | 0, jitter(mortar, r, 4));
      for (let x = off; x <= s; x += cell) for (let y = y0; y < y0 + s / rows; y++) px(g, x % s, y | 0, jitter(mortar, r, 4));
    }
  };
  T.cobble = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#8d8d8d', '#7f7f7f', '#999999', '#737373'], 6);
    // булыжники: случайные пятна со светлым верхом и тёмным низом
    for (let i = 0; i < 9; i++) {
      const cx = (r() * s) | 0, cy = (r() * s) | 0, w = 3 + ((r() * 3) | 0), h = 2 + ((r() * 3) | 0);
      const base = pick(['#8a8a8a', '#9a9a9a', '#7a7a7a', '#a0a0a0'], r);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(g, (cx + x) % s, (cy + y) % s, jitter(y === 0 ? '#b0b0b0' : y === h - 1 ? '#5c5c5c' : base, r, 5));
    }
  }, 52);
  T.stoneBricks = canvasTex(16, (g, s, r) => stoneyCells(g, s, r, ['#8a8a8a', '#808080', '#949494', '#777777'], '#5a5a5a', 8, 4), 53);
  T.stoneBricksMossy = canvasTex(16, (g, s, r) => {
    stoneyCells(g, s, r, ['#8a8a8a', '#808080', '#949494', '#777777'], '#5a5a5a', 8, 4);
    for (let i = 0; i < 50; i++) px(g, (r() * s) | 0, (r() * s) | 0, jitter(pick(['#4f7d33', '#5d8f3a', '#3f6a2a'], r), r, 8));
  }, 54);
  T.stoneBricksCracked = canvasTex(16, (g, s, r) => {
    stoneyCells(g, s, r, ['#8a8a8a', '#808080', '#949494', '#777777'], '#5a5a5a', 8, 4);
    let x = (r() * s) | 0;
    for (let y = 0; y < s; y++) { px(g, x, y, '#4a4a4a'); if (r() < 0.6) x = Math.max(0, Math.min(s - 1, x + (r() < 0.5 ? -1 : 1))); }
  }, 55);
  T.stoneBricksOld = canvasTex(16, (g, s, r) => stoneyCells(g, s, r, ['#8b7f93', '#7d7287', '#978ba0', '#6f6478'], '#4c4454', 8, 4), 56);
  T.tiles = canvasTex(16, (g, s, r) => {
    stoneyCells(g, s, r, ['#9a948c', '#8f8982', '#a39d95', '#857f78'], '#5e5952', 8, 2);
    for (let i = 0; i < 10; i++) px(g, (r() * s) | 0, (r() * s) | 0, '#b5afa6');
  }, 57);
  T.planksDark = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) {
      const base = ['#5e4228', '#56391f', '#66482c', '#4f3519'][Math.floor(y / 4) % 4];
      for (let x = 0; x < s; x++) px(g, x, y, jitter(base, r, 6));
    }
    for (let y = 3; y < s; y += 4) for (let x = 0; x < s; x++) px(g, x, y, '#2f1e0f');
    for (let b = 0; b < 4; b++) { const x = (r() * s) | 0; for (let y = b * 4; y < b * 4 + 3; y++) px(g, x, y, '#2f1e0f'); }
  }, 58);
  T.roofDark = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(y % 4 === 3 ? '#1e2430' : pick(['#3b4658', '#34404f', '#43506a'], r), r, 6));
  }, 59);
  T.crate = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(['#a7824f', '#9c7746', '#b08b57'][Math.floor(y / 5) % 3], r, 6));
    for (let i = 0; i < s; i++) { for (const k of [0, 1, s - 2, s - 1]) { px(g, i, k, '#6e5230'); px(g, k, i, '#6e5230'); } px(g, i, i, '#6e5230'); px(g, i, s - 1 - i, '#7a5a34'); }
  }, 60);
  T.berryBush = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#3e8a33', '#4c9b3a', '#367a2c', '#58a845'], 10);
    for (let i = 0; i < 14; i++) px(g, (r() * s) | 0, (r() * s) | 0, '#285e20');
    for (let i = 0; i < 7; i++) { const x = (r() * s) | 0, y = (r() * s) | 0; px(g, x, y, '#d0123f'); px(g, x + 1, y, '#ff4a6a'); }
  }, 61);
  T.fern = canvasTex(16, (g, s, r) => {
    for (let k = 0; k < 3; k++) {
      let x = 7 + k - 1;
      for (let y = s - 1; y >= 3 + k * 2; y--) {
        px(g, x, y, '#3f8a2f');
        const len = Math.max(1, ((s - y) / 3) | 0);
        for (let d = 1; d <= len; d++) { px(g, x - d, y, jitter('#5aa342', r, 8)); px(g, x + d, y, jitter('#5aa342', r, 8)); }
        if (r() < 0.3) x += k === 0 ? -1 : k === 2 ? 1 : 0;
      }
    }
  }, 62, { alpha: true });
  T.hay = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(y % 3 === 2 ? '#b8912e' : pick(['#e8c35a', '#dbb34a', '#f0cf6c'], r), r, 8));
  }, 63);
  T.hayTop = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter((x + y) % 4 === 0 ? '#b8912e' : pick(['#e8c35a', '#dbb34a', '#f0cf6c'], r), r, 8));
  }, 64);
  // листва кроны: с дырками по краям, чтобы кубы кроны не читались как кубы
  T.leavesCut = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const edge = Math.min(x, y, s - 1 - x, s - 1 - y);
      const hole = edge === 0 ? 0.45 : edge === 1 ? 0.25 : 0.08;
      if (r() < hole) continue;
      px(g, x, y, jitter(pick(['#3f7d2c', '#356b25', '#4b8f35', '#2c5a1e', '#457f2f'], r), r, 10));
    }
    for (let i = 0; i < 12; i++) px(g, 2 + ((r() * 12) | 0), 2 + ((r() * 12) | 0), '#1f4415');
  }, 68, { alpha: true });
  T.ash = canvasTex(16, (g, s, r) => noiseFill(g, s, r, ['#3a3835', '#2e2c2a', '#454240'], 6), 65);
  [T.flowerRed, T.flowerBlue, T.flowerWhite, T.flowerYellow] = T.flowers;
  T.water = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#2a9fd8', '#2496d0', '#33ade2', '#1f8cc6'], 6);
    for (let i = 0; i < 4; i++) {
      const y = (r() * s) | 0;
      for (let x = (r() * 6) | 0, n = 4 + ((r() * 6) | 0); n > 0; n--, x++) px(g, x % s, y, jitter('#7fd4f4', r, 8));
    }
  }, 66);
  T.water.wrapS = T.water.wrapT = THREE.RepeatWrapping;
  T.acid = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#5fc43a', '#55b434', '#6fd244', '#4aa62c'], 6);
    for (let i = 0; i < 5; i++) { const x = (r() * s) | 0, y = (r() * s) | 0; px(g, x, y, '#c8ff8a'); px(g, x + 1, y, '#a8f070'); }
  }, 69);
  T.acid.wrapS = T.acid.wrapT = THREE.RepeatWrapping;
  T.hole = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, DIRT, 8);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 5.2) px(g, x, y, jitter(d < 3.6 ? '#120a06' : '#3a2414', r, 6));
    }
  }, 70);
  T.fire = (() => {
    const c = document.createElement('canvas'); c.width = 16; c.height = 48;
    const g = ctx2d(c);
    const r = rng(67);
    for (let f = 0; f < 3; f++) {
      const y0 = f * 16;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        // языки пламени: внизу широко и ярко, кверху узко
        const h = 1 - y / 16; // 1 внизу картинки — но канвас рисуется сверху вниз, низ блока = y=15
        const w = 0.25 + (1 - h) * 0.3 + Math.sin(x * 1.7 + f * 2.1) * 0.08;
        const dx = Math.abs(x - 7.5) / 8;
        if (dx > w + (r() - 0.5) * 0.2 || h > 0.95 - r() * 0.3) continue;
        const col = dx < w * 0.35 && h < 0.5 ? '#fff0a0' : dx < w * 0.7 ? '#ffb020' : '#ff5a10';
        px(g, x, y0 + y, jitter(col, r, 10));
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1 / 3);
    return t;
  })();

  // служебная сетка плейграунда: ровный тон, линия разметки — 2 px у края (−X: слева; с поворотом — у любого)
  const devTile = (tone: string, line: 'none' | 'edge' | 'corner', seed: number) => canvasTex(16, (g, s) => {
    g.fillStyle = tone; g.fillRect(0, 0, s, s);
    g.fillStyle = '#5f6268';
    if (line !== 'none') g.fillRect(0, 0, 2, s);
    if (line === 'corner') g.fillRect(0, 0, s, 2);
  }, seed);
  T.devLight = devTile('#9c9fa5', 'none', 80); T.devDark = devTile('#8b8e94', 'none', 81);
  T.devLightLine = devTile('#9c9fa5', 'edge', 82); T.devDarkLine = devTile('#8b8e94', 'edge', 83);
  T.devLightCorner = devTile('#9c9fa5', 'corner', 84); T.devDarkCorner = devTile('#8b8e94', 'corner', 85);
  const devChecker = (a: string, b: string, seed: number) => canvasTex(16, (g) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? b : a; g.fillRect(x * 8, y * 8, 8, 8); }
  }, seed);
  T.devWall = devChecker('#b9ab90', '#a7987c', 86);
  T.devCover = devChecker('#8e9fb0', '#7d8ea0', 87);

  // ---------- дом ----------
  /** Пятна: случайные кляксы из соседних пикселей поверх фона */
  const blots = (g: Ctx, s: number, r: Rand, pal: readonly string[], n: number, len: number) => {
    for (let i = 0; i < n; i++) {
      let x = (r() * s) | 0, y = (r() * s) | 0;
      const col = pick(pal, r);
      for (let k = 0; k < len; k++) {
        px(g, (x + s) % s, (y + s) % s, jitter(col, r, 6));
        if (r() < 0.5) x += r() < 0.5 ? -1 : 1; else y += r() < 0.5 ? -1 : 1;
      }
    }
  };
  // штукатурка: вертикальные полоски «вагонки» и облупленные пятна
  T.plasterTeal = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(x % 4 === 3 ? '#4fb194' : pick(['#62c9a8', '#5cc2a1', '#68cfae'], r), r, 5));
    blots(g, s, r, ['#2f8d78', '#348f7c', '#28806c'], 4, 9);
  }, 90);
  T.plasterWhite = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter((x + (y >> 2)) % 4 === 0 && y % 4 === 0 ? '#bdb5a6' : pick(['#e6e0d3', '#ddd6c8', '#ece7dc'], r), r, 5));
    blots(g, s, r, ['#c8692c', '#a44a22', '#8a6a52', '#d58a40'], 5, 6);
  }, 91);
  T.plasterRust = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#e0782a', '#ea8a34', '#cf6522', '#f29b3e'], 8);
    blots(g, s, r, ['#f6d8a8', '#e8e0d0', '#a8441a'], 5, 6);
  }, 92);
  T.brickBrown = canvasTex(16, (g, s, r) => {
    stoneyCells(g, s, r, ['#7a5d4c', '#6a5040', '#86685a', '#5e4638'], '#3e302a', 8, 4);
    blots(g, s, r, ['#4a3a30', '#9a7c68'], 4, 4);
  }, 93);
  T.concrete = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#8d847b', '#857c73', '#958c82', '#7c746c'], 5);
    for (let i = 0; i < 10; i++) px(g, (r() * s) | 0, (r() * s) | 0, '#6a635c');
  }, 94);
  // окно: тёмная рама и импост, светлое стекло с диагональными бликами
  T.window = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const frame = x < 2 || y < 2 || x >= s - 2 || y >= s - 2 || x === 7 || x === 8;
      const d = (x + y) % 9;
      px(g, x, y, jitter(frame ? '#2b2421' : d < 2 ? '#f2f6f8' : pick(['#b9c8d0', '#aebec8', '#c4d2d8'], r), r, 4));
    }
  }, 95);
  T.rustMetal = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#b8521e', '#c8622a', '#a34818', '#d07034'], 8);
    blots(g, s, r, ['#7a3412', '#e08a48'], 4, 4);
  }, 96);
  // мебель
  T.fabricRed = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter((x + y) % 2 ? '#8a3a36' : '#9a4440', r, 5));
  }, 97);
  T.blanket = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(((x >> 2) + (y >> 2)) % 2 ? '#3a6aa4' : '#4a7cb8', r, 5));
  }, 98);
  T.pillow = canvasTex(16, (g, s, r) => noiseFill(g, s, r, ['#f0ede6', '#e6e2da', '#f6f4ee'], 4), 99);
  T.rug = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const e = Math.min(x, y, s - 1 - x, s - 1 - y);
      const c = e === 0 ? '#5a2018' : e === 2 ? '#e0b860' : (Math.abs(x - 7.5) + Math.abs(y - 7.5)) % 5 < 1 ? '#e0b860' : '#a23a2a';
      px(g, x, y, jitter(c, r, 5));
    }
  }, 100);
  T.lampShade = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(y % 5 === 0 ? '#e0c080' : '#f6e2aa', r, 4));
  }, 101);
  T.ironDark = canvasTex(16, (g, s, r) => noiseFill(g, s, r, ['#2e2c2a', '#383532', '#26241f'], 4), 102);
  T.cabinet = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const line = x === 0 || x === s - 1 || x === 7 || y === 0 || y === s - 1;
      px(g, x, y, jitter(line ? '#3c2614' : pick(['#7a5232', '#70492b', '#83593a'], r), r, 5));
    }
    px(g, 5, 7, '#d8c070'); px(g, 5, 8, '#d8c070'); px(g, 10, 7, '#d8c070'); px(g, 10, 8, '#d8c070');
  }, 103);
  T.bookshelf = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter('#6a4a2c', r, 5));
    for (const y0 of [1, 9]) {
      let x = 1;
      while (x < s - 1) {
        const w = 1 + ((r() * 2) | 0), h = 5 + ((r() * 2) | 0), col = pick(['#a83a32', '#3a6a9a', '#4a8a3a', '#d0a040', '#7a4a8a', '#e0dccc'], r);
        for (let k = 0; k < w && x < s - 1; k++, x++) for (let y = y0 + 6 - h; y < y0 + 6; y++) px(g, x, y, jitter(col, r, 8));
      }
      for (let x2 = 0; x2 < s; x2++) px(g, x2, y0 + 6, '#3c2614');
    }
  }, 104);
  T.counterTop = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#d8d4cc', '#cfcac0', '#e0dcd4'], 5);
    for (let i = 0; i < 8; i++) px(g, (r() * s) | 0, (r() * s) | 0, '#9a958c');
  }, 105);
  T.stoveTop = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#2e2e30', '#363638'], 3);
    for (const [cx, cy] of [[4, 4], [11, 4], [4, 11], [11, 11]]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      const d = Math.hypot(x, y);
      if (d > 1.4 && d < 2.6) px(g, cx + x, cy + y, jitter('#8a8a8e', r, 6));
    }
  }, 106);
  T.fridge = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(x === 0 || x === s - 1 ? '#b8bcc0' : '#eef0f2', r, 3));
    for (let y = 3; y < 13; y++) px(g, 12, y, '#8a9096');
  }, 107);
  T.fridgeTop = canvasTex(16, (g, s, r) => noiseFill(g, s, r, ['#dfe2e5', '#e8eaec'], 3), 108);

  T.square = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = ctx2d(c);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(5, 5, 54, 54);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  T.glow = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = ctx2d(c);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  return T;
}

/** Пиксельная текстура 16 × 16 из одного цвета с шумом — для снаряжения героя */
export function pixelTex(base: string, amt = 8, seed = 1): THREE.CanvasTexture {
  return canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(base, r, amt));
  }, seed);
}

/**
 * Шахматная клетка: cells × cells клеток по px пикселей, два тона.
 * line — цвет рамки по краю тайла (разметка каждые N метров), если задан.
 */
export function checkerTex(a: string, b: string, cells: number, px0 = 16, line?: string): THREE.CanvasTexture {
  const size = cells * px0;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = ctx2d(c);
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    g.fillStyle = (x + y) % 2 ? b : a;
    g.fillRect(x * px0, y * px0, px0, px0);
  }
  if (line) {
    g.fillStyle = line;
    g.fillRect(0, 0, size, 2);
    g.fillRect(0, 0, 2, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
