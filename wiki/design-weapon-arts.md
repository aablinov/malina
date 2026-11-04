# Weapons, temper and weapon arts

Version 1.2 of 2026-10-25: juicy effects and elemental sloppiness — ribbons along curves, fat rings, every proc has its own trajectory (section 7). Version 1.1: own strike poses for every weapon kind (section 5), own swing, hit and weapon-art sounds (section 6). Version 1.0 — temper, synergies, weapon arts, new weapons. Complements [design-inventory.md](design-inventory.md) (enchantments, items) and [design-editor.md](design-editor.md) (the "Weapons" tab). References — screenshots of Minecraft Dungeons (fire aura, ring of lightning, beams, strike crescent, fan of arrows) and Dark Souls III (the paired blades of Pontiff Sulyvahn).

**Task.** The strike used to look weak and did not change with enchantments. Now every weapon kind has its own weapon art (Q), and enchantments work as **temper**: they colour the blade and trail, throw sparks, add a hit effect. Every pair of enchantments gives its own **synergy** — a special effect on the finisher.

Code: data — `src/temper.ts`, sound — `src/weapon-audio.ts`, poses — `STYLES` in `src/knight.ts`, effects — `src/weapon-arts.ts` (look, primitives, weapon arts) and `src/weapon-synergies.ts` (28 synergies), hero moves — `SpecialMove` in `src/knight.ts`, models and numbers — `src/weapons.ts`, items — `src/items.ts`, icons — `src/icons.ts`.

## 1. Weapon list

16 weapons in 14 kinds. Strike numbers — `DEFAULT_WEAPONS` (`src/weapons.ts`); damage — the three combo strikes at power 1, range — of the finisher.

| Weapon | id | Kind | Rarity | Combo damage | Range, m | What sets it apart | Weapon art (Q) |
|---|---|---|---|---|---|---|---|
| Warden's Sword | `sword` | sword | common | 10 / 12 / 24 | 2.5 | the baseline: quick strikes, finisher wave | Blade Whirl |
| Lumberjack's Axe | `axe` | axe | common | 13 / 15 / 30 | 2.2 | slower than the sword, knocks back harder | Boomerang |
| Mace | `mace` | mace | common | 12 / 13 / 28 | 2.1 | strong knockback, big wave | Triple Wave |
| Spear | `spear` | spear | common | 11 / 11 / 26 | 3.4 | long narrow lunges | Piercing Dash |
| Duelist's Rapier | `rapier` | rapier | common | 8 / 8 / 20 | 2.9 | lightning-fast thrusts in a narrow cone, crit 25 % ×2 | Flurry of Thrusts |
| Blacksmith's Knuckles | `knuckles` | knuckles | common | 7 / 7 / 18 | 1.7 | **paired**: the fastest strikes up close | Hail of Blows |
| Claymore | `claymore` | sword | rare | 16 / 18 / 38 | 3.1 | two-handed, long swings | Blade Whirl |
| Shadow Dagger | `dagger` | dagger | rare | 6 / 6 / 14 | 1.8 | a flurry of thrusts, crit 25 % ×2 | Shadow Step |
| Great Hammer | `hammer` | hammer | rare | 18 / 20 / 48 | 2.4 | crushing, the biggest wave | Earth Strike |
| Katana | `katana` | katana | rare | 11 / 11 / 26 | 2.6 | a curved blade, quick long slashes, finisher lunge | Iaido |
| Stargazer's Staff | `staff` | staff | rare | 10 / 10 / 24 | 2.8 | strikes from afar, wave 3 m | Star Wave |
| Guard's Halberd | `halberd` | halberd | rare | 14 / 14 / 32 | 3.3 | an axe on a pole: a wide arc from afar | Windmill |
| Reaper's Scythe | `scythe` | scythe | unique | 12 / 12 / 28 | 2.4 | very wide swings, finisher — 360° | Soul Harvest |
| Nagakiba | `nagakiba` | katana | unique | 15 / 15 / 34 | 3.6 | a two-handed katana with a laundry-pole blade (1.8 m), outreaches the spear | Iaido |
| Dragonslayer | `dragonslayer` | great sword | unique | 26 / 28 / 60 | 3.2 | Guts's sword: a slab of iron as tall as the hero, the strongest and the slowest | Berserker's Fury |
| Pontiff's Blades | `pontiff` | paired blades | unique | 9 / 9 / 22 | 2.3 | **paired**: flame in the right hand, starlight in the left (Pontiff Malivin) | Pontiff's Dance |

Four of my own choosing — **staff** (the kind existed, the weapon did not), **halberd**, **rapier**, **knuckles**: they cover the ranged staff-mage, a long pole with a chopping arc, duelling thrusts and the fastest close combat.

**Paired weapons:** `WeaponDef.offhand` — the model for the left hand, `trail` / `offTrail` — their own trail colours (without temper). The second blade is held the same way as the first and draws its own trail (`Knight.offTrail`); while you shoot the bow it is hidden.

## 2. Temper: the look of enchantments

An enchantment of a melee weapon, chosen and levelled at least to I, is temper (`temperOf`). Colours — `TEMPER_LOOK`.

| Enchantment | Temper | Sparks at the edge | On hit |
|---|---|---|---|
| Sharpness | Ice Steel | white glitter | a criss-cross cut |
| Critical Hit | Star | golden stars | stars; a crit — a flash and 8 rays |
| Vampirism | Crimson | scarlet drops falling | drops fly to the hero |
| Knockback | Hurricane | dust | a fan of dust and a ring |
| Whirlwind | Vortex | turquoise curls | a curl around the target |
| Fire Aspect | Fire | embers rising | flame and burning cubes |
| Soul Siphon | Ghostly | soul lights | a soul flies to the hero |
| Smiting | Storm | violet sparks and a discharge along the blade | a lightning discharge |

- **The blade** glows in the colour of the first temper (`Knight.setBladeTint`), flickers; a full Q meter — pulses brighter.
- **The trail** (`SwordTrail`): the fresh edge — the first colour, the tail blends into the second (`color2`), at the tip — a white core. One temper — one colour; two — strikes 1 and 2 alternate colours; three — in rotation. More levels — a wider and longer trail. On long blades the trail width is no more than 1.1 m.
- **The strike crescent** on every swing — a thin bright edge and a soft underlay in the swing's colour; on narrow lunges (spear, rapier) — a line.
- **HDR colours**, but the weak components below 1 — otherwise bloom burns everything out to white.

## 3. Synergies: 28 pairs

They trigger on **every finisher** (the third combo strike) and at the end of a **weapon art**; the name pops up over the point of impact, the list of active ones — top left in the HUD. Synergy damage — from the finisher weapon × power × (0.3 + 0.4 × pair levels / 6).

| Pair | Synergy | Effect |
|---|---|---|
| Sharpness + crit | Star Cut | four blades of light criss-cross over 3.5 m |
| Sharpness + vampirism | Bloody Cut | bleed 1.2 s, the drops heal |
| Sharpness + knockback | Air Blade | a crescent of wind flies 9 m, cuts and knocks back |
| Sharpness + whirlwind | Steel Twister | five blades circle the hero for 2 s |
| Sharpness + fire | Fire Cut | a burning strip of 6 m in front of the hero, 2.5 s |
| Sharpness + souls | Ghostly Echo | a ghostly copy of the weapon repeats the strike |
| Sharpness + smiting | Heavenly Sword | a huge blade falls from the sky, explosion |
| Crit + vampirism | Heart of the Star | healing 8 %, the next three strikes are crits |
| Crit + knockback | Comet Kick | the target flies off as a comet and explodes into a star |
| Crit + whirlwind | Star Spiral | eight stars scatter in a spiral |
| Crit + fire | Supernova | a golden fiery explosion of 3.2 m |
| Crit + souls | Starfall | five stars fall around, each — a soul |
| Crit + smiting | Wrath of the Heavens | golden chain lightning over five targets |
| Vampirism + knockback | Bloody Ram | a wave forward, heals for every one hit |
| Vampirism + whirlwind | Crimson Maelstrom | pulls enemies in for 1.5 s and drinks their strength |
| Vampirism + fire | Flame of Life | a ring of fire around the hero for 2.5 s: burns and heals |
| Vampirism + souls | Harvest of Life | everyone nearby gives up health and souls |
| Vampirism + smiting | Crimson Lightning | scarlet lightning into three targets, heals |
| Knockback + whirlwind | Hurricane | a twister moves forward for 2.2 s, sucks in |
| Knockback + fire | Fire Ram | a cone of flame, knocks back and ignites |
| Knockback + souls | Spirit Fist | a ghostly fist flies and explodes |
| Knockback + smiting | Thunderclap | lightning into the ground and a double wave |
| Whirlwind + fire | Fire Twister | flame circles the hero for 2 s |
| Whirlwind + souls | Wheel of Souls | six souls circle and fly at the nearest |
| Whirlwind + smiting | Storm Ring | six lightnings in a circle around the hero |
| Fire + souls | Blue Flame | ghostly fire for 2 s, siphons souls |
| Fire + smiting | Meteor | a fiery meteor from the sky |
| Souls + smiting | Ghostly Chain | blue lightning over six targets, each — a soul |

**Resonance** — three tempers: on the finisher all three pair synergies trigger (each one's damage ×0.7) and three rings of three colours spread out. So every triple has its own set — 56 different combinations.

## 4. Weapon arts (Q)

**The meter** above the dodge roll (the Q slot): a strike that touches a target gives 1/8 of the meter (+¼ for every extra target). Full — the slot glows, the blade pulses; Q — a strike toward the cursor, the name large in the centre. Damage — from the finisher weapon.

| Kind | Art | What it looks like | Damage |
|---|---|---|---|
| sword | Blade Whirl | two spins, arms out, you can walk | 4 × 0.45 in a circle |
| axe | Boomerang | the axe flies spinning 8 m and returns to the hand | 0.9 out and back |
| mace | Triple Wave | a blow on the ground: waves of 2.6 / 4 / 5.4 m | 3 × 0.6 |
| dagger | Shadow Step | a dash of 6 m, invulnerable, then three cuts on everyone in the path | 3 × 0.5 |
| spear | Piercing Dash | a lunge of 5 m, pierces and shoves aside | 1.6 |
| hammer | Earth Strike | a leap and a blow, wave 5.5 m, stones out of the ground | 2 |
| staff | Star Wave | a crescent of force for 10 m, pierces everyone | 1.4 |
| scythe | Soul Harvest | a spin: pulls enemies in, each — a soul | 2 × 0.6 |
| katana | Iaido | the blade at the hip, the world darkens — an instant cut with a 3.5 m step, the cuts appear later | 1.8 |
| great sword | Berserker's Fury | three spins: five strikes and a crimson wave | 5 × 0.55 + 0.6 |
| paired blades | Pontiff's Dance | eight strikes of flame and light in turn, a cross and an explosion | 8 × 0.3 + 0.8 |
| halberd | Windmill | 2.5 spins with a 4 m step | 4 × 0.5 |
| rapier | Flurry of Thrusts | seven thrusts and a piercing one | 7 × 0.32 + 0.8 |
| knuckles | Hail of Blows | eight blows and an uppercut with a wave | 8 × 0.25 + 1 |

Dashes (dagger, spear, hammer, katana) are invulnerable at the start. At the end of every weapon art the temper synergies trigger (for whirls — ×1.2).

## 5. Strike poses

Every weapon kind has its own style of three combo strikes (`STYLE_OF` and `STYLES` in `src/knight.ts`); wind-up and strike — poses of arms and torso, timing — from the weapon's numbers (`windup`, `strike`).

| Style | Weapons | Strike 1 | Strike 2 | Finisher |
|---|---|---|---|---|
| sword | sword, claymore | right to left | backhand from below | overhead with both hands |
| heavy | axe, mace, hammer, great sword | a wide turn of the torso | backhand from a full swing | overhead with a deep wind-up and a lean |
| katana | katana, nagakiba | a draw from the left hip, horizontal | a diagonal from top right, the left hand helps | vertical with a step |
| lunge | spear, rapier | a thrust forward | a thrust slightly to the left | a deep lunge with the whole body |
| dagger | dagger | a short swing | backhand | a thrust |
| polearm | staff, scythe, halberd | a low wide swing with both hands | a high backhand | a chop from above |
| paired | pontiff's blades | right | left | both criss-cross |
| fists | knuckles | a right straight | a left straight | an uppercut |

For paired weapons the second blade keeps its own tilt (`Pose.wl`) — a left-hand strike leads the left blade with its own trail. The "Weapons" tab in the editor edits only the right-hand model — and that is how it stays: the second hand is set in code (`offhand`).

## 6. Sounds

`src/weapon-audio.ts`, from the same bricks as spell sound (`src/spell-audio.ts`: noise through a filter, a thump in the bass, bells), within the same voice budget.

- **Swing** (`weaponSwing`): sword — a medium whistle; katana — thin and fast, a high "shing" on the draw; dagger — short and high; rapier and spear — a rising "fwit"; heavy — a low long hum with a thump in the bass; great sword — the lowest; halberd — deep; scythe — a whistle with a glassy note going down; staff — a whistle and a pentatonic pluck; paired — the right crackles with flame, the left rings with light; knuckles — short and tight.
- **Hit** (`weaponHit`): blades — a slice and the ring of steel (the katana's — clean and high), heavy and knuckles — a dull thump in the bass, spear — a prick and a thump, scythe — a bell on the finisher, staff — a shimmer of bells, paired — the crackle of flame and a chime.
- **Weapon art** (`specialSound`, moments `start` / `hit` / `end`): blade whirl — a whistle winding upward, a chime on every circle, a chord; boomerang — a throw, a whistle on every revolution, a clang on return; triple wave — three thumps in the bass, a bell; shadow step — a reversed breath and a dark hum, three dry cuts; spear lunge — a rising whistle and a thump; earth strike — the whistle of the leap, an earthquake and tumbling stones; star wave — bells going up; harvest — a low choir and bells going down; iaido — a hum and a heartbeat in silence, a full-screen "shing", the cuts appear with a crackle; berserker's fury — a roar of iron, a heavy whistle on every spin, a crash; pontiff's dance — flame and light in turn, a chord and an explosion; windmill — a rising hum; flurry of thrusts — ringing clicks going up the pentatonic; hail of blows — thumps in the bass and an uppercut.
- In test mode (`script`) the sound is silent (`quiet`).

## 7. Juiciness and sloppiness

Following the references (fire aura, a ring with a white rim, yellow arc-beams from enemy to enemy) the effects became "fatter", and repeats — different: the element behaves like a living entity, not like an animation on rails.

- **Ribbon trails** (`src/fx-streaks.ts`, `fx.streak`): a ribbon stretches behind a flying "head" — a bright core and a wide soft halo, the tail narrows and blends into the second colour. Always facing the camera; all ribbons — one mesh, one draw call, 96 slots. For fire and blood the core has no white (`core`), so the colour does not burn out.
- **Elemental trajectory** (`WeaponArts.curve`): from point to point (or after a moving target) along an arc with a random sideways bend, rise, skew and jitter — every call builds its own curve. Along it fly the lights of healing and souls (`orbs`, they catch up with the hero), "entities" (`wisp`), sparks (`sparks`), arcs of chain lightning (`chain` — they sag in a random direction, a thick ribbon and a thin broken line on top).
- **Fat ring** (`fx.ring`): a soft wide halo, a bright rim and a wall of light above the ring, melting upward; radius ±10 % every time. It replaced the flat rings in all synergies and weapon arts. The colour is brought to a saturated one (weak components below 1) — overlapping rings do not burn out to white.
- **Swing:** the crescent is slightly different every time — angle ±0.1 rad, radius ±8 %, height, width of the arc; on the finisher — a third layer. From the crescent's edge spark ribbons fly off along the tangent.
- **Hit:** a flash of varying size and splash ribbons along the strike direction in the colour of a random one of the tempers.
- **Synergies with their own sloppiness:** the cross of "Star Cut" is rotated differently, rays of different lengths fly out as ribbons; the blades of "Steel Twister" circle in a random direction and "breathe"; "Fire Cut" — a snaking strip; "Ghostly Echo" swings now from the left, now from the right with a tilt; "Heavenly Sword" and "Meteor" fall from a different side of the sky every time with a tail; "Star Spiral" is wound in its own direction and with varying density, the stars have tails; "Starfall" — stars from different sides; "Crimson Maelstrom" — clots along their own spirals; "Flame of Life" — three tongues run along a breathing ring, dense fire in cubes; "Hurricane" wanders in a snake line; "Fire Ram" — tongues of flame along their own arcs; "Spirit Fist" flies along an arc; "Fire Twister" — four streams at different heights; "Wheel of Souls" circles in a random direction and scatters along curves; "Storm Ring" — 5–7 lightnings from a random angle; "Comet Kick" — a tail behind the target.
- **Weapon arts:** the boomerang goes out along an arc on one side and returns along the other, the bend is its own every time; a winding ribbon trails behind the shadow step; lightning from the sky strikes from different sides and with a different break, with a thick core and sparks.
- **Cost:** the worst case — a resonance of three synergies on the pontiff's blades in a row — up to 62 ribbons at once, 5.7 ms per frame (simulation and rendering), no new shaders: the ribbon material is warmed up in `fx-zoo.ts`.

## 8. How to check

- **F1** → "Weapons" (any of the 16 on top of the equipped one) and "Temper 1–3" (any enchantments at III): the look, synergies and Q without levelling. Temper from the panel does not change the item's numbers — only the look, synergies and weapon art.
- From the console: `__malina.weapon('pontiff')`, `__malina.temper(['fireAspect', 'smiting'])`, `__malina.arts.meter = 1`, `__malina.special(x, z)`; `__malina.arts.procs` — how many times each synergy triggered.
- The "temper" test (`tests/playground.spec.ts`): all 28 pairs trigger on the finisher, resonance, the Q meter, the weapon arts of all 16 weapons hit, the boomerang returns, paired weapons have a second blade, every weapon has its own strike style.

## 9. What is not done

- ~~One combo animation shared by all~~ — own poses, section 5.
- ~~Weapon-art sounds from the shared set~~ — their own, section 6. Synergies still sound with the shared sounds.
