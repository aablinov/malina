import { t } from '../i18n/i18n.ts';

/**
 * Block palette: which shapes (assets/blocks/*.obj) and textures (textures.ts) each block is built from,
 * how it collides with the hero and how it is drawn. Maps (assets/maps/*.json) reference blocks by name,
 * so names are never renamed — only added.
 */

/** detail — small grass on top of blocks: like cutout, but without shadows (cheap) */
export type Layer = 'opaque' | 'cutout' | 'water' | 'acid' | 'fire' | 'glow' | 'detail' | 'river' | 'falls' | 'portal' | 'lava';

export interface Part {
  /** Shape name — file assets/blocks/<obj>.obj */
  obj: string;
  layer?: Layer;
  /** Texture slot of the shape (usemtl) → texture name from textures.ts; an array — variants picked by cell hash */
  tex: Record<string, string | string[]>;
  /** Put a copy towards every neighbour that connects (fence rails, wall segments) */
  connect?: boolean;
}

export interface BlockDef {
  name: string;
  title: string;
  category: string;
  parts: Part[];
  /** Collision height, m; 0 — walkable through */
  collide: number;
  /** Full opaque cube: hides neighbours' faces and shades corners */
  full: boolean;
  /** Hide faces between two identical blocks (water) */
  cullSame?: boolean;
  /** Brightness spread between blocks, 0..1 */
  jitter?: number;
  /** Random rotation, offset and size inside the cell (grass, flowers) */
  scatter?: boolean;
  /** The editor puts a new block straight in place of this one (grass, flowers, fire) */
  replaceable?: boolean;
  /** Light source at the block centre */
  light?: { color: string; intensity: number; dist: number };
  /** Fence and wall rails reach towards it */
  connects?: boolean;
  /** Worth rotating (stairs, logs) */
  rotatable?: boolean;
  /** Stairs: low half 0.5, high half 1 — they lead up onto a block */
  stairs?: boolean;
  /** Fringe: hangs from the top edge on the side where the neighbour is lower (ledge, bank) — texture */
  fringe?: string;
  /** Small tufts on an open top, denser in patches — textures (picked by hash) */
  tufts?: string[];
  /**
   * Ragged edge: the top of this block "spills" onto the top of a neighbour of other natural ground (grass ↔ path) —
   * mask textures, picked by hash; so the border does not follow the cell grid
   */
  bleed?: string[];
  /** Baked light: no PointLight, the colour is mixed into the vertices of blocks around (portal, candles — mesher.ts) */
  bakedLight?: { color: string; intensity: number; dist: number };
  /** Liquid flow, m/s: glints and streaks run in the rotation direction (rot 0 — towards +X) */
  flow?: number;
  /** Natural ground: the colour drifts smoothly in large patches across the world (lighter-yellower / darker), not per block */
  natural?: boolean;
}

const cube = (tex: Record<string, string | string[]>, obj = 'cube'): Part => ({ obj, tex });
const same = (t: string | string[]): Record<string, string | string[]> => ({ top: t, side: t, bottom: t });

type Opts = Partial<Omit<BlockDef, 'name' | 'title' | 'category' | 'parts'>>;
const B = (name: string, title: string, category: string, parts: Part[], o: Opts = {}): BlockDef =>
  ({ name, title, category, parts, collide: 1, full: false, ...o });

/** Full cube from one texture (or top/side/bottom) */
const solid = (name: string, title: string, cat: string, tex: string | string[] | Record<string, string | string[]>, o: Opts = {}): BlockDef =>
  // stone — almost no spread between blocks (even Minecraft Dungeons walls), everything else — 0.08
  B(name, title, cat, [cube(typeof tex === 'string' || Array.isArray(tex) ? same(tex) : tex)], { full: true, connects: true, jitter: cat === 'stone' ? 0.03 : 0.08, ...o });
/** Set of cube + stairs + half-block + wall from one stone */
function stoneSet(name: string, title: string, cat: string, tex: string | string[], wall = true): BlockDef[] {
  const out = [
    solid(name, title, cat, tex),
    B(`${name}_stairs`, `${title}: stairs`, cat, [cube(same(tex), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
    B(`${name}_slab`, `${title}: half-block`, cat, [cube(same(tex), 'slab')], { collide: 0.5, connects: true }),
  ];
  if (wall) out.push(B(`${name}_wall`, `${title}: wall`, cat, [cube(same(tex), 'wall_post'), { obj: 'wall_seg', tex: same(tex), connect: true }], { collide: 1.5, connects: true }));
  return out;
}

export const BLOCKS: BlockDef[] = [
  B('air', 'Air', 'service', [], { collide: 0 }),

  // --- ground ---
  solid('grass', 'Grass', 'ground', { top: 'grassTop', side: 'grassSide', bottom: 'dirt' }, { jitter: 0.02, natural: true, bleed: ['grassEdge0', 'grassEdge1', 'grassEdge2', 'grassEdge3'], fringe: 'grassFringe', tufts: ['grassTuft', 'grassTuft', 'grassTuft', 'flowerTuft'] }),
  solid('dirt', 'Dirt', 'ground', 'dirt', { jitter: 0.02, natural: true }),
  solid('path', 'Path', 'ground', 'path', { jitter: 0.02, natural: true, bleed: ['pathEdge0', 'pathEdge1', 'pathEdge2', 'pathEdge3'] }),
  solid('gravel', 'Gravel', 'ground', 'gravel', { jitter: 0.03, natural: true }),
  solid('sand', 'Sand', 'ground', 'sand', { jitter: 0.02, natural: true }),
  solid('farm', 'Farm plot', 'ground', { top: 'farm', side: 'dirt', bottom: 'dirt' }),
  // wading: the floor in liquid is half a block below the cell top — you walk in knee-deep and step out normally (no jump)
  B('water', 'Water', 'ground', [{ obj: 'water', layer: 'water', tex: same('water') }], { collide: 0.5, cullSame: true, jitter: 0 }),
  B('acid', 'Acid', 'ground', [{ obj: 'water', layer: 'acid', tex: same('acid') }], { collide: 0.5, cullSame: true, jitter: 0, light: { color: '#7dff5a', intensity: 3, dist: 5 } }),
  B('hole', 'Beetle hole', 'ground', [cube(same('hole'), 'layer')], { collide: 0, replaceable: true }),

  // --- stone ---
  ...stoneSet('stone', 'Stone', 'stone', 'stone'),
  ...stoneSet('cobble', 'Cobblestone', 'stone', 'cobble'),
  solid('mossy', 'Mossy cobblestone', 'stone', 'mossy'),
  ...stoneSet('bricks', 'Stone bricks', 'stone', 'stoneBricks'),
  solid('bricks_mossy', 'Mossy bricks', 'stone', 'stoneBricksMossy'),
  solid('bricks_cracked', 'Cracked bricks', 'stone', 'stoneBricksCracked'),
  solid('bricks_old', 'Ruin bricks', 'stone', ['stoneBricksOld', 'stoneBricksOld', 'stoneBricksOld', 'stoneBricksOldMossy']),
  // ruin bricks: stairs, half-block and wall — for arches, broken walls and battlements (preset library, "Ruins" batch)
  B('bricks_old_stairs', 'Ruin bricks: stairs', 'stone', [cube(same(['stoneBricksOld', 'stoneBricksOld', 'stoneBricksOldMossy']), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('bricks_old_slab', 'Ruin bricks: half-block', 'stone', [cube(same(['stoneBricksOld', 'stoneBricksOld', 'stoneBricksOldMossy']), 'slab')], { collide: 0.5, connects: true }),
  B('bricks_old_wall', 'Ruin bricks: wall', 'stone', [cube(same('stoneBricksOld'), 'wall_post'), { obj: 'wall_seg', tex: same('stoneBricksOld'), connect: true }], { collide: 1.5, connects: true }),
  ...stoneSet('tiles', 'Paving slabs', 'stone', 'tiles', false),
  // broken slabs (the Limgrave road): one slab fell out, dirt underneath — two variants by cell hash
  solid('tiles_broken', 'Broken slabs', 'stone', { top: ['tilesBroken0', 'tilesBroken1'], side: 'tiles', bottom: 'tiles' }),
  B('bricks_low', 'Bricks: low cover', 'stone', [cube(same('stoneBricks'), 'low')], { collide: 0.875, connects: true }),
  B('cobble_low', 'Cobblestone: low cover', 'stone', [cube(same('cobble'), 'low')], { collide: 0.875, connects: true }),

  // --- wood ---
  solid('log', 'Wooden log', 'wood', { top: 'logTop', side: 'logSide', bottom: 'logTop' }),
  B('log_x', 'Log lying', 'wood', [cube({ top: 'logTop', side: 'logSide', bottom: 'logSide' }, 'cube_x')], { full: true, connects: true, rotatable: true }),
  ...stoneSet('planks', 'Planks', 'wood', 'planks', false),
  ...stoneSet('planks_dark', 'Dark planks', 'wood', 'planksDark', false),
  B('fence', 'Fence', 'wood', [cube(same('planks'), 'fence_post'), { obj: 'fence_rail', tex: same('planks'), connect: true }], { collide: 1.5, connects: true }),
  B('crate', 'Crate', 'wood', [cube(same('crate'), 'crate')], { connects: true }),
  B('rail', 'Plot rail', 'wood', [cube(same('logSide'), 'rail')], { collide: 0, rotatable: true }),
  B('roof_stairs', 'Roof tiles: stairs', 'wood', [cube(same('roof'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('roof_slab', 'Roof tiles: half-block', 'wood', [cube(same('roof'), 'slab')], { collide: 0.5, connects: true }),
  B('roof_dark_stairs', 'Dark roof tiles: stairs', 'wood', [cube(same('roofDark'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('roof_dark_slab', 'Dark roof tiles: half-block', 'wood', [cube(same('roofDark'), 'slab')], { collide: 0.5, connects: true }),
  solid('hay', 'Hay', 'wood', { top: 'hayTop', side: 'hay', bottom: 'hayTop' }),
  // camp palisade (preset library, batch 5): sharpened stake 12/16, cannot be stepped over
  B('stake_fence', 'Palisade', 'wood', [cube({ side: 'stake', top: 'stakeTop', bottom: 'logTop' }, 'post')], { collide: 1.5 }),
  // village roofs (preset library, batch 4): thatch and dark tiles
  B('roof_thatch_stairs', 'Thatch: stairs', 'wood', [cube(same('thatch'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('roof_thatch_slab', 'Thatch: half-block', 'wood', [cube(same('thatch'), 'slab')], { collide: 0.5, connects: true }),
  B('shingles_stairs', 'Brown shingles: stairs', 'wood', [cube(same('shingles'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('shingles_slab', 'Brown shingles: half-block', 'wood', [cube(same('shingles'), 'slab')], { collide: 0.5, connects: true }),

  // --- snow (the "snow" biome, wiki/design-prefab-library.md) ---
  solid('snow', 'Snow', 'snow', { top: 'snowTop', side: 'snowSide', bottom: 'dirt' }, { jitter: 0.02, natural: true, bleed: ['snowEdge0', 'snowEdge1', 'snowEdge2', 'snowEdge3'], fringe: 'snowFringe' }),
  B('snow_slab', 'Snow: half-block', 'snow', [cube({ top: 'snowTop', side: 'snowSide', bottom: 'dirt' }, 'slab')], { collide: 0.5, connects: true, jitter: 0.02, natural: true, fringe: 'snowFringe' }),
  B('snow_layer', 'Snow: layer', 'snow', [cube(same('snowTop'), 'layer')], { collide: 0, replaceable: true, jitter: 0.02, natural: true }),
  solid('cliff_snow', 'Cliff under snow', 'snow', { top: 'snowTop', side: 'cliffSnowSide', bottom: 'cliff' }, { jitter: 0.02, natural: true, fringe: 'snowFringe' }),
  solid('ice', 'Ice', 'snow', 'ice', { jitter: 0 }),
  solid('ice_cracked', 'Cracked ice', 'snow', 'iceCracked', { jitter: 0 }),
  B('ice_slab', 'Ice: half-block', 'snow', [cube(same('ice'), 'slab')], { collide: 0.5, connects: true, jitter: 0 }),
  solid('frozen_water', 'Frozen water', 'snow', 'frozenWater', { jitter: 0 }),
  B('leaves_snow', 'Needles under snow', 'snow', [{ obj: 'cube', layer: 'cutout', tex: { top: 'snowTop', side: 'leavesSnowCut', bottom: 'leavesSnowCut' } }], { jitter: 0.08 }),
  B('dead_bush_snow', 'Dead bush in snow', 'snow', [{ obj: 'cross', layer: 'cutout', tex: { side: 'deadBushSnow' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.1 }),

  // --- jungle with crystals (the "jungle" biome, wiki/design-prefab-library.md, reference 16) ---
  // the ground is a mosaic of flat blocks, as on the reference: orange, dark red, teal moss; laid out in noise patches — jungleGroundAt (kit.ts)
  solid('jungle_floor', 'Jungle floor', 'jungle', { top: 'jungleTop', side: 'jungleSide', bottom: 'dirt' }, { jitter: 0.03, natural: true, bleed: ['jungleEdge0', 'jungleEdge1', 'jungleEdge2', 'jungleEdge3'], fringe: 'jungleFringe' }),
  B('jungle_floor_slab', 'Jungle floor: half-block', 'jungle', [cube({ top: 'jungleTop', side: 'jungleSide', bottom: 'dirt' }, 'slab')], { collide: 0.5, connects: true, jitter: 0.03, natural: true, fringe: 'jungleFringe', bleed: ['jungleEdge0', 'jungleEdge1', 'jungleEdge2', 'jungleEdge3'] }),
  solid('jungle_floor_red', 'Red jungle floor', 'jungle', { top: 'jungleRed', side: 'jungleSide', bottom: 'dirt' }, { jitter: 0.03, natural: true, bleed: ['jungleRedEdge0', 'jungleRedEdge1', 'jungleRedEdge2', 'jungleRedEdge3'] }),
  solid('moss_teal', 'Teal moss', 'jungle', { top: 'mossTeal', side: 'jungleSide', bottom: 'dirt' }, { jitter: 0.03, natural: true, fringe: 'jungleFringe', bleed: ['mossTealEdge0', 'mossTealEdge1', 'mossTealEdge2', 'mossTealEdge3'] }),
  solid('cliff_jungle', 'Mossy cliff', 'jungle', { top: 'jungleTop', side: 'cliffJungleSide', bottom: 'cliff' }, { jitter: 0.03, natural: true, fringe: 'jungleFringe' }),
  solid('moss_block', 'Moss', 'jungle', 'mossBlock', { jitter: 0.06, natural: true, bleed: ['mossEdge0', 'mossEdge1', 'mossEdge2', 'mossEdge3'] }),
  B('moss_carpet', 'Moss: carpet', 'jungle', [cube(same('mossBlock'), 'layer')], { collide: 0, replaceable: true, jitter: 0.06, natural: true }),
  B('leaves_jungle', 'Jungle leaves', 'jungle', [{ obj: 'leaves_fluffy', layer: 'cutout', tex: { side: 'leavesJungle', puff: 'leavesJunglePuff' } }], { jitter: 0.1 }),
  solid('log_jungle', 'Jungle log', 'jungle', { top: 'logJungleTop', side: 'logJungleSide', bottom: 'logJungleTop' }),
  B('vine', 'Vine', 'jungle', [{ obj: 'cross', layer: 'cutout', tex: { side: 'vine' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.15 }),
  B('fern_big', 'Big fern', 'jungle', [{ obj: 'cross', layer: 'cutout', tex: { side: 'fernBig' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.15 }),
  B('flower_pink', 'Pink flower', 'jungle', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerPink' } }], { collide: 0, scatter: true, replaceable: true }),
  ...stoneSet('temple_stone', 'Temple stone', 'jungle', 'templeStone'),
  solid('temple_stone_carved', 'Temple stone: carved', 'jungle', { top: 'templeStoneTop', side: 'templeStoneCarved', bottom: 'templeStoneTop' }),
  solid('temple_stone_mossy', 'Temple stone: mossy', 'jungle', 'templeStoneMossy'),
  // crystal: three prisms, glow layer (not tone-mapped, glows under bloom), baked teal light over 4 m
  B('crystal', 'Crystal', 'jungle', [{ obj: 'crystal', layer: 'glow', tex: same('crystal') }], { collide: 1, jitter: 0, bakedLight: { color: '#6fe8e0', intensity: 1.0, dist: 4 } }),
  B('crystal_small', 'Small crystal', 'jungle', [{ obj: 'crystal_small', layer: 'glow', tex: same('crystal') }], { collide: 0, scatter: true, replaceable: true, jitter: 0, bakedLight: { color: '#6fe8e0', intensity: 0.5, dist: 2.5 } }),

  // --- plants ---
  B('leaves', 'Leaves', 'plants', [{ obj: 'cube', layer: 'cutout', tex: same('leavesCut') }], { jitter: 0.12 }),
  B('berry_bush', 'Berry bush', 'plants', [{ obj: 'cube', layer: 'cutout', tex: same('berryBush') }], { jitter: 0.1 }),
  B('tall_grass', 'Tall grass', 'plants', [{ obj: 'cross', layer: 'cutout', tex: { side: 'tallGrass' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.3 }),
  B('fern', 'Fern', 'plants', [{ obj: 'cross', layer: 'cutout', tex: { side: 'fern' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.2 }),
  B('flower_red', 'Red flower', 'plants', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerRed' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_blue', 'Blue flower', 'plants', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerBlue' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_white', 'White flower', 'plants', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerWhite' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_yellow', 'Yellow flower', 'plants', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerYellow' } }], { collide: 0, scatter: true, replaceable: true }),
  B('crops', 'Sprouts', 'plants', [{ obj: 'cross', layer: 'cutout', tex: { side: 'crops' } }], { collide: 0, replaceable: true, jitter: 0.1 }),
  B('crops_ripe', 'Ripe sprouts', 'plants', [{ obj: 'cross', layer: 'cutout', tex: { side: 'cropsRipe' } }], { collide: 0, replaceable: true, jitter: 0.1 }),
  B('flower_orange', 'Orange flower', 'plants', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerOrange' } }], { collide: 0, scatter: true, replaceable: true }),

  // --- house: walls, window, railing ---
  solid('plaster_teal', 'Teal plaster', 'house', 'plasterTeal'),
  solid('plaster_white', 'White plaster', 'house', 'plasterWhite'),
  solid('plaster_rust', 'Orange plaster', 'house', 'plasterRust'),
  solid('brick_brown', 'Brown brick', 'house', 'brickBrown'),
  solid('concrete', 'Concrete', 'house', 'concrete'),
  B('window', 'Window', 'house', [cube(same('window'), 'pane')], { rotatable: true, jitter: 0 }),
  B('rust_rail', 'Rusty railing', 'house', [cube(same('rustMetal'), 'fence_post'), { obj: 'fence_rail', tex: same('rustMetal'), connect: true }], { collide: 1.5, connects: true }),

  // --- furniture: faces +X, rotation turns it ---
  B('table', 'Table', 'furniture', [cube(same('planks'), 'table')], { collide: 13 / 16 }),
  B('chair', 'Chair', 'furniture', [cube(same('planksDark'), 'chair')], { collide: 9 / 16, rotatable: true }),
  B('sofa', 'Sofa', 'furniture', [cube({ top: 'fabricRed', side: 'fabricRed', bottom: 'ironDark' }, 'sofa')], { collide: 14 / 16, rotatable: true, connects: true }),
  B('bed', 'Bed: foot', 'furniture', [cube({ top: 'blanket', side: 'blanket', bottom: 'planksDark' }, 'bed')], { collide: 9 / 16, rotatable: true }),
  B('bed_head', 'Bed: head', 'furniture', [cube({ top: 'blanket', side: 'blanket', bottom: 'planksDark', pillow: 'pillow', wood: 'planksDark' }, 'bed_head')], { collide: 9 / 16, rotatable: true }),
  B('lamp', 'Floor lamp', 'furniture', [cube({ pole: 'ironDark', shade: 'lampShade' }, 'lamp')], { light: { color: '#ffd28a', intensity: 5, dist: 7 } }),
  B('counter', 'Kitchen counter', 'furniture', [cube({ top: 'counterTop', side: 'cabinet', bottom: 'planksDark' }, 'low')], { collide: 0.875, connects: true }),
  B('stove', 'Stove', 'furniture', [cube({ top: 'stoveTop', side: 'cabinet', bottom: 'planksDark' }, 'low')], { collide: 0.875, connects: true }),
  B('cabinet_low', 'Nightstand', 'furniture', [cube({ top: 'planksDark', side: 'cabinet', bottom: 'planksDark' }, 'low')], { collide: 0.875, connects: true }),
  solid('cabinet', 'Wardrobe', 'furniture', { top: 'planksDark', side: 'cabinet', bottom: 'planksDark' }, { jitter: 0.04 }),
  solid('bookshelf', 'Bookshelf', 'furniture', { top: 'planksDark', side: 'bookshelf', bottom: 'planksDark' }, { jitter: 0.04 }),
  solid('fridge', 'Fridge', 'furniture', { top: 'fridgeTop', side: 'fridge', bottom: 'fridgeTop' }, { jitter: 0 }),
  B('rug', 'Rug', 'furniture', [cube(same('rug'), 'carpet')], { collide: 0, jitter: 0 }),

  // --- world (Minecraft Dungeons screenshots 10–15, wiki/style-world.md): yard — fences and floor ---
  ...stoneSet('wall_stone', 'Yard wall stone', 'yard', 'wallStone'),
  ...stoneSet('yard_floor', 'Yard floor', 'yard', 'yardFloor', false),

  // cliffs and water (screenshots 11, 12): cliffs along the level edge, waterfall, river with flow, bridge
  ...stoneSet('cliff', 'Cliff', 'cliffs and water', 'cliff', false),
  solid('cliff_dark', 'Dark cliff', 'cliffs and water', 'cliffDark'),
  solid('cliff_grass', 'Grassy cliff', 'cliffs and water', { top: 'grassTop', side: 'cliffGrassSide', bottom: 'cliff' }, {
    jitter: 0.02, natural: true, fringe: 'grassFringe', tufts: ['grassTuft', 'grassTuft', 'grassTuft', 'flowerTuft'], bleed: ['grassEdge0', 'grassEdge1', 'grassEdge2', 'grassEdge3'],
  }),
  B('waterfall', 'Waterfall', 'cliffs and water', [{ obj: 'cube', layer: 'falls', tex: same('waterfall') }], { cullSame: true, jitter: 0 }),
  B('river', 'River', 'cliffs and water', [{ obj: 'water', layer: 'river', tex: same('river') }], { collide: 0.5, cullSame: true, jitter: 0, rotatable: true, flow: 1.2 }),
  B('bridge_deck', 'Bridge deck', 'cliffs and water', [cube(same('bridgePlank'))], { full: true, connects: true, rotatable: true, jitter: 0.04 }),
  B('bridge_beam', 'Bridge beam', 'cliffs and water', [cube({ top: 'bridgePost', side: 'bridgePost', bottom: 'bridgePost' }, 'cube_x')], { full: true, connects: true, rotatable: true, jitter: 0.04 }),
  // portal (screenshot 14): golden glow with animation and baked light, dark frame, lintel with inlay, light floor
  B('portal', 'Portal: glow', 'portal', [{ obj: 'pane', layer: 'portal', tex: same('portal') }], { collide: 0, rotatable: true, jitter: 0, bakedLight: { color: '#ffc248', intensity: 1.1, dist: 4.5 } }),
  solid('portal_frame', 'Portal: frame', 'portal', 'portalFrame', { jitter: 0.02 }),
  solid('portal_trim', 'Portal: lintel', 'portal', { top: 'portalFrame', side: 'portalTrim', bottom: 'portalFrame' }, { jitter: 0.02 }),
  solid('portal_floor', 'Portal: floor', 'portal', 'portalFloor', { jitter: 0.02, natural: true }),

  // hills (screenshots 13, 15): grass half-block for soft ledges, fluffy leaves, dry grass, daisies, path stairs
  B('grass_slab', 'Grass: half-block', 'hills', [cube({ top: 'grassTop', side: 'grassSide', bottom: 'dirt' }, 'slab')], {
    collide: 0.5, connects: true, jitter: 0.02, natural: true, fringe: 'grassFringe', tufts: ['grassTuft', 'grassTuft', 'flowerTuft'], bleed: ['grassEdge0', 'grassEdge1', 'grassEdge2', 'grassEdge3'],
  }),
  B('leaves_fluffy', 'Fluffy leaves', 'hills', [{ obj: 'leaves_fluffy', layer: 'cutout', tex: { side: 'leavesClump', puff: 'leavesPuff' } }], { jitter: 0.1 }),
  // golden autumn: yellow and orange tones picked by cell hash — the crown is dappled, like larches on references 2, 3, 8
  B('leaves_gold', 'Golden leaves', 'hills', [{ obj: 'leaves_fluffy', layer: 'cutout', tex: { side: ['leavesGold', 'leavesOrange'], puff: ['leavesGoldPuff', 'leavesOrangePuff'] } }], { jitter: 0.1 }),
  B('dry_grass', 'Dry grass', 'hills', [{ obj: 'cross', layer: 'cutout', tex: { side: 'dryGrass' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.1 }),
  B('daisies', 'Daisies', 'hills', [{ obj: 'cross', layer: 'cutout', tex: { side: 'daisies' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.05 }),
  B('path_stairs', 'Path: stairs', 'hills', [cube(same('path'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true, jitter: 0.02, natural: true }),
  B('path_slab', 'Path: half-block', 'hills', [cube(same('path'), 'slab')], { collide: 0.5, connects: true, jitter: 0.02, natural: true }),
  B('bridge_post', 'Bridge post', 'cliffs and water', [cube(same('bridgePost'), 'post')], { collide: 1.5, connects: true, jitter: 0.04 }),

  // --- playground service blocks: neutral grid and checkered walls, they set no game style ---
  solid('dev_light', 'Grid: light', 'service', 'devLight', { jitter: 0 }),
  solid('dev_dark', 'Grid: dark', 'service', 'devDark', { jitter: 0 }),
  solid('dev_light_line', 'Grid: light with line', 'service', 'devLightLine', { jitter: 0, rotatable: true }),
  solid('dev_dark_line', 'Grid: dark with line', 'service', 'devDarkLine', { jitter: 0, rotatable: true }),
  solid('dev_light_corner', 'Grid: light, corner', 'service', 'devLightCorner', { jitter: 0, rotatable: true }),
  solid('dev_dark_corner', 'Grid: dark, corner', 'service', 'devDarkCorner', { jitter: 0, rotatable: true }),
  solid('dev_wall', 'Playground wall', 'service', 'devWall', { jitter: 0 }),
  solid('dev_cover', 'Playground cover', 'service', 'devCover', { jitter: 0 }),
  B('dev_cover_low', 'Playground low cover', 'service', [cube(same('devCover'), 'low')], { collide: 0.875, connects: true, jitter: 0 }),

  // --- lava (wiki/design-tower-defence.md, section 7): ash ground, basalt, scorched cliff, wading lava (burns) ---
  solid('ash_ground', 'Ash ground', 'lava', { top: 'ashTop', side: 'ashSide', bottom: 'ashSide' }, { jitter: 0.03, natural: true }),
  solid('basalt', 'Basalt', 'lava', 'basalt', { jitter: 0.03 }),
  B('basalt_slab', 'Basalt: half-block', 'lava', [cube(same('basalt'), 'slab')], { collide: 0.5, connects: true, jitter: 0.03 }),
  B('basalt_stairs', 'Basalt: stairs', 'lava', [cube(same('basalt'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true, jitter: 0.03 }),
  solid('cliff_lava', 'Scorched cliff', 'lava', 'cliffLava', { jitter: 0.03 }),
  solid('cliff_lava_top', 'Scorched cliff with ash', 'lava', { top: 'ashTop', side: 'cliffLava', bottom: 'cliffLava' }, { jitter: 0.02, natural: true }),
  // lava: knee-deep liquid with warm baked light on the blocks around; the hero burns in it (src/dev/playground.ts)
  B('lava', 'Lava', 'lava', [{ obj: 'water', layer: 'lava', tex: same('lava') }], { collide: 0.5, cullSame: true, jitter: 0, bakedLight: { color: '#ff7a2a', intensity: 0.9, dist: 4 } }),

  // --- crystal glade (wiki/design-tower-defence.md, section 8): lamp mushrooms and a blue portal ---
  solid('shroom_stem', 'Mushroom: stem', 'glade', 'mushroomStem', { jitter: 0.02 }),
  B('shroom_cap_pink', 'Mushroom: pink cap', 'glade', [{ obj: 'cube', layer: 'glow', tex: same('mushroomPink') }], { collide: 1, jitter: 0, bakedLight: { color: '#ff7ad8', intensity: 0.8, dist: 4 } }),
  B('shroom_cap_blue', 'Mushroom: blue cap', 'glade', [{ obj: 'cube', layer: 'glow', tex: same('mushroomBlue') }], { collide: 1, jitter: 0, bakedLight: { color: '#5ad8ff', intensity: 0.8, dist: 4 } }),
  B('shroom_cap_pink_slab', 'Mushroom: pink cap, half-block', 'glade', [{ obj: 'slab', layer: 'glow', tex: same('mushroomPink') }], { collide: 0.5, connects: true, jitter: 0, bakedLight: { color: '#ff7ad8', intensity: 0.5, dist: 3 } }),
  B('shroom_cap_blue_slab', 'Mushroom: blue cap, half-block', 'glade', [{ obj: 'slab', layer: 'glow', tex: same('mushroomBlue') }], { collide: 0.5, connects: true, jitter: 0, bakedLight: { color: '#5ad8ff', intensity: 0.5, dist: 3 } }),
  B('portal_blue', 'Blue portal: glow', 'glade', [{ obj: 'pane', layer: 'portal', tex: same('portalBlue') }], { collide: 0, rotatable: true, jitter: 0, bakedLight: { color: '#5aa8ff', intensity: 1.1, dist: 4.5 } }),

  // --- fire and light ---
  B('torch', 'Torch', 'lighting', [cube({ side: 'logSide' }, 'torch'), { obj: 'torch_flame', layer: 'fire', tex: { side: 'fire' } }], { collide: 0, light: { color: '#ffa040', intensity: 6, dist: 7 } }),
  B('campfire', 'Campfire', 'lighting', [cube({ top: 'logTop', side: 'logSide', bottom: 'ash' }, 'campfire_logs'), { obj: 'campfire_fire', layer: 'fire', tex: { side: 'fire' } }], { collide: 1, light: { color: '#ff9a3a', intensity: 12, dist: 10 } }),
  B('fire', 'Fire', 'lighting', [{ obj: 'fire', layer: 'fire', tex: { side: 'fire' } }], { collide: 0, replaceable: true, light: { color: '#ff8a2a', intensity: 8, dist: 8 } }),
];

/** Categories of the "world" set — shown in the playground "world" zone, not in the showcase rows */
export const WORLD_CATEGORIES = ['yard', 'cliffs and water', 'hills', 'portal'];

export const BLOCK_BY_NAME: Record<string, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.name, b]));

export function blockDef(name: string): BlockDef {
  const b = BLOCK_BY_NAME[name];
  if (!b) throw new Error(`No block "${name}" in the palette`);
  return b;
}

/** All texture names the palette needs (for the atlas) */
export function paletteTextures(): string[] {
  const s = new Set<string>();
  for (const b of BLOCKS) {
    for (const p of b.parts) for (const t of Object.values(p.tex)) for (const n of Array.isArray(t) ? t : [t]) s.add(n);
    if (b.fringe) s.add(b.fringe);
    for (const t of b.tufts ?? []) s.add(t);
    for (const t of b.bleed ?? []) s.add(t);
  }
  return [...s];
}

export const CATEGORIES: string[] = [...new Set(BLOCKS.filter((b) => b.name !== 'air').map((b) => b.category))];

/** Human titles of block categories (the editor palette); category ids are the keys, the same as `t(category)` */
export const CATEGORY_TITLES: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c, t(c)]));
