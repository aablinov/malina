# Tests: how to run Playwright

> Version 5 · 2026-11-08: no tests for the playground, the editor, the world and Soller. Version 4 · 2026-11-08: fast run — no frames drawn by themselves, real GPU on macOS, fully parallel, font hosts blocked. Version 3 · 2026-11-08: the camp and battles from it need a server — `tests/game-server.ts`

Tests — `tests/playground.spec.ts`, config — `playwright.config.ts`. They open the built `dist/index.html`, the simulation is driven through `window.__malina`.

**What we do not test.** No Playwright tests are written for the **playground** (`?dev=playground` scenes: the hero, weapons, spells, mobs, wardens, HUD, inventory), the **level editor** (`?dev=editor`), the **open world** (`map=world`, region streaming) and **Soller**. The existing ones are switched off with `test.skip` (`tests/playground.spec.ts`, the editor test in `tests/prefabs.spec.ts`, `tests/world.spec.ts`, `tests/perf.spec.ts` — it runs on the playground scene; the island `tests/island.spec.ts` too), the Soller test is removed. New tests go to the game itself: the camp and the server, Bush Defence (`map=td…`), the network.

- **No frames by themselves:** an automated run (`navigator.webdriver`, `AUTOMATED` in `src/devflag.ts`) simulates and updates the view and the HUD but does not draw; `__malina.render()` draws a frame, `render(false)` only syncs the view (camera, regions, chunks). No shader warm-up either — `?warm=1` brings it back (perf tests count programs).
- **Held time:** while the test is in control (`script(true)`) game time moves only by `step()` — what the page does between two test calls does not depend on machine load.
- **GPU:** on macOS — Metal even headless (a page starts in ~1.6 s, frames are cheap); elsewhere or with `PW_SOFTWARE=1` — SwiftShader. Window 640 × 400.
- **Parallel:** `fullyParallel`, a worker per core (`PW_WORKERS` overrides).
- **No network:** the font hosts (Google Fonts) fail at once (`--host-resolver-rules`) — otherwise the request hangs and holds the `load` event for a minute.
- Known: after the last test the run may linger for minutes with idle workers — not found yet.

- Dev pages (`?dev=playground`, `?map=…` without `from=menu`) need no server: a starter hero in memory, nothing is saved.
- The camp and battles "from the menu" need one: the hero lives only on the server ([design-multiplayer.md](design-multiplayer.md), section 5). Such specs start their own (`startGameServer()` in `tests/game-server.ts`: `server/main.ts`, `DB_PATH=:memory:`, `STATIC=dist`) on a free port (`PORT=0`, the port from the server's log line) — every worker its own; never 8787, where `make dev` may run. `signIn(page, server)` registers a hero and puts its token and the language into the page before the scripts; `storedProfile(server, token)` reads what the server keeps.

## Fast network and simulation tests — `npm run test:net`

```bash
mise exec -- npm run typecheck && mise exec -- npm run test:net
```

`server/test/*.test.ts` on `node:test` without a browser: the server (login, rooms, summary), protocol and channel, snapshot codec, seeded battle simulation, a match over an in-memory loopback — seconds, not minutes. Run before every commit; Playwright — only for view and UI changes and at the end of a phase. `headless-gear.test.ts` — all artifacts, spells, auras and weapon arts on the headless server (catches a forgotten `document`). `headless.test.ts` — headless battle: real `Knight`, `Gear` and a `Pack` on the `td` map in Node with a scene without rendering and `nullFx` (`src/headless.ts`), a wave to the end and a determinism hash. `sim-boundary.test.ts` — the guard: the `src/sim`, `src/net`, `src/game` modules shared by server and browser load in Node and do not touch the DOM, the three scene, FX, sound, `Math.random` or the clock (`tsconfig.server.json` checks them without `lib: DOM`).

## Playwright recipe (works for agents and in the sandbox)

```bash
mise exec -- npm run build
PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" mise exec -- npx playwright test
```

- **Game code must load in Node** (type stripping): imports only with `.ts`, no `enum` and no constructor parameter properties — otherwise `headless.test.ts` fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; to find the culprit — `node -e` with `stripTypeScriptTypes` from `node:module` over all files.
- **Node — via mise** (`mise.toml`: node 26.7.0). Without `mise exec` a foreign node from `PATH` gets picked up (for example `~/.hermes/node`).
- **Browser — the installed Google Chrome** via `PW_CHROMIUM` (`launchOptions.executablePath` in the config). No need to download a browser.
- **Do not run `npx playwright install chromium`** in the agent sandbox: it has no network, the download hangs on the first few hundred KB and leaves `~/Library/Caches/ms-playwright/__dirlock` and a half-downloaded `chromium-*` folder. If that happened — kill the `playwright install` / `oopDownloadBrowserMain` processes and delete those two folders.
- The error `Executable doesn't exist at …/chromium_headless_shell-…` means `PW_CHROMIUM` was forgotten, not that a browser needs downloading.
- 15 tests take ≈ 2 minutes single-threaded; run a long pass in the background.
- The perf tests `tests/perf.spec.ts` with `PERF_GPU=1` open Chrome in a window on the real GPU (Metal) — only then does frame time mean anything; without the flag they only check leaks and the number of programs ([dev-performance.md](dev-performance.md)).
- **Tutorial cards are silent in an automated run** (`navigator.webdriver`): a card pauses a solo battle and would stall a spec. A test that wants them stores `{ "on": true }` in localStorage `malina.tutorial` before the page loads ([design-tutorial.md](design-tutorial.md), section 5).
- **Tutorial screenshots — `make shots`**, not part of the test run: its own config `playwright.shots.config.ts`, the font hosts are not blocked there, so it needs the network.

Verified 2026-10-24: 15 of 15 green (node 26.7.0, Playwright 1.56.1, Google Chrome from `/Applications`).
