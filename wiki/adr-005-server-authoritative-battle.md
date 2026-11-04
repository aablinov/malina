# ADR-005. Server-authoritative battle modelled on Quake 3

- **Status:** accepted
- **Date:** 2026-11-04
- **Supersedes:** the "Deferred decisions" section in [adr-001-dungeon-roguelite.md](adr-001-dungeon-roguelite.md) (host-authoritative model) and versions 1.0–1.4 of [design-multiplayer.md](design-multiplayer.md)

## Context

In versions 1.0–1.4 the shared battle was computed by the host's browser: the server relayed opaque messages, trusted the host for the outcome and each player for their reward. On top of that grew host migration mid-battle, puppets on the guest, separate messages for raspberries, knockback and kits, two simulation paths; all of it could only be verified by a Playwright run with two or three browsers (≈2 min, flaky). The seed from the server was never used.

## Decision

As in Quake 3: the server runs the game on a fixed tick, clients send input commands, receive delta snapshots, predict their own hero and interpolate the others.

- **Simulation** — one code base for server and browser. Defence rules, towers, walls, bush, piles — the pure part `src/sim/` (no scene, DOM or `Math.random`; guard `server/test/sim-boundary.test.ts`). Hero, gear with magic and mobs — the same classes as in the browser, **without rendering** (`src/headless.ts`): three in Node, a canvas stub, `nullFx` with timers. We chose not to rewrite 9000 lines of gameplay blind.
- **Determinism** — game randomness only through `rnd()` (`src/rng.ts`); for the duration of a world step it is the seeded world generator; the same seed and the same commands give the same battle (tests compare hashes).
- **Network** — `Channel` (reliable and unreliable lanes, seq/ack) over a transport (WebSocket, in-memory loopback), `SnapshotRing`/`SnapshotView` (deltas from the acknowledged snapshot, a full one on loss), a separate WebSocket `/game`; lobby, chat and profiles stay on `/ws` as before.
- **Match** (`src/game/match.ts`) — party heroes from server-side profiles, commands one per 1/60 tick, a 50 ms frame and a 20 Hz snapshot, rewards computed by the server; the host is only a crown and lobby rights, the battle is not interrupted when they leave.
- **Client** (`src/cgame/`) — a view built from entity records and events; own hero is predicted and reconciled against acknowledged input; other heroes and enemies are puppets from the snapshot with a 0.1 s buffer in server time. The client keeps a ring of received states (like `cl.snapshots`): a delta from an older base is applied, not discarded. The layer comparison with Quake 3 and what is not yet ported — [arch-layers.md](arch-layers.md).
- **Tests** — `npm run test:net` on `node:test` in seconds: channel, codec, simulation, headless battle, match over the loopback, rooms; Playwright — one smoke scenario with two browsers.

## Consequences

- A host cheat is impossible: positions, health, waves, treasury and rewards are the server's; the client sees only snapshots.
- Single-player runs on the same sim code locally (the world is stepped on the page), multiplayer — from snapshots; the view is the same.
- The server spends CPU on the battle: a world without rendering, mobs think every tick; matches per process — no limit yet (see risks in the plan).
- Melee latency ≈ RTT/2: the swing is visible immediately, the hit is decided by the server. Lag compensation — if needed (`Cmd.serverTime` can be added without changing the format).
- The excess is removed: `CoopHost/CoopGuest`, `battle.host`, `battle.end`, `battle.loot`, `relay`, `party.ts`; `PROTOCOL = 2` — old clients are rejected.
