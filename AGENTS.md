# Malina — notes for agents

The game and the code are described in `README.md`, project knowledge lives in the wiki `wiki/` (editing rules — `wiki/CLAUDE.md`, table of contents — `wiki/index.md`).

## Running

`make dev` — server and Vite client together, `make play` — build and one server with the game, `make check` — types and `test:net` (targets in `Makefile`).

## Tests — always like this

```bash
mise exec -- npm run build
PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" mise exec -- npx playwright test
```

- Node — only via `mise exec` (version in `mise.toml`).
- Browser — the installed Google Chrome via `PW_CHROMIUM`. **Do not run `npx playwright install`**: the sandbox has no network, the download hangs. Details and how to remove a partial download — `wiki/dev-testing.md`.
- A run takes ≈ 2 minutes — run it in the background.
