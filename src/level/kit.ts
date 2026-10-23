import type { Level } from './level.ts';

/**
 * Готовые сборки уровня в духе Minecraft Dungeons (wiki/style-world.md): ступенчатые ограды, стога, скалы, реки,
 * мосты, холмы, порталы. Каждая — функция «поставь в эту точку», детерминированная от координат, их можно сочетать.
 * Ими собрана зона «мир» плейграунда (src/level/world-zone.ts); комнатам и генератору этажа они тоже подходят.
 */

export function hash2(x: number, z: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Плавный шум 0..1 с шагом cell (для рваных краёв и высот) */
export function noise2(x: number, z: number, cell: number, seed = 0): number {
  const gx = Math.floor(x / cell), gz = Math.floor(z / cell), fx = x / cell - gx, fz = z / cell - gz;
  const sm = (t: number) => t * t * (3 - 2 * t), u = sm(fx), v = sm(fz);
  const a = hash2(gx, gz, seed), b = hash2(gx + 1, gz, seed), c = hash2(gx, gz + 1, seed), d = hash2(gx + 1, gz + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Ступенчатая ограда, как каменные стены двора на скриншоте 10: высота гуляет блоками от hMin до hMax,
 * перепады сглажены полублоками сверху. Линия от (x0, z0) до (x1, z1) — вдоль X или Z. y — низ (верх пола под ней).
 */
export function steppedWall(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, hMin: number, hMax: number, block = 'wall_stone'): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  const dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const x = x0 + dx * i, z = z0 + dz * i;
    const h = hMin + Math.floor(noise2(i, x * 0.37 + z, 3, 7) * (hMax - hMin + 1));
    for (let k = 0; k < h; k++) L.set(x, y + k, z, block);
    if (hash2(x, z, 8) < 0.35) L.set(x, y + h, z, `${block}_slab`);
  }
}

/** Пол площадки из блока floor в прямоугольнике (включительно) на уровне y */
export function floorRect(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, floor: string): void {
  L.fill(x0, y, z0, x1, y, z1, floor);
}

/** Стог: пирамидка тюков сена по маске рядов снизу вверх ('#' — тюк), как в углу двора на скриншоте 10 */
export function hayStack(L: Level, x: number, y: number, z: number, layers: string[][]): void {
  layers.forEach((rows, k) => rows.forEach((row, dz) => [...row].forEach((c, dx) => { if (c === '#') L.set(x + dx, y + k, z + dz, 'hay'); })));
}

/**
 * Скальный массив (скриншоты 11, 12): прямоугольник x0..x1 × z0..z1, низ на y, высота гуляет по шуму от hMin до hMax.
 * Столбцы целиком светлые или тёмные — читаются вертикальные пласты; верх — скала с травой (бахрома свисает с края).
 */
export function cliffMass(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, hMin: number, hMax: number, seed = 0, dark = 0.25): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    const h = hMin + Math.floor(noise2(x, z, 4, seed) * (hMax - hMin + 0.999));
    const body = hash2(x, z, seed + 1) < dark ? 'cliff_dark' : 'cliff';
    for (let k = 0; k < h - 1; k++) L.set(x, y + k, z, body);
    L.set(x, y + h - 1, z, 'cliff_grass');
  }
}

/** Скальные ступени к реке (скриншот 11, справа): высота падает от hFar к 1 по направлению (dx, dz), шаг ступени — step клеток */
export function cliffSteps(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, hFar: number, dirX: number, step = 2, seed = 0): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    const along = dirX > 0 ? Math.max(x0, x1) - x : x - Math.min(x0, x1);
    const h = Math.max(1, Math.min(hFar, 1 + Math.floor((along + noise2(x, z, 3, seed) * 1.8) / step)));
    for (let k = 0; k < h - 1; k++) L.set(x, y + k, z, hash2(x, z, seed + 2) < 0.2 ? 'cliff_dark' : 'cliff');
    L.set(x, y + h - 1, z, 'cliff_grass');
  }
}

/**
 * Русло реки: в прямоугольнике убирает землю от yGround вниз до воды, ставит реку с течением rot на yWater и песок под ней.
 * Берега — то, что вокруг (трава с бахромой свешивается к воде).
 */
export function riverBed(L: Level, x0: number, z0: number, x1: number, z1: number, yGround: number, yWater: number, rot: number): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    for (let y = yWater + 1; y <= yGround + 4; y++) L.set(x, y, z, 'air');
    L.set(x, yWater, z, 'river', rot);
    L.set(x, yWater - 1, z, 'sand');
  }
}

/** Водопад: стена струй x0..x1 на линии z от yBottom до yTop (включительно) */
export function waterfall(L: Level, x0: number, x1: number, z: number, yBottom: number, yTop: number): void {
  for (let x = x0; x <= x1; x++) for (let y = yBottom; y <= yTop; y++) L.set(x, y, z, 'waterfall');
}

/**
 * Мост вдоль X (скриншот 11): настил x0..x1 × z0..z1 на уровне y (верх — y + 1), брусья по бокам на z0 − 1 и z1 + 1,
 * столбы на брусьях по концам
 */
export function bridgeX(L: Level, x0: number, x1: number, z0: number, z1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) L.set(x, y, z, 'bridge_deck', 1);
    L.set(x, y, z0 - 1, 'bridge_beam', 0);
    L.set(x, y, z1 + 1, 'bridge_beam', 0);
  }
  for (const x of [x0, x1]) for (const z of [z0 - 1, z1 + 1]) L.set(x, y + 1, z, 'bridge_post');
}

/** Лестница из ступеней block_stairs: поднимается по направлению (dx, dz) от (x, y, z) на steps блоков, ширина width по перпендикуляру; под ступенями — block */
export function stairway(L: Level, x: number, y: number, z: number, dx: number, dz: number, steps: number, width: number, block: string): void {
  // ступени поднимаются к +X при rot 0, rot 1 — к +Z, 2 — к −X, 3 — к −Z
  const rot = dx > 0 ? 0 : dz > 0 ? 1 : dx < 0 ? 2 : 3;
  for (let k = 0; k < steps; k++) for (let w = 0; w < width; w++) {
    const cx = x + dx * k + (dz ? w : 0), cz = z + dz * k + (dx ? w : 0);
    for (let j = 0; j < k; j++) L.set(cx, y + j, cz, block);
    L.set(cx, y + k, cz, `${block}_stairs`, rot);
  }
}

/**
 * Рельеф карты — две разные сущности (скриншоты 13–17):
 *  1. Ландшафт (`landscape`, `hill`) — проходим везде и с любой стороны. Огромные плиты в несколько слоёв, но каждый слой —
 *     полметра (полный блок + полублок травы), перепад между соседними клетками не больше слоя: шаг героя 0,5 м, поэтому
 *     на любую площадку поднимаются откуда угодно, без лестниц. Мобы стоят на любых уровнях.
 *  2. Скала (`rockOutcrop`, `cliffMass`) — непроходимый каменный массив с травой сверху и отвесными боками; в неё
 *     встраивают то, к чему ведёт один вход (портал, пещера). Скалы ставят поверх ландшафта — по краям, у дороги, у реки.
 */
export interface HillOpts {
  /** Доля верхушек с сухой травой и с ромашками */
  dry?: number; daisies?: number;
  seed?: number;
}

/** Поверхность в колонке: y верха самого высокого блока (куда ставить дерево, декор) */
export function surfaceAt(L: Level, x: number, z: number): number {
  const t = L.topAt(x, z);
  return t === null ? 0 : t + 1;
}

/** Сгладить сетку уровней: одиночные выступы опускаются, ямки засыпаются — площадки широкие, края длинные */
function settle(heights: Int8Array, w: number, d: number, passes = 3): void {
  const H = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= d ? 0 : heights[z * w + x]);
  // каждый уровень отдельно: маска «высота ≥ t» сглаживается большинством в окне 5 × 5 — контур плиты плавный,
  // заливы и зубцы в 2–3 клетки исчезают; высота собирается заново из сглаженных масок (уровни не перекрещиваются)
  let maxH = 0;
  for (const v of heights) maxH = Math.max(maxH, v);
  const out = new Int8Array(w * d);
  for (let t = 1; t <= maxH; t++) {
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      let c = 0, n = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ni = i + di, nj = j + dj;
        n++;
        if (ni >= 0 && nj >= 0 && ni < w && nj < d && heights[nj * w + ni] >= t) c++;
      }
      if (c * 2 > n) out[j * w + i]++;
    }
  }
  heights.set(out);
  // большинство в окне 3 × 3: ямки и выступы в 1–2 клетки исчезают, контур плиты сглаживается, крупная форма остаётся
  for (let p = 0; p < 3; p++) {
    const src = heights.slice();
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const cnt = new Map<number, number>();
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = i + di, nj = j + dj, v = ni < 0 || nj < 0 || ni >= w || nj >= d ? 0 : src[nj * w + ni];
        cnt.set(v, (cnt.get(v) ?? 0) + 1);
      }
      // своё значение встречается в окне 3 раза и реже — клетка узкая (ямка, выступ, зубец), берём самое частое
      const own = src[j * w + i];
      if ((cnt.get(own) ?? 0) > 3) continue;
      let best = own, bc = 0;
      for (const [v, c] of cnt) if (c > bc) { best = v; bc = c; }
      heights[j * w + i] = best;
    }
  }
  // мелкие области одной высоты (впадинки, островки меньше minArea клеток) заливаем самой частой высотой вокруг
  const minArea = 14;
  for (let p = 0; p < 2; p++) {
    const label = new Int32Array(w * d).fill(-1);
    for (let start = 0; start < w * d; start++) {
      if (label[start] >= 0) continue;
      const hv = heights[start], cells = [start], around = new Map<number, number>();
      label[start] = start;
      for (let q = 0; q < cells.length; q++) {
        const i = cells[q] % w, j = (cells[q] / w) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= d) { around.set(0, (around.get(0) ?? 0) + 1); continue; }
          const k = nj * w + ni;
          if (heights[k] === hv) { if (label[k] < 0) { label[k] = start; cells.push(k); } }
          else around.set(heights[k], (around.get(heights[k]) ?? 0) + 1);
        }
      }
      if (cells.length >= minArea || !around.size) continue;
      let best = hv, bc = 0;
      for (const [v, c] of around) if (c > bc) { best = v; bc = c; }
      for (const k of cells) heights[k] = best;
    }
  }
  for (let p = 0; p < passes; p++) for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const h = H(i, j), nb = [H(i + 1, j), H(i - 1, j), H(i, j + 1), H(i, j - 1)];
    if (nb.filter((v) => v >= h).length < 2 && h > 0) heights[j * w + i] = h - 1;
    else if (nb.filter((v) => v > h).length >= 3) heights[j * w + i] = h + 1;
  }
}

/** Подъём ландшафта в точке: эллипс полуосей rx × rz, высота h слоёв, к краю спадает плавно */
export interface Bump { x: number; z: number; rx: number; rz: number; h: number }

export interface LandscapeOpts extends HillOpts {
  /** Сколько слоёв по 0,5 м даёт шум (3–4 — холмистая местность MCD) */
  layers?: number;
  /** Масштаб шума, клеток: чем больше, тем шире плиты (24–32) */
  scale?: number;
  /** Клетки, где ландшафт ровный (дорога, двор, русло): к ним высота плавно спадает за fade клеток */
  flat?: (x: number, z: number) => boolean;
  fade?: number;
  bumps?: Bump[];
  /** Доля площади, где бока слоёв — камень (вперемешку с землёй, как на скриншотах) */
  stone?: number;
  /** Потолок: не выше стольких слоёв (по умолчанию без ограничения) */
  max?: number;
}

/**
 * Ландшафт: плавная поверхность нарезана на плиты-слои по 0,5 м. S-кривая делает площадки широкими, контуры —
 * извилистыми (шум с искажением координат), сглаживание убирает мелочь, а ограничение крутизны — перепады больше
 * одного слоя: по ландшафту можно пройти везде. Слой — полный блок травы (чётный) или полублок травы сверху (нечётный).
 */
export function landscape(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, o: LandscapeOpts = {}): void {
  const seed = o.seed ?? 0, scale = o.scale ?? 28, layers = o.layers ?? 4, fade = o.fade ?? 6, stoneK = o.stone ?? 0.3;
  const w = x1 - x0 + 1, d = z1 - z0 + 1;
  // расстояние до ровных клеток (поиск в ширину, 8 соседей)
  const dist = new Float32Array(w * d).fill(1e9);
  const queue: number[] = [];
  if (o.flat) for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (o.flat(x0 + i, z0 + j)) { dist[j * w + i] = 0; queue.push(j * w + i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] % w, j = (queue[q] / w) | 0, dv = dist[queue[q]];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= d) continue;
      const nd = dv + (di && dj ? 1.41 : 1);
      if (nd < dist[nj * w + ni]) { dist[nj * w + ni] = nd; queue.push(nj * w + ni); }
    }
  }
  const heights = new Int8Array(w * d);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const x = x0 + i, z = z0 + j;
    if (dist[j * w + i] === 0) continue;
    // искажение координат — контуры извилистые, как береговая линия
    const wx = x + (noise2(x, z, 20, seed + 3) - 0.5) * 9, wz = z + (noise2(x, z, 20, seed + 4) - 0.5) * 9;
    const n = noise2(wx, wz, scale, seed) * 0.72 + noise2(wx, wz, scale * 0.45, seed + 1) * 0.28;
    // S-кривая: широкие ровные площадки, перепады собраны в короткие склоны
    const k = Math.max(0, Math.min(1, (n - 0.2) / 0.6));
    let hf = (k * 0.35 + (Math.round(k * layers) / layers) * 0.65) * layers;
    for (const b of o.bumps ?? []) {
      const e = ((wx - b.x) / b.rx) ** 2 + ((wz - b.z) / b.rz) ** 2;
      if (e < 1) hf += b.h * (1 - e) ** 0.7;
    }
    const t = Math.min(1, dist[j * w + i] / fade);
    heights[j * w + i] = Math.min(o.max ?? 30, Math.floor(hf * t * t * (3 - 2 * t)));
  }
  settle(heights, w, d, 2);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (dist[j * w + i] === 0) heights[j * w + i] = 0;
  // проходимость: соседние клетки отличаются не больше чем на слой (0,5 м) — понижаем, пока не станет так
  for (let changed = true, guard = 0; changed && guard < 64; guard++) {
    changed = false;
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const h = heights[j * w + i];
      let lo = h;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        lo = Math.min(lo, ni < 0 || nj < 0 || ni >= w || nj >= d ? 0 : heights[nj * w + ni]);
      }
      if (h > lo + 1) { heights[j * w + i] = lo + 1; changed = true; }
    }
  }
  // постройка: n слоёв = n/2 полных блоков и полублок сверху, если n нечётно; в «каменных» местах бока — скала
  const stoneAt = (x: number, z: number) => noise2(x + 40, z - 17, 11, seed + 5) > 1 - stoneK;
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const n = heights[j * w + i];
    if (n <= 0) continue;
    const x = x0 + i, z = z0 + j, full = n >> 1, half = n & 1, rock = stoneAt(x, z);
    for (let k = 0; k < full; k++) {
      const topBlock = k === full - 1 && !half;
      L.set(x, y + k, z, topBlock ? (rock ? 'cliff_grass' : 'grass') : rock ? (hash2(x, z, seed + 2) < 0.22 ? 'cliff_dark' : 'cliff') : 'dirt');
    }
    if (half) {
      if (full > 0) L.set(x, y + full - 1, z, rock ? 'cliff' : 'dirt');
      L.set(x, y + full, z, 'grass_slab');
    }
  }
  // флора по верхушкам
  if (o.dry || o.daisies) for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const n = heights[j * w + i];
    if (n <= 0) continue;
    const x = x0 + i, z = z0 + j, yy = y + (n >> 1) + (n & 1);
    if (n & 1 || !L.isAir(x, yy, z)) continue; // на полублоке трава из креста висела бы
    const r = hash2(x, z, seed + 50), nn = noise2(x, z, 4, seed + 51);
    if (r < (o.dry ?? 0) * 2 * nn) L.set(x, yy, z, 'dry_grass');
    else if (r > 1 - (o.daisies ?? 0)) L.set(x, yy, z, 'daisies');
  }
}

/** Холм — подъём ландшафта в точке: те же проходимые слои по 0,5 м, извилистый контур */
export function hill(L: Level, cx: number, cz: number, rx: number, rz: number, h: number, y: number, o: LandscapeOpts = {}): void {
  const m = 6;
  landscape(L, Math.floor(cx - rx - m), Math.floor(cz - rz - m), Math.ceil(cx + rx + m), Math.ceil(cz + rz + m), y, {
    layers: 0, fade: 3, ...o, bumps: [{ x: cx, z: cz, rx: rx + 2, rz: rz + 2, h: h + 0.6 }],
    flat: (x, z) => ((x - cx) / (rx + m - 1)) ** 2 + ((z - cz) / (rz + m - 1)) ** 2 > 1,
  });
}

/**
 * Скала (скриншоты 11, 12, 14, 17): непроходимый каменный массив с извилистым контуром, отвесными боками из светлых и
 * тёмных пластов и травой сверху. Высота гуляет на блок. Ставится поверх ландшафта; в неё встраивают портал, пещеру.
 */
export function rockOutcrop(L: Level, cx: number, cz: number, rx: number, rz: number, h: number, y: number, seed = 0): void {
  for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) for (let z = Math.floor(cz - rz - 2); z <= Math.ceil(cz + rz + 2); z++) {
    const wx = x + (noise2(x, z, 7, seed + 1) - 0.5) * 4, wz = z + (noise2(x, z, 7, seed + 2) - 0.5) * 4;
    if (((wx - cx) / rx) ** 2 + ((wz - cz) / rz) ** 2 > 1) continue;
    const hh = h + Math.floor(noise2(x, z, 4, seed + 3) * 2.2) - 1;
    const dark = noise2(x, z, 3, seed + 4) > 0.62;
    for (let k = -1; k < hh - 1; k++) L.set(x, y + k, z, dark ? 'cliff_dark' : 'cliff');
    L.set(x, y + hh - 1, z, 'cliff_grass');
    for (let k = hh; k < hh + 3; k++) if (L.nameAt(x, y + k, z) !== 'air') L.set(x, y + k, z, 'air');
  }
}

/** Дерево (скриншот 13): ствол trunk блоков и пышная крона-эллипсоид из leaves_fluffy */
export function tree(L: Level, x: number, y: number, z: number, trunk = 3, r = 2): void {
  for (let k = 0; k < trunk; k++) L.set(x, y + k, z, 'log');
  const cy = y + trunk + r * 0.5;
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) {
    const d = (dx * dx + dz * dz) / (r * r) + (dy * dy) / ((r * 0.8) ** 2) + (hash2(x + dx * 7, z + dz * 5, dy + 60) - 0.5) * 0.45;
    if (d <= 1 && !(dx === 0 && dz === 0 && dy < 0)) L.set(x + dx, Math.round(cy + dy), z + dz, 'leaves_fluffy');
  }
}

/** Крепостная стена с зубцами-ступенями (скриншот 13): вдоль X или Z, высота h, через блок зубец, наверху место под свечи */
export function rampart(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, h: number): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)), dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const x = x0 + dx * i, z = z0 + dz * i;
    for (let k = 0; k < h; k++) L.set(x, y + k, z, 'wall_stone');
    L.set(x, y + h, z, i % 3 === 0 ? 'wall_stone' : 'air');
  }
}

/**
 * Портал в холме (скриншот 14), лицом к +Z: проём ширины w и высоты h с нижним краем на y, рама из тёмного камня,
 * перемычка с инкрустацией, сияние в глубине (2 блока внутрь), боковые стенки проёма, перед ним светлый пол —
 * трава на него заходит рваным краем. (x, z) — левый нижний угол проёма снаружи.
 */
export function portal(L: Level, x: number, y: number, z: number, w = 2, h = 3): void {
  const depth = 1;
  for (let dz = -depth - 1; dz <= 0; dz++) for (let dx = -1; dx <= w; dx++) {
    for (let k = 0; k <= h; k++) {
      const side = dx === -1 || dx === w, back = dz === -depth - 1, top = k === h;
      const cell = side || back ? 'portal_frame' : top ? (dz === 0 ? 'portal_trim' : 'portal_frame') : 'air';
      L.set(x + dx, y + k, z + dz, cell);
    }
    // сверху рамы — дёрн, как на холме вокруг
    L.set(x + dx, y + h + 1, z + dz, 'grass');
  }
  for (let dx = 0; dx < w; dx++) for (let k = 0; k < h; k++) L.set(x + dx, y + k, z - depth, 'portal', 0);
  // перед порталом — площадка с полом из плит, дальше проход вперёд прорубается до уровня земли (выход не перекрыт)
  for (let dz = -depth; dz <= 16; dz++) {
    let blocked = false;
    for (let dx = -2; dx <= w + 1; dx++) for (let k = 0; k <= h + 6; k++) if (dz > 0 && !L.isAir(x + dx, y + k, z + dz)) blocked = true;
    if (dz > 3 && !blocked) break;
    for (let dx = -2; dx <= w + 1; dx++) {
      L.set(x + dx, y - 1, z + dz, dz <= 3 ? 'portal_floor' : 'path');
      if (dz > 0) for (let k = 0; k <= h + 6; k++) L.set(x + dx, y + k, z + dz, 'air');
    }
  }
}
