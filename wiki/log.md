# Journal

Entries are only appended at the end, old ones are not edited. Entry header — `## [YYYY-MM-DD] type | what`, type: `code`, `wiki`, `source`, `decision`. Latest entries: `grep "^## \[" wiki/log.md | tail -5`.

## [2026-10-22] wiki | Snapshot of the project documents
The wiki was copied from the Claude project "malina": the brief, ADR-001…004, dungeon and block design, the style with 9 references.

## [2026-10-23] code | Playground without the house
The yard with the two-storey house beyond the east wall was removed, the wall is solid. The "house in the yard" test was removed, pathfinding is now checked by climbing onto the 2 m platform in the showcase. The cutaway above the hero (`ceilingAt`, `setCut`) remains shared.
Pages: [design-level-blocks.md](design-level-blocks.md).

## [2026-10-23] wiki | Wiki per Karpathy's scheme
`README.md` → [index.md](index.md) (table of contents by section), [log.md](log.md) and the rules [CLAUDE.md](CLAUDE.md) were set up, the sources folder `sources/`.

## [2026-10-23] code | Decor, phase 1: format, shapes, rendering, showcase
The `decor` field in the map, the registry `src/level/decor.ts` (16 items), shapes `assets/decor/*.obj` from `scripts/gen-decor.mjs` (shared writer `obj-writer.mjs`: faces are cut along the cell grid, part rotations), `InstancedMesh` rendering in `LevelRenderer`, the `glow` layer. Decor showcase and decor in the playground arena. Test "decor".
Pages: [design-level-decor.md](design-level-decor.md).

## [2026-10-23] code | Decor, phase 2: collisions
`decorSolids` — decor boxes as flat obstacles; `Obstacle` got a bottom `y0` (`overlapsY`). Decor stops the hero, is avoided by the click path, by enemies (`NavGrid`) and by bullets; the sword strikes through. Test "decor blocks the way".
Pages: [design-level-decor.md](design-level-decor.md).

## [2026-10-23] code | Decor, phase 3: editor
"Decor" mode on Tab: a palette with previews, a ghost under the cursor, floor / wall / ceiling supports (`placeDecor`), selection and moving with the mouse, rotation, tilt, roll, random rotation, copy, delete; shared undo with blocks, an erased cell takes the attached decor with it. Test "editor: decor".
Pages: [design-level-decor.md](design-level-decor.md).

## [2026-10-23] code | Decor, phase 4: rooms and floor
Room templates are "dressed" with walkable decor (`dressRoom`), the floor carries the rooms' decor over with the attachment offset. The playground learned `?map=dungeon&seed=…&floor=…` (the README already promised it). Test "dungeon floor".
Pages: [design-level-decor.md](design-level-decor.md), [design-level-blocks.md](design-level-blocks.md).

## [2026-10-23] source | Minecraft Dungeons screenshots: light and decor
4 screenshots in `sources/mcd-lighting/`, summary: a warm low sun, blue shadows, AO, tilt-shift, haze, off-grid decor, grass fringe.
Pages: [sources/mcd-lighting.md](sources/mcd-lighting.md), [style-lighting.md](style-lighting.md), [style-guide.md](style-guide.md).

## [2026-10-23] code | Unreal-style lighting
`src/lighting.ts` (`Lighting`): the sun lower and warmer, the sky fills the shadows, GTAO without grass and leaves, bloom, colour grading after ACES, haze from the camera, tilt-shift. The playground takes its light from there; U — compare with simple light. Test "Unreal-style lighting".
Pages: [style-lighting.md](style-lighting.md).

## [2026-10-23] wiki | Check and brief
Lint: no broken links, all pages and sources are in the table of contents. A note about decor and light in the brief's header.
Pages: [project-brief.md](project-brief.md).

## [2026-10-23] code | No tilt-shift
The blur of the top and bottom of the frame was removed from `src/lighting.ts`: two full-screen passes at full resolution were eating FPS. Sun, sky, AO, bloom, colour grading and haze remain.
Pages: [style-lighting.md](style-lighting.md), [sources/mcd-lighting.md](sources/mcd-lighting.md).

## [2026-10-23] code | Grass on top of blocks: fringe and tufts
The mesher itself adds a grass fringe on ledge edges and grass tufts with flowers in patches (`fringe`, `tufts` in the palette, the `detail` layer without shadows). On the playground — a three-tier hill by the west wall. Test "grass on top of blocks".
Pages: [design-level-blocks.md](design-level-blocks.md), [sources/mcd-lighting.md](sources/mcd-lighting.md).

## [2026-10-23] code | Post-processing three times cheaper
GPU measurement: post-processing cost 37 ms per frame (retina 2048 × 1536), of which AO ≈ 15 ms. The post-processing buffer is now no denser than DPR 1.5, AO at half the buffer: 12.5 ms (without post-processing — 7.8). The lighting test checks the resolutions.
Pages: [style-lighting.md](style-lighting.md).

## [2026-10-23] code | Post-processing buffer — DPR 1.25
`POST_MAX_DPR` 1.5 → 1.25: on retina 2048 × 1536 the buffer is 1280 × 960, post-processing 10 ms — same as a frame without it.
Pages: [style-lighting.md](style-lighting.md).

## [2026-10-23] code | Ground and grass in Minecraft Dungeons pastel
The textures of grass, dirt, path, sand, gravel and stone were redrawn with a soft fill (`softFill`) without pixel noise; patches of colour across the world (`macroTint`, `natural` blocks); softer light (sky 2.0, sun 2.2, warm bounce from below), colour grading without a saturation boost. Colours calibrated by screenshot pixels: grass `#81ae51` against a target of `#84aa58`, path `#cfaa61` against `#cba060`.
Pages: [style-terrain.md](style-terrain.md), [style-lighting.md](style-lighting.md), [sources/mcd-lighting.md](sources/mcd-lighting.md).

## [2026-10-23] code | Masonry and foliage in Minecraft Dungeons pastel
Brick, cobblestone, slabs, moss and foliage were redrawn softly (`softBricks`, `softCobble`, `overlayBlobs`, `softLeaves`), all variants of ruin brick are in a slate palette, the spread between stone blocks is 0.03. Pixel calibration: cobblestone `#aeacad` against a target of `#a3a8ad`, slabs ≈ `#a6a6a6`, foliage `#7a9948` against `#789a45`.
Pages: [style-terrain.md](style-terrain.md).

## [2026-10-23] code | Roads as in Minecraft Dungeons
The path was recoloured from the screenshot (median `#cc9f5b` against a target of `#c89c5d`, soft tracks ≈ 0.3 m). The grass/road edge is ragged: `bleed` masks in the mesher (0–8 px, half-tone, islands) and an uneven edge by noise in the playground generator; playground roads are 3 m. The grass test checks the edge overlays.
Pages: [style-terrain.md](style-terrain.md), [design-level-blocks.md](design-level-blocks.md).

## [2026-10-24] code | World: yard, river with a waterfall, level edges
From screenshots 10–12: fence and yard floor blocks, hay in the screenshot's colours; storage yard decor (striped crates, a stack, a small box, a chest, a cart and a loaded cart, a bench), double / wall / low lanterns. Cliffs (light, dark, with grass, stairs, half-block), waterfall (the `falls` layer, streams run downward), a river with a current (the `river` layer, the `flow` attribute in the shader), a bridge (deck, beam, post), splashes and foam. Kits `src/level/kit.ts`, the "world" zone beyond the east wall (`src/level/world-zone.ts`).
Pages: style-world.md (in the next entry).

## [2026-10-24] code | World: hills, candles with baked light, portal
From screenshots 13–15: a grass half-block (fringe and tufts — at half-block height), lush foliage (a cube and "caps" over the faces), dry grass, daisies, path stairs and half-block; candles in a cluster, in a row and a tall one — light is baked into neighbouring blocks (the `bake` attribute, added to emission, without PointLight); portal — golden glow (the `portal` layer, stripes run upward, baked light), frame, lintel with inlay, floor. Kits: a terraced hill (soft, with a drop, with flora), a tree, a fortress wall, a portal. Test "world".
Pages: style-world.md (in the next entry).

## [2026-10-24] source | Minecraft Dungeons world screenshots
7 screenshots in `sources/mcd-world/` (roads, yard, waterfall and bridge, cliffs, hills and candles, portal, hills), a summary with colours by pixel. New kits page [style-world.md](style-world.md); rows about the new layers and decor — in design-level-blocks and design-level-decor. The river colour returned to the middle of two measurements.
Pages: [sources/mcd-world.md](sources/mcd-world.md), [style-world.md](style-world.md), [design-level-blocks.md](design-level-blocks.md), [design-level-decor.md](design-level-decor.md).

## [2026-10-24] code | Slab hills instead of little pyramids
From screenshots 16, 17: `hill` rewritten — wide slabs with a 1-block step, corners cut with a stepped diagonal; a new kit `plateaus` — terrain from a height map (coarse noise, levels, `settle` smoothing, rock on steps ≥ 2); ramps from half-blocks, reachability of the platforms is guaranteed by breadth-first search. The "world" zone: a plateau terrain and slab hills with a portal. The "world" test checks climbing onto the plateau.
Pages: [style-world.md](style-world.md), [sources/mcd-world.md](sources/mcd-world.md).

## [2026-10-24] code | Relief: walkable terrain and impassable cliffs
Hills split into two entities. Terrain (`landscape`, `hill`) — slabs in 4 layers of 0.5 m (a grass block or half-block), winding contours by distorted noise, smoothing by level, the step between neighbours no more than one layer — walkable from anywhere without stairs; the sides of the layers are stone in places. Cliff (`rockOutcrop`) — an impassable mass; the portal is built into the cliff north of the road, the exit is cut toward the road. Access stairs and ramps from the terrain were removed.
Pages: [style-world.md](style-world.md).

## [2026-10-24] code | Terrain in the editor
A third editor mode "Terrain": sliders for size in X and Z, 0.5 m layers, coarseness and stone share, a "Random" button (new bends of edges and corners); a click places a piece, the sliders rebuild the last one in place, undo — as one edit. `landscape` got a `max` ceiling. Test "editor: terrain".
Pages: [style-world.md](style-world.md).

## [2026-10-24] code | Editor: selecting and editing terrain pieces
A terrain piece became a map object: `meta.lands` stores the centre, parameters and changed cells. In "Terrain" mode a click on a piece selects it (green frame with fill), the sliders and "Random" edit the selected one, arrows move it, Del removes it; manual blocks on top of a piece survive the rebuild; consecutive edits of a piece — one undo record. The "editor: terrain" test checks selection, editing, moving, deletion, JSON and undo.
Pages: [style-world.md](style-world.md).

## [2026-10-24] code | Editor in the spirit of Unreal Engine
A new window: menu and toolbar, prefabs with categories, search and previews, viewports with 1/2/4 views, outliner, details, world settings. Selection by click and marquee, translate and rotate gizmo along axes, undo of property edits. World settings (`meta.world`, `src/world.ts`), weather (`src/weather.ts`), placed light and the spawn point's view direction — in the map and in the game. The "Weapons" tab: registry `src/weapons.ts`, preview, stats, balance, `Knight.setWeapon`.
Pages: [design-editor.md](design-editor.md), [design-level-blocks.md](design-level-blocks.md), [design-level-decor.md](design-level-decor.md), [style-lighting.md](style-lighting.md).

## [2026-10-24] wiki | How to run the tests
The Playwright recipe: `mise exec` for node and the installed Google Chrome via `PW_CHROMIUM`; `npx playwright install` hangs in the agent sandbox without network. The recipe is duplicated in the root `AGENTS.md` and `CLAUDE.md`, the README and the brief link to it.
Pages: [dev-testing.md](dev-testing.md), [project-brief.md](project-brief.md).

## [2026-10-24] code | HUD and inventory in the spirit of Minecraft Dungeons
New HUD (`src/hud/hud.ts`): a bar with enchantment points, inventory, three artifacts and a soul bar, heart and lives, potion, map, dodge roll, arrows, raspberries and experience; effects and the objective at the top. Inventory (`src/hud/inventory.ts`): the hero in 3D with equipped gear, tabs, a grid, a card, enchantments as diamonds, salvage. Items and levelling — `src/items.ts`, combat — `src/gear.ts` (arrows on RMB, artifacts, potion, souls, levels), icons by code — `src/icons.ts`. Keys: E — potion, F — use, M — map, F9 — sound. Chests give arrows and an item. Tests: HUD, gear in combat, inventory.
Pages: [design-inventory.md](design-inventory.md).

## [2026-10-24] code | Armour and bow on the hero, blacksmith and merchant, Diablo-style map
Armour is visible on the hero (`ArmorLook`, `Knight.setArmor`), the bow — in the left hand when shooting (`Knight.shootPose`). Blacksmith and merchant shops on the playground (`src/merchants.ts`) and the trade window (`src/hud/shop.ts`): random items for raspberries, reforging +1 power, arrows, a special item. A map with fog of war (`src/hud/automap.ts`): mini-map, Tab — over the game, M — full. Black squares near spells: GTAO was drawing flash sprites into the normals — now it hides them; artifact explosions without smoke.
Pages: [design-inventory.md](design-inventory.md), [style-lighting.md](style-lighting.md).

## [2026-10-24] code | Magic chests, bright trophies and raspberries
The chest replaced: blue with gold, rainbow gems, light from under the lid; opening — shake, flash, a pillar of light, confetti, loot in a fountain. Trophies — a pillar of light with a white core, a star of rays, rings; raspberries — a large berry with a halo, pickup with a flash and a sound on the scale. Treasure sounds with echo (`src/audio.ts`), shared glow textures — `src/loot-look.ts`.
Pages: [design-inventory.md](design-inventory.md).

## [2026-10-24] code | Spells: 4 starters with the anatomy of a cast
A new magic design page: the framework, 20 spells from bosses, 5 auras, the anatomy of a cast. Done: spark, fireball, ice rain and weak heal (`src/spells.ts`): charge by holding 1/2/3, a rune circle and a hum, an impact with a flash, light, freeze-frame and "silence before the strike", marks on the floor. In `fx.ts` — `screenFlash`, `light`, `decal`, `hitstop`; in `audio.ts` — a bus with `duck`, `hum`, spell sounds. The starter set: fireball, spark, heal; spells do not drop from chests. Test "spells".
Pages: [design-spells.md](design-spells.md), [design-inventory.md](design-inventory.md).

## [2026-10-24] code | Spells: cast circles by school and new sound
A cast circle of 5–7 layers per school (rings, square and diamond, hexagram, snowflake, flame, flower, symbols) unfolds in steps by charge, from the third — symbols circle, from the fourth — a wall of rays (`src/sigils.ts`). The sound rewritten (`src/spell-audio.ts`): pentatonic, warm voices, lows through saturation, compressor and reverb, charge in steps with a pulse and a full-charge fanfare.
Pages: [design-spells.md](design-spells.md).

## [2026-10-24] code | Auras: a fourth slot, five auras, ×3 burst
Blood Pact, Bastion, Fury, Clarity, Crown of Thorns (`src/auras.ts`): a dim school circle under the hero and its own sign, damage fills a gauge, R — a ×3 burst for 5 s with a large circle and a chord. A slot in the HUD and inventory, the "Auras" tab, icons, sounds. While there are no bosses — auras lie in the inventory. Test "auras".
Pages: [design-spells.md](design-spells.md).

## [2026-10-24] code | 20 spells from bosses
The registry `src/magic/` (`BossSpell`: school, pomp tier, `cast`) and groups: fire and ice, lightning and light, darkness and arcana, earth — with icons. New schools light, darkness, earth, arcana: colours, circle patterns (rays, pentagram, spiral, eye, stones, cracks, swords), charge chords. Pomp by rarity `Spells.pomp`: freeze-frame, slow motion, shockwaves, world darkening, camera pull-back, a large title, choir (`fx.slowmo`, `darken`, `zoom`, `title`). Titan form — hero buff via `Spells.buff`. While there are no bosses, spells do not drop. Test "spells from bosses".
Pages: [design-spells.md](design-spells.md).

## [2026-10-24] code | Common spells — at the merchant for raspberries
Five common spells marked `spell: 'shop'`: the merchant sells them as the fourth item (key 4, price 110 + 12 · power), they do not come from bosses or in the free set; the inventory holds only the 15 boss spells from the start. The merchant test checks buying a spell.
Pages: [design-spells.md](design-spells.md), [design-inventory.md](design-inventory.md).

## [2026-10-25] code | Wardens of Malina: the list and the first — the Crimson Dragon
The list of wardens agreed (8 mini-bosses, 5 bosses with a choice of two grimoires, 3 finals). The `src/bosses/` framework done (target, bar, arena with an invisible square and grates, grimoire) and the Crimson Dragon: bite, tail, breath with burning floor, "Sky Hammer", stun with an open heart ×2, phase 2, grimoire. The arena — beyond the north wall of the playground; Playwright test "warden".
Pages: [design-bosses.md](design-bosses.md), [design-spells.md](design-spells.md).

## [2026-10-25] code | Dragon skeleton after the Ender Dragon
The dragon was unbalanced — a short neck, plank wings. A shared `DragonRig` with the Ender Dragon's proportions: body 24 × 24 × 64, neck of 5 and tail of 12 segments with plates, a head with snout and jaw, wings of two segments with a stepped membrane, IK on the hind legs; colours — `DragonLook`. The Crimson Dragon moved onto it, attack distances adjusted to the new length.
Pages: [design-bosses.md](design-bosses.md).

## [2026-10-25] code | Dragon: reptile legs and agility
The hind legs' knees face backward, standing legs are bent; the front ones — elbow backward. The dragon is twice as fast, circles sideways at medium range, jumps: a back-hop (the hero under the snout, after the tail), sideways after a bite, a lunge at the hero from afar. Test "agile warden".
Pages: [design-bosses.md](design-bosses.md).

## [2026-10-25] code | Dragon: reptile stance
The dragon stood high on straight legs — anatomically wrong. Now like a lizard: belly ~0.7 m above the ground (lying — on the ground), legs splayed sideways, knees and elbows outward, all four on the ground; IK in the frontal plane, walking in diagonal pairs, body and tail bend. Breath aimed flatter under the low head.
Pages: [design-bosses.md](design-bosses.md).

## [2026-10-25] code | Dragons removed, eight mini-bosses in the spirit of MCD
The dragon deleted (`crimson-dragon.ts`, `dragon-rig.ts`). A new list of wardens — schematic, no more than 8 moving parts. The `MiniBoss` framework (markers, projectiles, zones, minions, rage, stun); eight mini-bosses on eight arenas of the wardens' hall; a new spell "Rift" (`blink`) from the Gravedigger Cat. Tests `warden "id"` for each.
Pages: [design-bosses.md](design-bosses.md), [design-spells.md](design-spells.md).

## [2026-10-25] code | Raspberries from wardens and five floor bosses
A fountain of raspberries bursts from a defeated warden (`Props.fountain`): health ÷ 20 for mini-bosses, ÷ 10 for floor bosses. Floor bosses (`tier = 'boss'`) drop a pair of grimoires — a legendary spell or aura, take one — the other goes out. Five bosses on 27 × 24 m arenas further down the hall corridor: the Ruddy Serpent, the Thunder Beast, the Queen of the Star Garden, the Judge of the Order, General Rdyan. Tests `warden "id"` — for all thirteen.
Pages: [design-bosses.md](design-bosses.md).

## [2026-10-25] code | Three final wardens
The Mistress of Eternal Winter, the Fallen Star, the First Gardener (`tier = 'final'`) — on the largest arenas (31 × 30 m) at the end of the hall corridor. At 50 % a transformation with a large title, darkening and camera pull-back; they drop mythic grimoires and 530–580 raspberries. Tests `warden "id"` — for all sixteen.
Pages: [design-bosses.md](design-bosses.md).

## [2026-10-25] code | Warden scaling by level and number of players
`src/bosses/scaling.ts`: health ×(1 + 0.15·(lvl − 1))·(1 + 0.75·(players − 1)), damage ×(1 + 0.1·(lvl − 1))·(1 + 0.1·(players − 1)), raspberries ×(1 + 0.1·(lvl − 1))·players. All warden damage is multiplied at a single point — the `hurtHero` wrapper in `Boss`. On the playground the level follows the hero, in the F1 panel — level and number of players; the bar shows "lvl · players". Test "warden scaling".
Pages: [design-bosses.md](design-bosses.md).

## [2026-10-25] code | Gentler warden scaling
With the old formulas, wardens at high levels came out as hard as Dark Souls. Now health +6 % per level and +50 % per player, damage +3 % per level and does not grow with players, raspberries +5 % per level; the wardens' base numbers (level 1, solo) untouched — verified by play. The "warden scaling" test — on the new numbers.
Pages: [design-bosses.md](design-bosses.md).

## [2026-10-25] code | Measuring and removing stutter: warm-up, pools, instances, fountain in waves
The F8 overlay (`src/dev/perf.ts`) and the perf test `tests/perf.spec.ts` (`PERF_GPU=1` — on the real GPU). Warm-up of shaders and textures at load (`src/fx-zoo.ts`), particles and temporary bodies from pools (`src/pool.ts`, `src/fx.ts`), lightning and fire cubes as instances (`src/fx-bolts.ts`), the raspberry fountain in waves with a cap of 60 piles and release of picked-up ones (`src/props.ts`), shared grimoire materials, shadows once per frame and cheaper AO (`src/lighting.ts`), DOM without full-screen filters, a budget of 32 audio voices (`src/audio.ts`). The worst frame of a warden's death on the GPU 52 → 12.7 ms, of a spell barrage 30.7 → 9.5 ms; programs and textures do not grow in combat.
Pages: [dev-performance.md](dev-performance.md), [dev-testing.md](dev-testing.md).

## [2026-10-25] code | Frame cost: level once per frame, weather and fireflies on the GPU, indexed mesher
`view.sync/update` moved from the tick into `render()`; weather (`src/weather.ts`) and fireflies are computed in the vertex shader by seed and time; the mesher (`src/level/mesher.ts`) builds indexed geometry with shared shape vertices and per-layer attributes — playground vertex data 45.9 → 21.6 MB; the hero's path in the overlay and the mini-map without per-frame allocations.
Pages: [dev-performance.md](dev-performance.md).

## [2026-10-25] code | 32 × 32 m regions: procedural world, streaming, meshing budget, state saving
`?map=world&seed=N`: the world is generated in regions by seed (`src/world/gen.ts`), the manager (`src/world/regions.ts`) keeps a square of radius 2 around the hero and unloads distant ones with a delay; the mesher builds chunks with a budget of 4 ms per frame; crates, barrels and chests are region entities with stable ids, their state and map exploration are saved in localStorage; the map (`src/hud/automap.ts`) — in tiles and grows with the world. Test `tests/world.spec.ts`.
Pages: [dev-performance.md](dev-performance.md).

## [2026-10-25] decision | The world is a fixed map, regions stream it into the scene
There will be no infinite world: the map is fixed (generated in advance), 512 × 512 m and larger. 32 × 32 m regions remain as the partitioning: `src/world/map-source.ts` copies the map's chunks, decor and entities into the live level around the players and removes them beyond the radius; a large map streams by itself, any map — with `?stream=1`. The procedural generator remains a debugging source.
Pages: [dev-performance.md](dev-performance.md).


## [2026-10-25] wiki | Plan for rank-and-file mobs
A new page: 30 rank-and-file mobs of the Raspberry Order in six families — mages (heals, attacks, summons), raspberry knights, bush spawn, fallen gardeners, beasts, constructs. General rules, roles, horde points, the first batch of 8.
Pages: [design-mobs.md](design-mobs.md).

## [2026-10-25] code | Rank-and-file mobs: first batch
The `Mob` class and the `Pack` (`src/mobs/`), markers, projectiles and zones moved out of `MiniBoss` into `Field`. Eight mobs: healer, searing mage, summoner, squire, shield-bearer, raspberry whelp, withered gardener, raspberry wolf. Showcase in F1, raspberries from the fallen, scaling as for wardens. Two tests.
Pages: [design-mobs.md](design-mobs.md), [design-bosses.md](design-bosses.md).

## [2026-10-25] code | Order barracks on the playground
A room beyond the west wall (passage z −1…1): 16 mobs of the first batch at their posts, groups wake one at a time, after leaving the garrison returns. The map rebuilt (`npm run map:playground`). The gardener now holds the hoe in his hands. Test "Order barracks".
Pages: [design-mobs.md](design-mobs.md).

## [2026-10-25] code | Rank-and-file mobs: second batch, Thorn Garden
Knights: spearman, crossbowman, standard-bearer (the banner inspires knights, `rally`), hammerer. Bush spawn: slime (splits twice), thorn ball, whip vine, spitter bud, thorn monster. Mob rooms generalised (`MOB_ROOMS`): the barracks extended for the guard, a new room "Thorn Garden". Test "second batch mobs", mob and room tests extended.
Pages: [design-mobs.md](design-mobs.md).

## [2026-10-25] code | Rank-and-file mobs: third batch, graveyard and den
Fallen gardeners: reaper with a sickle, bone archer, mourner wisp (through walls), scarecrow with crows. Beasts: little boar, berry beetle (underground), vine-weaver (the net slows), a hive with bumblebees. In `Mob` — `dash`, `ghost`, `vanish`, `heroSlow`; `Field.shot`; the hero has `slow`. Rooms "Old Graveyard" (passage in the west wall, z −17…−15) and "Beast Den". Test "third batch mobs".
Pages: [design-mobs.md](design-mobs.md).

## [2026-10-25] code | Rank-and-file mobs: fourth batch, workshop
Constructs: little druse golem, hopping cauldron, guardian obelisk (dome — `Mob.ward`, damage ×0.5), basket mimic, jam keg (the explosion hits mobs too). `Mob` has `vanish()`. The room "Order Workshop" beyond the Thorn Garden. All 30 rank-and-file done. Test "fourth batch mobs".
Pages: [design-mobs.md](design-mobs.md).

## [2026-10-25] code | Weapon tempering, synergies, weapon arts and new weapons
Melee enchantments are tempering: blade colour, a two-colour trail, sparks, the strike crescent, hit effect (`src/temper.ts`, `src/weapon-arts.ts`). 28 pair synergies on the finisher, resonance of three (`src/weapon-synergies.ts`). A Q weapon art on a gauge — each of the 14 kinds has its own (`SpecialMove` in `Knight`). New weapons: katana, nagakiba, dragonslayer, pontiff blades (paired, `offhand`), staff, halberd, rapier, knuckles. The F1 panel — weapons and tempering. Test "tempering".
Pages: [design-weapon-arts.md](design-weapon-arts.md), [design-inventory.md](design-inventory.md).

## [2026-10-25] code | Own poses and sounds for every weapon kind
Eight combo strike styles (`STYLES` in `src/knight.ts`): sword, heavy, katana, thrust, dagger, polearm, paired (the left hand with its own blade tilt), fists. Weapon sound `src/weapon-audio.ts`: each kind has its own swing, hit and weapon-art moments. The editor still edits only the right hand. The "tempering" test checks the styles.
Pages: [design-weapon-arts.md](design-weapon-arts.md).

## [2026-10-25] code | Merchants without "random", all weapons in the inventory
The trade window — a grid of all goods in tabs with the price under each, a card of the selected one with a comparison to the equipped, purchase of the selected (`src/hud/shop.ts`). Price — by stats, rarity and power (`src/prices.ts`). The merchant sells everything, the blacksmith — weapons, armour and reforging. All 16 weapons — in the playground inventory, added into old saves. The "blacksmith and merchant" test rewritten.
Pages: [design-inventory.md](design-inventory.md).

## [2026-10-25] code | Seven offensive auras
Crucible, Frost, Storm Crown, Punishing Halo, Hungry Shadow, Stone Tread, Whirl of Blades — `src/aura-offense.ts`, one per school; lie in the inventory from the start. A pulse on a timer hits enemies around the hero, a zone ring underfoot, a ×3 burst; the aura's own damage fills the gauge at half rate. Targets got slow, weakness and stun; barrels and crates are marked `prop`. Test "offensive auras".
Pages: [design-spells.md](design-spells.md).

## [2026-10-25] code | Auras at the merchant
The merchant has an "Auras" tab: all twelve, price 210 at power 1 (unique rarity). The aura card — the shared `auraLines` function in `src/aura-offense.ts` for the inventory and the shop. The "blacksmith and merchant" test checks the tab and purchase.
Pages: [design-inventory.md](design-inventory.md), [design-spells.md](design-spells.md).

## [2026-10-25] code | Auras from bosses by chance
The twelve auras distributed among the five floor bosses by element: Serpent — Crucible / Pact, Beast — Storm / Fury, Queen — Clarity / Blades / Frost, Judge — Bastion / Halo, General — Thorns / Shadow / Tread. `MiniBoss.auras` — [id, chance %], one aura is rolled per victory. Test "auras from bosses".
Pages: [design-bosses.md](design-bosses.md).

## [2026-10-25] code | Auras at the merchant removed
The "Auras" tab at the merchant removed: auras drop from floor bosses by chance, on the playground they lie in the inventory. The shared aura card `auraLines` stays in the inventory and the shop.
Pages: [design-inventory.md](design-inventory.md), [design-spells.md](design-spells.md).

## [2026-10-25] code | Juicy weapon effects and elemental sloppiness
Trail ribbons along curves (`src/fx-streaks.ts`, `fx.streak`), fat rings with a wall of light (`fx.ring`), random elemental trajectories (`WeaponArts.curve`, `wisp`, `sparks`): souls, drops, chain lightning, crescents, stars and meteors fly differently every time. Swing and hit — with spread and ribbon sparks. The ribbon material — in the warm-up.
Pages: [design-weapon-arts.md](design-weapon-arts.md).

## [2026-10-25] code | Base spells: fire, summoning, raspberry blood, light
Ten spells at the merchant (`spell: 'shop'`), on the playground — with the hero from the start: fire wall, fire hurricane, lesser armageddon, wolf pack, lesser elemental, stone golem, raspberry claws, swarm of raspberries, raspberry blade, blinding flash (`src/magic/base-*.ts`). New schools "summoning" and "blood" (colours, circles, chords), shared movement of summons `minions.ts`, payment in health and bleeding `blood-core.ts`, a "sword strike" hook for buffs. Summons are decoys (`src/decoys.ts`): a mob targets the nearest of the hero and summons, the golem pulls aggro to itself. Test "base spells".
Pages: [design-spells.md](design-spells.md).

## [2026-10-25] code | Soller, Knight of the Sun
Mob no. 31, a loner not of the Order (`src/mobs/soller.ts`): the armour is a copy of Solaire of Astora, at rest praises the sun with arms raised under a pillar of light; a sword series, a sun spear, a prayer heals once per battle, the hero left — returns to his post. The Sunny Glade in a corner of the playground arena. Test "Soller".
Pages: [design-mobs.md](design-mobs.md).

## [2026-10-29] code | One place for casting spells
Starter spells moved out of the `Spells` class into `src/magic/starters.ts`; all spells — in one registry `SPELLS` (`src/magic/registry.ts`, the `Spell` type instead of `BossSpell`, completeness checked by types), `spellOf(kind)` tells a spell from an ordinary artifact. `Spell` has charge hooks `self`, `orb`, `charging` instead of `kind === 'heal'` checks inside `Spells`. In `gear.ts`, instead of two `switch`es — shared checks, then `Spells.cast` or `plain` for ordinary artifacts. Behaviour unchanged.
Pages: [design-spells.md](design-spells.md).

## [2026-10-29] source | References of hilly lands with settlements
17 screenshots of Elden Ring and Minecraft Dungeons: slab roads, a camp, golden trees, statues, ruined chapels, a graveyard, windmills, houses, huts, garden beds, a pier — `sources/refs-settlements/`, summary [sources/refs-settlements.md](sources/refs-settlements.md).
Pages: [design-prefab-library.md](design-prefab-library.md).

## [2026-10-29] code | Preset library, batch 1: format, generator, rotation, tab, showcase
A catalogue of presets by references and the `LibraryPrefab` format (`src/level/prefab-lib/`): builders with a local map, decor and light, `bake` → `assets/prefabs/*.json` (`npm run prefabs`), placement `stampPrefab` with 90° rotation, the "Library" tab in the editor (R — rotate), "Save to library (JSON)" for own prefabs, the `?map=prefabs` showcase. Four trial presets in variants: haystack, oak, fence, camp. Test `tests/prefabs.spec.ts`.
Pages: [design-prefab-library.md](design-prefab-library.md), [design-editor.md](design-editor.md).

## [2026-10-29] code | Preset library, batch 2: road and nature
20 builders (45 presets with variants): slab roads (straight, turn, crossroads, drop), dirt paths, stairs, meadows (flowery and dry), pond, stream with a ford, golden larches, dead tree, spruce, bushes, golden grove, stump with logs, boulders. New blocks `leaves_gold` (yellow / orange tint by hash), `flower_orange`, `tiles_broken`; "nature" decor — `tree_dead`, `reeds`, `stump`, `rock_small`, `leaf_litter`. The showcase wraps a row longer than 96 m. The library test counts categories from JSON.
Pages: [design-prefab-library.md](design-prefab-library.md), [sources/refs-settlements.md](sources/refs-settlements.md).

## [2026-10-29] code | Preset library, batch 3: ruins
11 builders (`src/level/prefab-lib/builders-ruins.ts`, 22 presets): arch, aqueduct with a collapsed span, wall with a window, corner, row of columns, chapel with a bell tower (a tree inside / an altar and a collapsed tower), round tower, platform with statues, altar with candles, graveyard, bowls. Ruin brick got stairs, a half-block and a thin wall; "ruins" decor — `gravestone` × 3, `grave_cross`, `statue_hooded`, `stone_bowl`, `pot_clay`, `ivy` (wall-mounted, cutout), `skull`; textures `clay`, `ivy`.
Pages: [design-prefab-library.md](design-prefab-library.md), [sources/refs-settlements.md](sources/refs-settlements.md).

## [2026-10-29] code | Preset library, batch 4: settlement
17 builders (`src/level/prefab-lib/builders-settlement.ts`, 34 presets): windmill with sails (intact / broken), barn, two-storey house with a balcony and stairs, stone house with a chimney, thatched hut, ruined house, shelter, fences (straight, corner, gate), well, garden beds, stall, watchtower, pier, stone footbridge, broken cart. Blocks `crops` / `crops_ripe`, `roof_thatch_*`, `shingles_*`; "settlement" decor — `windmill_sails` (+ `_broken`), `barrel`, `barrel_broken`, `sack`, `sacks_pile`, `well_roof`, `bucket`, `ladder`, `tent`, `scarecrow`, `firewood_pile`, `signpost`, `cart_broken`; textures of sprouts, thatch, shingles, barrel, sackcloth, tent cloth. Helpers `walls`, `gableX`, `hipRoof`, `fenceRun`.
Pages: [design-prefab-library.md](design-prefab-library.md), [sources/refs-settlements.md](sources/refs-settlements.md).

## [2026-10-29] code | Preset library, batch 5: compositions
Nested presets: `stampInto` and `c.put` / `c.putEntity` in `build.ts` — a medium preset is baked by its own builder and nested with an offset and rotation, no code duplication, the JSON of medium presets does not change. Five compositions (`builders-compositions.ts`, 10 presets): a village with a windmill, a farmstead by the road, a bandit camp (new block `stake_fence`), ruins by a graveyard, a drop with a statue. The library has 115 presets from 57 builders.
Pages: [design-prefab-library.md](design-prefab-library.md), [sources/refs-settlements.md](sources/refs-settlements.md).

## [2026-10-29] code | Preset library, batch 6: the "snow" biome and a choice of ground
Terrain ground of choice (`GROUNDS` in `kit.ts`: grass, snow; buttons in the "Terrain" tool, `meta.lands[].ground`), the showcase puts a biome's row on its ground. Snow and ice blocks (`snow`, `snow_slab`, `snow_layer`, `cliff_snow`, `ice`, `ice_cracked`, `ice_slab`, `frozen_water`, `leaves_snow`, `dead_bush_snow`), "snow" decor (drifts, icicles, spikes, snowman, a log and stones under snow), the "Winter" kit. The `snowCap` post-pass and `snowy(id)` — snowy variants of existing presets without copies; `Mat` in the ruins helpers. 36 snow presets (`builders-snow.ts`), 151 in the library.
Pages: [design-prefab-library.md](design-prefab-library.md), [style-world.md](style-world.md), [sources/refs-settlements.md](sources/refs-settlements.md).

## [2026-10-29] code | Preset library, batch 7: the "jungle with crystals" biome
`builders-jungle.ts` (14 builders, 28 presets, the composition `temple_ruins_jungle`), 20 blocks (ground — a mosaic of flat blocks by noise: `jungle_floor`, `jungle_floor_red`, `moss_teal`, `moss_block` via `jungleGroundAt`, `temple_stone` with carving, `crystal` — a shape of three prisms in the `glow` layer with baked turquoise light), 9 decor items (a crystal cluster, lianas, roots, an idol, water lilies), the `jungle` ground in terrain, the "Jungle" environment kit. The earlier preset JSONs did not change.
Pages: [design-prefab-library.md](design-prefab-library.md), [sources/refs-settlements.md](sources/refs-settlements.md).

## [2026-10-30] source | The hand-drawn map of the first level
The drawing of the island and its markup (biomes, roads, enemy groups, ambushes, patrols, bridges, loot) — `sources/map-01/`, summary [sources/map-01.md](sources/map-01.md).
Pages: [design-map-island.md](design-map-island.md).

## [2026-10-30] code | Map 1 "Island" from presets
The generator `src/level/island-map.ts` in plan pixels: land and biomes as polygons, a rocky shoreline, bridges over straits with railings, small rivers with decking, rock masses and caves, a fort with a palisade, a temple arena with three gates, ~100 presets, forest and grass on an occupancy grid. In `meta` — mob groups (posts with `aggro` for ambushes and `route` for patrols, `respawn: false`), the warden's arena (`home`, `gates[]`), merchants, the objective; loot — entities `chest` / `crate` / `barrel` / `terminal`. The playground reads all of this on any map, enemy obstacles under streaming — by region. `npm run map:island`, `?map=island`, test `tests/island.spec.ts`.
Pages: [design-map-island.md](design-map-island.md), [design-mobs.md](design-mobs.md).

## [2026-10-30] code | Bush Defence, phase 1: building towers
The tower defence mode on a map with `meta.td` (`src/td/`): highlighted pads, a build menu on F and on click (the hero walks up himself), five cards with prices, upgrade to III and selling; the tower shoots the first one along the road, for now — an archer tower with a crossbow. The draft map `td` (`src/level/td-map.ts`, `npm run map:td`): three roads from cave lairs, 17 pads, the bush square. Training dummies, the storage yard and the playground labels are no longer placed on maps; chests and crates of a map without regions come from entities. Test `tests/td.spec.ts`.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-10-30] code | Bush Defence, phase 2: five kinds of towers
Models and shots of all towers in `src/td/tower.ts`: frost spire (a bolt, slow, at III — area rime), catapult (a stone on an arc, an explosion with knockback), fire brazier (a cone of flame, burning 3 s), arcane obelisk (a ribbon sphere, weakness, a chain to neighbours). A test for the five kinds in `tests/td.spec.ts`.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-10-30] code | Bush Defence, phase 3: the raspberry bush and the march along the roads
`src/td/bush.ts` — the bush as a decoy with health from `meta.td.bush`, withers at zero (`state = 'lost'`). `Mob.march` (`src/mobs/mob.ts`): a one-way route with `progress`, an alarm only from the hero nearby (tower shots from afar do not distract), a 10 m leash. `pickDecoy` sees the decoy via its `taunt`. `td.spawnOn(kind, lane)`, "To the road" buttons in F1, the bush bar in the HUD.
Pages: [design-tower-defence.md](design-tower-defence.md), [design-mobs.md](design-mobs.md).

## [2026-10-30] code | Bush Defence, phase 4: waves and new enemies
Ten waves in `src/td/waves.ts` (`meta.td.waves`): groups by road with a step and a delay, a reward for a repelled one, 20 s rest, **G** — early with a bonus, the pack level grows, victory after the last. Three TD enemies in `src/mobs/td-foes.ts`: berry courier (fast, fragile), vine battering ram (bark in front ×0.35, 160 health), pollen moth (flies through obstacles).
Pages: [design-tower-defence.md](design-tower-defence.md), [design-mobs.md](design-mobs.md).

## [2026-10-30] code | Bush Defence, phase 5: spawning from lairs
`src/td/lair.ts`: a lair on every road — a rune ring and a veil in the cave, an alarm 6 s before a wave on that road, a flash and a hum as each enemy exits; the HUD names the roads of the next wave. Test in `tests/td.spec.ts`.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-10-31] code | Bush Defence, phase 6: lava map
"Lava" blocks (`ash_ground`, `basalt`, `cliff_lava`, `lava` — a new liquid layer with emission and baked light), the generator `src/level/td-map.ts` after the reference: rifts and lava lakes with bridges and railings on the roads, volcanoes with craters and flows, scorched cliffs, little fences, lanterns, braziers, cages and bones by the lairs; haze and sparks over lava (`src/td/lava-fx.ts`), the hero burns in lava; the world — a warm dusk with ash.
Pages: [design-tower-defence.md](design-tower-defence.md), [design-level-blocks.md](design-level-blocks.md).

## [2026-10-31] code | Bush Defence: balance and scaling by players
Larger waves (≈ 420 enemies solo instead of ≈ 250, higher rewards), the pack level grows 1, 4, 7, … instead of 1, 3, 5. New `src/td/scaling.ts`: the number of enemies, health and reward grow with the number of players (× 1 + 0.5·(players − 1)); `td.setPlayers`, on the playground — from the "Players" choice in F1. A scaling test.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-10-31] source | Four TD map references
Screenshots from the "Bush Defence" task statement — `sources/td-refs/`: crystal glade, forest path, winter glade, lava basin; a summary of what was taken.
Pages: [sources/td-refs.md](sources/td-refs.md), [design-tower-defence.md](design-tower-defence.md).

## [2026-10-31] code | Bush Defence 2: Crystal Glade
Map `td2` (`src/level/td-glade-map.ts`): moats with walls, blue portal lairs (`portal_blue`), lamp mushrooms (`shroom_*`), "fireflies" weather. Twelve waves (`waves-glade.ts`), the pack from level 7 — `meta.td.level`. New enemies no. 35–37: crystal shellback (the shell absorbs 6 hits), sporeling (heals neighbours, a cloud on death), rainbow hopper (hops along the road). Tests `tests/td2.spec.ts`.
Pages: [design-tower-defence.md](design-tower-defence.md), [design-mobs.md](design-mobs.md), [design-level-blocks.md](design-level-blocks.md).

## [2026-10-31] source | Eight castle references
Images from the "castle siege" task statement — `sources/castle-refs/`: five fortress artworks (an island fort from above, a city on a cliff, a manor by a lake, red roofs, a citadel on water) and three BFME screenshots with pads on the wall, a courtyard and a breach; a summary of what was taken. The castle in the game is on a meadow, not on an island.
Pages: [sources/castle-refs.md](sources/castle-refs.md), [design-tower-defence.md](design-tower-defence.md).

## [2026-10-31] code | Bush Defence 3: castle siege
Map `td3` (`src/level/td-castle-map.ts`): a castle on a meadow — walls with battlements and a walkway on top, bastions with pads (`TdPad.y`), stairs, a gate with a wicket, a courtyard with the bush; enemies from four sides. Walls and gates — `src/td/wall.ts` (`meta.td.walls`): decoys with health, cracks, a breach removes blocks and extends the enemies' road (`TdLane.inner`, `Mob.extendMarch`), F at a wall — repair for raspberries, wall bars in the HUD. Enemies no. 38–39: stump sapper (armour ×0.3, 160 explosion against the wall), vine ballista (shoots the gate from 9 m). Towers: wall ballista (a bolt straight through, pierces armour — a hit without direction) and tar cauldron (a puddle: they bog down and burn), `meta.td.towers`. Ten waves `waves-castle.ts`. Tests `tests/td3.spec.ts`.
Pages: [design-tower-defence.md](design-tower-defence.md), [design-mobs.md](design-mobs.md).

## [2026-10-31] code | Castle on the Meadow: holes in the grass
Dry grass and daisies — plants without collision — sat in the ground layer of map `td3`, the hero fell into the cell and could not get out. Now the ground is grass everywhere, plants on top of it; the test checks that the floor on the meadow is nowhere below the ground.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-10-31] code | Castle on the Meadow: mist over the camps
`src/td/mist-fx.ts` — mist around the start of each road (`meta.td.mist`: radius, density, colour): layers of soft planes, drifting and breathing; the world haze is denser (20–52 m). The enemies' exit points are not visible from the castle.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-10-31] code | Main menu
`src/menu/`: a page without parameters opens the menu — the start screen at the campfire (single player, multiplayer, settings), the camp with gear and a choice of Bush Defence map, battle via `?map=…&from=menu` with pause on Esc, a summary and "To camp"; the hero's raspberries are set aside for the duration of the battle. Settings (`malina.settings`): volume (`setVolume`, `setMusicVolume`), quality, post-processing, shadows. Multiplayer — a stub (`session.ts`). Tests `tests/menu.spec.ts`.
Pages: [design-main-menu.md](design-main-menu.md), [design-inventory.md](design-inventory.md).

## [2026-11-01] code | Defence: slimes on the march, passages to the pads
The slime and the vine do not walk by themselves and stood at the lair — wave 4 on lava never ended; now along the road the slime hops, the vine crawls, slime halves follow the same road (`Mob.marchPace`, `Mob.joinMarch`). On the `td2` glade the moat walls hemmed in the pads — openings every 9 m and wider at the pads; a pad reachability test on all maps.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-11-01] code | Defence: tower durability, gnawers and warlocks
Towers got durability, break into ruins and are repaired for 40 % of the investment at the previous level. A tower is a siege decoy only for hunters (`Mob.hunter`): the gnawer beaver gnaws, the ice warlock freezes for 4 s (the ice breaks with two hits, the frost spire does not freeze).
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-11-01] code | Defence: denser waves, mini-bosses, sutler
Waves ×1.3 for groups of three enemies or more, gnawers and warlocks from the third wave; mini-bosses (giant, slime queen, snow shaman) in waves 3, 6, 9 (and 12 on the glade). The sutler at the spawn point sells gear for battle raspberries by rarity (80/160/260); what is bought is for the battle only — gear is set aside, like raspberries.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-11-01] code | Defence: hints for children aged 10–14
A breakdown of the mechanics for children and ten proposals — a new page; the top 3 done: a raspberry magnet and harvest collection after a wave, a next-wave card with hunters and the mini-boss, a "tower in trouble" signal in the HUD, on the map and by sound.
Pages: [td-playability-kids.md](td-playability-kids.md), [design-tower-defence.md](design-tower-defence.md), [index.md](index.md).

## [2026-11-01] code | Defence: into battle as a new hero, spells and auras at the sutler
In a defence battle the hero has a new hero's kit of power 1 (`Profile.tdKit`), own gear comes back in the camp; the sutler sells all spells and all auras for battle raspberries by rarity — the "towers or hero" choice; sutler prices ×3 (240/480/780, arrows 45).
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-11-01] code | Defence: stargazer, storm spire, heart of winter
Three expensive area towers on all maps: stargazer (500, a meteor into the thickest crowd), storm spire (350, chain lightning 6–10), heart of winter (400, a blizzard around and an ice wave with stun). Apiary, windmill and gong — a first attempt, useless in the playtest — not included. Menu keys by position in the map list, menus — five per row.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-11-02] code | Multiplayer server and shared battle
`server/` in TypeScript (Node, type stripping) and SQLite (`node:sqlite`): login by name and token, hero profiles on the server with versions, rooms with a code, readiness and a host (survive a restart), battle relay, a summary and battle history with a reward cap; the camp — a multiplayer panel (`src/net/client.ts`). Shared defence battle (`src/net/coop.ts`): the host drives the guests' heroes, mobs hit the nearest hero (`src/party.ts`), the guest sees the battle from snapshots, builds towers from the shared treasury by commands to the host. Tests `server/test/`, `tests/net.spec.ts`.
Pages: [design-multiplayer.md](design-multiplayer.md), [design-main-menu.md](design-main-menu.md), [project-brief.md](project-brief.md), [index.md](index.md).

## [2026-11-03] code | Shared battle: gear, actions, names, own raspberries, reward
Remote heroes — with their own gear (`KitMsg`, a `Gear` for each, own hit numbers `Knight.tune`) and actions (`ActMsg`: artifacts, potion, aura, weapon art, bow); puppets on the guest play attacks; names above heroes. Raspberries are each player's own (`TowerDefense.personal`, `Purse`), piles from enemies are shared — at the host, whoever picks up gets the raspberries (`Props.collectors`, `BattleSnap.piles`); the sutler is open on the guest; the reward — unspent raspberries and experience, each hands in his own (`battle.loot`, migration 002).
Pages: [design-multiplayer.md](design-multiplayer.md), [design-tower-defence.md](design-tower-defence.md).

## [2026-11-03] code | Network: smoothness, host migration, replay, late joiners, friends, chat
Reconciliation of the guest's position by acknowledged input and discard, a snapshot buffer, zones and lava for guests' heroes, puppet flags and tower freezing, spell charge and sounds of remote heroes. The host left mid-battle — the next one runs the battle (`battle.host`, `TowerDefense.takeOver`); pause without stopping; "Again" (`room.again`); joining a battle in progress; friends (migration 003), chat, a player list with ping. Tests — `tests/net-party.spec.ts`.
Pages: [design-multiplayer.md](design-multiplayer.md), [design-main-menu.md](design-main-menu.md).

## [2026-11-04] code | Network: preparing for the server battle — the boundary guard, `test:net`
The start of the transition to a server-authoritative battle (the plan modelled on Quake 3): `tsconfig.server.json` checks `src/sim`, `src/net`, `src/game` without DOM, `server/test/sim-boundary.test.ts` loads them in Node and forbids the scene, DOM, FX and `Math.random`; `npm run test:net`; imports with `.ts` in `collision`/`nav`/`level` for Node, `TdMist` in `td/types.ts`.
Pages: [dev-testing.md](dev-testing.md).

## [2026-11-04] code | Network: channel, transports and snapshot codec
The network layer extracted into pure code with tests on `node:test` (`channel.test.ts`, `snapshot.test.ts`): `Channel` with reliable and unreliable lanes and seq/ack modelled on Quake 3's netchan, transports over WebSocket and an in-memory loopback with losses, `SnapshotRing`/`SnapshotView` — snapshot deltas from the one acknowledged by the client. Not used in the game yet — it will be connected together with the server battle.
Pages: [design-multiplayer.md](design-multiplayer.md).

## [2026-11-04] code | Defence: simulation separated from the view
Defence rules, towers, walls, bush, lairs and raspberry piles — in `src/sim/` (no scene, DOM or `Math.random`, the seed in `world.rng`), the view — in `src/cgame/` from entity records and events via `SnapshotView`, menu and HUD — `td-ui.ts`; `src/td/td.ts`, `tower.ts`, `wall.ts`, `bush.ts`, `lair.ts` deleted. The host mode of the shared battle (`src/net/coop.ts`) removed until the server battle, the network Playwright tests skipped. Simulation tests — `server/test/sim-td.test.ts`.
Pages: [design-tower-defence.md](design-tower-defence.md), [design-multiplayer.md](design-multiplayer.md).

## [2026-11-04] code | Headless battle: hero, gear and mobs in Node
Instead of rewriting the hero, magic (6400 lines) and 30 kinds of mobs — the same classes without rendering: `src/headless.ts` (a canvas stub, `nullFx`), `rnd()`/`useRng` in `src/rng.ts` (every `Math.random` of the hero, gear, magic and mobs goes through it, during `world.step` — the world seed), decoys per world (`useDecoys`), `party.ts` deleted — the party via `MobHooks`. All of `src` loads in Node: imports with `.ts`, constructor parameter properties rewritten as fields. Test `server/test/headless.test.ts`: a real wave on `td` and determinism.
Pages: [design-multiplayer.md](design-multiplayer.md), [dev-testing.md](dev-testing.md).

## [2026-11-04] code | Server-authoritative battle: the match on the server, the client from snapshots
The decision — [adr-005-server-authoritative-battle.md](adr-005-server-authoritative-battle.md). `PROTOCOL = 2`: `relay`, `battle.end`, `battle.loot`, `battle.host` removed; `src/game/battle.ts` + `match.ts` — the headless party battle and the match (one command per tick, a snapshot ring buffer, deltas, rewards), `server/game/` — the runner and the WebSocket `/game` over `Channel`; rooms create and close the match, the server computes the rewards. The client `src/cgame/net-battle.ts`: prediction of the own hero, remote heroes and puppets from records, the defence mirror, chat and names. Tests: `match.test.ts`, `rooms.test.ts` rewritten, `tests/net.spec.ts` — a smoke test across two browsers; `net-party.spec.ts` removed.
Pages: [design-multiplayer.md](design-multiplayer.md), [index.md](index.md), [dev-testing.md](dev-testing.md).

## [2026-11-04] code | Server: runes without DOM, match resilience to errors
Charging a spell crashed the server: `src/sigils.ts` drew a rune via `document.createElement` — now `makeCanvas` from `src/headless.ts`. An error in handling a client message or in a simulation step no longer crashes the process: a log, a hint to the player, on a step failure the match is honestly aborted. Test `server/test/headless-gear.test.ts`: all artifacts and spells, all auras and weapon arts are cast on the headless server.
Pages: [design-multiplayer.md](design-multiplayer.md), [dev-testing.md](dev-testing.md).

## [2026-11-04] code | Network after Quake 3: snapshot ring buffer on the client, command batches, server time, bugs
A check against the Quake III Arena architecture ([arch-layers.md](arch-layers.md)). `SnapshotView` keeps 32 received states and applies a delta from any base in history (before, at RTT ≥ 50 ms half the deltas were discarded), events in a delta — grouped per snapshot, no duplicates. The client sends a batch of the last three commands (`CMD_DUP`), the server discards duplicates by `seq`; interpolation of remote heroes and puppets — by `Delta.tick` with a clock offset estimate. Bugs: the dodge roll did not reach the server (`clearEdges` before sending), defence events played twice, the raspberry pickup number at position 0, the hero after a disconnect repeated the last command forever, `ack` got stuck after a page reload; the reliable window overflowed — 4010; the sutler payment is checked; the inventory and freeze-frame do not stop ticks in a network battle.
Pages: [design-multiplayer.md](design-multiplayer.md), [adr-005-server-authoritative-battle.md](adr-005-server-authoritative-battle.md), [arch-layers.md](arch-layers.md), [index.md](index.md).

## [2026-11-04] code | Client after Quake 3: unified event queue, tick input, mouse orders, `act` in order
`src/cgame/events.ts` — a ring buffer of system events (`Sys_QueEvent`/`Com_EventLoop`): DOM handlers and the `/game` transport only enqueue, `drainEvents()` at the start of the frame sorts input and network frames before the ticks. `input.ts` — keys with latches (a tap shorter than a tick is not lost), the mouse, hero actions from keys and the HUD execute in the tick in order, not in `keydown`. `orders.ts` — mouse orders moved out of the playground. `act` leaves with the command number, the server holds it until that command (`Seat.acts`). Tests: `events.test.ts`, the `act` order in `match.test.ts`.
Pages: [arch-layers.md](arch-layers.md), [design-multiplayer.md](design-multiplayer.md).

## [2026-11-04] code | Mob brain as a Quake 3 bot: thought at 10 Hz, mover per tick, detour path, puppets by intent
`Mob.update` split into `think()` (once per 0.1 s: target, alarm, mode, attack) and `mover()` (every tick: road, patrol, chase, path). A chase stuck against a wall asks `MobHooks.route` for a path (`Pathfinder`, a budget of 4 per world tick — server and playground). The snapshot carries the mob's step direction, client puppets step along it. Wardens moved to `rnd()`, the clock — to battle time; the boundary guard checks all server gameplay. `src/nav.ts` deleted (`distToObstacle` — in `collision.ts`). Test `mob-brain.test.ts`.
Pages: [design-mobs.md](design-mobs.md), [arch-layers.md](arch-layers.md), [design-multiplayer.md](design-multiplayer.md), [design-level-blocks.md](design-level-blocks.md), [design-level-decor.md](design-level-decor.md), [project-brief.md](project-brief.md).

## [2026-11-04] code | Network: command duplicates only under losses, permessage-deflate on /game, traffic measurements
`Transport.lossy` — over WebSocket the client sends one command per frame (the batch of three tripled the outgoing stream to 27 KB/s), duplicates remain for the lossy loopback and a future transport without TCP. `/game` is compressed with permessage-deflate with a shared context: on the wire down 16.5 → 1.3 KB/s, up 10.7 → 2.7 KB/s. Measurements and the conclusion about a binary codec — in [dev-performance.md](dev-performance.md). Test: a match over the loopback with 25 % losses.
Pages: [design-multiplayer.md](design-multiplayer.md), [dev-performance.md](dev-performance.md), [index.md](index.md).

## [2026-11-04] code | Network: Safari could not connect to /game — compression without imposed client parameters
Safari offers bare `permessage-deflate`, and `ws` with a hard `clientMaxWindowBits` rejected all offers and answered 400 — there was no battle connection. Client parameters are no longer imposed (`DEFLATE` in `game-hub.ts`), compression is negotiated with both Chrome and Safari. Test `game-hub.test.ts`: the handshake with three kinds of offers.
Pages: [design-multiplayer.md](design-multiplayer.md).

## [2026-11-05] code | English code base, bilingual interface, MIT licence
All comments, identifiers-as-strings, server messages, tests, scripts, Makefile and AGENTS.md are English; the wiki and the commit history were translated earlier. Every user-visible string goes through `t()` (`src/i18n/i18n.ts`), the Russian dictionary `src/i18n/ru.ts` (≈2000 entries) was built from the original Russian text. The main menu asks for the language on the first visit and keeps it in localStorage `malina.lang`; Settings have a Language row. Hero states, weapon categories and rarities, prefab groups and block/decor categories became English ids; maps and the preset library were regenerated with English titles. README in English and Russian, LICENSE — MIT.
Pages: [project-brief.md](project-brief.md), [design-main-menu.md](design-main-menu.md), [index.md](index.md).

## [2026-11-05] code | Docker and Ansible deploy
`Dockerfile` (dev/build/runtime stages), `docker-compose.dev.yml`, `docker-compose.prod.yml`, `deploy/ansible/` — buildx build and push of a multi-platform image tagged by git commit, deploy with compose and a health check, rollback by tag; `make docker-dev`, `make docker-build`, `make deploy`.
Pages: [dev-deploy.md](dev-deploy.md), [index.md](index.md).

## [2026-11-05] code | Caddy in front of the server, make targets for image and Ansible
Caddy (profile `caddy` in `docker-compose.prod.yml`, `deploy/caddy/Caddyfile`) gives HTTPS from Let's Encrypt, the game server listens on 127.0.0.1 only; `deploy.yml` puts the Caddyfile, reloads Caddy and checks https://<domain>/api/health. Make: `image-build/run/stop/login/push`, `ansible-ping/check/deploy/vault/logs`, `deploy`.
Pages: [dev-deploy.md](dev-deploy.md), [index.md](index.md).

## [2026-11-07] code | Deploy without a registry: images over ssh
`push.yml` builds the image here for the servers' platform, `docker save | gzip`, copies it over ssh and `docker load`s it; Caddy goes the same way, compose never pulls. `build.yml`, `site.yml`, `image-login` and the registry settings are gone; the server keeps the last 5 images for a rollback.
Pages: [dev-deploy.md](dev-deploy.md), [index.md](index.md).

## [2026-11-07] code | Server provisioning
`make provisioning`: `bin/copy-ssh-key.sh` puts the ssh key to root with ssh-copy-id (one password prompt), `provisioning.yml` installs Docker from Docker's apt repository, creates the `deploy` user (docker, sudo, key), checks key login, switches ssh to keys only, enables ufw (sshd ports, 80, 443) and security updates. Deploys now go as `deploy`.
Pages: [dev-deploy.md](dev-deploy.md), [index.md](index.md).

## [2026-11-07] code | Cross-building the image without emulation
An amd64 server deployed from an arm64 Mac failed with `exec format error`: `npm ci` ran in the amd64 stage and Docker Desktop had no amd64 emulation. All `RUN` steps now run on `$BUILDPLATFORM`, the `runtime` stage only copies files (`/data` comes from the build stage with `--chown`).
Pages: [dev-deploy.md](dev-deploy.md).

## [2026-11-07] code | Match loot, own gear in defence, camp shop
Two wallets: the battle purse and the match loot (kills, ¼ of wave bounties, +50 % for victory), paid to the account only for a defended bush — solo and online. The hero goes into defence with their own gear on a battle copy of the profile (no more `tdKit` and the sessionStorage stash); waves and loot grow with the heroes' strength (gear power + half the level). The camp's "Gear" tab got the shop and the blacksmith.
Pages: [design-tower-defence.md](design-tower-defence.md), [design-multiplayer.md](design-multiplayer.md), [design-main-menu.md](design-main-menu.md), [design-inventory.md](design-inventory.md).

## [2026-11-07] code | Voice chat on T
Room voice chat: T turns one's mic on / off in the camp and in a network battle, WebRTC mesh with signalling over `/ws` (`rtc`, `voice`), 🎤 in seats and the player list, the mic state survives the switch into battle, `RTC_ICE_SERVERS` for TURN, `PROTOCOL = 3`. Tests: `rooms.test.ts` (relay), `tests/voice.spec.ts`.
Pages: [design-multiplayer.md](design-multiplayer.md).

## [2026-11-08] code | Rooms like a server browser: everyone sees them, password, return to battle
`GET /api/rooms` lists every live room (locked and full too) with creator, map, wave and players; the camp got the "Rooms" tab with a CS-style table. "Private game" is replaced by a room password (migration 004, scrypt, a pause after a wrong one). Closed the tab during a battle — the camp offers "Return to battle" (`battle.start {resume}`), in a battle the seat is held 2 min (`battleGraceMs`) instead of 30 s, after that — "Return" in the list, into a locked room without the password to the old seat. `PROTOCOL = 4`.
Pages: [design-multiplayer.md](design-multiplayer.md), [design-main-menu.md](design-main-menu.md).

## [2026-11-08] code | Server profile, phase 1: the hero is born with a profile
`POST /api/auth` creates the profile row right away — the brought one (`profile` in the body, an old browser save) or the starter one. `GET /api/profile` answers 404 only for accounts from before this change.
Pages: [design-multiplayer.md](design-multiplayer.md).

## [2026-11-08] code | Server profile, phase 2: the client keeps the hero only on the server
`Profile` no longer touches localStorage: the storage is pluggable (`setProfileStorage`) — `ServerProfileStore` in the game, memory on dev pages. Page start (`src/menu/boot.ts`): server check, the "Hero name" card on first entry, the profile from the server; the old browser save is moved to the server once. The Online panel lost its login form.
Pages: [design-multiplayer.md](design-multiplayer.md), [design-main-menu.md](design-main-menu.md), [design-inventory.md](design-inventory.md).

## [2026-11-08] code | Server profile, phase 3: gear commands instead of the kit
The battle client sends `gear` commands (equip, unequip, salvage, enchant, sutler buy and arrows) instead of the whole kit; the server checks and repeats them and charges the sutler; others get only the equipped items; the kit is taken from the database on joining, `mine` on a reconnect after changes. `PROTOCOL = 5`.
Pages: [design-multiplayer.md](design-multiplayer.md).

## [2026-11-08] code | Server profile, phase 4: tests on a server
Specs that open the camp or a battle from it start their own server (`tests/game-server.ts`, a port per file) and sign in a hero; the first-entry test checks the name card, the move of the old browser save and the "Server unavailable" card. README: the game always runs through the server.
Pages: [dev-testing.md](dev-testing.md).

## [2026-11-08] code | Faster Playwright run
An automated run does not draw frames by itself and holds game time while the test is in control; Metal GPU on macOS, 640 × 400, fully parallel, test servers on free ports, Google Fonts blocked. The island roads test is split into parallel tests, posts and loot load only the level data. The Soller test is removed. Tests finish in ~1.5 min instead of ~18; the run still lingers after the last test.
Pages: [dev-testing.md](dev-testing.md).

## [2026-11-08] decision | No tests for the playground, the editor, the world and Soller
The playground and editor tests, the world and island tests are switched off with `test.skip`, the Soller test is removed; new tests are written only for the game itself — the camp, the server, Bush Defence, the network.
Pages: [dev-testing.md](dev-testing.md).

## [2026-11-08] code | Mobs walk on the terrain
A mob stands on `ground` — the floor under its feet by `Terrain.floorAt`, like the hero: up a step of 0.5 m, down any height; `flyY` is now a height above that floor. Level blocks push mobs out height-aware (`Terrain.resolve`), the flat block slice at y = 0 (`Obstacle.grid`) stays for wardens and bullets only. Marks, landings, zones and shots of the `Field` lie on the floor under them, mob effects rise with it. Groundwork for the raised Raspberry Spiral map.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-11-08] code | Towers, piles and the bush at floor height
The simulation knows the level terrain (`SimWorld.floor`): splash, tar, meteor and frost hits land on the floor under the target, raspberry piles land on the floor, lairs and spawned enemies stand on it, the bush takes its height from `meta.td.bush.y`. Tar pools carry `y` in the snapshot; hit effects and the bush view are drawn relative to the event height.
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-11-08] code | Golden Warden on the march
`chief_warden` (`GoldenWardenChief`, `src/mobs/td-chiefs.ts`) — the arena mini-boss's horse and rider as a defence chief: 1600 health, a shield ×0.3 from the front, every 6 s a halberd sweep at towers nearby, a phalanx of seven swords at towers farther away or a gallop. The model is shared with the arena warden (`riderModel`, `src/bosses/golden-rider.ts`).
Pages: [design-tower-defence.md](design-tower-defence.md), [design-bosses.md](design-bosses.md).

## [2026-11-08] code | Map 4 "Raspberry Spiral"
A floating island in a violet dusk (`src/level/td-spiral-map.ts`, `npm run map:td4`): one road from a rune portal on the north edge winds 1¾ turns up to a mound with the bush (+2 m); the second turn climbs half a block at a time, the ridge between the turns stands at the inner turn's height. From the fifth wave a west portal opens a shortcut. 24 pads — on the ridge, on the meadow, on the mound; three radial stairways for the hero; mauve cliff blocks (`cliff_violet`, `cliff_violet_grass`), giant roots over the edge. Twelve waves for "Medium" (`src/td/waves-spiral.ts`, pack from level 4), the last — the Golden Warden. The sutler stands on a raised floor (`sutlerSpot(…, top)`, `meta.merchants[].y`).
Pages: [design-tower-defence.md](design-tower-defence.md).

## [2026-11-08] code | Raspberry Spiral in the camp
The camp map list offers four maps by difficulty: Lava Basin, Crystal Glade, Raspberry Spiral ("Medium", a spiral icon, a violet card), Castle on the Meadow. Russian strings for the map, its roads, waves and blocks.
Pages: [design-main-menu.md](design-main-menu.md), [design-tower-defence.md](design-tower-defence.md).

## [2026-11-08] code | Raspberry Spiral: tests and the wiki
`tests/td4.spec.ts`: the map, the climb along both roads, the moth over the slope, splash and piles on the plateau, the Golden Warden's shield, sweep, swords and climb. The design page gets section 17; the menu page and the index list the fourth map.
Pages: [design-tower-defence.md](design-tower-defence.md), [design-main-menu.md](design-main-menu.md), [index.md](index.md).
