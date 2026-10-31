import { Level } from './level.ts';
import { hash2, noise2 } from './kit.ts';
import { stampPrefab } from './prefab-lib/stamp.ts';
import type { LibraryPrefab } from './prefab-lib/types.ts';
import type { TdLane, TdPad, TdSpec } from '../td/types.ts';
import { TD_GLADE_WAVES } from '../td/waves-glade.ts';

/**
 * Карта «Кристальная поляна» — оборона куста 2 (wiki/design-tower-defence.md, раздел 8; референс — wiki/sources/td-refs.md, № 1):
 * ночная поляна 96 × 96 м, куст малины в центре на площади за каменной оградой, три дороги врагов от **синих порталов**
 * в каменных арках. Дороги — ровные, с прямыми углами, как рвы референса, и по обе стороны **каменные стенки** со мхом;
 * площадки под башни — у поворотов. Светят только **грибы-светильники** (розовые и голубые, блоки на слое glow
 * с запечённым светом), **кристаллы**, порталы и фонари; в воздухе светлячки; по углам статуи в капюшонах.
 * `npm run map:td2` пишет assets/maps/td2.json; открыть — `?map=td2`. Враги на уровень сильнее: `meta.td.level` = 7.
 */

export const GLADE_HALF = 48;

/** Дороги врагов: от портала к кусту (метры), прямые отрезки с прямыми углами */
export const GLADE_LANES: TdLane[] = [
  { id: 'west', title: 'Западный ров', points: [[-45, 12], [-36, 12], [-36, 4], [-22, 4], [-22, -6], [-12, -6], [-12, -1], [-2, -1]] },
  { id: 'north', title: 'Северный ров', points: [[-6, -45], [-6, -34], [8, -34], [8, -20], [0, -20], [0, -12], [2, -12], [2, -3]] },
  { id: 'east', title: 'Восточный ров', points: [[45, -4], [34, -4], [34, 8], [22, 8], [22, 12], [12, 12], [12, 3], [3, 3]] },
];

/** Площадки под башни: у поворотов рвов, снаружи углов, и две у куста */
export const GLADE_PADS: TdPad[] = [
  // запад
  { x: -40, z: 17 }, { x: -31, z: 9 }, { x: -27, z: -1 }, { x: -17, z: -11 }, { x: -8, z: -6 },
  // север
  { x: -11, z: -39 }, { x: 3, z: -39 }, { x: 13, z: -27 }, { x: 5, z: -16 }, { x: -5, z: -16 },
  // восток
  { x: 40, z: 1 }, { x: 29, z: 1 }, { x: 27, z: 13 }, { x: 17, z: 17 }, { x: 7, z: 8 },
  // у куста
  { x: -5, z: 5 }, { x: 7, z: -5 },
];

export const GLADE_SPEC: TdSpec = {
  bush: { x: 0, z: 0, hp: 500 },
  lanes: GLADE_LANES,
  pads: GLADE_PADS,
  berries: 350,
  waves: TD_GLADE_WAVES,
  rest: 20,
  level: 7,
};

/** Расстояние от точки до отрезка */
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};
/** Расстояние от точки до ближайшей дороги */
const laneDist = (x: number, z: number): number => {
  let best = Infinity;
  for (const l of GLADE_LANES) for (let i = 0; i + 1 < l.points.length; i++) best = Math.min(best, segDist(x, z, l.points[i][0], l.points[i][1], l.points[i + 1][0], l.points[i + 1][1]));
  return best;
};

export function buildTdGladeMap(lib: Record<string, LibraryPrefab>): Level {
  // площадки не на дороге и не на площади куста — иначе башня перегородит ров
  for (const p of GLADE_PADS) {
    if (laneDist(p.x, p.z) < 3.2) throw new Error(`Площадка ${p.x},${p.z} слишком близко к дороге (${laneDist(p.x, p.z).toFixed(1)} м)`);
    if (Math.hypot(p.x, p.z) < 6.5) throw new Error(`Площадка ${p.x},${p.z} на площади куста`);
  }
  const L = new Level('Кристальная поляна');
  const H = GLADE_HALF;
  const used = new Set<string>();
  const key = (x: number, z: number): string => `${x},${z}`;
  const mark = (x: number, z: number, r: number): void => { for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) used.add(key(xx, zz)); };
  const inMap = (x: number, z: number): boolean => Math.abs(x) <= H && Math.abs(z) <= H;
  // ---------- земля: трава с пятнами бирюзового мха ----------
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    const n = noise2(x, z, 7, 1);
    L.set(x, -1, z, n > 0.7 ? 'moss_teal' : n < 0.22 ? 'moss_block' : 'grass');
    L.set(x, -2, z, 'dirt');
  }
  // ---------- дороги: плиты 3 м с прямыми углами; по бокам — каменные стенки со мхом ----------
  const road = new Set<string>();
  const side = new Map<string, number>();
  for (const lane of GLADE_LANES) for (let i = 0; i + 1 < lane.points.length; i++) {
    const [ax, az] = lane.points[i], [bx, bz] = lane.points[i + 1];
    const alongX = az === bz;
    const lo = alongX ? Math.min(ax, bx) : Math.min(az, bz), hi = alongX ? Math.max(ax, bx) : Math.max(az, bz);
    for (let t = lo - 1; t <= hi + 1; t++) for (let w = -2; w <= 2; w++) {
      const x = alongX ? t : ax + w, z = alongX ? az + w : t;
      if (!inMap(x, z)) continue;
      if (Math.abs(w) <= 1) { road.add(key(x, z)); side.delete(key(x, z)); }
      else if (!road.has(key(x, z))) side.set(key(x, z), i);
    }
  }
  for (const k of road) {
    const [x, z] = k.split(',').map(Number);
    const v = hash2(x, z, 2);
    L.set(x, -1, z, v < 0.8 ? 'path' : v < 0.9 ? 'tiles_broken' : 'cobble');
    used.add(k);
  }
  const keep = (x: number, z: number): boolean => {
    if (Math.hypot(x, z) < 7) return true;
    for (const p of GLADE_PADS) if (Math.hypot(x - p.x, z - p.z) < 3) return true;
    for (const l of GLADE_LANES) if (Math.hypot(x - l.points[0][0], z - l.points[0][1]) < 6) return true;
    return false;
  };
  // стенки: сплошные, с мшистыми и низкими кусками, столбик на каждом пятом; у площадок и площади — проёмы
  for (const k of side.keys()) {
    const [x, z] = k.split(',').map(Number);
    if (keep(x, z) || !inMap(x, z)) continue;
    const v = hash2(x, z, 3);
    L.set(x, -1, z, v < 0.5 ? 'mossy' : 'wall_stone');
    if ((x + z) % 5 === 0) L.set(x, 0, z, 'wall_stone');
    else if (v < 0.12) L.set(x, 0, z, 'wall_stone_slab');
    else L.set(x, 0, z, v < 0.4 ? 'bricks_mossy' : 'wall_stone_wall');
    used.add(k);
  }
  // ---------- площадь куста: плиты, кольцо ограды с проёмами у дорог, фонари, кристаллы ----------
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
    const d = Math.hypot(x, z);
    if (d <= 4.6) L.set(x, -1, z, hash2(x, z, 4) < 0.85 ? 'tiles' : 'tiles_broken');
    else if (d <= 5.6) { L.set(x, -1, z, 'mossy'); if (!road.has(key(x, z)) && laneDist(x, z) > 2 && hash2(x, z, 5) < 0.8) L.set(x, 0, z, hash2(x, z, 6) < 0.3 ? 'wall_stone' : 'wall_stone_wall'); }
    used.add(key(x, z));
  }
  for (const [x, z] of [[4, 4], [-4, 4], [4, -4], [-4, -4]]) L.addDecor({ name: 'lantern_post', pos: [x, 0, z], rot: [45] });
  for (const [x, z] of [[3, -1], [-3, 1]]) { L.set(x, 0, z, 'crystal'); L.set(x, 1, z, 'crystal_small'); }
  // ---------- площадки: круг плит, мшистый обод, четыре столбика, кристаллик ----------
  for (const p of GLADE_PADS) {
    for (let x = p.x - 3; x <= p.x + 3; x++) for (let z = p.z - 3; z <= p.z + 3; z++) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= 1.6) L.set(x, -1, z, 'tiles'); else if (d <= 2.4) L.set(x, -1, z, 'mossy');
    }
    for (const [sx, sz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) if (L.isAir(p.x + sx, 0, p.z + sz)) L.set(p.x + sx, 0, p.z + sz, 'wall_stone_slab');
    if (L.isAir(p.x + 2, 0, p.z)) L.set(p.x + 2, 0, p.z, 'crystal_small');
    mark(p.x, p.z, 3);
  }
  // ---------- порталы: каменная арка 3 × 4 с синим сиянием, перед ней плиты; за ней — тёмный камень ----------
  for (const lane of GLADE_LANES) {
    const [x, z] = lane.points[0], [nx, nz] = lane.points[1];
    const dx = Math.sign(nx - x), dz = Math.sign(nz - z);
    // ниша: за аркой — глухая стена из тёмного камня, перед ней — плиты
    for (let k = -2; k <= 6; k++) for (let w = -3; w <= 3; w++) {
      const cx = x - dx * k + (dz ? w : 0), cz = z - dz * k + (dx ? w : 0);
      if (!inMap(cx, cz)) continue;
      if (k >= 2) { for (let y = 0; y < 5; y++) L.set(cx, y, cz, noise2(cx, cz, 3, 8) > 0.6 ? 'bricks_mossy' : 'wall_stone'); L.set(cx, -1, cz, 'wall_stone'); }
      else if (Math.abs(w) <= 1) { L.set(cx, -1, cz, 'tiles'); for (let y = 0; y < 5; y++) if (L.nameAt(cx, y, cz) !== 'air') L.set(cx, y, cz, 'air'); }
      used.add(key(cx, cz));
    }
    // арка в стене: рама вокруг проёма 3 × 4, сияние — панели в проёме
    for (let w = -2; w <= 2; w++) for (let y = 0; y < 5; y++) {
      const cx = x - dx * 2 + (dz ? w : 0), cz = z - dz * 2 + (dx ? w : 0);
      if (!inMap(cx, cz)) continue;
      const edge = Math.abs(w) === 2 || y === 4;
      if (edge) L.set(cx, y, cz, y === 4 && Math.abs(w) < 2 ? 'portal_trim' : 'portal_frame');
      else L.set(cx, y, cz, 'portal_blue', dx ? 1 : 0);
    }
    for (let w = -1; w <= 1; w++) L.set(x - dx * 1 + (dz ? w : 0), -1, z - dz * 1 + (dx ? w : 0), 'portal_floor');
    for (const s of [-1, 1]) {
      const tx = x + dx * 2 + (dz ? 3 * s : 0), tz = z + dz * 2 + (dx ? 3 * s : 0);
      if (inMap(tx, tz)) { L.set(tx, 0, tz, 'crystal'); mark(tx, tz, 1); }
      const sx = x + dx * 5 + (dz ? 3 * s : 0), sz = z + dz * 5 + (dx ? 3 * s : 0);
      if (inMap(sx, sz) && L.isAir(sx, 0, sz) && !road.has(key(sx, sz))) { L.addDecor({ name: 'statue_hooded', pos: [sx, 0, sz], rot: [Math.atan2(dx, dz) * 180 / Math.PI + 180] }); mark(sx, sz, 1); }
    }
  }
  // ---------- край карты: тёмная ограда во мху с ёлками ----------
  for (let i = -H - 1; i <= H + 1; i++) for (const [x, z] of [[i, -H - 1], [i, H + 1], [-H - 1, i], [H + 1, i]]) {
    const t = L.topAt(x, z);
    if (t !== null && t >= 0) continue;
    const hh = 2 + (noise2(x, z, 4, 9) > 0.55 ? 1 : 0);
    for (let y = -1; y < hh; y++) L.set(x, y, z, noise2(x, z, 3, 10) > 0.6 ? 'bricks_mossy' : 'mossy');
    L.set(x, hh, z, 'moss_block');
  }
  // ---------- декор ----------
  const free = (x: number, z: number, r: number): boolean => {
    for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) if (Math.abs(xx) > H - 1 || Math.abs(zz) > H - 1 || used.has(key(xx, zz)) || road.has(key(xx, zz)) || L.topAt(xx, zz) !== -1) return false;
    return true;
  };
  const stamp = (id: string, x: number, z: number, q = 0): boolean => {
    const p = lib[id];
    if (!p) throw new Error(`Нет пресета «${id}»`);
    const rx = Math.ceil(p.size[0] / 2) + 1, rz = Math.ceil(p.size[2] / 2) + 1;
    if (!free(x, z, Math.max(rx, rz))) return false;
    const r = stampPrefab(L, p, x, 0, z, q);
    for (const d of r.decor) L.addDecor(d);
    L.entities.push(...r.entities);
    mark(x, z, Math.max(rx, rz));
    return true;
  };
  const dec = (name: string, x: number, z: number, rot = hash2(x, z, 11) * 360): void => { L.addDecor({ name, pos: [x, 0, z], rot: [rot] }); mark(x, z, 1); };
  /** Гриб-светильник: ножка 1–2 блока, широкая шляпка из полублоков и купол; pink — розовый, иначе голубой */
  const shroom = (x: number, z: number, h: number, pink: boolean, wide: boolean): boolean => {
    const r = wide ? 1 : 0;
    if (!free(x, z, r + 1)) return false;
    for (let y = 0; y < h; y++) L.set(x, y, z, 'shroom_stem');
    const cap = pink ? 'shroom_cap_pink' : 'shroom_cap_blue';
    if (wide) { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) L.set(x + dx, h, z + dz, `${cap}_slab`); }
    L.set(x, h, z, cap);
    if (wide || h > 1) L.set(x, h + 1, z, `${cap}_slab`);
    mark(x, z, r + 1);
    return true;
  };
  // статуи и алтарь по углам, большие грибы и кристаллы — гроздьями ближе к дорогам
  for (const [x, z, q] of [[-40, -40, 0], [40, 40, 2], [40, -40, 1], [-40, 40, 3]] as const) if (!stamp('ruin_platform_statues', x, z, q)) stamp('crystal_cluster_big', x, z, q);
  stamp('temple_altar_crystal', 0, 28);
  stamp('temple_altar_crystal', 0, -28, 2);
  for (let z = -H + 4; z <= H - 4; z += 3) for (let x = -H + 4; x <= H - 4; x += 3) {
    const v = hash2(x, z, 12), d = laneDist(x, z);
    if (d < 4) continue;
    if (v < 0.16 && d < 16) shroom(x, z, 1 + Math.floor(hash2(x, z, 13) * 2), hash2(x, z, 14) < 0.5, hash2(x, z, 15) < 0.4);
    else if (v < 0.2 && d < 14) stamp(hash2(x, z, 16) < 0.4 ? 'crystal_cluster_big' : 'crystal_cluster_small', x, z, Math.floor(hash2(x, z, 17) * 4));
    else if (v < 0.28 && d > 7) stamp(['tree_oak', 'tree_oak_2', 'tree_pine_dark', 'tree_pine_dark_2', 'bush_cluster', 'mossy_boulders'][Math.floor(hash2(x, z, 18) * 6)], x, z, Math.floor(hash2(x, z, 19) * 4));
  }
  // ряд ёлок у края — лес вокруг поляны
  for (let i = -H + 3; i <= H - 3; i += 4) for (const [x, z] of [[i, -H + 3], [i, H - 3], [-H + 3, i], [H - 3, i]]) {
    stamp(hash2(x, z, 20) < 0.7 ? 'tree_pine_dark' : 'tree_oak', x + Math.floor(hash2(x, z, 21) * 3) - 1, z + Math.floor(hash2(x, z, 22) * 3) - 1, Math.floor(hash2(x, z, 23) * 4));
  }
  // мелочь: грибы-светильники, папоротники, цветы, кристаллики, малые грибы
  for (let z = -H + 2; z <= H - 2; z++) for (let x = -H + 2; x <= H - 2; x++) {
    if (!free(x, z, 0)) continue;
    const v = hash2(x, z, 24), d = laneDist(x, z);
    if (v < 0.05) L.set(x, 0, z, hash2(x, z, 25) < 0.4 ? 'fern_big' : 'fern');
    else if (v < 0.09) L.set(x, 0, z, ['flower_pink', 'flower_blue', 'flower_white', 'flower_pink'][Math.floor(hash2(x, z, 26) * 4)]);
    else if (v < 0.105 && d < 10) L.set(x, 0, z, 'crystal_small');
    else if (v < 0.135 && d < 12 && free(x, z, 1)) dec(hash2(x, z, 27) < 0.75 ? 'mushrooms_glow' : 'mushrooms', x, z);
    else if (v < 0.13 && free(x, z, 1)) dec('crystal_cluster', x, z);
    else if (v < 0.14 && d > 8 && L.nameAt(x, -1, z) === 'grass') L.set(x, 0, z, 'tall_grass');
  }
  // ---------- герой, цель, мир: холодная ночь, светлячки, сильный bloom ----------
  L.spawn = [0, 0, 7];
  L.meta.spawnYaw = 270;
  L.meta.goal = ['Защити куст малины', 'Кристальная поляна'];
  L.meta.td = GLADE_SPEC;
  L.meta.world = {
    sun: { color: '#8fb4ff', intensity: 0.55, elevation: 48, azimuth: 200, shadows: true },
    sky: { color: '#08141f', hemiSky: '#3a6a8a', hemiGround: '#163a2a', hemi: 1.3, ambient: 0.2 },
    fog: { enabled: true, color: '#0f2a30', near: 20, far: 80 },
    weather: { kind: 'fireflies', intensity: 0.7, wind: 0.3 },
    post: { bloom: 0.85, bloomThreshold: 0.72, vignette: 0.32, saturation: 1.12, shadowTint: '#1a3a6a', highTint: '#a0ffd0', tintAmount: 0.1 },
  };
  return L;
}
