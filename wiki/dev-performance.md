# Performance: measurements, budgets, rules

> Version 4 · 2026-11-04

Where it came from: stutters during a spell barrage and on a warden's death. Analysis showed the cause was not the scene size (the playground — 206 chunks, nothing in the level changes) but effects being born "on the fly": new materials and geometries for every lightning segment, a thousand berries in one frame, the first cast of each school compiling shaders right in the frame of the hit. Hence measurements and pools first; region streaming is a separate stage (see "Roadmap" below).

## How to measure

- **F8** in the playground — the `src/dev/perf.ts` overlay: FPS, frame (average, p95, max over 2 s), simulation and render CPU, GPU (if the browser provides `EXT_disjoint_timer_query_webgl2`, otherwise "n/a"), draw calls, triangles, shader programs, geometries, textures, number of long frames (> 25 ms) and the cause of the last one. Causes are set by code: `perf.mark('…')`.
- Hook `window.__malina.perf` — `snapshot()`, `reset()`; `__malina.renderer.info` — three's counters; `__malina.ready` — the warm-up promise (program count).
- **Perf test** `tests/perf.spec.ts`: death of the final warden on level 30 with 4 players (fountain, grimoires, berry pickup) and a barrage of all 24 spells. Checks: the program count does not grow after warm-up; the second round of spells adds no geometries (leaks); on a real GPU — no frames longer than `PERF_MAX_MS` (40) or three times the median.

```bash
mise exec -- npm run build
PERF_GPU=1 PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" mise exec -- npx playwright test tests/perf.spec.ts
```

`PERF_GPU=1` opens Chrome in a window with Metal — only then does render time mean anything. Without it the test runs in SwiftShader (software rasterisation, translucent effects take seconds to draw) and checks only leaks and programs.

## Measurements

| Scenario | Before (2026-10-25) | After |
|---|---|---|
| Warden death, worst frame (GPU) | 52 ms, 1066 piles on the floor, programs +4 | 12.7 ms, 26 piles on the floor, programs +0 |
| Warden death, SwiftShader | 18.9 s (shader compilation + 4 calls per berry) | — |
| Spell barrage, worst frame (GPU) | 30.7 ms, programs +5, geometries +143 | 9.5 ms, programs +0, geometries +2 per round |
| Barrage, SwiftShader | 19.3 s | — |
| Programs after warm-up | 41 (the rest compiled in battle) | 127 (all at load, ≈ 1 s) |

## What was done

1. **Warm-up** (`src/fx-zoo.ts`): at load a "zoo" is placed in the scene — one body of every material variant that is born in battle (Lambert plain/transparent/double-sided/with vertex colours, Basic with and without a map, additive, sprites, points, lines, instances with colour, grimoire binding and covers). One `renderer.compileAsync` — for the canvas (sRGB) and for the composer buffer (linear space: these are different programs). The zoo materials live for the whole session, otherwise three evicts the programs from the cache. There, too, the sigil, glow and trail textures are pre-drawn and uploaded, as are all textures already standing in the world (sleeping wardens, shops — they popped in when first entering the frame).
2. **Pools** (`src/pool.ts`, `src/fx.ts`): particles on typed arrays (structure of arrays, no objects per spawn); rings, flashes, arcs, slashes and decals — slots with shared geometry (rings are quantised by thickness in steps of 0.05) and a material per slot; damage numbers — reusable divs, at most 48.
3. **Instances** (`src/fx-bolts.ts`): lightning and fire cubes — one `InstancedMesh` per layer with colour and opacity in attributes (`aAlpha` via `onBeforeCompile`). Previously a sky lightning bolt was 60 meshes and 2 materials.
4. **Raspberry fountain** (`src/props.ts`): berries fly out in waves of 8 per tick, at most 60 piles (a strong warden's piles are larger, the raspberry total is the same); what is picked up is freed (`disposeOwned`); the pickup flash and ring — no more than once per 0.1 s; a lying berry does not check obstacles every tick.
5. **Grimoire** (`src/bosses/grimoire.ts`): binding — shared materials, cover — one texture per icon.
6. **Frame** (`src/lighting.ts`): the shadow map is drawn once per frame (`shadowMap.autoUpdate = false`, `needsUpdate` before the composer — GTAO makes a second pass over the scene, and shadows cost double); AO — `AO_QUALITY` (half resolution, 6 samples, 8 for denoising; was 10 and 12); one scene traversal to hide transparents instead of two. Canvas without MSAA and with density ≤ 1.5: the composer assembles the frame in its own buffers.
7. **DOM**: `.fx-flash` without `mix-blend-mode`, `.fx-dark` without `backdrop-filter` (full-screen blend modes forced the compositor to rebuild the frame), number outlines in a single layer.
8. **Sound** (`src/audio.ts`): a budget of 32 simultaneous voices; when full, detune duplicates and sparkles shorter than 0.1 s go first.

## Stage 2: frame cost (2026-10-25)

| What | Was | Now |
|---|---|---|
| Level: `view.sync/update`, x-ray, slice | every simulation tick (up to 6 times per frame when catching up) | once per frame in `render()`; the `step()` hook syncs by itself |
| Weather (`src/weather.ts`) | CPU computed 2,600–5,200 particles and re-uploaded the buffer every frame | position is computed by the vertex shader from seed and time; three uniforms change per frame, simulation in a thunderstorm — 0.04 ms |
| Fireflies | 70 matrices per frame on the CPU | vertex shader by seed (`seed` per instance), two uniforms |
| Chunk geometry (`src/level/mesher.ts`) | 17 numbers per vertex in all layers, no indices | indices: a quad — 4 vertices, block shapes share edge vertices (−33 % vertices); `shore`/`flow` only for liquids, `bake` only with baked light nearby. Playground: 45.9 → 21.6 MB |
| Hero path (F2, `src/dev/overlay.ts`) | a new geometry every frame, even without a path | one buffer, `drawRange` |
| Minimap | the 2D canvas was redrawn every frame | 10 times a second (the full map — every frame while open) |

The vertex shader reads a missing attribute as zero (`bake` on unlit chunks, as on decor) — separate material variants are not needed. In GLSL the word `half` is reserved.

## Stage 3: regions and streaming (2026-10-25)

Decision of 2026-10-25: the world is a **fixed map** (pre-generated or hand-drawn); there will be no infinite world. Regions are needed not to generate on the fly but so that only the players' surroundings are in the scene: a map of 512 × 512 m and larger does not live in the scene whole. There is no tree and none is needed: the world is a grid of **32 × 32 m** columns (2 × 2 chunks in X and Z, all in Y) keyed by `rx,rz`; the region of a point is `floor(x / 32)`.

- **Source — a map** `src/world/map-source.ts`: the whole map lies in memory (`Level`), the live level gets its palette, and on region load the chunks are copied as is (`Level.putChunk`, no re-encoding), the region's decor is added and removed with it, the map entities `chest`, `barrel`, `crate` become region items with id `rx,rz:n` (a room template's chest replaces the crate block under it). A large map (> 400 chunks) streams by itself, any map — with `?stream=1`; a small one lives in the scene whole, as before. Example: `?map=dungeon&seed=42&floor=2&stream=1`.
- **Generator** `src/world/gen.ts` — a debug source (`?map=world&seed=N`) to exercise streaming without a large map: a region is deterministic from (seed, rx, rz). Relief — `landscape` from `src/level/kit.ts` on a window with a 12-cell margin (smoothing and walkability are computed from neighbours, otherwise there would be seams at the joints), only its own column is copied into the world. Roads every 64 m on the grid, lakes by 48 m noise with a sandy shore, a cliff in every fourth region, trees and flowers by cell hash (trees no closer than 3 m to the edge). Entities — crates, barrels, chests on flat grass with stable ids `rx,rz:n`.
- **Manager** `src/world/regions.ts`: anchors — hero positions (the union for co-op), a square of radius 2 regions around each; beyond radius 3 a region is unloaded after 5 s (hysteresis). Loading — no more than one region per frame, nearest first. Unloading — `Level.removeChunk` by the region's keys and `Props.removeGroup`.
- **Mesher with a budget**: `LevelRenderer.sync(budgetMs, focus)` rebuilds dirty chunks nearest first until 4 ms run out; the rest — in following frames (`view.pending`). Baked block light is computed per chunk, not by traversing the whole level. `Level.getBounds()` grows in place on `set`, without traversal (after erasing it remains a superset — it is only a search range).
- **State**: `Props` calls `hooks.changed(id)` when a barrel exploded, a crate broke or a chest was opened; the manager writes the id into the region delta and saves `malina.world.<seed>` in localStorage (`{version, regions: {key: {dead: [...], seen: base64}}}`); on region load the "dead" are not placed. The same format will suit the server.
- **Map** `src/hud/automap.ts` — tiles of 32 × 32 cells: a tile is created on region load (columns are read from the level, neighbouring tiles redraw their outlines), exploration is packed into base64 on unload and restored on return and after a reload.
- **Test** `tests/world.spec.ts`: on the procedural source — 25 regions at start, a 160 m trip loads and unloads regions, the same item ids on return, a broken crate and an opened chest do not come back after unload and reload, the map remembers exploration; on a dungeon floor as a map — chests from entities, an opened one does not come back after unload and reload.

Measurement in the preview (GPU): a 160 m trip in 2 m steps — region generation and meshing fit in 6–7 ms per step; in the world 25 regions ≈ 180 chunks, 370 draw calls.

Not done and coming later: wardens and arenas as map entities per region (currently only the playground), enemy obstacles per region, floor loot into the region state, decor as instances per region (currently `DecorRenderer` rebuilds all instances on every region load), the mesher in a worker — if the budget is not enough.

## Rules for new code

- Create nothing in battle: `new THREE.*Material`, `new *Geometry`, `new CanvasTexture` — only at load or into a module-level cache. Need a new material variant — add it to the zoo `src/fx-zoo.ts`, otherwise the first cast will compile the shader in the frame.
- Mark shared resources with `markShared()` — the default `dispose` in `fx.custom` leaves them alone; do not write explicit `geometry.dispose()` on shared geometries.
- Temporary bodies — via `fx.shock/flash/arc/line/decal/bolt/fireCubes/particle`; `fx.custom` — only for special cases, with a minimum of bodies.
- Many identical bodies (berries, shards, hands) — instances or a capped pool; pickup/hit effects — with throttling.
- Sounds in batches — via `voice/hiss/boom`: they respect the budget themselves.
- Before committing a heavy effect — a `PERF_GPU=1` run of `tests/perf.spec.ts` and a look at F8.

## Roadmap

- **Frame cost, remainder:** torches — recompute the nearest ones every N frames; mesher — greedy face merging; hero — merge boxes by part; `Vector3` clones in the hero tick.
- **Regions, remainder:** wardens and enemies as region entities with three-free records, enemy obstacles per region, floor loot into the region state, the mesher in a worker when the budget runs short.
- **Network:** a seeded RNG instead of `Math.random` in gameplay (warden AI, crits, loot), remove `performance.now()` from the simulation, a list of heroes instead of one.

## Stage 4: server battle (2026-11-04)

A match without rendering (`src/game/match.ts`) with four heroes, towers on all pads, waves one after another, Node 26 on M-series: map `td` — 0.7 ms per 50 ms frame with 38 mobs, `td3` — 1.1 ms with 47 mobs; a full snapshot ≈ 12–14 KB JSON (deltas several times smaller). About 2 % of a core per match — neither "think less often" nor a binary codec is needed yet. Measurement script — modelled on `server/test/match.test.ts` (a match + `frame(0.05)` in a loop).

## Network: battle traffic

Measurement of 2026-11-04 (`PROTOCOL = 2`, JSON, two players, map `td`): scripts over `Match` via the loopback and over a real server with `ws` clients, bytes on the TCP socket.

| | Data | On the wire uncompressed | On the wire with permessage-deflate |
|---|---|---|---|
| Server → player, a wave without towers, up to 20 mobs | 16.5 KB/s | 16.5 KB/s | **1.3 KB/s** |
| Player → server, a command every tick (60 Hz, ~180 B) | 10.2 KB/s | 10.7 KB/s | **2.7 KB/s** |

- A batch of three commands per frame (`CMD_DUP`) over WebSocket tripled the outgoing stream to 27 KB/s per player to no benefit (TCP does not lose) — now duplicates only over a lossy transport.
- A full snapshot — up to 4.3 KB, an average delta — 0.6 KB, with 20 mobs — 0.9 KB.
- Conclusion: a binary codec and Huffman (as in Quake 3) are not needed with ≤ 4 players; compression with a shared context gives more than a compact codec without one. Bandwidth is not this game's limit; the limit is latency (RTT/2 per strike); a non-TCP transport (WebTransport, WebRTC DataChannel) makes sense only against head-of-line blocking under loss on Wi-Fi, and the architecture (seq/ack, snapshot ring, `CMD_DUP`) is ready for it.
