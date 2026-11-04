# World: block, decor and kit sets after Minecraft Dungeons

Version 1.4 of 2026-10-29. Source — [sources/mcd-world.md](sources/mcd-world.md) (screenshots 9–15). Palette and techniques — [style-terrain.md](style-terrain.md), light — [style-lighting.md](style-lighting.md), decor as a mechanism — [design-level-decor.md](design-level-decor.md).

Each theme — 3–4 combinable elements in the same pastel palette and at the same density of 16 px/m, plus kits in `src/level/kit.ts` ("put it at this point", deterministic from the coordinates). All together — the **"world"** zone of the playground beyond the eastern wall (an opening at z −1…1, `src/level/world-zone.ts`); these categories are not part of the showcase.

## 1. Yard with a storage yard (screenshot 10)

| Element | What | Where |
|---|---|---|
| Yard floor | `yard_floor` (+ stairs, half-block): `#c39552`, strokes `#a7794a` in a "herringbone". Ledges — with a half-block | palette "yard" |
| Fence stone | `wall_stone` (+ stairs, half-block, wall): large rounded stones barely visible, `#a1a8b0` | palette "yard" |
| Hay | `hay`: yellow `#cda652`, two bindings `#c25a26`, a light border on top | palette "wood" |
| Storage | decor: `crate_banded`, `crates_banded_stack`, `crate_small`, `chest` (gold trim), `cart`, `cart_loaded`, `bench` | decor "storage" |
| Lanterns | `lantern_post_double`, `lantern_wall` (on a wall), `lantern_short` — the glass in the `glow` layer, real light | decor "lanterns" |
| Kits | `steppedWall` — a fence, the height wanders by blocks, half-blocks on top; `floorRect`; `hayStack` — a stack by a row mask | `kit.ts` |

## 2. River with a waterfall and a bridge (screenshot 11)

| Element | What | Where |
|---|---|---|
| Waterfall | `waterfall`: its own layer `falls`, a texture of streams `#1f88ab` runs downward (`fallsTex.offset.y = t·1.6`) | palette "cliffs and water" |
| River | `river`: its own layer `river`, water darker than the pond (`#356577`), the block's rotation — the direction of flow (`flow`, m/s). In the shader the glints, caustics and light strokes are carried by the current; the shore foam is weaker (a narrow channel) | palette |
| Bridge | `bridge_deck` (boards `#c49458`, rotation sets the direction), `bridge_beam` (a beam lying down), `bridge_post` (a post 12/16, 1.5 m for collisions) | palette |
| Splashes and foam | decor `waterfall_splash`, `waterfall_foam`, `foam_patch` (flat patches on the water) | decor "water" |
| Kits | `riverBed` (a channel a block and a half below the grass, sand under the water), `waterfall`, `bridgeX` (deck, beams, posts), `cliffSteps` (cliffs stepping down to the water) | `kit.ts` |

## 3. Level edges (screenshot 12)

| Element | What | Where |
|---|---|---|
| Cliff | `cliff` (+ stairs, half-block): light `#9aa2ab`, vertical strata | palette "cliffs and water" |
| Dark cliff | `cliff_dark` `#7b8996` — in whole columns, the strata read | palette |
| Cliff with grass | `cliff_grass`: a grass top with fringe and tufts, the side — cliff with a strip of grass | palette |
| Kits | `cliffMass` — a massif, height by noise, light/dark columns, grass on top; `stairway` — a staircase of stairs of any stone | `kit.ts` |

Rule: tall cliffs — on the far sides (−X, −Z), on the camera side — 1–2 blocks.

## 4. Hills and candles (screenshot 13)

| Element | What | Where |
|---|---|---|
| Grass half-block | `grass_slab` — soft ledges; fringe, tufts and the ragged edge are computed from the half-block's height (`topOf` in the mesher) | palette "hills" |
| Fluffy foliage | `leaves_fluffy`: a cube with clusters of leaves (`leavesClump`) and "caps" 2/16 outside the faces (`leavesPuff`) — the crown silhouette fluffs up. Tones: `#4c6e2a` / `#6a8c37` / `#90b04e` / `#a8c860` | palette |
| Candles | decor `candles_group`, `candles_row`, `candle_tall` — **light is baked**: no PointLight, a warm colour is added to the vertex emission of blocks within 2–3 m (attribute `bake`) — shines at night too, the frame costs no more | decor "candles" |
| Kits | `landscape` / `hill` — walkable terrain; `rockOutcrop` — a cliff; `tree` — a trunk and an ellipsoid crown of fluffy foliage; `rampart` — a wall with merlons every 3 blocks, between them — room for candles (details — the section "Relief: terrain and cliffs") | `kit.ts` |

## 5. Portal (screenshot 14)

| Element | What | Where |
|---|---|---|
| Glow | `portal`: a thin slab, layer `portal` (its own material: self-lit, brighter than 1 — bloom; light bands run from bottom to top, the edges shimmer), baked golden light `#ffc248` over 4.5 m | palette "portal" |
| Frame | `portal_frame` — dark stone `#4c5155` with a chamfer and a calm square pattern | palette |
| Lintel | `portal_trim` — the same stone with a golden meander `#d9a640` | palette |
| Floor | `portal_floor` — light warm slabs `#b3a693`, natural — grass comes in with a ragged edge | palette |
| Kit | `portal(x, y, z, w, h)` — an opening in a cliff facing +Z: frame, lintel, the glow one block deep, turf on top, in front of it a floor of slabs and a passage cut down to the ground (nothing blocks the exit) | `kit.ts` |

## 6. Variety of hills (screenshot 15)

| Element | What | Where |
|---|---|---|
| Path stairs | `path_stairs`, `path_slab` — earthen stairs on slopes | palette "hills" |
| Dry grass | `dry_grass` — tall light-yellow stalks `#cdb862` | palette |
| Daisies | `daisies` — low white flowers with a yellow centre | palette |
| Hill with a drop | `hill(..., { stone: 'x+' })` — one side made of cliff with grass | `kit.ts` |

In the zone: terrain across the whole zone and cliffs (see "Relief: terrain and cliffs").

## Relief: terrain and cliffs (screenshots 13–17)

Relief is **two different entities**. They must not be confused: the first version (little pyramids) and the second (block-high slabs with staircases) tried to make one out of the other — replaced on 2026-10-24.

| Entity | What it is | Walkability |
|---|---|---|
| **Terrain** — `landscape`, `hill` | the hilly ground of the whole map: huge slabs in 3–4 layers, **a layer is 0.5 m** (a full grass block or a grass half-block on top) | **everywhere and from any side**: neighbouring cells differ by no more than a layer, the hero's step is 0.5 m — no staircases or ramps needed, mobs stand on any level |
| **Cliff** — `rockOutcrop`, `cliffMass` | a stone massif with a winding outline, sheer sides of light and dark strata and grass on top | **impassable** — by design; things with a single entrance (a portal, a cave) are built into it, earthen stairs (`stairway`) can be put on a low one |

**How terrain is built** (`src/level/kit.ts`):
1. A height map — large-scale noise (scale 24–32 cells) with coordinate distortion: winding outlines like a coastline, without rectangles.
2. An S-curve: wide flat plateaus, the elevation changes gathered into short slopes.
3. Toward flat places (road, yard, channel — `flat`) the height falls off smoothly along a distance field over `fade` cells.
4. Smoothing `settle`: each level separately — the majority in a 5 × 5 window, then 3 × 3, then small regions under 14 cells are filled in — the outlines are smooth, without notches or pits.
5. Walkability: a column higher than a neighbour by more than a layer — is lowered until it is not.
6. Construction: n layers = n/2 full blocks and a grass half-block on top if n is odd. In "stony" places (`stone`, a share of the area by noise) the sides of the layers are cliff, the top is grass: the terrain blends with stone at the edges.

**In the editor** (Tab to the "Terrain" mode): sliders — size along X and Z (6–64 m), layers of 0.5 m (1–10), slab coarseness, stone share; LMB on the ground — place a piece (the edges fall off to the ground, rising toward the middle); the piece's **ground** — grass or snow (buttons in the tool, `GROUNDS` in `kit.ts`: top, half-block, side, cliff with that top; the `ground` field in `meta.lands`, old pieces without the field — grass). A piece is an **object**: the map (`meta.lands`) holds its centre, parameters and changed cells (what was and what became), so it can be selected even after saving. LMB on a piece — select (a green frame, the sliders show its parameters), Shift+LMB — a new piece on top. The sliders and "Random" (a new noise seed: different bends of edges and corners) rebuild the selected piece in place, the arrows move it, Del removes it — the cells go back to what they were before it; blocks placed on top of the piece by hand are not touched by a rebuild. Consecutive edits of one piece — one undo entry.

In the "world" zone: terrain in 4 layers (up to 2 m) across the whole zone, cliffs along the edges (two in the south, one by the road with stairs up), the portal — in the cliff north of the road facing it, the exit straight onto the road. The "world" test leads the hero onto the highest slab without staircases.

## Calibration (on screen, lit, median)

| What | Screenshot | Ours |
|---|---|---|
| Yard floor | `#c59b5c` | `#c29b53` |
| Top of the stone fence | `#83868e` | `#909290` |
| Bridge deck | `#b68c58` | `#bb955b` |
| River | `#44687a` | between `#25576f` and `#44869b` — the colour `#356577` was chosen as the middle of two measurements |
| Portal floor | `#af9f8e` | `#d0ba9c` — lighter: the baked golden light falls on it, as in the screenshot |

## How to combine

- First the ground and cliffs (`cliffMass`, `hill`), then what is cut into them (`riverBed`, `portal`, staircases), then decor.
- Light decor: lanterns — real light (the 8 nearest), candles and the portal — baked, they can be placed in any number.
- A new surface — in the same palette: `softFill`, blotches, not pixel noise ([style-terrain.md](style-terrain.md)).
