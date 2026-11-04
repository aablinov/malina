# System layers and the mapping to Quake III Arena

Version 1.2 of 2026-11-04 (mob brain as a bot — section 2). Version 1.1 of 2026-11-04 (event queue and unified input — section 2). Version 1.0 of 2026-11-04. Network battle — [design-multiplayer.md](design-multiplayer.md), the decision — [adr-005-server-authoritative-battle.md](adr-005-server-authoritative-battle.md). The model — the Quake III Arena sources (`code/qcommon`, `server`, `client`, `cgame`, `game`, `botlib`).

## 1. Layers

| Layer | Where | What is inside | Quake 3 counterpart |
|---|---|---|---|
| Simulation | `src/sim/` | defence rules: `SimWorld` (tick, seeded `rng`, events, entity records), `SimTd`, towers, walls, bush, lairs, piles. No scene, DOM, sound, `Math.random` or clock — guard `server/test/sim-boundary.test.ts` | `game/` (qagame, `g_*`) |
| Shared hero code | `src/knight.ts` (`Knight.update`), `src/gear.ts`, `src/mobs/`, `src/bosses/`, magic | one movement and combat code for the own, remote and server hero; on the server — without rendering via `src/headless.ts` (three in Node, a canvas stub, `nullFx`). Movement is mixed with animation (`animate`, `sampleTrail`). Server gameplay — without `Math.random` or the clock (guard `sim-boundary.test.ts`) | `game/bg_pmove.c` |
| Mob brain | `src/mobs/mob.ts` (`think`/`mover`), `src/level/pathfind.ts` | brain once per 0.1 s (target, alarm, mode, attack), mover every tick, detour path with a per-tick budget; puppets by intent from the snapshot ([design-mobs.md](design-mobs.md), section 6) | `botlib/` (`bot_thinktime`, AAS) |
| Battle and match | `src/game/battle.ts`, `match.ts` | headless party battle; match: command queues per seat, tick 1/60, frame 50 ms, snapshot ring buffer, deltas for each, rewards | `server/sv_client.c`, `sv_snapshot.c`, `sv_game.c` |
| Network | `src/net/` | `Channel` (reliable and unreliable lanes, seq/ack, window 64, retransmit), `SnapshotRing`/`SnapshotView` (deltas and history), protocols, transports (WebSocket, loopback) | `qcommon/net_chan.c`, `client/cl_parse.c` |
| Server | `server/` | the process: lobby `/ws`, battle `/game`, rooms, match runner (one timer), database, login | `server/sv_main.c` |
| View | `src/cgame/` | view from entity records, effects from events, defence HUD, network battle client (`net-battle.ts`: prediction, remote heroes, puppets, defence mirror) | `cgame/` (`cg_ents.c`, `cg_predict.c`, `cg_event.c`) |
| Client | `src/dev/playground.ts`, `src/cgame/events.ts`, `input.ts`, `orders.ts` | the assembly point: event queue, tick input, mouse orders, frame loop, own hero, camera, HUD, menu; single player = a "listen server" (the world is stepped on the page) | `client/cl_main.c`, `cl_input.c`, `qcommon/common.c` (`Com_Frame`, `Com_EventLoop`) |

## 2. What was carried over from Quake 3

- **Server tick and snapshots**: the server runs 1/60 ticks on accumulated time, a snapshot after a 50 ms frame (sv_fps 20); the client acknowledges the applied snapshot, the server computes the delta from it (`Cmd.snap` ↔ `cl.snap.messageNum`).
- **Snapshot ring buffer on the client** (`cl.snapshots[PACKET_BACKUP]`): `SnapshotView` keeps 32 received states; a delta from an older base (the ack still in flight) is applied from history. Events in a delta are grouped by snapshot and played only if newer than the applied one.
- **Netchan**: one frame carries reliable messages until acknowledged (`reliableCommands`) plus the unreliable part; a batch of the last three input commands per frame (`cl_packetdup`).
- **Usercmd**: `KnightInput` + `Cmd` — a single input for the own, remote and server hero; the server executes one command per tick, an empty queue — repeat the last (like an `sv_fps` server between packets), a disconnect — the hero stands still.
- **Prediction**: the own hero is stepped locally, by the `ack` from the snapshot the position is checked against the one recorded at the moment of that command; the discrepancy is removed by 20 % per snapshot, more than 2.5 m — at once. There is no command replay (`CL_PredictPlayerState`) — offset correction.
- **Interpolation by server time**: position buffers of remote heroes and puppets — by `Delta.tick`; the clock offset is estimated like `cl.serverTimeDelta` (reset on a discrepancy > 0.5 s, otherwise creeps), rendering 0.1 s behind.
- **Unified event queue** (`Sys_QueEvent`/`Com_EventLoop`, `src/cgame/events.ts`): DOM handlers and the network transport only put a time-stamped event into a ring buffer of 256; interface keys (pause → inventory → shop → chat → pad menu → client toggles) respond right in the handler (`keyNow`) — that is not the game; `drainEvents()` at the start of the frame sorts what accumulated — network frames to the channel, the wheel to the camera, game input into the tick state. Server deltas are applied before the ticks, not in `onmessage`.
- **Tick input** (`cl_input.c`, `src/cgame/input.ts`): keys with "pressed since the last tick" latches (a tap shorter than a tick is not lost, like `kbutton_t`), the mouse with a click latch, hero actions from keys and HUD buttons (potion, artifacts, aura, weapon art, item, wave) accumulate and execute at the start of the tick in order — like usercmd buttons, not in `keydown`. Mouse orders (`src/cgame/orders.ts`) — a "target → path → `KnightInput`" layer over the same input.
- **Actions ordered with commands**: `act` leaves with the number of the client's last command; the server executes it once that command has gone through, before the next one (`Seat.acts`), — the "movement → action" order is the same on client and server.
- **Mob brain as a bot** (`botlib`): `think()` once per `THINK_S` = 0.1 s picks the target, alarm, movement mode and attack; `mover()` every tick moves by mode (road, patrol, chase, detour path) with the shared movement code; navigation — `Pathfinder` on request, no more than `ROUTE_BUDGET` = 4 paths per world tick; the snapshot carries the step direction (`mx`, `mz`), client puppets step along it and are pulled toward the position.
- **Determinism**: game randomness is only `rnd()`, during the world step — the seeded world generator (one seed and the same commands — the same battle).

## 3. What is missing (and the plan)

| Q3 concept | What we have | Decision |
|---|---|---|
| AAS — navigation precomputed for the whole map | `Pathfinder` computes the path on request (A* over voxels), with a per-tick budget | enough: mobs walk the roads, a path is rarely needed |
| `CL_PredictPlayerState` (replay) | offset correction | if needed |
| Huffman and a binary codec, PVS, lag compensation | JSON (~0.8 KB/snapshot for two), everything to everyone, hits without compensation | not needed with ≤ 4 players |

## 4. Frame order

**Server** (`MatchRunner.frame` → `Match.frame`): `acc += dt` → up to 6 ticks: a command from each seat's queue (or the last one) → `battle.step(1/60)` (heroes and gear, the pack, defence, piles under `useRng`) → snapshot into the ring buffer → a delta for each from its `snapAck` + `flush` of reliables → the summary 4.5 s after the end.

**Client** (`frame` in `playground.ts`): `drainEvents()` (game input and network frames from the queue — server deltas are applied here; interface keys were handled back in `keydown`) → `acc += real` (in a network battle — without pauses or freeze-frames) → up to 6 ticks: `readInput` (movement from keys, cursor, dodge-roll latch) → key actions in order → mouse orders → `gear.update` → `hero.update` (prediction) → pack/rooms → `stepTd` (network: `NetBattleClient.update` — remote heroes from the buffer, puppets, the command in a batch; single player: `world.step` and a snapshot of the own world into the view) → `clearEdges` (latches reset) → one `render(real)`.
