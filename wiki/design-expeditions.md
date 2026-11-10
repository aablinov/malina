# Expeditions. Design document

Version 0.1 of 2026-11-10. Nothing here is in the code yet.

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

## 6. Alarm and patrols

- A patrol walks a route between lairs. On spotting the squad the **horn-blower** blows for 3 s. If it is not killed, reinforcements come out of the nearest lair.
- The mission has an alarm meter. It grows with time and with every horn call; each step makes the patrols stronger.
- Instead of a hard timer — **dusk**: at minute 15 it gets dark and the alarm grows twice as fast. It nudges the squad towards extraction and does not cut the game off.

## 7. Downed heroes and reinforcements

| Parameter | Value |
|---|---|
| Downed | lies for 20 s; a teammate revives in 3 s |
| Not revived | returns next to the nearest teammate and spends one shared "raspberry totem" |
| Totems | 4 per mission, +1 per secondary objective |
| No totems and everyone down | the mission fails; half the raspberries and the experience are kept |
| Friendly fire | none |

The downed state was first described in [design-dungeon.md](design-dungeon.md), section 10.3; it is not in the code.

## 8. Seeds and extraction

- **Seeds** of three rarities lie on the map: common, rare (from difficulty 3), golden (from difficulty 5; one or two per map, in the most dangerous place).
- Seeds are carried by whoever picked them up. When the carrier goes down they stay on the ground and anyone can pick them up.
- Seeds reach the profile only through extraction.
- **Extraction:** the squad calls the balloon, holds the pad for 90 s under waves, then everyone boards the basket.
- If the primary objective is done, the mission counts even without extraction — but the seeds are lost.

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
