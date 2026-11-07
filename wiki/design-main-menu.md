# Main menu

Version 1.4 of 2026-11-07: shop and blacksmith in the camp, the battle on a copy of the profile instead of the stash (section 3). Version 1.3 of 2026-11-05: language picker on the first visit and a Language row in Settings (section 6). Version 1.2 of 2026-11-03: friends and room chat in the camp, joining a running battle (section 4). Version 1.1 of 2026-11-02: multiplayer — the camp panel works with the server (section 4, [design-multiplayer.md](design-multiplayer.md)). Version 1.0 of 2026-10-31: start screen, camp (gear and Bush Defence map selection), settings, pause and battle result, multiplayer stubs. The model is the Minecraft Dungeons menu (hero screen with gear slots, tabs on top, online lobby by the campfire). Inventory — [design-inventory.md](design-inventory.md), maps — [design-tower-defence.md](design-tower-defence.md).

## 1. Routing

- A page without parameters — the **menu** (`src/menu/menu.ts`, `runMenu`).
- `?map=…` or `?dev=playground` — straight into the game, as before (`wantsGame` in `src/devflag.ts`); `?dev=editor` — the editor. All tests bypass the menu via `?dev=playground`.
- "Start game" reloads the page to `?map=td2&from=menu` (`battleUrl`, `src/menu/session.ts`): WebGL and the menu scene do not live alongside the battle, but the profile is shared — localStorage `malina.profile`, what is equipped in the camp is picked up in battle.
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

The same camp, opened straight on the "Map" tab, with a panel on the right modelled on MCD (`Lobby.onlineHtml`):
- **server unavailable** — the address and "Check again";
- **not signed in** — a name field and "Sign in";
- **signed in** — "Create online session", "Private game", join by code, "Sessions" with "Refresh" (rooms in battle are marked "in battle", joining is allowed), "Friends": add by name, whether online, where they are playing, "Join" them, ✕ — remove;
- **in a room** — code, seats (host ♛, ready / not ready, no connection; the host has ✕ to remove), room chat, "Leave room", friends.

"Start game" for the host takes the whole room into battle; for a guest the button becomes "Ready" / "Not ready". The host picks the map; for guests it follows the room.

`src/menu/session.ts`: `NET` — the `NetClient` instance (`src/net/client.ts`), `OnlineLobby` — the protocol's `RoomInfo`. The player count goes into battle via `?players=N` → `td.setPlayers`, the room code via `&room=`.

## 5. Tests

`tests/menu.spec.ts`: start → single player → equip the axe by double-click through the inventory → map `td2` → battle (12 waves, treasury 350, axe equipped) → pause → "Exit to camp", the hero's raspberries are intact; multiplayer without a server — "Server unavailable", start disabled (with a server — `tests/net.spec.ts`); a defence victory marks the map completed.

## 6. Language

The interface is bilingual (English, Russian). On the first visit, before the start screen, the menu shows a language picker (`.mm-lang`: logo, the prompt in both languages, two big buttons; ↑ ↓ Enter like the start screen; `window.__menu.screen === 'lang'` while it is shown). The choice is saved with `setLang()` into localStorage `malina.lang` and the page reloads: strings are resolved when modules load (`t()` in `src/i18n/i18n.ts`, dictionary `src/i18n/ru.ts`), so one page load runs in one language. Settings have a "Language" row that saves and reloads the same way; the language is not part of the `Settings` object. A game page opened directly (`?map=…`) without a stored choice follows the browser language; Node and tests get English. Tests set `localStorage['malina.lang'] = 'en'` before the page scripts run, otherwise the picker covers the start screen.
