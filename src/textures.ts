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

/**
 * Земля в пастельной гамме Minecraft Dungeons (wiki/style-terrain.md): почти ровная заливка, зерно ±3,
 * несколько крупных мягких пятен — без пиксельного шума, который рябит и выдаёт повтор тайла.
 * Цвета подобраны по скриншотам так, чтобы на экране (солнце + небо + ACES) вышло как там.
 */
const GRASS_BASE = '#6d994e', GRASS_LIGHT = '#7ba558', GRASS_DARK = '#608b46';
const DIRT_BASE = '#9a6942', DIRT_DARK = '#8a5c39';
const PATH_BASE = '#c99153', PATH_PRINT = '#d6a466';
/** Мир: двор (скриншот 10) — калибровка по пикселям, wiki/style-world.md */
const HAY_BASE = '#cda652', HAY_BAND = '#c25a26', HAY_RIM = '#dcbd6c';
const YARD_BASE = '#c39552', YARD_DASH = '#a7794a', WALL_STONE = '#a1a8b0';
/** Мир: скалы, вода, мост (скриншоты 11, 12) */
/** Мир: холмы (скриншоты 13, 15) — крона: тень, середина, свет, блик; сухая трава */
const TREE = ['#4c6e2a', '#6a8c37', '#90b04e', '#a8c860'], DRY = ['#cdb862', '#c2ad58', '#d8c472'];
/** Мир: портал (скриншот 14) */
const PORTAL_GOLD = '#efb64a', PORTAL_LIGHT = '#ffe9a0', PORTAL_STONE = '#4c5155', PORTAL_INLAY = '#d9a640', PORTAL_FLOOR = '#b3a693';
const CLIFF = '#9aa2ab', CLIFF_DARK = '#7b8996', BRIDGE_WOOD = '#c49458', BRIDGE_POST = '#8d6639', RIVER = '#2f586c', FALLS = '#1f88ab';
const CRATE_WOOD = '#9a6a4c', CRATE_BAND = '#46414a', CRATE_PAINT = '#e2a936', CHEST_WOOD = '#8f5b35', CART_WOOD = '#a2694a';
/** Камень: булыжник, кирпич, сланцевый кирпич руин, плиты, мох */
const STONE_BASE = '#88929d', BRICK_BASE = '#86919c', SLATE_BASE = '#6a8592', TILE_BASE = '#a0a2a2', MOSS = '#6f9a4c';
const DIRT = [DIRT_BASE, DIRT_BASE, DIRT_DARK];

/** Смешать два цвета #rrggbb: t = 0 — a, 1 — b; результат тоже #rrggbb */
function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return '#' + [0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0')).join('');
}
/** Мягкая заливка: ровный цвет с зерном ±grain и пятна — круги, к краю сходящие на нет (с переносом через край тайла) */
function softFill(g: Ctx, s: number, r: Rand, base: string, grain: number, blobs: readonly { col: string; n: number; rad: [number, number]; k: number }[]): void {
  const cells: string[] = [];
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) cells.push(base);
  for (const b of blobs) for (let i = 0; i < b.n; i++) {
    const cx = r() * s, cy = r() * s, rad = b.rad[0] + r() * (b.rad[1] - b.rad[0]);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = Math.min(Math.abs(x + 0.5 - cx), s - Math.abs(x + 0.5 - cx)), dy = Math.min(Math.abs(y + 0.5 - cy), s - Math.abs(y + 0.5 - cy));
      const t = 1 - Math.hypot(dx, dy) / rad;
      if (t > 0) cells[y * s + x] = mix(cells[y * s + x], b.col, Math.min(1, t * 1.6) * b.k);
    }
  }
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(cells[y * s + x], r, grain));
}
/** Мягкие пятна поверх уже нарисованного (мох на камне): смешивание с тем, что на холсте */
function overlayBlobs(g: Ctx, s: number, r: Rand, col: string, n: number, rad: [number, number], k: number, yBias = 0): void {
  const img = g.getImageData(0, 0, s, s), d = img.data, c = hexToRgb(col);
  for (let i = 0; i < n; i++) {
    const cx = r() * s, cy = Math.pow(r(), 1 + yBias) * s, rr = rad[0] + r() * (rad[1] - rad[0]);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = Math.min(Math.abs(x + 0.5 - cx), s - Math.abs(x + 0.5 - cx)), dy = Math.abs(y + 0.5 - cy);
      const t = Math.min(1, (1 - Math.hypot(dx, dy) / rr) * 1.8) * k;
      if (t <= 0) continue;
      const o = (y * s + x) * 4;
      for (let j = 0; j < 3; j++) d[o + j] = d[o + j] + (c[j] - d[o + j]) * t;
    }
  }
  g.putImageData(img, 0, 0);
}
/**
 * Мягкая кладка: у каждого кирпича свой тон (±vary к белому / чёрному), верхний ряд кирпича чуть светлее,
 * шов — тот же цвет, темнее на 12 %: кладка читается, но не рябит (Minecraft Dungeons, wiki/style-terrain.md).
 */
function softBricks(g: Ctx, s: number, r: Rand, base: string, cellW: number, rows: number, vary = 0.08, seam = 0.12): void {
  const h = s / rows, mortar = mix(base, '#000000', seam);
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? cellW / 2 : 0;
    for (let bx = -1; bx * cellW + off < s; bx++) {
      const t = (r() - 0.5) * 2;
      const col = t > 0 ? mix(base, '#ffffff', t * vary) : mix(base, '#000000', -t * vary);
      const x0 = bx * cellW + off;
      for (let y = row * h; y < (row + 1) * h; y++) for (let x = Math.max(0, x0); x < Math.min(s, x0 + cellW); x++) {
        const edge = y === row * h || x === x0;
        px(g, x, y, edge ? jitter(mortar, r, 2) : jitter(y === row * h + 1 ? mix(col, '#ffffff', 0.05) : col, r, 2));
      }
    }
  }
}
/** Булыжник: светлая основа и скруглённые камни, сверху-слева чуть светлее, снизу-справа шов чуть темнее */
function softCobble(g: Ctx, s: number, r: Rand, base: string, n = 11, size: [number, number] = [2.2, 1.8], grout = 0.1): void {
  softFill(g, s, r, mix(base, '#000000', grout), 2, []);
  for (let i = 0; i < n; i++) {
    const cx = r() * s, cy = r() * s, w = size[0] + r() * size[0] * 0.7, h = size[1] + r() * size[1] * 0.75;
    const t = (r() - 0.5) * 2, col = t > 0 ? mix(base, '#ffffff', t * 0.08) : mix(base, '#000000', -t * 0.06);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx0 = x + 0.5 - cx, dy0 = y + 0.5 - cy;
      const dx = Math.abs(dx0) > s / 2 ? dx0 - Math.sign(dx0) * s : dx0, dy = Math.abs(dy0) > s / 2 ? dy0 - Math.sign(dy0) * s : dy0;
      const e = (dx / w) ** 2 + (dy / h) ** 2;
      if (e > 1) continue;
      px(g, x, y, jitter(e > 0.55 && (dx > 0 || dy > 0) ? mix(col, '#000000', 0.05) : e > 0.5 ? mix(col, '#ffffff', 0.06) : col, r, 2));
    }
  }
}
/** Листва: «листочки» 2 × 2 из пяти тонов, сверху светлее; holes — дырки по краю (вырезная листва) */
function softLeaves(g: Ctx, s: number, r: Rand, tones: readonly [string, string, string, string], holes: boolean, berries = false): void {
  for (let cy = 0; cy < s; cy += 2) for (let cx = 0; cx < s; cx += 2) {
    const up = 1 - cy / s; // сверху больше светлых
    const v = r() + up * 0.25;
    const col = v < 0.22 ? tones[0] : v < 0.62 ? tones[1] : v < 1.0 ? tones[2] : tones[3];
    for (let y = cy; y < cy + 2; y++) for (let x = cx; x < cx + 2; x++) {
      if (holes) {
        const edge = Math.min(x, y, s - 1 - x, s - 1 - y);
        if (r() < (edge === 0 ? 0.45 : edge === 1 ? 0.22 : 0.05)) continue;
      }
      px(g, x, y, jitter(col, r, 3));
    }
  }
  if (berries) for (let i = 0; i < 7; i++) { const x = (r() * s) | 0, y = (r() * s) | 0; px(g, x, y, '#d8344f'); px(g, x + 1, y, '#f0607a'); }
}
/** Тона листвы, откалиброваны по дереву на скриншоте 4 (wiki/style-terrain.md): тень, середина, свет, блик */
const LEAF: [string, string, string, string] = ['#486e37', '#6b8a42', '#839f52', '#9cb063'];
const BUSH: [string, string, string, string] = ['#466a39', '#627f43', '#76914f', '#8ca25b'];

export interface Textures {
  grassTop: THREE.Texture; grassSide: THREE.Texture; dirt: THREE.Texture; farm: THREE.Texture;
  path: THREE.Texture; stone: THREE.Texture; mossy: THREE.Texture; logSide: THREE.Texture;
  logTop: THREE.Texture; leaves: THREE.Texture; bushLeaves: THREE.Texture; planks: THREE.Texture;
  roof: THREE.Texture; berry: THREE.Texture; awning: THREE.Texture; sign: THREE.Texture; tallGrass: THREE.Texture; flowers: THREE.Texture[];
  face: THREE.Texture; skin: THREE.Texture; hair: THREE.Texture; shirt: THREE.Texture;
  overalls: THREE.Texture; straw: THREE.Texture; square: THREE.Texture; glow: THREE.Texture;
  /** Текстуры блоков уровня (палитра — src/level/palette.ts) */
  gravel: THREE.Texture; sand: THREE.Texture; cobble: THREE.Texture; stoneBricks: THREE.Texture;
  stoneBricksMossy: THREE.Texture; stoneBricksCracked: THREE.Texture; stoneBricksOld: THREE.Texture; stoneBricksOldMossy: THREE.Texture; tiles: THREE.Texture;
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
  // декор (src/level/decor.ts)
  chain: THREE.Texture; cobweb: THREE.Texture; banner: THREE.Texture; bone: THREE.Texture; candle: THREE.Texture;
  mushroomRed: THREE.Texture; mushroomGlow: THREE.Texture; mushroomStem: THREE.Texture; lanternGlass: THREE.Texture; roots: THREE.Texture;
  // трава поверх блоков: бахрома по краю уступа и мелкие пучки (mesher.ts)
  grassFringe: THREE.Texture; grassTuft: THREE.Texture; flowerTuft: THREE.Texture;
  // мир (скриншоты 10–15, wiki/style-world.md): двор
  yardFloor: THREE.Texture; wallStone: THREE.Texture; crateBand: THREE.Texture; crateBandTop: THREE.Texture;
  chestWood: THREE.Texture; chestTrim: THREE.Texture; cartWood: THREE.Texture;
  // скалы, вода, мост (скриншоты 11, 12); river и waterfall — свои текстуры с повтором, не в атласе
  cliff: THREE.Texture; cliffDark: THREE.Texture; cliffGrassSide: THREE.Texture; foam: THREE.Texture;
  bridgePlank: THREE.Texture; bridgePost: THREE.Texture; river: THREE.Texture; waterfall: THREE.Texture;
  // холмы (скриншоты 13, 15): пышная листва, сухая трава, ромашки
  leavesClump: THREE.Texture; leavesPuff: THREE.Texture; dryGrass: THREE.Texture; daisies: THREE.Texture;
  // портал (скриншот 14)
  portal: THREE.Texture; portalFrame: THREE.Texture; portalTrim: THREE.Texture; portalFloor: THREE.Texture;
  // рваный край между травой и дорожкой (mesher.ts, bleed): 4 варианта маски у каждой
  grassEdge0: THREE.Texture; grassEdge1: THREE.Texture; grassEdge2: THREE.Texture; grassEdge3: THREE.Texture;
  pathEdge0: THREE.Texture; pathEdge1: THREE.Texture; pathEdge2: THREE.Texture; pathEdge3: THREE.Texture;
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
  T.grassTop = canvasTex(16, (g, s, r) => softFill(g, s, r, GRASS_BASE, 3, [
    { col: GRASS_LIGHT, n: 3, rad: [3, 5], k: 0.7 },
    { col: GRASS_DARK, n: 2, rad: [2.5, 4], k: 0.55 },
  ]), 11);
  // бок травяного блока: ровная земля, сверху зубчатая полоса травы 3–6 px (низ полосы чуть темнее)
  T.grassSide = canvasTex(16, (g, s, r) => {
    softFill(g, s, r, DIRT_BASE, 3, [{ col: DIRT_DARK, n: 3, rad: [2, 3.5], k: 0.6 }]);
    for (let x = 0; x < s; x++) {
      const d = 3 + ((r() * 4) | 0);
      for (let y = 0; y < d; y++) px(g, x, y, jitter(y === d - 1 ? GRASS_DARK : GRASS_BASE, r, 3));
    }
  }, 12);
  T.dirt = canvasTex(16, (g, s, r) => softFill(g, s, r, DIRT_BASE, 3, [{ col: DIRT_DARK, n: 3, rad: [2, 3.5], k: 0.6 }, { col: '#a6744b', n: 2, rad: [2, 3], k: 0.5 }]), 13);
  T.farm = canvasTex(16, (g, s, r) => {
    noiseFill(g, s, r, ['#5a3a22', '#4e321d', '#634127'], 6);
    for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x++) {
      px(g, x, y, jitter('#3a2414', r, 5));
      px(g, x, y + 1, jitter('#70482c', r, 6));
    }
  }, 14);
  // дорожка: тёплый оранжевый беж, мягкие светлые «следы» ≈ 0,3 м и тёмные пятна (скриншот 1, wiki/style-terrain.md)
  T.path = canvasTex(16, (g, s, r) => softFill(g, s, r, PATH_BASE, 1, [
    { col: '#bb864b', n: 2, rad: [3, 5], k: 0.45 },
    { col: PATH_PRINT, n: 3, rad: [2, 2.7], k: 0.6 },
  ]), 15);
  // камень: светлый голубовато-серый, как ограда на скриншотах, пятна вместо трещин
  T.stone = canvasTex(16, (g, s, r) => softFill(g, s, r, '#a4abb4', 3, [
    { col: '#b3b9c1', n: 3, rad: [2.5, 4], k: 0.6 },
    { col: '#959ca6', n: 2, rad: [2, 3], k: 0.5 },
  ]), 16);
  T.mossy = canvasTex(16, (g, s, r) => {
    softCobble(g, s, r, STONE_BASE);
    overlayBlobs(g, s, r, MOSS, 5, [2, 3.5], 0.85, 1);
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
  T.leaves = canvasTex(16, (g, s, r) => softLeaves(g, s, r, LEAF, false), 20);
  T.bushLeaves = canvasTex(16, (g, s, r) => softLeaves(g, s, r, BUSH, false), 21);
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
      const col = pick([GRASS_BASE, GRASS_LIGHT, GRASS_DARK, '#8fbf60'], r);
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
    softFill(g, s, r, '#a69d92', 3, [{ col: '#b5ada2', n: 3, rad: [2, 3], k: 0.6 }]);
    for (let i = 0; i < 10; i++) { const x = (r() * s) | 0, y = (r() * s) | 0; px(g, x, y, '#8f877d'); px(g, x + 1, y, '#bdb5aa'); }
  }, 50);
  T.sand = canvasTex(16, (g, s, r) => softFill(g, s, r, '#e4d19b', 3, [{ col: '#eedcaa', n: 3, rad: [2.5, 4], k: 0.6 }, { col: '#d6c18a', n: 2, rad: [2, 3], k: 0.5 }]), 51);
  // ---------- кладка: светлый голубовато-серый камень ограды и руин (скриншоты 1, 3) ----------
  T.cobble = canvasTex(16, (g, s, r) => softCobble(g, s, r, STONE_BASE), 52);
  T.stoneBricks = canvasTex(16, (g, s, r) => softBricks(g, s, r, BRICK_BASE, 8, 4), 53);
  T.stoneBricksMossy = canvasTex(16, (g, s, r) => {
    softBricks(g, s, r, BRICK_BASE, 8, 4);
    overlayBlobs(g, s, r, MOSS, 4, [2, 3.5], 0.85, 1);
  }, 54);
  T.stoneBricksCracked = canvasTex(16, (g, s, r) => {
    softBricks(g, s, r, BRICK_BASE, 8, 4);
    const crack = mix(BRICK_BASE, '#000000', 0.16);
    let x = 3 + ((r() * 10) | 0);
    for (let y = 2; y < s - 2; y++) { px(g, x, y, crack); if (r() < 0.5) x = Math.max(1, Math.min(s - 2, x + (r() < 0.5 ? -1 : 1))); }
  }, 55);
  // руинный: сланцевый, синее и темнее (колонны руин на скриншоте 3)
  T.stoneBricksOld = canvasTex(16, (g, s, r) => softBricks(g, s, r, SLATE_BASE, 8, 4, 0.1, 0.14), 56);
  T.stoneBricksOldMossy = canvasTex(16, (g, s, r) => {
    softBricks(g, s, r, SLATE_BASE, 8, 4, 0.1, 0.14);
    overlayBlobs(g, s, r, MOSS, 4, [2, 3.5], 0.85, 1);
  }, 58);
  // плиты мостовой: крупные, шов сверху-слева светлый, как на полу руин
  T.tiles = canvasTex(16, (g, _s, r) => {
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const t = (r() - 0.5) * 2, col = t > 0 ? mix(TILE_BASE, '#ffffff', t * 0.07) : mix(TILE_BASE, '#000000', -t * 0.06);
      for (let y = ty * 8; y < ty * 8 + 8; y++) for (let x = tx * 8; x < tx * 8 + 8; x++) {
        const lx = x - tx * 8, ly = y - ty * 8;
        const c = lx === 0 || ly === 0 ? mix(col, '#ffffff', 0.12) : lx === 7 || ly === 7 ? mix(col, '#000000', 0.08) : col;
        px(g, x, y, jitter(c, r, 2));
      }
    }
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
  T.berryBush = canvasTex(16, (g, s, r) => softLeaves(g, s, r, BUSH, false, true), 61);
  T.fern = canvasTex(16, (g, s, r) => {
    for (let k = 0; k < 3; k++) {
      let x = 7 + k - 1;
      for (let y = s - 1; y >= 3 + k * 2; y--) {
        px(g, x, y, GRASS_DARK);
        const len = Math.max(1, ((s - y) / 3) | 0);
        for (let d = 1; d <= len; d++) { px(g, x - d, y, jitter(GRASS_BASE, r, 4)); px(g, x + d, y, jitter(GRASS_BASE, r, 4)); }
        if (r() < 0.3) x += k === 0 ? -1 : k === 2 ? 1 : 0;
      }
    }
  }, 62, { alpha: true });
  // тюк сена как на скриншоте 10: ровный жёлтый, по боку две оранжево-красные обвязки, верх со светлой каймой
  T.hay = canvasTex(16, (g, s, r) => {
    softFill(g, s, r, HAY_BASE, 2, [{ col: '#d9b863', n: 3, rad: [2, 3.5], k: 0.5 }, { col: '#b8933f', n: 2, rad: [1.5, 2.5], k: 0.4 }]);
    for (const y0 of [3, 11]) for (let x = 0; x < s; x++) { px(g, x, y0, jitter(HAY_BAND, r, 3)); px(g, x, y0 + 1, jitter(mix(HAY_BAND, '#000000', 0.12), r, 3)); }
  }, 63);
  T.hayTop = canvasTex(16, (g, s, r) => {
    softFill(g, s, r, HAY_BASE, 2, [{ col: '#d9b863', n: 3, rad: [2, 3.5], k: 0.5 }]);
    for (let i = 0; i < s; i++) for (const k of [0, s - 1]) { px(g, i, k, jitter(HAY_RIM, r, 2)); px(g, k, i, jitter(HAY_RIM, r, 2)); }
    for (const x0 of [3, 11]) for (let y = 0; y < s; y++) px(g, x0, y, jitter(HAY_BAND, r, 3));
  }, 64);
  // листва кроны: с дырками по краям, чтобы кубы кроны не читались как кубы
  T.leavesCut = canvasTex(16, (g, s, r) => softLeaves(g, s, r, LEAF, true), 68, { alpha: true });
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
    noiseFill(g, s, r, DIRT, 3);
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
    softBricks(g, s, r, '#7a5d4c', 8, 4, 0.1, 0.25);
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

  // ---------- декор ----------
  // цепь: звенья по 4 пикселя, вырезная — между звеньями пусто
  T.chain = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 6; x < 10; x++) {
      const k = y % 8, edge = x === 6 || x === 9 || k === 0 || k === 5;
      if (k < 6 && edge) px(g, x, y, jitter(x === 6 || k === 0 ? '#5a5650' : '#3a3632', r, 6));
    }
  }, 120, { alpha: true });
  // паутина: лучи из угла и дуги, полупрозрачная белая
  T.cobweb = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const a = Math.atan2(y, x), d = Math.hypot(x, y);
      const ray = Math.abs(Math.sin(a * 5)) < 0.12, arc = Math.abs((d % 4.5) - 2.2) < 0.45 && d < 15;
      if ((ray && d < 15.5) || arc) if (r() < 0.9) px(g, x, y, jitter('#e8ecf0', r, 8));
    }
  }, 121, { alpha: true });
  // знамя: малиновое полотнище с золотой каймой и ягодой
  T.banner = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const border = x < 2 || x > 13;
      const berry = Math.hypot(x - 7.5, y - 8.5) < 3.2;
      const leaf = y >= 3 && y <= 4 && x >= 6 && x <= 9;
      px(g, x, y, jitter(border ? '#e0b048' : leaf ? '#5aa03a' : berry ? ((x + y) % 2 ? '#f0507a' : '#ff7098') : '#a8243c', r, 6));
    }
  }, 122);
  T.bone = canvasTex(16, (g, s, r) => noiseFill(g, s, r, ['#ece4cc', '#e2d8bc', '#f4eedc', '#d8ccae'], 5), 123);
  T.candle = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(y < 2 ? '#fff4d0' : pick(['#f2e2b0', '#e8d49a', '#f6e8c0'], r), r, 5));
  }, 124);
  // шляпки грибов: красная в белый горох (style/ref-02) и светящаяся жёлтая (style/ref-01)
  const dots = (base: string, dot: string) => (g: Ctx, s: number, r: Rand) => {
    noiseFill(g, s, r, [base], 6);
    for (const [cx, cy] of [[3, 3], [11, 2], [7, 8], [13, 11], [2, 12], [9, 14]]) { px(g, cx, cy, jitter(dot, r, 4)); px(g, cx + 1, cy, jitter(dot, r, 4)); px(g, cx, cy + 1, jitter(dot, r, 4)); }
  };
  T.mushroomRed = canvasTex(16, dots('#d8262c', '#f6f0e8'), 125);
  T.mushroomGlow = canvasTex(16, dots('#ffc83a', '#fff4b0'), 126);
  T.mushroomStem = canvasTex(16, (g, s, r) => noiseFill(g, s, r, ['#efe6d2', '#e4d8c0', '#f6efe0'], 4), 127);
  T.lanternGlass = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(Math.hypot(x - 7.5, y - 9) < 4 ? '#fff2b0' : '#ffc860', r, 8));
  }, 128);
  // бахрома: верхние 8 рядов — свисающая зубчатая трава (верхние 2 — сплошь), низ пустой; 16 px на метр, как у блока
  T.grassFringe = canvasTex(16, (g, s, r) => {
    for (let x = 0; x < s; x++) {
      const len = 2 + Math.floor(r() * 7) - (x % 3 === 1 ? 1 : 0);
      for (let y = 0; y < len; y++) px(g, x, y, jitter(y === len - 1 ? GRASS_DARK : GRASS_BASE, r, 3));
    }
  }, 130, { alpha: true });
  // пучки: травинки растут от низа картинки, высота 2–8 px; квадрат пучка берёт окно этой полосы
  const blades = (g: Ctx, s: number, r: Rand, flowers: readonly string[]) => {
    for (let x = 0; x < s; x++) {
      if (r() < 0.25) continue;
      const h = 2 + Math.floor(r() * 7);
      for (let y = s - h; y < s; y++) px(g, x, y, jitter(y < s - h + 2 ? GRASS_LIGHT : GRASS_BASE, r, 3));
      if (flowers.length && r() < 0.3) px(g, x, s - h - 1, jitter(pick(flowers, r), r, 6));
    }
  };
  T.grassTuft = canvasTex(16, (g, s, r) => blades(g, s, r, []), 131, { alpha: true });
  T.flowerTuft = canvasTex(16, (g, s, r) => blades(g, s, r, ['#f6f2ea', '#ffd84a', '#f070a8', '#8ac4ff']), 132, { alpha: true });
  /**
   * Рваный край: материал «заходит» на соседний блок от нижнего края картинки (это общая грань) на 0–8 px.
   * Глубина гуляет плавно, ступеньками по 2 px, к концам тайла сходится к 3 px — края соседних тайлов стыкуются;
   * крайний пиксель — полутон с соседним материалом (мягкость), плюс 1–2 островка поодаль.
   */
  const edgeMask = (base: string, other: string, light: string) => (g: Ctx, s: number, r: Rand) => {
    const p1 = r() * 6.3, p2 = r() * 6.3, amp = 1.6 + r() * 1.6;
    const depth: number[] = [];
    for (let x = 0; x < s; x += 2) {
      const w = Math.min(1, Math.min(x, s - 2 - x) / 4);
      const d = 3 + w * (amp * Math.sin(x * 0.45 + p1) + 1.3 * Math.sin(x * 1.1 + p2) + (r() - 0.5) * 1.4);
      const k = Math.max(0, Math.min(8, Math.round(d)));
      depth.push(k, k + (r() < 0.3 ? (r() < 0.5 ? -1 : 1) : 0));
    }
    const put = (x: number, y: number, edge: boolean) => {
      const c = edge ? mix(base, other, 0.45) : r() < 0.08 ? light : base;
      px(g, x, y, jitter(c, r, 3));
    };
    for (let x = 0; x < s; x++) for (let k = 0; k < depth[x]; k++) put(x, s - 1 - k, k === depth[x] - 1);
    for (let i = 0, n = 1 + (r() < 0.6 ? 1 : 0); i < n; i++) {
      const bx = 2 + ((r() * 11) | 0), by = s - 1 - (depth[bx] + 2 + ((r() * 3) | 0)), bw = 2 + ((r() * 2) | 0), bh = 1 + ((r() * 2) | 0);
      for (let y = by - bh + 1; y <= by; y++) for (let x = bx; x < bx + bw; x++) if (y >= 0) put(x, y, y === by - bh + 1 || x === bx);
    }
  };
  [T.grassEdge0, T.grassEdge1, T.grassEdge2, T.grassEdge3] = [0, 1, 2, 3].map((i) => canvasTex(16, edgeMask(GRASS_BASE, PATH_BASE, GRASS_LIGHT), 140 + i, { alpha: true }));
  [T.pathEdge0, T.pathEdge1, T.pathEdge2, T.pathEdge3] = [0, 1, 2, 3].map((i) => canvasTex(16, edgeMask(PATH_BASE, GRASS_BASE, PATH_PRINT), 150 + i, { alpha: true }));
  // корни: тёмная кора с продольными бороздами
  T.roots = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(x % 5 === 0 ? '#2e2016' : pick(['#5a3e28', '#4e3522', '#664830'], r), r, 6));
  }, 129);

  // ---------- мир: двор (скриншот 10) ----------
  // пол двора: утоптанная земля с тёмными штрихами «ёлочкой»
  T.yardFloor = canvasTex(16, (g, s, r) => {
    softFill(g, s, r, YARD_BASE, 2, [{ col: '#cda265', n: 2, rad: [3, 5], k: 0.5 }]);
    for (let row = 0; row < 4; row++) for (let x0 = (row % 2) * 3 - 3; x0 < s; x0 += 6) {
      const len = 3 + ((r() * 2) | 0);
      for (let k = 0; k < len; k++) { const x = x0 + k, y = row * 4 + 1 + (k > 1 ? 1 : 0); if (x >= 0 && x < s) px(g, x, y, jitter(YARD_DASH, r, 3)); }
    }
  }, 160);
  // камень ограды: крупные скруглённые камни, едва заметные
  T.wallStone = canvasTex(16, (g, s, r) => softCobble(g, s, r, WALL_STONE, 5, [3.6, 3.0], 0.06), 161);
  // ящики склада: дощатые, тёмные железные полосы, пятна жёлтой краски
  const crate = (top: boolean) => (g: Ctx, s: number, r: Rand) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(x % 4 === 3 ? mix(CRATE_WOOD, '#000000', 0.14) : CRATE_WOOD, r, 3));
    overlayBlobs(g, s, r, CRATE_PAINT, 3, [1.4, 2.4], 0.9);
    for (let i = 0; i < s; i++) for (const k of [0, 1, s - 2, s - 1]) { px(g, i, k, jitter(CRATE_BAND, r, 2)); if (top) px(g, k, i, jitter(CRATE_BAND, r, 2)); }
    if (!top) for (let y = 0; y < s; y++) for (const k of [6, 7]) px(g, k, y, jitter(CRATE_BAND, r, 2));
  };
  T.crateBand = canvasTex(16, crate(false), 162);
  T.crateBandTop = canvasTex(16, crate(true), 163);
  T.chestWood = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(y % 5 === 4 ? mix(CHEST_WOOD, '#000000', 0.15) : CHEST_WOOD, r, 3));
  }, 164);
  T.chestTrim = canvasTex(16, (g, s, r) => softFill(g, s, r, '#e2b247', 2, [{ col: '#f2cd6a', n: 2, rad: [2, 3], k: 0.7 }]), 165);
  T.cartWood = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(y % 4 === 3 ? mix(CART_WOOD, '#000000', 0.16) : CART_WOOD, r, 3));
  }, 166);

  // ---------- мир: скалы, вода, мост (скриншоты 11, 12) ----------
  // скала: ровный светлый камень с едва заметными вертикальными пластами
  const strata = (base: string, r: Rand, g: Ctx, s: number) => {
    softFill(g, s, r, base, 2, [{ col: mix(base, '#ffffff', 0.08), n: 2, rad: [3, 5], k: 0.6 }]);
    let x = 0;
    while (x < s) { const w = 2 + ((r() * 4) | 0); if (r() < 0.55) for (let y = 0; y < s; y++) px(g, x, y, jitter(mix(base, '#000000', 0.06), r, 2)); x += w; }
    const yb = 4 + ((r() * 8) | 0);
    for (let xx = 0; xx < s; xx++) px(g, xx, yb, jitter(mix(base, '#ffffff', 0.07), r, 2));
  };
  T.cliff = canvasTex(16, (g, s, r) => strata(CLIFF, r, g, s), 170);
  T.cliffDark = canvasTex(16, (g, s, r) => strata(CLIFF_DARK, r, g, s), 171);
  T.cliffGrassSide = canvasTex(16, (g, s, r) => {
    strata(CLIFF, r, g, s);
    for (let x = 0; x < s; x++) {
      const d = 3 + ((r() * 4) | 0);
      for (let y = 0; y < d; y++) px(g, x, y, jitter(y === d - 1 ? GRASS_DARK : GRASS_BASE, r, 3));
    }
  }, 172);
  T.foam = canvasTex(16, (g, s, r) => softFill(g, s, r, '#e9edf0', 2, [{ col: '#cfd8df', n: 3, rad: [2, 4], k: 0.7 }, { col: '#ffffff', n: 2, rad: [2, 3], k: 0.6 }]), 173);
  // настил моста: светлые доски по 4 px со щелями; столб — темнее, продольные волокна
  T.bridgePlank = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) {
      const tone = mix(BRIDGE_WOOD, ['#ffffff', '#000000'][(y >> 2) % 2], 0.04 + r() * 0.04);
      for (let x = 0; x < s; x++) px(g, x, y, jitter(y % 4 === 3 ? mix(BRIDGE_WOOD, '#000000', 0.18) : tone, r, 3));
    }
    for (let i = 0; i < 4; i++) { const x = (r() * s) | 0, y = (i * 4 + 1) | 0; px(g, x, y, mix(BRIDGE_WOOD, '#000000', 0.12)); }
  }, 174);
  T.bridgePost = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, jitter(x % 5 === 2 ? mix(BRIDGE_POST, '#000000', 0.1) : BRIDGE_POST, r, 3));
  }, 175);
  // вода реки: глубокая бирюза, светлые штрихи вдоль течения (их ещё гонит шейдер)
  T.river = canvasTex(16, (g, s, r) => {
    softFill(g, s, r, RIVER, 2, [{ col: mix(RIVER, '#ffffff', 0.12), n: 3, rad: [2, 4], k: 0.6 }, { col: mix(RIVER, '#000000', 0.1), n: 2, rad: [2, 3], k: 0.5 }]);
  }, 176);
  T.river.wrapS = T.river.wrapT = THREE.RepeatWrapping;
  // водопад: вертикальные струи разной яркости, белые разрывы; текстура бежит вниз (mesher.update)
  T.waterfall = canvasTex(16, (g, s, r) => {
    for (let x = 0; x < s; x++) {
      const base = pick([FALLS, FALLS, FALLS, mix(FALLS, '#ffffff', 0.12), mix(FALLS, '#000000', 0.08)], r);
      for (let y = 0; y < s; y++) px(g, x, y, jitter(base, r, 2));
      // редкие светлые струи — длинные, без пёстрых точек
      if (r() < 0.35) { const y0 = (r() * s) | 0, len = 5 + ((r() * 6) | 0); for (let y = y0; y < y0 + len; y++) px(g, x, y % s, jitter(mix(FALLS, '#ffffff', 0.45), r, 3)); }
    }
  }, 177);
  T.waterfall.wrapS = T.waterfall.wrapT = THREE.RepeatWrapping;

  // ---------- мир: холмы (скриншоты 13, 15) ----------
  /** Гроздь листьев: лопастный круг, светлый верх, тёмный низ-право — листва «кустится», а не рябит */
  const clump = (g: Ctx, r: Rand, cx: number, cy: number, rad: number) => {
    for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
      const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx), d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const edge = rad * (0.82 + 0.18 * Math.cos(a * 5));
      if (d > edge || x < 0 || y < 0 || x > 15 || y > 15) continue;
      const lit = (cx - x) + (cy - y) > rad * 0.3 ? TREE[2] : (x - cx) + (y - cy) > rad * 0.7 ? TREE[0] : TREE[1];
      px(g, x, y, jitter(d > edge - 0.9 ? mix(lit, TREE[0], 0.4) : lit, r, 3));
    }
  };
  T.leavesClump = canvasTex(16, (g, s, r) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const edge = Math.min(x, y, s - 1 - x, s - 1 - y);
      if (r() < (edge === 0 ? 0.5 : 0.04)) continue;
      px(g, x, y, jitter(TREE[0], r, 3));
    }
    for (let i = 0; i < 9; i++) clump(g, r, 1 + r() * 14, 1 + r() * 14, 2 + r() * 1.2);
    for (let i = 0; i < 3; i++) clump(g, r, 2 + r() * 12, 1 + r() * 6, 1.6);
    for (let i = 0; i < 2; i++) { const x = 2 + ((r() * 12) | 0), y = 2 + ((r() * 12) | 0); px(g, x, y, TREE[3]); }
  }, 180, { alpha: true });
  // «шапки» над гранями: редкие грозди с пустотой по краю — силуэт кроны пушится за пределы куба
  T.leavesPuff = canvasTex(16, (g, _s, r) => {
    for (let i = 0; i < 7; i++) { const a = r() * Math.PI * 2, d = 3.5 + r() * 3.5; clump(g, r, 8 + Math.cos(a) * d, 8 + Math.sin(a) * d, 1.6 + r() * 1.2); }
  }, 181, { alpha: true });
  // сухая трава: высокие светло-жёлтые стебли (поле на скриншоте 15)
  T.dryGrass = canvasTex(16, (g, s, r) => {
    for (let i = 0; i < 10; i++) {
      let x = 1 + ((r() * 14) | 0); const h = 6 + ((r() * 9) | 0), col = pick(DRY, r);
      for (let k = 0; k < h; k++) { px(g, x, s - 1 - k, jitter(k > h - 3 ? mix(col, '#ffffff', 0.15) : col, r, 3)); if (r() < 0.2) x = Math.max(0, Math.min(15, x + (r() < 0.5 ? -1 : 1))); }
    }
  }, 182, { alpha: true });
  // ромашки: низкие стебельки и белые цветки с жёлтой серединкой
  T.daisies = canvasTex(16, (g, s, r) => {
    for (let i = 0; i < 6; i++) {
      const x = 1 + ((r() * 13) | 0), h = 3 + ((r() * 5) | 0);
      for (let k = 0; k < h; k++) px(g, x, s - 1 - k, jitter(GRASS_DARK, r, 3));
      const y = s - 1 - h;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) px(g, x + dx, y + dy, jitter('#f4f2ea', r, 3));
      px(g, x, y, '#f2c94a');
    }
  }, 183, { alpha: true });

  // ---------- мир: портал (скриншот 14) ----------
  // сияние: золото с мягкими вертикальными струями и светлыми пятнами (анимацию добавляет шейдер слоя portal)
  T.portal = canvasTex(16, (g, s, r) => {
    for (let x = 0; x < s; x++) {
      const k = 0.5 + 0.5 * Math.sin(x * 0.9 + r() * 0.6);
      for (let y = 0; y < s; y++) px(g, x, y, jitter(mix(PORTAL_GOLD, PORTAL_LIGHT, k * 0.45 + (y / s) * 0.35), r, 3));
    }
    overlayBlobs(g, s, r, PORTAL_LIGHT, 3, [2, 3.5], 0.6);
  }, 190);
  // рама: тёмный камень, по краю фаска светлее, в середине — квадратный узор
  T.portalFrame = canvasTex(16, (g, s, r) => {
    softFill(g, s, r, PORTAL_STONE, 2, [{ col: mix(PORTAL_STONE, '#ffffff', 0.08), n: 2, rad: [3, 5], k: 0.5 }]);
    for (let i = 0; i < s; i++) for (const k of [0, s - 1]) { px(g, i, k, mix(PORTAL_STONE, '#ffffff', 0.12)); px(g, k, i, mix(PORTAL_STONE, '#000000', 0.15)); }
    for (let i = 4; i < 12; i++) for (const k of [4, 11]) { px(g, i, k, mix(PORTAL_STONE, '#000000', 0.08)); px(g, k, i, mix(PORTAL_STONE, '#000000', 0.08)); }
  }, 191);
  // перемычка: тот же камень с золотой инкрустацией-меандром
  T.portalTrim = canvasTex(16, (g, s, r) => {
    softFill(g, s, r, PORTAL_STONE, 2, []);
    for (let x = 0; x < s; x++) { px(g, x, 2, PORTAL_INLAY); px(g, x, 13, PORTAL_INLAY); }
    for (let x = 0; x < s; x += 4) for (let y = 5; y <= 10; y++) px(g, x + (y < 8 ? 0 : 2), y, PORTAL_INLAY);
    for (let x = 0; x < s; x += 4) { px(g, x + 1, 5, PORTAL_INLAY); px(g, x + 3, 10, PORTAL_INLAY); }
  }, 192);
  // пол у портала: светлые тёплые плиты, на него заходит трава (natural)
  T.portalFloor = canvasTex(16, (g, _s, r) => {
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const t = (r() - 0.5) * 2, col = t > 0 ? mix(PORTAL_FLOOR, '#ffffff', t * 0.06) : mix(PORTAL_FLOOR, '#000000', -t * 0.05);
      for (let y = ty * 8; y < ty * 8 + 8; y++) for (let x = tx * 8; x < tx * 8 + 8; x++) {
        const lx = x - tx * 8, ly = y - ty * 8;
        px(g, x, y, jitter(lx === 0 || ly === 0 ? mix(col, '#ffffff', 0.1) : lx === 7 || ly === 7 ? mix(col, '#000000', 0.07) : col, r, 2));
      }
    }
  }, 193);

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
