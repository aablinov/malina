# Regular mobs — the host of the Order of the Raspberry

Version 2.1 of 2026-10-31: #38–39 — castle siege enemies (stump sapper with armour and gunpowder, vine ballista) in `src/mobs/td-foes.ts`; a hit with zero direction is piercing, past shields and armour (`Mob.hit`); `Mob.extendMarch` — the road continues after a breach — [design-tower-defence.md](design-tower-defence.md), section 9. Version 2.0 of 2026-10-31: #35–37 — Crystal Glade enemies (shellback, sporeling, hopper) in `src/mobs/td-foes.ts` — [design-tower-defence.md](design-tower-defence.md), section 8. Version 1.9 of 2026-10-30: #32–34 — Bush Defence enemies (courier, battering ram, moth) in `src/mobs/td-foes.ts`, not in the showcase buttons — [design-tower-defence.md](design-tower-defence.md). Version 1.8 of 2026-10-30: march along the road for Bush Defence — `march`, `progress`, leash, alarm from a hit only when the hero is nearby — [design-tower-defence.md](design-tower-defence.md). Version 1.7 of 2026-10-30: posts with `aggro` (ambush) and `route` (patrol along points until the hero is spotted), groups on the map from `meta.mobRooms` without the fallen returning — [design-map-island.md](design-map-island.md). Version 1.6 of 2026-10-25: Soller, Knight of the Sun — a rare strong loner, #31 (section 2G; how it is built — section 5). Version 1.5 of 2026-10-25: fourth batch — constructs (26–30), the "Order Workshop" room; all 30 done (section 5). Version 1.4: third batch — families D and E (17–20, 22–25), the "Old Graveyard" and "Beast Lair" rooms, hero slowdown from mob zones (section 5). Version 1.3: second batch — families B and C in full (6–9, 11–15), the guard with a banner in the barracks, the new "Bramble Garden" room (section 5). Version 1.2: the Order Barracks behind the playground's west wall — a garrison from the first batch on posts (section 5). Version 1.1: first batch done — 8 mobs (1, 2, 3, 4, 5, 10, 16, 21), the `Mob` class, the pack, the showcase in F1 (section 5). Version 1.0: plan — 30 regular mobs in six families. Style and lore as for the wardens, [design-bosses.md](design-bosses.md); hordes and room budget — [design-dungeon.md](design-dungeon.md), section 5.

## 1. General rules

- **Simpler than wardens.** 1–6 moving parts (wardens have up to 8), the silhouette reads in a crowd from 20 m. The same skeletons: golem, mage, beast, relic, plus a "little one" of 1–2 cubes.
- **Everyone bears the mark of the Order:** a berry crest, a crown of drupelets or a raspberry vine. **The berry heart is only for elites:** any mob can be elite — health ×3, size ×1.3, an aura, one property (speeds up neighbours, explodes on death, summons little ones, regenerates).
- **One attack and one trick.** Before every attack a mark on the floor (a circle or a strip) for at least 0.5 s. Each has a clear way to beat it (the "How to beat" column).
- **Light shows the role:** white — knights, green — healers, raspberry — attackers, purple — summoners.
- **Points** — the cost in the horde budget; **raspberries** — 1–5 berries per mob.
- **Tone** — a kind adventure in the spirit of Minecraft Dungeons, not Dark Souls.

## 2. The list

### A. Mages of the Order — "mage" skeleton, like an illager evoker

| # | Mob | Role | How it attacks | How to beat | Points |
|---|---|---|---|---|---|
| 1 | **Berry Healer** | heals | a green beam heals a wounded ally; a healing ring every 8 s | the beam is visible — hit her first; a hit interrupts the cast | 6 |
| 2 | **Ember Mage** | attacks | fire berries in an arc onto marks; up close — teleports away | corner it, hit it during the cast | 6 |
| 3 | **Vine Summoner** | summons | a circle on the floor → 3 berrylings or a whip vine; no more than 6 summoned | stands still while casting | 7 |

### B. Knights of the Raspberry — "golem" skeleton

White armour with raspberry trim, a raspberry on the shield, a red cloak with a white berry (one plate), the helmet slit glows.

| # | Mob | Role | How it attacks | How to beat | Points |
|---|---|---|---|---|---|
| 4 | **Squire** | crowd | short sword, two swings | weak armour | 3 |
| 5 | **Shieldbearer** | wall | a tower shield holds hits from the front (×0.2), a shield bash knocks back | go around and hit the back, magic on marks | 6 |
| 6 | **Spearman** | reach | a spear thrust at 4 m along a strip | sidestep, open after the thrust | 4 |
| 7 | **Crossbowman** | shooter | a bolt along a line mark | 2 s reload — defenceless | 4 |
| 8 | **Bannerman** | support | plants a banner: knights nearby +25% damage and speed | break the banner (3 hits) | 7 |
| 9 | **Hammerer** | tank | a two-handed hammer on a circle mark | slow, stunned after the strike | 9 |

### C. Spawn of the bush — living raspberries

| # | Mob | Role | How it attacks | How to beat | Points |
|---|---|---|---|---|---|
| 10 | **Berryling** | swarm | a berry on legs, bites | drops in one hit, hit in a circle | 1 |
| 11 | **Berry Slime** | crowd | hops, sticks | on death splits in 2, then once more | 3 |
| 12 | **Prickle Ball** | rush | curls up like a hedgehog and rolls along a strip | ran into a wall — stunned | 3 |
| 13 | **Whip Vine** | trap | grows out of the ground, does not walk, lashes in a 3 m circle | hit from afar or with magic | 3 |
| 14 | **Spitting Bud** | turret | spits seeds in an arc onto marks | closes while spitting — hit in the pause | 4 |
| 15 | **Bramble Horror** | tank | tall, woven of vines; pulls the hero in with a vine | exposes its back after the lunge | 8 |

### D. Fallen gardeners — the undead of the Order

| # | Mob | Role | How it attacks | How to beat | Points |
|---|---|---|---|---|---|
| 16 | **Withered Gardener** | crowd | a zombie with a hoe | slow | 2 |
| 17 | **Sickle Reaper** | rush | a fast skeleton, double swing | fragile | 3 |
| 18 | **Bone Archer** | shooter | thorn arrows, keeps its distance | get up close | 3 |
| 19 | **Mourning Wisp** | hunter | flies through walls, bursts nearby and slows | knock it down on approach | 2 |
| 20 | **Scarecrow** | summon | 3 crows out of the hat every 6 s; up close hits in a circle | hit between flocks | 5 |

### E. Beasts of the Order

| # | Mob | Role | How it attacks | How to beat | Points |
|---|---|---|---|---|---|
| 21 | **Raspberry Wolf** | pack of 3 | surround, a leap on a mark | missed — open | 3 |
| 22 | **Berry Boarlet** | ram | a charge along a strip (little brother of the Frost Boar) | ran into a wall — stunned | 4 |
| 23 | **Berry Beetle** | ambush | burrows, a mound creeps towards the hero, surfaces | surfaced — open | 4 |
| 24 | **Vine Weaver** | control | a spider weaves a web of vines on the floor, it slows | the web burns from fire | 4 |
| 25 | **Order Hive** | spawner | releases a swarm of bumblebees while intact | break the hive itself | 5 |

### F. Constructs and relics

| # | Mob | Role | How it attacks | How to beat | Points |
|---|---|---|---|---|---|
| 26 | **Druse Golemling** | heavy | a ground slam — a wave of spikes along a strip | its arms get stuck in the ground | 8 |
| 27 | **Hopping Pot** | zone | a leap onto the hero, splashes on landing, boils over up close | open after the leap | 5 |
| 28 | **Guardian Obelisk** | support | a dome over allies within 6 m: they take half damage | break the obelisk first | 6 |
| 29 | **Basket Mimic** | surprise | pretends to be a reward and bites | drops lots of raspberries | 5 |
| 30 | **Jam Keg** | sapper | rolls towards the hero, a 1.5 s circle mark, explodes with sticky jam | run away or detonate it among enemies | 3 |

### G. Loners — rare strong warriors, not of the Order

| # | Mob | Role | How it attacks | How to beat | Points |
|---|---|---|---|---|---|
| 31 | **Soller, Knight of the Sun** | loner | a series of three strikes with a straight sword; from afar — a sun spear along a strip mark; below half health prays to the sun once and heals | step aside from the spear, hit after the series, interrupt the prayer with a hit | 14 |

**Who he is.** A wandering warrior who praises the sun — the thing that grows raspberries. Not of the Order: no berry crest, a sun on his tunic. Met rarely and always alone; not a mini-boss (no arena, no heart, no grimoire), but the strongest of the regulars.

**Armour — an exact copy of the references (Solaire of Astora, Dark Souls):** a tall bucket helmet of worn steel with a flat top; a T-shaped visor — a full-width eye slit and a vertical bar with five rivets; a fluted steel gorget; a long red plume at the back left, swept backwards; an olive-grey hood in folds around the neck; pale green shaggy pauldrons with a ragged edge; a dirty-white tunic with a red sun — 9 wavy rays, a yellow disc with a face and red speckles; a fringed hem to mid-thigh; a wide brown belt with diamond-shaped studs and a second belt diagonally; chainmail sleeves, leather bracers, steel cuffs; chainmail leggings, steel greaves to the knee, chainmail boots; a straight sword in a scabbard at the left hip.

**Idle — "Praise the sun":** arms raised in a V, palms open, head thrown back; a warm pillar of light falls from above, a golden spot on the floor, dust motes swirl in the beam. Sees the hero at 6 m (or when hit): lowers his arms, draws the sword, the beam goes out. The hero went far away — Soller returns to his spot with full health, arms up again, the beam is back.

## 3. How rooms are assembled

- **Roles:** crowd (4, 10, 11, 16), rush (12, 17, 22), shooters (7, 14, 18), tanks (5, 9, 15, 26), support (1, 8, 28), summon (3, 20, 25), control and zones (13, 24, 27, 30). Any 3–4 families make an interesting room.
- **"Who to hit first" combos:** the bannerman with shieldbearers, the healer behind knights, the obelisk with mages.
- **Families by floor (a sketch):** garden — the bush and the beasts, crypt — the gardeners, citadel — knights and mages, constructs — everywhere.

## 4. Order of work

1. ~~A shared `Mob` class — a lightweight `MiniBoss` brain without an arena or rage~~ — done.
2. ~~First batch, 8 mobs: 1, 2, 3, 4, 5, 10, 16, 21~~ — done.
3. ~~Second batch: knights (6–9) and spawn of the bush (11–15)~~ — done.
4. ~~Third batch: fallen gardeners (17–20) and beasts (22–25)~~ — done.
5. ~~Fourth batch: constructs (26–30)~~ — done. All 30 exist; next — verify by play and bring the mobs into the dungeon hordes.
6. ~~Soller, Knight of the Sun (31): model from the references, prayer under the beam, combat, the Sun Glade in the playground~~ — done. In the dungeon — one, with a ~15% chance per floor, outside the horde budget (once dungeon hordes take mobs).

## 5. How it is built

- **`src/bosses/field.ts`** — `Field`: marks (circle, strip), projectiles in an arc, hazard zones. Extracted from `MiniBoss` — a warden and every mob have their own field.
- **`src/mobs/mob.ts`** — `Mob` (a subclass of `Boss`: health and damage scale as for wardens, flash, shimmer). Brain: climbs out of the ground → stands until it sees the hero at 14 m or is hit (neighbours within 8 m notice too) → chase with `keep` distance → attack → `daze` → death (topples, crumbles, raspberries). No heart and no rage. `guard(dir)` — damage fraction (shield), `heal(n)` — healing with a green number, knockback from a hit is divided by `mass`.
- **`src/mobs/pack.ts`** — `Pack`: the pack — spawn from the roster, a squad in a ring `squad`, jostling (the light one yields to the heavy one), scale, raspberries from the fallen (summoned ones drop none). Mobs do not crowd onto the hero — they yield to him.
- **`src/mobs/roster.ts`** — `MOBS` (id → name and class) and `SQUADS` (showcase squads).
- **Mobs:** `mages.ts` — healer (`healer`), ember mage (`pyro`), summoner (`summoner`); `knights.ts` — squire (`squire`), shieldbearer (`shield`), spearman (`spear`), crossbowman (`crossbow`), bannerman (`banner`), hammerer (`hammer`); `critters.ts` — berryling (`berryling`), withered gardener (`gardener`), raspberry wolf (`wolf`); `bush.ts` — slime (`slime`, fragments `slime_mid`, `slime_small`), prickle ball (`hedgehog`), whip vine (`vine`), spitting bud (`bud`), bramble horror (`horror`); `fallen.ts` — sickle reaper (`reaper`), bone archer (`archer`), mourning wisp (`wisp`), scarecrow (`scarecrow`) and its crows (`crow`); `beasts.ts` — berry boarlet (`boarlet`), berry beetle (`beetle`), vine weaver (`spider`), hive (`hive`) and bumblebees (`bee`); `constructs.ts` — druse golemling (`druseling`), hopping pot (`pot`), guardian obelisk (`obelisk`), basket mimic (`mimic`), jam keg (`keg`).
- **The obelisk's dome:** gives mobs within 6 m `ward` — damage to them ×0.5 (purple sparks overhead, the caption "dome"); the dome's border is a ring on the floor, visible while the obelisk is in combat.
- **Shared in `Mob`:** `dash(dir, speed, dt)` — a dash, true means it hit a wall (prickle ball, boarlet); `ghost` — flies through walls (wisp); `vanish()` — fall without a hit (the master fell — crows and bumblebees drop, the wisp burst on its own); `heroSlow` — slowdown from the mob's zones. **`Field.shot`** — a straight shot (bolt, arrow), visual only: the shooter computes damage by the strip mark.
- **Hero slowdown:** the hero has a `slow` field (0..1, `src/knight.ts`); the playground sets it every tick from mob zones (no more than 0.8): the vine weaver's web — 0.45, the wisp's cold puddle — 0.35. Warden zones with `slow` (ice and the like) still do not slow — not wired up.
- **The banner:** knights have the `knight` flag; the bannerman's banner gives knights within 6 m `rally` — damage (`dmgMult`) and speed (`pace`) +25%, raspberry sparks overhead. The planted banner is a separate target (`Mob.extras()`, the pack hands it over in `targets()`), it falls after any three hits; after 6 s the bannerman plants a new one. The bannerman fell — the banner falls.
- **Numbers (level 1, solo):**

| Mob | Health | Strike | Window |
|---|---|---|---|
| Healer | 45 | staff shove 4; the beam heals 9/s for up to 2.4 s; ring +30% within 5 m every 8 s | a hit during the beam — "interrupted!", stunned 1.2 s |
| Ember Mage | 40 | 3 berries on 1.3 m marks, 9 each + burning floor 4/s for 2 s | teleport every 6 s; a 1.5 s volley standing still |
| Summoner | 50 | shove 5; 3 berrylings every 7 s, no more than 6 of its own | a 1.7 s summon standing still |
| Squire | 45 | two swings along a 2.3 m strip, 6 each | — |
| Shieldbearer | 80 | shield bash along a 3 m strip — 10, knockback 8 | shield in front ×0.2; lowered for 1.1 s after the bash |
| Berryling | 12 | bite 4 in a 0.7 m circle | — |
| Gardener | 40 | hoe along a 2.6 m strip — 11 | hoe in the ground for 0.6 s |
| Wolf | 30 | a leap along a strip up to 6 m — 9 | missed — stunned 1.1 s |
| Spearman | 50 | thrust along a 4.2 m strip — 8 | pulls the spear out for 0.8 s |
| Crossbowman | 40 | a bolt along a 15 m strip — 8 | 2 s reload |
| Bannerman | 55 | shove with the pole 5; banner: knights +25% | the banner falls after 3 hits |
| Hammerer | 120 | hammer in a 2.2 m circle — 16, knockback 9 | bogged down — stunned 1.4 s |
| Slime | 36 / 16 / 8 | a leap onto a mark — 6 / 4 / 3, a sticky puddle | splits 1 → 2 → 4, fragments drop no raspberries |
| Prickle Ball | 30 | rolls along a 9 m strip — 9 | into a wall — stunned 1.5 s |
| Whip Vine | 35 | a lash in a 3 m circle — 7; does not walk, no knockback | — |
| Spitting Bud | 30 | 3 seeds on marks — 6; does not walk | closed while spitting: ×0.25 |
| Bramble Horror | 140 | a 7 m lasso — 6 and pulls in, then a strike 12; a 2.6 m stomp — 10 | lasso missed — stunned 1.4 s |
| Sickle Reaper | 28 | two swings in a 1.3 m circle — 5 each | fragile |
| Bone Archer | 30 | two arrows along a 12 m strip — 6 each | does not shoot up close |
| Mourning Wisp | 10 | flies through walls; bursts nearby — 6 and a cold puddle (slows 0.35) | knock it down on approach; burst on its own — no raspberries |
| Scarecrow | 60 | 3 crows every 6 s (no more than 6); up close — a 2.3 m circle — 8 | fell — the crows drop |
| Berry Boarlet | 45 | digs for 0.8 s, a 10 m ram — 10, knockback 8, keeps running | into a wall — stunned 1.8 s |
| Berry Beetle | 40 | underground, the mound creeps towards the hero for up to 2 s, surfaces — 9 | invulnerable underground; surfaced — stunned 1.2 s |
| Vine Weaver | 35 | a 2.4 m web on the floor for 5 s — slows 0.45; bite 6 | — |
| Order Hive | 60 | 2 bumblebees every 3.5 s, no more than 5; a bumblebee stings for 2 | fell — the bumblebees drop |
| Druse Golemling | 90 | ground slam — spikes along a 6.5 m strip — 12 | fists in the ground — stunned 1.2 s |
| Hopping Pot | 50 | a leap of up to 5 m onto a mark — 8, burning floor 4/s; boils over up close — a 2.2 m circle — 7 | lid askew for 0.8 s after the leap |
| Guardian Obelisk | 70 | a 6 m dome: allies take ×0.5 damage; up close a shove 4, knockback 8; does not walk | break it first |
| Basket Mimic | 55 | sleeps as a basket of raspberries, wakes at 2.5 m — "surprise!"; bite 9 | raspberries ×8 |
| Jam Keg | 20 | rolls towards the hero, a 2.4 m mark for 1.5 s — explosion 12, knockback 7; a sticky puddle (0.4) | break it early: the explosion hits mobs nearby for 30 and sets off neighbouring kegs |
| Soller, Knight of the Sun | 300 | sword series: 3 strikes along a 2.6 m strip, 10 each; a spear along a 14 m strip (0.7 s mark) — 18, knockback 6, every 5 s; below half health once per fight — prayer: +25% over 2 s | open for 0.9 s after the series, 1 s after the spear; a hit interrupts the prayer — stunned 1.5 s; raspberries ×6 |

- **Showcase:** F1 → "Mobs: first / second / third / fourth batch", "Mob: …" (spearmen and reapers in 2s, vines, wisps and kegs in 3s) (wolves in 3s, berrylings in 4s, gardeners in 3s), "Remove mobs"; the squad stands 9 m in front of the hero. Level and player count are the same as for the wardens. Hook: `__malina.pack`, `__malina.spawnMob(id, x, z)`. Raspberries from a mob come as a pile (`Props.berries`).
- **Mob rooms** — `MOB_ROOMS` in `src/level/playground-map.ts`: each has a rectangle, garrison posts and an entrance; each has its own pack. A room thinks only while the hero is within 30 m of it or the garrison is in combat; the whole garrison fell and the hero left the room — the garrison is back on its posts. F1 → buttons with room names (stand at the entrance), hook `__malina.mobRooms`, `fillRoom(room)`.
- **Order Barracks** (version 1.3 — extended to 33 × 21 m) — a room behind the playground's west wall, a passage in the wall at z −1…1 (`BARRACKS`, `buildBarracks` in `src/level/playground-map.ts`). A garrison of 16 mobs on posts (`BARRACKS_POSTS`): at the entrance berrylings and gardeners, further in wolves (behind them the ember mage and the summoner) and knights (behind them the healer). On posts the mobs face the entrance and notice the hero at 5 m; groups stand more than 8 m apart, so they wake one at a time. Deep inside — the guard: the hammerer in front, spearmen, the bannerman, crossbowmen at the west wall. N (reset) also returns the garrison.
- **Old Graveyard** — 24 × 24 m north of the barracks (x −50…−27, z −36…−13), the passage is in the playground's west wall at z −17…−15. Slabs, earth and grass, gravestones with candles and flowers. Posts: three reapers at the entrance, three wisps in the middle, a scarecrow deep inside, two archers at the far wall.
- **Beast Lair** — 24 × 24 m beyond the graveyard (z −62…−39), the passage is from the graveyard's north wall (x −36…−34). Earth and grass, bones, roots. Posts: two boarlets at the entrance on the right, two vine weavers on the left, two beetles and a hive deep inside.
- **Order Workshop** — 24 × 24 m beyond the Bramble Garden (z 38…61), the passage is from the garden's south wall (x −36…−34). Slabs and cobblestone, crates, a cart, a chest, candles. Posts: three kegs at the entrance on the right, two pots in the middle, an obelisk with two golemlings deep inside, two basket mimics in the corners.
- **Bramble Garden** — 24 × 24 m south of the barracks, the entrance is a passage in its south wall (x −36…−34). Grass and earth, raspberry bushes along the edge, roots on the west cliff. Posts: three whip vines at the entrance, slimes on the right, prickle balls on the left, the horror and two buds deep inside.
- **Soller** — `src/mobs/soller.ts`, `SunKnight` (`soller`). The armour is assembled from cubes; the sun on the tunic (front and back) and the chainmail are their own pixel textures on a canvas: 9 wavy rays, a disc with a face and speckles. The sword in the right hand (−X), the scabbard at the left hip (+X), empty in combat. The beam is `lightBeam` and `groundGlow` from `src/loot-look.ts`, dimmed (`BEAM`) so the knight reads inside it; dust motes in the beam. `praising` — praising the sun (on post and not alarmed, or praying in combat); when set, arms up in a V, head thrown back, the beam fills in over ~0.7 s and fades over ~0.4 s. Sees the hero at 6 m (the glade does not trim this: `fillRoom` gives the garrison `min(aggro, 5)`). The hero is further than 18 m or fell — `homing`: walks to his post, there health is full, the prayer is available again, faces the way he stood. Death — a flash of the beam and "Praise the sun!".
- **Sun Glade** — `glade` in `MOB_ROOMS`: not a room but a corner of the playground arena (x 14…23, z 12…23) without walls; Soller's post at (18.5; 18.5), around it a ring of yellow and white flowers, an inscription on the floor. The button in F1 — "Sun Glade", "Mob: Soller, Knight of the Sun" — summon in front of the hero.
- **Tests:** "first batch mobs" — each hits the hero, falls, drops raspberries and disappears; "mobs: shield…" — shield ×0.2 from the front and full damage to the back, healing and interruption, a summon without raspberries, the wolf stunned after a miss, scale; "mob rooms" — 22 + 10 + 9 + 7 + 10 mobs of all thirty kinds, nobody wakes at the barracks entrance, groups wake one at a time (also in the garden), the whole garrison fell — after leaving the barracks are full again; "second batch mobs" — the banner (+25% damage, falls after three hits), the slime splits 1 → 2 → 4, the bud while spitting ×0.25, the prickle ball stunned against a wall, the hammerer bogs down. "Mobs: each…" checks all 30 and Soller; "fourth batch mobs" — the dome ×0.5 and it drops with the obelisk, a keg's explosion hits a neighbour and sets off the second keg, the mimic sleeps as a basket until 2.5 m, the golemling bogs down, the pot hops; "third batch mobs" — the wisp through a wall, the scarecrow's crows and the hive's bumblebees (no raspberries, drop with their master), the beetle is invulnerable underground and stunned once surfaced, the web slows the hero by 0.45 and lets go, the boarlet stunned against a wall; "Soller" — one Soller in the glade, praises under the beam on his post, does not see at 7 m, wakes at 5.5 m and the beam goes out, the sword series and the spear hit the hero, the prayer below half heals, a hit interrupts it (stunned), there is no second prayer, the hero left — Soller is on his post with full health and praises again.


## 6. Brain and mover (modelled on Quake 3 botlib)

Version of 2026-11-04 ([arch-layers.md](arch-layers.md)). `Mob.update` (`src/mobs/mob.ts`) is split:

- **Brain** `think()` — once per `THINK_S` = 0.1 s (like `bot_thinktime`), each with its own phase: picks a target (the nearest hero of the squad or a lure — bush, wall, tower, summoned), notices the hero by `aggro` and lets go by `leash`, sets the movement mode `intent.mode` (`march` along the road, `patrol` along the route, `chase` — pursuit keeping distance, `path` — a detour, `hold`), chooses an attack (`choose`) by cooldown. A hit on the mob and a wall breach wake the thought immediately.
- **Mover** `mover()` — every tick: a step by mode (`marching`/`patrol`/`steer`, subclasses override `steer`: shooters keep distance, stationary ones only turn), walls (`resolveCircle`, ghosts pass through), does not crowd onto the hero; records `intent.move` — where it stepped, with a speed fraction.
- **Navigation**: a chase that makes no progress towards the target for half a second asks the `MobHooks.route` hook for a path (the level's `Pathfinder`, `src/level/pathfind.ts`); the budget is `ROUTE_BUDGET` = 4 paths per world tick for everyone (like botlib's routing limit), the rest wait for the next tick; one path expands no more than `ROUTE_EXPAND` = 2500 cells (the hero's — 30,000); not found — the next request after 1.5 s. The path is followed by points in `path` mode; the target moved more than 1.5 m away — chase again. Defence roads are still `TdLane` polylines.
- **Puppets** in a networked fight (`Mob.puppetStep`) step by the server's intent from the snapshot (`mx`, `mz` in `MobEnt`) with the same gait and pull towards the position from the snapshot buffer — walking and turning look like a live one.
- **Determinism**: wardens (`src/bosses/`) are also on `rnd()`, the clock is only fight time; the `sim-boundary.test.ts` guard forbids `Math.random` and `performance.now` in all server gameplay. `src/nav.ts` (`NavGrid`) removed, `distToObstacle` is in `src/collision.ts`.
- Tests: `server/test/mob-brain.test.ts` (a wall without a path and with one, thought rarer than a tick), hash determinism in `headless.test.ts`.
