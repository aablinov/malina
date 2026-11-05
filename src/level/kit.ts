import { t } from '../i18n/i18n.ts';
import type { Level } from './level.ts';

/**
 * Ready-made level kits in the spirit of Minecraft Dungeons (wiki/style-world.md): stepped fences, hay stacks, cliffs, rivers,
 * bridges, hills, portals. Each is a "put it at this point" function, deterministic from the coordinates; they can be combined.
 * The playground "world" zone is assembled from them (src/level/world-zone.ts); they suit rooms and the floor generator too.
 */

export function hash2(x: number, z: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise 0..1 with step cell (for ragged edges and heights) */
export function noise2(x: number, z: number, cell: number, seed = 0): number {
  const gx = Math.floor(x / cell), gz = Math.floor(z / cell), fx = x / cell - gx, fz = z / cell - gz;
  const sm = (t: number) => t * t * (3 - 2 * t), u = sm(fx), v = sm(fz);
  const a = hash2(gx, gz, seed), b = hash2(gx + 1, gz, seed), c = hash2(gx, gz + 1, seed), d = hash2(gx + 1, gz + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Stepped fence, like the stone yard walls on screenshot 10: the height wanders by blocks from hMin to hMax,
 * the steps are smoothed with half-blocks on top. A line from (x0, z0) to (x1, z1) — along X or Z. y — bottom (top of the floor under it).
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

/** Floor of a plot from block floor in a rectangle (inclusive) at level y */
export function floorRect(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, floor: string): void {
  L.fill(x0, y, z0, x1, y, z1, floor);
}

/** Hay stack: a pyramid of hay bales by a row mask from bottom to top ('#' — bale), like in the yard corner on screenshot 10 */
export function hayStack(L: Level, x: number, y: number, z: number, layers: string[][]): void {
  layers.forEach((rows, k) => rows.forEach((row, dz) => [...row].forEach((c, dx) => { if (c === '#') L.set(x + dx, y + k, z + dz, 'hay'); })));
}

/**
 * Cliff mass (screenshots 11, 12): rectangle x0..x1 × z0..z1, bottom at y, the height wanders by noise from hMin to hMax.
 * Columns are entirely light or dark — vertical strata read; the top is a grassy cliff (the fringe hangs from the edge).
 */
export function cliffMass(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, hMin: number, hMax: number, seed = 0, dark = 0.25): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    const h = hMin + Math.floor(noise2(x, z, 4, seed) * (hMax - hMin + 0.999));
    const body = hash2(x, z, seed + 1) < dark ? 'cliff_dark' : 'cliff';
    for (let k = 0; k < h - 1; k++) L.set(x, y + k, z, body);
    L.set(x, y + h - 1, z, 'cliff_grass');
  }
}

/** Cliff steps down to the river (screenshot 11, right): the height drops from hFar to 1 along (dx, dz), one step every step cells */
export function cliffSteps(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, hFar: number, dirX: number, step = 2, seed = 0): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    const along = dirX > 0 ? Math.max(x0, x1) - x : x - Math.min(x0, x1);
    const h = Math.max(1, Math.min(hFar, 1 + Math.floor((along + noise2(x, z, 3, seed) * 1.8) / step)));
    for (let k = 0; k < h - 1; k++) L.set(x, y + k, z, hash2(x, z, seed + 2) < 0.2 ? 'cliff_dark' : 'cliff');
    L.set(x, y + h - 1, z, 'cliff_grass');
  }
}

/**
 * River bed: in the rectangle removes the ground from yGround down to the water, puts a river with flow rot at yWater and sand under it.
 * The banks are whatever is around (grass with a fringe hangs down to the water).
 */
export function riverBed(L: Level, x0: number, z0: number, x1: number, z1: number, yGround: number, yWater: number, rot: number): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    for (let y = yWater + 1; y <= yGround + 4; y++) L.set(x, y, z, 'air');
    L.set(x, yWater, z, 'river', rot);
    L.set(x, yWater - 1, z, 'sand');
  }
}

/** Waterfall: a wall of streams x0..x1 on line z from yBottom to yTop (inclusive) */
export function waterfall(L: Level, x0: number, x1: number, z: number, yBottom: number, yTop: number): void {
  for (let x = x0; x <= x1; x++) for (let y = yBottom; y <= yTop; y++) L.set(x, y, z, 'waterfall');
}

/**
 * Bridge along X (screenshot 11): deck x0..x1 × z0..z1 at level y (top — y + 1), beams on the sides at z0 − 1 and z1 + 1,
 * posts on the beams at the ends
 */
export function bridgeX(L: Level, x0: number, x1: number, z0: number, z1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) L.set(x, y, z, 'bridge_deck', 1);
    L.set(x, y, z0 - 1, 'bridge_beam', 0);
    L.set(x, y, z1 + 1, 'bridge_beam', 0);
  }
  for (const x of [x0, x1]) for (const z of [z0 - 1, z1 + 1]) L.set(x, y + 1, z, 'bridge_post');
}

/** Stairway of block_stairs steps: climbs along (dx, dz) from (x, y, z) by steps blocks, width width across; block under the steps */
export function stairway(L: Level, x: number, y: number, z: number, dx: number, dz: number, steps: number, width: number, block: string): void {
  // stairs climb towards +X at rot 0, rot 1 — towards +Z, 2 — towards −X, 3 — towards −Z
  const rot = dx > 0 ? 0 : dz > 0 ? 1 : dx < 0 ? 2 : 3;
  for (let k = 0; k < steps; k++) for (let w = 0; w < width; w++) {
    const cx = x + dx * k + (dz ? w : 0), cz = z + dz * k + (dx ? w : 0);
    for (let j = 0; j < k; j++) L.set(cx, y + j, cz, block);
    L.set(cx, y + k, cz, `${block}_stairs`, rot);
  }
}

/**
 * Map relief is two different things (screenshots 13–17):
 *  1. Landscape (`landscape`, `hill`) — walkable everywhere and from any side. Huge slabs in several layers, but each layer is
 *     half a metre (a full block + a grass half-block), the difference between neighbouring cells is at most a layer: the hero's
 *     step is 0.5 m, so any plateau can be climbed from anywhere, without stairs. Mobs stand on any level.
 *  2. Cliff (`rockOutcrop`, `cliffMass`) — an impassable rock mass with grass on top and sheer sides; things reached by a single
 *     entrance (portal, cave) are built into it. Cliffs are put on top of the landscape — along the edges, by the road, by the river.
 */
export interface HillOpts {
  /** Share of tops with dry grass and with daisies */
  dry?: number; daisies?: number;
  seed?: number;
}

/** Surface in a column: y of the top of the highest block (where to put a tree, decor) */
export function surfaceAt(L: Level, x: number, z: number): number {
  const t = L.topAt(x, z);
  return t === null ? 0 : t + 1;
}

/** Smooth the level grid: lone bumps are lowered, pits are filled — plateaus are wide, edges are long */
function settle(heights: Int8Array, w: number, d: number, passes = 3): void {
  const H = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= d ? 0 : heights[z * w + x]);
  // each level separately: the "height ≥ t" mask is smoothed by majority in a 5 × 5 window — the slab outline is smooth,
  // bays and teeth of 2–3 cells vanish; the height is reassembled from the smoothed masks (levels do not cross)
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
  // majority in a 3 × 3 window: pits and bumps of 1–2 cells vanish, the slab outline is smoothed, the large shape stays
  for (let p = 0; p < 3; p++) {
    const src = heights.slice();
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const cnt = new Map<number, number>();
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = i + di, nj = j + dj, v = ni < 0 || nj < 0 || ni >= w || nj >= d ? 0 : src[nj * w + ni];
        cnt.set(v, (cnt.get(v) ?? 0) + 1);
      }
      // its own value occurs in the window 3 times or fewer — the cell is narrow (pit, bump, tooth), take the most frequent
      const own = src[j * w + i];
      if ((cnt.get(own) ?? 0) > 3) continue;
      let best = own, bc = 0;
      for (const [v, c] of cnt) if (c > bc) { best = v; bc = c; }
      heights[j * w + i] = best;
    }
  }
  // small areas of one height (dips, islets smaller than minArea cells) are filled with the most frequent height around
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

/** Landscape rise at a point: an ellipse with semi-axes rx × rz, height h layers, falls off smoothly towards the edge */
export interface Bump { x: number; z: number; rx: number; rz: number; h: number }

/** Landscape ground: top, half-block, side (ground under the top), cliff with this top; flora — whether dry grass and daisies grow */
export interface Ground { top: string; slab: string; side: string; rockTop: string; flora?: boolean }
export const GROUNDS: Record<string, Ground> = {
  grass: { top: 'grass', slab: 'grass_slab', side: 'dirt', rockTop: 'cliff_grass', flora: true },
  snow: { top: 'snow', slab: 'snow_slab', side: 'dirt', rockTop: 'cliff_snow', flora: false },
  jungle: { top: 'jungle_floor', slab: 'jungle_floor_slab', side: 'dirt', rockTop: 'cliff_jungle', flora: false },
};
export const GROUND_TITLES: Record<string, string> = { grass: t('Grass'), snow: t('Snow'), jungle: t('Jungle') };
/**
 * Jungle ground — a mosaic of flat blocks in noise patches (reference 16): orange ground, large patches of teal moss,
 * dark red ground, rare islets of green moss. Shared by presets (builders-jungle.ts) and the showcase (prefabs-map.ts).
 */
export function jungleGroundAt(x: number, z: number, seed = 0): string {
  const a = noise2(x, z, 5, seed + 1), b = noise2(x, z, 3, seed + 2);
  if (a > 0.6) return 'moss_teal';
  if (a < 0.3) return 'jungle_floor_red';
  if (b > 0.72) return 'moss_block';
  return 'jungle_floor';
}

export interface LandscapeOpts extends HillOpts {
  /** Ground: grass by default (GROUNDS) */
  ground?: Ground;
  /** How many 0.5 m layers the noise gives (3–4 — MCD hilly terrain) */
  layers?: number;
  /** Noise scale, cells: the larger, the wider the slabs (24–32) */
  scale?: number;
  /** Cells where the landscape is flat (road, yard, river bed): the height falls off smoothly to them over fade cells */
  flat?: (x: number, z: number) => boolean;
  fade?: number;
  bumps?: Bump[];
  /** Share of the area where layer sides are stone (mixed with ground, as on the screenshots) */
  stone?: number;
  /** Ceiling: no higher than this many layers (no limit by default) */
  max?: number;
}

/**
 * Landscape: a smooth surface cut into 0.5 m slab layers. An S-curve makes the plateaus wide and the outlines
 * winding (noise with coordinate warping), smoothing removes small stuff, and the slope limit removes differences larger than
 * one layer: the landscape can be walked everywhere. A layer is a full grass block (even) or a grass half-block on top (odd).
 */
export function landscape(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, o: LandscapeOpts = {}): void {
  const seed = o.seed ?? 0, scale = o.scale ?? 28, layers = o.layers ?? 4, fade = o.fade ?? 6, stoneK = o.stone ?? 0.3, G = o.ground ?? GROUNDS.grass;
  const w = x1 - x0 + 1, d = z1 - z0 + 1;
  // distance to flat cells (breadth-first search, 8 neighbours)
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
    // coordinate warping — the outlines are winding, like a coastline
    const wx = x + (noise2(x, z, 20, seed + 3) - 0.5) * 9, wz = z + (noise2(x, z, 20, seed + 4) - 0.5) * 9;
    const n = noise2(wx, wz, scale, seed) * 0.72 + noise2(wx, wz, scale * 0.45, seed + 1) * 0.28;
    // S-curve: wide flat plateaus, the differences are gathered into short slopes
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
  // walkability: neighbouring cells differ by at most a layer (0.5 m) — lower until it holds
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
  // build: n layers = n/2 full blocks and a half-block on top if n is odd; in "stony" places the sides are cliff
  const stoneAt = (x: number, z: number) => noise2(x + 40, z - 17, 11, seed + 5) > 1 - stoneK;
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const n = heights[j * w + i];
    if (n <= 0) continue;
    const x = x0 + i, z = z0 + j, full = n >> 1, half = n & 1, rock = stoneAt(x, z);
    for (let k = 0; k < full; k++) {
      const topBlock = k === full - 1 && !half;
      L.set(x, y + k, z, topBlock ? (rock ? G.rockTop : G.top) : rock ? (hash2(x, z, seed + 2) < 0.22 ? 'cliff_dark' : 'cliff') : G.side);
    }
    if (half) {
      if (full > 0) L.set(x, y + full - 1, z, rock ? 'cliff' : G.side);
      L.set(x, y + full, z, G.slab);
    }
  }
  // flora on the tops
  if ((o.dry || o.daisies) && G.flora !== false) for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const n = heights[j * w + i];
    if (n <= 0) continue;
    const x = x0 + i, z = z0 + j, yy = y + (n >> 1) + (n & 1);
    if (n & 1 || !L.isAir(x, yy, z)) continue; // on a half-block the cross grass would hang in the air
    const r = hash2(x, z, seed + 50), nn = noise2(x, z, 4, seed + 51);
    if (r < (o.dry ?? 0) * 2 * nn) L.set(x, yy, z, 'dry_grass');
    else if (r > 1 - (o.daisies ?? 0)) L.set(x, yy, z, 'daisies');
  }
}

/** Hill — a landscape rise at a point: the same walkable 0.5 m layers, winding outline */
export function hill(L: Level, cx: number, cz: number, rx: number, rz: number, h: number, y: number, o: LandscapeOpts = {}): void {
  const m = 6;
  landscape(L, Math.floor(cx - rx - m), Math.floor(cz - rz - m), Math.ceil(cx + rx + m), Math.ceil(cz + rz + m), y, {
    layers: 0, fade: 3, ...o, bumps: [{ x: cx, z: cz, rx: rx + 2, rz: rz + 2, h: h + 0.6 }],
    flat: (x, z) => ((x - cx) / (rx + m - 1)) ** 2 + ((z - cz) / (rz + m - 1)) ** 2 > 1,
  });
}

/**
 * Cliff (screenshots 11, 12, 14, 17): an impassable rock mass with a winding outline, sheer sides of light and
 * dark strata and grass on top. The height wanders by a block. Placed on top of the landscape; a portal or cave is built into it.
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

/** Tree (screenshot 13): a trunk of trunk blocks and a fluffy ellipsoid crown of leaves_fluffy */
export function tree(L: Level, x: number, y: number, z: number, trunk = 3, r = 2): void {
  for (let k = 0; k < trunk; k++) L.set(x, y + k, z, 'log');
  const cy = y + trunk + r * 0.5;
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) {
    const d = (dx * dx + dz * dz) / (r * r) + (dy * dy) / ((r * 0.8) ** 2) + (hash2(x + dx * 7, z + dz * 5, dy + 60) - 0.5) * 0.45;
    if (d <= 1 && !(dx === 0 && dz === 0 && dy < 0)) L.set(x + dx, Math.round(cy + dy), z + dz, 'leaves_fluffy');
  }
}

/** Fortress wall with stepped merlons (screenshot 13): along X or Z, height h, a merlon every other block, room for candles on top */
export function rampart(L: Level, x0: number, z0: number, x1: number, z1: number, y: number, h: number): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)), dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const x = x0 + dx * i, z = z0 + dz * i;
    for (let k = 0; k < h; k++) L.set(x, y + k, z, 'wall_stone');
    L.set(x, y + h, z, i % 3 === 0 ? 'wall_stone' : 'air');
  }
}

/**
 * Portal in a hill (screenshot 14), facing +Z: an opening of width w and height h with its bottom edge at y, a frame of dark stone,
 * a lintel with inlay, the glow deep inside (2 blocks in), side walls of the opening, a light floor in front —
 * grass spills onto it with a ragged edge. (x, z) — the bottom-left corner of the opening from outside.
 */
export function portal(L: Level, x: number, y: number, z: number, w = 2, h = 3): void {
  const depth = 1;
  for (let dz = -depth - 1; dz <= 0; dz++) for (let dx = -1; dx <= w; dx++) {
    for (let k = 0; k <= h; k++) {
      const side = dx === -1 || dx === w, back = dz === -depth - 1, top = k === h;
      const cell = side || back ? 'portal_frame' : top ? (dz === 0 ? 'portal_trim' : 'portal_frame') : 'air';
      L.set(x + dx, y + k, z + dz, cell);
    }
    // turf on top of the frame, like the hill around
    L.set(x + dx, y + h + 1, z + dz, 'grass');
  }
  for (let dx = 0; dx < w; dx++) for (let k = 0; k < h; k++) L.set(x + dx, y + k, z - depth, 'portal', 0);
  // in front of the portal — a plot with a slab floor, further on a passage forward is cut down to ground level (the exit is not blocked)
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
