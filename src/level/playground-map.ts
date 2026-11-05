import { Level } from './level.ts';
import { BLOCKS, WORLD_CATEGORIES } from './palette.ts';
import { DECOR, WORLD_DECOR_CATEGORIES } from './decor.ts';
import { buildWorldZone } from './world-zone.ts';

/**
 * Playground map: a 48 × 48 m arena of blocks (grass, walls, covers, column, diagonal, corner, corridor, pond, platform with stairs)
 * and a "showcase" beyond the south wall — all palette blocks, water, a tree, stairs, a fence, a campfire, all decor.
 * `npm run map:playground` writes assets/maps/playground.json; after that the map can be edited in the editor.
 */

export const PG_HALF = 24;
/** Floor labels of the showcase: [caption, x, z] */
export interface PgLabel { text: string; x: number; z: number; size?: number }

/** Smooth noise 0..1 with a 3 m step for road edges (deterministic) */
function wobble(x: number, z: number): number {
  const h = (i: number, j: number) => { let v = Math.imul(i, 374761393) + Math.imul(j, 668265263); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  const gx = Math.floor(x / 3), gz = Math.floor(z / 3), fx = x / 3 - gx, fz = z / 3 - gz;
  const sm = (t: number) => t * t * (3 - 2 * t), u = sm(fx), v = sm(fz);
  return (h(gx, gz) * (1 - u) + h(gx + 1, gz) * u) * (1 - v) + (h(gx, gz + 1) * (1 - u) + h(gx + 1, gz + 1) * u) * v;
}

export function buildPlaygroundLevel(): { level: Level; labels: PgLabel[] } {
  const L = new Level('Playground');
  const labels: PgLabel[] = [];
  /** Decor item: rot — yaw in degrees (as for blocks), on — the cell it is attached to */
  const dec = (name: string, x: number, y: number, z: number, rot = 0, on?: [number, number, number]) =>
    L.addDecor({ name, pos: [x, y, z], ...(rot ? { rot: [rot] } : {}), ...(on ? { on } : {}) });
  const H = PG_HALF;

  // ---------- arena ----------
  // floor — grass, a slab plaza at the origin; 10 m marks — roads (distances are visible, but it is a piece of the world, not a grey grid)
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    const plaza = Math.max(Math.abs(x), Math.abs(z)) <= 2;
    // 3 m roads at marks every 10 m (as in Minecraft Dungeons — wide, with a ragged grass edge)
    const on10 = (v: number) => [0, 1, 9].includes(((v % 10) + 10) % 10);
    const mark = (on10(x) && Math.abs(z) <= H - 1) || (on10(z) && Math.abs(x) <= H - 1);
    L.set(x, -1, z, plaza ? 'tiles' : mark ? 'path' : 'grass');
  }
  // the road edge is not ruler-straight: by smooth noise, cells at the road edge grow over with grass, and grass at the edge is trampled into road —
  // bays and capes of a metre or two; inside the cell the edge is torn further by the mesher mask (bleed)
  const isPath = (x: number, z: number) => L.nameAt(x, -1, z) === 'path';
  const flips: [number, number, string][] = [];
  for (let x = -H + 1; x <= H - 1; x++) for (let z = -H + 1; z <= H - 1; z++) {
    const me = L.nameAt(x, -1, z);
    if (me !== 'path' && me !== 'grass') continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => isPath(x + dx, z + dz) !== (me === 'path')).length;
    if (!near) continue;
    const n = wobble(x, z);
    if (me === 'path' && n < 0.3) flips.push([x, z, 'grass']);
    else if (me === 'grass' && n > 0.68) flips.push([x, z, 'path']);
  }
  for (const [x, z, name] of flips) L.set(x, -1, z, name);
  // perimeter walls: the far ones (−X, −Z) 3 blocks, on the camera side (+X, +Z) — 1 block; an opening to the showcase in the south, to the "world" zone in the east
  const W = H + 1;
  for (let i = -W; i <= W; i++) {
    for (let y = 0; y < 3; y++) { L.set(i, y, -W, y === 2 ? 'bricks' : 'bricks_old'); L.set(-W, y, i, y === 2 ? 'bricks' : 'bricks_old'); }
    if (Math.abs(i) > 1) L.set(W, 0, i, 'bricks_mossy'); // opening to the east — into the "world" zone
    if (Math.abs(i) > 1) L.set(i, 0, W, 'bricks_mossy');
  }
  for (let i = -W; i <= W; i++) { L.set(i, -1, -W, 'stone'); L.set(i, -1, W, 'stone'); L.set(-W, -1, i, 'stone'); L.set(W, -1, i, 'stone'); }
  // torches on the far walls — warm spots of light
  for (let i = -20; i <= 20; i += 8) { L.set(i, 0, -H, 'torch'); L.set(-H, 0, i, 'torch'); }

  // covers: low (14/16) and high 2 blocks
  for (let x = 5; x <= 7; x++) L.set(x, 0, -8, 'cobble_low');
  for (let z = -14; z <= -12; z++) L.set(10, 0, z, 'bricks_low');
  for (let x = 2; x <= 4; x++) L.fill(x, 0, -13, x, 1, -13, 'mossy');
  for (let x = 14; x <= 15; x++) L.fill(x, 0, -9, x, 1, -9, 'mossy');
  // column
  L.fill(9, 0, -3, 9, 2, -3, 'bricks');
  // diagonal: sliding along a wall
  for (let k = 0; k < 5; k++) L.fill(17 + k, 0, -1 - k, 17 + k, 2, -1 - k, 'bricks_old');
  // room corner
  for (let x = 16; x <= 21; x++) L.fill(x, 0, 5, x, 2, 5, 'bricks_old');
  for (let z = 5; z <= 10; z++) L.fill(16, 0, z, 16, 2, z, 'bricks_old');
  // 3 m corridor with a 1 m opening in the middle
  for (let x = 2; x <= 12; x++) { L.fill(x, 0, 13, x, 1, 13, 'bricks'); L.fill(x, 0, 17, x, 1, 17, 'bricks'); }
  L.fill(7, 0, 14, 7, 1, 14, 'bricks'); L.fill(7, 0, 16, 7, 1, 16, 'bricks');

  // a 2-block platform climbed by stairs: there is no jump, height differences are stairs and half-blocks
  L.fill(-20, 0, -21, -16, 1, -19, 'cobble');
  // ascent towards −X: stairs (0.5 → 1) → block with a half-block (1.5) → platform (2)
  for (let z = -21; z <= -19; z++) { L.set(-14, 0, z, 'cobble_stairs', 2); L.set(-15, 0, z, 'cobble'); L.set(-15, 1, z, 'cobble_slab'); }
  L.set(-18, 2, -21, 'torch');
  labels.push({ text: '2 m platform: stairs', x: -17, z: -17.6, size: 0.7 });

  // pond: live water with a sandy bottom, lily-flowers along the bank
  L.fill(-21, -1, 2, -15, -1, 6, 'water');
  L.fill(-21, -2, 2, -15, -2, 6, 'sand');
  L.set(-15, -1, 2, 'sand'); L.set(-21, -1, 6, 'sand'); L.set(-16, -1, 6, 'grass');
  for (const [fx, fz, f] of [[-22, 3, 'flower_blue'], [-22, 5, 'fern'], [-14, 4, 'flower_yellow'], [-18, 7, 'tall_grass'], [-17, 1, 'flower_white']] as [number, number, string][]) L.set(fx, 0, fz, f);
  labels.push({ text: 'pond', x: -18, z: 7.8, size: 0.7 });

  // a three-tier grass hill by the west wall: 1 m ledges with a ragged edge — the grass fringe shows on them
  const tier = (x0: number, x1: number, z0: number, z1: number, y: number) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      if (edge && ((x * 7 + z * 13 + y * 5) % 4 === 0)) continue; // ragged edge
      for (let k = 0; k < y; k++) L.set(x, k, z, 'dirt');
      L.set(x, y, z, 'grass');
    }
  };
  tier(-23, -16, 11, 22, 0);
  tier(-23, -19, 13, 21, 1);
  tier(-23, -21, 15, 19, 2);
  // ascent: stairs from the grass to tier 1 and from tier 1 to tier 2
  for (const z of [16, 17]) { L.set(-15, 0, z, 'cobble_stairs', 2); L.set(-18, 1, z, 'cobble_stairs', 2); }
  labels.push({ text: 'ledges: grass hangs from the edge', x: -19.5, z: 23.6, size: 0.7 });

  // grass and flowers scattered over free grass (deterministic)
  const FLORA = ['tall_grass', 'tall_grass', 'tall_grass', 'fern', 'flower_red', 'flower_yellow', 'flower_blue', 'flower_white'];
  for (let x = -H + 1; x <= H - 1; x++) for (let z = -H + 1; z <= H - 1; z++) {
    const h = ((x * 73856093) ^ (z * 19349663)) >>> 0;
    if (h % 100 >= 7 || L.nameAt(x, -1, z) !== 'grass' || L.nameAt(x, 0, z) !== 'air') continue;
    if (Math.abs(x) <= 4 && Math.abs(z) <= 6) continue; // clear at the start
    if (x >= -14 && x <= -1 && z >= 9 && z <= 21) continue; // storage yard
    if (z >= -18 && z <= -16) continue; // dummy rail
    L.set(x, 0, z, FLORA[(h >>> 8) % FLORA.length]);
  }

  // Sunny Glade (MOB_ROOMS, glade): a ring of yellow flowers around the Soller's post
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, x = Math.round(18.5 + Math.cos(a) * 2.8), z = Math.round(18.5 + Math.sin(a) * 2.8);
    if (L.nameAt(x, -1, z) === 'grass') L.set(x, 0, z, i % 3 ? 'flower_yellow' : 'flower_white');
  }
  for (let x = 17; x <= 20; x++) for (let z = 17; z <= 20; z++) if (L.nameAt(x, 0, z) !== 'air' && !String(L.nameAt(x, 0, z)).startsWith('flower')) L.set(x, 0, z, 'air');
  labels.push({ text: 'Sunny Glade', x: 18.5, z: 22.6, size: 0.7 });

  // ---------- showcase ----------
  const Z0 = W + 1, Z1 = W + 30;
  for (let x = -W; x <= W; x++) for (let z = Z0; z <= Z1; z++) L.set(x, -1, z, Math.abs(x) <= 1 && z <= Z0 + 3 ? 'gravel' : 'grass');
  // low fence of the showcase
  for (let x = -W; x <= W; x++) L.set(x, 0, Z1, 'fence');
  for (let z = Z0; z <= Z1; z++) { L.set(-W, 0, z, 'fence'); L.set(W, 0, z, 'fence'); }
  labels.push({ text: 'block showcase: all palette blocks', x: 0, z: Z0 + 1.2, size: 1.1 });

  // rows 1–3: all "solid" palette blocks one each, a caption under every one
  const solids = BLOCKS.filter((b) => b.category !== 'service' && !WORLD_CATEGORIES.includes(b.category) && !b.scatter && !b.name.endsWith('_stairs') && b.parts.length && b.collide > 0 && b.name !== 'water' && b.name !== 'acid');
  let i = 0;
  for (const b of solids) {
    const x = -22 + (i % 23) * 2, z = Z0 + 4 + Math.floor(i / 23) * 3;
    L.set(x, 0, z, b.name);
    labels.push({ text: b.title, x, z: z + 1, size: 0.5 });
    i++;
  }
  // row 3: stairs in four rotations and walkable blocks
  const stairs = BLOCKS.filter((b) => b.name.endsWith('_stairs') && !WORLD_CATEGORIES.includes(b.category));
  let x = -22;
  const zs = Z0 + 12;
  for (const b of stairs) {
    for (let r = 0; r < 4; r++) { L.set(x, 0, zs, b.name, r); x++; }
    labels.push({ text: `${b.title} ×4`, x: x - 2.5, z: zs + 1, size: 0.5 });
    x += 1;
  }
  for (const name of ['tall_grass', 'fern', 'flower_red', 'flower_blue', 'flower_white', 'flower_yellow', 'hole', 'fire']) { L.set(x, 0, zs, name); labels.push({ text: name, x, z: zs + 1, size: 0.4 }); x += 1; }

  // row 4: kits — water, acid, a tree, a fence with hay, a campfire, stairs to a platform, a cottage
  const zb = Z0 + 15;
  L.fill(-23, -1, zb, -19, -1, zb + 3, 'water');
  L.fill(-23, -2, zb, -19, -2, zb + 3, 'sand');
  labels.push({ text: 'water', x: -21, z: zb + 4.4, size: 0.6 });
  L.fill(-16, -1, zb, -14, -1, zb + 3, 'acid');
  L.fill(-16, -2, zb, -14, -2, zb + 3, 'stone');
  labels.push({ text: 'acid', x: -15, z: zb + 4.4, size: 0.6 });
  // tree
  const tx = -10, tz = zb + 2;
  L.fill(tx, 0, tz, tx, 3, tz, 'log');
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 3; dy <= 5; dy++) {
    const d2 = dx * dx + dz * dz + (dy - 4) * (dy - 4) * 1.5;
    if (d2 <= 4.6 && !(dx === 0 && dz === 0 && dy === 3)) L.set(tx + dx, dy, tz + dz, 'leaves');
  }
  L.set(tx + 2, 0, tz + 1, 'berry_bush'); L.set(tx - 2, 0, tz - 1, 'berry_bush');
  labels.push({ text: 'tree and bushes', x: tx, z: zb + 4.4, size: 0.6 });
  // pen with hay
  for (let fx = -5; fx <= -1; fx++) { L.set(fx, 0, zb, 'fence'); L.set(fx, 0, zb + 3, 'fence'); }
  for (let fz = zb; fz <= zb + 3; fz++) { L.set(-5, 0, fz, 'fence'); L.set(-1, 0, fz, 'fence'); }
  L.set(-3, 0, zb + 1, 'hay'); L.set(-4, 0, zb + 2, 'hay'); L.set(-3, 1, zb + 1, 'hay');
  labels.push({ text: 'fence, hay', x: -3, z: zb + 4.4, size: 0.6 });
  // campfire and torches
  L.set(2, 0, zb + 1, 'campfire'); L.set(0, 0, zb + 3, 'torch'); L.set(4, 0, zb + 3, 'torch');
  for (const [cx, cz] of [[1, zb + 3], [3, zb + 3]]) L.set(cx, 0, cz, 'crate');
  labels.push({ text: 'campfire, torches', x: 2, z: zb + 4.4, size: 0.6 });
  // stairs to a 2-block platform: stairs → half-block → stairs; a wall on top
  L.fill(8, 0, zb, 12, 1, zb + 3, 'stone');
  L.fill(8, 2, zb, 12, 2, zb + 3, 'cobble_wall'); L.fill(9, 2, zb + 1, 11, 2, zb + 2, 'air');
  L.fill(8, 2, zb + 1, 8, 2, zb + 2, 'air'); L.fill(12, 2, zb + 1, 12, 2, zb + 2, 'air'); // passages for ascent and descent
  // ascent: stairs (0.5 → 1) → block with a half-block (1.5) → platform (2); descent on the other side by stairs
  for (const dz of [1, 2]) {
    L.set(6, 0, zb + dz, 'stone_stairs', 0);
    L.set(7, 0, zb + dz, 'stone'); L.set(7, 1, zb + dz, 'stone_slab');
    L.set(13, 1, zb + dz, 'cobble_stairs', 2); L.set(13, 0, zb + dz, 'cobble');
    L.set(14, 0, zb + dz, 'cobble_stairs', 2);
  }
  labels.push({ text: 'stairs → 2 m platform → descent', x: 10, z: zb + 4.4, size: 0.6 });
  // cottage with a roof of stairs
  const hx = 19, hz = zb + 1;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -1; dz <= 2; dz++) {
    const edge = Math.abs(dx) === 2 || dz === -1 || dz === 2;
    if (!edge) continue;
    const corner = Math.abs(dx) === 2 && (dz === -1 || dz === 2);
    for (let y = 0; y < 2; y++) {
      if (dx === 0 && dz === -1) continue; // door to the north
      L.set(hx + dx, y, hz + dz, corner ? 'log' : 'planks');
    }
  }
  for (let dz = -2; dz <= 3; dz++) {
    L.set(hx - 3, 2, hz + dz, 'roof_stairs', 0); L.set(hx + 3, 2, hz + dz, 'roof_stairs', 2);
    L.set(hx - 2, 2, hz + dz, 'planks'); L.set(hx + 2, 2, hz + dz, 'planks');
    L.set(hx - 2, 3, hz + dz, 'roof_dark_stairs', 0); L.set(hx + 2, 3, hz + dz, 'roof_dark_stairs', 2);
    L.set(hx - 1, 3, hz + dz, 'planks'); L.set(hx + 1, 3, hz + dz, 'planks'); L.set(hx, 3, hz + dz, 'planks');
    L.set(hx - 1, 4, hz + dz, 'roof_slab'); L.set(hx, 4, hz + dz, 'roof_slab'); L.set(hx + 1, 4, hz + dz, 'roof_slab');
  }
  L.set(hx - 1, 0, hz - 2, 'torch'); L.set(hx + 1, 0, hz - 2, 'torch');
  labels.push({ text: 'cottage', x: hx, z: zb + 4.4, size: 0.6 });

  // row 5: decor — free items on top of blocks; by the wall — wall and ceiling ones, in front of it — floor ones
  const zw = Z0 + 22;
  for (let x = -22; x <= 22; x++) for (let y = 0; y < 3; y++) L.set(x, y, zw, y === 2 ? 'bricks' : 'bricks_old');
  for (let x = 6; x <= 12; x++) L.set(x, 2, zw + 1, 'bricks_slab');
  labels.push({ text: 'decor: stands anywhere, at any angle, made of 1/16 cubes', x: 0, z: zw - 1.3, size: 0.9 });
  const face = zw + 0.5;
  const onWall: [string, number, number][] = [['roots', -19, 2.3], ['cobweb', -15, 2.3], ['banner', -11, 2.6], ['torch_wall', -7, 1.4], ['banner', -3, 2.6], ['torch_wall', 1, 1.4]];
  for (const [name, x, y] of onWall) {
    dec(name, x, y, face, 0, [x, Math.floor(y), zw]);
    labels.push({ text: DECOR.find((d) => d.name === name)!.title, x, z: face + 1, size: 0.45 });
  }
  for (const x of [7, 9, 11]) dec('chain', x, 2, zw + 1, x * 30, [x, 2, zw + 1]);
  labels.push({ text: 'Chain', x: 9, z: face + 1.4, size: 0.45 });
  const floorItems = DECOR.filter((d) => d.anchor === 'floor' && !WORLD_DECOR_CATEGORIES.includes(d.category));
  floorItems.forEach((d, k) => {
    const x = -21 + k * 4, z = zw + 4;
    dec(d.name, x, 0, z, d.name === 'column_fallen' ? 0 : 20);
    labels.push({ text: d.title, x, z: z + 1.7, size: 0.45 });
  });

  // decor in the arena: banners between the torches, roots and cobwebs on the far walls, ruins, lanterns, flower boxes
  for (const x of [-16, -8, 8, 16]) dec('banner', x, 2.6, -H - 0.5, 0, [x, 2, -W]);
  dec('cobweb', -23.4, 2.4, -H - 0.5, 0, [-23, 2, -W]);
  for (const [z, name] of [[-14, 'roots'], [-6, 'torch_wall'], [14, 'roots']] as [number, string][]) dec(name, -H - 0.5, name === 'roots' ? 2.5 : 1.4, z, -90, [-W, 2, z]);
  dec('column_fallen', 13, 0, -20, 25);
  dec('column_stump', -2, 0, -21.5, 10);
  dec('rubble', 11, 0, -2);
  dec('bricks_loose', 8, 0, -1.5, 40);
  dec('bones', -0.5, 0, -19.6, 15);
  dec('lantern_post', -13.5, 0, 8.5, 90);
  dec('lantern_post', 22, 0, -22, 180);
  dec('mushrooms_glow', -22, 0, -10, 30);
  dec('mushrooms_glow', -21.4, 0, -11.2, 75);
  dec('mushrooms', -19.5, 0, 9.5, 10);
  dec('planter', 5, 0, 23.6);
  dec('planter', 8, 0, 23.6);
  dec('crates_tilted', 21, 0, 21, -30);
  dec('candles', -17.6, 2, -20.4);

  // ---------- "world" zone beyond the east wall: kits from Minecraft Dungeons screenshots ----------
  buildWorldZone(L, labels, (name, x, y, z, rot = 0, on) => { dec(name, x, y, z, rot, on); });

  buildBossArena(L, labels, W);
  buildBarracks(L, labels, W, dec);
  buildGarden(L, labels, dec);
  buildCrypt(L, labels, W, dec);
  buildLair(L, labels, dec);
  buildWorkshop(L, labels, dec);

  L.spawn = [0, 0, 0];
  L.meta = { labels };
  L.dirty.clear();
  return { level: L, labels };
}

/** Warden arena: floor, gate into the corridor, an invisible trigger square, return point */
export interface BossArenaSpec {
  id: string;
  title: string;
  x0: number; x1: number; z0: number; z1: number;
  /** Gate in the corridor wall: centre, rotation (90° — along Z) */
  gate: { x: number; z: number; rot: number };
  trigger: { x0: number; x1: number; z0: number; z1: number };
  exit: { x: number; z: number; yaw: number };
  /** Several gates (maps from meta.arenas); none — the single gate */
  gates?: { x: number; z: number; w: number; rot?: number }[];
  /** Where the warden stands (maps from meta.arenas); none — deep in the arena facing the gate */
  home?: { x: number; z: number; yaw: number };
}

/**
 * Hall of wardens beyond the north wall (wiki/design-bosses.md, section 1): a corridor x −1…1 to the north, on its sides — eight arenas
 * 21 × 20 m, four on each side; the gate is in the corridor wall, the trigger square is right behind the gate.
 */
const HALL = [
  ['cauldron', 'Order Cauldron'], ['boar', 'Frost Boar'], ['storm', 'Storm Golem'], ['golden', 'Golden Warden'],
  ['night', 'Night Rider'], ['druse', 'Druse Golem'], ['gatherer', 'Sorrowful Gatherer'], ['cat', 'Grave Cat'],
] as const;
/** Floor bosses — further down the corridor, roomier arenas (27 × 24 m) */
const HALL_BOSSES = [
  ['serpent', 'Crimson Serpent'], ['beast', 'Thunder Beast'], ['queen', 'Queen of the Star Garden'], ['judge', 'Judge of the Order'], ['general', 'General Rdyan'],
] as const;
/** Final wardens — at the very end of the corridor, 31 × 30 m arenas */
const HALL_FINALS = [['winter', 'Mistress of Eternal Winter'], ['star', 'Fallen Star'], ['gardener', 'First Gardener']] as const;
/** Floor accent per warden: blocks the floor is strewn with, and decor by the walls */
const THEME: Record<string, { floor: string[]; dots: string[] }> = {
  cauldron: { floor: ['cobble', 'stone', 'bricks_cracked'], dots: ['fire', 'campfire'] },
  boar: { floor: ['stone', 'gravel', 'tiles'], dots: ['dry_grass'] },
  storm: { floor: ['tiles', 'stone', 'bricks'], dots: ['torch'] },
  golden: { floor: ['tiles', 'path', 'grass'], dots: ['flower_yellow', 'tall_grass'] },
  night: { floor: ['cobble', 'mossy', 'gravel'], dots: ['fern', 'tall_grass'] },
  druse: { floor: ['stone', 'cobble', 'gravel'], dots: ['dry_grass'] },
  gatherer: { floor: ['dirt', 'mossy', 'grass'], dots: ['fern', 'flower_white'] },
  cat: { floor: ['bricks_old', 'cobble', 'mossy'], dots: ['torch', 'fern'] },
  serpent: { floor: ['cobble', 'gravel', 'bricks_cracked'], dots: ['fire', 'campfire', 'berry_bush'] },
  beast: { floor: ['stone', 'gravel', 'cobble'], dots: ['dry_grass', 'torch'] },
  queen: { floor: ['tiles', 'grass', 'path'], dots: ['flower_white', 'flower_blue', 'daisies'] },
  judge: { floor: ['tiles', 'bricks', 'stone'], dots: ['torch', 'flower_white'] },
  general: { floor: ['path', 'grass', 'cobble'], dots: ['berry_bush', 'tall_grass', 'flower_red'] },
  // dark floor: the white icy Mistress reads on it
  winter: { floor: ['cobble', 'bricks_old', 'mossy'], dots: ['dry_grass', 'torch'] },
  star: { floor: ['bricks_cracked', 'stone', 'gravel'], dots: ['torch', 'dry_grass'] },
  gardener: { floor: ['grass', 'dirt', 'path'], dots: ['berry_bush', 'flower_red', 'tall_grass', 'daisies'] },
};

/** Arena: side, top edge by z, width, depth */
function arenaSpec(id: string, title: string, left: boolean, z1: number, w: number, d: number): BossArenaSpec {
  const z0 = z1 - d + 1, zc = (z0 + z1) / 2;
  const x0 = left ? -3 - w + 1 : 3, x1 = left ? -3 : 3 + w - 1;
  return {
    id, title, x0, x1, z0, z1,
    gate: { x: left ? -2 : 2, z: zc, rot: Math.PI / 2 },
    trigger: left ? { x0: -6.5, x1: -3, z0: zc - 2, z1: zc + 2 } : { x0: 3, x1: 6.5, z0: zc - 2, z1: zc + 2 },
    exit: { x: 0, z: zc, yaw: left ? Math.PI / 2 : -Math.PI / 2 },
  };
}

const MINI_END = -28 - 23 * 3 - 19;
export const BOSS_ARENAS: BossArenaSpec[] = [
  ...HALL.map(([id, title], i) => arenaSpec(id, title, i % 2 === 0, -28 - 23 * Math.floor(i / 2), 21, 20)),
  ...HALL_BOSSES.map(([id, title], i) => arenaSpec(id, title, i % 2 === 0, MINI_END - 4 - 28 * Math.floor(i / 2), 27, 24)),
  ...HALL_FINALS.map(([id, title], i) => arenaSpec(id, title, i % 2 === 0, MINI_END - 4 - 28 * 3 - 4 - 34 * Math.floor(i / 2), 31, 30)),
];
export const BOSS_HALL_END = Math.min(...BOSS_ARENAS.map((a) => a.z0)) - 1;

function buildBossArena(L: Level, labels: PgLabel[], W: number): void {
  const hash = (x: number, z: number, s = 0) => (((x * 73856093) ^ (z * 19349663) ^ (s * 83492791)) >>> 0) % 1000 / 1000;
  const END = BOSS_HALL_END;
  // opening in the north wall of the playground and a corridor to the north
  for (let x = -1; x <= 1; x++) for (let y = 0; y < 3; y++) L.set(x, y, -W, 'air');
  for (let z = END; z <= -W; z++) {
    for (let x = -1; x <= 1; x++) { L.set(x, -1, z, 'tiles'); L.set(x, -2, z, 'stone'); }
    L.set(-2, -1, z, 'stone'); L.set(2, -1, z, 'stone');
    L.set(-2, 0, z, 'bricks_old'); L.set(2, 0, z, 'bricks_mossy');
  }
  for (let x = -35; x <= 35; x++) for (let y = 0; y < 3; y++) L.set(x, y, END - 1, 'cliff_dark');
  for (const A of BOSS_ARENAS) {
    const T = THEME[A.id];
    const left = A.x0 < 0;
    for (let x = A.x0; x <= A.x1; x++) for (let z = A.z0; z <= A.z1; z++) {
      const n = hash(x, z, 1);
      L.set(x, -1, z, n < 0.5 ? T.floor[0] : n < 0.82 ? T.floor[1] : T.floor[2]);
      L.set(x, -2, z, 'stone');
    }
    // walls: the far one (west for the left ones, north) — cliff 3 blocks, the rest 1 block; between arenas — a single wall
    const ox = left ? A.x0 - 1 : A.x1 + 1;
    for (let z = A.z0 - 1; z <= A.z1 + 1; z++) {
      L.set(ox, -1, z, 'stone');
      for (let y = 0; y < (left ? 3 : 1); y++) L.set(ox, y, z, left ? 'cliff_dark' : 'cliff');
    }
    for (let x = Math.min(A.x0, ox); x <= Math.max(A.x1, ox); x++) for (const z of [A.z0 - 1, A.z1 + 1]) {
      L.set(x, -1, z, 'stone');
      for (let y = 0; y < (z === A.z0 - 1 ? 2 : 1); y++) L.set(x, y, z, z === A.z0 - 1 ? 'cliff_dark' : 'cliff');
    }
    // gate: a 3 m opening in the corridor wall
    for (let dz = -1; dz <= 1; dz++) { L.set(A.gate.x, 0, Math.round(A.gate.z) + dz, 'air'); L.set(A.gate.x, -1, Math.round(A.gate.z) + dz, 'tiles'); }
    // scattered decor by the walls — by the warden's theme
    for (let j = 0; j < 9; j++) {
      const x = Math.round(A.x0 + 1 + hash(j, A.z0, 3) * (A.x1 - A.x0 - 2)), z = Math.round(A.z0 + 1 + hash(j, A.z1, 5) * (A.z1 - A.z0 - 2));
      const nearWall = x <= A.x0 + 2 || x >= A.x1 - 2 || z <= A.z0 + 2 || z >= A.z1 - 2;
      if (nearWall && L.nameAt(x, 0, z) === 'air') L.set(x, 0, z, T.dots[j % T.dots.length]);
    }
    labels.push({ text: A.title, x: left ? -1.6 : 1.6, z: Math.round(A.gate.z) + (left ? 2.4 : -2.4), size: 0.55 });
  }
  labels.push({ text: 'hall of wardens ↑', x: 0, z: -22.6, size: 0.8 });
}

/**
 * Mob rooms beyond the west wall (wiki/design-mobs.md): the Order barracks (opening in the west wall of the playground, z −1…1)
 * and the Thorn Garden to the south (passage from the barracks). The garrison stands in groups at posts and wakes up when the hero
 * comes close (src/mobs/, playground.ts). Groups are more than 8 m apart: neighbours within 8 m wake up together.
 */
export interface MobRoomSpec {
  id: string;
  title: string;
  x0: number; x1: number; z0: number; z1: number;
  posts: MobPost[];
  /** Where to stand at the entrance (button in F1) */
  enter: { x: number; z: number; yaw: number };
  /** The whole garrison fell, the hero left — the room is full again (playground); false — the fallen do not return (maps) */
  respawn?: boolean;
}

/** A mob at a post: aggro — from what distance it sees the hero (ambush — less), route — patrols the points until it notices */
export interface MobPost { kind: string; x: number; z: number; aggro?: number; route?: [number, number][] }

const at = (kind: string, pts: number[][]) => pts.map(([x, z]) => ({ kind, x, z }));

export const MOB_ROOMS: MobRoomSpec[] = [
  {
    id: 'barracks', title: 'Order Barracks', x0: -58, x1: -26, z0: -10, z1: 10,
    enter: { x: -22, z: 0, yaw: -Math.PI / 2 },
    posts: [
      // at the entrance — small fry: berrylings and gardeners
      ...at('berryling', [[-30, -7], [-31, -5.6], [-29.6, -5], [-31.2, -7.6]]),
      ...at('gardener', [[-30, 5], [-31.5, 6.8], [-29.5, 7.4]]),
      // further — wolves and knights; behind the knights — the healer, behind the wolves — mages
      ...at('wolf', [[-40, -6], [-41.5, -7.5], [-41.5, -4.5]]),
      ...at('shield', [[-40.5, 6]]), ...at('squire', [[-41.5, 4.2], [-41.5, 7.8]]),
      ...at('healer', [[-45, 6]]),
      ...at('pyro', [[-44, -3.5]]), ...at('summoner', [[-44, -8]]),
      // deep inside — the guard with the banner: the hammerer in front, spearmen, crossbowmen by the wall
      ...at('hammer', [[-52.5, 0]]), ...at('spear', [[-53.5, -2.5], [-53.5, 2.5]]),
      ...at('banner', [[-56, 0]]), ...at('crossbow', [[-57, -4], [-57, 4]]),
    ],
  },
  {
    id: 'garden', title: 'Thorn Garden', x0: -50, x1: -27, z0: 12, z1: 35,
    enter: { x: -35, z: 9, yaw: 0 },
    posts: [
      // at the entrance — vines guard the path; slimes on the right, prickle balls on the left, deep inside — the horror and buds
      ...at('vine', [[-37, 15], [-33, 15], [-35, 17]]),
      ...at('slime', [[-28.5, 24], [-29, 27.5]]),
      ...at('hedgehog', [[-46, 22], [-47, 25.5]]),
      ...at('horror', [[-39, 32]]), ...at('bud', [[-42, 34], [-36, 34]]),
    ],
  },
  {
    id: 'crypt', title: 'Old Graveyard', x0: -50, x1: -27, z0: -36, z1: -13,
    enter: { x: -22, z: -16, yaw: -Math.PI / 2 },
    posts: [
      // at the entrance — reapers; in the middle — wisps; deep inside — the scarecrow, by the far wall — archers
      ...at('reaper', [[-31, -20], [-32.5, -22], [-30, -23]]),
      ...at('wisp', [[-41, -15], [-43, -17], [-40, -18]]),
      ...at('scarecrow', [[-35, -30.5]]),
      ...at('archer', [[-46, -28], [-44, -31.5]]),
    ],
  },
  {
    id: 'lair', title: 'Beast Lair', x0: -50, x1: -27, z0: -62, z1: -39,
    enter: { x: -35, z: -34, yaw: Math.PI },
    posts: [
      // at the entrance on the right — boarlets, on the left — vine weavers, deep inside — beetles and the hive
      ...at('boarlet', [[-30, -44], [-29, -47]]),
      ...at('spider', [[-44, -45], [-46, -48]]),
      ...at('beetle', [[-36, -55], [-34, -57]]),
      ...at('hive', [[-44, -59]]),
    ],
  },
  {
    id: 'workshop', title: 'Order Workshop', x0: -50, x1: -27, z0: 38, z1: 61,
    enter: { x: -35, z: 34, yaw: 0 },
    posts: [
      // at the entrance on the right — kegs; in the middle — pots; deep inside — the obelisk with golemlings; in the corners — "raspberry baskets"
      ...at('keg', [[-29, 41], [-30, 43], [-28, 44.5]]),
      ...at('pot', [[-36, 50], [-33, 52]]),
      ...at('obelisk', [[-41, 57]]), ...at('druseling', [[-38, 58.5], [-44, 58.5]]),
      ...at('mimic', [[-44, 43], [-28, 59.5]]),
    ],
  },
  {
    // not a room but a glade in the south-east corner of the arena: a single Soller under a sunbeam, yellow flowers around
    id: 'glade', title: 'Sunny Glade', x0: 14, x1: 23, z0: 12, z1: 23,
    enter: { x: 13, z: 11, yaw: Math.PI / 4 },
    posts: at('soller', [[18.5, 18.5]]),
  },
];

type Dec = (name: string, x: number, y: number, z: number, rot?: number, on?: [number, number, number]) => void;

/** Room box: floor by floor(x, z), walls — north and west 3 blocks (wall), south and east 1 block (low) */
function roomShell(L: Level, R: MobRoomSpec, floor: (x: number, z: number) => string, wall: string, low: string): void {
  for (let x = R.x0; x <= R.x1; x++) for (let z = R.z0; z <= R.z1; z++) { L.set(x, -1, z, floor(x, z)); L.set(x, -2, z, 'stone'); }
  for (let x = R.x0 - 1; x <= R.x1 + 1; x++) {
    L.set(x, -1, R.z0 - 1, 'stone'); L.set(x, -1, R.z1 + 1, 'stone');
    for (let y = 0; y < 3; y++) L.set(x, y, R.z0 - 1, wall);
    L.set(x, 0, R.z1 + 1, low);
  }
  for (let z = R.z0; z <= R.z1; z++) {
    L.set(R.x0 - 1, -1, z, 'stone'); L.set(R.x1 + 1, -1, z, 'stone');
    for (let y = 0; y < 3; y++) L.set(R.x0 - 1, y, z, wall);
    L.set(R.x1 + 1, 0, z, low);
  }
}

function buildBarracks(L: Level, labels: PgLabel[], W: number, dec: Dec): void {
  const B = MOB_ROOMS[0];
  const hash = (x: number, z: number) => (((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000 / 1000;
  // floor: slabs with cobblestone, a path from the entrance
  for (let x = B.x0; x <= B.x1; x++) for (let z = B.z0; z <= B.z1; z++) {
    const n = hash(x, z);
    L.set(x, -1, z, Math.abs(z) <= 1 ? 'path' : n < 0.55 ? 'tiles' : n < 0.85 ? 'cobble' : 'stone');
    L.set(x, -2, z, 'stone');
  }
  // opening in the west wall of the playground
  for (let z = -1; z <= 1; z++) { for (let y = 0; y < 3; y++) L.set(-W, y, z, 'air'); L.set(-W, -1, z, 'path'); }
  // walls: the far (west) and north ones — 3 blocks, the south one (towards the camera) — 1 block
  for (let z = B.z0 - 1; z <= B.z1 + 1; z++) { L.set(B.x0 - 1, -1, z, 'stone'); for (let y = 0; y < 3; y++) L.set(B.x0 - 1, y, z, y === 2 ? 'bricks' : 'bricks_old'); }
  for (let x = B.x0 - 1; x <= B.x1; x++) {
    L.set(x, -1, B.z0 - 1, 'stone'); L.set(x, -1, B.z1 + 1, 'stone');
    for (let y = 0; y < 3; y++) L.set(x, y, B.z0 - 1, y === 2 ? 'bricks' : 'bricks_old');
    L.set(x, 0, B.z1 + 1, 'bricks_mossy');
  }
  // Order banners and torches on the far walls, racks and crates in the corners
  for (const x of [-54, -42, -34]) dec('banner', x, 2.6, B.z0 - 0.5, 0, [x, 2, B.z0 - 1]);
  for (const z of [-5, 5]) dec('banner', B.x0 - 0.5, 2.6, z, -90, [B.x0 - 1, 2, z]);
  for (const x of [-58, -50, -46, -38, -30]) L.set(x, 0, B.z0, 'torch');
  L.set(B.x0, 0, 0, 'torch');
  dec('crates_tilted', -57, 0, 9, 20);
  dec('bones', -27.5, 0, -9, 40);
  dec('lantern_post', -27, 0, 2.6, 90);
  dec('lantern_post', -27, 0, -2.6, 90);
  labels.push({ text: 'Order barracks ←', x: -21.6, z: 0, size: 0.8 });
  labels.push({ text: 'berrylings', x: -30.5, z: -9, size: 0.55 });
  labels.push({ text: 'gardeners', x: -30.5, z: 9.2, size: 0.55 });
  labels.push({ text: 'wolves', x: -40, z: -9.2, size: 0.55 });
  labels.push({ text: 'knights and the healer', x: -41, z: 9.2, size: 0.55 });
  labels.push({ text: 'mages', x: -44, z: -1.6, size: 0.55 });
  labels.push({ text: 'guard with the banner', x: -54, z: 8.6, size: 0.55 });
  labels.push({ text: 'Thorn Garden ↓', x: -35, z: 8.4, size: 0.6 });
}

/** Thorn Garden: grass and moss, raspberry bushes along the edge, a hedge instead of walls; the passage is from the barracks */
function buildGarden(L: Level, labels: PgLabel[], dec: Dec): void {
  const G = MOB_ROOMS[1];
  const hash = (x: number, z: number) => (((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000 / 1000;
  for (let x = G.x0; x <= G.x1; x++) for (let z = G.z0 - 1; z <= G.z1; z++) {
    const n = hash(x, z);
    L.set(x, -1, z, Math.abs(x + 35) <= 1 && z <= 20 ? 'path' : n < 0.78 ? 'grass' : 'dirt');
    L.set(x, -2, z, 'stone');
  }
  // passage in the south wall of the barracks
  for (let x = -36; x <= -34; x++) { L.set(x, 0, G.z0 - 1, 'air'); L.set(x, -1, G.z0 - 1, 'path'); }
  // walls: west — 3 blocks of cliff, south and east (towards the camera) — 1 block
  for (let z = G.z0 - 1; z <= G.z1 + 1; z++) {
    L.set(G.x0 - 1, -1, z, 'stone'); for (let y = 0; y < 3; y++) L.set(G.x0 - 1, y, z, 'cliff_dark');
    L.set(G.x1 + 1, -1, z, 'stone'); L.set(G.x1 + 1, 0, z, 'bricks_mossy');
  }
  for (let x = G.x0 - 1; x <= G.x1 + 1; x++) { L.set(x, -1, G.z1 + 1, 'stone'); L.set(x, 0, G.z1 + 1, 'bricks_mossy'); }
  // raspberry bushes and flowers along the walls
  for (let j = 0; j < 26; j++) {
    const side = j % 3, t = hash(j, 7);
    const x = side === 0 ? G.x0 : Math.round(G.x0 + 1 + t * (G.x1 - G.x0 - 2)), z = side === 0 ? Math.round(G.z0 + 1 + t * (G.z1 - G.z0 - 2)) : side === 1 ? G.z1 : G.z0;
    if (L.nameAt(x, 0, z) === 'air' && L.nameAt(x, -1, z) !== 'path') L.set(x, 0, z, ['berry_bush', 'berry_bush', 'flower_red', 'tall_grass'][j % 4]);
  }
  dec('mushrooms_glow', -48.5, 0, 30, 30);
  dec('roots', G.x0 - 0.5, 2.5, 20, -90, [G.x0 - 1, 2, 20]);
  dec('roots', G.x0 - 0.5, 2.5, 30, -90, [G.x0 - 1, 2, 30]);
  labels.push({ text: 'vines', x: -35, z: 13.2, size: 0.5 });
  labels.push({ text: 'slimes', x: -29, z: 21.6, size: 0.5 });
  labels.push({ text: 'prickle balls', x: -46.5, z: 19.6, size: 0.5 });
  labels.push({ text: 'horror and buds', x: -39, z: 29.4, size: 0.5 });
}

/** Old Graveyard: mossy slabs and dirt, gravestones, candles; the passage is in the west wall of the playground (z −17…−15) */
function buildCrypt(L: Level, labels: PgLabel[], W: number, dec: Dec): void {
  const R = MOB_ROOMS[2];
  const hash = (x: number, z: number) => (((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000 / 1000;
  roomShell(L, R, (x, z) => { const n = hash(x, z); return Math.abs(z + 16) <= 1 && x > -34 ? 'path' : n < 0.55 ? 'bricks_old' : n < 0.8 ? 'dirt' : 'grass'; }, 'cliff_dark', 'bricks_mossy');
  // passage: the west wall of the playground and the east wall of the graveyard
  for (let z = -17; z <= -15; z++) for (const x of [-W, R.x1 + 1]) { for (let y = 0; y < 3; y++) L.set(x, y, z, 'air'); L.set(x, -1, z, 'path'); }
  // gravestones in rows: low stones, a candle or flower by each
  for (const [x, z] of [[-30, -32], [-33, -34], [-38, -34], [-41, -24], [-47, -21], [-48, -34], [-29, -28], [-37, -25]] as const) {
    L.set(x, 0, z, 'cobble_low');
    if (L.nameAt(x, 0, z + 1) === 'air') L.set(x, 0, z + 1, hash(x, z) < 0.5 ? 'flower_white' : 'fern');
  }
  dec('candles_group', -46.5, 0, -35, 20);
  dec('candles', -31, 0, -33.5, 0);
  dec('bones', -42, 0, -27, 70);
  dec('cobweb', -49.4, 2.4, R.z0 - 0.5, 0, [-49, 2, R.z0 - 1]);
  dec('roots', R.x0 - 0.5, 2.5, -26, -90, [R.x0 - 1, 2, -26]);
  dec('lantern_post', -28, 0, -18.6, 90);
  dec('lantern_post', -28, 0, -13.4, 90);
  labels.push({ text: 'Old Graveyard ←', x: -21.6, z: -16, size: 0.7 });
  labels.push({ text: 'reapers', x: -31, z: -17.6, size: 0.5 });
  labels.push({ text: 'wisps', x: -41.5, z: -20.4, size: 0.5 });
  labels.push({ text: 'scarecrow', x: -35, z: -28, size: 0.5 });
  labels.push({ text: 'archers', x: -45, z: -34.4, size: 0.5 });
  labels.push({ text: 'Beast Lair ↑', x: -35, z: -34.6, size: 0.55 });
}

/** Beast Lair: dirt, moss and hay, roots and bones; the passage is from the north wall of the graveyard */
function buildLair(L: Level, labels: PgLabel[], dec: Dec): void {
  const R = MOB_ROOMS[3];
  const hash = (x: number, z: number) => (((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000 / 1000;
  roomShell(L, R, (x, z) => (hash(x, z) < 0.5 ? 'dirt' : 'grass'), 'cliff', 'bricks_old');
  // passage between the graveyard and the lair: they share walls at z −38…−37
  for (let x = -36; x <= -34; x++) for (const z of [R.z1 + 1, MOB_ROOMS[2].z0 - 1]) { for (let y = 0; y < 3; y++) L.set(x, y, z, 'air'); L.set(x, -1, z, 'dirt'); }
  for (const [x, z, b] of [[-49, -61, 'dry_grass'], [-48, -40, 'berry_bush'], [-28, -61, 'berry_bush'], [-28, -55, 'tall_grass'], [-49, -52, 'dry_grass'], [-40, -40, 'fern']] as [number, number, string][]) L.set(x, 0, z, b);
  dec('bones', -32, 0, -51, 30);
  dec('bones', -47, 0, -55, 110);
  dec('roots', R.x0 - 0.5, 2.5, -44, -90, [R.x0 - 1, 2, -44]);
  dec('roots', -40, 2.5, R.z0 - 0.5, 0, [-40, 2, R.z0 - 1]);
  dec('mushrooms', -29, 0, -58, 40);
  labels.push({ text: 'boarlets', x: -29.5, z: -41.6, size: 0.5 });
  labels.push({ text: 'vine weavers', x: -45, z: -42.4, size: 0.5 });
  labels.push({ text: 'beetles', x: -35, z: -52.4, size: 0.5 });
  labels.push({ text: 'hive', x: -44, z: -56.6, size: 0.5 });
}

/** Order Workshop: slabs and cobblestone, crates and carts, candles; the passage is from the south wall of the Thorn Garden */
function buildWorkshop(L: Level, labels: PgLabel[], dec: Dec): void {
  const R = MOB_ROOMS[4];
  const hash = (x: number, z: number) => (((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000 / 1000;
  roomShell(L, R, (x, z) => (Math.abs(x + 35) <= 1 && z <= 46 ? 'path' : hash(x, z) < 0.6 ? 'tiles' : 'cobble'), 'bricks_old', 'bricks_mossy');
  // passage between the garden and the workshop: walls at z 36…37
  for (let x = -36; x <= -34; x++) {
    for (const z of [R.z0 - 1, MOB_ROOMS[1].z1 + 1]) { for (let y = 0; y < 3; y++) L.set(x, y, z, 'air'); L.set(x, -1, z, 'path'); }
    // bushes by the south wall of the garden do not block the passage
    L.set(x, 0, MOB_ROOMS[1].z1, 'air');
  }
  for (const x of [-48, -40, -30]) L.set(x, 0, R.z1, 'torch');
  dec('crates_banded_stack', -48.5, 0, 40, 10);
  dec('crate_banded', -47, 0, 42.5, 30);
  dec('cart_loaded', -31, 0, 55, 70);
  dec('crate_small', -29, 0, 57.5, 15);
  dec('chest', -46, 0, 60, 180);
  dec('candles_row', -40, 0, 60.4, 0);
  labels.push({ text: 'Order Workshop ↓', x: -35, z: 33.4, size: 0.55 });
  labels.push({ text: 'kegs', x: -29, z: 39.4, size: 0.5 });
  labels.push({ text: 'pots', x: -34.5, z: 47.6, size: 0.5 });
  labels.push({ text: 'obelisk and golemlings', x: -41, z: 54.4, size: 0.5 });
}
