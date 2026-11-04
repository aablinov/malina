# Preset library: ready-made pieces of the world for building levels

Version 1.6 of 2026-10-29. Source — [sources/refs-settlements.md](sources/refs-settlements.md) (17 screenshots from Elden Ring and Minecraft Dungeons). Blocks and decor as a mechanism — [design-level-blocks.md](design-level-blocks.md), [design-level-decor.md](design-level-decor.md); the editor — [design-editor.md](design-editor.md) (section 6); world sets after MCD — [style-world.md](style-world.md); colour range — [style-terrain.md](style-terrain.md).

## 1. Why

Levels are open hilly lands with small settlements along the way. In the engine the world is stored as blocks, but **assembling a level block by block is not an option** — far too slow. We assemble from **presets**: ready-made pieces (blocks + decor + light) that are placed in the editor with a click, rotated and combined. A square world comes alive through **small details** — stumps, stones, pots, barrels, candles, bones, flowers — so every preset carries its own decor; there are no bare boxes in the library.

The `kit.ts` kits remain ("put a hill at this point" — procedural, in place); the library is **baked** presets: generated once by code, stored in the repository as JSON, identical on any map.

## 2. Format and where it lives

| What | Where |
|---|---|
| Type | `LibraryPrefab` (`src/level/prefab-lib/types.ts`): `id`, `title`, `category`, `hint`, `size: [w, h, d]`, `seed`, `cells: [dx, dy, dz, block, rotation][]`, `decor: DecorItem[]`, `entities: LevelEntity[]` — everything relative to the **anchor cell** (bottom, centre) |
| Builders | `src/level/prefab-lib/builders.ts`: `Builder { id, title, category, hint, build(c) }`; `c.L` — a local `Level` anchored at (0, 0, 0), `c.dec(name, x, y, z, rot?, on?)` — decor, `c.light(kind, x, y, z, data?)` — light, `c.rnd()` — deterministic randomness from `seed`; the `kit.ts` kits are called with this same `L` |
| Baking | `bake(builder, seed)` (`src/level/prefab-lib/build.ts`) → `LibraryPrefab`; `npm run prefabs` (`scripts/gen-prefabs.ts`) writes `assets/prefabs/<id>.json` and the showcase `assets/maps/prefabs.json` |
| In the build | `src/level/prefab-lib/index.ts`: `LIBRARY` — all JSON via `import.meta.glob`, `LIBRARY_CATEGORIES` |
| Placement | `stampPrefab(L, p, x, y, z, quarter)` (`src/level/prefab-lib/stamp.ts`): cells via `L.set` (in the editor — a single edit in undo), returns the decor and light with the offset applied; **rotation** `quarter` 0–3: cells `(dx, dz) → (−dz, dx)`, rotatable blocks get `rot + 1`, decor gets yaw + 90° (yaw is the outer rotation, `YXZ`; pitch and roll are preserved), lights get `rot + 90` |
| In the editor | the **"Library"** tab of the prefab panel (sections are the catalogue categories), preview, "Place" mode: **R** — rotate by 90°, LMB — place. Your own prefab from a selection → RMB → **"Save to library (JSON)"** — downloads in the same format, goes into `assets/prefabs/` |
| Showcase | `?map=prefabs` — all presets in a grid, one row per category, caption on the floor (`src/level/prefabs-map.ts`); for reviewing "does it look like the reference" and for the test |
| Test | `tests/prefabs.spec.ts`: the showcase loads without errors, the number of presets = the number of JSON files, each has decor, rotation loses no cells, placement in the editor with rotation and undo |

Shared builders in `builders.ts`, `builders-ruins.ts` and `builders-settlement.ts`: `goldenTree`, `pineTree` (trees for presets and the grove), `flagRoad` / `dirtRoad` (a road 3 wide along the centre line, ragged shoulder), `inBlob` (an ellipse with a ragged edge for the pond); ruins — `pillar` (a post with a ragged top, mossy and cracked brick near the ground), `wallRun` (a wall with wandering height), `arch`, `ruinFloor` (slabs with holes and grass), `onWall(name, x, y, z, face)` — wall decor on a cell face with the correct yaw and `on` anchor; settlement — `walls(x0, z0, x1, z1, h, block, door, windows)`, `gableX` (ridge along X: stairs on the slopes, a half-block on the ridge), `hipRoof` (rings of stairs outward), `fenceRun` (a fence with gaps); compositions — `use(c, id, x, z, quarter, seed?)` nests a medium preset by builder id, `dirtRoadX`, `sprinkle` (small things only on free cells), `grassBits` (tufts on grass).

Rules:
- **Anchor** — bottom-centre: `y` is the first layer of air above the ground at the click point; cells with `dy < 0` cut into the ground (riverbed, foundation).
- **Variants** — one builder, several `seed`s (`variants` on the builder): the village does not look copy-pasted. Files `<id>.json`, `<id>_2.json`, …
- **Scale:** small (≤ 3 m, a detail), medium (4–10 m, a building), large (10–24 m, a composition). Large ones are assembled from medium builders — no code duplication.
- **Liveliness:** per 8 × 8 m of preset — 4–6 small items; every building — at least a barrel / crate / lantern by the entrance; every ruin — rubble, pots, grass in the seams.
- A new surface — in the range of [style-terrain.md](style-terrain.md): `softFill`, patches, not noise.

## 3. Catalogue

Bold — what exists; the rest is the plan by batch (section 4). Sizes in cells (width × depth, height where it matters).

### A. Roads and ground (screenshots 1, 4, 5)
| Preset | Size | What is inside |
|---|---|---|
| **`road_flagstone_straight`** | 3 × 8 | stone slabs (`tiles`, `tiles_broken`) with fallen-out slabs → dirt / grass in the holes, scattered slabs on the shoulder; variants: intact / broken / overgrown (grass and tufts in the holes) |
| **`road_flagstone_turn`**, **`_cross`**, **`_end`** | 8 × 8 | turn, crossroads, road ending in grass |
| **`road_dirt_straight`** / **`_turn`** | 3 × 8 | dirt path (`path`) with trampled grass, scattered stones along the edge |
| **`road_stairs`** | 3 × 3 | three `tiles_stairs` steps toward +X (the `stairway` kit), rubble and bricks at the sides |
| **`meadow_flowers`** | 8 × 8 | meadow (screenshot 5): flowers in patches of 3–4 m (white, red, blue), daisies, dry and tall grass; variant 2 — orange (`flower_orange`) |
| **`meadow_dry`** | 8 × 8 | dry grass, scattered stones, tufts |
| **`pond_small`** | 6 × 6 | pond: water in an ellipse with a ragged edge, sand on the bottom and along the shore, `reeds`, foam, stones |
| **`stream_ford`** | 4 × 12 | a 2 × 12 riverbed with a sandy bottom and banks, a cobblestone ford in the middle, reeds, stones, foam |

### B. Trees and vegetation (screenshots 2, 3, 8, 11)
| Preset | Size | What is inside |
|---|---|---|
| **`tree_oak`** | 5 × 5 | oak: trunk, lush crown, mushrooms and stones at the roots |
| **`tree_golden_small`** / **`_big`** | 3 × 3 / 5 × 5 | golden larch — the `leaves_gold` block (yellow and orange tone by cell hash), a cone-shaped crown of layers, `leaf_litter` and stones at the roots |
| **`tree_dead`** | 3 × 3 | bare tree (decor `tree_dead` — a 2.3 m trunk and four branches), dry grass, stones, sometimes bones |
| **`tree_pine_dark`** | 3 × 3 | dark spruce (screenshot 11): tiers of cutout `leaves` in a cone, mushrooms and fern at the trunk |
| **`bush_cluster`** | 2 × 2 | `berry_bush` / `leaves` bushes with flowers around |
| **`grove_golden`** | 12 × 12 | grove: 4 larches (two big), two stumps, bushes, `leaf_litter` on the ground, stones, tufts of dry grass |
| **`stump_logs`** | 2 × 2 | stump (decor `stump`) + two `log_x` logs + mushrooms and fern |
| **`boulder_single`** / **`_group`** | 1 × 1 / 3 × 3 | boulders of `cliff`, `cliff_slab`, `cliff_stairs` with grass and fern in the cracks, pebbles nearby |

### C. Ruins (screenshots 1, 3, 4, 8, 9, 10)
| Preset | Size | What is inside |
|---|---|---|
| **`ruin_arch`** | 3 × 1 × 4 | an arch of `bricks_old`: posts, lintel, springer made of stairs, crenellations of half-blocks; ivy, rubble |
| **`ruin_arcade`** | 12 × 2 × 4 | a row of 3–4 arches (aqueduct, screenshot 4), partly collapsed, rubble beneath |
| **`ruin_wall_window`** | 5 × 1 × 3 | a wall fragment with wandering height and an arched window, `ivy`, pots and bricks at the foot |
| **`ruin_corner`** | 4 × 4 × 3 | a wall corner with a broken-off top |
| **`ruin_column_row`** | 3 × 8 | columns intact / broken (`column_stump`, `column_fallen`) |
| **`ruin_chapel`** | 9 × 7, tower 8 | chapel (screenshots 8–10): a roofless nave with windows and an entrance from −X, a 3 × 3 bell tower with arched windows; variant 1 — tower intact, a golden tree inside; variant 2 — tower collapsed, an altar with candles inside; around it rubble, pots, bones, ivy |
| **`ruin_tower_round`** | 5 × 5 × 8 | a round ruined tower (screenshot 8) |
| **`ruin_platform_statues`** | 8 × 6 | a slab platform one block up with stairs from −X, two `statue_hooded` statues on the far edge, a bowl in the middle |
| **`ruin_altar`** (site of grace) | 3 × 3 | an altar or "site of grace": slab, candles, golden baked light (like candles) |
| **`graveyard_small`** | 6 × 6 | gravestones of three shapes (`gravestone`, `gravestone_wide`, `gravestone_fallen`), `grave_cross` crosses, a dead tree, candles by a grave, bones |
| **`ruin_bowls`** | 2 × 2 | a `stone_bowl`, `pot_clay` pots, bricks by a fragment of masonry |

### D. Settlement (screenshots 6, 7, 11, 12, 14, 15)
| Preset | Size | What is inside |
|---|---|---|
| **`windmill`** | 5 × 5 × 9 | tower: cobblestone base, dark-plank top, hip roof; **sails** — decor `windmill_sails` on the +Z wall (latticed, 4 blades of 4.2 m, static — rotation not done yet); sacks, barrel, cart, lantern by the door; variant 2 — `windmill_sails_broken` |
| **`house_wood_small`** | 5 × 4 × 4 | a wooden shed (`planks_dark`, `roof_dark_stairs`), awning, barrel, crate, lantern on the wall |
| **`house_wood_big`** | 7 × 6 × 6 | a two-storey house with an external staircase, balcony, firewood |
| **`house_stone`** | 6 × 5 × 5 | a stone house with a wooden roof, chimney, window, flower box (`planter`) |
| **`house_straw_hut`** | 4 × 4 × 3 | a straw hut (screenshot 11): `log` walls, a hip roof of `roof_thatch_stairs` with hay inside; a campfire, sack and pots by the entrance |
| **`house_ruined`** | 6 × 5 | a roofless house, walls at half height, grass inside |
| **`shed_open`** | 4 × 3 × 3 | an open shelter on posts (drying shed, woodshed) |
| **`wall_stepped`** | 9 × 1 | a stone fence with wandering height, a lantern on the wall, rubble and bricks at the foot |
| **`fence_straight`** / **`_corner`** / **`_gate`** | 1 × 6 / 3 × 3 | `fence`; the gate — a 2 m opening between `log` posts with a crossbar, lantern and signpost; variants: intact / with gaps |
| **`well`** | 3 × 3 | a ring of cobblestone, water inside, a canopy with a windlass `well_roof`, `bucket`, barrel |
| **`garden_beds`** | 6 × 4 | two `farm` beds with `crops` / `crops_ripe` sprouts, a fence on one side, a `scarecrow`, bucket, sack (pumpkins — later) |
| **`hay_stack`** | 4 × 4 | a stack of bales, a cart beside it, crates, bench |
| **`campfire_camp`** | 6 × 6 | camp (screenshot 1): campfire, log seats, bench, crates, lantern; further off — a tent (new decor `tent`), cooking pot, banner on a spear |
| **`market_stall`** | 4 × 3 | a counter of half-blocks under a shingle awning on posts, crates, sacks, barrel, lantern |
| **`watchtower_wood`** | 3 × 3 × 7 | `log` posts, a platform with `fence` railings, a `ladder`, a torch on top |
| **`dock_pier`** | 3 × 8 | a deck of half-blocks over the water on `log` posts, barrel, crate, lantern, reeds by the shore |
| **`bridge_stone_small`** | 3 × 6 | a small stone arched bridge over a stream |
| **`cart_broken`** | 3 × 2 | decor `cart_broken` (the body on its side, a wheel beside it), crate, sack or broken barrel |
| `goat_pen` | 5 × 5 | a pen — once animals appear |

### E. Compositions (large, built from medium ones)
| Preset | Size | What is inside |
|---|---|---|
| **`village_windmill`** | 24 × 24 | windmill, stone house, shed, hut, well, garden beds, haystack, fences and gate, lantern and signpost, a dirt road through (screenshot 7) |
| **`hamlet_road`** | 16 × 16 | two houses by the road, a shelter, haystack, fence corner, lanterns (screenshots 12, 15) |
| **`camp_bandits`** | 12 × 12 | two tents, a camp around a fire, a `stake_fence` palisade along the perimeter with an entrance, banners on stakes, crates, sacks, bones |
| **`ruin_cluster`** | 16 × 16 | chapel, arch, graveyard, bowls, a fallen column, dead trees |
| **`overlook_cliff`** | 12 × 8 | a `rockOutcrop` ledge 3 high, slabs on top, a statue at the edge, candles and a bowl, `cliff_stairs` steps from −X (screenshot 3) |

### F. Small details (scattered loosely)
New decor, each a cell or smaller: `pitchfork`, `log_short`, `rocks_pile`, `wheel`, `anvil`, `rope_coil`. Done in batch 2 (category "nature"): **`tree_dead`**, **`reeds`**, **`stump`**, **`rock_small`**, **`leaf_litter`**; in batch 3 (category "ruins"): **`gravestone`** / **`gravestone_wide`** / **`gravestone_fallen`**, **`grave_cross`**, **`statue_hooded`**, **`stone_bowl`**, **`pot_clay`**, **`ivy`** (wall-mounted), **`skull`**; in batch 4 (category "settlement"): **`windmill_sails`** / **`_broken`** (wall-mounted), **`barrel`**, **`barrel_broken`**, **`sack`**, **`sacks_pile`**, **`well_roof`**, **`bucket`**, **`ladder`** (wall-mounted), **`tent`**, **`scarecrow`**, **`firewood_pile`**, **`signpost`**, **`cart_broken`**. Existing: `rubble`, `bricks_loose`, `bones`, `crate_*`, `cart*`, `lantern_*`, `candles_*`, `banner`, `chain`, `roots`, `cobweb`, `mushrooms`, `planter`, `bench`, `chest`.

### New palette blocks
Done in batch 2: **`leaves_gold`** (shape `leaves_fluffy`, textures `leavesGold` / `leavesOrange` and caps — tone by cell hash), **`flower_orange`**, **`tiles_broken`** (one of four slabs has fallen out, dirt with grass along the edge beneath it, two variants by hash). In batch 4: **`crops`** / **`crops_ripe`** (sprouts on a bed), **`roof_thatch_stairs`** / **`_slab`** (thatch), **`shingles_stairs`** / **`_slab`** (brown shingles — so far only on the well canopy; houses are roofed with `roof` and `roof_dark`). In batch 5: **`stake_fence`** (a sharpened stake 12/16, cannot be stepped over).

### Biomes (screenshots 13, 16, 17, 9)

Biome = **ground** (a set of blocks: top, half-block, side, cliff with that top — `GROUNDS` in `src/level/kit.ts`, chosen per terrain piece in the editor, stored in `meta.lands[].ground`) + **environment** (`WORLD_PRESETS`: winter / jungle / desert) + **presets** of its own category. A preset carries its own ground in an outline with a ragged edge (`bleed`), so it looks right on foreign ground too. The showcase places a biome's row on its own ground (`prefabs-map.ts`). Golden autumn is part of the base theme.

**Snow** (category "snow", `builders-snow.ts`) — **done 2026-10-29**. Blocks: `snow` (natural, bleed to grass, fringe), `snow_slab`, `snow_layer` (2/16), `cliff_snow`, `ice`, `ice_cracked`, `ice_slab`, `frozen_water` (walkable), `leaves_snow`, `dead_bush_snow`. "Snow" decor: `snow_pile`, `snowdrift` (on a wall), `icicles` (from the ceiling), `icicles_wall`, `ice_spikes`, `frozen_bush`, `snowman`, `log_snow`, `rock_snow`. "Winter" environment: a cold low sun, pale sky, blue haze, snowfall.

| Preset | Size | What |
|---|---|---|
| **`snow_patch`** | 8 × 8 | snow with a ragged edge, snowdrifts, stones, dry bushes |
| **`frozen_pond`** | 6 × 6 | frozen water with cracks, snow along the shore, ice spikes |
| **`frozen_stream`** | 4 × 12 | ice along X, an ice hole in the middle, snow on the banks |
| **`ice_spikes_group`** | 4 × 4 | three clusters of spikes on snow |
| **`tree_pine_snow`**, **`tree_dead_snow`**, **`grove_pine_snow`** | 3 × 3 / 3 × 3 / 12 × 12 | a spruce and a grove under snow (`pineTree` + `snowCap`), a dead tree with a snowdrift |
| **`snowman_yard`** | 4 × 4 | snowman, snowdrifts, lantern |
| **`road_dirt_snow`** | 3 × 8 | trampled snow with thawed patches |
| snow variants `*_snow` | — | shed, stone fence, chapel (the church from screenshot 9), graveyard, well, fence, haystack, boulders — via `snowy(id)`: the same builder + `snowCap` (+ snowdrifts by the walls and icicles) |
| **`winter_hamlet`** | 16 × 16 | composition: snowy shed, well, stone fence, haystack, spruces, snowman, path, lantern |

`snowCap(c)` — a post-pass: full blocks with air above get `snow_slab`, stairs and half-blocks get `snow_layer`, foliage gets `leaves_snow`, ground within the outline and one cell around it (ragged edge) becomes `snow`; thin, glowing and water blocks are skipped.

**Jungle with crystals** (category "jungle", `builders-jungle.ts`, reference 16) — **done 2026-10-29**. Blocks: ground — a **mosaic of flat blocks**, as in the reference (not one texture with patches and not tufts on top): `jungle_floor` (orange; natural, bleed to grass, fringe), `jungle_floor_red` (dark red), `moss_teal` (teal moss), islands of `moss_block`; laid out in patches by noise — `jungleGroundAt(x, z, seed)` in `kit.ts`, shared by the presets (`jungleGround`) and the showcase row; each ground block has its own `bleed` masks — neighbours overlap each other with a ragged half-tone edge, the mosaic seams are soft; `jungle_floor_slab`, `cliff_jungle` (cliff in moss — the ground's `rockTop`), `moss_block`, `moss_carpet` (a 2/16 layer), `leaves_jungle` (`leaves_fluffy` with teal-green foliage and pink flowers in the caps), `log_jungle`, `vine`, `fern_big`, `flower_pink`, the `temple_stone` set (cube, stairs, half-block, wall — teal-grey stone with moss in the seams), `temple_stone_carved` (meander), `temple_stone_mossy`, `crystal` (shape `crystal` — three tilted prisms; the `glow` layer is not tone-mapped and glows under bloom, teal `bakedLight` over 4 m, impassable), `crystal_small` (one prism, passable, `scatter`). "Jungle" decor: `crystal_cluster` (6 prisms, `glow` + `light.baked`), `crystal_shard`, `vines_hanging` (from the ceiling), `vines_wall`, `roots_big`, `idol_head`, `log_mossy_fallen` (+ fern as a separate cutout shape), `fern_cluster`, `lily_pad`. The temple material `TEMPLE: Mat` for `pillar` / `wallRun` (cracked — carved). "Jungle" environment: warm sun through a greenish haze, teal sky, saturation 1.12. The presets face +Z (like the showcase): the pyramid staircase and the cave entrance look toward the camera.

| Preset | Size | What |
|---|---|---|
| **`jungle_tree_big`** | 8 × 8 × 8 | a 2 × 2 `log_jungle` trunk 5–6 high, buttress logs at the foot and root decor, a flat 7 × 7 crown in two layers, vines from the crown, undergrowth |
| **`jungle_tree_small`** | 6 × 6 | a 1 × 1 trunk, a 5 × 5 crown, ferns |
| **`jungle_thicket`** | 8 × 8 | foliage bushes, ferns, vines, flowers, moss, a mossy log, glowing mushrooms, small crystals |
| **`crystal_cluster_small`** / **`_big`** | 3 × 3 / 5 × 5 | crystals as blocks (one / five in two tiers), a cluster and a shard, moss around |
| **`crystal_cave_mouth`** | 10 × 8 | a `rockOutcrop` with moss instead of grass, a 2 × 2 opening from +Z, crystals inside, vines over the entrance |
| **`temple_wall_carved`** | 7 × 3 | a `wallRun` in temple stone, a carved row, vines, rubble |
| **`temple_gate`** | 5 × 5 | posts with carved capitals and a lintel, vines hanging from the lintel, an idol at the side |
| **`temple_pyramid_small`** | 9 × 9 × 5 | three steps, a staircase from +Z, a carved slab with a crystal on top, candles and a shard, an idol at the foot |
| **`temple_altar_crystal`** | 3 × 3 | slab, crystal, candles, shard |
| **`temple_column_row`** | 8 × 3 | four posts with capitals on slabs, one collapsed |
| **`jungle_pond`** | 6 × 6 | water with lily pads, moss and ferns along the shore, crystals |
| **`mossy_boulders`** | 4 × 4 | `cliff_jungle`, moss, ferns, a crystal in a crack |
| **`temple_ruins_jungle`** | 20 × 20 | composition: pyramid, gate, carved wall, columns, crystals, trees, thicket, idol |

Helpers: `jungleGround(c, rx, rz)` — ground in an ellipse with a ragged edge (does not touch water and stone), `undergrowth(c, n, r, crystals)` — undergrowth on free ground, `canopy` — a flat crown, `jungleTreeBig` / `jungleTreeSmall`, `templeFloor`, `pyramid`.

**Desert temple** — plan in `~/.claude/plans` (batch 8): sandstone via `Mat`, `sand` ground in `GROUNDS`.

## 4. Batches

1. **Infrastructure** — format, generator, rotation, tab, showcase, test; 4 trial presets (`hay_stack`, `tree_oak`, `wall_stepped`, `campfire_camp`) — **done 2026-10-29**.
2. **Road and nature** — A + B in full (20 builders, 45 presets with variants); blocks `leaves_gold`, `flower_orange`, `tiles_broken`; decor `tree_dead`, `reeds`, `stump`, `rock_small`, `leaf_litter`; the showcase wraps long rows — **done 2026-10-29**.
3. **Ruins** — C in full (11 builders, 22 presets, `builders-ruins.ts`); blocks `bricks_old_stairs` / `_slab` / `_wall`; "ruins" decor — gravestones of three shapes, cross, statue, bowl, pots, ivy, skull; helpers `pillar`, `wallRun`, `arch`, `ruinFloor`, `onWall` (wall decor on a cell face) — **done 2026-10-29**.
4. **Settlement** — D in full except `goat_pen` (17 builders, 34 presets, `builders-settlement.ts`); blocks `crops`, `roof_thatch`, `shingles`; 14 decor items; helpers `walls` (a box with a door and windows), `gableX` (gable roof), `hipRoof` (hip roof), `fenceRun` — **done 2026-10-29**.
6. **Snow** — the biome together with the biome infrastructure: ground selectable in terrain and the editor, showcase by category, `snowCap`, `Mat` in the ruin helpers, the "Winter" set; 10 snow builders + 8 snow variants + a composition (36 presets) — **done 2026-10-29**.
7. **Jungle with crystals** — 14 builders (28 presets, `builders-jungle.ts`), 20 blocks, 9 decor items, `jungle` ground in terrain, the "Jungle" set — **done 2026-10-29**.
8. **Desert** — plan.

5. **Compositions** — E in full (5 builders, 10 presets, `builders-compositions.ts`): a medium preset is baked by its own builder and nested with an offset and rotation (`stampInto` in `build.ts`, `c.put` / `c.putEntity` for ready-made decor and light) — building code is not duplicated, the JSON of the medium presets does not change — **done 2026-10-29**.

Each batch: builders → `npm run prefabs` → showcase → build → targeted test.
