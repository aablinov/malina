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
 * Холмы и ландшафт как в Minecraft Dungeons (скриншоты 13, 15–17): не пирамидки, а широкие почти плоские плиты
 * одна над другой с перепадом в 1 блок. Край плиты — длинные прямые и ступенчатые диагонали под 45°.
 * На верхних площадках стоят мобы, поэтому между уровнями есть пандусы из полублоков травы (шаг героя 0,5 м).
 * На перепаде в stoneDrop блоков и больше бок становится скалой под травой (скриншот 17).
 */
export interface HillOpts {
  /** Сторона холма из скалы с травой (обрыв): ±X/±Z */
  stone?: 'x+' | 'x-' | 'z+' | 'z-';
  /** Доля верхушек с сухой травой и с ромашками */
  dry?: number; daisies?: number;
  /** Пандусы: примерная доля клеток края с подъёмом из полублока (0 — без пандусов) */
  ramps?: number;
  /** С какого перепада бок — скала, а не земля (по умолчанию 2) */
  stoneDrop?: number;
  seed?: number;
}

/** Поверхность в колонке: y верха самого высокого блока (куда ставить дерево, декор) */
export function surfaceAt(L: Level, x: number, z: number): number {
  const t = L.topAt(x, z);
  return t === null ? 0 : t + 1;
}

/**
 * Поставить ландшафт по сетке высот heights (уровни над y, 0 — земля) в прямоугольнике x0..x0+w−1 × z0..z0+d−1.
 * Тело — земля, верх — трава; на высоких перепадах — скала; пандусы и флора по опциям.
 */
export function buildHeights(L: Level, x0: number, z0: number, w: number, d: number, y: number, heights: Int8Array, o: HillOpts & { stoneAt?: (x: number, z: number) => boolean } = {}): void {
  const seed = o.seed ?? 0, stoneDrop = o.stoneDrop ?? 2;
  const H = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= d ? 0 : heights[z * w + x]);
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    const h = H(i, j);
    if (h <= 0) continue;
    const x = x0 + i, z = z0 + j;
    const drop = h - Math.min(H(i + 1, j), H(i - 1, j), H(i, j + 1), H(i, j - 1));
    const stone = drop >= stoneDrop || (o.stoneAt?.(x, z) ?? false);
    for (let k = 0; k < h - 1; k++) L.set(x, y + k, z, stone ? (hash2(x, z, seed + 2) < 0.22 ? 'cliff_dark' : 'cliff') : 'dirt');
    L.set(x, y + h - 1, z, stone ? 'cliff_grass' : 'grass');
  }
  // пандусы: на краю в 1 блок полублок травы у подножия — с нижней площадки на верхнюю шагом 0,5
  if (o.ramps !== undefined) {
    const slab = new Uint8Array(w * d);
    const put = (i: number, j: number, di: number, dj: number) => {
      // пандус шириной 2: нижняя клетка и соседняя вдоль края (если там тот же уровень)
      for (const s of [0, 1]) {
        const ei = i + (dj ? s : 0), ej = j + (di ? s : 0);
        if (ei < 0 || ej < 0 || ei >= w || ej >= d || H(ei, ej) !== H(i, j)) continue;
        slab[ej * w + ei] = 1;
      }
    };
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // случайные пандусы для разнообразия
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      const h = H(i, j);
      if (h <= 0 || hash2(x0 + i, z0 + j, seed + 7) > o.ramps) continue;
      for (const [di, dj] of N4) if (H(i + di, j + dj) === h - 1) { put(i + di, j + dj, di, dj); break; }
    }
    // гарантия: каждая площадка достижима с земли — поиск в ширину, недостижимым добавляем пандус на границе
    const eff = (i: number, j: number) => H(i, j) + (i >= 0 && j >= 0 && i < w && j < d && slab[j * w + i] ? 0.5 : 0);
    for (let guard = 0; guard < 400; guard++) {
      const seen = new Uint8Array(w * d), queue: number[] = [];
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) if (H(i, j) === 0 && (i === 0 || j === 0 || i === w - 1 || j === d - 1)) { seen[j * w + i] = 1; queue.push(j * w + i); }
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q] % w, j = (queue[q] / w) | 0;
        for (const [di, dj] of N4) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= d || seen[nj * w + ni]) continue;
          if (Math.abs(eff(ni, nj) - eff(i, j)) > 0.5) continue;
          seen[nj * w + ni] = 1; queue.push(nj * w + ni);
        }
      }
      // первая по хэшу граница «достижимая клетка → недостижимая на уровень выше»
      let best: [number, number, number, number] | null = null, bestH = 2;
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
        if (!seen[j * w + i] || slab[j * w + i]) continue;
        for (const [di, dj] of N4) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= d || seen[nj * w + ni] || H(ni, nj) !== H(i, j) + 1) continue;
          const r = hash2(x0 + i, z0 + j, seed + 9);
          if (r < bestH) { bestH = r; best = [i, j, -di, -dj]; }
        }
      }
      if (!best) break;
      put(best[0], best[1], best[2], best[3]);
    }
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      if (!slab[j * w + i]) continue;
      const x = x0 + i, z = z0 + j, yy = y + H(i, j);
      if (L.isAir(x, yy, z)) L.set(x, yy, z, 'grass_slab');
    }
  }
  // флора по верхушкам
  if (o.dry || o.daisies) for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    if (H(i, j) <= 0) continue;
    const x = x0 + i, z = z0 + j, yy = y + H(i, j);
    if (!L.isAir(x, yy, z)) continue;
    const r = hash2(x, z, seed + 50), n = noise2(x, z, 4, seed + 51);
    if (r < (o.dry ?? 0) * 2 * n) L.set(x, yy, z, 'dry_grass');
    else if (r > 1 - (o.daisies ?? 0)) L.set(x, yy, z, 'daisies');
  }
}

/** Сгладить сетку уровней: одиночные выступы опускаются, ямки засыпаются — площадки широкие, края длинные */
function settle(heights: Int8Array, w: number, d: number, passes = 3): void {
  const H = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= d ? 0 : heights[z * w + x]);
  for (let p = 0; p < passes; p++) for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const h = H(i, j), nb = [H(i + 1, j), H(i - 1, j), H(i, j + 1), H(i, j - 1)];
    if (nb.filter((v) => v >= h).length < 2 && h > 0) heights[j * w + i] = h - 1;
    else if (nb.filter((v) => v > h).length >= 3) heights[j * w + i] = h + 1;
  }
}

/**
 * Холм-плиты (скриншоты 16, 17): h уровней, нижняя плита rx × rz (полуширины), каждая следующая уже на inset клеток,
 * углы срезаны под 45° ступеньками (chamfer — доля меньшей полуширины), край чуть гуляет по шуму на клетку.
 */
export function hill(L: Level, cx: number, cz: number, rx: number, rz: number, h: number, y: number, o: HillOpts & { inset?: number; chamfer?: number } = {}): void {
  const seed = o.seed ?? 0, inset = o.inset ?? 3, ch = o.chamfer ?? 0.55;
  const x0 = Math.floor(cx - rx - 2), z0 = Math.floor(cz - rz - 2), w = Math.ceil(rx * 2 + 5), d = Math.ceil(rz * 2 + 5);
  const heights = new Int8Array(w * d);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const x = x0 + i, z = z0 + j, dx = Math.abs(x - cx), dz = Math.abs(z - cz);
    const wob = noise2(x, z, 6, seed) < 0.25 ? -1 : noise2(x, z, 6, seed) > 0.78 ? 1 : 0;
    let lv = 0;
    for (let k = 0; k < h; k++) {
      const ax = rx - k * inset + wob, az = rz - k * inset + wob;
      if (ax < 1 || az < 1) break;
      if (dx <= ax && dz <= az && dx + dz <= ax + az - Math.min(ax, az) * ch) lv = k + 1;
    }
    heights[j * w + i] = lv;
  }
  settle(heights, w, d, 2);
  const side = o.stone;
  buildHeights(L, x0, z0, w, d, y, heights, {
    ...o,
    stoneAt: side ? (x, z) => (side === 'x+' && x > cx + rx * 0.3) || (side === 'x-' && x < cx - rx * 0.3) || (side === 'z+' && z > cz + rz * 0.3) || (side === 'z-' && z < cz - rz * 0.3) : undefined,
  });
}

/**
 * Ландшафт-плато (скриншоты 16, 17) на прямоугольник: крупный плавный шум (масштаб scale клеток) квантуется в levels уровней,
 * к краям прямоугольника спадает к земле (fade клеток), одиночные выступы вычищаются. mask(x, z) = false — клетку не трогать
 * (дорога, река, площадки).
 */
export function plateaus(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, levels: number, o: HillOpts & { scale?: number; fade?: number; mask?: (x: number, z: number) => boolean } = {}): void {
  const seed = o.seed ?? 0, scale = o.scale ?? 14, fade = o.fade ?? 5;
  const w = x1 - x0 + 1, d = z1 - z0 + 1;
  const heights = new Int8Array(w * d);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const x = x0 + i, z = z0 + j;
    if (o.mask && !o.mask(x, z)) continue;
    const n = noise2(x, z, scale, seed) * 0.7 + noise2(x, z, scale * 0.45, seed + 1) * 0.3;
    const edge = Math.min(i, j, w - 1 - i, d - 1 - j);
    const f = Math.min(1, edge / fade);
    // уровни смещены вверх: плиты занимают большую часть площади, земля остаётся заливами
    const t = Math.max(0, Math.min(1, (n - 0.12) / 0.55)) * f;
    heights[j * w + i] = Math.min(levels, Math.floor(t * (levels + 0.999)));
  }
  settle(heights, w, d, 5);
  if (o.mask) for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (!o.mask(x0 + i, z0 + j)) heights[j * w + i] = 0;
  buildHeights(L, x0, z0, w, d, y, heights, o);
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
  // перед порталом — расчищенная площадка с полом из плит
  for (let dz = -depth; dz <= 3; dz++) for (let dx = -2; dx <= w + 1; dx++) {
    L.set(x + dx, y - 1, z + dz, 'portal_floor');
    if (dz > 0) for (let k = 0; k <= h + 2; k++) L.set(x + dx, y + k, z + dz, 'air');
  }
}
