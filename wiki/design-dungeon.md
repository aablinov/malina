# Malina: The Hive. Design document

Version 0.3 of 2026-10-21.

**Decisions:**
- `claude/adr-001-dungeon-roguelite.md` — the mode: co-op dungeons;
- `claude/adr-002-realistic-weapons-tactical-movement.md` — weapons, movement, armour.

All numbers are starting values, tuned by playtests and in the developer playground (section 16).

## 1. Essence

A co-op isometric tactical roguelite shooter for 1–4 players. Beetles dragged the raspberry harvest into an underground hive. A squad in body armour and helmets, with real guns (AK-74, AR-15, double-barrel shotgun…), descends, clears rooms of beetle hordes and assembles a build out of perks and attachments. The goal is to carry out as many raspberries as possible. Between runs — a farm hub where the raspberries carried out turn into permanent upgrades.

**Key features:**
- **Raspberries** are money, healing and the run's score all at once. Every berry needs a decision: spend it at the merchant, eat it for health or carry it to the end.
- **A tactical squad against the horde.** Reloading, recoil, armour and stamina make you cover each other instead of just holding the trigger.

**Reference points:**
- Minecraft Dungeons — look, camera, voxels;
- Enter the Gungeon / Gunfire Reborn — rooms, perks;
- Hades — the hub;
- Ready or Not / Escape from Tarkov — the feel of weapons, armour and stance, simplified for isometry;
- Helldivers 2 — co-op against a beetle horde.

## 2. Game loop

**Run (20–25 min):** lobby → descent to floor 1 → rooms → boss → floor 2 → … → floor 3 boss → results → farm.

**Room:**
1. The squad enters a combat room — the doors close.
2. The squad fends off 2–3 waves.
3. The doors open, the reward drops, and each player picks 1 perk out of 3.
4. The squad restocks and goes to one of the next doors.

**Meta:** the raspberries carried out are planted on the farm; bushes give permanent bonuses and unlock guns.

## 3. Floor and generation

| Parameter | Value |
|---|---|
| Floors per run | 3 |
| Rooms per floor | 6–8 |
| Time per floor | ~7 min |
| Floor grid | 5 × 5 cells |
| Cell pitch | 32 m |
| Room size | 20 × 20 or 24 × 16 blocks |
| Door width | 3 blocks, centred on the side |
| Corridor | 3 blocks wide, no fights |

### Algorithm

- Deterministic by seed (for future networking; `rng(seed)` already exists in `map.ts`).
- **Main path:** a random walk over the grid from the start, 5–6 rooms long, the last one is the boss.
- **Branches:** 1–2 of them, 1–2 rooms each; elite rooms, storerooms and altars are there.
- **Room set per floor:**
  - start;
  - 3–4 combat;
  - 1 elite (on a branch);
  - 1 storeroom or merchant (the merchant is mandatory on floors 2 and 3);
  - 0–1 altar;
  - boss.
- **Room templates** — ASCII templates in code: `#` wall, `.` floor, `o` column or cover, `=` low cover (crouch behind it), `~` acid, `n` burrow (beetle spawn point), `c` chest. A floor needs 8–10 combat templates, plus mirroring and rotation.
- **Cover matters:** tactical shooting needs places to crouch and reload. Every combat room has 3–6 covers.
- **Visuals:** stone, moss, a hive with smouldering blocks; walls are low on the camera side.

**Icons above doors:** before choosing you can see what is behind the door — combat, elite, storeroom, merchant, altar, boss.

## 4. Room types

| Type | What is inside | Reward |
|---|---|---|
| Combat | 2–3 waves, doors closed | raspberries and ammo from beetles, 1 perk each |
| Elite | budget ×1.6, plus 1 elite beetle | a perk of higher rarity, 30 raspberries, an attachment |
| Storeroom | chests with 30–60 raspberries, ammo, plates; 30% chance of an ambush (one wave) | raspberries and gear |
| Merchant | weapons, ammo, armour, attachments, healing, reroll perks | — |
| Altar | a bonus in exchange for a curse until the end of the floor | by choice |
| Boss | the floor boss plus minions | 80 raspberries, a legendary perk, descent below |

## 5. Hordes

**Combat room budget:**

```
B = (24 + 8 * k) * (1 + 0.5 * (players - 1))
```

`k` is the combat room's number from the start of the run (0, 1, 2, …). In the first room solo that is 24 points, in the 12th — 120.

**Waves:**
- The budget is split into waves 40% / 35% / 25%; with `B < 40` there are two waves.
- The next wave comes when 75% of the current one is killed or 15 s have passed.
- Between waves 3 s of calm — a window to reload.

**Beetle costs** (stats in `beetle.ts`):

| Beetle | Points | Role |
|---|---|---|
| Small | 2 | crowd |
| Fast | 2 | pressures the position |
| Spitter | 4 | ranged, keeps distance |
| Bombardier | 6 | a burst of three drops |
| Rhino | 8 | tank |
| Egg (new) | 3 | after 6 s hatches 3 small ones if not broken |
| Shieldbearer (new) | 6 | armour in front, vulnerable from behind, for explosives and the SVD |

**Beetle level by floor:** floor 1 — 1–2, floor 2 — 3–4, floor 3 — 5–6. Formulas:
- health ×(1 + 0.4·(lv − 1));
- damage ×(1 + 0.2·(lv − 1));
- speed ×(1 + 0.05·(lv − 1)).

**Elite beetle:** health ×3, size ×1.3, an aura, one property from the list:
- speeds up neighbours;
- explodes on death;
- summons small ones;
- regenerates.

## 6. Bosses

~~Boss health is multiplied by (1 + 0.75·(players − 1)).~~ Replaced: wardens' health, damage and raspberries grow with level and player count — [design-bosses.md](design-bosses.md), section 7.

| Floor | Boss | Health (solo) | Mechanic |
|---|---|---|---|
| 1 | Brood Mother | 600 | lays eggs (3 every 8 s); at 50% health burrows and emerges elsewhere |
| 2 | Ram Rhino | 1100 | a charge with a warning line; hits a column — stunned 3 s, takes ×2 damage; frontal armour holds bullets weaker than 7.62 |
| 3 | Hive Queen | 1800 | 3 phases: fan of spit → summoning elites → acid floor by sectors |

## 7. Raspberries

**Sources per floor** (expected, solo):

| Source | How many |
|---|---|
| Small, fast beetle | 1 |
| Spitter, bombardier | 2 |
| Rhino | 4 |
| Elite beetle | 10 |
| Storeroom | 30–60 |
| Boss | 80 |
| **Total per floor** | **~130–180** |

**Healing:** key `H` — eat 5 raspberries and gain +20 health. Cooldown 1.5 s, speed ×0.5 while eating. Medkits drop from beetles more rarely: 8%.

**Run result:**
- raspberries in the bag at the exit go to the profile;
- if the squad died — 50% goes.

**Co-op:** everyone has their own bag; give a teammate 10 berries — key `V` when they are nearby.

## 8. Weapons

Real models, game stats. Voxel models with recognisable silhouettes.

### 8.1. Shared mechanics

- **Magazine and reserve:** ammo in the magazine and in reserve by calibre. The HUD shows `24 / 90`.
- **Reload (`R`):**
  - **tactical** — the magazine still has rounds: faster, +1 in the chamber;
  - **full** — the magazine is empty: longer.
  - A reload is interrupted by sprinting and the dodge roll; shotgun shells already inserted are kept.
  - With an empty magazine and fire held, the reload starts automatically.
- **Spread:**
  - a base value per gun;
  - multipliers: aiming ×0.4, crouch ×0.7, moving ×1.3;
  - no shooting while sprinting.
- **Recoil:**
  - every shot adds "climb" up to a ceiling;
  - the climb settles in 0.25–0.4 s after release;
  - in isometry it shows as the reticle kicking up and the spread growing.
- **Aiming (RMB):** speed ×0.6, spread ×0.4, the camera shifts 15% towards the aim.
- **Penetration:** 7.62×54R passes through 1 target (the SVD — through 2) losing 30% damage per target.
- **Ricochets** stay: 50% off walls.

### 8.2. Calibres

| Calibre | Guns | Max reserve | Pack at the merchant |
|---|---|---|---|
| 9 mm | PM, Glock 17, MP5 | 120 | 30 rounds for 10 raspberries |
| 5.45×39 | AK-74, AKS-74U | 180 | 60 rounds for 15 |
| 5.56×45 | AR-15 | 180 | 60 rounds for 15 |
| 12 gauge | double-barrel, MP-133 | 32 | 16 rounds for 12 |
| 7.62×54R | SVD, PKM | 150 | 50 rounds for 20 |

Ammo drops from beetles: 70% for one of your calibres, 30% random.

### 8.3. Guns

| Gun | Class | Calibre | Damage | Rate, shots/s | Magazine | Reload tact. / full, s | Range, m | Weight | Price | Special |
|---|---|---|---|---|---|---|---|---|---|---|
| PM | pistol | 9 mm | 9 | 4 (semi-auto) | 8 | 1.1 / 1.5 | 14 | light | starter | always in the second slot |
| Glock 17 | pistol | 9 mm | 8 | 6 (semi-auto) | 17 | 1.0 / 1.4 | 15 | light | 25 | — |
| Double-barrel | shotgun | 12 ga | 6 × 8 pellets | 2.5 | 2 | — / 2.0 | 8 | medium | 35 | double shot: hold LMB 0.3 s — both barrels at once, knocks beetles back |
| MP-133 | shotgun | 12 ga | 5 × 8 pellets | 1.2 | 6 | 0.45 per shell | 9 | medium | 55 | loads one shell at a time, can be interrupted |
| MP5 | SMG | 9 mm | 7 | 13 | 30 | 1.9 / 2.4 | 15 | light | 50 | low recoil |
| AKS-74U | assault rifle | 5.45 | 9 | 11 | 30 | 2.2 / 2.7 | 15 | light | 65 | strong recoil |
| AK-74 | assault rifle | 5.45 | 11 | 10 | 30 | 2.4 / 3.0 | 20 | medium | 90 | a reliable all-rounder |
| AR-15 | assault rifle | 5.56 | 10 | 12 | 30 | 2.1 / 2.6 | 22 | medium | 95 | more accurate than the AK: spread ×0.8 |
| SVD | marksman | 7.62R | 45 | 1.6 | 10 | 2.6 / 3.2 | 30 | medium | 120 | penetrates 2 targets |
| PKM | machine gun | 7.62R | 12 | 11 | 100 (belt) | — / 5.0 | 22 | heavy | 160 | without crouch and aim spread ×1.6; speed ×0.85 |

**Weight:**
- light — speed ×1.0;
- medium — ×0.95;
- heavy — ×0.85, sprint no faster than 5.2 m/s.

**Slots:**
- primary gun;
- pistol;
- grenades.

Switching primary / pistol — 0.4 s. Drawing the pistol when the primary is empty is faster than reloading — a classic tactical move.

### 8.4. Grenades

| Grenade | Damage | Radius | Fuse | Carry | Price |
|---|---|---|---|---|---|
| RGD-5 | 70 | 4 m | 3.2 s | up to 3 | 15 |

Throw — key `G`, holding sets the range up to 14 m. The grenade bounces off walls.

### 8.5. Attachments

One per slot: sight, muzzle, handguard, magazine, tactical.

| Attachment | Slot | Effect | Price |
|---|---|---|---|
| Red dot | sight | spread while aiming a further ×0.7 | 35 |
| Suppressor | muzzle | beetles notice you at half the distance; damage −5% | 40 |
| Flash hider | muzzle | recoil −10%, smaller flash | 25 |
| Foregrip | handguard | recoil −25% | 35 |
| Extended magazine | magazine | capacity +50%, reload +15% | 45 |
| Flashlight | tactical | lights up dark rooms; beetles in the beam take +10% damage | 30 |

## 9. Armour and helmet

**How damage is computed:**
1. Armour absorbs `D × R` damage (R is the absorption percentage) while it has points.
2. Health loses the rest.
3. Armour points decrease by the absorbed amount.

| Body armour | Armour points | Absorption | Speed | Price |
|---|---|---|---|---|
| Class 1, light | 40 | 30% | ×1.0 | 40 |
| Class 2, medium | 70 | 40% | ×0.95 | 80 |
| Class 3, heavy | 110 | 50% | ×0.88 | 140 |

| Helmet | Points | Effect | Price |
|---|---|---|---|
| Helmet | 30 | −25% damage from spit and explosions; no stun | 35 |

**Armour plate:**
- +35 points to the vest;
- inserted in 2.5 s (key `4`), you can walk slowly;
- carry up to 3, price 20, sometimes drops from elites and from chests.

**When armour is at zero:** the vest stays on the model but dark and cracked, no absorption.

**Run start:** class 1 and a helmet (or whatever is unlocked on the farm).

## 10. Players, movement and animation

### 10.1. Parameters

| Parameter | Value |
|---|---|
| Health | 100 |
| Stamina | 100 |

| State | Speed, m/s | Shooting | Stamina |
|---|---|---|---|
| Walk (tactical pace) | 4.4 | yes | — |
| Sprint (`Shift`) | 6.6 | no, weapon lowered | −12/s |
| Aiming (RMB) | 2.6 | yes, spread ×0.4 | — |
| Crouch (`C`, toggle) | 2.2 | yes, spread ×0.7, lower silhouette — spit flies overhead more often | — |
| Crouch + aim | 1.6 | yes, spread ×0.28 | — |
| Dodge roll (`Space`) | 5 m in 0.45 s, invulnerable 0.2 s | no | −30 |

- **Stamina regeneration:** 25/s starting 0.8 s after spending.
- **If stamina is at zero:** sprint and dodge roll unavailable for 2 s.

### 10.2. Tactical stance and animation

Animation is procedural: the blocky parts of the model are rotated in code, no skeleton.

**Hero model:**
- pelvis, torso, chest, neck, head;
- upper arm, forearm, hand ×2;
- thigh, shin, foot ×2;
- gear: a vest with pouches, a helmet, a chest rig;
- vest colours and patches — the player's colour in the squad.

**Base stance:**
- pelvis lowered by 12% of height;
- knees bent 25°;
- torso leaned forward 8°;
- weapon at the shoulder, stock braced.

**Separate upper and lower body:**
- the legs walk in the movement direction, the torso and head turn to the aim;
- if the angle between them exceeds 70°, the pelvis turns to follow;
- **strafe** — a side step;
- **walking backwards** — a shorter step back, speed ×0.8.

**Walking:**
- 0.9 m stride, weight shifting from foot to foot;
- the torso sways ±2°;
- the weapon drifts slightly ("sway"), less while aiming.

**Sprint:** torso leaned 20°, weapon lowered to the chest, longer strides.

**Crouch:** knees at 70°, pelvis 35% lower.

**Shot:** recoil pushes the shoulders and head back 3–6° by weapon class, bolt and casing.

**Reload:**
- the magazine drops out (a voxel cube falls to the floor), the hand goes to the pouch, a new magazine is inserted, the bolt is racked on a full reload;
- the double-barrel — breaking the barrel open;
- the MP-133 — shells one at a time.

**Wounded:** the torso flinches; below 30% health — heavy breathing and a slight limp.

**Inserting a plate:** the hand to the chest, the vest flashes.

### 10.3. Downed and co-op

| Parameter | Value |
|---|---|
| Downed | at 0 health — lies for 20 s, can crawl and shoot the pistol; a teammate revives in 3 s (hold `E` nearby) |
| Not revived | gets up in the next room with 30% health and no armour |
| Everyone down | the run is over |
| Solo | 1 "berry totem" per run: you get up automatically with 50% health |
| Camera in co-op | follows the squad's centre; a player cannot go further than 18 m from the others |

**Scaling by player count:**
- horde budget ×(1 + 0.5·(n − 1));
- boss health ×(1 + 0.75·(n − 1));
- raspberries from beetles unchanged — they are shared.

**Roles come from gear**, there are no hard classes:
- assault — AK or AR and a heavy vest;
- support — PKM;
- marksman — SVD;
- "doorman" — shotgun.

## 11. Merchant

Prices for weapons, armour and attachments are in sections 8–9. In addition:

| Item | Price |
|---|---|
| Gun upgrade ★2 / ★3 / ★4 / ★5 (+12% damage, −8% recoil per star) | 25 / 45 / 70 / 100 |
| Healing +50 | 25 |
| Reroll the offered perks | 20 |

## 12. Perks (the run's build)

After every combat room each player picks 1 of 3. Rarity chances:

| Rarity | Regular room | Elite room |
|---|---|---|
| Common | 70% | 40% |
| Rare | 25% | 45% |
| Legendary | 5% | 15% |

At the boss a legendary is guaranteed.

| Perk | Rarity | Effect |
|---|---|---|
| Calibre | common | +15% damage |
| Quick Hands | common | reload −20% |
| Chest Rig | common | +30% max ammo reserve, +1 grenade |
| Nerves of Steel | common | recoil −25% |
| Marathoner | common | stamina +40, regeneration +30% |
| Berry Stomach | common | healing from raspberries +50% |
| Armourer | rare | armour regenerates 2/s out of combat up to 50% |
| Arson | rare | 20% of bullets ignite: 4 damage/s for 3 s |
| Ricochet+ | rare | ricochets always, +1 bounce |
| Marauder | rare | a kill — 20% chance to return 3 rounds to the magazine |
| Tactician | rare | the dodge roll chambers 5 rounds into the magazine |
| Breach | rare | all bullets penetrate 1 target |
| Endless Magazine | legendary | 8 s without spending ammo after every reload, reload once per 30 s |
| Raspberry Burst | legendary | eaten raspberries explode around you for 40 damage |
| Second Wind | legendary | once per floor you get up on your own with 50% health |

**Team perks** (co-op only, rare):

| Perk | Effect |
|---|---|
| Shoulder to Shoulder | +10% damage for every ally within 6 m |
| Field Medic | you revive an ally twice as fast, they get up with 50% health and 25 armour |
| Ammo Bearer | once per room you hand an ally a magazine with key `V` |

## 13. Farm hub (meta, stage 3)

- Raspberries carried out are spent on planting bushes: 1 bush — 50 raspberries, 12 beds in total.

| Row | What it gives |
|---|---|
| Health | +10 max health per bush, up to 3 |
| Arsenal | unlocks guns for the start and the merchant: Glock → double-barrel → AKS-74U → AK-74 → AR-15 → MP-133 → MP5 → SVD → PKM |
| Gear | start with a class 2 vest, then a plate in reserve, then 2 grenades |
| Luck | +1 perk option (up to 4), rare chance +5% |
| Stash | start the run with 20 / 40 / 60 raspberries |

The lobby is launched from the farm: session number, squad, starting gun choice.

## 14. Controls

| Key | Action |
|---|---|
| `WASD` | walk |
| Mouse | aim (the torso turns to the cursor) |
| LMB | fire (hold — burst; double-barrel — double shot) |
| RMB | aim (hold) |
| `R` | reload |
| `Shift` | sprint |
| `C` | crouch (toggle) |
| `Space` | dodge roll |
| `1` / `2` | primary gun / pistol |
| `G` | grenade (hold — range) |
| `4` | armour plate |
| `H` | eat raspberries |
| `V` | give raspberries (or a magazine with "Ammo Bearer") |
| `E` | interact (doors, chests, merchant, reviving an ally) |
| `F` | flashlight |
| `Tab` | floor map |
| `Esc` | pause |
| `M` | sound |

Developer tool keys are in section 16, stage 0.

## 15. Interface

- **Top left:** floor and room, remaining waves.
- **Top right:** floor mini-map.
- **Bottom centre:**
  - health, below it the armour bar and the helmet icon;
  - primary gun and pistol with attachment icons;
  - ammo `in magazine / in reserve`, which turns red when the magazine is below 25%;
  - grenades, plates, raspberry bag, perk icons.
- **On the ground at the hero:** a stamina arc, visible only while spending.
- **Above allies' heads:** name, health and armour; a downed one has a timer.
- **Perk choice:** 3 cards in the middle of the screen, each player has their own choice.

## 16. Stages and prototype scope

### Stage 0. Developer playground (build first)

A utility level for the developer only. **Not gameplay:** no goals, rewards or progress. Needed to work out and tune mechanics in clean conditions and then use them in the game without copying code. First — character movement and shooting.

**Entry:**
- by address with the parameter `?dev=playground`;
- or with the `F9` key in the main menu.

In the regular game the item is not shown; in the player build it can be disabled with a flag.

**Scene:**
- **Floor** 48 × 48 m in a 1 × 1 m checkerboard, two neutral grey tones.
  - Every 5 m — a darker marking line.
  - In the centre — the origin cross.
  - The grid serves as a ruler: it shows speed, stride length and range.
- **Perimeter walls** 3 m high, also checkered, in another shade. On the camera side the walls are low (0.5 m), as in the game.
- **Geometry for testing:**
  - low covers 0.9 m (crouch behind them);
  - high covers 2 m;
  - a column;
  - a room corner;
  - a 2 m wide corridor with a doorway;
  - a wall at 45° — for ricochets and sliding along walls.
- **Shooting range:** a lane with targets at 5 / 10 / 15 / 20 / 30 m, distances labelled on the floor.
- **Light and picture:**
  - neutral daylight, shadows on;
  - no fog;
  - bloom and post-processing toggled by a switch to see the mechanics without effects.
- **Camera** the same as in the game: isometry, wheel zoom.

**What is implemented at stage 0 (in the game's shared modules, not in the playground):**

1. **Character and movement** — everything from sections 10.1–10.2:
   - a new model with joints and gear;
   - tactical stance, separate upper and lower body, strafe, walking backwards;
   - walking, sprint, aiming, crouch, dodge roll, stamina;
   - collisions with walls and covers with sliding along the wall.
2. **Shooting** — section 8.1:
   - first the PM and the AK-74, then the double-barrel and the AR-15;
   - magazines, tactical and full reload with animation;
   - spread with multipliers, recoil and climb;
   - tracers, muzzle flash, casings, chips on walls, ricochets.
3. **RGD-5 grenades** — at the end of the stage, if time remains.

**Developer tools:**

| Key | Tool |
|---|---|
| `F1` | parameter panel: sliders for speeds, stamina, damage, rate, spread, recoil, reload for the current gun and character; changes apply immediately; "Copy JSON" and "Reset" buttons |
| `F2` | show colliders and hitboxes |
| `F3` | aim ray and the current spread cone |
| `F4` | character telemetry: speed in m/s, state (walk / sprint / crouch…), stamina, spread, recoil climb, ammo |
| `F5` | infinite ammo |
| `F6` | invulnerability |
| `F7` | time speed 1 / 0.5 / 0.25 / 0.1 |
| `P` | frame pause; `.` — step one frame |
| `F8` | FPS and frame time counter |

**Targets:**
- **Stationary dummy** — shows the damage of every hit and the average damage per second over the last 3 s.
- **Moving dummy on a rail** — speed 2 / 4 / 6 m/s, for testing lead and spread.
- **Shooter dummy** — spits every 2 s to test armour, dodge roll and crouch.
- Reset all targets with one button.

**Beetles by keys** (to test the feel against a live opponent): `Ctrl`+`1`…`5` — small, fast, spitter, bombardier, rhino; `Ctrl`+`0` — freeze the AI.

**Code:**
- All tunable numbers (speeds, weapons, armour) in one settings file, e.g. `src/tuning.ts`. Both the game and the panel read from it.
- The playground is only the scene and tools in `src/dev/`: `playground.ts` (scene), `panel.ts` (panel), `dummies.ts` (targets), `overlay.ts` (overlays).
- Mechanics live in the shared modules `player.ts`, `weapons.ts`, `combat.ts`.

**Done when:**
- all movement states and the four guns work and look as in section 10.2;
- parameters are edited on the fly and copied to JSON;
- a Playwright test opens the playground, walks 10 m by the grid, shoots a dummy at 10 m and checks damage and ammo consumption.

### Stage 1a. "Shooting gallery" — fighting the horde

1. A 24 × 24 m arena with covers and endless waves by the budget from section 5.
2. Beetles against the new shooting and movement.
3. Class 1 armour, helmet, armour plates.
4. RGD-5 grenades, if not done at stage 0.
5. Combat HUD: ammo "in magazine / in reserve", armour, stamina.

**Goal:** combat feels weighty and tactical — hide behind cover, reload, dodge roll.

### Stage 1b. The floor

1. A generator for one floor of 6 rooms by seed, 5 templates.
2. Doors closing in combat, transitions.
3. Raspberries as currency and healing.
4. 1 of 3 perks after a fight — 8 from the list.
5. The "Brood Mother" boss.
6. Results screen and return to the lobby.

### Stage 2

Merchant, the remaining guns and attachments, floors 2–3 and their bosses, elites, altars.

### Stage 3

Farm hub and meta-progression.

### Later

Networked play, special floors.

## 17. Playtest metrics

- **Room time:** 45–75 s.
- **Health after a room:** solo on average 40–70%, armour 0–50%.
- **Reloading in combat:** the player reloads in cover at least half the time. If almost always in the open — the hordes are too dense or the magazines too small.
- **Death on the first floor:** in 20–30% of a newcomer's runs.
- **Raspberries at the end of the floor:** the player chooses between healing, ammo and armour. If there is enough for everything — cut the income.
