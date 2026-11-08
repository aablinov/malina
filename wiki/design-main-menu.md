# Main menu

Version 1.6 of 2026-11-08: the game always goes through the server — the hero profile lives only there, the first entry asks for the hero name, no server — "Server unavailable · Check again" (section 1, [design-multiplayer.md](design-multiplayer.md), section 5). Version 1.5 of 2026-11-08: the "Rooms" tab in the online camp — a room list like a server browser, a password instead of "Private game", "Return to battle" (section 4). Version 1.4 of 2026-11-07: shop and blacksmith in the camp, the battle on a copy of the profile instead of the stash (section 3). Version 1.3 of 2026-11-05: language picker on the first visit and a Language row in Settings (section 6). Version 1.2 of 2026-11-03: friends and room chat in the camp, joining a running battle (section 4). Version 1.1 of 2026-11-02: multiplayer — the camp panel works with the server (section 4, [design-multiplayer.md](design-multiplayer.md)). Version 1.0 of 2026-10-31: start screen, camp (gear and Bush Defence map selection), settings, pause and battle result, multiplayer stubs. The model is the Minecraft Dungeons menu (hero screen with gear slots, tabs on top, online lobby by the campfire). Inventory — [design-inventory.md](design-inventory.md), maps — [design-tower-defence.md](design-tower-defence.md).

## 1. Routing

- A page without parameters — the **menu** (`src/menu/menu.ts`, `runMenu`).
- **Page start** (`src/menu/boot.ts`): the language picker first (first visit), then the server — not answering → a "Server unavailable · Check again" card; no hero in this browser (`malina.net`) → the "Hero name" card (`POST /api/auth`); then the hero profile from the server (`campProfile`). Only after that the camp is built. The Online panel no longer has its own login; "Log out" forgets the hero in this browser and reloads to the name card.
- `?map=…` or `?dev=playground` — straight into the game, as before (`wantsGame` in `src/devflag.ts`); `?dev=editor` — the editor. All tests bypass the menu via `?dev=playground`.
- "Start game" reloads the page to `?map=td2&from=menu` (`battleUrl`, `src/menu/session.ts`): WebGL and the menu scene do not live alongside the battle, but the profile is shared — ~~localStorage `malina.profile`~~ (replaced 2026-11-08) the server profile: the camp sends its changes (`flush` before leaving the page, `go()` in `boot.ts`), the battle page loads it again (`battleProfile`). What is equipped in the camp is picked up in battle. Dev launches (`?dev=playground`, `?map=…` without `from=menu`) play a starter hero in memory and save nothing.
- From battle, "To camp" — `?menu=lobby`: the menu opens straight in the camp.

## 2. Screens

**Start screen.** Background — a night camp by a campfire (`src/menu/scene.ts`): a glade of blocks, a campfire with tongues of flame, sparks and light, crates, a barrel, tufts of grass, turquoise haze; by the fire — the hero in equipped gear. On the left, the logo and three buttons: **Single player**, **Multiplayer** (label "soon"), **Settings**; with dev tools enabled, smaller below — "Playground" and "Editor". ↑/↓ and Enter, mouse.

**Camp** (`src/menu/lobby.ts`). The camera zooms in on the hero, who is on the left (drag with the mouse to rotate). Tabs on top: **Gear · Map** (Q / E), mode, raspberries and enchantment points, ⚙ — settings.
- *Gear*: level and experience, gear power and power by type, slots grouped as in MCD — weapons (melee, bow), armour, artifacts (3), aura. Click — a card on the right (power, rarity, name, description, properties); double-click, "Change" or **I** — the inventory on that type's tab (`Inventory.show(tab)`); "All items" — the whole inventory. While the inventory is open the menu background freezes — the inventory has its own hero render.
- *Map*: three Bush Defence maps by difficulty (`src/menu/campaign.ts`) — Lava Basin `td` (easy), Crystal Glade `td2` (medium), Castle on the Meadow `td3` (hard). On the right — description, waves, roads, bush health and treasury (numbers come from the map's `meta.td`). A repelled map gets a "completed" mark. Double-click on a map — straight into battle.
- At the bottom: "Back" (Esc), a hint, **Start game** (Enter). The selected map and mode are remembered (`malina.menu`).

**Settings** (`src/menu/settings-panel.ts`, `malina.settings`): master volume and music (immediate), quality (pixel density 1.5 or 1 — from the next battle), post-processing, shadows, controls hint at the start of a battle. The same window on pause in battle, where post-processing, shadows and the hint change immediately.

## 3. Battle from the menu (`?from=menu`)

- **Esc** — pause (`src/menu/pause.ts`): time stops; "Continue", "Settings", "Restart", "Exit to camp".
- End of defence — a result over the map: "The bush held!" / "The bush withered", how many waves repelled and enemies defeated; "Again" (Enter) and "To camp". Victory marks the map completed.
- No debug telemetry and no F-key line in the hint; the tab title is the map name.
- **Hero's raspberries.** ~~Stashed in sessionStorage before battle (`stashBerries`/`takeStash`)~~ — replaced 2026-11-07: the battle works on a copy of the profile (`Profile.enterBattle`), the stored raspberries are not touched; victory adds the match loot ([design-tower-defence.md](design-tower-defence.md), section 16).
- **Shop and blacksmith** in the "Gear" tab (button or **B**): the merchant and the blacksmith windows (`src/hud/shop.ts`) for the account raspberries — what is bought stays with the hero and goes into battle. Under the gear power — the defence strength (`Profile.rating`).

## 4. Multiplayer

~~Stub: a panel without a server, "Start game" disabled~~ — replaced by the server ([design-multiplayer.md](design-multiplayer.md)).

The same camp with a third tab **"Rooms"** (only online; Q / E go round the three tabs) — it opens on it (in a room — on "Map"). `Lobby.roomsHtml`: a table like the CS server browser across the hero column — 🔒, creator, map, wave ("lobby", "preparing" or "3 / 10"), players x / max and a button: "Join", "no seats" (the row is greyed), "you are here", "Return" (one's own running battle after closing the tab). Click — select, double click / Enter — join; a locked room opens the password field under its row. The list refreshes every 3 s while the tab is on screen, "Refresh" — at once.

The panel on the right modelled on MCD (`Lobby.onlineHtml`):
- **server unavailable** — the address and "Check again";
- **not signed in** — a name field and "Sign in";
- **signed in** — "Create online session" with a "Password (optional)" field (~~"Private game"~~ — replaced: rooms are always listed, a password closes them), join by code (a locked one asks for the password), "Friends": add by name, whether online, where they are playing (🔒 — locked), "Join" them, ✕ — remove;
- **in a room** — code (🔒 if locked), seats (host ♛, ready / not ready, no connection; the host has ✕ to remove), room chat, "Leave room", friends; the room's battle runs (came back after closing the tab) — "The battle is on · wave n of N" and "Return to battle", the bottom button says the same.

"Start game" for the host takes the whole room into battle; for a guest the button becomes "Ready" / "Not ready". The host picks the map; for guests it follows the room.

`src/menu/session.ts`: `NET` — the `NetClient` instance (`src/net/client.ts`), `OnlineLobby` — the protocol's `RoomInfo`. The player count goes into battle via `?players=N` → `td.setPlayers`, the room code via `&room=`.

## 5. Tests

`tests/menu.spec.ts`: start → single player → equip the axe by double-click through the inventory → map `td2` → battle (12 waves, treasury 350, axe equipped) → pause → "Exit to camp", the hero's raspberries are intact; multiplayer without a server — "Server unavailable", start disabled (with a server — `tests/net.spec.ts`); a defence victory marks the map completed.

## 6. Language

The interface is bilingual (English, Russian). On the first visit, before the start screen, the menu shows a language picker (`.mm-lang`: logo, the prompt in both languages, two big buttons; ↑ ↓ Enter like the start screen; `window.__menu.screen === 'lang'` while it is shown). The choice is saved with `setLang()` into localStorage `malina.lang` and the page reloads: strings are resolved when modules load (`t()` in `src/i18n/i18n.ts`, dictionary `src/i18n/ru.ts`), so one page load runs in one language. Settings have a "Language" row that saves and reloads the same way; the language is not part of the `Settings` object. A game page opened directly (`?map=…`) without a stored choice follows the browser language; Node and tests get English. Tests set `localStorage['malina.lang'] = 'en'` before the page scripts run, otherwise the picker covers the start screen.
