# Tutorial. Design document

Version 1.0 of 2026-11-13. In the code: 27 cards in two languages with screenshots, the "How to play" handbook, triggers in the camp, Bush Defence and expeditions, the screenshot pipeline (`make shots`).

Related: [design-main-menu.md](design-main-menu.md) (the camp, settings, pause), [design-tower-defence.md](design-tower-defence.md), [design-expeditions.md](design-expeditions.md), [td-playability-kids.md](td-playability-kids.md) (hints for kids, backlog item 7), [dev-testing.md](dev-testing.md).

## 1. Decision: cards as mechanics appear, plus a handbook

The game has about 25 mechanics in three places (camp, Bush Defence, expeditions), and some show up late: tower hunters on wave 3, dusk on minute 15 of an expedition, walls and lanterns only on their maps. Two ways to teach them were weighed:

- **Everything on the first visit** — a deck of ~25 slides before the first battle. Simple to build, but most of it is forgotten before the mechanic is met, and it is heavy for the 10–14 audience.
- **As mechanics appear** — a short card the first time a thing shows up. The explanation lands when it is needed; the cost is that a missed card must be findable again.

Taken: **the hybrid**. A card pops up the first time its mechanic appears, and every card lives in the **"How to play" handbook** (start screen, the `?` button in the camp, the pause menu), met or not.

## 2. A card

One card — one idea: a screenshot with numbered rings, a title, one or two short lines, and a legend whose numbers match the rings. The tone is the game's: a friendly adventure, no scolding.

| Where | Behaviour |
|---|---|
| Camp, solo battle | The card is in the middle over a dimmed game; a **solo battle is paused** until it is dismissed (`Enter`, `Space`, `Esc` or the button). A fresh card ignores the key for 0.45 s — the player was mid-fight |
| Network battle | A small card at the right edge, the game stays clickable, it fades after 12 s — the others play on |

Rules of the queue (`src/tutorial/tutorial.ts`):

- one card at a time, each **once per browser**;
- **urgent** cards (the thing is happening now: a mini-boss, a tower under attack, the hero fell, dusk) jump the queue and come at once;
- **chain** cards are the opening run of a battle and follow each other with no gap;
- the rest keep **20 s** between each other in a battle and wait for a **lull in the fight** — they never interrupt combat;
- a card waits while the inventory, the shop, the pause or the result screen is up.

"Do not show hints" on a card turns the pop-ups off. Settings → Game has the same switch and "Show again", which forgets what was seen. The 15-second controls hint (`help` in the settings) is a separate, older thing and is untouched.

State: localStorage `malina.tutorial` = `{ off, seen: [id…] }` — per browser, like `malina.settings`; the server profile is not involved.

## 3. The cards

Source of truth — `src/tutorial/cards.ts`. Strings are English keys of `t()`, Russian in `src/i18n/ru.ts`.

| Section | Card → what fires it |
|---|---|
| Camp | `camp.gear` — the camp opens · `camp.items` — "All items" opens · `camp.map` — the Map tab · `camp.exp` — the Expeditions tab |
| Online | `camp.rooms` — the Rooms tab |
| Bush Defence | `td.move`, `td.build`, `td.wave` — the start of a battle (chain) · `td.berries` — the first `pile.drop` · `td.sutler` — next to the sutler · `td.skills` — the first `wave.won` · `td.level` — a new level · `td.chief` — `chief` · `td.hunters` — `tower.hurt` · `td.repair` — `tower.ruin` · `td.down` — the hero fell · `td.lava` — the hero burns in lava · `td.walls` — a map with walls / `wall.hurt` · `td.lanterns` — a map with mist / `lantern.out` |
| Expeditions | `exp.goal` — the start (chain) · `exp.parcels` — after the start, with the usual gap · `exp.alarm` — `exp.alarm` · `exp.horn` — `horn.start` · `exp.seeds` — `seed.take` / a seed from `poi.take` · `exp.totems` — the hero fell / `hero.totem` · `exp.dusk` — `exp.dusk` · `exp.balloon` — `exp.primary` |

Where the triggers sit: simulation events — `TdUi.events()` (`src/cgame/td-ui.ts`) and `ExpUi.events()` (`src/cgame/exp-ui.ts`), the same funnel for solo and network battles; proximity, the fall, lava and the level — `src/dev/playground.ts`; the camp — `Lobby.show`, `setPane`, `openInventory` (`src/menu/lobby.ts`).

A battle hosts the tutorial only when it was started from the menu (`?from=menu`). A page opened directly (`?dev=playground`, `?map=…`) stays quiet.

## 4. Screenshots

`public/tutorial/<lang>/<card id>.webp`, 800 × 450, one set per language (the HUD has text). They are **not** in the single-file bundle: the build copies `public/` next to `dist/index.html` and a card loads its picture by a relative path, lazily. A missing picture just leaves the text. `dist/tutorial` is ignored by git — the pictures are kept once, in `public/`.

`make shots` reshoots all 54 (≈ 20 s): `playwright.shots.config.ts` + `scripts/shots/`.

- `lib.ts` — `openBattle` (a battle from the menu through the test server, the script drives time with `__malina.step()`), `openCamp` (hides `navigator.webdriver`, otherwise the campfire scene is not drawn), `shoot`.
- `tutorial.shots.ts` — one scene per card: it puts the game into the state through `window.__malina` / `window.__menu` and lists what to ring, **in the order of the card's `marks`**.
- The rings are drawn **in the page**, as an SVG over the game, right before the shot: an element is ringed by its box (a line of text — by the text itself, a scrolled pane cuts what is not seen), a thing of the 3D world — by its projection through the camera. The frame is cropped 16:9 around the rings and re-encoded to WebP in a canvas. No image library is added to the project.
- The window is 960 × 540 at double density: the interface font has a 10 px floor, so the HUD is relatively larger and stays readable on a card.
- **The shots need the network**: Press Start 2P and Rubik come from Google Fonts. `shoot` fails if they did not load, so fallback fonts never get committed. Ordinary tests block those hosts — the shots have their own config.

Changing a card's `marks` means changing its scene too; changing the HUD or the camp layout — reshoot.

## 5. Tests

`tests/tutorial.spec.ts`: the opening cards come one by one and pause the battle; an urgent card jumps the queue; seen cards do not repeat after a reload; "show again"; the handbook lists all 27; "do not show hints"; Russian texts.

An automated run (`navigator.webdriver`) keeps the tutorial **silent** — a pausing card would stall every other spec. A test that wants it stores `{ "on": true }` in `malina.tutorial` before the page loads.

## 6. Not done

- No highlight of the live element on the screen itself — the rings are only on the picture.
- The pictures follow the starter hero and fixed seeds; they are not reshot automatically when the HUD changes.
- A third language needs its own set of pictures (a new project in `playwright.shots.config.ts`).
