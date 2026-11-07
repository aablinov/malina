# Multiplayer — server

Version 2.4 of 2026-11-07: room voice chat on T — WebRTC peer to peer, signalling over `/ws`, `PROTOCOL = 3` (section 7a). Version 2.3 of 2026-11-07: the reward is the match loot and only for victory; heroes go in with their own gear; the party's strength scales the waves (sections 6, 7). Version 2.2 of 2026-11-04: deltas are applied from the event queue before ticks, `act` actions carrying a command number are executed by the server in order with movement (section 7, [arch-layers.md](arch-layers.md)). Version 2.1 of 2026-11-04: a ring of received snapshots on the client (deltas from an older base are not lost under latency), command batches, interpolation by server time, the hero stands still after a disconnect (section 7); layers and the Quake 3 correspondence — [arch-layers.md](arch-layers.md). Version 2.0 of 2026-11-04: the battle is computed by the server ([adr-005-server-authoritative-battle.md](adr-005-server-authoritative-battle.md)) — simulation without rendering, a channel with seq/ack, snapshot deltas over `/game`, prediction of own hero on the client, rewards from the server; the host model, host migration, `relay`, `battle.end`/`battle.loot` and `CoopHost`/`CoopGuest` are removed, `PROTOCOL = 2` (sections 1, 3, 6–8). ~~Versions 1.0–1.4 (2026-11-02 – 2026-11-03): host-authoritative model — the host's browser computes the battle, the server relays and trusts the outcome~~ — replaced. Camp — [design-main-menu.md](design-main-menu.md), wave scaling — [design-tower-defence.md](design-tower-defence.md), section 5, the split of simulation and view — same page, section 15.

## 1. Model

- **Server-authoritative, as in Quake 3.** The server runs the battle on a 1/60 tick (a 50 ms frame = 3 ticks, a snapshot after each frame — 20 Hz), clients send input commands (`Cmd`, one per tick), receive snapshot deltas, predict their own hero and interpolate the others. Lobby, chat, profiles and history — on the same server.
- **One simulation code base** for server and browser: `src/sim/` (pure defence rules) and headless `Knight`, `Gear`, `Mob` (`src/headless.ts`); single-player steps the world locally, multiplayer sees snapshots. Game randomness — `rnd()` under the world seed (`src/rng.ts`).
- **Up to four heroes** (`MAX_PLAYERS`, `src/bosses/scaling.ts`).
- **One port:** REST `/api/*`, lobby WebSocket `/ws` and battle WebSocket `/game` on `node:http`. `STATIC=dist` — the server also serves the game.
- **Shared protocol:** `src/net/protocol.ts` (lobby, `PROTOCOL = 2`) and `src/net/game-protocol.ts` (battle). Version mismatch — the connection closes with 4001.

## 2. Running

```
npm run server        # http://localhost:8787, database ./data/malina.db
PORT=9000 DB_PATH=/var/malina.db STATIC=dist npm run server
npm run server:test   # node:test, in-memory database
```

- Node ≥ 22.18 runs `.ts` itself (type stripping), no build step.
- Server code may not use property declarations in constructor parameters or `enum`, and imports must carry the `.ts` extension. Type check — `tsc -p tsconfig.server.json` (part of `npm run typecheck`).
- SQLite — the built-in `node:sqlite`, no native dependencies; WebSocket — the `ws` package.
- Server address for the game: `?server=http://…` (remembered in `malina.server`). Otherwise the same origin is used if the game was served by the server, else `http://localhost:8787`.

## 3. Code

| File | What is inside |
|---|---|
| `server/main.ts` | config from env (`PORT`, `HOST`, `DB_PATH`, `STATIC`, `MAPS`), shutdown on SIGINT |
| `server/app.ts` | assembly: database, room manager, REST, WebSocket, cleanup once a second |
| `server/db.ts`, `migrations.ts` | opening the database (WAL, foreign keys), migrations by `PRAGMA user_version`, `tx()` |
| `server/repo/*.ts` | queries: players, profiles, rooms, matches |
| `server/auth.ts` | token — 32 random bytes, only the sha256 is stored in the database |
| `server/http.ts` | REST routes, CORS `*` (sign-in by header, no cookie) |
| `server/hub.ts` | connections: `hello`, rate limits, parsing and dispatching messages |
| `server/rooms.ts` | `RoomManager`: seats, host, readiness, start (creates a match), disconnect, match result → rewards, recovery after restart |
| `server/game/runner.ts`, `game-hub.ts` | match runner (one timer per process, 50 ms frame) and WebSocket `/game`: `hello` with token and match, then the channel drives the match |
| `src/game/battle.ts`, `match.ts` | headless battle (world, party heroes from profiles, pack, sword strike, lava) and match: command queues, snapshot ring, deltas for everyone, kits and actions, result with rewards |
| `src/net/game-protocol.ts` | `Cmd`, hero and enemy records (`HeroEnt`, `MobEnt`), battle channel messages, tick and frame |
| `server/validate.ts` | profile and message validation without libraries |
| `server/maps.ts` | maps with `meta.td` from `assets/maps`: which can be selected and the raspberry cap per battle |
| `src/net/transport.ts`, `ws-transport.ts`, `loopback.ts` | channel transport: interface, over WebSocket (browser and `ws`), in-memory loopback with latency, loss and reordering driven by a fake clock (tests, single-player) |
| `src/net/channel.ts` | `Channel` — netchan after Quake 3: in one frame a reliable lane (in order, acknowledged by `rack` and resent after `resendMs`, window 64) and an unreliable one (last wins by `seq`, old frames dropped, `ack` — last received) |
| `src/net/snapshot.ts` | `SnapshotRing` (ring of the latest world snapshots, delta from the snapshot the client acknowledged — `add`/`upd`/`del` plus events grouped per snapshot after the base; no acknowledgement or it fell out of the ring — full, `base: 0`) and `SnapshotView` (the client's copy of the world with a history of 32 received states, like `cl.snapshots` in Quake 3: a delta from any base in the history is applied, events are played only if newer than those already applied; base unknown — `rejected`, a full one is needed) |
| `src/sim/` | battle simulation without scene or DOM — shared code of server and browser: a seeded world, events, entity records; so far — the defence (towers, walls, bush, piles), heroes and enemies via hooks ([design-tower-defence.md](design-tower-defence.md), section 15) |
| `src/cgame/` | the client half: a view from records and events, effects, defence menu and HUD; `events.ts` — the system event queue (input and network frames are processed before ticks), `input.ts` — tick input with latches and actions, `orders.ts` — mouse orders; `net-battle.ts` — the network battle client (channel to `/game`, prediction, other heroes, puppets, defence mirror, player list, chat, names) |
| `src/headless.ts`, `src/rng.ts` | headless mode: hero, gear with magic and mobs — the same classes without rendering (three in Node, a canvas stub, `nullFx` with `custom`/`streak` timers, where spell damage lives); game randomness `rnd()` for the duration of a world step — the seeded world generator (`useRng`); decoys — the world's list (`useDecoys`), party heroes — hooks `MobHooks.heroes`/`hurtKnight` instead of global `party`/`decoys` |
| `src/net/client.ts` | the browser's `NetClient`; `NET` in `src/menu/session.ts` — its instance |
| `src/party.ts` | the hero party on the host: mobs pick the nearest, hits on a guest's hero |

So that the server can import the item catalogue (`src/items.ts`) for profile validation and experience grants (`Profile.addXp`), `rng` was moved out to `src/rng.ts`, without three.

## 4. SQLite schema

- `players` — id, name, `name_key` (lower case: NOCASE in SQLite does not understand Cyrillic), token hash, time.
- `profiles` — the whole `ProfileData` as JSON and `version`.
- `rooms` — a five-digit code (no leading zero, typed on any keyboard; the lobby field takes digits only), host, map, `max`, `private`, `state` (`lobby | battle | closed`), seed.
- `room_members` — seat, readiness, `gone_at`.
- `matches` — map, player count, seed, start and end, result (`won | lost | abandoned`), wave.
- `match_players` — hero seat, raspberries and experience for the battle.

Time is Unix milliseconds everywhere. A new schema — only via a new migration at the end of the list.

## 5. Sign-in and profile

- `POST /api/auth {name}` → `{playerId, name, token}`.
  - Name — 2–16 letters, digits, spaces, `_` and `-`; case-insensitive.
  - Name taken → 409. Own name with own token — the same hero.
- `POST /api/auth/rename`, `GET /api/me`. The token is stored in `localStorage['malina.net']`; lose the token — the hero cannot be recovered, same as a save in localStorage.
- `GET /api/profile`, `PUT /api/profile {version, data}` — optimistic locking: with a stale version → 409 and the fresh profile.
- Validation (`checkProfile`):
  - the shape of `ProfileData`, finite non-negative numbers, size ≤ 256 KB;
  - only items that are in the bag may be equipped;
  - unknown items are thrown away, as in `Profile.load`.

  This does not protect against cheats in the host model — it filters out garbage.
- **Sync** (`NetClient.syncProfile`, in the camp):
  - the client remembers the version of the last sync (`malina.net.version`);
  - the server's version is newer → the server profile is taken;
  - otherwise the local one is sent to the server;
  - further changes in the camp are sent with a 0.8 s delay.

  The battle page does not touch the stored profile: it works on a battle copy (`Profile.enterBattle`, [design-tower-defence.md](design-tower-defence.md), section 12).

## 6. Rooms

- `GET /api/rooms` — public rooms with free seats: both in the lobby and in a running battle (`RoomInfo.state`; this is the `OnlineLobby` from `session.ts`).
- WebSocket: `room.create {map, max, private}`, `room.join {code}`, `room.leave`, `room.ready`, `room.map` and `room.kick` (host only), `room.start` (host, all guests ready and connected), `room.again` ("Again" after a battle — host, same line-up without readiness), `chat {text}` (to everyone in the room: name, seat, text ≤ 200 characters, no more than once per 0.4 s). Every change — `room.state {room, seats, you}` to everyone in the room.
- **Start:** `battle.start {matchId, map, players, seed, hostSeat, seats}`, a row in `matches`. The camp leaves for `?map=…&from=menu&players=N&room=CODE`, the battle page signs in to the server anew. "Again" — a new `battle.start`, the battle page follows it on its own.
- **Joining a running battle:** `room.join` into a room in battle, while there is a seat — a late joiner's row in the match (for the reward) and a `battle.start` to them; for the others their hero appears on the first input and the room line-up.
- **Friends** (`friends`, migration 003): `POST /api/friends {name}` — add by name (one-way list), `GET /api/friends` — whether online and in which room (join by code — into a private one too), `DELETE /api/friends?id=`.
- **Disconnect:**
  - the seat is held for 30 s (`NET_LIMITS.graceMs`), re-entry with the same token returns to it (reloading the "To battle" page works the same way);
  - the same player signing in from another tab closes the old connection (4009);
  - no `hello` within 15 s (the battle page is busy building the map) — close with 4002, the client reconnects and does not forget the sign-in; 4003 — only for a wrong token. The battle page connects immediately, without checking `/api/health`;
  - the host left: the next player becomes host (crown, lobby rights); the battle on the server continues without their hero. Everyone left — the match is `abandoned`, the room is closed;
  - the room emptied — closed, the code is freed; closed rooms are deleted after a day.
- **Server restart:** battles → `abandoned`, lobbies remain, all players count as disconnected, seats are held for 10 min. The battle page reconnects, sees the room in the lobby — the battle is interrupted ("Connection to the server lost").
- **Limits:**
  - message ≤ 64 KB;
  - ≤ 100 messages per second on `/ws`; two consecutive seconds over — close (4008);
  - input commands on `/game` — one per tick; over a lossy transport (`Transport.lossy`: the lossy loopback, a future UDP-like one) the client sends a batch of the last three (`CMD_DUP`, like `cl_packetdup`), over WebSocket — one (TCP does not lose, duplicates only wasted bandwidth); duplicates by `seq` are dropped, queue ≤ 8, old ones dropped;
  - `/game` is compressed with permessage-deflate with a shared context (`DEFLATE` in `server/game/game-hub.ts`, threshold 64 bytes): snapshots are similar from frame to frame, 4–12× smaller on the wire — measurements in [dev-performance.md](dev-performance.md);
  - the reliable message window (64) overflows — the connection closes with 4010, as Quake 3 drops a client that does not acknowledge.

## 7. Battle

- **Start.** `room.start` creates a match (`Match`): the map world with a seed, a hero for each seat from their server-side profile (own gear, at least 40 arrows; the party's strength — the average `Profile.rating`, `Match.rerate`), a starting treasury for each (every player has their own raspberries). The match goes into the runner; the battle page opens `/game`, sends `hello {token, matchId, protocol}` and receives `welcome`, everyone's kits and a full snapshot.
- **Channel** (`src/net/channel.ts`): in one frame a reliable lane (`td` builds, `act` actions — with the number of the client's last command, the server executes it after that one and before the next, `kit` kits, `welcome`, `over`) and an unreliable one (`Cmd` ↔ snapshot delta; over a lossy transport — a batch of the last three commands). `Cmd.snap` — the last snapshot the client applied: the server computes the next delta from it, none such in the ring (32 snapshots) — full. While the acknowledgement is in flight, deltas come from the older base — the client restores it from its history (32 states) and applies; events in a delta are grouped by snapshot, only those newer than the applied one are played — no duplicates and no losses under latency.
- **Snapshot** — entity records (`src/sim/entities.ts`, `src/net/game-protocol.ts`): heroes `h<seat>` (position, facing, health, exhausted, input, dodge roll, bow, input `ack`, ping), enemies `m<id>` (kind, position, health, flags, attack and its number, target, road), defence `td`, towers, walls, bush, lairs, projectiles, pools, piles `p<n>`, purses `purse<seat>`; events (`src/sim/events.ts`) — of all snapshots after the base.
- **Own hero** is predicted: stepped locally from input, a command leaves every tick; by the `ack` from a snapshot the position is reconciled against where the hero was at that input, the discrepancy is removed at 20 % per snapshot (more than 2.5 m — at once). Health and "exhausted" — the server's.
- **Other heroes** — knights driven by the input from the record, position from the snapshot buffer by **server time** (`Delta.tick`; clock offset estimated like `cl.serverTimeDelta` in Quake 3: reset on a discrepancy > 0.5 s, otherwise creeps up) with a 0.1 s delay; gear from `kit` (the server sends everyone's kits), actions — `act` with a position are replayed for the view.
- **Enemies are puppets** (`Mob.puppet`): appear from the record, walk by the server's intent (`mx`, `mz`) and are pulled toward the position from the buffer, a new attack by number — the same attack for the view, gone from the snapshot — crumble; damage is computed by the server.
- **Defence** — a `SimTd` mirror from records (`TdUi` and hints work as in single-player), menu commands and `G` — reliably to the server (`SimTd.remote`); towers, walls, piles are drawn by `TdView` from the same records as in single-player.
- **Sutler**: a purchase takes raspberries from the mirror, the difference goes to the server with the kit (`kit.cost`).
- **Time does not stop in a network battle**: inventory, shop, hitstop and spell slow-motion (`fx.hitstop`/`slowmo`) do not stop ticks or commands — own hero stands with empty input, the others play. Client-side defence events are played only by `TdView.apply` (once); the number for picked-up raspberries — above the hero of own seat.
- **Result.** The bush held or withered — after 4.5 s (the harvest has flown in) the match sends `over`, the room closes the match: history, a reward to each — the **match loot only for a defended bush** (defeat — 0; [design-tower-defence.md](design-tower-defence.md), section 16) and battle experience, capped per map (`maxBerries`), `profile.updated`, `battle.over`, the room is a lobby again. "Again" — `room.again`. Joining a running battle — the hero at the spawn point and a full snapshot; disconnect — the command queue is reset, the hero stands in place until `graceMs`, then is removed; a new connection — new command numbering (`seq` from zero) and a full snapshot.

## 7a. Voice

- **Key T** (camp and network battle) turns *one's own microphone* on and off; teammates with a mic on are always heard — receiving asks for no permission. `SeatInfo.voice` — 🎤 next to the name in the camp seats and in the battle player list (brighter while the seat is talking: an `AnalyserNode` on the stream).
- **Mesh WebRTC** (`src/net/voice.ts`, `VOICE` in `src/menu/session.ts`): up to 3 `RTCPeerConnection` per player, audio does not touch the server. Signalling — `rtc {to, data}` over the lobby `/ws`; the server (`RoomManager.rtc`) only forwards it to an online seat of the same room, otherwise drops it silently; `voice {on}` — the flag in the seats, reset on a disconnect. SDP ≤ `NET_LIMITS.sdpMax`, candidate ≤ `iceMax`.
- **No renegotiation:** the lower seat offers with one `sendrecv` audio transceiver; the mic goes in and out with `replaceTrack`, when off the track is stopped (the browser's mic indicator goes out). An offer from a seat always replaces the old connection with it; `failed` — the offering side starts over. Signalling is handled strictly in order (a promise chain): ICE never overtakes its offer.
- **Camp → battle:** the page reloads, the mic state is in `sessionStorage` (`malina.voice`) — the battle page turns it on again by itself (no dialog if permission was granted), connections are made anew.
- **ICE:** STUN `stun.l.google.com` by default; `RTC_ICE_SERVERS` (JSON) on the server — its own STUN/TURN, given in `/api/health` (`ice`). Without TURN voice over the internet may not get through a symmetric NAT.
- **Limitations:** the microphone works only over HTTPS or on localhost — `http://192.168.x.x:8787` on the LAN gives a toast "Voice needs HTTPS or localhost" (prod behind Caddy is HTTPS). Several laptops in one room echo — echo cancellation helps, but voice is meant for playing apart.

## 8. Tests

- `npm run test:net` (`server/test/*.test.ts`, `node:test`, seconds): sign-in, profile, rooms, match start and result with rewards, host leaving, restart; channel (order, loss, window), snapshot codec; defence simulation and determinism; headless battle with real mobs; a match over the loopback with two fake clients (input, building, actions, wave, result; latency 60 and 100 ms — not a single rejected delta; events exactly once; a dodge roll is visible to the other and moves the hero; disconnect — the hero stopped, return — `ack` with the new numbering).
- `tests/net.spec.ts` (Playwright): a real server and two browsers — sign-in, room by code, "Ready", "Start game", both pages in a server battle: snapshots flowing, the guest's hero on the host moves by the guest's input, names above heroes, the guest's tower paid with their raspberries on both, a wave — puppets on both. ~~`tests/net-party.spec.ts`~~ removed: its scenarios (late joiner, host leaving, restart) are in `rooms.test.ts` and `match.test.ts`.
- `tests/voice.spec.ts` (Playwright, fake microphone `--use-fake-device-for-media-stream`): T in the camp — 🎤 at the guest, a connected peer with a live track; into battle — the mic is on again, connection again, 🎤 in the player list; T in battle — off. `rooms.test.ts` — `rtc` only within the room, junk rejected, the `voice` flag and its reset.
- `tests/menu.spec.ts`: without a server the panel shows "Server unavailable", start is disabled.
