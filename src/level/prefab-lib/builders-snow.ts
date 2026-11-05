import { blockDef } from '../palette.ts';
import { bake, stampInto, type BuildCtx, type Builder } from './build.ts';
import { pineTree } from './builders.ts';

/**
 * The "snow" biome (wiki/design-prefab-library.md, "Biomes" section; references 13 — MCD "Creeping Winter", 9 — a snowed-in church).
 * Snow ground with a ragged edge, ice and frozen water, snow piles, icicles, ice spikes, a snowman — and snow variants
 * of existing prefabs via the `snowCap` post-pass: snow settles on exposed top faces, foliage becomes snowy,
 * the ground in the outline turns to snow. Building code is not duplicated.
 */

const pick = <T,>(c: BuildCtx, list: T[]): T => list[Math.floor(c.rnd() * list.length)];
const yaw = (c: BuildCtx): number => Math.floor(c.rnd() * 360);
/** Builder registry — passed in from builders.ts after the base ones are assembled (snow variants refer to them by id) */
let ALL: Builder[] = [];
const find = (id: string): Builder => { const b = ALL.find((b) => b.id === id); if (!b) throw new Error(`No builder "${id}"`); return b; };

/** Blocks that get no snow: thin, glowing, already snowy, water and ice */
const NO_CAP = new Set(['fence', 'stake_fence', 'torch', 'campfire', 'fire', 'window', 'rail', 'snow', 'snow_slab', 'snow_layer', 'ice', 'ice_slab', 'ice_cracked', 'frozen_water', 'water', 'river', 'waterfall', 'leaves_snow', 'portal', 'bridge_post']);
const GROUND_TO_SNOW = new Set(['grass', 'path', 'dirt', 'grass_slab', 'cliff_grass']);

/**
 * Snow over everything built: full blocks with air above get a snow slab, stairs and slabs a thin layer,
 * foliage becomes snowy needles, the ground in the outline (and a cell around, with a ragged edge) becomes snow.
 */
export function snowCap(c: BuildCtx, ground = true): void {
  const cells: [number, number, number, string][] = [];
  c.L.forEach((x, y, z) => cells.push([x, y, z, c.L.nameAt(x, y, z)]));
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, y, z, n] of cells) {
    if (y >= 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (n === 'leaves' || n === 'leaves_fluffy' || n === 'leaves_gold') { c.L.set(x, y, z, 'leaves_snow'); continue; }
    if (y < 0 || NO_CAP.has(n) || c.L.nameAt(x, y + 1, z) !== 'air') continue;
    const d = blockDef(n);
    if (d.collide === 0 || d.replaceable) continue;
    if (d.stairs || n.endsWith('_slab') || n.endsWith('_low')) { if (c.rnd() < 0.85) c.L.set(x, y + 1, z, 'snow_layer'); }
    else if (d.full) c.L.set(x, y + 1, z, 'snow_slab');
  }
  if (!ground || x0 === Infinity) return;
  for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) {
    const edge = x === x0 - 1 || x === x1 + 1 || z === z0 - 1 || z === z1 + 1;
    const n = c.L.nameAt(x, -1, z);
    if ((n === 'air' || GROUND_TO_SNOW.has(n)) && c.L.nameAt(x, 0, z) === 'air' && (!edge || c.rnd() < 0.45)) c.L.set(x, -1, z, n === 'grass_slab' ? 'snow_slab' : 'snow');
  }
}
/** Snow ground in an rx × rz ellipse with a ragged edge (cells y = −1) */
function snowGround(c: BuildCtx, rx: number, rz: number, cx = 0, cz = 0): void {
  for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) for (let z = Math.floor(cz - rz - 1); z <= Math.ceil(cz + rz + 1); z++) {
    const e = ((x + 0.5 - cx) / rx) ** 2 + ((z + 0.5 - cz) / rz) ** 2;
    if (e <= 1 + (c.rnd() - 0.5) * 0.35) c.L.set(x, -1, z, 'snow');
  }
}
/** Nest a medium prefab by builder id (variant — its own seed, rotation — quarters) */
function use(c: BuildCtx, id: string, x: number, z: number, quarter = 0, seed?: number): void {
  const b = find(id);
  stampInto(c, bake(b, seed ?? 1 + Math.floor(c.rnd() * (b.variants ?? 1))), x, z, quarter);
}
/** The snow variant of an existing prefab: the same builder + snowCap */
const snowy = (id: string, extra?: (c: BuildCtx) => void): Builder => {
  const base = find(id);
  return {
    id: `${id}_snow`, title: `${base.title} in snow`, category: 'snow', hint: `${base.hint ?? ''}${base.hint ? ' · ' : ''}under snow`, variants: base.variants,
    build(c) { use(c, id, 0, 0, 0, c.seed); snowCap(c); extra?.(c); },
  };
};
const bits = (c: BuildCtx, n: number, r: number): void => {
  for (let i = 0; i < n; i++) {
    const x = Math.round((c.rnd() - 0.5) * 2 * r), z = Math.round((c.rnd() - 0.5) * 2 * r);
    if (c.L.nameAt(x, 0, z) !== 'air' || c.L.nameAt(x, -1, z) !== 'snow') continue;
    const v = c.rnd();
    if (v < 0.4) c.dec('snow_pile', x, 0, z, yaw(c)); else if (v < 0.6) c.dec('rock_snow', x, 0, z, yaw(c)); else c.L.set(x, 0, z, pick(c, ['dead_bush_snow', 'dry_grass']));
  }
};

/** Snow builders; all — the base builders the snow variants are made from */
export function snowBuilders(all: Builder[]): Builder[] {
  ALL = all;
  return [
  {
    id: 'snow_patch', title: 'Snow', category: 'snow', hint: '8 × 8 of snow with a ragged edge, snow piles, stones and dead bushes', variants: 2,
    build(c) { snowGround(c, 4.2, 4.2); bits(c, 7, 3.5); c.dec('frozen_bush', pick(c, [-3, 2]), 0, pick(c, [-2, 3]), yaw(c)); },
  },
  {
    id: 'frozen_pond', title: 'Frozen pond', category: 'snow', hint: '6 × 6: cracked ice, snow on the shore, ice spikes', variants: 2,
    build(c) {
      snowGround(c, 4, 3.6);
      for (let x = -3; x <= 2; x++) for (let z = -3; z <= 2; z++) {
        const e = ((x + 0.5) / 2.7) ** 2 + ((z + 0.5) / 2.3) ** 2;
        if (e <= 1 + (c.rnd() - 0.5) * 0.25) { c.L.set(x, -1, z, c.rnd() < 0.25 ? 'ice_cracked' : 'frozen_water'); c.L.set(x, -2, z, 'sand'); }
      }
      c.dec('ice_spikes', 3, 0, -1, yaw(c));
      c.dec('ice_spikes', -3, 0, 2, yaw(c));
      c.dec('snow_pile', 0, 0, 3, yaw(c));
      c.dec('rock_snow', -4, 0, -2, yaw(c));
      c.L.set(2, 0, 3, 'dead_bush_snow');
    },
  },
  {
    id: 'frozen_stream', title: 'Frozen stream', category: 'snow', hint: '2 × 12 of ice along X, an ice hole in the middle, snow on the banks', variants: 2,
    build(c) {
      for (let x = -6; x <= 5; x++) for (let z = -3; z <= 2; z++) if (c.rnd() < 0.92) c.L.set(x, -1, z, 'snow');
      for (let x = -6; x <= 5; x++) for (const z of [-1, 0]) { c.L.set(x, -1, z, c.rnd() < 0.2 ? 'ice_cracked' : 'frozen_water'); c.L.set(x, -2, z, 'sand'); }
      for (const x of [-1, 0]) for (const z of [-1, 0]) c.L.set(x, -1, z, 'water');
      c.dec('ice_spikes', pick(c, [-5, 4]), 0, -2, yaw(c));
      c.dec('rock_snow', 2, 0, 1, yaw(c));
      c.dec('snow_pile', -4, 0, 2, yaw(c));
      c.L.set(4, 0, 2, 'dead_bush_snow');
      c.L.set(-3, 0, -3, 'dry_grass');
    },
  },
  {
    id: 'ice_spikes_group', title: 'Ice spikes', category: 'snow', hint: '4 × 4: three clumps of spikes on snow', variants: 2,
    build(c) {
      snowGround(c, 2.5, 2.5);
      for (const [x, z] of [[-1, -1], [1, 0], [0, 1]]) c.dec('ice_spikes', x, 0, z, yaw(c));
      c.L.set(-1, 0, 1, 'ice_slab');
      c.dec('snow_pile', 2, 0, -1, yaw(c));
    },
  },
  {
    id: 'tree_pine_snow', title: 'Snowy fir', category: 'snow', hint: 'tiers of snowy needles, a snow pile by the trunk', variants: 2,
    build(c) { pineTree(c, 0, 0, 1 + Math.floor(c.rnd() * 2), [1.6, 1.2, 1.5, 1, 1, 0.5]); snowCap(c); c.dec('snow_pile', 1, 0, 1, yaw(c)); c.dec('rock_snow', -1, 0, -1, yaw(c)); },
  },
  {
    id: 'tree_dead_snow', title: 'Dead tree in snow', category: 'snow', hint: 'a bare trunk, a snow pile and a frozen bush', variants: 2,
    build(c) { snowGround(c, 2, 2); c.dec('tree_dead', 0, 0, 0, yaw(c)); c.dec('snow_pile', 1, 0, -1, yaw(c)); c.dec('frozen_bush', -1, 0, 1, yaw(c)); if (c.rnd() < 0.5) c.dec('bones', 1, 0, 1, yaw(c)); },
  },
  {
    id: 'grove_pine_snow', title: 'Snowy fir grove', category: 'snow', hint: '12 × 12: firs, logs and stones under snow, snow piles', variants: 2,
    build(c) {
      snowGround(c, 6.5, 6.5);
      for (const [x, z] of [[-3, -3], [3, -2], [-2, 3], [3, 3]]) pineTree(c, x, z, 1 + Math.floor(c.rnd() * 2), [1.6, 1.2, 1.5, 1, 1, 0.5]);
      snowCap(c);
      c.dec('log_snow', 0, 0, 0, pick(c, [0, 20]));
      c.dec('log_snow', -5, 0, 1, pick(c, [80, 100]));
      c.dec('frozen_bush', 5, 0, 0, yaw(c));
      bits(c, 8, 5.5);
    },
  },
  {
    id: 'snowman_yard', title: 'Snowman', category: 'snow', hint: '4 × 4: a snowman, snow piles, a lantern', variants: 2,
    build(c) { snowGround(c, 2.5, 2.5); c.dec('snowman', 0, 0, 0, 180 + Math.floor(c.rnd() * 40 - 20)); c.dec('snow_pile', 1, 0, 1, yaw(c)); c.dec('snow_pile', -2, 0, -1, yaw(c)); c.dec('lantern_short', 2, 0, -1, 0); },
  },
  {
    id: 'road_dirt_snow', title: 'Path in snow', category: 'snow', hint: '3 × 8 along X: trodden snow with thawed patches', variants: 2,
    build(c) {
      for (let x = -4; x <= 3; x++) for (let z = -2; z <= 2; z++) if (Math.abs(z) <= 1 || c.rnd() < 0.5) c.L.set(x, -1, z, Math.abs(z) <= 1 && c.rnd() < 0.35 ? 'path' : 'snow');
      c.dec('rock_snow', pick(c, [-3, 2]), 0, 2, yaw(c));
      c.dec('snow_pile', pick(c, [-1, 3]), 0, -2, yaw(c));
    },
  },
  snowy('house_wood_small', (c) => { c.dec('snowdrift', 0, 0, 2.5, 0, [0, 0, 2]); c.dec('icicles_wall', -1, 2.4, -1.5, 180, [-1, 2, -1]); }),
  snowy('wall_stepped', (c) => c.dec('snowdrift', -2, 0, 0.5, 0, [-2, 0, 0])),
  snowy('ruin_chapel', (c) => { c.dec('icicles_wall', -2, 2.4, -3.5, 180, [-2, 2, -3]); c.dec('snowdrift', 0, 0, 3.5, 0, [0, 0, 3]); }),
  snowy('graveyard_small'),
  snowy('well', (c) => c.dec('icicles', 0, 1.65, 0, 0)),
  snowy('fence_straight'),
  snowy('hay_stack'),
  snowy('boulder_group'),
  {
    id: 'winter_hamlet', title: 'Winter hamlet', category: 'snow', hint: '16 × 16: snowy houses, a fence, a hay stack, firs, a snowman, a path', variants: 2,
    build(c) {
      snowGround(c, 9, 9);
      use(c, 'road_dirt_snow', -4, 0); use(c, 'road_dirt_snow', 4, 0);
      use(c, 'house_wood_small_snow', -4, -5, 2);
      use(c, 'well_snow', 4, 4);
      use(c, 'fence_straight_snow', 4, -4, 0, 2);
      use(c, 'hay_stack_snow', -6, 5);
      use(c, 'tree_pine_snow', 7, -6); use(c, 'tree_pine_snow', -7, 7);
      use(c, 'snowman_yard', 0, 5);
      c.dec('lantern_post', 1, 0, -2, 0);
      c.dec('frozen_bush', -7, 0, -2, yaw(c));
      bits(c, 6, 7);
    },
  },
  ];
}
