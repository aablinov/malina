# HUD, inventory and gear progression in the spirit of Minecraft Dungeons

Version 1.4 of 2026-10-25: ~~the merchant has an "Auras" tab~~ — removed the same day, auras drop from the floor's bosses (section 9). Version 1.3 of 2026-10-25: merchants — a grid of all goods with prices by stats, all weapons in the inventory (section 9). Version 1.2 of 2026-10-24: magic chests, bright loot and raspberries with special effects and sound (section 12). Version 1.1: armour and bow on the hero, blacksmith and merchant, a Diablo-style map, black squares around spells. Complements [design-dungeon.md](design-dungeon.md) (weapons, buffs) and [design-editor.md](design-editor.md) (the "Weapons" tab — melee models and strikes). How to test — [dev-testing.md](dev-testing.md).

The goal is to be as close as possible to Minecraft Dungeons in look and rules, but for a PC in a browser: everything is controlled with mouse and keyboard, gamepad hints (LB/RB, A/B/X/Y) are replaced with keys.

Code: data and rules — `src/items.ts`, combat — `src/gear.ts`, HUD — `src/hud/hud.ts`, inventory — `src/hud/inventory.ts`, map — `src/hud/automap.ts`, merchants — `src/merchants.ts` and `src/hud/shop.ts`, icons — `src/icons.ts`.

## 1. HUD

Bottom centre — a dark panel with bevelled edges, as in MCD (from screenshots 5 and 6 of the request):

| Left to right | Key | What |
|---|---|---|
| Spiral and number | — | Free enchantment points |
| Chest (violet frame) | I | Open the inventory (click works too) |
| Three artifact slots | 1, 2, 3 | Icon, dark cooldown fill from the top and seconds; empty — "+"; active (totem, boots) glows gold; not enough souls — the icon is grey |
| Bar under the artifacts | — | Souls (blue), up to 100 |
| Heart in a shield | — | Health: the red drains from the top; below — lives "3 ♥"; with F4 — numbers |
| Potion | E | Cooldown 20 s |
| Map | M | Full map (section 7) |
| Double chevron | Space | Dodge roll, grey on cooldown |
| Hexagon with arrows | RMB | Arrow count on top; run out — red |
| Raspberry | — | Currency (emeralds in MCD) |
| Bar under the right half | — | Experience to the next level, "LV n" |

Top right under the quest — the mini-map (section 7). Top left — active effects as diamonds (speed, healing, "×35 Multishot", "Infinity", immortality), top right — the quest in a pixel font and a subtitle in yellow. Top centre — a banner ("Level 2", a found item).

Sizes — in `em` from the root font `clamp(10px, min(0.84vw, 1.5vh), 22px)`: at 1920 × 1080 a slot ≈ 62 px, as in MCD. Digits and headings — Press Start 2P (with Cyrillic), text — Rubik.

## 2. Inventory

`I` or `Tab` — open; the game is paused, as in single-player MCD. Background — a maroon-violet gradient with large "pixels".

- **Left — the hero.** A 3D model of the same `Knight` with the equipped weapon (its own render on a canvas, slowly rotates, drag with the mouse — to turn). Around it — slots: melee weapon, armour, ranged; below three artifacts; on the left a level hexagon with an experience ring, on the right — power.
- **Centre — tabs and grid.** All, melee, ranged, armour, artifacts, enchanted; `Q` / `E` — flip through. A grid of 3 per row with scrolling, empty cells with a cross fill out the last row.
- **Item tile:** a frame and a chequered corner in the rarity colour (common — grey, rare — green, unique — orange), an icon, power with the kind glyph bottom right, invested points with a spiral top left, enchanted — a violet glow with a running highlight, a green ▲ / red ▼ — stronger or weaker than the equipped one, a yellow corner — new (disappears on selection).
- **Right — the card:** power, rarity badge, "Equipped", the name in a pixel font, a large icon, properties as diamonds, description; for melee weapons — "Power / Speed / Area" bars (red tick — the equipped one); below three enchantment-slot diamonds. Melee weapons also have temper lines: weapon art Q, blade look and pair synergies ([design-weapon-arts.md](design-weapon-arts.md)).
- **Mouse:** click — select, double click or RMB — equip, drag onto a hero slot — equip there (an artifact — into the chosen slot). **Keys:** arrows — across the grid, Enter — equip, X — salvage, Esc / I — back and close.
- **Salvage:** the "Salvage proceeds" panel — raspberries and the points spent; the equipped item cannot be salvaged.

## 3. Items

`ItemDef` — a record of the catalogue `ITEMS`: kind (`melee`, `ranged`, `armor`, `artifact`), rarity, icon, description and the kind's numbers. `Item` — an instance in the profile: `uid`, `def`, power `power`, enchantment slots, the "new" flag.

- **Melee weapons** reference `weapons.ts` (`weapon: 'claymore'`) — the model and three strikes are taken from there; equipped — `applyWeapon` and `Knight.setWeapon`. `?weapon=<id>` in the address — on top of the equipped one, for debugging.
- **Ranged:** damage, pause between shots, arrow speed and range, arrows per shot (the "Star Bow" fan), knockback.
- **Armour:** health (added to 100) and properties: souls, artifact and melee damage, artifact and dodge-roll cooldowns, potion healing, arrows per bundle.
- **Artifacts:** fire arrow (a rocket to the cursor, explosion), healing totem, boots of speed, horn of wind (knockback around), lightning cube (the three nearest targets), soul reaper (spends 40 souls, an explosion around). Explosions ignite the storage-yard barrels. **Spells** are equipped into the same slots — the starters spark, fireball, ice rain and heal; hold the key — charge ([design-spells.md](design-spells.md)). The fourth slot — **aura** (R): a meter from damage and a ×3 flare.
- **Power** grows the numbers: ×(1 + 0.06 · (power − 1)). The hero's power — the average of melee, armour, ranged and the average of the artifacts.

## 4. Progression — enchantments

As in MCD: an item (except artifacts) has 1, 2 or 3 slots — by rarity. A slot has three options (`rollEnchantSlots`, deterministic from `uid`); on a unique item one of the first slot's options is powerful (a violet glow). Choose an option — the rest in the slot are closed; levels I → II → III cost 1, 2, 3 points (a powerful one — 1 more). An enchantment point — for every new hero level; salvage returns all invested points.

| Kind | Enchantments |
|---|---|
| Melee | Sharpness, Critical Hit (×3), Vampirism, Knockback, Whirlwind (a wider finisher wave), Fire Aspect, Soul Siphon, **Smiting** (a wave from any strike) |
| Ranged | Power, Multishot (+2 arrows), Infinity, Haste, Recoil, **Piercing** |
| Armour | Fortitude (+health), Artifact Cooldown, Soul Gatherer, Healer (potion), Acrobat (dodge roll), **Regeneration** (health per second) |

`Profile.stats()` folds the equipped items into `GearStats` — the multipliers read by `gear.ts` and the scene.

## 5. Combat, experience, souls, lives

- A sword strike: damage × `meleeMult`, crit, fire, knockback × `knockMult`, wave × `waveMult` (`playground.ts → strike`).
- Every hit (sword, arrow, artifact) gives a soul (more with properties and enchantments) and experience ≈ a quarter of the damage. Level: 40 + 20 · (n − 1) experience; a new level — a banner and +1 point.
- Arrows fly straight, stop at walls (`terrain.wallHit`), pierce targets with "Piercing". A bundle of arrows (12 + armour properties) — in every chest, along with a random item around the hero's power (common 68 %, rare 26 %, unique 6 %) with a pillar of light in the rarity colour (section 12).
- Lives: three; the hero falls — minus a life, all lost — on the playground they are restored.

## 6. Storage

The profile (`ProfileData`) — `localStorage['malina.profile']`: level, experience, points, raspberries, souls, arrows, items, equipped. First launch — the starter set: equipped are the Warden's Sword, the Wanderer's Jacket, the bow, the fire arrow and the totem; in the chest 19 more items of all kinds and rarities and 3 enchantment points, to try on and level right away. Reset — `__malina.profile.reset()`.

## 7. Diablo-style map

`AutoMap` is built from the level's blocks: a column is "floor" (the top is higher than the neighbours by less than 1.5 m), "water" or "wall". Fog of war: cells within a radius of 13 around the hero are revealed, the explored part is drawn on a canvas at 6 px per cell — a dark blue fill, a white pixel outline at walls and voids, sparse white diamonds, as on the MCD map (screenshots 11, 12).

Drawn in the camera's isometry: a 45° rotation and a vertical squash of 0.7, so the top of the map matches the top of the screen, like the Diablo II automap.

- **Mini-map** top right: around the hero, edges dissolve; a white arrow — the hero and where he looks; icons of chests (opened ones grey), the health fountain, the blacksmith and the merchant. Click — the full map.
- **Tab — map over the game** (Diablo II): only the outline and a barely visible fill across the whole screen, the game keeps running.
- **M — full map** (MCD): a dark screen with a frame, the level name in a yellow pixel font, the explored part fitted into the window, at the bottom "Chests opened a / b" and "Explored n %".

## 8. Armour and bow on the hero

`ArmorLook` on armour in the catalogue: colours of the breastplate and trim, pauldrons, headwear (hood, crested helmet, cap, wolf head with ears), a skirt, cloak colour, a glowing gem. `Knight.setArmor` assembles the parts over the body (they flash on damage together with the body), the 3D hero in the inventory is dressed the same.

`BowLook` on ranged weapons: a bow (an arc of boxes, a string, the "Star" bow has glowing tips) or a crossbow. The bow in the left hand is visible only on a shot: `Knight.shootPose` turns the hero to the target, the left hand with the bow forward, the right draws the string; the sword stays in the right, as in MCD.

## 9. Merchants

In the north-west corner of the playground — shops as in the MCD camp (screenshots 7–10): the **blacksmith** — a stone wall with a forge (flickering light) and an anvil, a yellow-and-turquoise striped awning, the villager has glowing violet eyes; the **merchant** — crates, a barrel and raspberries on the counter, a red-and-orange awning. Above the shops — names in a pixel font, the villager turns his head toward the hero; a shop is an obstacle for the hero and for pathing. F at the counter — the trade window, the game is paused.

**Nothing at random** (since 2026-10-25, ~~a random "?" item, a special item, 1/2/3 — buy~~): the window — a grid of all goods in tabs (Q / E), under each — the price, one bought earlier — "owned", ▲ / ▼ — stronger or weaker than the equipped one. On the right the card of the selected one: power, rarity, damage over three strikes, damage per second, range and crit, weapon art Q (for weapons), properties, description, price and "Buy". The goods' power — the hero's power. Code — `src/hud/shop.ts`.

| Who | Tabs |
|---|---|
| Blacksmith | melee (all 16 weapons), ranged, armour; on the right — reforging the equipped item: +1 power for 30 + 15 · item power |
| Merchant | melee, ranged (and a bundle of arrows × 24 for 20), armour, artifacts, common spells ([design-spells.md](design-spells.md), 110 + 12 · power) |

**Price — by stats** (`src/prices.ts`): value × rarity (common 1, rare 1.45, unique 2.1) × (1 + 0.15 · (power − 1)), rounded to 5. Value: melee weapons — the balance estimate `weaponMetrics().score` (Warden's Sword = 100: damage per second, area, range, speed); ranged — 3.6 · damage per second + 2 · range + 10 · knockback; armour — 20 + 1.4 · health + 0.45 · the sum of properties; artifact — from power, radius, duration and cooldown. At power 1: knuckles 85, sword 100, katana 170, pontiff's blades 215, nagakiba 275, dragonslayer 290; bow 95, twin bow 365; jacket 60, champion's armour 275.

The purchase is shown on the right — "Equip" (Enter) or "To inventory". Keys: arrows — select, Enter or double click — buy, Esc or F — close. A new profile starts with 250 raspberries. Auras are not sold: they drop from the floor's bosses ([design-bosses.md](design-bosses.md), section 4), on the playground they lie in the inventory.

**All weapons in the inventory:** on the playground all 16 melee weapons lie in the inventory from the start (the starter set), old saves get the missing ones added on load.

## 10. Black squares around spells (fixed)

Spell and explosion flashes are sprites (`fx.flash`). The GTAO pass hid transparent meshes but not sprites, and those got into the normal buffer as opaque squares — AO drew dark rectangles around them. Now `SolidAOPass` hides sprites and points too (`src/lighting.ts`). Also artifact explosions (fire arrow, soul reaper) — without the dark smoke of `fx.explosion`, and the cooldown on a slot — a light shade and a grey icon instead of an almost black fill.

## 11. Keys (changes)

E — now the potion (as in MCD), use and trade — **F**; M — full map, Tab — map over the game, sound — **F9**; 1/2/3 — artifacts instead of empty spell slots; RMB — bow; I — inventory; H — controls hint (hides itself after 15 s).

## 12. Chests, loot and raspberries — so you want to open them

The goal is a child's delight at every find. One chest type for the whole game. Code: chest and loot — `src/props.ts`, the loot on the floor — `itemLootMesh` in `src/gear.ts`, shared glow textures — `src/loot-look.ts`, sounds — `src/audio.ts` (the "treasures" section).

- **The chest** — dark blue with gold fittings (like the "obsidian" and gold chests of MCD), gems on the corners and the lid shimmering with a rainbow, light seeps from the gap under the lid, under the chest — a coloured halo, sparks rise around. Walk up — a quiet chime.
- **Opening (F):** for 0.6 s the chest shakes, squats, the lid hops, sparks are sucked into the gap, the sound — a rising hum and an accelerating knock. Then the lid springs open, a pillar of light bursts out, a star of rays, three coloured rings, rainbow confetti, camera shake, the sound — a thump and a fanfare with bells. The loot flies out as a fountain one by one (every 0.08 s, each "plop" a note higher), with a glowing tail behind. The opened chest keeps sparkling inside for a couple more seconds, the gems fade.
- **Loot on the floor:** a large icon above a spinning star of rays, a pillar of light in the rarity colour with a white core (taller for uniques, plus gold), a halo, "sonar" rings along the ground, sparks. Landed — a ring, a flash and a long chime (the rarer, the higher). Picked up — a burst of sparks in the rarity colour and a fanfare. Loot can be picked up 1.8 s after flying out — so that you have time to see the pillar.
- **Raspberry** — a large berry made of drupelet cubes with a green calyx, a pink halo, a star highlight, a spot of light on the ground; drawn to the hero from afar (2.4 m). Picked up — a pink flash, a ring, a splash of juice, a "pop" with a bell; a streak (less than 0.9 s between berries) rises up the pentatonic. The raspberry counter in the HUD bounces, the "+N raspberries" caption is large and glows.
- Loot does not lie on chests and barrels — it slides off to the side. A wooden crate breaks with the crack of boards.

## 13. Next

- "Gilded" items, gifts, a mysterious merchant.
- Own animation of drawing the string and the arrow on the bow.
- Souls from enemies, when enemies appear; artifacts that spend souls will matter more.
- Network: every player has their own profile, loot — for everyone.
