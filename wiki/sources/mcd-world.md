# Source: the world of Minecraft Dungeons — yard, river, cliffs, hills, portal (9 screenshots)

Added 2026-10-24. Screenshots of the mission "W mroczną otchłań" (Unreal Engine 4), camera from above at an angle, day. Files — `mcd-world/`. The source is not edited; conclusions — in [../style-world.md](../style-world.md) (block and kit sets), roads — in [../style-terrain.md](../style-terrain.md).

| | |
|---|---|
| ![Roads](mcd-world/mcd-09-roads.webp) | ![Yard with a storage yard](mcd-world/mcd-10-yard.webp) |
| **9. Road by the village** — a ragged edge, footprints. | **10. Yard with a storage yard.** |
| ![Waterfall and bridge](mcd-world/mcd-11-waterfall.webp) | ![Cliffs](mcd-world/mcd-12-cliffs.webp) |
| **11. Waterfall, river, bridge.** | **12. Cliffs along the level edge.** |
| ![Hills and candles](mcd-world/mcd-13-hills-candles.webp) | ![Portal](mcd-world/mcd-14-portal.webp) |
| **13. Terraced hills, trees, candles on a wall.** | **14. Portal in a hill.** |
| ![Various hills](mcd-world/mcd-15-hills.webp) | ![Plateaus](mcd-world/mcd-16-plateaus.webp) |
| **15. Variety of hills.** | **16. Slab hills.** |
| ![Plateaus and a cliff](mcd-world/mcd-17-plateaus-cliff.webp) | |
| **17. Plateau with a cliff drop.** | |

## What is visible

**10. Yard.** The floor — trampled earth `#c59b5c` with dark "herringbone" strokes `#ae855e`, with ledges of half a block. Fences — light bluish-grey stone `#78787a`–`#83868e` with a stepped top (the height wanders by blocks). A stack of hay bales `#d0af54` with orange-red bindings `#ba541c`. Crates — dark wood `#9f6e5a`, iron bands, spots of yellow paint `#e4ad33`; chests, small boxes, a two-wheeled cart `#9e6647`, a bench, lanterns on curved posts `#a9844f`.

**11. Waterfall and river.** The cliff is light grey, flat, with vertical strata; the waterfall — turquoise streams `#0f7592`, white clouds of spray at the foot `#b2b3b0`–`#dbd5d0`. The river in a channel a block and a half below the grass, dark turquoise `#44687a`, light bands along the current, a white rim at the shores. The bridge — a thick deck of light boards `#b68c58`–`#cea86c`, square posts at the corners `#846438`. On the right — grassy cliff columns stepping down to the water.

**12. Level edges.** Tall cliffs of 5–8 blocks, lit `#70767a`, in shadow blue `#425966`; grass hangs down from the top as a fringe; stone steps.

**13. Hills and candles.** A hill — terraces of 1 block with a grass fringe; trees — foliage cubes `#598230` with fluffy edges, highlight `#99b956`. Candles stand on the fortress wall — a warm spot around them, without a visible light source (baked).

**14. Portal.** An opening in a hill, a frame of dark stone, inside a golden glow `#e6b144` with a bright core `#fee99a`, the walls of the opening are tinted gold; in front of it light slabs `#af9f8e`, grass encroaches onto them.

**16, 17. Slab hills** (added 2026-10-24). The hills are gentle and flat: wide slabs one above another with a 1-block step, the edges — long straight lines and stepped diagonals at 45°; on tall steps there is bluish cliff under the grass; mobs stand on the plateaus, between the levels — passages.

**15. Hills.** Grass ledges, earthen path stairs, cliff sides under the grass, patches of dry yellow-green grass `#b9b957`, white daisies.

## What we take

| Technique | Where | Status |
|---|---|---|
| Yard floor, stepped fences, hay, crates, chest, carts, bench, 3 kinds of lanterns | palette "yard", decor "storage", "lanterns", kits `steppedWall`, `hayStack` | done 2026-10-24 |
| Cliffs (light, dark, with grass, stairs), a waterfall with running streams, a river with a current, a bridge, splashes and foam | palette "cliffs and water", layers `falls` and `river`, decor "water", kits `cliffMass`, `cliffSteps`, `riverBed`, `waterfall`, `bridgeX`, `stairway` | done |
| Terraced hills, grass half-block, fluffy foliage, candles with baked light | palette "hills", decor "candles", attribute `bake`, kits `hill`, `tree`, `rampart` | done |
| Portal: animated glow, frame, lintel, floor, golden baked light | palette "portal", layer `portal`, kit `portal` | done |
| Dry grass, daisies, path stairs, a hill with a drop | palette "hills", `hill` options | done |
