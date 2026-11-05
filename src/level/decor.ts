import { t } from '../i18n/i18n.ts';
import type { Part } from './palette.ts';

/**
 * Decor registry: free items on top of blocks — fallen columns, rubble, chains, roots, cobwebs, banners, lanterns.
 * As in Minecraft Dungeons: what you walk on is blocks, while decor lies, hangs and stands anywhere and at any angle,
 * but is built from 1/16 cubes with the same 16-per-metre pixel textures (wiki/design-level-decor.md).
 * Shapes — assets/decor/*.obj (scripts/gen-decor.mjs, `npm run decor`). Maps reference decor by name — do not rename.
 */

/** Where it attaches: on the floor, on a wall (back to the wall, facing out along the shape's +Z), to the ceiling (hangs down) */
export type Anchor = 'floor' | 'wall' | 'ceiling';

/** Collision box in the shape's local coordinates, m: width along X, depth along Z, height; x, z — centre offset */
export interface DecorBox { w: number; d: number; h: number; x?: number; z?: number }

export interface DecorDef {
  name: string;
  title: string;
  category: string;
  /** Parts: a shape from assets/decor (or a block one) and textures in its slots; layer — as for blocks, plus glow */
  parts: Part[];
  anchor: Anchor;
  /** Blocks movement: boxes for the hero, paths and enemies (rotate with the item, tilt is ignored) */
  solid?: DecorBox[];
  /** Light source; at — point in the shape's local coordinates */
  /** Light source; at — point in the shape's local coordinates; baked — no PointLight, the warm colour is "baked" into the vertices of nearby blocks */
  light?: { color: string; intensity: number; dist: number; at: [number, number, number]; baked?: boolean };
}

const D = (name: string, title: string, category: string, anchor: Anchor, parts: Part[], o: Partial<DecorDef> = {}): DecorDef =>
  ({ name, title, category, anchor, parts, ...o });
const p = (obj: string, tex: Record<string, string>, layer?: Part['layer']): Part => ({ obj, tex, ...(layer ? { layer } : {}) });

export const DECOR: DecorDef[] = [
  // --- ruins ---
  D('column_fallen', 'Fallen column', 'ruins', 'floor', [p('column_fallen', { side: 'stoneBricks', top: 'stone' })],
    { solid: [{ w: 2.7, d: 1, h: 0.9, x: -0.1 }] }),
  D('column_stump', 'Column stump', 'ruins', 'floor', [p('column_stump', { side: 'stoneBricksOld', top: 'stone' })],
    { solid: [{ w: 1, d: 1, h: 1.45 }] }),
  D('rubble', 'Rubble', 'ruins', 'floor', [p('rubble', { side: 'cobble', top: 'stone', bottom: 'stone' })]),
  D('bricks_loose', 'Loose bricks', 'ruins', 'floor', [p('bricks_loose', { side: 'stoneBricks', top: 'stoneBricks', bottom: 'stone' })]),
  D('bones', 'Bones and skull', 'ruins', 'floor', [p('bones', { bone: 'bone', dark: 'ironDark' })]),
  // "Ruins" batch (wiki/design-prefab-library.md): gravestones, cross, statue, bowl, pots, ivy, skull
  D('gravestone', 'Gravestone', 'ruins', 'floor', [p('gravestone', { side: 'stone', top: 'stone', bottom: 'stone' })], { solid: [{ w: 0.5, d: 0.2, h: 0.9 }] }),
  D('gravestone_wide', 'Wide gravestone', 'ruins', 'floor', [p('gravestone_wide', { side: 'stoneBricksOld', top: 'stone', bottom: 'stone' })], { solid: [{ w: 0.75, d: 0.2, h: 0.6 }] }),
  D('gravestone_fallen', 'Fallen gravestone', 'ruins', 'floor', [p('gravestone_fallen', { side: 'stone', top: 'stone', bottom: 'stone' })]),
  D('grave_cross', 'Grave cross', 'ruins', 'floor', [p('grave_cross', { side: 'planksDark', top: 'planksDark', bottom: 'planksDark' })]),
  D('statue_hooded', 'Hooded statue', 'ruins', 'floor', [p('statue_hooded', { side: 'stone', top: 'stone', bottom: 'stone', hood: 'stoneBricksOld' })], { solid: [{ w: 0.9, d: 0.9, h: 2.2 }] }),
  D('stone_bowl', 'Stone bowl', 'ruins', 'floor', [p('stone_bowl', { side: 'stone', top: 'stone', bottom: 'stone', inner: 'cobble' })], { solid: [{ w: 0.9, d: 0.9, h: 0.55 }] }),
  D('pot_clay', 'Clay pots', 'ruins', 'floor', [p('pot_clay', { side: 'clay', top: 'clay', bottom: 'clay' })]),
  D('ivy', 'Ivy', 'ruins', 'wall', [p('ivy', { side: 'ivy' }, 'cutout')]),
  D('skull', 'Skull', 'ruins', 'floor', [p('skull', { bone: 'bone', dark: 'ironDark' })]),

  // --- walls and ceiling ---
  D('chain', 'Chain', 'walls', 'ceiling', [p('chain', { side: 'ironDark' })]),
  D('roots', 'Roots', 'walls', 'wall', [p('roots', { side: 'roots' })]),
  D('cobweb', 'Cobweb', 'walls', 'wall', [p('cobweb', { side: 'cobweb' }, 'cutout')]),
  D('banner', 'Banner', 'walls', 'wall', [p('banner', { pole: 'planksDark', cloth: 'banner' })]),

  // --- light ---
  D('torch_wall', 'Wall torch', 'lighting', 'wall',
    [p('torch_wall', { iron: 'ironDark', tip: 'ash', stick: 'logSide' }), p('torch_wall_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffa040', intensity: 6, dist: 7, at: [0, 0.35, 0.45] } }),
  D('candles', 'Candles', 'lighting', 'floor', [p('candles', { side: 'candle', top: 'candle', bottom: 'candle', drip: 'candle' }), p('candles_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffb860', intensity: 2.5, dist: 4, at: [0, 0.5, 0] } }),
  D('mushrooms_glow', 'Glowing mushrooms', 'lighting', 'floor', [p('mushrooms', { stem: 'mushroomStem', cap: 'mushroomGlow' }, 'glow')],
    { light: { color: '#ffd24a', intensity: 1.6, dist: 3.5, at: [0, 0.4, 0] } }),
  D('lantern_post', 'Lantern post', 'lighting', 'floor', [p('lantern_post', { post: 'planksDark', iron: 'ironDark' }), p('lantern_post_glass', { side: 'lanternGlass' }, 'glow')],
    { solid: [{ w: 0.35, d: 0.35, h: 2.2 }], light: { color: '#ffc870', intensity: 6, dist: 8, at: [0.53, 1.75, 0] } }),

  // --- yard ---
  D('mushrooms', 'Mushrooms', 'yard', 'floor', [p('mushrooms', { stem: 'mushroomStem', cap: 'mushroomRed' })]),
  D('planter', 'Flower box', 'yard', 'floor', [p('planter', { side: 'planks', top: 'planks', bottom: 'planks', soil: 'farm' }), p('planter_flowers', { side: 'flowerRed' }, 'cutout')],
    { solid: [{ w: 1, d: 0.75, h: 0.6 }] }),
  D('crates_tilted', 'Crate stack', 'yard', 'floor', [p('crates_tilted', { side: 'crate', top: 'crate', bottom: 'crate' })],
    { solid: [{ w: 2, d: 1.1, h: 1.9 }] }),

  // --- world: yard (screenshot 10, wiki/style-world.md) ---
  D('crate_banded', 'Banded crate', 'storage', 'floor', [p('crate_banded', { side: 'crateBand', top: 'crateBandTop', bottom: 'crateBandTop' })], { solid: [{ w: 0.95, d: 0.95, h: 0.95 }] }),
  D('crates_banded_stack', 'Banded crate stack', 'storage', 'floor', [p('crates_banded_stack', { side: 'crateBand', top: 'crateBandTop', bottom: 'crateBandTop' })], { solid: [{ w: 2, d: 1.05, h: 1.9 }] }),
  D('crate_small', 'Small crate', 'storage', 'floor', [p('crate_small', { side: 'crate', top: 'crate', bottom: 'crate', rim: 'planksDark' })], { solid: [{ w: 0.65, d: 0.65, h: 0.6 }] }),
  D('chest', 'Chest', 'storage', 'floor', [p('chest', { side: 'chestWood', top: 'chestWood', bottom: 'chestWood', lid: 'chestWood', trim: 'chestTrim' })], { solid: [{ w: 0.9, d: 0.65, h: 0.75 }] }),
  D('cart', 'Cart', 'storage', 'floor', [p('cart', { side: 'cartWood', top: 'cartWood', bottom: 'cartWood', wheel: 'planksDark', iron: 'ironDark' })], { solid: [{ w: 1.1, d: 1.35, h: 0.9, z: -0.05 }] }),
  D('cart_loaded', 'Loaded cart', 'storage', 'floor', [p('cart_loaded', { side: 'cartWood', top: 'cartWood', bottom: 'cartWood', wheel: 'planksDark', iron: 'ironDark', hay: 'hay', hayTop: 'hayTop', box: 'crateBand' })], { solid: [{ w: 1.1, d: 1.35, h: 1.3, z: -0.05 }] }),
  D('bench', 'Bench', 'storage', 'floor', [p('bench', { side: 'planks', top: 'planks', bottom: 'planks' })], { solid: [{ w: 1.3, d: 0.4, h: 0.55 }] }),
  D('lantern_post_double', 'Double lantern', 'lanterns', 'floor', [p('lantern_post_double', { post: 'planksDark', iron: 'ironDark' }), p('lantern_post_double_glass', { side: 'lanternGlass' }, 'glow')],
    { solid: [{ w: 0.35, d: 0.35, h: 2.4 }], light: { color: '#ffc870', intensity: 7, dist: 9, at: [0, 1.85, 0] } }),
  D('lantern_wall', 'Wall lantern', 'lanterns', 'wall', [p('lantern_wall', { iron: 'ironDark' }), p('lantern_wall_glass', { side: 'lanternGlass' }, 'glow')],
    { light: { color: '#ffc870', intensity: 5, dist: 7, at: [0, -0.45, 0.4] } }),
  D('lantern_short', 'Short lantern', 'lanterns', 'floor', [p('lantern_short', { post: 'planksDark', iron: 'ironDark' }), p('lantern_short_glass', { side: 'lanternGlass' }, 'glow')],
    { solid: [{ w: 0.3, d: 0.3, h: 1.4 }], light: { color: '#ffc870', intensity: 4, dist: 6, at: [0, 1.2, 0] } }),
  // --- world: water (screenshot 11) ---
  D('waterfall_splash', 'Waterfall splash', 'water', 'floor', [p('waterfall_splash', { side: 'foam', top: 'foam', bottom: 'foam' })]),
  D('waterfall_foam', 'Foam by the rocks', 'water', 'floor', [p('waterfall_foam', { side: 'foam', top: 'foam', bottom: 'foam' })]),
  D('foam_patch', 'Foam on water', 'water', 'floor', [p('foam_patch', { side: 'foam', top: 'foam', bottom: 'foam' })]),
  // --- world: candles (screenshot 13) — light is baked into neighbouring blocks, no PointLight ---
  // --- nature (wiki/design-prefab-library.md, "Road and nature" batch) ---
  D('tree_dead', 'Dead tree', 'nature', 'floor', [p('tree_dead', { side: 'barkDead', top: 'barkDead', bottom: 'barkDead' })],
    { solid: [{ w: 0.5, d: 0.5, h: 2.3 }] }),
  D('reeds', 'Reeds', 'nature', 'floor', [p('reeds', { side: 'reeds' }, 'cutout')]),
  D('stump', 'Stump', 'nature', 'floor', [p('stump', { side: 'logSide', top: 'logTop', bottom: 'logTop' })], { solid: [{ w: 0.65, d: 0.65, h: 0.4 }] }),
  D('rock_small', 'Pebbles', 'nature', 'floor', [p('rock_small', { side: 'cliff', top: 'stone', bottom: 'stone' })]),
  D('leaf_litter', 'Fallen leaves', 'nature', 'floor', [p('leaf_litter', { side: 'leafLitter', top: 'leafLitter', bottom: 'leafLitter' }, 'cutout')]),

  // --- village (batch 4): windmill sails, barrels, sacks, well, bucket, ladder, tent, scarecrow, firewood, signpost, broken cart ---
  D('windmill_sails', 'Windmill sails', 'village', 'wall', [p('windmill_sails', { side: 'planksDark', lattice: 'planks', iron: 'ironDark' })]),
  D('windmill_sails_broken', 'Windmill sails: broken', 'village', 'wall', [p('windmill_sails_broken', { side: 'planksDark', lattice: 'planks', iron: 'ironDark' })]),
  D('barrel', 'Barrel', 'village', 'floor', [p('barrel', { side: 'barrel', top: 'barrelTop', bottom: 'barrelTop' })], { solid: [{ w: 0.75, d: 0.75, h: 0.9 }] }),
  D('barrel_broken', 'Broken barrel', 'village', 'floor', [p('barrel_broken', { side: 'barrel', top: 'barrelTop', bottom: 'barrelTop' })]),
  D('sack', 'Sack', 'village', 'floor', [p('sack', { side: 'burlap', top: 'burlap', bottom: 'burlap' })]),
  D('sacks_pile', 'Sack pile', 'village', 'floor', [p('sacks_pile', { side: 'burlap', top: 'burlap', bottom: 'burlap' })], { solid: [{ w: 1.2, d: 1, h: 0.7 }] }),
  D('well_roof', 'Well roof', 'village', 'floor', [p('well_roof', { post: 'planksDark', roof: 'shingles', iron: 'ironDark', rope: 'burlap' })]),
  D('bucket', 'Bucket', 'village', 'floor', [p('bucket', { side: 'planksDark', top: 'planksDark', bottom: 'planksDark', iron: 'ironDark' })]),
  D('ladder', 'Leaning ladder', 'village', 'wall', [p('ladder', { side: 'planksDark', top: 'planksDark', bottom: 'planksDark' })]),
  D('tent', 'Tent', 'village', 'floor', [p('tent', { cloth: 'tentCloth', pole: 'planksDark' })], { solid: [{ w: 2, d: 2, h: 1.4 }] }),
  D('scarecrow', 'Scarecrow', 'village', 'floor', [p('scarecrow', { pole: 'planksDark', hay: 'hay', hayTop: 'hayTop', cloth: 'tentCloth' })], { solid: [{ w: 0.3, d: 0.3, h: 2 }] }),
  D('firewood_pile', 'Firewood', 'village', 'floor', [p('firewood_pile', { side: 'logSide', end: 'logTop' })], { solid: [{ w: 1, d: 0.6, h: 0.6 }] }),
  D('signpost', 'Signpost', 'village', 'floor', [p('signpost', { post: 'planksDark', board: 'planks' })]),
  D('cart_broken', 'Broken cart', 'village', 'floor', [p('cart_broken', { side: 'cartWood', top: 'cartWood', bottom: 'cartWood', wheel: 'planksDark', iron: 'ironDark' })], { solid: [{ w: 1.4, d: 1.4, h: 0.8 }] }),

  // --- snow (the "snow" biome): snowdrifts, icicles, ice spikes, snowman, logs and rocks under snow ---
  D('snow_pile', 'Snow pile', 'snow', 'floor', [p('snow_pile', { side: 'snowTop', top: 'snowTop', bottom: 'snowTop' })]),
  D('snowdrift', 'Snowdrift by a wall', 'snow', 'wall', [p('snowdrift', { side: 'snowTop', top: 'snowTop', bottom: 'snowTop' })]),
  D('icicles', 'Icicles', 'snow', 'ceiling', [p('icicles', { side: 'ice', top: 'ice', bottom: 'ice' })]),
  D('icicles_wall', 'Icicles on a wall', 'snow', 'wall', [p('icicles_wall', { side: 'ice', top: 'ice', bottom: 'ice' })]),
  D('ice_spikes', 'Ice spikes', 'snow', 'floor', [p('ice_spikes', { side: 'ice', top: 'ice', bottom: 'iceCracked' })], { solid: [{ w: 0.9, d: 0.9, h: 1.1 }] }),
  D('frozen_bush', 'Frozen bush', 'snow', 'floor', [p('frozen_bush', { side: 'barkDead', top: 'snowTop', bottom: 'barkDead', snow: 'snowTop' })]),
  D('snowman', 'Snowman', 'snow', 'floor', [p('snowman', { side: 'snowTop', top: 'snowTop', bottom: 'snowTop', iron: 'ironDark', carrot: 'clay', stick: 'barkDead' })], { solid: [{ w: 0.7, d: 0.7, h: 1.6 }] }),
  D('log_snow', 'Log under snow', 'snow', 'floor', [p('log_snow', { side: 'logSide', end: 'logTop', snow: 'snowTop' })], { solid: [{ w: 1.3, d: 0.4, h: 0.4 }] }),
  D('rock_snow', 'Pebbles under snow', 'snow', 'floor', [p('rock_snow', { side: 'cliff', top: 'snowTop', bottom: 'stone' })]),

  // --- jungle (the "jungle" biome, reference 16): crystals with light, vines, roots, idol, mossy log, ferns, lily pads ---
  D('crystal_cluster', 'Crystal cluster', 'jungle', 'floor', [p('crystal_cluster', { side: 'crystal', top: 'crystal', bottom: 'crystal' }, 'glow')],
    { solid: [{ w: 0.9, d: 0.9, h: 1.6 }], light: { color: '#6fe8e0', intensity: 1.4, dist: 5, at: [0, 0.8, 0], baked: true } }),
  D('crystal_shard', 'Crystal shard', 'jungle', 'floor', [p('crystal_shard', { side: 'crystal', top: 'crystal', bottom: 'crystal' }, 'glow')],
    { light: { color: '#6fe8e0', intensity: 0.6, dist: 3, at: [0, 0.2, 0], baked: true } }),
  D('vines_hanging', 'Hanging vines', 'jungle', 'ceiling', [p('vines_hanging', { side: 'vine' }, 'cutout')]),
  D('vines_wall', 'Vines on a wall', 'jungle', 'wall', [p('vines_wall', { side: 'vine' }, 'cutout')]),
  D('roots_big', 'Buttress roots', 'jungle', 'floor', [p('roots_big', { side: 'logJungleSide', top: 'logJungleSide', bottom: 'logJungleSide' })]),
  D('idol_head', 'Idol head', 'jungle', 'floor', [p('idol_head', { side: 'templeStone', top: 'templeStoneTop', bottom: 'templeStoneTop', carved: 'templeStoneCarved', dark: 'ironDark' })], { solid: [{ w: 1, d: 1, h: 1.2 }] }),
  D('log_mossy_fallen', 'Mossy log', 'jungle', 'floor', [p('log_mossy_fallen', { side: 'logJungleSide', end: 'logJungleTop', moss: 'mossBlock' }), p('log_mossy_fallen_fern', { side: 'fernBig' }, 'cutout')], { solid: [{ w: 1.5, d: 0.5, h: 0.5 }] }),
  D('fern_cluster', 'Ferns', 'jungle', 'floor', [p('fern_cluster', { side: 'fernBig' }, 'cutout')]),
  D('lily_pad', 'Lily pads', 'jungle', 'floor', [p('lily_pad', { top: 'lilyPad' }, 'cutout')]),

  D('candles_group', 'Candle cluster', 'candles', 'floor', [p('candles_group', { side: 'candle', top: 'candle', bottom: 'candle' }), p('candles_group_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffb25a', intensity: 0.9, dist: 2.6, at: [0, 0.4, 0], baked: true } }),
  D('candles_row', 'Candle row', 'candles', 'floor', [p('candles_row', { side: 'candle', top: 'candle', bottom: 'candle' }), p('candles_row_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffb25a', intensity: 0.8, dist: 3, at: [0, 0.4, 0], baked: true } }),
  D('candle_tall', 'Tall candle', 'candles', 'floor', [p('candle_tall', { side: 'candle', top: 'candle', bottom: 'candle' }), p('candle_tall_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffb25a', intensity: 0.6, dist: 2, at: [0, 0.8, 0], baked: true } }),
];

export const DECOR_BY_NAME: Record<string, DecorDef> = Object.fromEntries(DECOR.map((d) => [d.name, d]));

export function decorDef(name: string): DecorDef {
  const d = DECOR_BY_NAME[name];
  if (!d) throw new Error(`No decor "${name}" in the registry`);
  return d;
}

/** All decor texture names (for the atlas) */
export function decorTextures(): string[] {
  const s = new Set<string>();
  for (const d of DECOR) for (const part of d.parts) if (part.layer !== 'fire') for (const t of Object.values(part.tex)) for (const n of Array.isArray(t) ? t : [t]) s.add(n);
  return [...s];
}

export const DECOR_CATEGORIES: string[] = [...new Set(DECOR.map((d) => d.category))];
/** Categories of the "world" set — in the playground "world" zone, not in the decor showcase */
export const WORLD_DECOR_CATEGORIES = ['storage', 'lanterns', 'water', 'candles'];
/** Human titles of decor categories (the editor palette); category ids are the keys, the same as `t(category)` */
export const DECOR_CATEGORY_TITLES: Record<string, string> = Object.fromEntries(DECOR_CATEGORIES.map((c) => [c, t(c)]));

/** Decor rotation [yaw, pitch, roll] in degrees → three Euler angles (YXZ order); yaw as for blocks: 90° turns +X into +Z */
export function decorEuler(rot: readonly number[] | undefined): [number, number, number] {
  const k = Math.PI / 180;
  return [(rot?.[1] ?? 0) * k, -(rot?.[0] ?? 0) * k, (rot?.[2] ?? 0) * k];
}
