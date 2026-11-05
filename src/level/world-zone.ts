import type { Level } from './level.ts';
import type { PgLabel } from './playground-map.ts';
import { bridgeX, cliffMass, floorRect, hash2, hayStack, landscape, noise2, portal, rampart, riverBed, rockOutcrop, stairway, steppedWall, surfaceAt, tree, waterfall } from './kit.ts';

/**
 * The playground's "world" zone beyond the east wall: sets after Minecraft Dungeons screenshots (wiki/style-world.md),
 * each 3–4 elements that go together: a yard with a storage area, a river with a waterfall and a bridge, rocks along the level edge,
 * hills with candles, a portal in a hill, assorted hills. Assembled from the kits in kit.ts.
 */

export type Dec = (name: string, x: number, y: number, z: number, rot?: number, on?: [number, number, number]) => void;

/** Zone bounds: x from X0 to X1, z from −Z to Z (inclusive); the entrance is the opening in the arena's east wall at z −1…1 */
export const WORLD = { X0: 26, X1: 76, Z: 24 };

export function buildWorldZone(L: Level, labels: PgLabel[], dec: Dec): void {
  const { X0, X1, Z } = WORLD;
  // ground: grass at y = −1, dirt beneath (so the river bed and ledges do not hang in the void)
  for (let x = X0; x <= X1; x++) for (let z = -Z; z <= Z; z++) { L.set(x, -1, z, 'grass'); L.set(x, -2, z, 'dirt'); L.set(x, -3, z, 'dirt'); }
  // a 3 m road from the opening across the whole zone, edge by noise
  for (let x = X0; x <= X1; x++) for (let z = -3; z <= 3; z++) {
    const n = noise2(x, z, 3, 21);
    if (Math.abs(z) <= 1 || (Math.abs(z) === 2 && n > 0.62)) L.set(x, -1, z, 'path');
  }
  labels.push({ text: 'world: sets after Minecraft Dungeons screenshots', x: X0 + 8, z: 4.4, size: 1 });
  buildTerrain(L, labels);
  buildBounds(L, labels);
  buildYard(L, labels, dec);
  buildRiver(L, labels, dec);
  buildHills(L, labels, dec);
  buildPortal(L, labels, dec);
}

/**
 * The zone's relief (screenshots 13–17) is two things. Landscape: slabs in 4 layers of 0.5 m, walkable everywhere, sloping gently
 * down to the road, the yard, the river and the candle wall. Rocks: impassable stone masses on top of the landscape — along the edges, by the road;
 * one has the portal built in, dirt steps lead up another.
 */
function buildTerrain(L: Level, labels: PgLabel[]): void {
  const { X0, X1, Z } = WORLD;
  const flat = (x: number, z: number) =>
    Math.abs(z) <= 3 // road
    || (x <= 46 && z <= -8) // yard
    || (x >= 49 && x <= 56) // river bed, pond, waterfall
    || (x >= 37 && x <= 48 && z >= 4 && z <= 9) // candle wall
    || x <= X0 + 1; // by the opening in the arena wall
  landscape(L, X0, -Z + 2, X1 - 1, Z - 1, 0, { layers: 4, scale: 28, fade: 6, stone: 0.3, dry: 0.12, daisies: 0.05, seed: 71, flat });
  labels.push({ text: 'landscape: 0.5 m slabs — walkable from anywhere', x: 38, z: 23.6, size: 0.7 });
  // rocks along the landscape edges — impassable, grass on top
  rockOutcrop(L, 30, 20, 3, 2.5, 4, 0, 81);
  rockOutcrop(L, 73, 17, 3, 4, 5, 0, 82);
  // low rock by the road and dirt steps up it (screenshot 15): the ground is flat here, so the step heights are exact
  rockOutcrop(L, 35, -6, 3, 1.4, 3, 0, 83);
  for (const sx of [35, 36]) {
    let zf = -3;
    while (zf > -8 && L.nameAt(sx, surfaceAt(L, sx, zf) - 1, zf) !== 'cliff_grass') zf--;
    const hs = surfaceAt(L, sx, zf);
    if (hs > 0 && hs < 6) stairway(L, sx, 0, zf + hs, 0, -1, hs, 1, 'path');
  }
  labels.push({ text: 'rocks are impassable; dirt steps lead up the low one', x: 37, z: 22.4, size: 0.6 });
}

/** 5. Portal (screenshot 14): in the rock north of the road, facing the road — an opening with a frame and golden glow, the exit cut down to the ground */
function buildPortal(L: Level, labels: PgLabel[], dec: Dec): void {
  rockOutcrop(L, 66, -12, 7, 5, 5, 0, 84);
  portal(L, 66, 0, -6, 2, 3);
  dec('candles_group', 64.4, 0, -3.8);
  dec('candles_group', 69.6, 0, -3.6, 60);
  labels.push({ text: 'portal in the rock: frame, glow, exit to the road', x: 67, z: 5.4, size: 0.6 });
}

/** 4 and 6. Trees and flora on the terraces; a rampart with candles — the light is baked into the stone */
function buildHills(L: Level, labels: PgLabel[], dec: Dec): void {
  const { X0, X1, Z } = WORLD;
  // trees: on a 7-cell grid with an offset, only on terrace grass
  for (let x = X0 + 4; x <= X1 - 4; x += 7) for (let z = -Z + 5; z <= Z - 3; z += 7) {
    const tx = x + Math.floor(hash2(x, z, 81) * 4) - 2, tz = z + Math.floor(hash2(x, z, 82) * 4) - 2;
    const y = surfaceAt(L, tx, tz);
    if (y < 1 || hash2(tx, tz, 83) > 0.33 || L.nameAt(tx, y - 1, tz) !== 'grass' || Math.hypot(tx - 67, tz + 6) < 6) continue;
    tree(L, tx, y, tz, 2, 2);
  }
  // rampart with candles: baked light only
  rampart(L, 39, 6, 46, 6, 0, 3);
  // merlons at x = 39, 42, 45; candles between them
  dec('candles_group', 40, 3, 6);
  dec('candle_tall', 41, 3, 6);
  dec('candles_row', 43.5, 3, 6);
  dec('candles_group', 46, 3, 6, 40);
  dec('candles_group', 38.2, 0, 7.4);
  labels.push({ text: 'candle wall: light baked into the stone', x: 42.5, z: 4.9, size: 0.6 });
}

/**
 * 3. Level edges (screenshot 12): tall rocks on the far side (−Z) — a mass 2–3 blocks thick, 5–8 high,
 * light and dark columns, grass on top; on the camera side (+X, +Z) — low rocks of 1–2 blocks.
 */
function buildBounds(L: Level, labels: PgLabel[]): void {
  const { X0, X1, Z } = WORLD;
  cliffMass(L, X0, -Z, X1, -Z + 1, -1, 5, 8, 11);
  cliffMass(L, X1, -Z, X1, Z, -1, 1, 2, 12);
  cliffMass(L, X0 + 1, Z, X1, Z, -1, 1, 2, 13);
  labels.push({ text: 'level edges: rocks, dark strata, grass on top', x: 40, z: -6.6, size: 0.7 });
}

/** 2. River (screenshot 11): a waterfall out of the rock, a pond with spray, a river flowing to +Z, a bridge with lanterns, rock steps to the water */
function buildRiver(L: Level, labels: PgLabel[], dec: Dec): void {
  const Z = WORLD.Z;
  // rock with the waterfall: a mass up to y = 5, cheeks either side of the water
  cliffMass(L, 47, -Z, 58, -Z + 2, -1, 7, 7, 21, 0.3);
  for (const x of [51, 54]) for (let y = -1; y <= 5; y++) L.set(x, y, -Z + 3, y === 5 ? 'cliff_grass' : 'cliff');
  for (let z = -Z; z <= -Z + 2; z++) for (const x of [52, 53]) { L.set(x, 5, z, 'river', 1); L.set(x, 4, z, 'sand'); L.set(x, 6, z, 'air'); }
  waterfall(L, 52, 53, -Z + 3, -2, 5);
  // pond under the waterfall and the bed to the south (flow to +Z, rot 1), water a block and a half below ground
  riverBed(L, 50, -Z + 4, 55, -Z + 7, -1, -2, 1);
  riverBed(L, 52, -Z + 8, 53, Z - 1, -1, -2, 1);
  // spray and foam at the foot, foam downstream
  dec('waterfall_splash', 52.5, -1.15, -Z + 4.2, 0);
  dec('waterfall_foam', 50.8, -1.15, -Z + 5.2, 40);
  dec('waterfall_foam', 54.3, -1.15, -Z + 5.6, -20);
  dec('foam_patch', 52.6, -1.12, -Z + 6.6, 15);
  dec('foam_patch', 52.4, -1.12, -6, 70);
  dec('foam_patch', 52.7, -1.12, 9, 30);
  // bridge on the road
  bridgeX(L, 51, 54, -1, 1, -1);
  dec('lantern_post', 50.3, 0, -3.3, 0);
  dec('lantern_post_double', 55.2, 0, 3.4, 90);
  labels.push({ text: 'river: waterfall, spray, current, bridge, lanterns', x: 52.5, z: 5.4, size: 0.7 });
}

/** 1. Yard with a storage area (screenshot 10): a floor with a ledge, stepped fences, a hay stack, crates, a chest, carts, a bench, lanterns */
function buildYard(L: Level, labels: PgLabel[], dec: Dec): void {
  const x0 = 29, x1 = 43, z0 = -22, z1 = -10;
  floorRect(L, x0, z0, x1, z1, -1, 'yard_floor');
  // a half-block ledge by the far fence — like the floor steps in the screenshot
  floorRect(L, x0, z0, x1, z0 + 3, 0, 'yard_floor_slab');
  steppedWall(L, x0 - 1, z0 - 1, x1 + 1, z0 - 1, 0, 2, 3);
  steppedWall(L, x0 - 1, z0, x0 - 1, z1, 0, 1, 2);
  steppedWall(L, x1 + 1, z0, x1 + 1, z1 - 4, 0, 1, 2);
  // hay stack in the corner: a pyramid of bales
  hayStack(L, x0, 0, z0, [['####', '####', '###.'], ['###.', '##..'], ['#...']]);
  labels.push({ text: 'yard: floor, ledge, fences, hay', x: (x0 + x1) / 2, z: z1 + 1.6, size: 0.8 });
  // storage: crates, chest, carts, bench
  dec('crates_banded_stack', 40.5, 0.5, -20.6, -10);
  dec('crate_banded', 42.4, 0, -16.2, 12);
  dec('crate_banded', 42.2, 0, -15.1, -4);
  dec('crate_small', 30.6, 0, -14.2, 20);
  dec('crate_small', 31.4, 0, -13.4, -15);
  dec('crate_small', 30.3, 0, -12.8, 40);
  dec('chest', 35.5, 0.5, -21.2, 0);
  dec('cart_loaded', 39.8, 0, -13.2, -35);
  dec('cart', 34.6, 0, -15.6, 120);
  dec('bench', 36.5, 0, -11.2, 0);
  // lanterns: a double one at the yard entrance, a short one by the fence, a wall one on the far wall
  dec('lantern_post_double', 32.5, 0, -11, 90);
  dec('lantern_short', 43.2, 0, -10.4);
  dec('lantern_wall', 37, 1.9, z0 - 0.5, 0, [37, 1, z0 - 1]);
  labels.push({ text: 'crates · chest · carts · bench · lanterns', x: 37, z: z1 + 2.6, size: 0.6 });
}
