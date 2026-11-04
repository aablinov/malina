# Bosses — the Wardens of Malina

Version 2.5 of 2026-10-25: all twelve auras distributed among the floor bosses with chances (section 4). Version 2.4 of 2026-10-25: scaling with level and players is gentler — this is a kind adventure, not Dark Souls: health +6% per level and +50% per player, damage +3% per level and does not grow with players; the wardens' base numbers are unchanged (section 7). Version 2.3: warden scaling by level and player count. Version 2.2: final wardens done — three on the largest arenas at the end of the corridor, with a transformation at 50% and a mythic grimoire. Version 2.1: raspberries spill out of wardens (the stronger the warden, the more); floor bosses done — five on spacious arenas further down the corridor, after victory a choice of two grimoires. Version 2.0: dragons removed entirely — wardens in the spirit of Minecraft Dungeons, schematic: 5 shared skeletons (golem, mage, rider, beast on pedestals, relic), no more than 8 moving parts, the body moves as a whole, the fight's power is on the floor (marks, projectiles, zones, minions). All 8 mini-bosses done, each with its own arena in the hall of wardens behind the playground's north wall. ~~Versions 1.0–1.3: the Crimson Dragon and the dragon skeleton~~ — replaced (the dragon was too detailed, the anatomy was not believable). The spells that drop — [design-spells.md](design-spells.md); floors — [design-dungeon.md](design-dungeon.md).

## 1. General

**Lore.** A star fell to the earth; in its crater the first raspberry bush grew — all magic comes from it. The berry is guarded by the **Order of the Raspberry**: golems, knights, beasts, mages, cauldrons and relics. The heroes descend to the Heart of the Raspberry — the Order does not let them pass.

**Raspberry signs — every warden has both:**
1. **The mark of the Order** — a crown of drupelet cubes, a berry crest on the caparison or shield, raspberry vines with thorns over the armour.
2. **The berry heart** — a glowing shimmering berry cube in the chest, tail or shield. The weak spot: exposed after heavy attacks (the warden staggers), a hit on it is ×2 with the caption "heart!". On death the heart bursts and a grimoire rises from it.

**Light.** Glowing details shimmer from the school's colour to raspberry (fire: orange ↔ raspberry) — each detail has its own phase.

**Run structure.** 2–3 mini-bosses per floor (elite rooms and side branches); on floors 1–2 a boss from a pool of five, on the third a final one from a pool of three. Per run — 2 of 5 bosses and 1 of 3 finals.

**Loot.** Mini-boss — its rare spell. Boss — a **choice of two grimoires**: a legendary spell or an aura (take one — the other fades). Final — a mythic one.

**Arena.** An invisible square at the entrance: the hero steps in — portcullises rise behind them, the warden wakes, a health bar with the name appears at the top. The hero falls — the arena resets and puts the hero at the entrance. The warden is defeated — the portcullises drop.

## 2. Rules of schematic design

1. **No more than 8 moving parts**, each 1–3 cubes. No chains of links and no IK.
2. **The silhouette reads from above** in isometry; details are glowing inserts, not geometry.
3. **Moves as a whole:** jump, lean, shuffle, squash — like the Redstone Golem or the Arch-Illager.
4. **Power is on the floor:** a mark (a circle or a strip fills with red) → strike; projectiles in an arc; hazard zones; minions.
5. **A window for a strike:** every warden has an attack after which it is stunned (heart exposed, ×2).
6. **Rage at 50%:** a war cry, a ring, 25% faster, nastier attacks.

**Skeletons:** golem (body, head, 2 arms, 2 legs — 6), mage (robe without legs, head, 2 arms, item — 5), rider (horse block, horse head, pairs of legs, knight, weapon — up to 8), beast on pedestals (body, head, 4 legs, tail — 7–8), relic (core and 2–4 parts — 3–5).

## 3. Mini-bosses — rare spells (done)

| # | Warden | Skeleton | Fight | Window (stunned) | Drops |
|---|---|---|---|---|---|
| 1 | **Order Cauldron** | relic: cauldron, lid, brew, 2 ladles | hops; fire lumps on marks (burning floor); boils over in a ring if the hero is up close; raspberry cube minions out of the brew | after the jump onto the hero | Heavenly Hammer |
| 2 | **Frost Boar** | beast | charge along a strip; tusks; ice spikes on marks — the one caught freezes into a block | ran into a wall | Ice Tomb |
| 3 | **Storm Golem** | golem, lightning-rod arms | lightning spear along a strip; two-handed slam; lightning rods — lightning from the sky on marks | overheated after the spear | Thunderer's Spear |
| 4 | **Golden Warden** | rider | charge; halberd in a circle; 7 ghost swords in sequence (a chord); the shield holds hits from the front ×0.3 | the horse stumbled on a wall | Blade Phalanx |
| 5 | **Night Rider** | ghost rider | vanishes and appears behind the back; charge; ghost knights from portals; scythe | ran into a wall | Fallen Wardens |
| 6 | **Druse Golem** | golem, raspberry crystals on the back | rift — spikes along a strip (a fan in rage); stomp; throws a crystal | arms stuck in the ground | Rift |
| 7 | **Sorrowful Gatherer** | mage, basket of withered berries | hands out of the ground hold the hero; homing wisps; teleports away; ghosts | exhausted after the wail | Choir of the Dead |
| 8 | **Grave Cat** | beast, torch tail | blink — explosion, vanished, explosion at the hero (three times in rage); leap; two sword swings | dizzy after the blinks | Blink (new spell) |

## 4. Bosses — legendary spell or aura (done)

Health 1700–2000, rage at 50% changes the fight, arena 27 × 24 m, the caption on the bar is "legendary warden".

**Auras by chance.** Each floor boss has its own set of auras by element (`MiniBoss.auras`: id and chance %, summing to 100). Which aura becomes the second grimoire is decided once per victory; resetting the warden rolls again. Each of the twelve auras belongs to exactly one boss — those with several have chances. Mini-bosses and finals do not drop auras.

| # | Warden | Skeleton | Fight | Window (stunned) | Drops (choice) |
|---|---|---|---|---|---|
| 1 | **Crimson Serpent** | head, jaw and 4 humps following the head's trail | dives — a mound is visible underground (invulnerable), surfaces under the hero on a mark, lava splashes; bite; fire spit; a burning trail. Rage: a burning bush grows in the centre — the Serpent drinks and heals 6%/s, three hits on the bush interrupt the drinking | stuck after surfacing; interrupted drinking | Flame Serpent / aura: Crucible 50%, Blood Pact 50% |
| 2 | **Thunder Beast** | skeletal beast, glowing ribs | leaps onto the hero, on landing 6 rays of chain lightning (2 leaps, 3 in rage); claws twice; storm — lightning on marks across the whole arena. Rage: overload, a ring of lightning behind it | out of breath after the chain of leaps | Thunder Leap / aura: Storm Crown 50%, Fury 50% |
| 3 | **Queen of the Star Garden** | mage, hovers, a berry moon of cubes behind her back | starfall on marks (8, 14 in rage); comet along a strip; apprentices and a shield — while they live, no damage. Rage: night — stars across the whole arena except a circle in her shadow | the shield burst (the last apprentice fell); exhausted after the night | Starfall / aura: Clarity 40%, Blade Whirl 30%, Deep Frost 30% |
| 4 | **Judge of the Order** | paladin golem, sword and scales with a berry | pillars of light on marks (plus a spiral in rage); verdict — sword strike along a strip; circular swing; squires — the fallen leave graves. Rite: raises the fallen in 2 s | the rite interrupted by three hits; the sword stuck | Heavenly Judgment / aura: Bastion 50%, Punishing Halo 50% |
| 5 | **General Rdyan** | a huge knight on a tiny horse, two swords | gravity pulls the hero, then a strike; two swings; a leap across the arena; a fan of thorn arrows. Rage: meteor — flies away, the shadow chases the hero, lands with a crater; a thorn ring | stuck after every second leap; in the crater after the meteor | Gravity Well / aura: Crown of Thorns 40%, Hungry Shadow 30%, Stone Stride 30% |

## 5. Finals — mythic (done)

Health 3200–3500, at 50% a **transformation**: a large title (`fx.title`), the world darkens (`fx.darken`), the camera pulls back (`fx.zoom`), the fight changes entirely. Arena 31 × 30 m, one mythic grimoire, a raspberry fountain — health ÷ 6 (530–580 berries).

| # | Warden | Skeleton | Phase 1 | Transformation and phase 2 | Window (stunned) | Drops |
|---|---|---|---|---|---|---|
| 1 | **Mistress of Eternal Winter** | mage, hovers, an ice crown with frozen berries, 6 shards in orbit | icicles on marks (ice slows); shards fly one at a time; a blizzard wall along a strip across the whole arena; ice golem guards | "Eternal Winter": a blizzard across the whole arena, shards grow into crystals. **Absolute Zero** — a 9 m dome grows for 2 s, whoever is inside takes 25 damage and freezes in for 2 s; icicles ×2, homing crystals | after the blizzard wall; 3 s after Absolute Zero | Absolute Zero |
| 2 | **Fallen Star** | relic: crystal core, 4 facet shutters, 3 rings, a berry inside | beam — charge, strip, then sweeps slowly ±35°; meteors on marks with burning craters; a ring of 12 shards; a shove up close | "The Star Awakens": the rings open into a halo, the floor cracks with burning rays. A 180° beam, 22 meteors across the whole arena; **supernova** — raises 3 crystal pillars, pulls the hero, a 10 m explosion — only a pillar's shadow saves | overheat after the beam (facets open); 3 s after the supernova | Fallen Star Beam |
| 3 | **First Gardener** | golem: mossy stone, straw hat, beard of vines, hoe, a garden on the back | hoe — a furrow of spikes along a strip; seeds on marks sprout into bramble bushes; stomp; sprout minions | "Titan Form": the hat flies off, the stone cracks, grows ×1.7, the garden blooms, steps shake the screen. Earthquake — 3 expanding rings; boulder throw; harvest — hoe in a 6 m circle | the hoe stuck; out of breath after the earthquake | Titan Form |

## 6. Reward

- **Raspberries:** a fountain of berries bursts from the burst heart in piles of 5, scattering in a ring; to pick up — walk nearby. How many: health ÷ 20 for mini-bosses (35–50), ÷ 10 for floor bosses (170–200), ÷ 6 for finals (530–580) (`MiniBoss.berries`).
- **Grimoires:** mini-boss — one (rare spell); floor boss — **a pair to choose from** 3.2 m apart: a legendary spell or an aura; take one — the other fades (`MiniBoss.drops`, the aura is `MiniBoss.aura` by the chances in `auras`, `Grimoire.siblings`).

## 7. Scaling: level and player count

Every warden has a level (1–30) and a player count (1–4). Growth is **gentle**: the game is a kind adventure in the spirit of Minecraft Dungeons, not Dark Souls; a warden should be an event, not a wall. At level 1 solo the numbers are exactly those in the warden's file (verified by play); above that they are multiplied (`src/bosses/scaling.ts`):

| | Formula | Lv. 10, solo | Lv. 10, 4 players | Lv. 30, solo |
|---|---|---|---|---|
| Health | base · (1 + 0.06·(lv − 1)) · (1 + 0.5·(players − 1)) | ×1.54 | ×3.85 | ×2.74 |
| Damage to heroes | base · (1 + 0.03·(lv − 1)) — does not grow with player count | ×1.27 | ×1.27 | ×1.87 |
| Raspberries | base · (1 + 0.05·(lv − 1)) · players | ×1.45 | ×5.8 (shared by all) | ×2.45 |

~~Version 2.3: health (1 + 0.15·(lv − 1))·(1 + 0.75·(players − 1)), damage (1 + 0.1·(lv − 1))·(1 + 0.1·(players − 1))~~ — replaced: at high levels it became hard, like Dark Souls.

- **Where the level comes from:** in the playground — the hero's level (grows on its own as the hero levels up); in the F1 panel — "Warden level" (by hero or 1…30) and "Players" (1–4); hook `__malina.bossScale(level | 'hero', players)`. In the dungeon the level will follow the floor (as for enemies, [design-dungeon.md](design-dungeon.md)).
- **Mid-fight:** the health fraction is preserved — a second player joins, the warden gets tougher but does not heal.
- **Damage in one place:** all the warden's hits (attacks, zones, projectiles, minions) go through the hooks' `hurtHero`, which `Boss` wraps with the multiplier; a new warden scales by itself without doing anything.
- **The bar:** under the name — "warden of the raspberry · lv. 5 · players 2".

## 8. Hall of wardens in the playground

Behind the playground's north wall (passage at x −1…1) is a corridor to the north, with eight 21 × 20 m arenas along its sides, four on each side (left — cauldron, storm golem, night rider, Gatherer; right — boar, golden warden, druse golem, cat). Further down the corridor are five 27 × 24 m floor boss arenas (left — Serpent, Queen, General; right — Beast, Judge), and at the very end three 31 × 30 m final arenas (left — Mistress of Eternal Winter and First Gardener, right — Fallen Star). The gates are in the corridor wall, the warden's name is on the corridor floor. The invisible square is right past the gates: step in — portcullises, the warden wakes. The floor and the decor along the walls follow the warden's theme. In the F1 panel — "Warden: …" buttons (stand at the gates), hook `__malina.toBoss(id)`. Sleeping wardens of distant arenas do not think (they update only within 30 m of the hero or in combat).

## 9. How it is built

- **`src/bosses/scaling.ts`** — scaling formulas `hpMult`, `dmgMult`, `lootMult`.
- **`src/bosses/kit.ts`** — `Boss`: a target for the sword and spells, scale `setScale(level, players)` (health; damage via the `hurtHero` wrapper), heart ×2, flash, `lam` materials and `shimmer`, `box`.
- **`src/bosses/mini.ts`** — `MiniBoss`: brain (sleep → wake → chase keeping distance `keep` → attack → stun → death), rage, marks `markCircle` / `markLine`, projectiles `lob`, zones `hazard` (via `Field` from `field.ts`, shared with regular mobs — [design-mobs.md](design-mobs.md)), minions `summon` (`Minion`); each warden has `build`, `choose`, `act`, `animate`, its own `sfx`.
- **Wardens:** mini-bosses `cauldron.ts`, `boar.ts`, `storm-golem.ts`, `golden-rider.ts`, `night-rider.ts`, `druse-golem.ts`, `gatherer.ts`, `grave-cat.ts`; floor bosses (`tier = 'boss'`, `aura`) `serpent.ts`, `thunder-beast.ts`, `star-queen.ts`, `judge.ts`, `general.ts`; finals (`tier = 'final'`) `winter-mistress.ts`, `fallen-star.ts`, `first-gardener.ts`; the list is `roster.ts` (`MINI_BOSSES`: arena id → class).
- **`src/bosses/arena.ts`** — `Arena`: trigger square, portcullises (raising, obstacles), reset on the hero's death (places at the gates), victory. **`boss-bar.ts`** — the bar at the top. **`grimoire.ts`** — the grimoire. **`boss-audio.ts`** — shared sounds (portcullises, choir).
- **Map** — `BOSS_ARENAS` in `src/level/playground-map.ts`; **playground** — wardens by `BOSS_ARENAS` and `MINI_BOSSES` in `src/dev/playground.ts`.
- **Blink** — a new spell (`blink`, arcana, rare) in `src/magic/dark-arcane.ts`: a dash of up to 8 m towards the cursor, not through walls, an explosion at the vanishing point and at the arrival point.
- **`Props.fountain`** (`src/props.ts`) — the raspberry fountain.
- **Tests** — "warden scaling" (health, damage, raspberries, fraction mid-fight, bar, hero level); `warden "id"` for each of the sixteen: the square closes the arena, the warden hits the hero, rage, ×2 while stunned, raspberries, grimoire (a pair for bosses, the second fades), reset at the gates.
