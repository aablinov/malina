#!/usr/bin/env node
/**
 * Decor shape generator: writes assets/decor/*.obj.
 *
 * Decor are free-standing items on top of blocks (wiki/design-level-decor.md): placed at 1/16 steps and at any angle,
 * yet "made of blocks" — sizes are multiples of 1/16 and UVs are in metres, so pixels are the same 16 per metre as on blocks.
 * The origin is the anchor point:
 *   floor   — centre of the bottom, the item stands on y = 0 and grows upward;
 *   wall    — a point on the wall, the item has its "back" to the z = 0 plane and protrudes towards +Z;
 *   ceiling — a point on the ceiling, the item hangs down (y ≤ 0).
 * Parts are built centred on the origin (tbox cuts faces along the cell grid), then rotated and moved (xf).
 *
 *   node scripts/gen-decor.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Obj } from './obj-writer.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'decor');
const P = 1 / 16;

const shapes = [];
const shape = (name, build) => { const o = new Obj(name); build(o); shapes.push(o); };
/** Box w × h × d with the bottom centre at zero */
const cbox = (o, w, h, d, groups = {}) => o.tbox(-w / 2, 0, -d / 2, w / 2, h, d / 2, groups);
/** Deterministic noise for scatters */
const rand = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const snap = (v) => Math.round(v / P) * P;

// --- stone ---
// fallen column: three 14/16 shaft fragments lying along X (−90° rotation around Z lays +Y onto +X), capital at the end
shape('column_fallen', (o) => {
  const T = 14 * P, ends = { py: 'top', ny: 'top' };
  for (const [xs, len, yaw] of [[-1.2, 0.9, 0], [-0.24, 0.75, 7], [0.62, 0.55, -16]]) {
    o.xf({ rot: [0, yaw, -90], move: [xs, T / 2, 0] }, () => o.tbox(-T / 2, 0, -T / 2, T / 2, len, T / 2, ends));
  }
  o.xf({ rot: [0, 0, -90], move: [-1.2 - 4 * P, 0.5, 0] }, () => o.tbox(-0.5, 0, -0.5, 0.5, 4 * P, 0.5, ends));
});
// standing column stump: base, 14/16 shaft and a ragged top
shape('column_stump', (o) => {
  cbox(o, 1, 3 * P, 1, { py: 'top', ny: 'top' });
  o.tbox(-7 * P, 3 * P, -7 * P, 7 * P, 1.1, 7 * P, { py: 'top' });
  o.tbox(-7 * P, 1.1, -7 * P, -P, 1.35, 0, { py: 'top', ny: null });
  o.tbox(P, 1.1, -7 * P, 7 * P, 1.22, -2 * P, { py: 'top', ny: null });
  o.tbox(-4 * P, 1.1, 2 * P, 3 * P, 1.45, 7 * P, { py: 'top', ny: null });
});
// rubble scatter: 3–6/16 cubes at different angles
shape('rubble', (o) => {
  const r = rand(7);
  for (let i = 0; i < 11; i++) {
    const s = snap((3 + r() * 3) * P), a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.6;
    o.xf({ rot: [r() * 30 - 15, r() * 90, r() * 30 - 15], move: [Math.cos(a) * d, 0, Math.sin(a) * d] }, () => cbox(o, s, s, s));
  }
  o.xf({ move: [0.1, 0, -0.05], rot: [0, 20, 0] }, () => cbox(o, 7 * P, 5 * P, 6 * P));
});
// loose bricks: an 8 × 3 × 4 /16 bar
shape('bricks_loose', (o) => {
  const r = rand(11);
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2, d = 0.15 + r() * 0.45;
    o.xf({ rot: [0, r() * 180, i === 4 ? 25 : 0], move: [Math.cos(a) * d, i === 4 ? 2 * P : 0, Math.sin(a) * d] }, () => cbox(o, 8 * P, 3 * P, 4 * P));
  }
});

// --- chains, roots, cobweb ---
// chain from the ceiling: 9 links of 4/16, every other one rotated 90°
shape('chain', (o) => {
  for (let i = 0; i < 9; i++) {
    const y = -(i + 1) * 3.5 * P;
    o.xf({ rot: [0, i % 2 ? 90 : 0, 0], move: [0, y, 0] }, () => {
      o.tbox(-2 * P, 0, -P / 2, -P, 5 * P, P / 2, 'side');
      o.tbox(P, 0, -P / 2, 2 * P, 5 * P, P / 2, 'side');
      o.tbox(-P, 0, -P / 2, P, P, P / 2, 'side');
      o.tbox(-P, 4 * P, -P / 2, P, 5 * P, P / 2, 'side');
    });
  }
  o.tbox(-3 * P, -P, -3 * P, 3 * P, 0, 3 * P, 'side'); // mount
});
// roots on a wall: hang down from the anchor point, slightly away from the wall
shape('roots', (o) => {
  const r = rand(5);
  o.tbox(-0.6, -2 * P, 0, 0.6, P, 2 * P, 'side');
  for (let i = 0; i < 6; i++) {
    const x = snap(-0.5 + i * 0.2 + (r() - 0.5) * 0.08), len = snap(0.5 + r() * 0.9), t = (i % 2 ? 2 : 3) * P;
    o.xf({ rot: [-4 - r() * 6, 0, (r() - 0.5) * 10], move: [x, 0, P] }, () => o.tbox(-t / 2, -len, 0, t / 2, 0, t, 'side'));
    if (i % 2 === 0) o.xf({ rot: [0, 0, 35], move: [x, -len * 0.6, P] }, () => o.tbox(-P / 2, -0.25, 0, P / 2, 0, P, 'side'));
  }
});
// cobweb: a cut-out 1 × 1 m plane, double-sided, on a wall or in a corner
shape('cobweb', (o) => {
  o.xf({ move: [0, -0.5, P] }, () => o.tbox(-0.5, 0, 0, 0.5, 1, 0, { pz: 'side', nz: null, px: null, nx: null, py: null, ny: null }));
});

// --- banner and torch ---
// banner: a pole from the wall, a 12/16 × 1.5 m cloth hangs down
shape('banner', (o) => {
  o.tbox(-8 * P, -P, P, 8 * P, P, 3 * P, 'pole');
  o.tbox(-P / 2, -P / 2, 0, P / 2, P / 2, 3 * P, 'pole');
  o.tbox(-6 * P, -1.5, 2 * P + P / 4, 6 * P, -P, 3 * P - P / 4, { pz: 'cloth', nz: 'cloth', px: 'cloth', nx: 'cloth', py: 'cloth', ny: 'cloth' });
});
// wall torch: a bracket on the wall, a 2/16 stick tilted away from the wall, flame at the tip
shape('torch_wall', (o) => {
  o.tbox(-2 * P, -3 * P, 0, 2 * P, -P, 2 * P, 'iron');
  o.xf({ rot: [25, 0, 0], move: [0, -4 * P, 2 * P] }, () => o.tbox(-P, 0, -P, P, 10 * P, P, { py: 'tip', ny: 'stick', px: 'stick', nx: 'stick', pz: 'stick', nz: 'stick' }));
});
shape('torch_wall_flame', (o) => {
  const ty = -4 * P + Math.cos(25 * Math.PI / 180) * 10 * P, tz = 2 * P + Math.sin(25 * Math.PI / 180) * 10 * P;
  o.xf({ move: [-0.5, ty - P, tz - 0.5] }, () => o.cross('side', 5 * P, 11 * P, 0, 7 * P));
});

// --- candles, bones, mushrooms ---
const CANDLES = [[-3 * P, -2 * P, 6 * P], [2 * P, 1 * P, 4 * P], [-1 * P, 4 * P, 3 * P], [4 * P, -4 * P, 2 * P]];
shape('candles', (o) => {
  for (const [x, z, h] of CANDLES) o.xf({ move: [x, 0, z] }, () => cbox(o, 2 * P, h, 2 * P));
  o.xf({ move: [0, 0, 0] }, () => cbox(o, 12 * P, P / 2, 12 * P, 'drip'));
});
shape('candles_flame', (o) => {
  for (const [x, z, h] of CANDLES) o.xf({ move: [x - 0.5, h, z - 0.5] }, () => o.cross('side', 7 * P, 9 * P, 0, 3 * P));
});
// a skull with eye sockets and two crossed bones
shape('bones', (o) => {
  o.xf({ rot: [0, -20, 0], move: [-2 * P, 0, 0] }, () => {
    cbox(o, 5 * P, 5 * P, 5 * P, 'bone');
    o.tbox(-2 * P, 2 * P, 2.5 * P, -0.5 * P, 3.5 * P, 2.6 * P, 'dark');
    o.tbox(0.5 * P, 2 * P, 2.5 * P, 2 * P, 3.5 * P, 2.6 * P, 'dark');
    o.tbox(-1.5 * P, 0, 2.5 * P, 1.5 * P, P, 2.7 * P, 'bone');
  });
  for (const [a, x] of [[35, 5 * P], [-40, 5 * P]]) o.xf({ rot: [0, a, 0], move: [x, 0, 3 * P] }, () => {
    o.tbox(-5 * P, 0, -P / 2, 5 * P, P, P / 2, 'bone');
    for (const s of [-1, 1]) o.tbox(s * 5 * P - P, 0, -P, s * 5 * P + P, 1.5 * P, P, 'bone');
  });
});
// mushrooms: 2/16 stems, 6/16 caps of different heights
const mushrooms = (name) => shape(name, (o) => {
  for (const [x, z, h, w] of [[-3 * P, -2 * P, 6 * P, 6 * P], [4 * P, 2 * P, 4 * P, 5 * P], [-1 * P, 5 * P, 3 * P, 4 * P]]) {
    o.xf({ move: [x, 0, z] }, () => {
      cbox(o, 2 * P, h, 2 * P, 'stem');
      o.xf({ move: [0, h, 0] }, () => cbox(o, w, 2 * P, w, 'cap'));
    });
  }
});
mushrooms('mushrooms');

// --- yard: lantern post, planter, tilted crate stack (after Minecraft Dungeons screenshots) ---
shape('lantern_post', (o) => {
  cbox(o, 5 * P, P, 5 * P, 'post');
  cbox(o, 3 * P, 2.2, 3 * P, { py: 'post', ny: 'post', px: 'post', nx: 'post', pz: 'post', nz: 'post' });
  o.tbox(-1.5 * P, 2.05, -1.5 * P, 10 * P, 2.2, 1.5 * P, 'post');
  o.tbox(8 * P, 1.9, -P / 2, 9 * P, 2.05, P / 2, 'iron');
  o.xf({ move: [8.5 * P, 1.55, 0] }, () => {
    cbox(o, 5 * P, P, 5 * P, 'iron');
    o.xf({ move: [0, 5 * P, 0] }, () => cbox(o, 5 * P, P, 5 * P, 'iron'));
    o.xf({ move: [0, 6 * P, 0] }, () => cbox(o, 3 * P, P, 3 * P, 'iron'));
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) o.xf({ move: [x * P, P, z * P] }, () => cbox(o, P, 4 * P, P, 'iron'));
  });
});
shape('lantern_post_glass', (o) => o.xf({ move: [8.5 * P, 1.55 + P, 0] }, () => cbox(o, 3 * P, 4 * P, 3 * P, 'side')));
shape('planter', (o) => {
  // a 1 × 12/16 × 6/16 box: four boards and soil at 5/16
  o.tbox(-0.5, 0, -6 * P, 0.5, 6 * P, -5 * P);
  o.tbox(-0.5, 0, 5 * P, 0.5, 6 * P, 6 * P);
  o.tbox(-0.5, 0, -5 * P, -0.5 + P, 6 * P, 5 * P);
  o.tbox(0.5 - P, 0, -5 * P, 0.5, 6 * P, 5 * P);
  o.tbox(-0.5 + P, 0, -5 * P, 0.5 - P, 5 * P, 5 * P, { py: 'soil', px: null, nx: null, pz: null, nz: null, ny: null });
});
shape('planter_flowers', (o) => {
  for (const x of [-5 * P, 0, 5 * P]) o.xf({ move: [x - 0.5, 5 * P, -0.5] }, () => o.cross('side', 3 * P, 13 * P, 0, 10 * P));
});
shape('crates_tilted', (o) => {
  const C = 15 * P;
  o.xf({ move: [-0.5, 0, 0] }, () => cbox(o, C, C, C));
  o.xf({ rot: [0, 14, 0], move: [0.52, 0, 0.08] }, () => cbox(o, C, C, C));
  o.xf({ rot: [0, 32, 0], move: [0.05, C, 0.02] }, () => cbox(o, C, C, C));
});

// --- world: yard (screenshot 10) ---
const CR = 15 * P;
// storage yard crate: planked, bands and paint are in the texture
shape('crate_banded', (o) => cbox(o, CR, CR, CR));
shape('crates_banded_stack', (o) => {
  o.xf({ move: [-0.5, 0, 0], rot: [0, 4, 0] }, () => cbox(o, CR, CR, CR));
  o.xf({ move: [0.5, 0, 0.1], rot: [0, -8, 0] }, () => cbox(o, CR, CR, CR));
  o.xf({ move: [0.02, CR, 0.04], rot: [0, 22, 0] }, () => cbox(o, CR, CR, CR));
});
shape('crate_small', (o) => {
  cbox(o, 10 * P, 9 * P, 10 * P);
  o.xf({ move: [0, 9 * P, 0] }, () => cbox(o, 11 * P, P, 11 * P, 'rim'));
});
// chest: body, lid, golden trim and a lock at the front (+Z)
shape('chest', (o) => {
  cbox(o, 14 * P, 8 * P, 10 * P);
  o.xf({ move: [0, 8 * P, 0] }, () => cbox(o, 14 * P, 4 * P, 10 * P, { py: 'lid', px: 'side', nx: 'side', pz: 'side', nz: 'side', ny: null }));
  for (const x of [-6.5 * P, 6.5 * P]) o.xf({ move: [x, 0, 0] }, () => cbox(o, 1.2 * P, 12.2 * P, 10.2 * P, 'trim'));
  o.xf({ move: [0, 6 * P, 5 * P] }, () => cbox(o, 3 * P, 4 * P, 0.6 * P, 'trim'));
});
// wheel: two squares at 45° — an octagon of cubes
const wheel = (o, x, y, z) => {
  for (const a of [0, 45]) o.xf({ rot: [a, 0, 0], move: [x, y, z], pivot: [0, 0, 0] }, () => o.tbox(-P, -4.5 * P, -4.5 * P, P, 4.5 * P, 4.5 * P, 'wheel'));
  o.xf({ move: [x, y, z] }, () => o.tbox(-1.6 * P, -1.2 * P, -1.2 * P, 1.6 * P, 1.2 * P, 1.2 * P, 'iron'));
};
// cart: a box on two wheels, shafts forward (+Z) down to the ground
const cartBody = (o) => {
  o.xf({ move: [0, 6 * P, 0] }, () => {
    cbox(o, 14 * P, 2 * P, 20 * P);
    o.tbox(-7 * P, 2 * P, -10 * P, 7 * P, 7 * P, -9 * P);
    o.tbox(-7 * P, 2 * P, 9 * P, 7 * P, 6 * P, 10 * P);
    o.tbox(-7 * P, 2 * P, -9 * P, -6 * P, 7 * P, 9 * P);
    o.tbox(6 * P, 2 * P, -9 * P, 7 * P, 7 * P, 9 * P);
  });
  wheel(o, -8 * P, 4.5 * P, 0);
  wheel(o, 8 * P, 4.5 * P, 0);
  for (const x of [-5 * P, 5 * P]) o.xf({ rot: [16, 0, 0], move: [x, 7 * P, 10 * P] }, () => o.tbox(-0.75 * P, -0.75 * P, 0, 0.75 * P, 0.75 * P, 14 * P, 'side'));
};
shape('cart', (o) => cartBody(o));
shape('cart_loaded', (o) => {
  cartBody(o);
  o.xf({ move: [-2.5 * P, 8 * P, -4 * P], rot: [0, 8, 0] }, () => cbox(o, 8 * P, 6 * P, 9 * P, { side: 'hay', py: 'hayTop', ny: 'hayTop', px: 'hay', nx: 'hay', pz: 'hay', nz: 'hay' }));
  o.xf({ move: [3 * P, 8 * P, 4 * P], rot: [0, -12, 0] }, () => cbox(o, 7 * P, 6 * P, 7 * P, 'box'));
  o.xf({ move: [2 * P, 14 * P, -3 * P], rot: [0, 30, 0] }, () => cbox(o, 6 * P, 5 * P, 6 * P, 'box'));
});
// bench: a 2/16 seat at height 7/16, two board legs
shape('bench', (o) => {
  o.xf({ move: [0, 7 * P, 0] }, () => cbox(o, 20 * P, 2 * P, 6 * P));
  for (const x of [-8 * P, 8 * P]) o.xf({ move: [x, 0, 0] }, () => cbox(o, 2 * P, 7 * P, 5 * P));
});
// lanterns: cage and glass (the glass is a separate shape in the glow layer)
const lanternCage = (o, at) => o.xf({ move: at }, () => {
  cbox(o, 5 * P, P, 5 * P, 'iron');
  o.xf({ move: [0, 5 * P, 0] }, () => cbox(o, 5 * P, P, 5 * P, 'iron'));
  o.xf({ move: [0, 6 * P, 0] }, () => cbox(o, 3 * P, P, 3 * P, 'iron'));
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) o.xf({ move: [x * P, P, z * P] }, () => cbox(o, P, 4 * P, P, 'iron'));
});
const lanternGlass = (o, at) => o.xf({ move: [at[0], at[1] + P, at[2]] }, () => cbox(o, 3 * P, 4 * P, 3 * P, 'side'));
// double: a 2.4 m post and a crossbar with lanterns on both sides
const DOUBLE = [[-9 * P, 1.75, 0], [9 * P, 1.75, 0]];
shape('lantern_post_double', (o) => {
  cbox(o, 5 * P, P, 5 * P, 'post');
  cbox(o, 3 * P, 2.4, 3 * P, 'post');
  o.tbox(-11 * P, 2.25, -1.5 * P, 11 * P, 2.4, 1.5 * P, 'post');
  for (const [x, y] of DOUBLE) { o.tbox(x - P / 2, y + 7 * P, -P / 2, x + P / 2, 2.25, P / 2, 'iron'); lanternCage(o, [x, y, 0]); }
});
shape('lantern_post_double_glass', (o) => { for (const at of DOUBLE) lanternGlass(o, at); });
// wall-mounted: a bracket from the wall (+Z) and a lantern on it
const WALL_AT = [0, -9 * P, 6 * P];
shape('lantern_wall', (o) => {
  o.tbox(-2 * P, -2 * P, 0, 2 * P, 2 * P, P, 'iron');
  o.tbox(-P / 2, -P / 2, P, P / 2, P / 2, 7 * P, 'iron');
  o.tbox(-P / 2, -2 * P, 6 * P - P / 2, P / 2, -P / 2, 6 * P + P / 2, 'iron');
  lanternCage(o, WALL_AT);
});
shape('lantern_wall_glass', (o) => lanternGlass(o, WALL_AT));
// short: a 1 m post and a lantern on top
const SHORT_AT = [0, 1.0, 0];
shape('lantern_short', (o) => { cbox(o, 5 * P, P, 5 * P, 'post'); cbox(o, 3 * P, 1.0, 3 * P, 'post'); lanternCage(o, SHORT_AT); });
shape('lantern_short_glass', (o) => lanternGlass(o, SHORT_AT));

// --- world: water (screenshot 11) ---
// splash at the foot of a waterfall: white "clouds" of cubes of different sizes
const puffs = (o, seed, n, spread, sz, rise) => {
  const r = rand(seed);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread, s = snap(sz[0] + r() * (sz[1] - sz[0]));
    o.xf({ rot: [r() * 20 - 10, r() * 90, r() * 20 - 10], move: [Math.cos(a) * d, r() * rise, Math.sin(a) * d] }, () => cbox(o, s, s * 0.8, s));
  }
};
shape('waterfall_splash', (o) => puffs(o, 31, 9, 0.9, [0.35, 0.75], 0.6));
shape('waterfall_foam', (o) => puffs(o, 32, 7, 0.7, [0.25, 0.5], 0.15));
// foam on water: flat 1/16 patches above the surface
shape('foam_patch', (o) => {
  const r = rand(33);
  for (let i = 0; i < 8; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.8, w = snap(0.2 + r() * 0.4), dd = snap(0.15 + r() * 0.3);
    o.xf({ rot: [0, r() * 90, 0], move: [Math.cos(a) * d, 0, Math.sin(a) * d] }, () => cbox(o, w, P, dd, 'side'));
  }
});

// --- world: candles on walls (screenshot 13) — light is baked into blocks, no PointLight ---
const candleSet = (name, list) => {
  shape(name, (o) => { for (const [x, z, h] of list) o.xf({ move: [x, 0, z] }, () => cbox(o, 2 * P, h, 2 * P)); });
  shape(`${name}_flame`, (o) => { for (const [x, z, h] of list) o.xf({ move: [x - 0.5, h, z - 0.5] }, () => o.cross('side', 6.5 * P, 9.5 * P, 0, 3.5 * P)); });
};
candleSet('candles_group', [[-4 * P, -3 * P, 7 * P], [2 * P, -1 * P, 5 * P], [-1 * P, 4 * P, 4 * P], [5 * P, 4 * P, 6 * P], [-5 * P, 3 * P, 3 * P]]);
candleSet('candles_row', [[-12 * P, 0, 5 * P], [-6 * P, P, 7 * P], [0, -P, 4 * P], [6 * P, 0, 6 * P], [12 * P, P, 5 * P]]);
candleSet('candle_tall', [[0, 0, 11 * P]]);

// --- nature ("Road and nature" batch): dead tree, reeds, stump, pebbles, leaf litter ---
// dead tree: a 6/16 trunk 2.3 m tall widening at the roots, four bare branches at an angle (references 1, 4, 10)
shape('tree_dead', (o) => {
  cbox(o, 6 * P, 2.3, 6 * P, 'side');
  cbox(o, 10 * P, 4 * P, 10 * P, 'side');
  for (const [h, yaw, tilt, len] of [[1.25, 20, 55, 0.85], [1.65, 140, 50, 0.7], [1.95, 260, 45, 0.6], [2.2, 70, 30, 0.45]]) {
    o.xf({ rot: [0, yaw, 0] }, () => o.xf({ rot: [0, 0, -tilt], move: [0, h, 0] }, () => o.tbox(-1.5 * P, 0, -1.5 * P, 1.5 * P, len, 1.5 * P, 'side')));
  }
});
// reeds: five crossed stalks 8/16 wide, 14/16 tall, at different angles
shape('reeds', (o) => {
  for (const [x, z, yaw, h] of [[-4 * P, -3 * P, 10, 14 * P], [3 * P, -4 * P, 50, 12 * P], [0, 3 * P, 80, 15 * P], [5 * P, 3 * P, 25, 11 * P], [-5 * P, 4 * P, 65, 13 * P]]) {
    o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => o.cross('side', -4 * P, 4 * P, 0, h));
  }
});
// stump: a 10/16 round 6/16 tall and three roots
shape('stump', (o) => {
  cbox(o, 10 * P, 6 * P, 10 * P, { py: 'top', ny: 'bottom' });
  for (const yaw of [15, 140, 250]) o.xf({ rot: [0, yaw, 0] }, () => o.tbox(4 * P, 0, -1.5 * P, 9 * P, 2 * P, 1.5 * P, 'side'));
});
// pebbles: three 4–7/16 boulders at different angles
shape('rock_small', (o) => {
  for (const [x, z, s, yaw] of [[-3 * P, -2 * P, 7 * P, 20], [4 * P, 1 * P, 5 * P, 65], [-1 * P, 5 * P, 4 * P, 40]]) {
    o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => cbox(o, s, s * 0.8, s * 0.9, { py: 'top', ny: 'bottom' }));
  }
});
// leaf litter: flat 1/16 patches on the ground, like foam on water
shape('leaf_litter', (o) => {
  const r = rand(37);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.75, w = snap(0.3 + r() * 0.5), dd = snap(0.25 + r() * 0.4);
    o.xf({ rot: [0, r() * 90, 0], move: [Math.cos(a) * d, 0, Math.sin(a) * d] }, () => cbox(o, w, P, dd, 'top'));
  }
});

// --- ruins ("Ruins" batch): gravestones, cross, hooded statue, bowl, pots, ivy, skull (references 2, 8, 10) ---
// gravestone: an 8/16 × 14/16 × 3/16 slab with a rounded top (a step), slightly tilted
shape('gravestone', (o) => {
  o.xf({ rot: [0, 0, -4] }, () => {
    o.tbox(-4 * P, 0, -1.5 * P, 4 * P, 12 * P, 1.5 * P, { py: 'top', ny: 'bottom' });
    o.tbox(-3 * P, 12 * P, -1.5 * P, 3 * P, 14 * P, 1.5 * P, { py: 'top', ny: null });
    o.tbox(-5 * P, 0, -2.5 * P, 5 * P, 2 * P, 2.5 * P, { py: 'top', ny: 'bottom' });
  });
});
// wide gravestone: 12/16 × 9/16, flat top with a chip
shape('gravestone_wide', (o) => {
  o.xf({ rot: [0, 0, 3] }, () => {
    o.tbox(-6 * P, 0, -1.5 * P, 6 * P, 8 * P, 1.5 * P, { py: 'top', ny: 'bottom' });
    o.tbox(-6 * P, 8 * P, -1.5 * P, 2 * P, 9 * P, 1.5 * P, { py: 'top', ny: null });
  });
});
// fallen gravestone: the slab lies on the ground at an angle, one edge raised
shape('gravestone_fallen', (o) => {
  o.xf({ rot: [8, 25, 0], move: [0, P, 0] }, () => o.tbox(-7 * P, 0, -4 * P, 7 * P, 3 * P, 4 * P, { py: 'top', ny: 'bottom' }));
});
// grave cross: a 2/16 post and a crossbar, leaning
shape('grave_cross', (o) => {
  o.xf({ rot: [0, 0, 6] }, () => {
    o.tbox(-P, 0, -P, P, 14 * P, P, { py: 'top', ny: 'bottom' });
    o.tbox(-5 * P, 9 * P, -P, 5 * P, 11 * P, P, { py: 'top', ny: 'bottom' });
  });
});
// hooded statue on a pedestal (reference 2): a 14/16 pedestal, the body narrows upward, the hood overhangs, hands folded
shape('statue_hooded', (o) => {
  cbox(o, 14 * P, 8 * P, 14 * P, { py: 'top', ny: 'bottom' });
  o.tbox(-5 * P, 8 * P, -4 * P, 5 * P, 20 * P, 4 * P, { py: 'top', ny: null });
  o.tbox(-4 * P, 20 * P, -3 * P, 4 * P, 27 * P, 3 * P, { py: 'top', ny: null });
  o.tbox(-4 * P, 15 * P, 4 * P, 4 * P, 18 * P, 6 * P, { py: 'top', ny: 'bottom' });
  o.tbox(-3 * P, 27 * P, -3 * P, 3 * P, 33 * P, 3 * P, { py: 'hood', ny: null, px: 'hood', nx: 'hood', pz: 'hood', nz: 'hood' });
  o.tbox(-4 * P, 30 * P, -4 * P, 4 * P, 35 * P, 4 * P, { py: 'hood', ny: 'hood', px: 'hood', nx: 'hood', pz: 'hood', nz: 'hood' });
});
// stone bowl: a 6/16 stem, a 14/16 bowl with a hollow
shape('stone_bowl', (o) => {
  cbox(o, 6 * P, 3 * P, 6 * P, { py: 'top', ny: 'bottom' });
  o.tbox(-7 * P, 3 * P, -7 * P, 7 * P, 5 * P, 7 * P, { py: 'inner', ny: 'bottom' });
  for (const [x0, z0, x1, z1] of [[-7, -7, 7, -5], [-7, 5, 7, 7], [-7, -5, -5, 5], [5, -5, 7, 5]]) o.tbox(x0 * P, 5 * P, z0 * P, x1 * P, 9 * P, z1 * P, { py: 'top', ny: null });
});
// pots: a large 8/16 one with a neck and a small 5/16 one, one tilted
shape('pot_clay', (o) => {
  o.xf({ move: [-3 * P, 0, -2 * P] }, () => {
    cbox(o, 8 * P, 9 * P, 8 * P, { py: 'top', ny: 'bottom' });
    o.tbox(-3 * P, 9 * P, -3 * P, 3 * P, 11 * P, 3 * P, { py: null, ny: null });
    o.tbox(-3.5 * P, 11 * P, -3.5 * P, 3.5 * P, 12 * P, 3.5 * P, { py: 'top', ny: 'bottom' });
  });
  o.xf({ rot: [0, 30, 12], move: [4 * P, 0, 3 * P] }, () => {
    cbox(o, 5 * P, 6 * P, 5 * P, { py: 'top', ny: 'bottom' });
    o.tbox(-2 * P, 6 * P, -2 * P, 2 * P, 7 * P, 2 * P, { py: 'top', ny: null });
  });
});
// ivy: three flat strips 1/16 from the wall, hanging down from the anchor point (cut-out texture)
shape('ivy', (o) => {
  for (const [x, w, top, len] of [[-5 * P, 6 * P, 2 * P, 1.3], [1 * P, 7 * P, 1 * P, 0.9], [-1 * P, 5 * P, 3 * P, 1.6]]) {
    o.tbox(x - w / 2, top - len, P, x + w / 2, top, P, { pz: 'side', nz: 'side', px: null, nx: null, py: null, ny: null });
  }
});
// skull: 5/16 with eye sockets and a jaw, slightly turned
shape('skull', (o) => {
  o.xf({ rot: [0, 35, 0] }, () => {
    cbox(o, 5 * P, 5 * P, 5 * P, 'bone');
    o.tbox(-2 * P, 2 * P, 2.5 * P, -0.5 * P, 3.5 * P, 2.6 * P, 'dark');
    o.tbox(0.5 * P, 2 * P, 2.5 * P, 2 * P, 3.5 * P, 2.6 * P, 'dark');
    o.tbox(-1.5 * P, 0, 2.5 * P, 1.5 * P, P, 2.7 * P, 'bone');
  });
});

// --- settlement ("Settlement" batch, references 6, 7, 11, 12, 15) ---
// windmill sails: a hub on the wall, four 3 m lattice sails (beam + two rails + crossbars); broken — three sails, one is a stub
const sails = (name, arms) => shape(name, (o) => {
  o.tbox(-3 * P, -3 * P, 0, 3 * P, 3 * P, 8 * P, 'iron');
  for (const [ang, len] of arms) o.xf({ rot: [0, 0, ang], move: [0, 0, 5 * P] }, () => {
    o.tbox(-1.5 * P, 0, -1.5 * P, 1.5 * P, len, 1.5 * P, 'side');
    if (len > 1.5) {
      o.tbox(2 * P, 0.4, -P / 2, 3 * P, len, P / 2, 'lattice');
      o.tbox(9 * P, 0.4, -P / 2, 10 * P, len, P / 2, 'lattice');
      for (let y = 0.5; y < len - 0.1; y += 0.3) o.tbox(1.5 * P, y, -P / 2, 10 * P, y + P, P / 2, 'lattice');
    }
  });
});
sails('windmill_sails', [[0, 4.2], [90, 4.2], [180, 4.2], [270, 4.2]]);
sails('windmill_sails_broken', [[10, 4.2], [100, 4.2], [190, 4.2], [280, 1.1]]);
// barrel: 12/16 × 14/16, hoops protrude by 1/16
shape('barrel', (o) => {
  cbox(o, 12 * P, 14 * P, 12 * P, { py: 'top', ny: 'bottom' });
  for (const y of [2 * P, 11 * P]) o.tbox(-6.5 * P, y, -6.5 * P, 6.5 * P, y + 2 * P, 6.5 * P, { py: null, ny: null });
});
// broken barrel: lies on its side, half the staves fell out, boards nearby
shape('barrel_broken', (o) => {
  o.xf({ rot: [0, 25, 90], move: [0, 6 * P, 0] }, () => {
    o.tbox(-6 * P, -6 * P, -6 * P, 6 * P, 7 * P, 0, { py: 'top', ny: 'bottom' });
    o.tbox(-6 * P, -6 * P, 0, -2 * P, 7 * P, 4 * P, { py: 'top', ny: 'bottom' });
  });
  for (const [x, z, a] of [[7 * P, 5 * P, 20], [-6 * P, 8 * P, -35]]) o.xf({ rot: [0, a, 0], move: [x, 0, z] }, () => cbox(o, 2 * P, P, 10 * P, 'side'));
});
// an 8/16 sack with a tied neck
const sackAt = (o, x, z, yaw, h = 9 * P) => o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => {
  cbox(o, 8 * P, h, 7 * P);
  o.tbox(-2 * P, h, -2 * P, 2 * P, h + 2 * P, 2 * P);
  o.tbox(-3 * P, h + 2 * P, -3 * P, 3 * P, h + 3 * P, 3 * P);
});
shape('sack', (o) => sackAt(o, 0, 0, 15));
shape('sacks_pile', (o) => { sackAt(o, -5 * P, -3 * P, 10); sackAt(o, 5 * P, 2 * P, -20); o.xf({ rot: [0, 40, 0], move: [0, 8 * P, 0] }, () => cbox(o, 9 * P, 6 * P, 7 * P)); });
// well roof: two 2/16 posts 1.5 m tall, a windlass with a handle, a 1.2 × 0.9 gable roof
shape('well_roof', (o) => {
  for (const x of [-9 * P, 9 * P]) o.xf({ move: [x, 0, 0] }, () => cbox(o, 2 * P, 1.5, 2 * P, 'post'));
  o.tbox(-9 * P, 1.15, -P, 9 * P, 1.15 + 2 * P, P, 'post');
  o.tbox(-11 * P, 1.0, -P / 2, -9 * P, 1.15, P / 2, 'iron');
  o.tbox(-0.5 * P, 0.7, -0.5 * P, 0.5 * P, 1.15, 0.5 * P, 'rope');
  for (const [sgn] of [[1], [-1]]) o.xf({ rot: [0, 0, sgn * 35], move: [sgn * 8 * P, 1.5, 0] }, () => o.tbox(-9 * P, 0, -8 * P, 0, 2 * P, 8 * P, 'roof'));
  o.tbox(-2 * P, 1.75, -8 * P, 2 * P, 1.75 + 2 * P, 8 * P, 'roof');
});
// a 6/16 bucket with a handle
shape('bucket', (o) => {
  cbox(o, 6 * P, 6 * P, 6 * P, { py: 'top', ny: 'bottom' });
  o.tbox(-3.5 * P, 4 * P, -3.5 * P, 3.5 * P, 5 * P, 3.5 * P, { py: null, ny: null, px: 'iron', nx: 'iron', pz: 'iron', nz: 'iron' });
  o.tbox(-P / 2, 6 * P, -3 * P, P / 2, 9 * P, 3 * P, 'iron');
});
// ladder against a wall: two 2/16 rails from the anchor point 2.4 m down, rungs every 5/16
shape('ladder', (o) => {
  for (const x of [-5 * P, 5 * P]) o.tbox(x - P, -2.4, 2 * P, x + P, 0.1, 4 * P);
  for (let y = -2.3; y < 0; y += 5 * P) o.tbox(-5 * P, y, 2.5 * P, 5 * P, y + P, 3.5 * P);
});
// tent: two cloth slopes on a ridge, two poles, entrance from +Z
shape('tent', (o) => {
  for (const sgn of [1, -1]) o.xf({ rot: [0, 0, sgn * 50], move: [sgn * 15 * P, 0, 0] }, () => o.tbox(0, 0, -16 * P, 2 * P, 1.45, 16 * P, 'cloth'));
  o.tbox(-P, 1.1, -17 * P, P, 1.1 + 2 * P, 17 * P, 'pole');
  for (const z of [-15 * P, 15 * P]) o.tbox(-P, 0, z - P, P, 1.1, z + P, 'pole');
  o.tbox(-9 * P, 0, -16.5 * P, 9 * P, 0.9, -15.5 * P, 'cloth');
});
// scarecrow: a pole, a crossbar, a hay body and head, a hat
shape('scarecrow', (o) => {
  cbox(o, 2 * P, 1.9, 2 * P, 'pole');
  o.tbox(-9 * P, 1.25, -P, 9 * P, 1.25 + 2 * P, P, 'pole');
  o.tbox(-5 * P, 0.75, -3 * P, 5 * P, 1.45, 3 * P, 'cloth');
  o.tbox(-3 * P, 1.45, -3 * P, 3 * P, 1.8, 3 * P, { py: 'hayTop', ny: 'hayTop', px: 'hay', nx: 'hay', pz: 'hay', nz: 'hay' });
  o.tbox(-5 * P, 1.8, -5 * P, 5 * P, 1.85, 5 * P, 'pole');
  o.tbox(-3 * P, 1.85, -3 * P, 3 * P, 2.05, 3 * P, 'pole');
});
// firewood: a stack of 5/16 logs along X in two rows
shape('firewood_pile', (o) => {
  const log = (y, z, len) => o.xf({ rot: [0, 0, -90], move: [-len / 2, y, z] }, () => o.tbox(-2.5 * P, 0, -2.5 * P, 2.5 * P, len, 2.5 * P, { py: 'end', ny: 'end', px: 'side', nx: 'side', pz: 'side', nz: 'side' }));
  for (const [z, len] of [[-4 * P, 0.9], [1 * P, 0.95], [6 * P, 0.8]]) log(2.5 * P, z, len);
  for (const [z, len] of [[-1.5 * P, 0.85], [3.5 * P, 0.9]]) log(7.5 * P, z, len);
  log(12.5 * P, 1 * P, 0.7);
});
// signpost: a post and two arrow boards
shape('signpost', (o) => {
  cbox(o, 2 * P, 2.0, 2 * P, 'post');
  o.xf({ rot: [0, 10, 0], move: [0, 1.6, 0] }, () => o.tbox(-2 * P, 0, -P, 12 * P, 5 * P, P, 'board'));
  o.xf({ rot: [0, 200, 0], move: [0, 1.2, 0] }, () => o.tbox(-2 * P, 0, -P, 10 * P, 5 * P, P, 'board'));
});
// broken cart: the body tipped onto its side missing a wheel, the wheel lies nearby
shape('cart_broken', (o) => {
  o.xf({ rot: [0, 20, -28], move: [2 * P, 0, 0] }, () => cartBody(o));
  o.xf({ rot: [90, 0, 0], move: [-12 * P, 1.5 * P, 10 * P] }, () => wheel(o, 0, 0, 0));
});

// --- snow ("snow" biome, references 13, 9) ---
// snow pile: flat 2–4/16 patches, like leaf litter, but higher in the middle
shape('snow_pile', (o) => {
  const r = rand(41);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.7, w = snap(0.3 + r() * 0.5), dd = snap(0.25 + r() * 0.45), hh = snap((2 + r() * 2) * P);
    o.xf({ rot: [0, r() * 90, 0], move: [Math.cos(a) * d, 0, Math.sin(a) * d] }, () => cbox(o, w, hh, dd, { py: 'top', ny: 'bottom' }));
  }
  cbox(o, 0.5, 5 * P, 0.4, { py: 'top', ny: 'bottom' });
});
// snowdrift by a wall: a stepped wedge from the wall outward (+Z), 1 m wide
shape('snowdrift', (o) => {
  for (const [h, dz] of [[8 * P, 4 * P], [5 * P, 8 * P], [2 * P, 12 * P]]) o.tbox(-8 * P, 0, 0, 8 * P, h, dz, { py: 'top', ny: 'bottom' });
});
// icicles from the ceiling: 5 cones of two boxes, 4–12/16
const icicleAt = (o, x, z, len) => o.xf({ move: [x, 0, z] }, () => { o.tbox(-1.5 * P, -len * 0.5, -1.5 * P, 1.5 * P, 0, 1.5 * P); o.tbox(-0.5 * P, -len, -0.5 * P, 0.5 * P, -len * 0.5, 0.5 * P); });
shape('icicles', (o) => { for (const [x, z, len] of [[-5 * P, -3 * P, 10 * P], [1 * P, -4 * P, 6 * P], [4 * P, 2 * P, 12 * P], [-2 * P, 4 * P, 5 * P], [-6 * P, 3 * P, 7 * P]]) icicleAt(o, x, z, len); });
// icicles on a wall: from the anchor point down, protruding by 2/16
shape('icicles_wall', (o) => { for (const [x, len] of [[-5 * P, 9 * P], [-1 * P, 5 * P], [3 * P, 11 * P], [6 * P, 6 * P]]) icicleAt(o, x, 2 * P, len); });
// ice spikes: three tilted 4–6/16 pillars, height 0.5–1.1 m
shape('ice_spikes', (o) => {
  for (const [x, z, h, w, yaw, tilt] of [[-3 * P, -2 * P, 1.1, 6 * P, 20, 8], [4 * P, 1 * P, 0.7, 5 * P, 60, -10], [-1 * P, 5 * P, 0.5, 4 * P, 100, 6]]) {
    o.xf({ rot: [0, yaw, tilt], move: [x, 0, z] }, () => { cbox(o, w, h * 0.6, w, { py: null, ny: 'bottom' }); o.tbox(-w / 4, h * 0.6, -w / 4, w / 4, h, w / 4, { py: 'top', ny: null }); });
  }
});
// frozen bush: bare branches of bars and snow caps
shape('frozen_bush', (o) => {
  for (const [yaw, tilt, len] of [[0, 20, 0.5], [90, 25, 0.45], [180, 18, 0.55], [270, 28, 0.4], [45, 10, 0.35]]) {
    o.xf({ rot: [0, yaw, 0] }, () => o.xf({ rot: [0, 0, -tilt] }, () => o.tbox(-P, 0, -P, P, len, P, 'side')));
  }
  for (const [x, z, y] of [[-3 * P, 2 * P, 0.4], [3 * P, -3 * P, 0.35], [0, 4 * P, 0.3]]) o.xf({ move: [x, y, z] }, () => cbox(o, 5 * P, 2 * P, 5 * P, 'snow'));
});
// snowman: three balls 10 / 8 / 6 /16, a bucket, a carrot, stick arms, buttons
shape('snowman', (o) => {
  cbox(o, 10 * P, 10 * P, 10 * P, { py: 'top', ny: 'bottom' });
  o.xf({ move: [0, 10 * P, 0] }, () => cbox(o, 8 * P, 8 * P, 8 * P, { py: 'top', ny: 'bottom' }));
  o.xf({ move: [0, 18 * P, 0] }, () => cbox(o, 6 * P, 6 * P, 6 * P, { py: 'top', ny: 'bottom' }));
  o.xf({ move: [0, 24 * P, 0] }, () => cbox(o, 5 * P, 3 * P, 5 * P, 'iron'));
  o.tbox(-P / 2, 20 * P, 3 * P, P / 2, 21 * P, 6 * P, 'carrot');
  for (const [x, y] of [[-1.5 * P, 21.5 * P], [1.5 * P, 21.5 * P], [0, 15 * P], [0, 12.5 * P]]) o.tbox(x - P / 2, y, 3.5 * P, x + P / 2, y + P, 4.5 * P, 'iron');
  for (const sgn of [1, -1]) o.xf({ rot: [0, 0, sgn * 60], move: [sgn * 4 * P, 14 * P, 0] }, () => o.tbox(-P / 2, 0, -P / 2, P / 2, 0.4, P / 2, 'stick'));
});
// log under snow: a 6/16 log along X, a strip of snow on top
shape('log_snow', (o) => {
  o.xf({ rot: [0, 0, -90], move: [-0.6, 3 * P, 0] }, () => o.tbox(-3 * P, 0, -3 * P, 3 * P, 1.2, 3 * P, { py: 'end', ny: 'end', px: 'side', nx: 'side', pz: 'side', nz: 'side' }));
  o.tbox(-0.55, 6 * P, -2.5 * P, 0.55, 8 * P, 2.5 * P, 'snow');
});
// pebbles under snow: like rock_small, white on top
shape('rock_snow', (o) => {
  for (const [x, z, s, yaw] of [[-3 * P, -2 * P, 7 * P, 20], [4 * P, 1 * P, 5 * P, 65], [-1 * P, 5 * P, 4 * P, 40]]) {
    o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => cbox(o, s, s * 0.8, s * 0.9, { py: 'top', ny: 'bottom' }));
  }
});

// --- jungle with crystals ("jungle" biome, reference 16) ---
// crystal prism: a bar and a narrow tip, tilted around its base (as in the crystal block)
const prismAt = (o, x, z, w, h, yaw, tilt) => o.xf({ rot: [tilt, yaw, 0], move: [x, 0, z] }, () => {
  cbox(o, w, h * 0.62, w, { py: null, ny: 'bottom' });
  o.tbox(-w / 4, h * 0.62, -w / 4, w / 4, h, w / 4, { py: 'top', ny: null });
});
// cluster: 6 prisms of different height 0.5–1.6 m and tilt around the centre
shape('crystal_cluster', (o) => {
  for (const [x, z, w, h, yaw, tilt] of [[0, 0, 7 * P, 1.6, 10, 6], [-5 * P, 3 * P, 5 * P, 1.1, 60, -16], [5 * P, -2 * P, 5 * P, 0.9, 120, 14], [2 * P, 6 * P, 4 * P, 0.7, 200, 18], [-4 * P, -5 * P, 4 * P, 0.6, 280, -12], [7 * P, 4 * P, 3 * P, 0.5, 330, 20]]) prismAt(o, x, z, w, h, yaw, tilt);
});
// shard: a prism lying on its side, two splinters nearby
shape('crystal_shard', (o) => {
  o.xf({ rot: [0, 25, 0] }, () => o.xf({ rot: [78, 0, 0], move: [0, 2.5 * P, -3 * P] }, () => prismAt(o, 0, 0, 5 * P, 0.8, 0, 0)));
  prismAt(o, 5 * P, 4 * P, 3 * P, 4 * P, 40, 10);
  prismAt(o, -6 * P, 2 * P, 2 * P, 3 * P, 100, -8);
});
// vines from the ceiling: four cut-out 1/16 strips hang 1–2.2 m from the anchor point, crosswise
shape('vines_hanging', (o) => {
  for (const [x, z, yaw, w, len] of [[-5 * P, 2 * P, 0, 7 * P, 1.9], [3 * P, -4 * P, 90, 6 * P, 1.4], [6 * P, 5 * P, 45, 5 * P, 2.2], [-2 * P, -6 * P, 135, 6 * P, 1.1]]) {
    o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => o.tbox(-w / 2, -len, 0, w / 2, 0, 0, { pz: 'side', nz: 'side', px: null, nx: null, py: null, ny: null }));
  }
});
// vines on a wall: like ivy, but the strips are longer and wider, hanging from the anchor point
shape('vines_wall', (o) => {
  for (const [x, w, top, len] of [[-6 * P, 7 * P, 2 * P, 1.8], [1 * P, 8 * P, 1 * P, 1.2], [-1 * P, 5 * P, 3 * P, 2.2], [6 * P, 6 * P, 0, 1.5]]) {
    o.tbox(x - w / 2, top - len, P, x + w / 2, top, P, { pz: 'side', nz: 'side', px: null, nx: null, py: null, ny: null });
  }
});
// buttress roots: four wedges from the centre outward — tall at the trunk, tapering to the ground at the end
shape('roots_big', (o) => {
  for (const [yaw, len, h] of [[15, 1.3, 0.9], [110, 1.1, 0.7], [200, 1.4, 1.0], [300, 1.0, 0.6]]) o.xf({ rot: [0, yaw, 0] }, () => {
    o.tbox(0, 0, -2 * P, len * 0.45, h, 2 * P, 'side');
    o.tbox(len * 0.45, 0, -1.5 * P, len * 0.75, h * 0.5, 1.5 * P, 'side');
    o.tbox(len * 0.75, 0, -P, len, h * 0.2, P, 'side');
  });
});
// stone idol head: a 14/16 cube on a slab, brow, nose, lips, ears; the top is slightly broken; faces +Z
shape('idol_head', (o) => {
  cbox(o, 1, 3 * P, 1, { py: 'top', ny: 'bottom' });
  o.tbox(-7 * P, 3 * P, -7 * P, 7 * P, 17 * P, 7 * P, { py: 'top', ny: null });
  o.tbox(-7 * P, 17 * P, -7 * P, 3 * P, 19 * P, 7 * P, { py: 'top', ny: null });
  o.tbox(-6 * P, 12 * P, 7 * P, 6 * P, 14 * P, 9 * P, 'carved'); // brow
  o.tbox(-1.5 * P, 7 * P, 7 * P, 1.5 * P, 12 * P, 9 * P, 'side'); // nose
  o.tbox(-4 * P, 5 * P, 7 * P, 4 * P, 6.5 * P, 8 * P, 'carved'); // lips
  for (const x of [-5 * P, 2.5 * P]) o.tbox(x, 9.5 * P, 7 * P, x + 2.5 * P, 11 * P, 7.5 * P, 'dark'); // eyes
  for (const s of [-1, 1]) o.tbox(s * 7 * P - (s < 0 ? 2 * P : 0), 8 * P, -2 * P, s * 7 * P + (s > 0 ? 2 * P : 0), 14 * P, 2 * P, 'carved'); // ears
});
// fallen mossy log: an 8/16 log along X, moss as a strip on top and a patch on the side, a fern at the end
shape('log_mossy_fallen', (o) => {
  o.xf({ rot: [0, 0, -90], move: [-0.75, 4 * P, 0] }, () => o.tbox(-4 * P, 0, -4 * P, 4 * P, 1.5, 4 * P, { py: 'end', ny: 'end', px: 'side', nx: 'side', pz: 'side', nz: 'side' }));
  o.tbox(-0.65, 8 * P, -3 * P, 0.5, 9 * P, 3 * P, 'moss');
  o.tbox(-0.3, 2 * P, 4 * P, 0.3, 7 * P, 4.5 * P, 'moss');
});
shape('log_mossy_fallen_fern', (o) => o.xf({ rot: [0, 30, 0], move: [0.85, 0, 0.1] }, () => o.cross('side', -0.5, 0.5, 0, 0.7)));
// fern cluster: five wide 12/16 crosses at different angles
shape('fern_cluster', (o) => {
  for (const [x, z, yaw, h] of [[-4 * P, -3 * P, 10, 0.9], [4 * P, -4 * P, 55, 0.75], [0, 4 * P, 95, 1.0], [6 * P, 3 * P, 30, 0.7], [-6 * P, 4 * P, 70, 0.8]]) {
    o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => o.cross('side', -6 * P, 6 * P, 0, h));
  }
});
// lily pads: four flat 1/16 leaves on the water, one with a flower (in the texture)
shape('lily_pad', (o) => {
  for (const [x, z, s, yaw] of [[-5 * P, -3 * P, 9 * P, 20], [4 * P, 2 * P, 11 * P, 70], [-2 * P, 6 * P, 7 * P, 120], [6 * P, -6 * P, 6 * P, 200]]) {
    o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => cbox(o, s, P, s, { py: 'top', ny: 'top', px: null, nx: null, pz: null, nz: null }));
  }
});

mkdirSync(OUT, { recursive: true });
for (const s of shapes) writeFileSync(join(OUT, `${s.name}.obj`), s.text());
console.log(`${shapes.length} decor shapes → ${OUT}`);
