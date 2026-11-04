# Source: light and decor of Minecraft Dungeons (4 screenshots)

Added 2026-10-23. Screenshots of the game on Unreal Engine 4 (Polish localisation, the mission "W mroczną otchłań"), camera — isometric from above at an angle, day. Files — `mcd-lighting/`. The source is not edited; conclusions — in [../style-lighting.md](../style-lighting.md) and [../design-level-decor.md](../design-level-decor.md).

| | |
|---|---|
| ![Village by the road](mcd-lighting/mcd-01-village.webp) | ![Grass terraces](mcd-lighting/mcd-02-terraces.webp) |
| **1. Village by the road.** | **2. Grass terraces.** |
| ![Ruins with crates](mcd-lighting/mcd-03-ruins.webp) | ![River and pier](mcd-lighting/mcd-04-river.webp) |
| **3. Ruins with crates and a torch.** | **4. River, tree, pier.** |

## What is visible

**Light**
- The sun is warm, shines low and from the side (top left): the shadows are long, soft at the edge, fall to the right and down (1, 3).
- Shadows are not black: they have the bluish-green tint of the sky, details in shadow read (1, 2, 4).
- Shading in crevices and at bases: where a wall meets the ground, under crates, under the lip of ledges (1, 3) — looks like SSAO.
- A torch on dark stone gives a warm spot and an orange glow on neighbouring blocks (3).
- Light things (white flowers, water, the fluff of wool) glow softly — bloom (1, 4).

**Camera and "film"**
- **Tilt-shift:** the top of the frame and often the bottom edge are noticeably blurred, the sharp band — around the hero (1, 2, 4: the pig, the field, the trees at the top — out of focus). This is the main recognisable technique: the world looks like a toy diorama.
- Haze: the far part (the top of the frame) is lighter and slightly bluer, the contrast is lower (2, 4).
- The colour is saturated but soft: the grass is yellow-green, shadows are cooler, lit parts warmer — split toning. No black or white pits (filmic tonemapping).

**Ground and grass** (analysed 2026-10-23, details — [../style-terrain.md](../style-terrain.md))
- Grass — an almost flat pastel fill (brightness spread ±5–8), large soft blotches, no repetition visible from afar.
- The path — a warm beige with light round footprints; the side of the earth — a flat brown; shadows are light.

**Decor — not blocks**
- A stone fence with a ragged "staircase" top, wooden fence spans between posts, crates with red flowers, a lantern on a curved post (1, 4) — separate models "out of little cubes", standing off the grid.
- Stacks of crates and a chest stand slightly askew (3); an urn pot, a crate — off the grid.
- **Grass fringe:** along the edge of every ledge a jagged strip of grass hangs down (2, 3) — separate geometry over the blocks, it breaks the hard edge of the cube.
- Patches of flowers, tall grass and tufts — in a dense scatter, small, not one per cell (1, 2).
- A blue "mossy" block with vines (2), a pier of boards on posts over the water (4), a tree with a crown of foliage cubes of different sizes (4).

## What we take

| Technique | Where | Status |
|---|---|---|
| Warm low sun, blue shadows, ACES | `src/lighting.ts` | done 2026-10-23 |
| AO in crevices (GTAO without grass and leaves) | `src/lighting.ts` | done |
| Tilt-shift: blur of the top and bottom, a sharp band at the hero | `src/lighting.ts` | done, then removed 2026-10-23 — expensive in frames |
| Haze in the distance, split toning, +saturation | `src/lighting.ts` | done |
| Free-standing decor: columns, fences, lanterns, crates with flowers, askew crates | `src/level/decor.ts` | done (16 items) |
| Grass fringe along ledge edges | mesher: `fringe` on grass, the `detail` layer | done 2026-10-23 |
| A dense scatter of small grass and flowers | mesher: `tufts` on grass, in blotches by noise | done 2026-10-23 |
| Pastel ground without noise, colour blotches across the world, light shadows | `textures.ts`, `macroTint`, `lighting.ts` | done 2026-10-23 |
