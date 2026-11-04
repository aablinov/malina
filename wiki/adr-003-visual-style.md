# ADR-003. Visual style — as in Minecraft Dungeons, without hyperrealism

- **Status:** accepted, refined by `claude/adr-004-mystic-coop-melee.md` and `claude/style-guide.md` (2026-10-22): the style is friendly and childlike, the playground is in the game style too; the points about guns and armour are outdated
- **Date:** 2026-10-21
- **Refines:** `claude/adr-002-realistic-weapons-tactical-movement.md`
- **Related:** `claude/design-dungeon.md`, `claude/project-brief.md`

## Context

ADR-002 decided to move to real weapon models (AK-74, AR-15, double-barrelled shotgun…), tactical movement and armour. The references for the feel of shooting are Ready or Not and Escape from Tarkov. Because of this one could wrongly decide that the graphics should become realistic too. The user explicitly ruled that out.

## Decision

**The graphics stay in the Minecraft Dungeons style, as in the reference screenshots. Hyperrealism is not needed.**

**Realism — only in the mechanics:** the names and silhouettes of guns, magazines, reloading, recoil, armour, the tactical stance. The look — stylised voxel.

### What the style includes

- **Camera:** an isometric perspective from above at an angle, as now.
- **Geometry:** voxel and blocky — a world of cubes, characters and beetles out of simple rectangular parts.
- **Proportions:** slightly toy-like, as in Minecraft Dungeons: a large head, short limbs. The tactical stance and animations are conveyed by the pose of blocky parts, not by detailed anatomy.
- **Weapons:** blocky models with a recognisable silhouette — the AK's curved magazine, the AR-15's carry handle, the two barrels of the double-barrelled shotgun. No fine detail and no photorealistic materials.
- **Armour and helmet:** just as blocky. The armour class reads by shape and colour, not by details.
- **Textures:** pixel, low resolution (16 × 16 per block), generated in code, as now.
- **Light and colour:** a saturated palette, soft shadows, glowing accents (fires, crystals, smouldering hive blocks), moderate bloom. Dark dungeons with warm and coloured light sources.
- **Effects:** stylised — blocky particles, bright flashes and tracers, floating damage numbers.

### What we do not do

- Photorealistic materials, high-resolution PBR textures, normal maps.
- Realistic human proportions, detailed weapon models with little screws and markings.
- Blood and realistic wounds — beetles have blocky shards and coloured splashes.
- Film effects "for realism" (grain, chromatic aberration, a strong vignette).

## Consequences

- The hero, weapon and armour models from ADR-002 are built from boxes in code, like the current `buildGunModel` and the beetle model. Detail is limited: 8–20 blocks are enough for a gun.
- The developer playground (stage 0) with the chequered floor and walls is a utility scene. Its neutral look does not set the game's style.
- The "Ready or Not / Escape from Tarkov" references in `design-dungeon.md` concern only the feel of weapons, armour and stance, not the graphics.
