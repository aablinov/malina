# Spells and auras

Version 1.7 of 2026-10-29: one registry of all spells `SPELLS` — the starters moved from `Spells` into `src/magic/starters.ts`, `Spell` gained charge hooks; `gear.ts` applies an artifact in one place (section 6). Version 1.6 of 2026-10-25: ten base spells at the merchant — fire, summoning, raspberry blood, light (section 3.1); summoned creatures are decoys for mobs. Version 1.5 of 2026-10-25: seven offensive auras — they burn, freeze, strike with lightning and beams, weaken, shove with earth, cut with blades. Version 1.4 of 2026-10-24: common spells are sold by the merchant for raspberries and do not drop from bosses. Version 1.3: 20 boss spells done — registry `src/magic/`, four new schools (light, dark, earth, arcane) with sigils and sound, pomp by rarity (slow motion, world darkening, camera pull-back, big title). Version 1.2: auras done — fourth slot (R), five auras, meter and ×3 flare. Version 1.1: cast sigils built from layers per school, spell sound — pentatonic, bass through saturation, reverb, charge in steps. Version 1.0: magic framework, 4 starter spells and 5 auras (done), 20 boss spells (design only so far), anatomy of a cast. A mix of Elden Ring (charging, "heavy" casts), Minecraft Dungeons (slots, souls, friendly voxel look) and Warcraft 3 (auras on allies, combos). Slots and souls — [design-inventory.md](design-inventory.md), enemies and bosses — [design-dungeon.md](design-dungeon.md).

## 1. Framework

- **Slots.** A spell is an artifact item (`slot: 'artifact'`) with a `spell` field; it is equipped into the same slots 1 / 2 / 3. An aura is a separate fourth slot (key R), affects all allies within 8 m, as in WC3 (there are no allies yet — only the hero).
- **Where they come from.** The 4 starters — every hero has them from the start. **Common** ones (ash crown, frost ridge, storm cloud, skull scythe, raspberry bush — `spell: 'shop'`) are sold by the **merchant** for raspberries: the fourth item on the counter, visible in advance, first the one the hero does not have, changes after purchase; price 110 + 12 · power. Common ones do not drop from bosses. Rare ones drop from mini-bosses, legendary — from bosses, mythic — from the floor's final boss (`spell: 'boss'`). Chests, random merchandise and ordinary enemies do not give spells (`rollLoot` skips items with `spell`).
- **The drop is an event.** A grimoire falls over the boss: a pillar of light, slow motion ×0.3 for half a second, a choir, the book hovers and flips its pages.
- **Charging, as in Elden Ring.** Tap — quick cast. Hold the key — a cast sigil unfolds underfoot (section 5.1), particles are drawn to the hand, the sound rises in steps (section 5.2); release — the sigil flashes and spreads, the cast is stronger (×1 → ×2.5). While charging you walk at half speed and face the cursor.
- **Cost.** Cooldown; some boss spells also spend souls.
- **Pomp grows with rarity** (section 5).

## 2. Starter spells (done)

| | What it does | Charge | Cooldown |
|---|---|---|---|
| **Spark** (lightning) | Lightning from the sky at the target under the cursor, jumps to 2 more | Jumps 2 → 5, damage ×2.5 | 4 s |
| **Fireball** | The ball flies to the cursor, explodes on touching a target or at the end of its path | The ball grows in the hand from a ball to a barrel, blast radius 2.2 → 4 m | 6 s |
| **Ice Rain** | A zone at the cursor: icicles fall for 2 s, damage in waves | Radius 3 → 5 m, icicles 14 → 34 | 10 s |
| **Minor Heal** | Heals the hero (later — allies nearby too) | Healing ×2.5 | 12 s |

Starter set: 1 — fireball, 2 — spark, 3 — heal; ice rain lies in the inventory. Old saves get the four spells added to the inventory, free slots are filled with them.

## 3. Boss spells (done)

Mini-bosses exist — eight wardens drop rares ([design-bosses.md](design-bosses.md)); 15 boss spells lie in the inventory from the start (old saves get them added, like auras) — equip into slot 1/2/3 and try; five common ones are bought from the merchant. The school sets the colours, the pattern of the cast sigil and the charge chord: fire, ice, lightning (as for the starters), **light** (gold and white: rays, pentagram), **dark** (violet and turquoise: spiral, eye), **earth** (amber and green: cracks, stones, leaves), **arcane** (purple and pink: crown of swords, pentagram).

**Fire**
1. **Heavenly Hammer** (rare) — a meteor at a point: for 1 s a red shadow grows and the howl of the fall rises, impact — crater, stun, stones, burning floor.
2. **Flame Serpent** (legendary) — a fiery serpent crawls along the ground, weaves between enemies, leaves a burning track; lashes its tail on turns.
3. **Ash Crown** (common, at the merchant) — a ring of fire spreads from the hero as a wave and knocks back.

**Ice**
4. **Ice Tomb** (rare) — freezes an elite into a crystal; after 2 s the crystal bursts into a fan of shards.
5. **Frost Ridge** (common, at the merchant) — a fan of ice spikes grows out of the ground and tosses enemies up.
6. **Absolute Zero** (mythic) — a dome of 8 m, inside it time almost stands still, enemies freeze for 4 s; the world loses colour, sound goes muffled, a heartbeat is heard.

**Lightning**
7. **Thunderer's Spear** (rare) — charging grows a spear of lightning in the hand, the throw pierces a line, thunder at the exit.
8. **Thunder Leap** (legendary) — the hero leaps up and strikes the ground, chain lightning in all directions.
9. **Storm Cloud** (common, at the merchant) — a cloud hangs over the hero for 8 s and strikes the nearest on its own.

**Light and stars**
10. **Starfall** (legendary, hold) — for 5 s stars fall over the whole zone, the hero hovers in a pillar of light.
11. **Fallen Star Beam** (mythic) — a huge beam from the hands, the hero slowly sweeps it; the camera pulls back, a scorched strip on the floor.
12. **Heavenly Judgement** (legendary) — a pillar of light strikes enemies, heals allies and **raises a fallen ally**.

**Dark and souls**
13. **Choir of the Dead** (rare) — ghostly hands from the ground hold enemies and drag them down, whispering.
14. **Gravity Well** (legendary) — a black sphere pulls in enemies and items for 2 s, then collapses and throws them out; the light around it bends.
15. **Skull Scythe** (common, at the merchant) — a flying skull: damage to an enemy, healing to an ally.
16. **Fallen Wardens** (rare, 50 souls) — three ghostly knights for 15 s out of blue portals.

**Earth and nature**
17. **Rift** (rare) — a crack runs forward, stone spikes out of it toss enemies up.
18. **Raspberry Bush** (common, signature, at the merchant) — a thorny bush holds enemies, after 4 s bursts with berries, the berries heal allies.
19. **Titan Form** (mythic) — for 10 s the hero is a huge stone giant, blows shake the ground.

**Arcane**
20. **Phalanx of Blades** (rare) — a fan of 7 ghostly swords over the head, they fly one by one; each rings its own note, together — a chord.

Reserve: **Rupture** — a dash-teleport with an explosion at the point of vanishing and the point of appearing.

**Elemental combos** (co-op): lightning on a frozen target — ×3 and a glassy chime; fire on one bound by roots — sets the bush alight; a well followed by a meteor — "the build". A combo has its own flash and a caption above the enemies.

## 3.1. Base spells (at the merchant)

Not too strong, common rarity (`spell: 'shop'`): sold by the merchant ("Spells" tab), and in the playground all ten lie with the hero from the start (old saves get them added). Numbers — tap, full charge ×2.5.

| Spell | School | What it does | Numbers |
|---|---|---|---|
| **Fire Wall** | fire | A wall of fire across the path to the cursor, burns everyone in it and passing through; charge — longer | 5 m, 8 damage every 0.5 s, 4 s, cooldown 10 s |
| **Fire Hurricane** | fire | A twister slowly rolls toward the cursor, sucks in and slows | 6 damage every 0.3 s, −30 % speed, 4 s, 12 s |
| **Minor Armageddon** | fire | A rain of fireballs around the hero, every third — at the nearest enemy | 8–14 balls of 14 each, circle 5 m, 3 s, 16 s |
| **Wolf Pack** | summoning | Wolves out of portals chase the nearest, the bite slows | 2 (3 with charge), 8 damage, 12 s, 20 s |
| **Minor Elemental** | summoning | Hovers and shoots sparks; element in turn: fire, ice (slows), lightning (stuns for an instant) | 10 damage once per 1.2 s, 15 s, 22 s |
| **Stone Golem** | summoning | Slow, punches the ground, keeps mobs on itself | 18 in a 2 m circle, stun 0.5 s, 18 s, 28 s |
| **Raspberry Claws** | blood | Three claws of raspberry flame in front of the hero | 22 damage + bleed 50, 6 % health, 5 s |
| **Raspberry Swarm** | blood | A stream of raspberry midges in a cone | 4 damage per tick + bleed 15, 1.5 s, 8 % health, 6 s |
| **Raspberry Blade** | blood | The weapon in raspberry juice: sword blows are stronger and build up bleed | +10 % sword damage, bleed 25 per hit, 15 s, 10 % health, 25 s |
| **Blinding Flash** | light | A flash around the hero: damage, knockback, stun of regular mobs (not bosses) | 12 damage, 4 m, stun 1.5 s, 14 s |

- **Raspberry blood** (like Elden Ring blood magic, `src/magic/blood-core.ts`): a cast costs a fraction of health, but not below 1 — you cannot kill yourself; in return the cooldown is short. Hits build up a bleed meter on the target (100, decays after a second without hits); a full meter bursts in a splash — 20 damage, a fountain of raspberry juice, +5 health to the hero.
- **Summoning** (`src/magic/minions.ts`): a portal, a figure rises from the ground, walks on its own to the nearest enemy (not to barrels), without enemies stays near the hero, dissolves at the end. While alive — a **decoy** (`src/decoys.ts`): a mob picks the nearest target among the hero and the summoned and attacks it; a golem with `taunt` pulls all mobs within 8 m, even if the hero is closer. The summoned creature's health runs out — it vanishes early.

## 4. Auras (done)

An aura is always visible around the hero: a dim sigil of its school underfoot (layers of steps 0–1) and its own sign. Damage dealt builds a meter (250); when full — the HUD slot glows and chimes, **R** — the aura **flares**: 5 s of ×3 effect, a big sigil of radius 4 m unfolds completely (symbols, a wall of rays), rings, screen flash, light, hitstop, the element's chord and a banner; at the end the sigil spreads out, the chord goes down. While there are no bosses, all twelve auras lie in the inventory (old saves get them added); they are not sold by the merchant — they drop from the floor's bosses by chance ([design-bosses.md](design-bosses.md), section 4).

| Aura | Effect | Look |
|---|---|---|
| **Blood Pact** | 8 % of any damage — into health | Red drops fly in an arc from the wound to the hero, a "gulp" |
| **Bastion** | −20 % damage taken | Three shield runes circle around; a hit — the shields flash, a ring, shield clang |
| **Rage** | +15 % damage (sword, arrows, spells), +10 % crit chance | Embers rise from the weapon hand |
| **Clarity** | −25 % spell and artifact cooldowns, +50 % souls | Three blue lights circle over the head |
| **Crown of Thorns** | 30 % of damage — back to the nearest enemy within 3 m | A ring of thorny vines; a hit — thorns fly at the attacker |

**Offensive auras** (by school) strike enemies around the hero on their own — barrels and crates are left alone. Zone auras have a ring glowing underfoot along the zone's edge that flashes on every pulse. The aura's own damage builds the meter at half rate, otherwise the flare would charge from standing in a crowd. Flare — ×3: where there is damage per hit, damage ×3; where there is a rhythm — more often. Numbers are drafts, not yet checked in the game: damage per hit — the item's power, rhythm and radii — `OFF` in `src/aura-offense.ts`.

| Aura | School | Constant | Flare (R) | Look |
|---|---|---|---|---|
| **Crucible** | fire | 3 damage every 0.5 s to everyone within 2.5 m | Radius 4 m, damage ×3, fire cubes | A ring of embers, tongues of flame along the edge |
| **Chill** | ice | 2 damage every 0.5 s and −30 % speed for 1 s within 3 m | Freeze (stun 1.2 s) of everyone within 4 m, −60 % speed, damage ×3 | Snowflakes swirl and fall, frost on the slowed |
| **Storm Crown** | lightning | Once per 1.2 s lightning from the shoulder at a random enemy within 5 m: 8 damage and 2 jumps at 60 % | Lightning every 0.4 s | Sparks run over the armour |
| **Punishing Halo** | light | Every 4th hero hit — a beam from the sky at the target: 12 damage to it and to neighbours within 0.9 m | A beam on every hit | A golden halo over the head |
| **Hungry Shade** | dark | Enemies within 3 m take +15 % damage | Weakening ×3 within 4 m, the shade drinks 4 damage every 0.5 s, half of it — to the hero | Violet haze at the feet, an eye |
| **Stone Tread** | earth | Once per 3 s a shove: 10 damage and knockback within 2.2 m | A shove every second within 3.5 m, a ring of stone spikes | Pebbles bounce at the feet, more often before a shove |
| **Whirl of Blades** | arcane | 3 ghostly swords at 1.3 m cut whoever they touch: 4 damage, one target — no more than once per 0.4 s | 6 swords at 1.8 m, spin faster | Flat pink blades with a golden guard |

Slowing and stunning work only on regular mobs (`Target.chill`, `Target.stun`); bosses have their own stuns, the aura does not touch them. Weakening (`Target.expose`) works on bosses too.

## 5. Anatomy of a cast — so that the power is felt

Every cast is three phases, all mandatory.

1. **Wind-up** (0.15–1.2 s). A rune sigil underfoot, particles are drawn to the hand, the hero turns to the target and stretches out the arm; a hum, pitch rising with the charge. A "shadow" on the target in advance: falling sparks, a frost circle. At the end of the wind-up the other sounds are ducked — "silence before the blow".
2. **Impact.** A screen flash in the element's colour for 1–2 frames, a real point light lights the scene, a ring along the ground, a scatter of particles, shake. Sound in three layers: bass (a thump at 40–60 Hz) + crackle/click + the body of the element. Full charge adds a hitstop of 50–90 ms.
3. **Aftertaste** (1.5–3 s). A mark on the floor (scorched spot, frost, a bright circle), smouldering embers or crawling sparks, a slowly fading light, a dying tail of sound (a rumble of thunder, the crackle of embers, a chime).

### 5.1. The cast sigil — an event on the map

The sigil under the hero (and at the impact point for ice rain) is built from 5–7 layers, each school with its own pattern. Layers rotate in different directions at different speeds and unfold **in steps by charge** — 0, ¼, ½, ¾: a new layer "clicks" (pops out larger and brighter, settles into place), a ring runs along the ground, sparks fly up from the sigil's edge, the camera twitches slightly, a note sounds. From the third step eight glowing symbols circle around the hero and small lights rise from the edge, from the fourth a wall of vertical rays stands up. At full charge the sigil "breathes". Cast — the sigil flashes, spreads and melts away; cancel — it just fades.

| School | Layers (from step 0 to 3) |
|---|---|
| Spark | A notched ring, a zigzag lightning → a square and a rhombus toward each other (a star) → a ring of symbols → beads along the outer edge, a triangle in the centre |
| Fire | A notched ring → a hexagram → a ring of symbols, a crown of flame tongues → a triangle and a rhombus in the centre |
| Ice | A notched ring → a hexagon, a snowflake → a ring of small rhombi → a ring of symbols |
| Heal | A notched ring → a "flower of life", a square → a rhombus, a wreath of leaves → a ring of symbols |

### 5.2. Sound — power and "childlikeness"

- **Notes, not squeaks.** Everything is built from the major pentatonic: whatever you play in a row sounds joyful, as in MCD. Voices — pairs of slightly detuned oscillators through a filter with an envelope (warm, not "beepers"); the sawtooth — only for fire and only through a low filter.
- **Power comes from the bass.** Impacts — a sine with a falling pitch through soft saturation (tanh): harmonics make the bass audible even in laptop speakers. The master output goes through a compressor (loud, without rasp) and reverb — spells sound "in a hall".
- **Charge in steps.** The element's chord bed: on each step one more note of the chord enters and a bell rings higher than the previous one, a "whump" in the bass. The bass and the wind of magic grow with the charge, the "heart" pulse quickens from 0.44 to 0.12 s. Full charge — a fanfare of bells and a shimmer on top until you release.
- **Impacts:** spark — a click, a discharge, a bright major chord, a long rumble; fire — a heavy thump, the roar of flame, a brassy chord, the crackle of embers; ice — the glassy chime of shards and a chord of bells, each icicle — a note of the pentatonic (the rain adds up into a melody); heal — a harp over two octaves and a warm chord.

**Pomp by rarity** (`Spells.pomp`): common — phases 1–3; rare — plus hitstop and shake always; legendary — plus slow motion ×⅓ for 0.35 s and wide shock waves; mythic — plus the world darkens and desaturates (`fx.darken`), the camera pulls back (`fx.zoom`), a big title in the centre (`fx.title`), a choir.

## 6. How it is built

- **`src/spells.ts`** — class `Spells`: charge (`start` / `release`, charge visuals — the sigil underfoot, the orb in the hand, steps), `cast` (multiplies by charge and calls `Spell.cast`) and a set of casting tools — `later`, `proc`, `impact`, `windup`, `pomp`, `groundSigil`, `bolt`, `nearest`, `within`, `ground`, `face`, `hand`, `color`, `buff` (hero buffs — multiplied by `gear.ts`), `aim`, `tex`; schools `School` and their colours. ~~Starter spells inside the class~~ — moved to `src/magic/starters.ts`.
- **`src/magic/registry.ts`** — one registry of all spells `SPELLS: Record<SpellKind, Spell>` (starters, base, boss; the types check that none is forgotten) and `spellOf(kind)` — the spell by artifact kind or `null` for a plain one (fire arrow, totem…).
- **`src/magic/kit.ts`** — type `Spell`: school, pomp tier, `cast` and optional charge hooks — `self` (targets itself: the hero looks forward, not at the cursor), `orb(k)` (size of the orb in the hand), `charging(kit, hand, k)` (its own picture every frame of charging: sparks in the palm for spark, embers for fireball).
- **`src/magic/starters.ts`** — the four starters: spark, fireball, ice rain, heal (`STARTERS`).
- **`src/magic/base-*.ts`** — base spells (fire, summoning, blood, light) and their icons; `minions.ts` — the common behaviour of the summoned, `blood-core.ts` — payment in health and bleed; `src/decoys.ts` — decoys, `src/mobs/mob.ts` targets the nearest among the hero and decoys.
- **`src/magic/`** — boss spells: groups `fire-ice.ts`, `storm-light.ts`, `dark-arcane.ts`, `earth.ts` and their icons `*-icons.ts` (~~`BossSpell`, `BOSS_SPELLS`~~ — now `Spell` and the common `SPELLS`).
- **`src/sigils.ts`** — class `Sigil`: sigil layers by school (`STYLE`), patterns drawn in code (`DRAW`), unfolding in steps, symbols, the wall of light, `burst` on cast.
- **`src/spell-audio.ts`** — voices (`voice`, `hiss`, `boom` with saturation, `bell`, `pluck`), `ChargeSound` (bed, bass, wind, pulse, steps, full charge) and `spellSfx` — the sounds of casts and impacts.
- **`src/fx.ts`** — shared cast details: `screenFlash` (screen flash), `light` (a pool of three `PointLight`s, always in the scene so as not to rebuild shaders), `decal` (a mark on the floor), `hitstop` (hitstop: the playground loop almost stops time until it expires).
- **`src/fx.ts`** — also `slowmo`, `darken`, `zoom`, `title` for mythic pomp.
- **`src/audio.ts`** — compressor and reverb on the output, the `bus` for ordinary sounds and `duck` (duck it before an impact; spells sound past the bus), `audioCore()` — the nodes for spell sound.
- **`src/gear.ts`** — `pressArtifact` / `releaseArtifact`: a spell with charge starts charging, everything else fires immediately; a click on a HUD slot and `__malina.artifact(i, x, z, charge)` — a cast without holding. `useArtifact` — the one place of application: common checks (slot, cooldown, hero on his feet, souls), then `spellOf(kind)` — a spell is cast by `Spells.cast`, otherwise a plain artifact — `plain` (fire arrow, totem, boots, horn, lightning cube, soul reaper).
- **`src/items.ts`** — items `spark`, `fireball`, `icerain`, `heal` with the field `spell` (`'starter'`), `charge` — time to full charge; auras `pact`, `bastion`, `rage`, `clarity`, `thorns` and the offensive `inferno`, `frost`, `storm`, `halo`, `shade`, `quake`, `blades` — slot `aura`, field `aura` (kind, power %, for offensive ones — damage per hit, radius), `spell: 'boss'`.
- **`src/auras.ts`** — class `Auras`: effects (`leech`, `damageTaken`, `dmgMult`, `cdMult`, `soulsMult`, `thorns`), the meter and `flare`, the look. Gear (`gear.ts`) multiplies the stats and sets `dmgTakenMul` on the hero; a hit on the hero is noticed by the drop in health. HUD — a slot with a meter in the aura's colour, inventory — a slot to the right of the hero and an "Auras" tab.
- **`src/aura-offense.ts`** — class `AuraOffense` (field `Auras.offense`): a pulse on a timer, search for enemies within the radius (without `prop`), damage through the `damage` hook, flag `own` (meter at half rate), numbers `OFF`. `Target` gained optional `prop`, `chill`, `expose`, `stun`: for `Mob` — slowing (`slowMul` in `pace` and `dash`) and stun, for `Boss` — weakening. Icons — `src/aura-icons.ts`, sigils — `STYLE` in `src/sigils.ts`, sounds — `auraBurn`, `auraChill`, `auraZap`, `auraBeam`, `auraDrain`, `auraStomp`, `bladeCut`.
