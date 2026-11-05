import { jungleGroundAt, rockOutcrop } from '../kit.ts';
import { bake, stampInto, type BuildCtx, type Builder } from './build.ts';
import { onWall, pillar, wallRun, type Mat } from './builders-ruins.ts';

/**
 * The "jungle with crystals" biome (wiki/design-prefab-library.md, "Biomes" section; reference 16 — MCD, the jungle temple).
 * `jungle_floor` ground in a ragged-edged outline, wide trees with buttress roots and a flat crown, thickets,
 * glowing crystals (the `glow` layer + baked teal light), a temple of teal-grey stone with carvings and moss —
 * via the ruin helpers with the `TEMPLE` material. The `temple_ruins_jungle` composition is nested from medium prefabs.
 */

const pick = <T,>(c: BuildCtx, list: T[]): T => list[Math.floor(c.rnd() * list.length)];
const yaw = (c: BuildCtx): number => Math.floor(c.rnd() * 360);
/** Temple material for pillar / wallRun / arch */
export const TEMPLE: Mat = { full: 'temple_stone', low: 'temple_stone_mossy', cracked: 'temple_stone_carved', stairs: 'temple_stone_stairs', slab: 'temple_stone_slab' };
/** Builder registry — passed in from builders.ts (the composition nests medium ones by id) */
let ALL: Builder[] = [];
const find = (id: string): Builder => { const b = ALL.find((b) => b.id === id); if (!b) throw new Error(`No builder "${id}"`); return b; };
/** Nest a medium prefab by builder id (variant — its own seed, rotation — quarters) */
function use(c: BuildCtx, id: string, x: number, z: number, quarter = 0, seed?: number): void {
  const b = find(id);
  stampInto(c, bake(b, seed ?? 1 + Math.floor(c.rnd() * (b.variants ?? 1))), x, z, quarter);
}

const GROUND_J = new Set(['jungle_floor', 'jungle_floor_red', 'moss_teal', 'moss_block']);
/** Jungle ground in an rx × rz ellipse with a ragged edge (cells y = −1): a mosaic of blocks by noise (jungleGroundAt), water and stone untouched */
function jungleGround(c: BuildCtx, rx: number, rz: number, cx = 0, cz = 0): void {
  for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) for (let z = Math.floor(cz - rz - 1); z <= Math.ceil(cz + rz + 1); z++) {
    const e = ((x + 0.5 - cx) / rx) ** 2 + ((z + 0.5 - cz) / rz) ** 2;
    if (e <= 1 + (c.rnd() - 0.5) * 0.35 && c.L.nameAt(x, -1, z) === 'air') c.L.set(x, -1, z, jungleGroundAt(x, z, c.seed * 11));
  }
}
/** Undergrowth: ferns, vines, flowers, moss and small crystals on free ground cells within radius r */
function undergrowth(c: BuildCtx, n: number, r: number, crystals = 0.08): void {
  for (let i = 0; i < n; i++) {
    const x = Math.round((c.rnd() - 0.5) * 2 * r), z = Math.round((c.rnd() - 0.5) * 2 * r);
    if (c.L.nameAt(x, 0, z) !== 'air' || !GROUND_J.has(c.L.nameAt(x, -1, z))) continue;
    const v = c.rnd();
    if (v < crystals) c.L.set(x, 0, z, 'crystal_small');
    else if (v < 0.4) c.L.set(x, 0, z, 'fern_big');
    else if (v < 0.55) c.L.set(x, 0, z, 'fern');
    else if (v < 0.7) c.L.set(x, 0, z, 'moss_carpet');
    else if (v < 0.85) c.L.set(x, 0, z, 'flower_pink');
    else c.L.set(x, 0, z, 'vine');
  }
}
/** A flat wide crown: an ellipse of radius r in two layers (the lower fuller), caps of leaves_jungle */
function canopy(c: BuildCtx, x: number, y: number, z: number, r: number): void {
  for (const [dy, rr] of [[0, r], [1, r - 1.2], [-1, r - 2.2]] as [number, number][]) {
    if (rr <= 0) continue;
    const ri = Math.ceil(rr);
    for (let dx = -ri; dx <= ri; dx++) for (let dz = -ri; dz <= ri; dz++) {
      if (dx * dx + dz * dz > rr * rr + 0.3 + (c.rnd() - 0.5) * 0.7) continue;
      if (c.L.nameAt(x + dx, y + dy, z + dz) === 'air') c.L.set(x + dx, y + dy, z + dz, 'leaves_jungle');
    }
  }
}
/** Big jungle tree: a 2 × 2 trunk of log_jungle of height h, buttress roots, a flat 7 × 7 crown */
export function jungleTreeBig(c: BuildCtx, x: number, z: number, h: number): void {
  for (let k = 0; k < h; k++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) c.L.set(x + dx, k, z + dz, 'log_jungle');
  // buttresses: a log block at the foot on four sides and root decor
  for (const [dx, dz] of [[-1, 0], [2, 1], [1, -1], [0, 2]]) {
    if (c.rnd() < 0.85) c.L.set(x + dx, 0, z + dz, 'log_jungle');
    if (c.rnd() < 0.4) c.L.set(x + dx, 1, z + dz, 'log_jungle');
  }
  c.dec('roots_big', x + 1, 0, z + 1, yaw(c));
  canopy(c, x + 1, h, z + 1, 3.6);
  // vines hang from the crown
  for (let i = 0; i < 3; i++) { const dx = pick(c, [-3, -2, 3, 4]), dz = pick(c, [-3, 4, -2, 3]); if (c.L.nameAt(x + dx, h - 1, z + dz) !== 'air') c.dec('vines_hanging', x + dx, h - 1, z + dz, yaw(c), [x + dx, h - 1, z + dz]); }
}
/** Small tree: a 1 × 1 trunk of height h, a 5 × 5 crown */
export function jungleTreeSmall(c: BuildCtx, x: number, z: number, h: number): void {
  for (let k = 0; k < h; k++) c.L.set(x, k, z, 'log_jungle');
  canopy(c, x, h, z, 2.4);
  if (c.rnd() < 0.6) c.L.set(x + pick(c, [-1, 1]), 0, z + pick(c, [-1, 1]), 'log_jungle');
}
/** Crystal blocks with moss around: a big one in the centre, small ones and decor at the edge */
function crystalPatch(c: BuildCtx, r: number, big: number): void {
  jungleGround(c, r + 0.5, r + 0.5);
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) if (Math.abs(x) + Math.abs(z) <= r && c.rnd() < 0.6) c.L.set(x, -1, z, 'moss_block');
  c.L.set(0, 0, 0, 'crystal');
  if (big > 1) { c.L.set(1, 0, 0, 'crystal'); c.L.set(0, 1, 0, 'crystal'); }
  if (big > 2) { c.L.set(-1, 0, 1, 'crystal'); c.L.set(1, 0, -1, 'crystal'); }
  c.dec('crystal_cluster', pick(c, [-r, r]), 0, pick(c, [-1, 1]), yaw(c));
  c.dec('crystal_shard', pick(c, [-1, 1]), 0, pick(c, [-r, r]), yaw(c));
  undergrowth(c, r * 4, r, 0.35);
}
/** Temple floor in a rectangle: temple stone tiles, mossy and carved in places, mossy ground in the holes */
function templeFloor(c: BuildCtx, x0: number, z0: number, x1: number, z1: number): void {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const v = c.rnd();
    c.L.set(x, -1, z, v < 0.55 ? 'temple_stone' : v < 0.75 ? 'temple_stone_mossy' : v < 0.82 ? 'temple_stone_carved' : 'jungle_floor');
    if (v >= 0.82 && c.rnd() < 0.6) c.L.set(x, 0, z, pick(c, ['fern_big', 'moss_carpet', 'fern', 'flower_pink']));
  }
}
/** Stepped pyramid: levels all round, stairs from −Z in the middle, a platform on top */
function pyramid(c: BuildCtx, half: number, levels: number): void {
  for (let k = 0; k < levels; k++) {
    const h = half - k;
    for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) {
      const edge = Math.abs(x) === h || Math.abs(z) === h;
      const v = c.rnd();
      c.L.set(x, k, z, edge && v < 0.15 ? 'temple_stone_mossy' : edge && v < 0.3 ? 'temple_stone_carved' : 'temple_stone');
    }
    // stairs from +Z (the showcase face): steps on the outer row, the tall half towards −Z — rotation 3 (+X → −Z)
    for (const x of [-1, 0, 1]) c.L.set(x, k, h, 'temple_stone_stairs', 3);
  }
}

/** Jungle builders; all — the registry (the composition nests medium ones by id) */
export function jungleBuilders(all: Builder[]): Builder[] {
  ALL = all;
  return [
  {
    id: 'jungle_tree_big', title: 'Big jungle tree', category: 'jungle', hint: 'a 2 × 2 trunk 6 high, buttress roots, a flat 7 × 7 crown, vines, undergrowth', variants: 2,
    build(c) {
      jungleGround(c, 4.2, 4.2);
      jungleTreeBig(c, -1, -1, 5 + Math.floor(c.rnd() * 2));
      undergrowth(c, 10, 3.5);
      c.dec('fern_cluster', 2, 0, -2, yaw(c));
      if (c.rnd() < 0.6) c.dec('log_mossy_fallen', -3, 0, 2, pick(c, [10, 80]));
    },
  },
  {
    id: 'jungle_tree_small', title: 'Small jungle tree', category: 'jungle', hint: 'trunk 4, a 5 × 5 crown, ferns and flowers at the roots', variants: 2,
    build(c) {
      jungleGround(c, 2.8, 2.8);
      jungleTreeSmall(c, 0, 0, 3 + Math.floor(c.rnd() * 2));
      undergrowth(c, 6, 2.5);
      c.dec('fern_cluster', pick(c, [-2, 2]), 0, pick(c, [-1, 2]), yaw(c));
    },
  },
  {
    id: 'jungle_thicket', title: 'Thicket', category: 'jungle', hint: '8 × 8: ferns, vines, pink flowers, moss, a mossy log, small crystals', variants: 2,
    build(c) {
      jungleGround(c, 4.2, 4.2);
      for (let i = 0; i < 4; i++) { const x = -3 + Math.floor(c.rnd() * 7), z = -3 + Math.floor(c.rnd() * 7); if (c.L.nameAt(x, 0, z) === 'air') { c.L.set(x, 0, z, 'leaves_jungle'); if (c.rnd() < 0.4) c.L.set(x, 1, z, 'leaves_jungle'); } }
      undergrowth(c, 26, 3.8, 0.12);
      c.dec('log_mossy_fallen', pick(c, [-2, 1]), 0, pick(c, [-2, 2]), pick(c, [20, 70, 110]));
      c.dec('fern_cluster', 2, 0, 2, yaw(c));
      c.dec('fern_cluster', -3, 0, -1, yaw(c));
      c.dec('mushrooms_glow', pick(c, [-1, 3]), 0, pick(c, [-3, 1]), yaw(c));
    },
  },
  {
    id: 'crystal_cluster_small', title: 'Small crystals', category: 'jungle', hint: '3 × 3: a crystal block, a cluster and a shard on moss, baked teal light', variants: 2,
    build(c) { crystalPatch(c, 1, 1); },
  },
  {
    id: 'crystal_cluster_big', title: 'Big crystals', category: 'jungle', hint: '5 × 5: five crystal blocks in two tiers, a cluster, a shard, moss and small crystals around', variants: 2,
    build(c) { crystalPatch(c, 2, 3); c.dec('crystal_cluster', 2, 0, -2, yaw(c)); },
  },
  {
    id: 'crystal_cave_mouth', title: 'Crystal cave mouth', category: 'jungle', hint: '8 × 6: a mossy rock with a 2 × 2 opening from +Z, glowing crystals inside, vines over the entrance', variants: 2,
    build(c) {
      jungleGround(c, 5, 4);
      rockOutcrop(c.L, 0, -1, 3.6, 2.4, 4, 0, c.seed * 7);
      // moss on top instead of grass; a 2 × 2 opening from +Z (the showcase face) going in to z = −1
      c.L.forEach((x, y, z) => { if (c.L.nameAt(x, y, z) === 'cliff_grass') c.L.set(x, y, z, 'cliff_jungle'); });
      for (let y = 0; y <= 1; y++) for (const x of [-1, 0]) for (let z = -1; z <= 3; z++) c.L.set(x, y, z, 'air');
      for (const x of [-1, 0]) for (let z = -1; z <= 3; z++) c.L.set(x, -1, z, c.rnd() < 0.5 ? 'moss_block' : 'jungle_floor');
      c.L.set(-1, 0, -1, 'crystal'); c.L.set(0, 1, -1, 'crystal');
      c.L.set(-2, 0, 0, 'crystal_small'); c.L.set(1, 0, 0, 'crystal_small');
      c.dec('crystal_cluster', 0, 0, 0, yaw(c));
      c.dec('crystal_shard', -1, 0, 2, yaw(c));
      c.dec('vines_hanging', -1, 2, 2, 0, [-1, 2, 2]);
      c.dec('vines_wall', 2, 1.8, 2.5, 0, [2, 1, 2]);
      c.dec('vines_wall', -3, 1.6, 2.5, 0, [-3, 1, 2]);
      undergrowth(c, 10, 4.5);
      c.dec('fern_cluster', 3, 0, 3, yaw(c));
    },
  },
  {
    id: 'temple_wall_carved', title: 'Carved temple wall', category: 'jungle', hint: '7 × 3 along X: temple stone with a carved row, uneven height, vines and moss at the foot', variants: 2,
    build(c) {
      jungleGround(c, 4.5, 2.2);
      wallRun(c, [[-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0]], 2, 3, TEMPLE);
      for (let x = -3; x <= 3; x++) if (c.L.nameAt(x, 1, 0) !== 'air' && c.rnd() < 0.7) c.L.set(x, 1, 0, 'temple_stone_carved');
      onWall(c, 'vines_wall', pick(c, [-2, 2]), 2.5, 0, '+z');
      onWall(c, 'vines_wall', pick(c, [-1, 1]), 2, 0, '-z');
      c.dec('rubble', 4, 0, 1, yaw(c));
      undergrowth(c, 8, 4);
    },
  },
  {
    id: 'temple_gate', title: 'Temple gate', category: 'jungle', hint: 'two 1 × 4 pillars with carved capitals and a lintel over a 2-wide opening, hanging vines, an idol at the side', variants: 2,
    build(c) {
      jungleGround(c, 3.5, 2.5);
      for (const x of [-2, 2]) { pillar(c, x, 0, 3, false, TEMPLE); c.L.set(x, 3, 0, 'temple_stone_carved'); c.L.set(x, 4, 0, 'temple_stone_slab'); }
      for (let x = -2; x <= 2; x++) c.L.set(x, 4, 0, x === 0 ? 'temple_stone_carved' : 'temple_stone');
      c.L.set(-1, 3, 0, 'temple_stone_stairs', 0); c.L.set(1, 3, 0, 'temple_stone_stairs', 2);
      c.dec('vines_hanging', 0, 4, 0, yaw(c), [0, 4, 0]);
      c.dec('vines_hanging', pick(c, [-1, 1]), 3, 0, yaw(c), [pick(c, [-1, 1]), 3, 0]);
      c.dec('idol_head', 3, 0, 1, 180 + Math.floor(c.rnd() * 40 - 20));
      c.L.set(-3, 0, -1, 'crystal_small');
      undergrowth(c, 6, 3);
    },
  },
  {
    id: 'temple_pyramid_small', title: 'Temple pyramid', category: 'jungle', hint: '9 × 9: three tiers of temple stone, stairs from +Z, an altar with a crystal and candles on top, moss and vines', variants: 2,
    build(c) {
      jungleGround(c, 5.5, 5.5);
      pyramid(c, 4, 3);
      for (let x = -4; x <= 4; x++) for (const z of [-4, 4]) if (c.rnd() < 0.35) c.L.set(x, 0, z, 'temple_stone_mossy');
      c.L.set(0, 3, 0, 'temple_stone_carved');
      c.L.set(0, 4, 0, 'crystal');
      c.dec('candles_group', -1, 3, 1, yaw(c));
      c.dec('candles_row', 1, 3, -1, 90);
      c.dec('crystal_shard', 1, 3, 1, yaw(c));
      onWall(c, 'vines_wall', pick(c, [-3, 3]), 0.5, -4, '-z');
      onWall(c, 'vines_wall', 4, 1.5, pick(c, [-2, 2]), '+x');
      c.dec('idol_head', -3, 0, 5, 180);
      c.dec('rubble', 5, 0, -3, yaw(c));
      undergrowth(c, 8, 5.5);
    },
  },
  {
    id: 'temple_altar_crystal', title: 'Crystal altar', category: 'jungle', hint: '3 × 3: a temple stone slab, a crystal, candles, shards — baked teal light', variants: 2,
    build(c) {
      jungleGround(c, 2.2, 2.2);
      templeFloor(c, -1, -1, 1, 1);
      c.L.set(0, 0, 0, 'temple_stone_carved');
      c.L.set(0, 1, 0, 'crystal');
      c.dec('candles_group', -1, 0, 1, yaw(c));
      c.dec('candle_tall', 1, 0, -1, 0);
      c.dec('crystal_shard', 1, 0, 1, yaw(c));
      c.L.set(-1, 0, -1, 'crystal_small');
    },
  },
  {
    id: 'temple_column_row', title: 'Temple columns', category: 'jungle', hint: '8 m along X: temple stone pillars with carved capitals, one collapsed, tiles beneath', variants: 2,
    build(c) {
      jungleGround(c, 5, 2.5);
      templeFloor(c, -4, -1, 3, 1);
      const broken = pick(c, [0, 1, 2, 3]);
      for (let i = 0; i < 4; i++) {
        const x = -3 + i * 2;
        if (i === broken) { pillar(c, x, 0, 1, false, TEMPLE); c.dec('column_fallen', x + 0.5, 0, 2, pick(c, [0, 15])); c.dec('rubble', x, 0, 1, yaw(c)); continue; }
        pillar(c, x, 0, 3, false, TEMPLE); c.L.set(x, 3, 0, 'temple_stone_carved'); if (c.rnd() < 0.5) c.L.set(x, 4, 0, 'temple_stone_slab');
      }
      onWall(c, 'vines_wall', pick(c, [-3, 1]), 2.5, 0, '+z');
      undergrowth(c, 6, 4.5);
    },
  },
  {
    id: 'jungle_pond', title: 'Jungle pond', category: 'jungle', hint: '6 × 6: water with lily pads, moss and ferns on the shore, small crystals', variants: 2,
    build(c) {
      jungleGround(c, 4, 3.6);
      for (let x = -3; x <= 2; x++) for (let z = -3; z <= 2; z++) {
        const e = ((x + 0.5) / 2.6) ** 2 + ((z + 0.5) / 2.2) ** 2;
        if (e <= 1 + (c.rnd() - 0.5) * 0.3) { c.L.set(x, -1, z, 'water'); c.L.set(x, -2, z, 'jungle_floor'); }
        else if (c.L.nameAt(x, -1, z) === 'jungle_floor' && c.rnd() < 0.4) c.L.set(x, -1, z, 'moss_teal');
      }
      c.dec('lily_pad', -1, -0.1, 0, yaw(c));
      c.dec('lily_pad', 1, -0.1, -1, yaw(c));
      c.dec('fern_cluster', 3, 0, 1, yaw(c));
      c.dec('fern_cluster', -3, 0, -2, yaw(c));
      c.dec('crystal_shard', pick(c, [-4, 3]), 0, 3, yaw(c));
      c.L.set(2, 0, -3, 'crystal_small');
      undergrowth(c, 8, 4);
    },
  },
  {
    id: 'mossy_boulders', title: 'Mossy boulders', category: 'jungle', hint: '4 × 4: mossy rock, moss, ferns, a crystal in a crack', variants: 2,
    build(c) {
      jungleGround(c, 2.8, 2.8);
      c.L.set(0, 0, 0, 'cliff_jungle'); c.L.set(1, 0, 0, 'cliff_jungle'); c.L.set(0, 0, 1, 'cliff_jungle');
      c.L.set(0, 1, 0, 'cliff_jungle');
      if (c.rnd() < 0.6) c.L.set(1, 1, 0, 'cliff_stairs', 2);
      c.L.set(-1, 0, 0, 'moss_block'); c.L.set(1, 0, 1, 'cliff_slab');
      c.L.set(-1, 0, 1, 'fern_big'); c.L.set(1, 0, -1, 'crystal_small');
      c.dec('crystal_shard', 2, 0, 1, yaw(c));
      c.dec('fern_cluster', -1, 0, -1, yaw(c));
      c.dec('rock_small', 2, 0, -1, yaw(c));
      undergrowth(c, 5, 2.5);
    },
  },
  {
    id: 'temple_ruins_jungle', title: 'Jungle temple ruins', category: 'jungle', hint: '16 × 16: a pyramid, a gate, a carved wall, columns, crystals, trees, thickets, a pond', variants: 2,
    build(c) {
      jungleGround(c, 9, 9);
      use(c, 'temple_pyramid_small', 2, 2);
      use(c, 'temple_gate', 2, -6);
      use(c, 'temple_wall_carved', -5, 4, 1);
      use(c, 'temple_column_row', -4, -3, 1);
      use(c, 'crystal_cluster_big', 7, -5);
      use(c, 'crystal_cluster_small', -6, -7);
      use(c, 'jungle_tree_big', -5, 7);
      use(c, 'jungle_tree_small', 7, 6);
      use(c, 'jungle_thicket', 6, 1);
      c.dec('idol_head', -1, 0, -7, 180);
      undergrowth(c, 14, 8);
    },
  },
  ];
}
