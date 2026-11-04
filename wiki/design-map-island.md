# Map 1 "Island": the first map made of presets

Version 1.0 of 2026-10-30. The plan — the drawn map [sources/map-01.md](sources/map-01.md) (markup `sources/map-01/plan.png`); presets — [design-prefab-library.md](design-prefab-library.md); mobs — [design-mobs.md](design-mobs.md); wardens — [design-bosses.md](design-bosses.md); regions — [dev-performance.md](dev-performance.md).

## 1. What it is

The first real map: 256 × 256 m, a main island and four small ones connected by bridges. The generator `src/level/island-map.ts` assembles it from the preset library (`npm run map:island` → `assets/maps/island.json`); play — `dist/index.html?map=island`. The map is over 400 chunks, so it streams in 32 × 32 m regions. The path from the start to the boss with a detour through the village is ~700 m, 12–15 minutes with fights.

Coordinates in the generator are **pixels of the plan image** (1932 × 1916); `px` / `pz` convert them to metres: 1 m ≈ 7.5 px, the image centre is the origin. So the plan and the code speak the same language: any point from the picture goes into the code as is.

## 2. Assembly rules

- **Everything gameplay-related is at height 0.** Mobs, chests, crates, barrels and merchants stand only on flat ground (`y = 0`, block top `y = −1`). Relief is impassable rock outcrops (`rockOutcrop`); terrain in plates is not used.
- **The sea cannot be waded.** Water is passable knee-deep, so along the whole shore there is a cliff rim of 1–2 blocks (a block cannot be stepped over), and between the islands there are bridges with fence railings (`SEA_BRIDGES`, along the axes). The rim is removed at the bridge ends.
- **Rivers are shallow** — the `river` block with a current, wadeable; where a road crosses them there is a `bridge_deck`. A river is decoration and a landmark, not a barrier.
- **Biomes** — polygons (`BIOMES`): ground by biome (grass / snow / jungle mosaic / sand by the shore / gravel by the springs), cliff tops by biome too (`cliff_grass` / `cliff_snow` / `cliff_jungle`), forest by its own polygons (`FORESTS`): oaks and golden larches, jungle, spruces under snow, palms by the village.
- **Caves** (`CAVES`): a rock outcrop with a 3 × 3 passage cut through it and a 7 × 7 hall 3 high with a vault, crystals and torches; in the game the vault is cut away when the hero is inside.
- **Fort** — a `stake_fence` palisade with two gates on the road and banners; inside — a camp, watchtowers, a house, a haystack. **Temple** — a fence of temple stone with three gates (east — the main one, south — to the hill, north — to the snow); the whole yard inside is the warden's arena.
- **Occupancy grid** (`used`): roads, presets, posts, loot and walls are marked; forest and grass are seeded only on free cells; for presets the rotated footprint is taken into account.

## 3. What is in the map's `meta`

The map carries its gameplay filling in `meta`; the playground reads it when opened with `?map=…` (`src/dev/playground.ts`):

| Field | What |
|---|---|
| `mobRooms: MobRoomSpec[]` | enemy groups as mob rooms: a rectangle (computed from the posts ± 6 m), `enter`, posts `{ kind, x, z, aggro?, route? }`, `respawn: false` — the fallen do not return. `aggro` — from what distance it sees the hero (ambush — 3–9 m, otherwise 9), `route` — patrol points: the mob walks them in a loop at half speed until it notices the hero (`Mob.route`, `patrol()` in `src/mobs/mob.ts`) |
| `arenas: BossArenaSpec[]` | warden arenas: `id` from `MINI_BOSSES`, `home` — where the warden stands, `gates[]` — several gates (portcullises drop in all of them), `trigger`, `exit` |
| `merchants` | `{ kind: 'smith' \| 'merchant', x, z, yaw }` — shops |
| `goal` | `[title, subtitle]` of the quest in the HUD |
| `spawn`, `spawnYaw` | the spawn point |

Loot — map entities `chest` / `crate` / `barrel` / `terminal` (the health fountain — a new kind, `src/world/map-source.ts`, `Props.addGroup`): they become region props with stable ids; what is opened or broken does not come back. Enemy obstacles under streaming are computed per region on load (`regionObstacles` in the playground), not from the empty map at start.

## 4. Route and groups

Start — the camp by the tent in the south-west. The main road: palms (raspberry sprouts, slimes) → hot springs (boarlets, beetle ambush, a watchtower with archers, a camp of gatherers and gardeners) → wolves in the grove → the hamlet on stilts (merchant) → the Thorn Garden on the beds (vines, buds, the monster, the scarecrow) → the Order's fort (shield-bearers, squires, spearmen, crossbowmen on the towers, a standard-bearer, a hammerer) → bridge B1 → the peaceful village (blacksmith, merchant, health fountain). From the fort a flagstone road over a small bridge to the temple: the guard (mages, a healer, a summoner, an obelisk with little golems, mimics) and the **Druse Golem** on the square in front of the pyramid.

Patrols walk the roads (gardeners in the south, two Order squads between the hamlet, the fort and the temple, slimes by the temple, wolves in the palms); ambushes stand by the roads with a small `aggro` (beetles under the path, a vine-weaver with raspberry sprouts in the grove, tangles by the fort gates, wisps with kegs in the ruins, a boarlet on the path, a cauldron by the cliff, buds by the bridge). Side branches with chests: the snow cave (wisps, cauldrons, kegs), the West Hill (a pond with slimes, Soller by the statue, a grotto with a mimic), a ledge with a catapult beyond bridge B2, an islet beyond B3, a cliff beyond B4.

In total 28 groups, ~100 mobs of 26 kinds, 12 magic chests, crates and barrels by the camps, the fort, the hamlet, the temple and the village.

## 5. Test and next

`tests/island.spec.ts`: the map loads by regions without errors, the hero stands on the ground, groups, the warden, merchants, loot and the goal are set up from `meta`; all roads of the plan are passable by pathfinding segment by segment, posts and loot are on free ground, a patrol walks, an ambush sleeps at 6 m and wakes at 2.5 m.

Next: play it and tune the density of enemies and loot, waterfalls at the drops, a second floor on the hamlet, bring back the ships once there is a preset.
