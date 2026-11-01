import { Level } from './level.ts';
import { sutlerSpot } from './td-sutler.ts';
import { hash2, noise2 } from './kit.ts';
import { stampPrefab } from './prefab-lib/stamp.ts';
import type { LibraryPrefab } from './prefab-lib/types.ts';
import type { TdLane, TdPad, TdSpec, TdWall } from '../td/types.ts';
import { TD_CASTLE_WAVES } from '../td/waves-castle.ts';

/**
 * Карта «Замок на лугу» — осада, оборона куста 3 (wiki/design-tower-defence.md, раздел 9; референсы замков — wiki/sources/td-refs.md).
 * Луг 96 × 96 м, в центре **замок**: квадрат стен 39 × 39 м высотой 3 блока с зубцами и дорожкой поверху, по углам
 * бастионы с площадками под башни, на севере **ворота** между двумя надвратными башнями (тоже с площадками), внутри —
 * двор с кустом малины, четыре площадки, колодец и лестницы на стены (ступени у внутренних граней). Враги идут
 * **с четырёх сторон**: северная дорога упирается в ворота, восточная, южная и западная — в стены; стены и ворота —
 * `meta.td.walls` (src/td/wall.ts): их ломают и чинят. Лагеря врагов скрыты **туманом** (`meta.td.mist`, src/td/mist-fx.ts),
 * дымка мира плотная — с замка точки выхода не видны. `npm run map:td3` пишет assets/maps/td3.json; открыть — `?map=td3`.
 */

export const CASTLE_HALF = 48;
/** Двор — |x|, |z| ≤ IN; стена — полоса [IN + 1 .. OUT]; бастионы — углы до OUT + 2 */
const IN = 16, OUT = 19, TOP = 2;

/** Дороги врагов: до стены или ворот, дальше (`inner`) — к кусту, когда пролом пробит */
export const CASTLE_LANES: TdLane[] = [
  { id: 'north', title: 'Северная дорога', points: [[0, -46], [0, -38], [0, -31], [0, -25]], wall: 'gate', inner: [[0, -15], [0, -4]] },
  { id: 'east', title: 'Восточная дорога', points: [[46, -8], [37, -8], [28, -5], [24, 0]], wall: 'east', inner: [[15, 0], [4, 0]] },
  { id: 'south', title: 'Южная дорога', points: [[-8, 46], [-8, 37], [-5, 28], [0, 24]], wall: 'south', inner: [[0, 15], [0, 4]] },
  { id: 'west', title: 'Западная дорога', points: [[-46, 8], [-37, 8], [-28, 5], [-24, 0]], wall: 'west', inner: [[-15, 0], [-4, 0]] },
];

/** Площадки: четыре угловых бастиона, две надвратные башни и шесть малых бастионов по бокам проломов (на высоте стены), четыре во дворе */
export const CASTLE_PADS: TdPad[] = [
  { x: -19, z: -19, y: 3 }, { x: 19, z: -19, y: 3 }, { x: -19, z: 19, y: 3 }, { x: 19, z: 19, y: 3 },
  { x: -4, z: -19, y: 3 }, { x: 4, z: -19, y: 3 },
  { x: 19, z: -5, y: 3 }, { x: 19, z: 5, y: 3 }, { x: -19, z: -5, y: 3 }, { x: -19, z: 5, y: 3 }, { x: -5, z: 19, y: 3 }, { x: 5, z: 19, y: 3 },
  { x: -10, z: -9 }, { x: 10, z: -9 }, { x: -10, z: 8 }, { x: 10, z: 8 },
];

/** Стены и ворота: прямоугольники клеток, здоровье, клетка пролома на наружной грани */
export const CASTLE_WALLS: TdWall[] = [
  { id: 'gate', title: 'Северные ворота', kind: 'gate', x0: -1, z0: -OUT, x1: 1, z1: -IN - 1, y0: 0, y1: 1, hp: 250, breach: [0, -OUT], out: [0, -1] },
  { id: 'east', title: 'Восточная стена', kind: 'wall', x0: IN + 1, z0: -IN, x1: OUT, z1: IN, y0: 0, y1: TOP, hp: 400, breach: [OUT, 0], out: [1, 0] },
  { id: 'south', title: 'Южная стена', kind: 'wall', x0: -IN, z0: IN + 1, x1: IN, z1: OUT, y0: 0, y1: TOP, hp: 400, breach: [0, OUT], out: [0, 1] },
  { id: 'west', title: 'Западная стена', kind: 'wall', x0: -OUT, z0: -IN, x1: -IN - 1, z1: IN, y0: 0, y1: TOP, hp: 400, breach: [-OUT, 0], out: [-1, 0] },
];

export const CASTLE_SPEC: TdSpec = {
  bush: { x: 0, z: 0, hp: 600 },
  lanes: CASTLE_LANES,
  pads: CASTLE_PADS,
  berries: 400,
  waves: TD_CASTLE_WAVES,
  rest: 25,
  level: 5,
  walls: CASTLE_WALLS,
  towers: ['arrow', 'frost', 'splash', 'fire', 'magic', 'meteor', 'storm', 'winter', 'ballista', 'oil'],
  repair: 20,
  mist: { radius: 13, density: 0.75, color: '#dfe7ee' },
};

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};
const laneDist = (x: number, z: number): number => {
  let best = Infinity;
  for (const l of CASTLE_LANES) for (let i = 0; i + 1 < l.points.length; i++) best = Math.min(best, segDist(x, z, l.points[i][0], l.points[i][1], l.points[i + 1][0], l.points[i + 1][1]));
  return best;
};

export function buildTdCastleMap(lib: Record<string, LibraryPrefab>): Level {
  const L = new Level('Замок на лугу');
  const H = CASTLE_HALF;
  const used = new Set<string>();
  const key = (x: number, z: number): string => `${x},${z}`;
  const mark = (x: number, z: number, r: number): void => { for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) used.add(key(xx, zz)); };
  const inMap = (x: number, z: number): boolean => Math.abs(x) <= H && Math.abs(z) <= H;
  const inCastle = (x: number, z: number): boolean => Math.abs(x) <= OUT + 2 && Math.abs(z) <= OUT + 2;
  // ---------- луг: трава с сухими и цветочными пятнами, тропинки врагов ----------
  // сухая трава и ромашки — растения без коллизии: только поверх земли, иначе герой проваливается в клетку
  const flora = new Map<string, string>();
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    const n = noise2(x, z, 9, 1);
    L.set(x, -1, z, 'grass');
    L.set(x, -2, z, 'dirt');
    if (n > 0.72) flora.set(key(x, z), 'dry_grass'); else if (n < 0.2) flora.set(key(x, z), 'daisies');
  }
  const road = new Set<string>();
  for (const lane of CASTLE_LANES) for (let i = 0; i + 1 < lane.points.length; i++) {
    const [ax, az] = lane.points[i], [bx, bz] = lane.points[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let t = 0; t <= n; t++) {
      const x = Math.round(ax + ((bx - ax) * t) / n), z = Math.round(az + ((bz - az) * t) / n);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (inMap(x + dx, z + dz) && !inCastle(x + dx, z + dz)) road.add(key(x + dx, z + dz));
    }
  }
  for (const k of road) {
    const [x, z] = k.split(',').map(Number);
    const v = hash2(x, z, 2);
    L.set(x, -1, z, v < 0.7 ? 'path' : v < 0.85 ? 'gravel' : 'cobble');
    used.add(k);
  }
  // ---------- замок ----------
  const brick = (x: number, y: number, z: number): string => (y === 0 && hash2(x, z, 3) < 0.3) || hash2(x + y * 3, z, 4) < 0.06 ? 'bricks_mossy' : 'bricks';
  const wallCell = (x: number, z: number): boolean => (Math.abs(x) > IN || Math.abs(z) > IN) && Math.abs(x) <= OUT && Math.abs(z) <= OUT;
  const side = (v: number): boolean => Math.abs(v) >= 3 && Math.abs(v) <= 7;
  const bastion = (x: number, z: number): boolean => (Math.abs(x) >= IN + 1 && Math.abs(x) <= OUT + 2 && Math.abs(z) >= IN + 1 && Math.abs(z) <= OUT + 2) // угловые
    || (Math.abs(x) >= 2 && Math.abs(x) <= 6 && z <= -IN - 1 && z >= -OUT - 2) // надвратные
    || (Math.abs(x) >= IN + 1 && Math.abs(x) <= OUT + 2 && side(z)) || (side(x) && z >= IN + 1 && z <= OUT + 2); // малые у проломов
  const gate = (x: number, z: number): boolean => Math.abs(x) <= 1 && z <= -IN - 1 && z >= -OUT;
  for (let x = -OUT - 2; x <= OUT + 2; x++) for (let z = -OUT - 2; z <= OUT + 2; z++) {
    used.add(key(x, z));
    if (bastion(x, z)) {
      // бастион: булыжник, верх — плиты, зубцы по наружным граням
      L.set(x, -1, z, 'cobble');
      for (let y = 0; y <= TOP; y++) L.set(x, y, z, y === TOP ? 'tiles' : hash2(x + y, z, 5) < 0.25 ? 'cobble' : 'bricks');
      const corner = Math.abs(x) >= IN + 1 && Math.abs(z) >= IN + 1;
      const outer = corner ? Math.abs(x) === OUT + 2 || Math.abs(z) === OUT + 2
        : z < -IN ? z === -OUT - 2 || (z < -OUT && (Math.abs(x) === 6 || Math.abs(x) === 2)) // боковые зубцы — только на выступе, дорожка по стене свободна
        : Math.abs(x) > IN ? Math.abs(x) === OUT + 2 || (Math.abs(x) > OUT && (Math.abs(z) === 3 || Math.abs(z) === 7))
        : Math.abs(z) === OUT + 2 || (Math.abs(z) > OUT && (Math.abs(x) === 3 || Math.abs(x) === 7));
      if (outer) L.set(x, TOP + 1, z, (x + z) % 2 === 0 ? 'bricks' : 'bricks_slab');
      continue;
    }
    if (gate(x, z)) {
      // проём ворот: пол из плит, свод из кирпича, сверху дорожка
      L.set(x, -1, z, 'tiles');
      L.set(x, TOP, z, 'bricks');
      if (z === -OUT) L.set(x, TOP + 1, z, x === 0 ? 'bricks_slab' : 'bricks');
      continue;
    }
    if (wallCell(x, z)) {
      // куртина: кирпич, верх внутренних рядов — плиты (дорожка), наружный ряд — зубцы
      L.set(x, -1, z, 'cobble');
      const outer = Math.abs(x) === OUT || Math.abs(z) === OUT;
      for (let y = 0; y <= TOP; y++) L.set(x, y, z, y === TOP && !outer ? 'tiles' : brick(x, y, z));
      if (outer) L.set(x, TOP + 1, z, (x + z) % 2 === 0 ? 'bricks' : 'bricks_slab');
      continue;
    }
    // двор: плиты у куста и дорожек, остальное — утоптанная земля с травой
    const d = Math.hypot(x, z), v = hash2(x, z, 6);
    if (d <= 5) L.set(x, -1, z, v < 0.85 ? 'tiles' : 'tiles_broken');
    else if (Math.abs(x) <= 1 || (Math.abs(z) <= 1 && Math.abs(x) <= IN)) L.set(x, -1, z, v < 0.8 ? 'tiles' : 'cobble');
    else L.set(x, -1, z, v < 0.5 ? 'yard_floor' : v < 0.8 ? 'path' : 'grass');
  }
  // лестницы на стены у внутренних граней: три ступени в высоту (rot 0 — подъём к +X, 1 — к +Z)
  const ramp = (x: number, z: number, dx: number, dz: number, rot: number): void => {
    for (let c = 0; c < 3; c++) {
      const cx = x + dx * c, cz = z + dz * c;
      for (let y = 0; y < c; y++) L.set(cx, y, cz, 'bricks');
      L.set(cx, c, cz, 'bricks_stairs', rot);
      L.set(cx, -1, cz, 'tiles');
    }
  };
  ramp(-12, -IN, 1, 0, 0); ramp(8, IN, 1, 0, 0); ramp(IN, -12, 0, 1, 1); ramp(-IN, 8, 0, 1, 1);
  // ---------- площадки: круг плит с бортиком; на стенах — просто круг ----------
  for (const p of CASTLE_PADS) {
    const y = (p.y ?? 0) - 1;
    for (let x = p.x - 2; x <= p.x + 2; x++) for (let z = p.z - 2; z <= p.z + 2; z++) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= 1.6) L.set(x, y, z, 'tiles'); else if (d <= 2.4 && !p.y) L.set(x, y, z, 'cobble');
    }
    if (!p.y) for (const [sx, sz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) L.set(p.x + sx, 0, p.z + sz, 'cobble_slab');
    mark(p.x, p.z, 3);
  }
  // ---------- декор двора: колодец, фонари, знамёна, бочки у стен ----------
  const stamp = (id: string, x: number, z: number, q = 0, force = false): boolean => {
    const p = lib[id];
    if (!p) throw new Error(`Нет пресета «${id}»`);
    const rx = Math.ceil(p.size[0] / 2) + 1, rz = Math.ceil(p.size[2] / 2) + 1, r = Math.max(rx, rz);
    if (!force && !free(x, z, r)) return false;
    const res = stampPrefab(L, p, x, 0, z, q);
    for (const d of res.decor) L.addDecor(d);
    L.entities.push(...res.entities);
    mark(x, z, r);
    return true;
  };
  const free = (x: number, z: number, r: number): boolean => {
    for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) if (Math.abs(xx) > H - 1 || Math.abs(zz) > H - 1 || used.has(key(xx, zz)) || road.has(key(xx, zz)) || L.topAt(xx, zz) !== -1) return false;
    return true;
  };
  const dec = (name: string, x: number, z: number, rot = 0, y = 0): void => { L.addDecor({ name, pos: [x, y, z], rot: [rot] }); mark(x, z, 1); };
  stamp('well', 0, 11, 0, true);
  for (const [x, z] of [[-4, 4], [4, 4], [-4, -5], [4, -5]]) dec('lantern_post', x, z, 45);
  for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) dec('lantern_post', x, z, 0);
  for (const [x, z] of [[-13, 3], [13, -3], [-6, 14], [6, -14]]) { L.set(x, 0, z, 'crate'); mark(x, z, 1); }
  for (const [x, z] of [[-14, 5], [14, -5], [5, 14]]) dec('barrel', x, z, 0);
  // ---------- логова врагов: лагеря у края дорог — палатки, костёр, частокол ----------
  for (const lane of CASTLE_LANES) {
    const [x, z] = lane.points[0], [nx, nz] = lane.points[1];
    const dx = Math.sign(nx - x), dz = Math.sign(nz - z);
    for (let k = -2; k <= 2; k++) for (let w = -4; w <= 4; w++) {
      const cx = x - dx * k + (dz ? w : 0), cz = z - dz * k + (dx ? w : 0);
      if (inMap(cx, cz) && !road.has(key(cx, cz))) { L.set(cx, -1, cz, hash2(cx, cz, 8) < 0.6 ? 'dirt' : 'path'); used.add(key(cx, cz)); }
    }
    for (const s of [-1, 1]) {
      const tx = x + dx * 1 + (dz ? 4 * s : 0), tz = z + dz * 1 + (dx ? 4 * s : 0);
      if (inMap(tx, tz)) dec('tent', tx, tz, Math.atan2(dx, dz) * 180 / Math.PI + 180 + s * 30);
      const fx = x + dx * 5 + (dz ? 3 * s : 0), fz = z + dz * 5 + (dx ? 3 * s : 0);
      if (inMap(fx, fz) && L.isAir(fx, 0, fz) && !road.has(key(fx, fz))) { L.set(fx, 0, fz, 'stake_fence'); mark(fx, fz, 0); }
    }
    const cx = x + dx * 3 + (dz ? -6 : 0), cz = z + dz * 3 + (dx ? -6 : 0);
    if (inMap(cx, cz) && L.isAir(cx, 0, cz)) { L.set(cx, 0, cz, 'campfire'); mark(cx, cz, 1); }
  }
  // ---------- край карты: лес и скалы ----------
  for (let i = -H - 1; i <= H + 1; i++) for (const [x, z] of [[i, -H - 1], [i, H + 1], [-H - 1, i], [H + 1, i]]) {
    const hh = 2 + (noise2(x, z, 4, 9) > 0.55 ? 1 : 0);
    for (let y = -1; y < hh; y++) L.set(x, y, z, 'cliff');
    L.set(x, hh, z, 'cliff_grass');
  }
  for (let i = -H + 3; i <= H - 3; i += 4) for (const [x, z] of [[i, -H + 3], [i, H - 3], [-H + 3, i], [H - 3, i]]) {
    stamp(hash2(x, z, 20) < 0.5 ? 'tree_pine_dark' : hash2(x, z, 20) < 0.8 ? 'tree_oak' : 'tree_oak_2', x + Math.floor(hash2(x, z, 21) * 3) - 1, z + Math.floor(hash2(x, z, 22) * 3) - 1, Math.floor(hash2(x, z, 23) * 4));
  }
  // ---------- луг: рощи, валуны, руины, цветы ----------
  for (let z = -H + 5; z <= H - 5; z += 3) for (let x = -H + 5; x <= H - 5; x += 3) {
    if (inCastle(x, z) || Math.abs(x) < OUT + 6 && Math.abs(z) < OUT + 6) continue;
    const v = hash2(x, z, 12), d = laneDist(x, z);
    if (d < 4) continue;
    if (v < 0.1) stamp(['tree_oak', 'tree_oak_2', 'tree_golden_small', 'tree_pine_dark', 'bush_cluster', 'bush_cluster'][Math.floor(hash2(x, z, 18) * 6)], x, z, Math.floor(hash2(x, z, 19) * 4));
    else if (v < 0.14) stamp(hash2(x, z, 16) < 0.5 ? 'boulder_group' : 'boulder_single', x, z, Math.floor(hash2(x, z, 17) * 4));
    else if (v < 0.17) stamp(hash2(x, z, 16) < 0.5 ? 'meadow_flowers' : 'meadow_dry', x, z);
    else if (v < 0.185) stamp(['ruin_arch', 'ruin_column_row', 'ruin_corner', 'stump_logs', 'hay_stack', 'cart_broken'][Math.floor(hash2(x, z, 18) * 6)], x, z, Math.floor(hash2(x, z, 19) * 4));
  }
  for (let z = -H + 2; z <= H - 2; z++) for (let x = -H + 2; x <= H - 2; x++) {
    if (inCastle(x, z) || !free(x, z, 0)) continue;
    const v = hash2(x, z, 24);
    const f = flora.get(key(x, z));
    if (f && hash2(x, z, 27) < 0.35) L.set(x, 0, z, f);
    else if (v < 0.06) L.set(x, 0, z, 'tall_grass');
    else if (v < 0.09) L.set(x, 0, z, ['flower_pink', 'flower_blue', 'flower_white', 'flower_yellow', 'flower_red'][Math.floor(hash2(x, z, 26) * 5)]);
    else if (v < 0.1) L.set(x, 0, z, 'fern');
  }
  // ---------- герой, цель, мир: ясный день ----------
  L.spawn = [0, 0, 6];
  L.meta.spawnYaw = 270;
  L.meta.goal = ['Удержи замок', 'Замок на лугу'];
  // маркитант обороны (раздел 12 вики): у точки появления, не на дороге и не у площадки
  const sutler = sutlerSpot(L, CASTLE_LANES, CASTLE_PADS, 4, 8);
  if (!sutler) throw new Error('Нет места для маркитанта');
  L.meta.merchants = [sutler];
  L.meta.td = CASTLE_SPEC;
  L.meta.world = {
    sun: { color: '#fff0d4', intensity: 1.1, elevation: 56, azimuth: 150, shadows: true },
    sky: { color: '#8fc4f0', hemiSky: '#bfe0ff', hemiGround: '#5a7a3a', hemi: 0.9, ambient: 0.35 },
    fog: { enabled: true, color: '#d3e2ee', near: 20, far: 52 },
    weather: { kind: 'clear', intensity: 0, wind: 0.3 },
    post: { bloom: 0.3, bloomThreshold: 0.85, vignette: 0.2, saturation: 1.08, shadowTint: '#2a4a6a', highTint: '#fff4d0', tintAmount: 0.06 },
  };
  return L;
}
