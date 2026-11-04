# Free decor on top of blocks

Version 1.4 of 2026-10-24. Builds on [design-level-blocks.md](design-level-blocks.md) (grid, palette, rendering) and [style-guide.md](style-guide.md).

## 1. Decision

In Minecraft Dungeons the world is not made of "honest" blocks: the level's skeleton is a 1 m grid, while columns, roots, chains, banners and lanterns are separate meshes **made to look as if they were built from blocks**, and they stand anywhere and at any angle. The illusion is held by a single rule — **uniform pixel density**: 16 per metre for everything, plus a shared palette and chunky shapes.

We do the same:

- **What you walk on is blocks.** Floor, walls, stairs, cover: the voxel grid, pathfinding and height-aware collisions.
- **Decor lies, hangs, stands and blocks the way, but you cannot stand on it.** Position with a 1/16 step, any yaw, pitch and roll.
- **No scaling.** Decor UVs are in metres; scaling would break 16 px/m. Variety comes from separate shapes.
- **Decor has no logic.** Anything that breaks, burns or opens is a prop (`src/props.ts`) or an entity (`entities`).

## 2. Format in the map JSON

An optional `decor` field (old maps do not have it, `version` stays 1):

```json
"decor": [
  { "name": "column_fallen", "pos": [13, 0, -20], "rot": [25] },
  { "name": "torch_wall", "pos": [-7, 1.4, 48.5], "on": [-7, 1, 48] }
]
```

| Field | What it is |
|---|---|
| `name` | a name from the registry `src/level/decor.ts` — **never renamed**, only added |
| `pos` | the anchor point in metres, world coordinates (x, z as for cell centres) |
| `rot` | `[yaw, pitch, roll]` in degrees, YXZ order; yaw as for blocks — 90° maps +X to +Z; the tail may be omitted |
| `on` | the cell the item is attached to: erase it in the editor — the item is removed in the same undo step |

In code: `Level.decor`, `addDecor` / `removeDecor` / `touchDecor()`, the `decorVersion` counter (rendering and collisions are rebuilt from it).

## 3. Registry and shapes

`src/level/decor.ts` — like the palette: `name`, `title`, `category`, `parts` (shape + textures in slots + layer), `anchor`, `solid?`, `light?`.

| Anchor | Shape origin |
|---|---|
| `floor` | centre of the bottom, grows upward |
| `wall` | a point on the wall; the item has its back to the plane z = 0 and protrudes toward +Z |
| `ceiling` | a point on the ceiling, hangs downward |

Shapes — `assets/decor/*.obj` from `scripts/gen-decor.mjs` (`npm run decor`); can also be made by hand in Blockbench. The shared OBJ writer is `scripts/obj-writer.mjs` (the block generator uses it too):

- `tbox` — a box of any size, faces are cut along the cell grid (on half-integers along X and Z, on integers along Y) — on a 3 m column every tile takes its own texture tile, the texture is not stretched (the atlas cannot repeat);
- `xf` — rotate and offset a part; UVs are computed before rotation, pixel density stays the same.

Layers — as for blocks (`opaque`, `cutout`, `fire`) plus the new **`glow`**: self-lit, no lighting, brighter than 1 — picked up by bloom (mushrooms, lantern glass).

**World (2026-10-24, [style-world.md](style-world.md)):** storage yard (striped crates, a stack, a small crate, chest, cart, loaded cart, bench), lanterns (double, wall-mounted, low), water (splashes, foam by stones, foam on water), candles (a bunch, in a row, tall — the light is baked). Not in the showcase — they are in the "world" zone.

**First set (16):** a fallen column, a column stump, rubble, loose bricks, bones and a skull; chain (ceiling), roots, cobweb, banner (wall); wall torch, candles, glowing mushrooms, a lantern on a post (light); mushrooms, a flower crate, a stack of crates (yard). New textures: `chain`, `cobweb`, `banner` (raspberry-coloured, with a berry), `bone`, `candle`, `mushroomRed`, `mushroomGlow`, `mushroomStem`, `lanternGlass`, `roots`.

## 4. Rendering

`src/level/decor-render.ts`; `DecorRenderer` lives inside `LevelRenderer` (`view.decor`), so decor exists wherever a level exists — in the playground and in the editor.

- One `InstancedMesh` per "item × layer" pair; materials and the atlas are shared with blocks, so x-ray, cutaway, shadows and bloom work the same way (x-ray takes `instanceMatrix` into account).
- Decor gets no AO from neighbours: the bottom of floor items is darkened when the shape loads (like a block corner); instance brightness wanders by 10 %.
- Decor lights go into the shared pool of the 8 nearest `PointLight`s.
- `maxY` (the editor slice) cuts off items above the slice. A decor change is a full rebuild of the instances (hundreds of them — cheap); geometries are cached.

## 5. Collisions

Decor is not a floor: you cannot stand on it, it only blocks the way. An item in the registry has `solid`, a list of boxes in local coordinates (`w × d × h`, offset `x, z`).

- `decorSolids(level)` (`src/level/collide.ts`) turns them into flat `Obstacle`s: the box is rotated by the item's yaw (pitch and roll are ignored — a collider for a tilted shape is drawn by hand), the bottom is at the anchor point height. Cached by `decorVersion`.
- `Obstacle` gained an optional **`y0`** — the obstacle's bottom. `overlapsY` skips an obstacle if the body (feet … feet + 1.6 m) does not touch it; bullets hit against `[y0; y0 + h)`. Barrels and crates have no `y0` — for them everything is as before.
- **Hero:** `hero.update(…, solids(), terrain)`, where `solids()` is the storage-yard items plus decor (rebuilt when either changes).
- **Pathfinding:** the same `solids`; a node is occupied if an obstacle touches the body at the node's floor height (previously — only for a floor below 1 m).
- **Enemies and bullets:** decor is appended to `obstacles` (`obstaclesOf` + `decorSolids`); cover and mob paths take it from there (`Pathfinder`; ~~`NavGrid`~~ removed 2026-11-04).
- **A sword strike** passes through decor: `terrain.blocked` looks only at blocks — a column must not hide the training dummy from the blade.
- **F2** draws decor colliders together with the other obstacles.

With colliders: fallen column, column stump, lantern on a post, flower crate, stack of crates. Rubble, bricks, bones, mushrooms, candles — passable.

## 6. Editor

The editor window and the "Selection" mode (pick by click, rotation on three gizmo axes, details) — [design-editor.md](design-editor.md); below is the "Decor" brush mode. ~~**Tab** (or the "Mode" button) switches the editor between blocks and decor.~~ **Tab** cycles the modes (selection → blocks → decor → terrain); decor can also be dragged from the "Prefabs" panel. In decor mode there is its own palette by category with previews: each item is drawn once by a separate small renderer.

| Action | How |
|---|---|
| Place | LMB. Under the cursor is a translucent "ghost". Where it can go is decided by the item's anchor (`placeDecor`, `src/level/decor-place.ts`): `floor` — onto a block top (for half-blocks and stairs — at their height) or onto the plane y = 0 in empty space; `wall` — onto a side face, the item turns its back to the wall by itself; `ceiling` — onto a block's underside. The point — with a 1/16 step, the face plane — exact |
| Rotate | R / Shift+R — yaw ±15°, T — pitch, Y — roll. With nothing selected the ghost rotates; with a selection — the selected item (as a single edit) |
| Random rotation | Z — for rubble, bones, mushrooms: after every placement a new yaw, a multiple of 15° |
| Select and drag | LMB on an item (a ray against `InstancedMesh` instances), drag with the mouse; rotation is kept, a wall item takes its yaw from the new wall |
| Remove | Shift+LMB on an item or Del / X |
| Pick, copy | Q — pick the item under the cursor together with its rotation; Ctrl+D — a copy of the selection offset by half a metre |

Undo and redo are shared with blocks: an edit is either a cell or a snapshot of the item before and after (`before` / `after`, `null` — no item). **Erase a cell — the items attached to it** (`on`) are removed in the same undo step. The height slice (PgUp / PgDn) hides decor too. The decor counter is in the status bar.

## 7. Rooms and the floor

- **The template "dresser"** (`dressRoom` in `src/level/rooms.ts`): decor deterministically from the cells, **passable only** — the template's paths and cover do not change. On the tall far walls (−Z, −X) — banners every 6 cells (except the storage room), roots, a cobweb in the corner; on the floor by the walls — rubble, bricks, bones (≈ 7 % of cells by a wall, not by doors); by the altar and the boss's throne — candles, by burrows — glowing mushrooms. `npm run map:rooms` writes the decor into `assets/maps/rooms/*.json` — the room blocks do not change, editing in the editor is saved as usual.
- **Floor** (`buildFloor`, `src/level/dungeon.ts`): a room's decor moves with it — `pos` and the attachment cell `on` are shifted by `x0, z0`, like entities.
- To see it: `?map=dungeon&seed=42&floor=2` (the playground assembles the floor itself) or "Floor…" in the editor.

The "dungeon floor" test: all decor is inside rooms, no attachment hangs in mid-air.

## 8. Playground

The showcase behind the south wall was extended: row 5 — a brick wall with wall decor (roots, cobweb, banners, torches), a canopy with chains and, in front of it, all floor items with captions. In the arena itself: banners between torches on the far walls, roots and a wall torch on the west wall, a cobweb in the corner, a fallen column, a stump, rubble and bones, lanterns by the pond and in the corner, glowing mushrooms, flower crates by the south wall, a stack of crates, candles on the 2 m platform.
