# Source: hilly lands with settlements — Elden Ring and Minecraft Dungeons (17 screenshots)

Added 2026-10-29. References for the library of ready-made presets (`wiki/design-prefab-library.md`): open hills, roads, ruins and small settlements along the way. Files — `refs-settlements/`. The source is not edited; conclusions are in [../design-prefab-library.md](../design-prefab-library.md). Elden Ring gives **composition and the set of objects**, Minecraft Dungeons — **scale, density of small details and the colour range** (the style is still a child-friendly voxel one, [../style-guide.md](../style-guide.md)).

| | |
|---|---|
| ![Flagstone road, camp](refs-settlements/ref-01.png) | ![Golden trees, statues](refs-settlements/ref-02.webp) |
| **1. Limgrave: a flagstone road, a soldiers' camp with campfires, an aqueduct in the distance.** | **2. Golden larches, a stone platform with statues, windmills on the horizon.** |
| ![View of a valley with ruins](refs-settlements/ref-03.webp) | ![Site of grace and arches](refs-settlements/ref-04.webp) |
| **3. From a ledge over the valley: a ruined chapel, a village, cliffs.** | **4. A site of grace, a row of ruined arches, a castle on a cliff.** |
| ![Flower meadow](refs-settlements/ref-05.webp) | ![Windmill](refs-settlements/ref-06.png) |
| **5. A meadow in flowers, a small house and a tower on a hill.** | **6. A windmill with sails, sheds, a fence.** |
| ![Windmill village on a cliff](refs-settlements/ref-07.webp) | ![Chapel with a tree](refs-settlements/ref-08.webp) |
| **7. A windmill village on a cliff: houses, stairs, fences.** | **8. A ruined chapel with a tree inside, bowls, a round tower.** |
| ![Snowy church](refs-settlements/ref-09.webp) | ![Chapel in a graveyard](refs-settlements/ref-10.webp) |
| **9. A ruined church with a bell tower (snow).** | **10. A chapel among gravestones (red earth).** |
| ![Straw huts](refs-settlements/ref-11.png) | ![MCD: village with garden beds](refs-settlements/ref-12.webp) |
| **11. A hamlet of straw huts, dark spruces.** | **12. MCD: garden beds, TNT barrels, mushrooms, posts.** |
| ![MCD: snow](refs-settlements/ref-13.png) | ![MCD: pier](refs-settlements/ref-14.png) |
| **13. MCD: a snowy valley (another biome).** | **14. MCD: a river, a wooden pier, reeds.** |
| ![MCD: windmill at night](refs-settlements/ref-15.png) | ![MCD: jungle temple](refs-settlements/ref-16.png) |
| **15. MCD: a windmill at night, lanterns, barrels, crates.** | **16. MCD: a jungle temple, crystals (another biome).** |
| ![MCD: desert temple](refs-settlements/ref-17.webp) | |
| **17. MCD: a desert temple, columns, skeletons (another biome).** | |

## What is visible

**1, 4. The road and ruins of Limgrave.** The road is large stone slabs, some fallen out, grass and dirt in the holes; the edge is ragged, slabs trail off into the grass. At the sides — bare trees, boulders, fragments of columns. The camp: campfires with cooking pots, tents, log seats, banners on spears, weapon racks. The ruins — a row of arches of equal height (an aqueduct), some spans collapsed, rubble beneath them. The "site of grace" — a golden glow on the ground, no grass around it.

**2. The platform with statues.** A stone slab platform with stairs down, two hooded statues on pedestals at the edges. Golden larches — conical crowns in two tones (yellow and orange), a dark trunk. In the distance windmills on the hills and gravestones.

**3, 7. The village on the cliff.** Windmills — round stone towers with latticed sails of slats; four sails, one often broken. Houses — a stone base, a wooden upper part, a dark roof, external staircases and ladders, awnings. Fences of poles, leaning. The road — trampled orange earth. In the yard goats, barrels, crates, haystacks.

**5. The meadow.** Flat grass solidly covered in flowers: white, pink, orange, lilac in patches of 2–3 m. On the hill a small stone house with a half-ruined roof and a turret. Trees dark green, round.

**6, 15. The windmill with a yard.** The windmill — a tower of 8–9 blocks, sails spanning the tower's height, at the foot thatched awnings, sheds of dark planks, a fence, a well. At night: lanterns on posts, barrels, crates, pumpkins by the wall (MCD).

**8, 9, 10. The ruined chapel.** A rectangular roofless nave, a bell tower of 2–3 tiers with arched windows, walls broken off in steps, arches at half height; inside a tree or an altar. Around it stone bowls, pots, rubble, bones, gravestones, ivy. On red earth — a graveyard: gravestones of three shapes, crosses, fallen slabs.

**11. The straw huts.** Low log houses with hip roofs of thatch, a campfire by the entrance, dark spruces, grey earth.

**12, 14. MCD: the village and the pier.** Garden beds with sprouts inside edges, a scarecrow, posts with lanterns, TNT barrels, glowing mushrooms, pumpkins. A river and a wooden pier on posts, reeds by the shore, barrels on the pier.

**13, 16, 17.** Other biomes: snow and jungle with crystals — done (batches 6 and 7 of the preset library); the desert with columns and skeletons — for later.

## What we take

| Technique | Where | Status |
|---|---|---|
| Preset library: format in the repository, generation by code, blocks + decor + light, 90° rotation, a tab in the editor, the showcase `?map=prefabs` | `src/level/prefab-lib/`, `assets/prefabs/`, `scripts/gen-prefabs.ts`, [../design-prefab-library.md](../design-prefab-library.md) | done 2026-10-29 (batch 1: 4 trial presets; batch 5: 5 compositions from medium ones — a village with a windmill, a hamlet, a bandit camp, ruins by a graveyard, a ledge with a statue) |
| Flagstone roads with fallen-out slabs, meadows in flowers, a pond and a stream, golden and bare trees, a spruce, boulders | the "Road and nature" batch: 20 builders, blocks `leaves_gold`, `flower_orange`, `tiles_broken`, decor `tree_dead`, `reeds`, `stump`, `rock_small`, `leaf_litter` | done 2026-10-29 |
| Arches, an aqueduct, a chapel with a bell tower, statues, a site of grace, a graveyard, bowls | the "Ruins" batch: 11 builders, ruined brick with stairs and a wall, decor — gravestones, cross, statue, bowl, pots, ivy, skull | done 2026-10-29 |
| A windmill with sails, houses, huts, fences, a well, garden beds, a camp, a pier | the "Settlement" batch: 17 builders, `crops` blocks, thatch and shingles, 14 decor items (barrels, sacks, well, ladder, tent, scarecrow, firewood, signpost, broken cart) | done 2026-10-29 |
| Snow: snowy ground, ice, snowdrifts, icicles, a snowman, snow variants of buildings, a winter hamlet | the "snow" biome, `builders-snow.ts`, ground selectable in terrain | done 2026-10-29 |
| Jungle (screenshot 16): damp ground with moss, glowing crystals, a temple of carved stone, trees with buttresses, vines, an idol | the "jungle" biome, `builders-jungle.ts`, 14 builders, the "Jungle" set | done 2026-10-29 |
| Jungle with crystals, desert temple | the "jungle" and "desert" biomes | plan |
