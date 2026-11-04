# ADR-002. Realistic weapons, tactical movement and armour

- **Status:** replaced by `claude/adr-004-mystic-coop-melee.md` (2026-10-22): firearms, tactics and armour cancelled, combat — swords and magic
- **Date:** 2026-10-21
- **Complements:** `claude/adr-001-dungeon-roguelite.md`
- **Details:** `claude/design-dungeon.md`, sections 8–10 and 16 (stage 0)

## Context

The game currently has 8 fantasy guns in the Doom Eternal style: plasma, the B-9000 beam cannon, mods on `Q` (micro-rockets, meat hook, turret). The hero is a blocky farmer in a straw hat with a simple walking animation. The user wants a different feel:

- **Realistic weapons:** double-barrelled shotgun, AR-15, AK-74 and the like.
- **Tactical movement:** half-bent knees, more torso work.
- **Armour and helmet.**

## Decision

### 1. Weapons — real models with game stats

- Pistols, shotguns (double-barrelled, pump-action), rifles (AK-74, AKS-74U, AR-15), a submachine gun, a marksman rifle, a machine gun, grenades.
- Mechanics closer to real:
  - **magazines and manual reloading** on `R`: tactical — with a round in the chamber, faster; full — slower;
  - **recoil and spread**, growing over a long burst;
  - **calibres** instead of abstract "bullets and energy".
- **Mods on `Q` go away.** Instead — **attachments**: a red-dot sight, a suppressor, a grip, an extended magazine, an underbarrel flashlight. Attachments are found and bought during a run.
- **Model style** — voxel, but recognisable silhouettes: the AK's curved magazine, the AR-15's carry handle and straight stock, the two barrels of the double-barrelled shotgun.
- **A separate grenade slot.** The grenade launcher and beam weapons are removed from shooting.

### 2. Tactical movement and animation

- **Stance:** knees half-bent, torso leaning forward, weapon at the shoulder.
- **Legs and torso work separately:** the legs walk in the direction of movement, the torso and head turn toward the aim (up to ±70°). There are strafe and backwards-walking animations.
- **States:** walking, running (no shooting, weapon lowered), aiming on RMB (slower, more accurate), crouching on `C`, dodge roll on `Space` — with a shared stamina bar.
- **Procedural animation:** recoil hits the shoulders, the weapon sways while walking, the magazine change is visible, the weapon's weight affects speed.
- **The hero model is rebuilt:** more joints (pelvis, torso, chest, neck, upper arm and forearm, thigh and shin), tactical gear instead of farmer clothes.

### 3. Armour and helmet

- **A body-armour vest of three classes:** armour points and a percentage of damage absorption; the heavy one slows.
- **Helmet:** reduces damage from spit and explosions, protects from stun.
- **Armour wears out.** Repaired with armour plates (a consumable, bought from the merchant), picked up during a run.
- **Visually:** the class of armour and helmet is visible on the model, damaged armour darkens and cracks.

### 4. Working it out in the playground

- Movement and shooting are first built and tuned in the developer's utility playground: chequered floor and walls, targets, a parameter panel, overlays.
- Only then are they embedded into the game rooms.
- All numbers — in one settings file read by both the game and the playground panel.

## Why

- Realistic guns give "weightier" shooting and clear roles in the squad: an assaulter with an AK, support with a PKM, a marksman with an SVD, a shotgun for close quarters.
- Magazines and reloading add tactics: "don't reload in a crowd", cover a reloading partner. That is the challenge the farm was missing.
- Armour is a second layer of resource and decisions: a heavy vest versus speed, plates versus ammo versus healing with raspberries.
- The tactical stance makes the co-op squad visually look like a squad and suits the clearing genre.
- The feel of movement and shooting needs many iterations. A clean scene with a grid ruler and live parameter tuning speeds them up and does not mix the mechanics with level generation and hordes.

## Consequences

- **`weapons.ts`** is rewritten:
  - new definitions of guns, calibres and attachments;
  - new voxel models;
  - `gunPreview` stays.
- **`combat.ts`:**
  - mods are removed (rockets, turret, overload, hook, thermal blast);
  - magazines, reloading, recoil, grenades, bullet penetration (SVD) are added;
  - ricochets stay.
- **`player.ts`** is rewritten: a new model with joints, procedural animation, movement states, stamina, armour.
- **New files:**
  - `src/tuning.ts` — all tunable numbers;
  - `src/dev/` — the playground and developer tools.
- **HUD:** ammo "in the magazine / in reserve", an armour bar, stamina, attachment slots.
- **Buffs** from `design-dungeon.md` tied to mods are replaced (section 12).
- **The beetles stay** — the enemy does not change. The contrast "tactical squad versus a horde of beetles" is part of the style.
- **Risk:** realistic shooting with an isometric camera. Solution: aiming narrows the spread and nudges the camera slightly toward the aim, rather than switching to a first-person view.

## Alternatives considered

- **Keep the Doom Eternal style** — does not match the desired feel.
- **Full realism** (ballistics, hit zones, bleeding) — excessive for isometry and hordes, slows the prototype.
- **Fictional guns resembling real ones** — the user wants recognisable models. We use real names, the stats are game stats.
- **Work out the mechanics directly in the game rooms** — longer iterations, harder to separate a mechanics problem from a level problem. A separate playground was chosen.
