# Tests: how to run Playwright

> Version 3 · 2026-11-08: the camp and battles from it need a server — `tests/game-server.ts`

Tests — `tests/playground.spec.ts`, config — `playwright.config.ts`. They open the built `dist/index.html`, WebGL is software (SwiftShader), the simulation is driven through `window.__malina`.

- Dev pages (`?dev=playground`, `?map=…` without `from=menu`) need no server: a starter hero in memory, nothing is saved.
- The camp and battles "from the menu" need one: the hero lives only on the server ([design-multiplayer.md](design-multiplayer.md), section 5). Such specs start their own (`startGameServer(port)` in `tests/game-server.ts`: `server/main.ts`, `DB_PATH=:memory:`, `STATIC=dist`) on their own port — 8791 net, 8792 menu, 8793 voice, 8794 td-shop; never 8787, where `make dev` may run. `signIn(page, server)` registers a hero and puts its token and the language into the page before the scripts; `storedProfile(server, token)` reads what the server keeps.

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

Verified 2026-10-24: 15 of 15 green (node 26.7.0, Playwright 1.56.1, Google Chrome from `/Applications`).
