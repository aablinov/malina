# ADR-004. Back to mystic co-op clearing: swords, axes, magic and a kind, kid-friendly style

- **Status:** accepted
- **Date:** 2026-10-22
- **Supersedes:** `claude/adr-002-realistic-weapons-tactical-movement.md` (real firearms, tactics, armour)
- **Refines:** `claude/adr-003-visual-style.md` (Minecraft Dungeons style) — references and rules now live in `style-guide.md`
- **Keeps:** `claude/adr-001-dungeon-roguelite.md` — co-op dungeon clearing remains the core mode

## Context

After ADR-002 the game drifted into a tactical shooter: AK-74, AR-15, double-barrel shotgun, ricochets, RGD-5 grenades, PMC jailers, "Starship Troopers" arachnids. That is too far from the original concept — a mystic co-op game in the spirit of Minecraft Dungeons. The user asks to go back.

## Decision

1. **Genre** — mystic co-op dungeon clearing (up to 4 players), as in ADR-001: floors of rooms, hordes, bosses, raspberries.
2. **Combat is melee and magic.** Weapon classes: sword, axe, great (two-handed) sword, later staves and spells. No firearms: no guns, no magazines, no ricochets, no grenades.
3. **No specific weapons for now** — there is one **standard sword**:
   - LMB — strike; holding or repeated presses — a **three-hit combo**: left to right, right to left, top to bottom (the finisher reaches further, hits harder, with a shockwave);
   - a **glowing light trail** follows the blade; the finisher's trail is brighter and wider;
   - during a strike the hero turns to the cursor and makes a short lunge.
4. **Controls — as in Minecraft Dungeons (refined 2026-10-22):**
   - **LMB on the ground** — walk there, holding — follow the cursor; **LMB on a target** — approach to weapon reach and strike, holding — combo;
   - **Shift + LMB** — strike in place towards the cursor; **WASD** — an alternative to the mouse, cancels the order;
   - **Space** — dodge roll with a cooldown; **1 / 2 / 3** — spell (artifact) slots with cooldowns, no mana;
   - **no jump**, as in the original: height differences are stairs and half-blocks. Sprint, crouch, aim and stamina are removed.
5. **No enemies in the playground** — beetles, arachnids and jailers are deleted together with their code. New enemies will come for melee combat.
6. **Style** — kind, kid-friendly, as in the Minecraft and Minecraft Dungeons references (`style-guide.md`): saturated colours, soft light, glowing accents, fireflies, living water. No blood and no "adult" realism.

## Consequences

- Shooting and enemy modules removed: `firearms.ts`, `gunplay.ts`, `grenade.ts`, `hero.ts` (tactical fighter), `jailer.ts`, `cover.ts`, `arachnid.ts`, `beetle.ts`, `bush.ts`, `config.ts`. They stay in git history.
- New hero — `src/knight.ts`: a blocky character with a large head, a sword with a combo and a dodge roll; the blade trail is `src/trail.ts`. Mouse orders (walk, approach and strike, strike in place) and spell slots are in `src/dev/playground.ts`; the path around walls is found by `src/level/pathfind.ts` — A* over grid points 0.5 m apart at floor height: upward a step of up to 0.5 m (stairs, half-blocks), downward a drop of up to 3 m, free space above the floor for the hero's height, more expensive near walls; the finished path is straightened. Water and acid are waded: the floor in them is half a block below the bank.
- Hero and sword numbers are in `src/tuning.ts` (`HERO`, `SWORD`), tuned in F1.
- The playground remains the main development scene: straw training dummies instead of shooting-range targets, the storage yard and block showcase stay in place.
- Water is animated by a shader: waves on the surface, highlights and foam at the banks.
- `design-dungeon.md` is outdated in the sections on weapons, armour and tactical stance — it is being rewritten for melee and magic.
