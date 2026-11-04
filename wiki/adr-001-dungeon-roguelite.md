# ADR-001. Core mode — co-op dungeon clearing (roguelite)

- **Status:** accepted
- **Date:** 2026-10-21
- **Related documents:** `claude/design-dungeon.md` (design), `claude/project-brief.md` (project description and code state), `claude/adr-002-realistic-weapons-tactical-movement.md` (weapons and movement)

## Context

"Malina" is a voxel shooter with an isometric camera in the spirit of Minecraft Dungeons (TypeScript, three.js). The concept changed three times:

1. **Farm with waves** (first version). You plant raspberries, harvest by day, defend the bushes from beetles by night, and buy guns with berries. Problem: no challenge and no decisions — "beetles came, you shoot, they leave, you harvest". No pressure and no choice of what to sacrifice.
2. **Co-op looter with a lobby and a drop** (current code). A lobby with a session number, an arsenal, a map of 4 regions, 12 bushes with guards; the map is done when a flag is raised over every bush. It works, but it is one static map with no replayability.
3. **Roguelite with a vehicle** (discussed, not built). The squad pushes a greenhouse vehicle full of raspberries to the exit; by day you choose "push or upgrade", by night you defend. A strong dilemma, but a lot of new mechanics (terrain, wheels, deadline), long balancing, and a risk that pushing is boring.

We need a mode that:
- gives a clear challenge from the first minute;
- plays well in co-op for up to 4 players;
- reuses the finished shooting, weapons, beetles and lobby;
- has replayability.

## Decision

The core mode is **co-op clearing of a procedural hive dungeon in roguelite format**:

- A run is 3 floors of 6–8 rooms each, generated from room templates on a grid.
- In a combat room the doors close and you must fend off 2–3 waves of the beetle horde.
- After the fight each player picks one of three **perks** (the run's build).
- **Raspberries** are the currency and healing inside a run and the meta resource between runs.
- The **farm** becomes the hub between runs (meta-progression), not a separate mode.
- Story frame: the beetles dragged the harvest into an underground hive, and the squad descends to get it back.

## Alternatives considered

| Option | Why not chosen |
|---|---|
| Farm with waves | Few decisions and little pressure, monotonous |
| Open map with flags (current code) | One map, little replayability, beetles get lost among the trees |
| Greenhouse vehicle (cargo escort) | A good dilemma, but hard to implement and balance; pushing risks being boring. Kept as a candidate for a special floor or a later mode |

## Consequences

**Pros:**
- A short and clear loop: room → fight → reward → door choice.
- Difficulty scales easily via the horde budget by player count and depth.
- Block-based generation is natural for voxels; every run is different.
- A noticeable part of the code is reused: shooting, ricochets, beetles and shooters, AI, loot, FX, sound, lobby, session, profile, mini-map.

**Cons and risks:**
- The genre is crowded; uniqueness rests on raspberries as a resource ("spend, eat or carry out") and on the farm hub.
- To be written: floor generator, rooms with doors, per-room wave system, perks, bosses, floor transitions, hub.

**What changes in the code:**
- The "open map" mode (`map.ts`, `mission.ts`, `world.ts` with regions) goes to the archive or is deleted.
- The farm from the first version (`bush.ts`, growth and harvest) moves into the hub.
- Networked play is out of scope for now, but the architecture is built for it from the start:
  - floor generation is deterministic by seed (`rng(seed)` already exists in `map.ts`);
  - players are an array of targets;
  - run state is separated from rendering.
- Mechanics are first worked out in the developer playground (stage 0 in `design-dungeon.md`, section 16) and only then embedded into rooms.

## Deferred decisions

- Network engine: host-authoritative model, transport to be chosen later.
- Farm meta-progression (what exactly unlocks) — after the first playable floor.
- Special floors (greenhouse vehicle, escape from a collapsing hive) — after the 3 base floors.
