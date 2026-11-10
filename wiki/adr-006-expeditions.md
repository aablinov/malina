# ADR-006. Expeditions — a second mode with missions on a seeded map

- **Status:** accepted
- **Date:** 2026-11-10
- **Adds to:** [adr-001-dungeon-roguelite.md](adr-001-dungeon-roguelite.md), [adr-005-server-authoritative-battle.md](adr-005-server-authoritative-battle.md)

## Context

The only networked mode is Bush Defence: the party picks one of five maps in the camp and holds ten waves. The game mode is not declared anywhere — a map with `meta.td` is a defence map, and the server accepts nothing else. An open map (the island: garrisons, patrols, ambushes, chests, a minimap) plays only solo on the client, outside `SimWorld`.

We want a second mode with a different rhythm, modelled on Helldivers 2 ([sources/helldivers2.md](sources/helldivers2.md)): the squad picks a mission, lands on a large map, completes objectives and leaves through extraction.

## Decision

A mode called **Expeditions** (`expedition` in code). Design — [design-expeditions.md](design-expeditions.md).

- **Hub** — the existing DOM camp with a new mission board tab. No walkable 3D hub.
- **Maps** — procedural by seed; the server and the client build the same level from the seed, no JSON in `assets/maps`.
- **Meta** — operations (a chain of 2–3 missions) kept in the room, plus the player's profile. No world state shared by the whole server.
- **Tone** — unchanged: no friendly fire, no hard wipe; a failed mission keeps half the raspberries and the experience.
- **Architecture** — the mode becomes explicit: match rules sit behind one interface, `SimTd` is one implementation and the expedition rules are another. The open-map population (garrisons, patrols) moves from the client into the simulation.

## Consequences

- The server stops being defence-only: `HeadlessBattle`, `Match`, the map catalogue, room info and rewards lose their hard dependency on `meta.td`. Bush Defence behaviour does not change; its tests are the criterion.
- The lobby protocol changes (a room carries a mission instead of one map name) — old clients are rejected, no backward compatibility.
- New systems to write: objectives, extraction, mission generation, alarm and reinforcements, revive with shared totems, parcels, seeds and camp beds, a squad HUD.
- Work goes in phases, one commit per phase; the first playable version is solo (phase 3), the network and the board come in phase 4.
