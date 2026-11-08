import { Level } from './level.ts';
import { sutlerSpot } from './td-sutler.ts';
import { hash2, noise2 } from './kit.ts';
import { stampPrefab } from './prefab-lib/stamp.ts';
import type { LibraryPrefab } from './prefab-lib/types.ts';
import type { TdLane, TdPad, TdSpec } from '../td/types.ts';
import { TD_SPIRAL_WAVES } from '../td/waves-spiral.ts';

/**
 * "Raspberry Spiral" map — Bush Defence 4 (wiki/design-tower-defence.md, section 17): a floating island in a violet night,
 * one road winds from a rune portal on the north edge in 1¾ turns clockwise up to a mound with the raspberry bush in the centre.
 * The first turn lies on the meadow (+0); the second climbs half a block at a time to the plateau (+2), so mobs walk up the terrain
 * (src/mobs/mob.ts, `ground`). Between the turns — a ridge at the inner turn's height: a tower there reaches both turns.
 * From the fifth wave a second portal on the west edge opens a short path that joins the first turn three quarters along.
 * Radial stairways cut the terraces in four places, so the hero gets from the bush to any pad without walking the whole road.
 * `npm run map:td4` writes assets/maps/td4.json; open with `?map=td4`.
 */

export const SPIRAL_HALF = 48;
/** Spiral: radius from 40 m at the start, 2.8 m less per radian; the road ends at θ = 11 (r ≈ 9.2) on the plateau edge */
const R0 = 40, DR = 2.8, T_END = 11, TAU = Math.PI * 2;
/** Road half-width, m */
const ROAD = 1.75;
/** Plateau height (the bush), m */
const TOP = 2;
const rOf = (t: number): number => R0 - DR * t;
/** Point of the spiral's centre line at parameter θ: starts at the north (−z) and turns clockwise seen from above (towards +x) */
const at = (t: number): [number, number] => { const r = rOf(t), f = -Math.PI / 2 + t; return [r * Math.cos(f), r * Math.sin(f)]; };
/** Road height at θ: the first turn on the meadow, the second rises evenly to the plateau; in half-blocks */
const roadH = (t: number): number => Math.floor(Math.max(0, Math.min(1, (t - TAU) / (T_END - TAU))) * TOP * 2) / 2;
const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Points along the spiral from θ = a to θ = b every `step` rad */
const spiral = (a: number, b: number, step = 0.2): [number, number][] => {
  const out: [number, number][] = [];
  for (let t = a; t < b; t += step) { const [x, z] = at(t); out.push([r1(x), r1(z)]); }
  const [x, z] = at(b);
  out.push([r1(x), r1(z)]);
  return out;
};
/** End of the road: from the plateau edge straight to 4 m from the bush (the bush taunts from 7 m) */
const tail = (): [number, number] => { const [x, z] = at(T_END), k = 4 / Math.hypot(x, z); return [r1(x * k), r1(z * k)]; };
const WEST_JOIN = Math.PI * 1.5;

/** Enemy roads: the spiral from the north portal and the western shortcut that joins the first turn at θ = 3π/2 */
export const SPIRAL_LANES: TdLane[] = [
  { id: 'north', title: 'Spiral road', points: [[0, -46], [0, -41.5], ...spiral(0, T_END), tail()] },
  { id: 'west', title: 'West shortcut', points: [[-46, 0], [-36, 0], ...spiral(WEST_JOIN, T_END), tail()] },
];

/**
 * Terrain height at a point (before the stairways): outside the first turn — the meadow (0); between the turns — the ridge at the inner
 * turn's height; inside the second turn — the mound at the plateau height. The road itself — by `roadH` of the nearest point
 */
function baseHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let t0 = (Math.atan2(z, x) + Math.PI / 2) % TAU;
  if (t0 < 0) t0 += TAU;
  if (r >= rOf(t0)) return 0;
  const t1 = t0 + TAU;
  if (t1 <= T_END && r >= rOf(t1)) return roadH(t1);
  return TOP;
}

/** Nearest point of the road centre line: distance and θ (−1 — the west shortcut or the tail, θ unknown — height by the ends) */
const LINE: { x: number; z: number; t: number }[] = [];
for (let t = 0; t <= T_END + 1e-9; t += 0.02) { const [x, z] = at(t); LINE.push({ x, z, t }); }
for (let x = -47; x <= -26; x += 0.25) LINE.push({ x, z: 0, t: -1 });
for (let z = -47; z <= -40; z += 0.25) LINE.push({ x: 0, z, t: 0 });
{ const [ex, ez] = at(T_END), [tx, tz] = tail(); for (let k = 0; k <= 1; k += 0.05) LINE.push({ x: ex + (tx - ex) * k, z: ez + (tz - ez) * k, t: T_END }); }
function nearest(x: number, z: number): { d: number; t: number } {
  let d = Infinity, t = 0;
  for (const p of LINE) { const v = Math.hypot(p.x - x, p.z - z); if (v < d) { d = v; t = p.t; } }
  return { d, t };
}

/** Pads: on the ridge between the turns (reach both), on the meadow outside the first turn, on the mound over the second turn */
function makePads(): TdPad[] {
  const pads: { x: number; z: number }[] = [];
  const add = (r: number, t: number): void => { const f = -Math.PI / 2 + t; pads.push({ x: Math.round(r * Math.cos(f)), z: Math.round(r * Math.sin(f)) }); };
  // ridge: halfway between the turns, θ 0.55…4.55
  for (let t = 0.55; t <= 4.6; t += 0.4) add(rOf(t) - DR * Math.PI, t);
  // meadow: 8.5 m outside the first turn (no farther than 38.5 m from the centre, away from the rim), not on the west shortcut
  for (const t of [2.3, 2.85, 3.4, 3.95, 4.5, 5.05, 5.6, 6.1]) add(Math.min(rOf(t) + 8.5, 38.5), t);
  // mound: 6.5 m inside the second turn
  for (const t of [TAU + 0.6, TAU + 1.5, TAU + 2.4, TAU + 3.3]) add(rOf(t) - 6.5, t);
  // by the bush: one more on the plateau, away from the road's tail
  pads.push({ x: 6, z: -4 });
  return pads.filter((p) => !(Math.abs(p.z) < 5 && p.x < -28)).map((p) => ({ ...p, y: 0 }));
}
export const SPIRAL_PADS: TdPad[] = makePads();

export const SPIRAL_SPEC: TdSpec = {
  bush: { x: 0, y: TOP, z: 0, hp: 500 },
  lanes: SPIRAL_LANES,
  pads: SPIRAL_PADS,
  berries: 350,
  waves: TD_SPIRAL_WAVES,
  rest: 22,
  level: 4,
};

/**
 * Radial stairways: from the plateau edge (9 m) outward, 2.5 m wide; a slope of half a block per metre at most (the hero and mobs
 * climb a step). Angles — in the gaps between the pads: east-north-east, north, north-west
 */
const STAIRS = [22, -79, -145].map((d) => (d * Math.PI) / 180);
const STAIR_FROM = 9;

export function buildTdSpiralMap(lib: Record<string, LibraryPrefab>): Level {
  const H = SPIRAL_HALF;
  const key = (x: number, z: number): string => `${x},${z}`;
  // ---------- height field: terraces by the spiral, the road by its own height ----------
  const height = new Map<string, number>();
  const road = new Map<string, number>();
  const edgeR = (x: number, z: number): number => 45.2 + noise2(Math.atan2(z, x) * 7, 0, 1.3, 31) * 2.2;
  const island = (x: number, z: number): boolean => Math.hypot(x, z) <= edgeR(x, z);
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    if (!island(x, z)) continue;
    const n = nearest(x, z);
    if (n.d <= ROAD) {
      const h = n.t < 0 ? 0 : roadH(n.t);
      road.set(key(x, z), h);
      height.set(key(x, z), h);
    } else height.set(key(x, z), baseHeight(x, z));
  }
  // stairways: along the ray a "slope ≤ 0.5 per cell" envelope from below (cuts into the terraces, never raises; the road stays)
  for (const a of STAIRS) {
    const ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux;
    const cells: { k: string; s: number }[] = [];
    for (let s = STAIR_FROM; s <= 46; s += 0.5) for (let w = -1.25; w <= 1.25; w += 0.5) {
      const x = Math.round(ux * s + vx * w), z = Math.round(uz * s + vz * w), k = key(x, z);
      if (height.has(k) && !cells.some((c) => c.k === k)) cells.push({ k, s });
    }
    // the envelope by distance along the ray: the lowest height within reach, plus half a block per metre
    const byS = new Map<number, number>();
    for (const c of cells) { const s = Math.round(c.s); byS.set(s, Math.min(byS.get(s) ?? Infinity, height.get(c.k)!)); }
    const ss = [...byS.keys()].sort((p, q) => p - q), env = new Map<number, number>();
    for (const s of ss) env.set(s, byS.get(s)!);
    for (let i = 1; i < ss.length; i++) env.set(ss[i], Math.min(env.get(ss[i])!, env.get(ss[i - 1])! + 0.5 * (ss[i] - ss[i - 1])));
    for (let i = ss.length - 2; i >= 0; i--) env.set(ss[i], Math.min(env.get(ss[i])!, env.get(ss[i + 1])! + 0.5 * (ss[i + 1] - ss[i])));
    for (const c of cells) if (!road.has(c.k)) height.set(c.k, Math.min(height.get(c.k)!, env.get(Math.round(c.s))!));
  }
  const stairway = (x: number, z: number): boolean => STAIRS.some((a) => {
    const s = x * Math.cos(a) + z * Math.sin(a), w = -x * Math.sin(a) + z * Math.cos(a);
    return s > STAIR_FROM - 1 && Math.abs(w) < 2.2;
  });
  // pads: the height of the ground under them, a flat disk of 1.6 m at that height (outside the road)
  for (const p of SPIRAL_PADS) {
    const n = nearest(p.x, p.z);
    if (n.d < 4) throw new Error(`Pad ${p.x},${p.z} is too close to a road (${n.d.toFixed(1)} m)`);
    if (Math.hypot(p.x, p.z) < 6.5) throw new Error(`Pad ${p.x},${p.z} is on the bush square`);
    if (stairway(p.x, p.z)) throw new Error(`Pad ${p.x},${p.z} is on a stairway`);
    if (!island(p.x, p.z) || Math.hypot(p.x, p.z) > edgeR(p.x, p.z) - 3) throw new Error(`Pad ${p.x},${p.z} is at the island edge`);
    p.y = height.get(key(p.x, p.z)) ?? 0;
    for (let x = p.x - 2; x <= p.x + 2; x++) for (let z = p.z - 2; z <= p.z + 2; z++) if (Math.hypot(x - p.x, z - p.z) <= 1.6 && !road.has(key(x, z))) height.set(key(x, z), p.y);
  }
  for (let i = 0; i < SPIRAL_PADS.length; i++) for (let j = i + 1; j < SPIRAL_PADS.length; j++) {
    const a = SPIRAL_PADS[i], b = SPIRAL_PADS[j];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 5) throw new Error(`Pads ${a.x},${a.z} and ${b.x},${b.z} are too close`);
  }
  // bush square: the plateau at its height
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (Math.hypot(x, z) <= 5.6 && !road.has(key(x, z))) height.set(key(x, z), TOP);

  // ---------- blocks: an island of mauve rock, grass on top, the road of path, half-blocks on half heights ----------
  const L = new Level('Raspberry Spiral');
  const hAt = (x: number, z: number): number | undefined => height.get(key(x, z));
  for (const [k, h] of height) {
    const [x, z] = k.split(',').map(Number);
    const r = Math.hypot(x, z), toEdge = edgeR(x, z) - r;
    // the floating island's underside: deeper towards the middle, ragged
    const bottom = -3 - Math.floor(Math.min(9, toEdge * 0.45 + noise2(x, z, 5, 32) * 3));
    const full = Math.floor(h), half = h - full >= 0.5;
    // a cliff: a neighbour lower by a block or more — the side shows the mauve rock with a grass rim
    let drop = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = hAt(x + dx, z + dz); drop = Math.max(drop, h - (n ?? -10)); }
    const onRoad = road.has(k);
    for (let y = bottom; y < full; y++) {
      const topBlock = y === full - 1 && !half;
      let name: string;
      if (topBlock) name = onRoad ? (hash2(x, z, 2) < 0.85 ? 'path' : 'gravel') : drop >= 1 ? 'cliff_violet_grass' : (noise2(x, z, 6, 33) > 0.72 ? 'moss_block' : 'grass');
      else name = y >= full - 2 && drop < 1 ? 'dirt' : 'cliff_violet';
      L.set(x, y, z, name);
    }
    if (half) L.set(x, full, z, onRoad ? 'path_slab' : 'grass_slab');
  }
  // ---------- the island rim: a low rock wall over the void (nobody falls off), gaps only at the portals ----------
  const rim = new Set<string>();
  for (const [k, h] of height) {
    const [x, z] = k.split(',').map(Number);
    let edge = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!height.has(key(x + dx, z + dz))) edge = true;
    if (!edge || road.has(k)) continue;
    const hh = Math.floor(h) + 1 + (noise2(x, z, 4, 34) > 0.55 ? 1 : 0);
    for (let y = Math.floor(h); y < hh; y++) L.set(x, y, z, 'cliff_violet');
    L.set(x, hh, z, 'cliff_violet_grass');
    rim.add(k);
  }
  const used = new Set<string>([...road.keys(), ...rim]);
  const mark = (x: number, z: number, r: number): void => { for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) used.add(key(xx, zz)); };
  // ---------- portals: a rune arch of grey stone with a blue glow at the start of each road ----------
  for (const lane of SPIRAL_LANES) {
    const [x, z] = lane.points[0], [nx, nz] = lane.points[1];
    const dx = Math.sign(nx - x), dz = Math.sign(nz - z);
    for (let w = -2; w <= 2; w++) for (let y = 0; y < 5; y++) {
      const cx = x - dx + (dz ? w : 0), cz = z - dz + (dx ? w : 0);
      const edge = Math.abs(w) === 2 || y === 4;
      if (edge) L.set(cx, y, cz, y === 4 && Math.abs(w) < 2 ? 'portal_trim' : 'portal_frame');
      else L.set(cx, y, cz, 'portal_blue', dx ? 1 : 0);
      if (!height.has(key(cx, cz))) for (let y2 = -4; y2 < 0; y2++) L.set(cx, y2, cz, 'cliff_violet');
    }
    for (let w = -1; w <= 1; w++) for (let k = 0; k <= 1; k++) L.set(x + dx * k + (dz ? w : 0), -1, z + dz * k + (dx ? w : 0), 'portal_floor');
    for (const s of [-1, 1]) {
      const tx = x + dx * 2 + (dz ? 3 * s : 0), tz = z + dz * 2 + (dx ? 3 * s : 0);
      if (height.get(key(tx, tz)) === 0) { L.set(tx, 0, tz, 'crystal'); L.set(tx, 1, tz, 'crystal_small'); }
    }
    mark(x, z, 3);
  }
  // ---------- the bush square: slabs in a ring of mossy stone, raspberry bushes around, lanterns ----------
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
    const d = Math.hypot(x, z);
    if (road.has(key(x, z)) || d > 5.6) continue;
    if (d <= 4.6) L.set(x, TOP - 1, z, hash2(x, z, 4) < 0.85 ? 'tiles' : 'tiles_broken');
    else { L.set(x, TOP - 1, z, 'mossy'); if (hash2(x, z, 5) < 0.55 && nearest(x, z).d > 3) L.set(x, TOP, z, 'berry_bush'); }
    used.add(key(x, z));
  }
  for (const [x, z] of [[3.5, 3.5], [-3.5, 3.5], [3.5, -3.5]]) L.addDecor({ name: 'lantern_post', pos: [x, TOP, z], rot: [45] });
  // ---------- pads: a circle of slabs, a mossy rim, posts on the diagonals, a small crystal ----------
  for (const p of SPIRAL_PADS) {
    // the top cell of the pad: a full block under a whole height, a half-block on a half height (the ridge climbs by half a block)
    const half = (p.y ?? 0) % 1 !== 0, y = half ? Math.floor(p.y ?? 0) : Math.floor(p.y ?? 0) - 1;
    for (let x = p.x - 3; x <= p.x + 3; x++) for (let z = p.z - 3; z <= p.z + 3; z++) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (road.has(key(x, z)) || hAt(x, z) !== p.y) continue;
      if (d <= 1.6) L.set(x, y, z, half ? 'tiles_slab' : 'tiles'); else if (d <= 2.4) L.set(x, y, z, half ? 'cobble_slab' : 'mossy');
    }
    // posts and a crystal stand on whole blocks only — over a half-block they would hang in the air
    if (!half) for (const [sx, sz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) if (hAt(p.x + sx, p.z + sz) === p.y && !road.has(key(p.x + sx, p.z + sz)) && L.isAir(p.x + sx, y + 1, p.z + sz)) L.set(p.x + sx, y + 1, p.z + sz, 'wall_stone_slab');
    if (!half && hAt(p.x + 2, p.z) === p.y && L.isAir(p.x + 2, y + 1, p.z)) L.set(p.x + 2, y + 1, p.z, 'crystal_small');
    mark(p.x, p.z, 3);
  }
  // the defence sutler (wiki section 12): on the plateau north-west of the bush, between the stairways, before the decor takes the ground
  const sutler = sutlerSpot(L, SPIRAL_LANES, SPIRAL_PADS, -4, -9, 0, 0, TOP - 1);
  if (!sutler) throw new Error('No room for the sutler');
  mark(sutler.x, sutler.z, 3);
  // ---------- giant roots: two dark-teal arcs over the island's edge, like the reference's tentacles ----------
  const arc = (ax: number, az: number, bx: number, bz: number, top: number): void => {
    for (let k = 0; k <= 1; k += 0.02) {
      const x = ax + (bx - ax) * k, z = az + (bz - az) * k, y = Math.round(-2 + Math.sin(Math.PI * k) * top);
      for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) { const cx = Math.round(x) + dx, cz = Math.round(z) + dz; if (!height.has(key(cx, cz)) || rim.has(key(cx, cz))) for (let dy = 0; dy <= 1; dy++) L.set(cx, y + dy, cz, 'log_jungle'); }
    }
  };
  arc(30, -44, 48, -18, 16);
  arc(-48, 22, -24, 46, 14);
  // ---------- decor: lanterns at the bends, trees and boulders on the meadow and the ridge, glowing mushrooms, crystals, flowers ----------
  const groundTop = (x: number, z: number): number | null => { const h = hAt(x, z); return h === undefined || h % 1 ? null : h; };
  const free = (x: number, z: number, r: number): boolean => {
    const h = groundTop(x, z);
    if (h === null) return false;
    for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) {
      if (used.has(key(xx, zz)) || groundTop(xx, zz) !== h || stairway(xx, zz) || !L.isAir(xx, h, zz)) return false;
    }
    return nearest(x, z).d > ROAD + r + 1;
  };
  const stamp = (id: string, x: number, z: number, q = 0): boolean => {
    const p = lib[id];
    if (!p) throw new Error(`No prefab "${id}"`);
    const rr = Math.max(Math.ceil(p.size[0] / 2), Math.ceil(p.size[2] / 2)) + 1;
    if (!free(x, z, rr)) return false;
    const r = stampPrefab(L, p, x, groundTop(x, z)!, z, q);
    for (const d of r.decor) L.addDecor(d);
    L.entities.push(...r.entities);
    mark(x, z, rr);
    return true;
  };
  for (let t = 0.6; t < T_END - 0.3; t += 0.85) {
    const r = rOf(t), out = (Math.round(t / 0.85) % 2 ? 1 : -1) * (ROAD + 1.2), f = -Math.PI / 2 + t;
    const x = Math.round((r + out) * Math.cos(f)), z = Math.round((r + out) * Math.sin(f));
    const h = groundTop(x, z);
    if (h === null || used.has(key(x, z)) || road.has(key(x, z)) || stairway(x, z)) continue;
    L.addDecor({ name: 'lantern_post', pos: [x, h, z], rot: [Math.round(hash2(x, z, 9) * 4) * 90] });
    mark(x, z, 1);
  }
  const shroom = (x: number, z: number, pink: boolean): boolean => {
    if (!free(x, z, 1)) return false;
    const h = groundTop(x, z)!;
    L.set(x, h, z, 'shroom_stem');
    L.set(x, h + 1, z, pink ? 'shroom_cap_pink' : 'shroom_cap_blue');
    L.set(x, h + 2, z, pink ? 'shroom_cap_pink_slab' : 'shroom_cap_blue_slab');
    mark(x, z, 1);
    return true;
  };
  stamp('ruin_platform_statues', 30, 30, 2);
  stamp('crystal_cluster_big', -34, -26, 1);
  stamp('crystal_cluster_big', 34, -26, 3);
  for (let z = -H + 3; z <= H - 3; z += 3) for (let x = -H + 3; x <= H - 3; x += 3) {
    const v = hash2(x, z, 12), d = nearest(x, z).d;
    if (d < 4.5) continue;
    if (v < 0.07) shroom(x, z, hash2(x, z, 14) < 0.5);
    else if (v < 0.11) stamp(hash2(x, z, 16) < 0.4 ? 'crystal_cluster_small' : 'crystal_cluster_small_2', x, z, Math.floor(hash2(x, z, 17) * 4));
    else if (v < 0.24) stamp(['tree_oak', 'tree_oak_2', 'tree_oak_3', 'bush_cluster', 'bush_cluster_2', 'mossy_boulders', 'tree_dead'][Math.floor(hash2(x, z, 18) * 7)], x, z, Math.floor(hash2(x, z, 19) * 4));
  }
  for (const [k] of height) {
    const [x, z] = k.split(',').map(Number);
    if (used.has(k) || stairway(x, z) || nearest(x, z).d < ROAD + 0.6) continue;
    const h = groundTop(x, z);
    if (h === null || !L.isAir(x, h, z)) continue;
    const v = hash2(x, z, 24);
    if (v < 0.035) L.set(x, h, z, hash2(x, z, 25) < 0.5 ? 'fern' : 'fern_big');
    else if (v < 0.075) L.set(x, h, z, ['flower_red', 'flower_blue', 'flower_pink', 'flower_white'][Math.floor(hash2(x, z, 26) * 4)]);
    else if (v < 0.085) L.set(x, h, z, 'crystal_small');
    else if (v < 0.1 && h === TOP) L.set(x, h, z, 'berry_bush');
    else if (v < 0.12) L.set(x, h, z, 'tall_grass');
  }
  // ---------- hero, goal, world: a violet dusk — a warm low sun, a lilac sky, fireflies, lanterns ----------
  L.spawn = [0, TOP, 3];
  L.meta.spawnYaw = 90;
  L.meta.goal = ['Defend the raspberry bush', 'Raspberry Spiral'];
  L.meta.merchants = [sutler];
  L.meta.td = SPIRAL_SPEC;
  L.meta.world = {
    sun: { color: '#ffd2a8', intensity: 1.05, elevation: 42, azimuth: 215, shadows: true },
    sky: { color: '#2a1650', hemiSky: '#a88ae0', hemiGround: '#4a6a2a', hemi: 1.6, ambient: 0.32 },
    fog: { enabled: true, color: '#3a2262', near: 42, far: 125 },
    weather: { kind: 'fireflies', intensity: 0.5, wind: 0.2 },
    post: { bloom: 0.7, bloomThreshold: 0.75, vignette: 0.28, saturation: 1.2, shadowTint: '#3a1a6a', highTint: '#ffd8a0', tintAmount: 0.1 },
  };
  return L;
}
