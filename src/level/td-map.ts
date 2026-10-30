import { Level } from './level.ts';
import { hash2, noise2 } from './kit.ts';
import { stampPrefab } from './prefab-lib/stamp.ts';
import type { LibraryPrefab } from './prefab-lib/types.ts';
import type { TdLane, TdPad, TdSpec } from '../td/types.ts';
import { TD_WAVES } from '../td/waves.ts';

/**
 * Карта «Оборона куста» — лавовая (wiki/design-tower-defence.md, раздел 7): 96 × 96 м пепельной земли, куст малины в центре,
 * три дороги врагов от логов-пещер на краях, площадки под башни вдоль дорог. Землю режут **разломы с лавой** — светят тёплым
 * запечённым светом, над ними дымка (src/td/lava-fx.ts); дороги идут через них по мостам с перилами. По углам — вулканы
 * с кратерами и потёками, вдоль дорог — заборчики, фонари и жаровни, у логов — клетки с добычей, кости и черепа.
 * `npm run map:td` пишет assets/maps/td.json; открыть — `?map=td`. Дороги, площадки и куст — в `meta.td` (src/td/types.ts).
 */

export const TD_HALF = 48;

/** Дороги врагов: от логова к кусту (метры) */
export const TD_LANES: TdLane[] = [
  { id: 'west', title: 'Западная тропа', points: [[-45, -8], [-37, -8], [-31, 2], [-22, 5], [-15, -2], [-8, -3], [-3, -1]] },
  { id: 'north', title: 'Северная тропа', points: [[7, -45], [7, -37], [-1, -31], [-4, -22], [3, -15], [4, -8], [1, -3]] },
  { id: 'east', title: 'Восточная тропа', points: [[45, 9], [37, 9], [31, 2], [23, -2], [17, 5], [9, 6], [3, 2]] },
];

/** Площадки под башни: у поворотов дорог, по две-три на дорогу, и у куста */
export const TD_PADS: TdPad[] = [
  // запад
  { x: -40, z: -12 }, { x: -33, z: -3 }, { x: -25, z: 1 }, { x: -18, z: 2 }, { x: -11, z: -7 },
  // север
  { x: 3, z: -40 }, { x: -5, z: -35 }, { x: -8, z: -24 }, { x: 0, z: -19 }, { x: 8, z: -12 },
  // восток
  { x: 40, z: 5 }, { x: 34, z: -2 }, { x: 26, z: 2 }, { x: 20, z: 9 }, { x: 13, z: 2 },
  // у куста
  { x: -6, z: 5 }, { x: 6, z: -4 },
];

export const TD_SPEC: TdSpec = {
  bush: { x: 0, z: 0, hp: 400 },
  lanes: TD_LANES,
  pads: TD_PADS,
  berries: 300,
  waves: TD_WAVES,
  rest: 20,
};

/** Разломы: ломаные линии (метры) и ширина; лава в них вровень с землёй, вброд, но жжёт */
const RIFTS: [number[], number][] = [
  [[-48, 22, -34, 15, -24, 22, -12, 17, -2, 24, 8, 30, 20, 23, 32, 29, 48, 24], 1.7],
  [[-48, -30, -36, -24, -24, -31, -12, -25, 0, -33, 12, -27, 24, -36, 48, -30], 1.6],
  [[-48, -2, -42, 4, -40, 12], 1.1],
  [[48, -12, 42, -6, 40, 0], 1.1],
  [[-16, 12, -12, 14, -9, 10], 0.9],
  [[14, -14, 18, -11, 22, -16], 0.9],
];
/** Лавовые озёра: [x, z, радиус] */
const POOLS: [number, number, number][] = [[-26, -12, 2.6], [26, 14, 2.6], [-30, 30, 3], [30, -18, 2.4], [-6, 36, 2], [40, 30, 2.4]];
/** Вулканы: [x, z, радиус, высота, зерно] — конус с кратером лавы и потёком */
const VOLCANOES: [number, number, number, number, number][] = [[-38, 38, 9, 6, 1], [38, -38, 8, 5, 2], [-39, -39, 7, 5, 3], [40, 40, 8, 6, 4], [-18, -42, 4, 3, 5], [22, 42, 4, 3, 6]];
/** Обожжённые скалы: [x, z, rx, rz, высота, зерно] — между дорогами, чтобы карта не была плоской */
const ROCKS: [number, number, number, number, number, number][] = [[-22, -22, 6, 4, 3, 7], [22, 22, 5, 5, 3, 8], [-36, 18, 5, 4, 4, 9], [36, -14, 4, 6, 4, 10], [18, -26, 5, 3, 3, 11], [-10, 28, 4, 3, 2, 12], [26, -8, 3, 3, 2, 13], [-28, 10, 3, 3, 2, 14]];

/** Скальный массив из обожжённого камня: контур рваный, бока в пластах, сверху пепел; h — высота блоков */
function lavaRock(L: Level, cx: number, cz: number, rx: number, rz: number, h: number, seed: number, top = 'cliff_lava_top'): void {
  for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) for (let z = Math.floor(cz - rz - 2); z <= Math.ceil(cz + rz + 2); z++) {
    const wx = x + (noise2(x, z, 7, seed + 1) - 0.5) * 4, wz = z + (noise2(x, z, 7, seed + 2) - 0.5) * 4;
    if (((wx - cx) / rx) ** 2 + ((wz - cz) / rz) ** 2 > 1) continue;
    const hh = h + Math.floor(noise2(x, z, 4, seed + 3) * 2.2) - 1;
    const dark = noise2(x, z, 3, seed + 4) > 0.62;
    for (let k = -1; k < hh - 1; k++) L.set(x, k, z, dark ? 'basalt' : 'cliff_lava');
    L.set(x, hh - 1, z, top);
    for (let k = hh; k < hh + 3; k++) if (L.nameAt(x, k, z) !== 'air') L.set(x, k, z, 'air');
  }
}

/** Вулкан: конус с рваным краем, кратер с лавой и огнём наверху, потёк лавы по склону в сторону seed */
function volcano(L: Level, cx: number, cz: number, r: number, h: number, seed: number): void {
  const flowA = hash2(cx, cz, seed) * Math.PI * 2;
  for (let x = Math.floor(cx - r - 2); x <= Math.ceil(cx + r + 2); x++) for (let z = Math.floor(cz - r - 2); z <= Math.ceil(cz + r + 2); z++) {
    const wx = x + (noise2(x, z, 5, seed + 1) - 0.5) * 3, wz = z + (noise2(x, z, 5, seed + 2) - 0.5) * 3;
    const d = Math.hypot(wx - cx, wz - cz) / r;
    if (d > 1) continue;
    const crater = d < 0.3;
    const hh = crater ? Math.max(1, h - 2) : Math.max(1, Math.round(h * (1 - d) ** 0.75 + noise2(x, z, 3, seed + 3) * 0.8));
    const a = Math.atan2(z - cz, x - cx), onFlow = Math.abs(Math.atan2(Math.sin(a - flowA), Math.cos(a - flowA))) < 0.22 && d > 0.25;
    for (let k = -1; k < hh - 1; k++) L.set(x, k, z, noise2(x, z, 3, seed + 4) > 0.6 ? 'basalt' : 'cliff_lava');
    L.set(x, hh - 1, z, crater || onFlow ? 'lava' : 'cliff_lava_top');
    if (crater && hash2(x, z, seed + 5) < 0.35) L.set(x, hh, z, 'fire');
    for (let k = hh; k < hh + 4; k++) if (L.nameAt(x, k, z) !== 'air' && L.nameAt(x, k, z) !== 'fire') L.set(x, k, z, 'air');
  }
}

export function buildTdMap(lib: Record<string, LibraryPrefab>): Level {
  const L = new Level('Оборона куста');
  const H = TD_HALF;
  const used = new Set<string>();
  const key = (x: number, z: number): string => `${x},${z}`;
  const mark = (x: number, z: number, r: number): void => { for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) used.add(key(xx, zz)); };
  const inMap = (x: number, z: number): boolean => Math.abs(x) <= H && Math.abs(z) <= H;
  /** Обойти линию с радиусом: cb(x, z, dx, dz, far) для клеток в r (far — в полосе r..r+1) */
  const walk = (line: number[], r: number, cb: (x: number, z: number, dx: number, dz: number, far: boolean) => void): void => {
    for (let i = 0; i + 3 < line.length; i += 2) {
      const [ax, az, bx, bz] = [line[i], line[i + 1], line[i + 2], line[i + 3]];
      const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len * 2);
      for (let k = 0; k <= n; k++) {
        const t = k / n, cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
          const d = Math.hypot(x - cx, z - cz);
          if (d <= r + 1 && inMap(x, z)) cb(x, z, bx - ax, bz - az, d > r);
        }
      }
    }
  };
  // ---------- земля: пепел с пятнами базальта ----------
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    const n = noise2(x, z, 6, 1);
    L.set(x, -1, z, n > 0.72 ? 'basalt' : 'ash_ground');
    L.set(x, -2, z, 'cliff_lava');
  }
  // ---------- что лава не должна трогать: куст, площадки, логова ----------
  const keep = (x: number, z: number): boolean => {
    if (Math.hypot(x, z) < 7) return true;
    for (const p of TD_PADS) if (Math.hypot(x - p.x, z - p.z) < 3.2) return true;
    for (const l of TD_LANES) if (Math.hypot(x - l.points[0][0], z - l.points[0][1]) < 9) return true;
    return false;
  };
  // ---------- разломы и озёра с лавой ----------
  const lava = new Set<string>();
  const pour = (x: number, z: number): void => { if (keep(x, z)) return; lava.add(key(x, z)); used.add(key(x, z)); };
  for (const [line, r] of RIFTS) walk(line, r, (x, z, _dx, _dz, far) => { if (!far || noise2(x, z, 3, 2) > 0.72) pour(x, z); });
  for (const [px0, pz0, pr] of POOLS) for (let x = Math.floor(px0 - pr - 1); x <= Math.ceil(px0 + pr + 1); x++) for (let z = Math.floor(pz0 - pr - 1); z <= Math.ceil(pz0 + pr + 1); z++) {
    if (Math.hypot(x - px0, z - pz0) + (noise2(x, z, 3, 3) - 0.5) * 2 <= pr) pour(x, z);
  }
  for (const k of lava) { const [x, z] = k.split(',').map(Number); L.set(x, -1, z, 'lava'); L.set(x, -2, z, 'cliff_lava'); }
  // берег разлома: базальтовая кромка кусками и лавовые цветы
  for (const k of lava) {
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, zz = z + dz;
      if (!inMap(xx, zz) || lava.has(key(xx, zz))) continue;
      const v = hash2(xx, zz, 4);
      if (v < 0.35) L.set(xx, -1, zz, 'basalt');
      else if (v < 0.42 && L.isAir(xx, 0, zz)) L.set(xx, 0, zz, v < 0.385 ? 'flower_orange' : 'flower_red');
    }
  }
  // ---------- дороги врагов: булыжник 3 м с рваным краем; через лаву — мост с перилами ----------
  const road = new Set<string>();
  const band = new Map<string, [number, number]>();
  for (const lane of TD_LANES) walk(lane.points.flat(), 1.5, (x, z, dx, dz, far) => {
    if (far) { if (noise2(x, z, 3, 5) > 0.6) { band.set(key(x, z), [dx, dz]); } return; }
    road.add(key(x, z)); used.add(key(x, z));
    if (lava.has(key(x, z))) { L.set(x, -1, z, 'bridge_deck', Math.abs(dx) >= Math.abs(dz) ? 1 : 0); L.set(x, -2, z, 'bridge_beam', Math.abs(dx) >= Math.abs(dz) ? 0 : 1); return; }
    L.set(x, -1, z, hash2(x, z, 6) < 0.85 ? 'cobble' : 'stone');
  });
  // перила мостов: клетки у дороги над лавой — брус и столбы; вдоль обычной дороги — заборчики кусками
  for (const [k, [dx, dz]] of band) {
    const [x, z] = k.split(',').map(Number);
    if (road.has(k)) continue;
    const alongX = Math.abs(dx) >= Math.abs(dz);
    if (lava.has(k)) { L.set(x, -1, z, 'bridge_beam', alongX ? 0 : 1); L.set(x, 0, z, (alongX ? x : z) % 3 === 0 ? 'bridge_post' : 'fence'); used.add(k); continue; }
    if (noise2(x, z, 5, 7) > 0.58 && hash2(x, z, 8) < 0.8 && L.isAir(x, 0, z) && !keep(x, z)) { L.set(x, 0, z, 'fence'); used.add(k); }
  }
  // ---------- площадь куста: плиты, кольцо базальта с проёмами у дорог, фонари ----------
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
    const d = Math.hypot(x, z);
    if (d <= 4.6) L.set(x, -1, z, hash2(x, z, 9) < 0.85 ? 'tiles' : 'tiles_broken');
    else if (d <= 5.5) { L.set(x, -1, z, 'basalt'); if (!road.has(key(x, z)) && hash2(x, z, 10) < 0.7) L.set(x, 0, z, 'basalt_slab'); }
    used.add(key(x, z));
  }
  for (const [x, z] of [[4, 4], [-4, 4], [4, -4], [-4, -4]]) L.addDecor({ name: 'lantern_post', pos: [x, 0, z], rot: [45] });
  // ---------- площадки: круг камня, базальтовый обод, четыре столбика ----------
  for (const p of TD_PADS) {
    for (let x = p.x - 3; x <= p.x + 3; x++) for (let z = p.z - 3; z <= p.z + 3; z++) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= 1.6) L.set(x, -1, z, 'stone'); else if (d <= 2.4) L.set(x, -1, z, 'basalt');
    }
    for (const [sx, sz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) if (L.isAir(p.x + sx, 0, p.z + sz)) L.set(p.x + sx, 0, p.z + sz, 'basalt_slab');
    mark(p.x, p.z, 3);
  }
  // ---------- скалы и вулканы ----------
  for (const [x, z, rx, rz, h, seed] of ROCKS) { lavaRock(L, x, z, rx, rz, h, 100 + seed); mark(x, z, Math.max(rx, rz) + 2); }
  for (const [x, z, r, h, seed] of VOLCANOES) { volcano(L, x, z, r, h, 200 + seed); mark(x, z, r + 2); }
  // ---------- логова: пещера в обожжённой скале, из неё выходит дорога; у входа — клетки, кости, факелы ----------
  for (const lane of TD_LANES) {
    const [x, z] = lane.points[0], [nx, nz] = lane.points[1];
    const dx = Math.sign(nx - x), dz = Math.sign(nz - z);
    lavaRock(L, x - dx * 4, z - dz * 4, dx ? 5 : 8, dz ? 5 : 8, 5, 300 + x + z);
    for (let k = -2; k <= 5; k++) for (let w = -1; w <= 1; w++) {
      const cx = x - dx * k + (dz ? w : 0), cz = z - dz * k + (dx ? w : 0);
      for (let y = 0; y < 3; y++) L.set(cx, y, cz, 'air');
      L.set(cx, -1, cz, k < 0 ? 'cobble' : 'basalt');
      if (k >= 0 && L.isAir(cx, 3, cz)) L.set(cx, 3, cz, 'cliff_lava');
      used.add(key(cx, cz));
    }
    L.set(x - dx * 5, 0, z - dz * 5, 'fire');
    L.set(x - dx * 4 + (dz ? 1 : 0), 0, z - dz * 4 + (dx ? 1 : 0), 'fire');
    for (const s of [-1, 1]) {
      const tx = x - dx * 1 + (dz ? 2 * s : 0), tz = z - dz * 1 + (dx ? 2 * s : 0);
      L.set(tx, 0, tz, 'torch');
      const cx = x + dx * 3 + (dz ? 3 * s : 0), cz = z + dz * 3 + (dx ? 3 * s : 0);
      if (L.isAir(cx, 0, cz) && !road.has(key(cx, cz))) { L.addDecor({ name: s < 0 ? 'crate_banded' : 'skull', pos: [cx, 0, cz], rot: [hash2(cx, cz, 11) * 360] }); mark(cx, cz, 1); }
    }
    const bx = x + dx * 5 + (dz ? -4 : 0), bz = z + dz * 5 + (dx ? -4 : 0);
    if (L.isAir(bx, 0, bz) && !road.has(key(bx, bz))) { L.addDecor({ name: 'bones', pos: [bx, 0, bz], rot: [hash2(bx, bz, 12) * 360] }); mark(bx, bz, 1); }
  }
  // ---------- край карты: обожжённая скала с рваной высотой ----------
  for (let i = -H - 1; i <= H + 1; i++) for (const [x, z] of [[i, -H - 1], [i, H + 1], [-H - 1, i], [H + 1, i]]) {
    const t = L.topAt(x, z);
    if (t !== null && t >= 0) continue;
    const hh = 2 + (noise2(x, z, 4, 13) > 0.55 ? 1 : 0);
    for (let y = -1; y < hh; y++) L.set(x, y, z, noise2(x, z, 3, 14) > 0.6 ? 'basalt' : 'cliff_lava');
    L.set(x, hh, z, 'cliff_lava_top');
  }
  // ---------- декор и мелочь на свободной земле ----------
  const free = (x: number, z: number, r: number): boolean => {
    for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) if (Math.abs(xx) > H - 1 || Math.abs(zz) > H - 1 || used.has(key(xx, zz)) || road.has(key(xx, zz)) || L.topAt(xx, zz) !== -1 || L.nameAt(xx, -1, zz) === 'lava') return false;
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
  const dec = (name: string, x: number, z: number, rot = hash2(x, z, 15) * 360): void => { L.addDecor({ name, pos: [x, 0, z], rot: [rot] }); mark(x, z, 1); };
  // мёртвые деревья, валуны и пни — пресеты; у дорог — фонари и жаровни на поворотах
  const ids = ['tree_dead', 'tree_dead_2', 'boulder_group', 'boulder_single', 'stump_logs'];
  for (let z = -H + 3; z <= H - 3; z += 2) for (let x = -H + 3; x <= H - 3; x += 2) {
    if (hash2(x, z, 16) > 0.1) continue;
    stamp(ids[Math.floor(hash2(x, z, 17) * ids.length)], x, z, Math.floor(hash2(x, z, 18) * 4));
  }
  for (const lane of TD_LANES) for (let i = 1; i + 1 < lane.points.length; i++) {
    const [x, z] = lane.points[i], s = i % 2 ? 1 : -1;
    const lx = x + s * 3, lz = z + s * 2;
    if (free(lx, lz, 1)) { if (i % 3 === 0) { L.set(lx, 0, lz, 'campfire'); mark(lx, lz, 1); } else dec('lantern_post', lx, lz, 0); }
  }
  const small = ['rock_small', 'skull', 'bones', 'pot_clay', 'firewood_pile', 'barrel', 'crate_banded', 'sack'];
  for (let z = -H + 2; z <= H - 2; z++) for (let x = -H + 2; x <= H - 2; x++) {
    if (!free(x, z, 0)) continue;
    const v = hash2(x, z, 19);
    if (v < 0.05) L.set(x, 0, z, 'dry_grass');
    else if (v < 0.056 && free(x, z, 1)) dec(small[Math.floor(hash2(x, z, 20) * small.length)], x, z);
    else if (v < 0.06 && L.nameAt(x, -1, z) === 'basalt') L.set(x, 0, z, 'fire');
  }
  // ---------- герой, цель, мир: тёплый полумрак, дымка цвета пепла, искры и пепел в воздухе ----------
  L.spawn = [0, 0, 7];
  L.meta.spawnYaw = 270;
  L.meta.goal = ['Защити куст малины', 'Оборона куста'];
  L.meta.td = TD_SPEC;
  L.meta.world = {
    sun: { color: '#ffa868', intensity: 1.4, elevation: 32, azimuth: 230, shadows: true },
    sky: { color: '#1c0e0c', hemiSky: '#9a5a48', hemiGround: '#4a2418', hemi: 1.9, ambient: 0.24 },
    fog: { enabled: true, color: '#3a1c14', near: 18, far: 76 },
    weather: { kind: 'embers', intensity: 0.55, wind: 0.8 },
    post: { bloom: 0.7, bloomThreshold: 0.8, vignette: 0.3, saturation: 1.05, shadowTint: '#3a1a40', highTint: '#ff9a4a', tintAmount: 0.08 },
  };
  return L;
}
