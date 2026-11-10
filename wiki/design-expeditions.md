# Expeditions. Design document

Version 0.6 of 2026-11-11. In the code: stages 1–6 (section 11) — missions are played solo and in a room from the camp's "Expeditions" tab, with the alarm, horn-blowers, dusk, revive, totems and parcels. Not in the code yet: operations, the difficulty ladder, modifiers, camp beds and the order of the day (stage 7).

**Decision:** [adr-006-expeditions.md](adr-006-expeditions.md). **Source:** [sources/helldivers2.md](sources/helldivers2.md).

All numbers are starting values, tuned by playtests.

## 1. Essence and loop

A co-op mode for 1–4 players. The squad picks a mission on the board in the camp, lands on a large seeded map, completes objectives, collects seeds and leaves by balloon. The tone is a kind adventure for ages 10–14: no friendly fire, no hard wipe.

**Loop:** camp → "Expeditions" tab → pick an operation and difficulty → gear and parcels → pick a landing point on the map sketch → mission, 12–18 min → extraction → results → next mission of the operation or the camp.

## 2. Mission board

- The board offers 3 operations. The set depends on the date and the difficulty and changes once a day.
- An operation is 2–3 missions in a row with one biome and shared modifiers. Each next mission raises the reward multiplier; a finished operation gives a bonus.
- A mission card shows the primary objective type, the number of secondary objectives, the biome, the modifiers and the expected reward.
- The host chooses, the others mark themselves ready — as with the Bush Defence map today ([design-main-menu.md](design-main-menu.md)).

**In the code** (stage 4): a mission is a map name — `exp:<seed>:<difficulty>:<objective>:<landing>` (`src/expedition/mission.ts`). A room, a match record and the battle page address carry it where a Bush Defence map carries its file name, so the lobby protocol and the database did not change. The camp has an "Expeditions" tab (`src/menu/expeditions.ts`): difficulty buttons 1–8, the day's three missions (one of each objective, the same for every player, changing at midnight UTC), and the card of the chosen mission with a sketch of its map — lairs, objective sites, the balloon pad and three landing points to click. Operations (chains of missions) and unlocking difficulties one at a time are stage 7; for now every difficulty is open.

**Network:** the server builds the mission's level from its name (`MapCatalog.load`) and runs it (`Match`); the client sends one message, `exp` — "use"; the battle page keeps a mirror of the rules filled from snapshot records (`SimExpedition.mirror`), so the HUD, the hints and the map read the same object as in single player. When the match ends the server adds the loot and the banked seeds to the profiles (`ProfileData.seeds`); in single player the page credits them itself.

## 3. Mission map

One procedural map by seed, 160 × 160 m in the first version, one biome. On it:

| What | How many |
|---|---|
| Landing points to choose from | 3 |
| Primary objective | 1, in 2–3 steps |
| Secondary objectives | 2–3 |
| Enemy lairs (small, medium, large) | 3–5 |
| Points of interest with loot | 6–10 |
| Patrols | between the lairs |
| Extraction point | 1 |

The generator checks that every landing point has a path to all objectives and to the extraction point.

**In the code** (`src/level/expedition-map.ts`, `buildExpedition({ seed, difficulty, objective }, prefabs)`): sites are placed by rejection sampling — the extraction pad and the landings on the outer ring (50–64 m from the centre, landings at least 38 m apart), lairs, objective sites, secondary objectives and points of interest inside. The ground is grass with 0.5 m terraces, flat under sites and patrol lines; a cliff rim closes the map; rock outcrops and prefab trees never stand on a site or a patrol line. If the sites do not fit or an objective is unreachable, the generator retries with a derived seed (up to 12 times). The description goes to `meta.expedition` (`src/expedition/types.ts`). A map builds in 50–160 ms.

**Garrisons** (`src/sim/garrison.ts`): guards at lairs, objective sites and secondary objectives, ambushes at every other point of interest, a patrol from each lair to the next. Kinds come from three tiers opened at difficulty 1, 3 and 5. A garrison farther than 30 m from every hero sleeps: its mobs do not think and are not sent in the snapshot; it wakes when a hero comes near and stays awake while anyone in it has noticed a hero.

## 4. Objectives

Every objective is assembled from what the simulation already has ([design-tower-defence.md](design-tower-defence.md), [design-mobs.md](design-mobs.md), [design-bosses.md](design-bosses.md)).

| Objective | What the squad does | Built on | Version |
|---|---|---|---|
| Burn the lairs | destroy N lairs | lairs, walls with durability | first |
| Light the beacons | activate N beacons with F and hold each for 20 s | the lanterns of map 5 | first |
| Plant a bush | carry a seedling, plant it, hold 3 waves | the bush and defence waves — the game's signature mechanic | first |
| Defeat the warden | find the arena and beat a mini-boss | boss arenas (need multi-hero support) | later |
| Rescue the gardeners | free captives in garrisons and lead them to extraction | garrisons; escort is new | later |
| Bring out the harvest | collect baskets across the map and carry them to the cart | piles and drops; carrying is new | later |

**In the code** (`src/sim/expedition.ts`, `src/sim/objective.ts`): everything besides fighting is one command, `use` (F) — it acts on what the hero stands next to.

| Objective | How it plays now |
|---|---|
| Burn the lairs | every lair is a target with health (160 / 260 / 420 by size, +50 % per extra player) for sword, arrows and spells; all burnt — done |
| Light the beacons | F lights a beacon and a raid marches on it; the charge grows while a hero stands within 6 m and drains at half speed when nobody does; 20 s — lit |
| Plant a bush | the plot's guards must fall first; F plants a bush with 320 health; three raids march on it, 6 s apart; all beaten — done. A withered bush loses the mission. There is no seedling to carry yet |

A raid comes out of the nearest standing lair within 42 m, otherwise out of the woods 22 m away. Lairs that are not the objective can be burnt too — for loot.

**Secondary objectives:** an Order chest, an altar with a blessing for the mission, a watchtower (reveals the map around it), a nest of horn-blowers (while it stands, the alarm rises faster).

## 5. Parcels from the camp

The counterpart of stratagems.

- 3 slots, chosen in the camp before the mission.
- Called with a key and a ground reticle, arrive in 3 s, each has its own cooldown.
- First set:

| Parcel | Effect |
|---|---|
| Tower | any of the five existing towers, stands for 60 s |
| Supply crate | potions and arrows |
| Spell volley | an area strike |
| Healing totem | heals heroes nearby |

Towers are the main find: the game already has five towers with levels and abilities; in Expeditions they become portable sentries.

**In the code** (stage 6, `src/sim/parcel.ts`): three slots on Z, X and C; a parcel is called to the aim point no farther than 16 m from the hero and lands in 3 s; the slot then rests.

| Parcel | What it does | Slot rest |
|---|---|---|
| Tower — archer, frost, catapult, brazier, obelisk | the defence's own tower at level I, stands 60 s where it landed, enemies attack it like any tower | 70–90 s |
| Spell volley | 70 damage and a knockback to every enemy within 4.5 m | 45 s |
| Healing totem | stands 12 s, heals 8 health a second to heroes within 5 m | 80 s |

The set is picked in the camp under the gear (a click on a slot puts the next kind in) and stored in the profile (`ProfileData.parcels`); the default is the archer tower, the volley and the totem. The supply crate with potions and arrows is not made: arrows live in the hero's profile copy, which the client predicts — it needs its own message, left for later.

## 6. Alarm and patrols

- A patrol walks a route between lairs. On spotting the squad the **horn-blower** blows for 3 s. If it is not killed, reinforcements come out of the nearest lair.
- The mission has an alarm meter. It grows with time and with every horn call; each step makes the patrols stronger.
- Instead of a hard timer — **dusk**: at minute 15 it gets dark and the alarm grows twice as fast. It nudges the squad towards extraction and does not cut the game off.

**In the code** (stage 5): the alarm is a number, 100 points per level, four levels. It grows by a level every four minutes, 1.5 times faster while a horn-blowers' nest stands and twice as fast after dusk (minute 15, the scene turns to night). Every level adds one to the pack level of everyone on the map and one enemy to every raid. The first mob of each patrol carries the horn: once it notices a hero it blows for 3 s; killed in that time — nothing happens; otherwise the alarm gets +50 and a raid marches to where the squad was seen; the same patrol calls again no sooner than 30 s later. A horn-blower has no model of its own yet — a note sign and a ring mark it.

## 7. Downed heroes and reinforcements

| Parameter | Value |
|---|---|
| Downed | lies for 20 s; a teammate revives in 3 s |
| Not revived | returns next to the nearest teammate and spends one shared "raspberry totem" |
| Totems | 4 per mission, +1 per secondary objective |
| No totems and everyone down | the mission fails; half the raspberries and the experience are kept |
| Friendly fire | none |

**In the code** (stage 5): the mission rules own the downed state (`Rules.ownsDowned`, `SimHooks.raise`) — a hero no longer gets up by himself after 2 s. A teammate standing within 2.4 m lifts him in 3 s without pressing anything. After 20 s without help (3 s when nobody is left standing) a totem lifts him next to the nearest standing teammate. With no totems and everyone down the mission ends: failed with half the loot kept, or counted without the balloon and its seeds if the primary objective was already done. A withered bush fails the mission the same way.

The downed state was first described in [design-dungeon.md](design-dungeon.md), section 10.3; it is not in the code.

## 8. Seeds and extraction

- **Seeds** of three rarities lie on the map: common, rare (from difficulty 3), golden (from difficulty 5; one or two per map, in the most dangerous place).
- Seeds are carried by whoever picked them up. When the carrier goes down they stay on the ground and anyone can pick them up.
- Seeds reach the profile only through extraction.
- **Extraction:** the squad calls the balloon, holds the pad for 90 s under waves, then everyone boards the basket.
- If the primary objective is done, the mission counts even without extraction — but the seeds are lost.

**In the code:** points of interest are picked up by walking over them (raspberries into the mission purse, a seed into the bag); a fallen hero spills his seeds on the ground. The balloon can be called only after the primary objective; while it flies a raid comes every 22 s; after landing it waits 20 s or leaves at once when everyone standing is on the pad (5 m). Who is on the pad banks his seeds, and the whole squad's match loot grows by a quarter. With nobody aboard the mission still counts. Seeds are counted in the match but do not reach the profile yet (stage 4).

## 9. Modifiers

One or two per operation.

| Modifier | Effect |
|---|---|
| Mist | as on map 5 |
| Downpour | parcels take longer to arrive |
| Full moon | dusk comes earlier, more golden seeds |
| Order's fury | more patrols, more raspberries from enemies |
| Quiet forest | no horn-blowers, but the lairs are tougher |

## 10. Keeping the player interested

| Horizon | Hook | What it is here |
|---|---|---|
| Minute | a decision right now | kill the horn-blower or run; spend the parcel or save it |
| Mission | the extraction stake | a golden seed lies behind the large lair, and two totems are left |
| Evening | an operation of 3 missions | a growing multiplier and a bonus for the full operation |
| Day | the board refresh and the order of the day | "light 6 beacons", "carry out 10 rare seeds" — raspberries and seeds as the reward |
| Weeks | the difficulty ladder, 1–8 | each step unlocks an enemy, a modifier and a seed rarity |
| Months | camp beds | seeds are planted in beds: new parcels, a fourth slot, an extra totem, starting raspberries. Nothing expires |
| Always | collections and cosmetics | the book of relics (twenty exist), mastery stars per objective type, cloaks and banners for achievements |

**Deliberately not done:** seasons with expiring progress, daily penalties for skipping, a war map shared by the whole server.

## 11. Stages

One commit per stage.

| Stage | What | Done when |
|---|---|---|
| 1 | The server is unbound from Bush Defence: match rules behind one interface, an explicit mode on the match map | defence tests are green, behaviour unchanged |
| 2 | Mission generator by seed; garrisons and patrols in the simulation | one seed gives one map hash; objectives are reachable on 50 seeds |
| 3 | Objectives (three types), seeds, extraction; solo at `?map=expedition&seed=N` | **first playable version** |
| 4 | Network and the mission board; rewards and seeds in the profile | two players go from the board to the results screen |
| 5 | Horn-blower, alarm meter, reinforcements, dusk; revive and totems | — |
| 6 | Parcels | — |
| 7 | Operations, the difficulty ladder, modifiers, camp beds, the order of the day | — |

**Later:** escort and carrying, the warden objective, new biomes, snapshot filtering by distance, cosmetics.

## 12. Risks

| Risk | What we do |
|---|---|
| Pathfinding is sized for a field of about 85 × 85 m; enemies have a budget of 4 paths per tick | a 160 m map; patrols walk between points the generator has checked for passability |
| A snapshot sends every enemy to every player | sleeping garrisons stay out of the snapshot; filtering by distance is a separate task if traffic grows |
| Generation on the server and the client diverges | one generator module, only the seeded generator, a hash test |
| Stage 1 breaks Bush Defence | defence behaviour does not change; existing tests are the stage's criterion |
| The operation's state is lost on the page reload between menu and battle | the operation is kept in the room on the server |
