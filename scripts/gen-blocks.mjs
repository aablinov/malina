#!/usr/bin/env node
/**
 * Block shape generator: writes assets/blocks/*.obj.
 *
 * All shapes live in a 1 × 1 × 1 m cube with the origin at the bottom near corner (0,0,0),
 * sizes are multiples of 1/16 — so any blocks fit together.
 * The `usemtl <name>` group is a texture slot, filled by the palette (src/level/palette.ts).
 * UVs are in fractions of a block: a half-block face takes the lower half of the texture, and pixels line up on the grid.
 *
 * The files can also be edited by hand (Blockbench, Blender): only v / vt / vn / usemtl / f are needed.
 *
 *   node scripts/gen-blocks.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Obj } from './obj-writer.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'blocks');
const P = 1 / 16;

const shapes = [];
const shape = (name, build) => { const o = new Obj(name); build(o); shapes.push(o); };

// --- whole blocks and halves ---
shape('cube', (o) => o.box(0, 0, 0, 1, 1, 1, {}));
// a log lying along X: cut ends at ±X
shape('cube_x', (o) => o.box(0, 0, 0, 1, 1, 1, { px: 'top', nx: 'top', py: 'side', ny: 'side' }));
shape('slab', (o) => o.box(0, 0, 0, 1, 0.5, 1, {}));
// stairs: the low part spans the whole block, the high part is at the far +X face
shape('stairs', (o) => {
  o.box(0, 0, 0, 1, 0.5, 1, { py: null }).box(0.5, 0.5, 0, 1, 1, 1, { ny: null });
  o.quad([[0, 0.5, 0], [0, 0.5, 1], [0.5, 0.5, 1], [0.5, 0.5, 0]], [[0, 1], [0, 0], [0.5, 0], [0.5, 1]], 'top', [0, 1, 0]);
});
shape('layer', (o) => o.box(0, 0, 0, 1, 2 * P, 1, {}));
// low cover: 14/16 — cannot be stepped over, but one can shoot over it standing
shape('low', (o) => o.box(0, 0, 0, 1, 14 * P, 1, {}));
// garden bed rail: a thin beam along X at the near edge (z = 0)
shape('rail', (o) => o.box(0, 0, 0, 1, 2.5 * P, 2.25 * P, {}));

// --- 8/16 wall (post + segments towards neighbours) and fence ---
shape('wall_post', (o) => o.box(4 * P, 0, 4 * P, 12 * P, 1, 12 * P, {}));
shape('wall_seg', (o) => o.box(0.5, 0, 5 * P, 1, 14 * P, 11 * P, { nx: null }));
shape('fence_post', (o) => o.box(6 * P, 0, 6 * P, 10 * P, 1, 10 * P, {}));
shape('fence_rail', (o) => o.box(0.5, 6 * P, 7 * P, 1, 9 * P, 9 * P, { nx: null }).box(0.5, 12 * P, 7 * P, 1, 15 * P, 9 * P, { nx: null }));

// --- water: top at 14/16 so the shore reads ---
shape('water', (o) => o.box(0, 0, 0, 1, 14 * P, 1, {}));

// --- plants and fire ---
shape('cross', (o) => o.cross('side'));
shape('fire', (o) => o.cross('side').cross('side', 2 * P, 14 * P, 0, 12 * P));
shape('torch', (o) => o.box(7 * P, 0, 7 * P, 9 * P, 10 * P, 9 * P, 'side'));
shape('torch_flame', (o) => o.cross('side', 5 * P, 11 * P, 9 * P, 15 * P));
// campfire: two logs along X below, two along Z above, ash in the centre
shape('campfire_logs', (o) => {
  o.box(0, 0, 2 * P, 1, 4 * P, 6 * P, { px: 'top', nx: 'top', py: 'side', ny: 'side' });
  o.box(0, 0, 10 * P, 1, 4 * P, 14 * P, { px: 'top', nx: 'top', py: 'side', ny: 'side' });
  o.box(2 * P, 4 * P, 0, 6 * P, 8 * P, 1, { pz: 'top', nz: 'top', py: 'side', ny: 'side', px: 'side', nx: 'side' });
  o.box(10 * P, 4 * P, 0, 14 * P, 8 * P, 1, { pz: 'top', nz: 'top', py: 'side', ny: 'side', px: 'side', nx: 'side' });
  o.box(4 * P, 0, 4 * P, 12 * P, 1 * P, 12 * P, 'bottom');
});
shape('campfire_fire', (o) => o.cross('side', 3 * P, 13 * P, 4 * P, 1));
// fluffy leaves (screenshot 13): a cube and "caps" 2/16 outside each face, 2/16 wider — the crown silhouette puffs up
shape('leaves_fluffy', (o) => {
  o.box(0, 0, 0, 1, 1, 1, 'side');
  const e = 2 * P, a = -2 * P, b = 1 + 2 * P;
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  o.quad([[1 + e, a, a], [1 + e, a, b], [1 + e, b, b], [1 + e, b, a]], uv, 'puff', [1, 0, 0]);
  o.quad([[-e, a, b], [-e, a, a], [-e, b, a], [-e, b, b]], uv, 'puff', [-1, 0, 0]);
  o.quad([[b, a, 1 + e], [a, a, 1 + e], [a, b, 1 + e], [b, b, 1 + e]], uv, 'puff', [0, 0, 1]);
  o.quad([[a, a, -e], [b, a, -e], [b, b, -e], [a, b, -e]], uv, 'puff', [0, 0, -1]);
  o.quad([[a, 1 + e, a], [a, 1 + e, b], [b, 1 + e, b], [b, 1 + e, a]], uv, 'puff', [0, 1, 0]);
});
// crystals ("jungle" biome, reference 16): a prism is a bar and a narrow tip on top (a "hexagon" of two boxes),
// tilted around its base; three prisms 4–10/16 of different height and tilt, the small one is single and walkable
const prism = (o, cx, cz, w, h, yaw, tilt) => o.xf({ rot: [tilt, yaw, 0], pivot: [cx, 0, cz] }, () => {
  o.box(cx - w / 2, 0, cz - w / 2, cx + w / 2, h * 0.62, cz + w / 2, { py: null });
  o.box(cx - w / 4, h * 0.62, cz - w / 4, cx + w / 4, h, cz + w / 4, { ny: null });
});
shape('crystal', (o) => {
  prism(o, 7 * P, 8 * P, 6 * P, 15 * P, 20, 10);
  prism(o, 11 * P, 5 * P, 4 * P, 10 * P, 70, -14);
  prism(o, 5 * P, 12 * P, 4 * P, 8 * P, 130, 12);
});
shape('crystal_small', (o) => prism(o, 8 * P, 8 * P, 4 * P, 9 * P, 35, 9));
// bridge post: a 12/16 beam full height, end faces top and bottom
shape('post', (o) => o.box(2 * P, 0, 2 * P, 14 * P, 1, 14 * P, {}));
// a crate slightly smaller than a block so gaps read in a stack
shape('crate', (o) => o.box(0.5 * P, 0, 0.5 * P, 15.5 * P, 15 * P, 15.5 * P, {}));


// --- house ---
// window: 2/16 thick glass in the middle of the cell, along X (in a wall along Z — rotation 1)
shape('pane', (o) => o.box(0, 0, 7 * P, 1, 1, 9 * P, {}));
// carpet: 1/16
shape('carpet', (o) => o.box(0, 0, 0, 1, P, 1, {}));

// --- furniture: "faces" +X (back at −X), rotation turns it ---
const legs = (o, h, inset, t, g = 'side') => {
  for (const [x, z] of [[inset, inset], [1 - inset - t, inset], [inset, 1 - inset - t], [1 - inset - t, 1 - inset - t]]) o.box(x, 0, z, x + t, h, z + t, g);
};
// table: a 2/16 top at height 11–13/16, 2/16 legs
shape('table', (o) => { o.box(0, 11 * P, 0, 1, 13 * P, 1, {}); legs(o, 11 * P, P, 2 * P); });
// chair: seat at 7–9/16, back at −X up to the top of the cell
shape('chair', (o) => {
  o.box(2 * P, 7 * P, 2 * P, 14 * P, 9 * P, 14 * P, {});
  legs(o, 7 * P, 2 * P, 2 * P);
  o.box(2 * P, 9 * P, 2 * P, 4 * P, 1, 14 * P, 'side');
});
// sofa: 7/16 base, back at −X, no armrests needed — sections join in a row
shape('sofa', (o) => { o.box(0, P, 0, 1, 7 * P, 1, {}); o.box(0, 7 * P, 0, 4 * P, 14 * P, 1, {}); legs(o, P, P, 2 * P, 'bottom'); });
// bed: foot end — a 9/16 mattress; head end — mattress, pillow and headboard at −X
shape('bed', (o) => o.box(0, 0, 0, 1, 9 * P, 1, {}));
shape('bed_head', (o) => {
  o.box(2 * P, 0, 0, 1, 9 * P, 1, {});
  o.box(3 * P, 9 * P, 2 * P, 9 * P, 11 * P, 14 * P, 'pillow');
  o.box(0, 0, 0, 2 * P, 14 * P, 1, 'wood');
});
// floor lamp: base, pole and shade
shape('lamp', (o) => {
  o.box(5 * P, 0, 5 * P, 11 * P, P, 11 * P, 'pole');
  o.box(7.5 * P, P, 7.5 * P, 8.5 * P, 11 * P, 8.5 * P, 'pole');
  o.box(4 * P, 11 * P, 4 * P, 12 * P, 16 * P, 12 * P, { px: 'shade', nx: 'shade', pz: 'shade', nz: 'shade', py: null, ny: 'shade' });
});

mkdirSync(OUT, { recursive: true });
for (const s of shapes) writeFileSync(join(OUT, `${s.name}.obj`), s.text());
console.log(`${shapes.length} shapes → ${OUT}`);
