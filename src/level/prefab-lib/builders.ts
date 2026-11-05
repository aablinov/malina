import { hayStack, stairway, steppedWall, tree } from '../kit.ts';
import type { BuildCtx, Builder } from './build.ts';
import { RUINS } from './builders-ruins.ts';
import { SETTLEMENT } from './builders-settlement.ts';
import { COMPOSITIONS } from './builders-compositions.ts';
import { snowBuilders } from './builders-snow.ts';
import { jungleBuilders } from './builders-jungle.ts';

/**
 * Library prefab builders (wiki/design-prefab-library.md, catalogue — section 3). The anchor is (0, 0, 0): y = 0 is the first air
 * layer above ground, the ground is y = −1, roads and water cut into it. Every prefab carries small decor — no bare boxes.
 * Batch 1 — trial ones (hay stack, oak, fence, camp), batch 2 — "Road and nature" (catalogue sections A and B),
 * batch 3 — "Ruins" (section C, builders-ruins.ts), batch 4 — "Settlement" (section D, builders-settlement.ts),
 * batch 5 — "Compositions" (section E, builders-compositions.ts — from medium prefabs via bake + stampInto),
 * batch 6 — the "snow" biome (builders-snow.ts — snow prefabs and snowCap variants of existing ones),
 * batch 7 — the "jungle with crystals" biome (builders-jungle.ts — temple, crystals, buttress-rooted trees).
 */

const pick = <T,>(c: BuildCtx, list: T[]): T => list[Math.floor(c.rnd() * list.length)];
const yaw = (c: BuildCtx): number => Math.floor(c.rnd() * 360);
/** Cell (dx, dz) inside an rx × rz ellipse with a ragged edge */
const inBlob = (c: BuildCtx, dx: number, dz: number, rx: number, rz: number, fuzz = 0.25): boolean =>
  ((dx + 0.5) / rx) ** 2 + ((dz + 0.5) / rz) ** 2 <= 1 + (c.rnd() - 0.5) * fuzz;

// ---------- trees (shared by prefabs and the grove) ----------

/** Golden larch: a trunk and a cone crown of leaves_gold (references 2, 3, 8); layer radii bottom to top */
export function goldenTree(c: BuildCtx, x: number, z: number, trunk: number, radii: number[]): void {
  for (let k = 0; k < trunk; k++) c.L.set(x, k, z, 'log');
  radii.forEach((r, i) => {
    const y = trunk - 1 + i;
    const ri = Math.ceil(r);
    for (let dx = -ri; dx <= ri; dx++) for (let dz = -ri; dz <= ri; dz++) {
      if (dx * dx + dz * dz > r * r + 0.3 + (c.rnd() - 0.5) * 0.6) continue;
      if (dx === 0 && dz === 0 && y < trunk) continue;
      c.L.set(x + dx, y, z + dz, 'leaves_gold');
    }
  });
}
/** Dark fir (reference 11): a trunk and tiers of cutout foliage, narrower towards the top */
export function pineTree(c: BuildCtx, x: number, z: number, trunk: number, radii: number[]): void {
  for (let k = 0; k < trunk + 1; k++) c.L.set(x, k, z, 'log');
  radii.forEach((r, i) => {
    const y = trunk + i;
    const ri = Math.ceil(r);
    for (let dx = -ri; dx <= ri; dx++) for (let dz = -ri; dz <= ri; dz++) {
      if (dx * dx + dz * dz > r * r + 0.2) continue;
      c.L.set(x + dx, y, z + dz, 'leaves');
    }
  });
}

// ---------- roads ----------

/** A flagstone road cell by variant: 1 — intact, 2 — broken, 3 — overgrown (grass and dirt in the holes) */
function flagstone(c: BuildCtx, variant: number): string {
  const v = c.rnd();
  if (variant === 1) return v < 0.9 ? 'tiles' : 'tiles_broken';
  if (variant === 2) return v < 0.6 ? 'tiles' : v < 0.8 ? 'tiles_broken' : 'dirt';
  return v < 0.5 ? 'tiles' : v < 0.65 ? 'tiles_broken' : 'grass';
}
/** A flagstone road 3 wide along the listed cells (centre line), ragged edge — sparse tiles on the shoulder */
function flagRoad(c: BuildCtx, line: [number, number][], variant: number): void {
  const seen = new Set<string>();
  const put = (x: number, z: number, edge: boolean) => {
    const k = `${x},${z}`; if (seen.has(k)) return; seen.add(k);
    if (edge) { if (c.rnd() < 0.3) c.L.set(x, -1, z, pick(c, ['tiles', 'tiles_broken'])); return; }
    const b = flagstone(c, variant);
    c.L.set(x, -1, z, b);
    if (b === 'grass' && c.rnd() < 0.5) c.L.set(x, 0, z, pick(c, ['tall_grass', 'dry_grass']));
  };
  for (const [x, z] of line) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const d = Math.max(Math.abs(dx), Math.abs(dz));
    if (d <= 1) put(x + dx, z + dz, false); else if (Math.abs(dx) + Math.abs(dz) <= 2) put(x + dx, z + dz, true);
  }
}
const roadDecor = (c: BuildCtx, spots: [number, number][]): void => {
  for (const [x, z] of spots) c.dec(pick(c, ['rock_small', 'rock_small', 'rubble']), x, 0, z, yaw(c));
};
const along = (x0: number, x1: number, z: number): [number, number][] => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, z]);
const across = (x: number, z0: number, z1: number): [number, number][] => Array.from({ length: z1 - z0 + 1 }, (_, i) => [x, z0 + i]);

/** A dirt path 3 wide along the centre line: the shoulder is trodden in patches */
function dirtRoad(c: BuildCtx, line: [number, number][]): void {
  const seen = new Set<string>();
  for (const [x, z] of line) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const d = Math.max(Math.abs(dx), Math.abs(dz)), k = `${x + dx},${z + dz}`;
    if (seen.has(k)) continue;
    if (d <= 1) { seen.add(k); c.L.set(x + dx, -1, z + dz, 'path'); }
    else if (Math.abs(dx) + Math.abs(dz) <= 2 && c.rnd() < 0.35) { seen.add(k); c.L.set(x + dx, -1, z + dz, 'path'); }
  }
}

export const BUILDERS: Builder[] = [
  // ---------- batch 1: trial ----------
  {
    id: 'hay_stack', title: 'Hay stack', category: 'settlement', hint: 'bales in a pyramid, a cart, crates and a bench beside', variants: 2,
    build(c) {
      const tall = c.rnd() < 0.5;
      hayStack(c.L, -1, 0, -1, tall ? [['###', '###'], ['##.', '#..'], ['#..', '...']] : [['##', '##'], ['#.', '..']]);
      c.dec('cart_loaded', 3, 0, 0, 90);
      c.dec('crate_small', -2, 0, 1, pick(c, [0, 15, -20]));
      c.dec(pick(c, ['bench', 'crates_banded_stack']), 0, 0, 3, 0);
      if (c.rnd() < 0.7) c.dec('mushrooms', -2, 0, -2, yaw(c));
    },
  },
  {
    id: 'tree_oak', title: 'Oak', category: 'nature', hint: 'trunk 4, a lush crown, mushrooms and stones at the roots', variants: 3,
    build(c) {
      const trunk = 3 + Math.floor(c.rnd() * 2), r = 2;
      tree(c.L, 0, 0, 0, trunk, r);
      c.dec('mushrooms', 1, 0, 1, yaw(c));
      c.dec('rock_small', -1, 0, -1, yaw(c));
      if (c.rnd() < 0.6) c.dec('mushrooms_glow', -1, 0, 1, yaw(c));
      c.L.set(pick(c, [2, -2]), 0, pick(c, [1, -1]), 'tall_grass');
      c.L.set(pick(c, [1, -1]), 0, pick(c, [2, -2]), 'fern');
    },
  },
  {
    id: 'wall_stepped', title: 'Stone fence', category: 'settlement', hint: '9 blocks along X, uneven height, a lantern on the wall, rubble at the foot', variants: 2,
    build(c) {
      steppedWall(c.L, -4, 0, 4, 0, 0, 1, 3);
      // the lantern goes on the first cell at least 2 high, facing +Z
      for (const x of [0, 1, -1, 2, -2, 3, -3]) if (c.L.nameAt(x, 1, 0) !== 'air') { c.dec('lantern_wall', x, 1.5, 0.5, 0, [x, 1, 0]); break; }
      c.dec('rubble', pick(c, [-3, 3]), 0, 1, yaw(c));
      c.dec('bricks_loose', pick(c, [-1, 1]), 0, 1, yaw(c));
      c.L.set(pick(c, [-4, 4]), 0, 1, 'tall_grass');
    },
  },
  {
    id: 'campfire_camp', title: 'Campfire camp', category: 'settlement', hint: 'a campfire, log seats, a bench, crates, a lantern', variants: 2,
    build(c) {
      c.L.set(0, 0, 0, 'campfire');
      c.L.set(0, 0, 2, 'log_x', 0);
      c.L.set(2, 0, 0, 'log_x', 1);
      if (c.rnd() < 0.7) c.L.set(-2, 0, 0, 'log_x', 1);
      c.dec('bench', 0, 0, -2, 0);
      c.dec('crate_banded', 3, 0, -2, pick(c, [0, 25]));
      c.dec('crate_small', 3, 0, -3, pick(c, [0, -30]));
      c.dec('lantern_short', -3, 0, 2, 0);
      c.dec('bones', 2, 0, 3, yaw(c));
      c.L.set(-3, 0, -2, pick(c, ['tall_grass', 'fern']));
    },
  },

  // ---------- batch 2, section A: roads and ground (references 1, 4, 5, 14) ----------
  {
    id: 'road_flagstone_straight', title: 'Flagstone road', category: 'roads', hint: '3 × 8 along X; variants: intact, broken, overgrown', variants: 3,
    build(c) { flagRoad(c, along(-4, 3, 0), c.seed); roadDecor(c, [[pick(c, [-3, 2]), 2], [pick(c, [-1, 3]), -2]]); },
  },
  {
    id: 'road_flagstone_turn', title: 'Flagstone road: turn', category: 'roads', hint: 'from −X to +Z, 8 × 8', variants: 2,
    build(c) { flagRoad(c, [...along(-4, 0, 0), ...across(0, 1, 4)], c.seed + 1); roadDecor(c, [[2, -2], [-3, 2]]); },
  },
  {
    id: 'road_flagstone_cross', title: 'Flagstone road: crossroads', category: 'roads', hint: '8 × 8, two roads crosswise', variants: 2,
    build(c) { flagRoad(c, [...along(-4, 3, 0), ...across(0, -4, 3)], c.seed + 1); roadDecor(c, [[2, 2], [-3, -3], [3, -2]]); },
  },
  {
    id: 'road_flagstone_end', title: 'Flagstone road: end', category: 'roads', hint: 'from −X to +X the tiles thin out into the grass', variants: 2,
    build(c) {
      flagRoad(c, along(-4, 0, 0), c.seed);
      for (let x = 1; x <= 4; x++) for (let z = -1; z <= 1; z++) if (c.rnd() < 1 - (x - 0.5) / 4.5) c.L.set(x, -1, z, pick(c, ['tiles', 'tiles_broken', 'tiles_broken']));
      c.L.set(3, 0, pick(c, [-1, 1]), 'tall_grass');
      roadDecor(c, [[4, pick(c, [-1, 0, 1])], [-2, 2]]);
    },
  },
  {
    id: 'road_dirt_straight', title: 'Dirt path', category: 'roads', hint: '3 × 8 along X, trodden shoulder', variants: 2,
    build(c) { dirtRoad(c, along(-4, 3, 0)); roadDecor(c, [[pick(c, [-3, 2]), 2]]); c.L.set(pick(c, [-2, 1]), 0, -2, 'tall_grass'); },
  },
  {
    id: 'road_dirt_turn', title: 'Dirt path: turn', category: 'roads', hint: 'from −X to +Z', variants: 2,
    build(c) { dirtRoad(c, [...along(-4, 0, 0), ...across(0, 1, 4)]); roadDecor(c, [[2, -2]]); c.L.set(-3, 0, 2, 'dry_grass'); },
  },
  {
    id: 'road_stairs', title: 'Flagstone stairs', category: 'roads', hint: '3 steps towards +X, width 3, debris on the sides', variants: 1,
    build(c) {
      stairway(c.L, -1, 0, -1, 1, 0, 3, 3, 'tiles');
      c.dec('rubble', -1, 0, 2, yaw(c));
      c.dec('bricks_loose', 0, 0, -2, yaw(c));
      c.L.set(1, 0, 2, 'tall_grass');
    },
  },
  {
    id: 'meadow_flowers', title: 'Flower meadow', category: 'nature', hint: '8 × 8, flowers in patches, daisies and dry grass; variant 2 is orange', variants: 2,
    build(c) {
      const set = c.seed === 1 ? ['flower_white', 'flower_red', 'flower_blue', 'daisies'] : ['flower_orange', 'flower_white', 'flower_orange', 'daisies'];
      const blobs = Array.from({ length: 4 }, () => ({ x: -3 + c.rnd() * 6, z: -3 + c.rnd() * 6, r: 1.6 + c.rnd() * 1.4, f: pick(c, set) }));
      for (let dx = -4; dx <= 3; dx++) for (let dz = -4; dz <= 3; dz++) {
        const b = blobs.find((b) => Math.hypot(dx + 0.5 - b.x, dz + 0.5 - b.z) < b.r);
        const v = c.rnd();
        const name = b && v < 0.75 ? b.f : v < 0.12 ? 'daisies' : v < 0.22 ? 'dry_grass' : v < 0.3 ? 'tall_grass' : null;
        if (name) c.L.set(dx, 0, dz, name);
      }
      c.dec('rock_small', pick(c, [-3, 2]), 0, pick(c, [-3, 2]), yaw(c));
    },
  },
  {
    id: 'meadow_dry', title: 'Dry meadow', category: 'nature', hint: '8 × 8 of dry grass, sparse stones and tufts', variants: 2,
    build(c) {
      for (let dx = -4; dx <= 3; dx++) for (let dz = -4; dz <= 3; dz++) {
        const v = c.rnd();
        const name = v < 0.5 ? 'dry_grass' : v < 0.62 ? 'tall_grass' : v < 0.66 ? 'daisies' : null;
        if (name) c.L.set(dx, 0, dz, name);
      }
      c.dec('rock_small', -2, 0, 1, yaw(c));
      c.dec('rock_small', 2, 0, -2, yaw(c));
      if (c.rnd() < 0.6) c.dec('stump', pick(c, [-3, 3]), 0, pick(c, [-3, 2]), yaw(c));
    },
  },
  {
    id: 'pond_small', title: 'Pond', category: 'nature', hint: '6 × 6, a sandy shore, reeds and foam', variants: 2,
    build(c) {
      for (let dx = -3; dx <= 2; dx++) for (let dz = -3; dz <= 2; dz++) {
        if (inBlob(c, dx, dz, 2.6, 2.2)) { c.L.set(dx, -1, dz, 'water'); c.L.set(dx, -2, dz, 'sand'); }
        else if (inBlob(c, dx, dz, 3.4, 3, 0.4) && c.rnd() < 0.7) c.L.set(dx, -1, dz, 'sand');
      }
      for (const [x, z] of [[-3, -1], [2, -2], [-1, 2], [2, 1]] as [number, number][]) if (c.L.nameAt(x, -1, z) !== 'water') c.dec('reeds', x, 0, z, yaw(c));
      c.dec('foam_patch', pick(c, [-1, 0]), -0.12, pick(c, [-1, 0]), yaw(c));
      c.dec('rock_small', -3, 0, 2, yaw(c));
    },
  },
  {
    id: 'stream_ford', title: 'Stream with a ford', category: 'nature', hint: 'a 2 × 12 bed along X, a cobble ford in the middle', variants: 2,
    build(c) {
      for (let dx = -6; dx <= 5; dx++) {
        for (const dz of [-1, 0]) { c.L.set(dx, -1, dz, 'water'); c.L.set(dx, -2, dz, 'sand'); }
        for (const dz of [-2, 1]) if (c.rnd() < 0.4) c.L.set(dx, -1, dz, 'sand');
      }
      for (const dx of [-1, 0]) for (const dz of [-1, 0]) c.L.set(dx, -1, dz, 'cobble');
      c.dec('reeds', pick(c, [-5, -4]), 0, -2, yaw(c));
      c.dec('reeds', pick(c, [3, 4]), 0, 1, yaw(c));
      c.dec('rock_small', -2, 0, 1, yaw(c));
      c.dec('rock_small', 1, 0, -2, yaw(c));
      c.dec('foam_patch', pick(c, [-4, 3]), -0.12, -0.5, yaw(c));
    },
  },

  // ---------- batch 2, section B: trees and vegetation (references 2, 3, 8, 11) ----------
  {
    id: 'tree_golden_small', title: 'Golden larch', category: 'nature', hint: 'a 3 × 3 cone crown, leaf litter on the ground', variants: 2,
    build(c) {
      goldenTree(c, 0, 0, 2, [1.5, 1.5, 1, 0.5]);
      c.dec('leaf_litter', 1, 0, 1, yaw(c));
      c.dec(pick(c, ['rock_small', 'mushrooms']), -1, 0, -1, yaw(c));
    },
  },
  {
    id: 'tree_golden_big', title: 'Big golden larch', category: 'nature', hint: 'a 5 × 5 crown, height 8, leaf litter and stones at the roots', variants: 2,
    build(c) {
      goldenTree(c, 0, 0, 3, [2.5, 2.2, 2, 1.5, 1, 0.5]);
      c.dec('leaf_litter', 2, 0, 1, yaw(c));
      c.dec('leaf_litter', -1, 0, -2, yaw(c));
      c.dec('rock_small', -2, 0, 1, yaw(c));
      c.L.set(1, 0, -2, 'dry_grass');
    },
  },
  {
    id: 'tree_dead', title: 'Dead tree', category: 'nature', hint: 'a bare trunk with branches, dry grass and stones', variants: 2,
    build(c) {
      c.dec('tree_dead', 0, 0, 0, yaw(c));
      c.dec('rock_small', 1, 0, -1, yaw(c));
      if (c.rnd() < 0.5) c.dec('bones', -1, 0, 1, yaw(c));
      c.L.set(-1, 0, -1, 'dry_grass');
      c.L.set(1, 0, 1, 'dry_grass');
    },
  },
  {
    id: 'tree_pine_dark', title: 'Dark fir', category: 'nature', hint: 'tiers of cutout foliage, narrower towards the top', variants: 2,
    build(c) {
      pineTree(c, 0, 0, 1 + Math.floor(c.rnd() * 2), [1.6, 1.2, 1.5, 1, 1, 0.5]);
      c.dec('mushrooms', 1, 0, 1, yaw(c));
      c.dec('rock_small', -1, 0, -1, yaw(c));
      c.L.set(-1, 0, 1, 'fern');
    },
  },
  {
    id: 'bush_cluster', title: 'Bushes', category: 'nature', hint: '2 × 2 of bushes with flowers around', variants: 2,
    build(c) {
      for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (c.rnd() < 0.85) c.L.set(x, 0, z, pick(c, ['berry_bush', 'berry_bush', 'leaves']));
      if (c.rnd() < 0.5) c.L.set(0, 1, 0, 'leaves');
      for (const [x, z] of [[-1, 0], [2, 1], [0, 2], [1, -1]]) if (c.rnd() < 0.7) c.L.set(x, 0, z, pick(c, ['flower_white', 'flower_red', 'daisies', 'tall_grass']));
      c.dec('rock_small', -1, 0, 2, yaw(c));
    },
  },
  {
    id: 'grove_golden', title: 'Golden grove', category: 'nature', hint: '12 × 12: larches, stumps, bushes, leaf litter on the ground', variants: 2,
    build(c) {
      const spots: [number, number, boolean][] = [[-3, -3, true], [3, -2, false], [-2, 3, false], [3, 3, true]];
      for (const [x, z, big] of spots) {
        if (big) goldenTree(c, x, z, 3, [2.2, 2, 1.5, 1, 0.5]); else goldenTree(c, x, z, 2, [1.5, 1.5, 1, 0.5]);
      }
      c.dec('stump', 0, 0, 0, yaw(c));
      c.dec('stump', -5, 0, 1, yaw(c));
      for (const [x, z] of [[-1, -4], [1, 2], [5, 0], [-4, 5]]) c.dec('leaf_litter', x, 0, z, yaw(c));
      c.dec('rock_small', 1, 0, -2, yaw(c));
      c.dec('mushrooms', -4, 0, -1, yaw(c));
      for (const [x, z] of [[5, -4], [-5, -5], [4, 5]]) c.L.set(x, 0, z, pick(c, ['berry_bush', 'leaves']));
      for (let i = 0; i < 8; i++) { const x = -6 + Math.floor(c.rnd() * 12), z = -6 + Math.floor(c.rnd() * 12); if (c.L.nameAt(x, 0, z) === 'air') c.L.set(x, 0, z, pick(c, ['dry_grass', 'tall_grass', 'daisies'])); }
    },
  },
  {
    id: 'stump_logs', title: 'Stump and logs', category: 'nature', hint: 'a stump, two logs, mushrooms', variants: 2,
    build(c) {
      c.dec('stump', 0, 0, 0, yaw(c));
      c.L.set(1, 0, 1, 'log_x', 0);
      c.L.set(-1, 0, 1, 'log_x', pick(c, [0, 1]));
      c.dec('mushrooms', 1, 0, -1, yaw(c));
      c.L.set(-1, 0, -1, 'fern');
    },
  },
  {
    id: 'boulder_single', title: 'Boulder', category: 'nature', hint: 'a 1 × 1 rock with grass at the foot', variants: 2,
    build(c) {
      c.L.set(0, 0, 0, 'cliff');
      if (c.rnd() < 0.5) c.L.set(0, 1, 0, 'cliff_stairs', Math.floor(c.rnd() * 4));
      c.L.set(pick(c, [1, -1]), 0, 0, 'cliff_slab');
      c.L.set(0, 0, pick(c, [1, -1]), 'tall_grass');
      c.dec('rock_small', pick(c, [1, -1]), 0, pick(c, [1, -1]), yaw(c));
    },
  },
  {
    id: 'boulder_group', title: 'Boulders', category: 'nature', hint: '3 × 3 of rocks of varying height, grass in the cracks', variants: 2,
    build(c) {
      c.L.set(0, 0, 0, 'cliff'); c.L.set(1, 0, 0, 'cliff'); c.L.set(0, 0, 1, 'cliff');
      c.L.set(0, 1, 0, 'cliff');
      if (c.rnd() < 0.6) c.L.set(1, 1, 0, 'cliff_stairs', 2);
      c.L.set(-1, 0, 0, 'cliff_slab'); c.L.set(1, 0, 1, 'cliff_slab');
      c.L.set(-1, 0, 1, 'tall_grass'); c.L.set(1, 0, -1, 'fern');
      c.dec('rock_small', -1, 0, -1, yaw(c));
      c.dec('rock_small', 2, 0, 1, yaw(c));
    },
  },

  ...RUINS,
  ...SETTLEMENT,
  ...COMPOSITIONS,
];
// snow variants refer to the base ones by id, so they are added after the registry is assembled
BUILDERS.push(...snowBuilders(BUILDERS));
BUILDERS.push(...jungleBuilders(BUILDERS));
