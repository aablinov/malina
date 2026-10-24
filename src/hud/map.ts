import type { Level } from '../level/level.ts';

/**
 * Карта уровня для HUD (M): вид сверху, клетка — пиксель. Цвет — по верхнему блоку колонны (вода, трава, дорожка,
 * камень, дерево), светлее — выше. Строится один раз; точку героя рисует HUD поверх.
 */

const TONE: [RegExp, [number, number, number]][] = [
  [/water|river|pond/, [74, 140, 196]],
  [/acid/, [120, 200, 80]],
  [/lava|fire/, [220, 110, 40]],
  [/grass|leaves|moss|hedge|flower|tuft/, [112, 158, 78]],
  [/path|dirt|road|sand|gravel|soil/, [196, 168, 118]],
  [/plank|wood|log|crate|fence|table|chair|bed/, [150, 108, 66]],
  [/portal/, [240, 200, 90]],
  [/stone|cobble|brick|rock|wall|tile|slate|basalt/, [140, 138, 132]],
];

export interface LevelMap { canvas: HTMLCanvasElement; minX: number; minZ: number; w: number; h: number }

export function levelMap(level: Level): LevelMap | null {
  const b = level.getBounds();
  if (!b) return null;
  const w = b.maxX - b.minX + 1, h = b.maxZ - b.minZ + 1;
  const top = new Int32Array(w * h).fill(-1e6), id = new Int32Array(w * h);
  level.forEach((x, y, z, i) => {
    const def = level.defOf(i);
    if (!def.collide && !/water|acid/.test(def.name)) return;
    const k = (z - b.minZ) * w + (x - b.minX);
    if (y >= top[k]) { top[k] = y; id[k] = i; }
  });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(w, h);
  const span = Math.max(1, b.maxY - b.minY);
  for (let k = 0; k < w * h; k++) {
    let rgb: [number, number, number] = [40, 34, 30];
    if (top[k] > -1e6) {
      const name = level.defOf(id[k]).name;
      rgb = TONE.find(([re]) => re.test(name))?.[1] ?? [128, 124, 118];
      const lift = 0.75 + 0.45 * ((top[k] - b.minY) / span);
      rgb = rgb.map((v) => Math.min(255, v * lift)) as [number, number, number];
    }
    img.data.set([rgb[0], rgb[1], rgb[2], 255], k * 4);
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, minX: b.minX, minZ: b.minZ, w, h };
}
