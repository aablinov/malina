# Malina

**English** · [Русский](#малина)

A cosy co-op action game in the spirit of **Minecraft Dungeons** crossed with **tower defence**, playable **over the network** with friends and family. Isometric camera, swords, axes, bows and magic, a kind blocky voxel look — and a raspberry bush in the middle of the map that the whole party has to keep alive.

*Malina* (малина) is Russian for *raspberry*: raspberries are the in-game currency, and the bush you defend is the heart of the game.

## Why this game exists

Malina was made for fun — to play with kids, nephews and nieces on a couple of laptops in the same room, or over the internet. It is not a product. It is a toy that keeps growing, and you are welcome to make it yours:

- **Change anything.** Towers, enemies, maps, balance, the hero, the look — everything is TypeScript and JSON, and all the tuning numbers are in one place (`src/tuning.ts`, `src/td/`).
- **It ships with its own wiki.** The `wiki/` folder is a living design document in the "LLM wiki" style: decisions (ADRs), design pages for every system, visual style guides, performance notes and a journal of every change. Start at [wiki/index.md](wiki/index.md).
- **It is ready for AI agents.** `AGENTS.md` / `CLAUDE.md` tell a coding agent how to run, test and extend the project, and the wiki gives it the context. Open the repo in Claude Code, Cursor or any agent you like, describe the enemy, tower or map you want — and play it ten minutes later.

## What you get

- **Dungeon crawling the Minecraft Dungeons way** — click to walk around walls, click an enemy to close in and strike (three-hit combo with a shockwave), dodge roll, bow, 14 weapon kinds with their own weapon arts, enchantments, artifacts, spells and auras, potions, chests, barrels and loot fountains.
- **Bush Defence** — the tower defence mode. Enemy waves march along roads from their lairs towards the raspberry bush; you build towers on pads (archer tower, frost spire, catapult, fire brazier, arcane obelisk, wall ballista, tar cauldron, stargazer, storm spire, heart of winter), upgrade and sell them, repair what the gnawer beavers chew up, and fight in between with your own sword. Three maps: a **lava map**, the **Crystal Glade** and a **castle siege** with walls and gates that break and get repaired. Mini-bosses every third wave, a sutler who sells gear for the battle, hints designed for kids (raspberry magnet, next-wave card, "tower in trouble" alarm).
- **Network play** — a small Node server with a server-authoritative battle modelled on Quake 3: the server runs the simulation, clients predict their own hero; rooms with a code, readiness, chat, friends, late joiners, battle history with rewards. Waves scale with the number of players.
- **A big hand-made island** (256 × 256 m, seven biomes, a fort, a temple with a golem arena, a village with a blacksmith and a merchant), procedural dungeon floors from room templates, and a **level editor** in the spirit of Unreal Engine with a preset library of 179 ready-made pieces of world.
- **Everything is code.** Textures are drawn by code, sounds and music are synthesised with Web Audio, block and decor shapes are generated into OBJ. No asset pipeline, no engine — TypeScript, three.js and Vite.

## Quick start

Requirements: Node (the version is pinned in `mise.toml`; the project uses [mise](https://mise.jdx.dev/) to run it) and a modern browser (Chrome, Safari, Firefox).

```bash
npm install
make play        # builds the game and starts one server that also serves it
```

Open http://localhost:8787 — the main menu lets you play solo or create a network room. On the first visit the game asks for the interface language (English or Russian); change it later in Settings — the choice is kept in the browser. For development, `make dev` runs the game server (port 8787) and the Vite dev client (port 5173) together.

Playing over the network: run the server somewhere reachable (`PORT`, `HOST`, `DB_PATH`, `STATIC=dist` to serve the game too), open the game with `?server=http://your-host:8787`, create a room and share the code. The server keeps profiles, rooms and battle history in SQLite.

More scripts (`npm run …`): `typecheck`, `build`, `test:net` (server, network and simulation tests without a browser), `map:td` / `map:td2` / `map:td3` / `map:island` / `map:playground` / `map:rooms` (regenerate maps from their generators), `prefabs`, `blocks`, `decor`. `make check` runs types and the fast tests.

## How to play

- **LMB on the ground** — walk there (pathfinding around walls, up stairs, through shallow water); **LMB on an enemy** — close in and strike, hold for the three-hit combo; **Shift + LMB** — strike in place.
- **WASD** — walk by keys, **Space** — dodge roll, **RMB** — bow, **Q** — weapon art, **1 / 2 / 3** — artifacts, **E** — potion, **F** — use / talk / build / repair, **I** — inventory, **M** / **Tab** — map, **G** — call the next wave early (bonus), **Esc** — pause.
- Bush Defence: walk up to a pad and press **F** (or click it) to open the tower menu; number keys pick a tower, the same menu upgrades to level III or sells for 70 %. Keep the bush alive through all waves.

Developer keys (**F1**–**F10**: tuning panel, colliders, telemetry, god mode, slow motion, FPS, editor and more) and the full editor manual are in the wiki: [design-editor.md](wiki/design-editor.md), [design-inventory.md](wiki/design-inventory.md), [design-tower-defence.md](wiki/design-tower-defence.md).

Useful URLs: `?map=td` / `td2` / `td3` (defence maps), `?map=island`, `?map=prefabs` (preset showcase), `?map=dungeon&seed=42&floor=2`, `?dev=playground` (test arena), `?dev=editor` (level editor).

## Where things are

| Folder | What is inside |
|---|---|
| `src/sim/`, `src/game/` | Deterministic battle simulation and match logic — no DOM, runs in the browser and in Node |
| `src/cgame/` | Client side of the battle: event queue, input, prediction, views from snapshots, defence menu and HUD |
| `src/net/`, `server/` | Protocol, transports, delta-snapshot codec; the Node server (rooms, profiles, matches, SQLite) |
| `src/td/` | Bush Defence: towers, waves, walls and gates, lairs, scaling |
| `src/mobs/`, `src/bosses/` | Enemies of the Order, critters, mini-bosses and bosses |
| `src/level/`, `src/world/` | Voxel levels: blocks, palette, mesher, collisions, pathfinding, map generators, preset library, streaming |
| `src/knight.ts`, `src/gear.ts`, `src/items.ts`, `src/weapons.ts`, `src/magic/` | Hero, gear, items and enchantments, weapons, spells |
| `src/menu/`, `src/hud/` | Main menu, camp lobby, HUD, inventory, shop, automap |
| `src/dev/` | Playground and the level editor |
| `assets/` | Maps (JSON), block and decor shapes (OBJ), presets |
| `tests/`, `server/test/` | Playwright end-to-end tests and fast Node tests |
| `wiki/` | The design wiki — start at [wiki/index.md](wiki/index.md) |

Architecture overview: [wiki/arch-layers.md](wiki/arch-layers.md). Project brief and current state: [wiki/project-brief.md](wiki/project-brief.md).

## License

MIT — see [LICENSE](LICENSE). Take it, change it, play it.

## Tests

```bash
mise exec -- npm run build
PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" mise exec -- npx playwright test
```

End-to-end tests run on an installed Google Chrome (no `playwright install`, see [wiki/dev-testing.md](wiki/dev-testing.md)); `npm run test:net` runs the server and simulation tests in seconds.

---

# Малина

[English](#malina) · **Русский**

Уютная кооперативная игра в духе **Minecraft Dungeons**, скрещённая с **tower defence**, в которую можно играть **по сети** с друзьями и семьёй. Изометрическая камера, мечи, топоры, луки и магия, добрый блочный воксельный стиль — и куст малины посреди карты, который всей компанией надо уберечь.

Малина — валюта игры, а куст малины — её сердце.

## Зачем эта игра

Малина сделана для развлечения — чтобы играть с детьми и племянниками на паре ноутбуков в одной комнате или через интернет. Это не продукт, а игрушка, которая всё время растёт, и вы можете менять её по своему усмотрению:

- **Меняйте что угодно.** Башни, враги, карты, баланс, герой, внешний вид — всё это TypeScript и JSON, а настраиваемые числа собраны в одном месте (`src/tuning.ts`, `src/td/`).
- **Игра распространяется вместе с вики.** Папка `wiki/` — живой дизайн-документ по схеме «LLM-вики»: решения (ADR), страницы по каждой системе, гайды по стилю, заметки о производительности и журнал всех изменений. Начинать с [wiki/index.md](wiki/index.md).
- **Готова для ИИ.** `AGENTS.md` / `CLAUDE.md` объясняют агенту, как запускать, тестировать и расширять проект, а вики даёт ему контекст. Откройте репозиторий в Claude Code, Cursor или любом другом агенте, опишите врага, башню или карту, которых вам не хватает, — и играйте через десять минут.

## Что внутри

- **Зачистка подземелий как в Minecraft Dungeons** — клик по земле ведёт в обход стен, клик по врагу — подойти и ударить (комбо из трёх ударов с ударной волной), перекат, лук, 14 видов оружия со своими спец-ударами, зачарования, артефакты, заклинания и ауры, зелья, сундуки, бочки и фонтаны добычи.
- **Оборона куста** — режим tower defence. Волны врагов идут по дорогам от своих логов к кусту малины; вы строите башни на площадках (стрелковая вышка, морозный шпиль, катапульта, огненная жаровня, волшебный обелиск, стенная баллиста, котёл со смолой, звездочёт, грозовой шпиль, сердце зимы), улучшаете и продаёте их, чините то, что сгрызли бобры, и сами дерётесь мечом между волнами. Три карты: **лавовая**, **Кристальная поляна** и **осада замка** со стенами и воротами, которые ломают и чинят. Мини-боссы каждую третью волну, маркитант с лавкой на бой, подсказки для детей (магнит малины, карточка следующей волны, сигнал «башня в беде»).
- **Сетевая игра** — небольшой сервер на Node с серверно-авторитарным боем по образцу Quake 3: сервер считает симуляцию, клиенты предсказывают своего героя; комнаты с кодом, готовность, чат, друзья, опоздавшие, история боёв с наградами. Волны масштабируются по числу игроков.
- **Большой рукотворный остров** (256 × 256 м, семь биомов, форт, храм с ареной голема, деревня с кузнецом и торговцем), процедурные этажи подземелья из комнат-заготовок и **редактор уровней** в духе Unreal Engine с библиотекой из 179 готовых кусков мира.
- **Всё — код.** Текстуры рисуются кодом, звуки и музыка синтезируются через Web Audio, формы блоков и декора генерируются в OBJ. Ни пайплайна ассетов, ни движка — TypeScript, three.js и Vite.

## Быстрый старт

Нужны Node (версия закреплена в `mise.toml`; проект запускает его через [mise](https://mise.jdx.dev/)) и современный браузер (Chrome, Safari, Firefox).

```bash
npm install
make play        # собирает игру и поднимает один сервер, который её же и отдаёт
```

Откройте http://localhost:8787 — в главном меню можно играть одному или создать сетевую комнату. При первом входе игра спросит язык интерфейса (русский или английский); потом его можно сменить в настройках — выбор хранится в браузере. Для разработки `make dev` поднимает вместе игровой сервер (порт 8787) и клиент Vite (порт 5173).

Игра по сети: запустите сервер там, куда дотянутся друзья (`PORT`, `HOST`, `DB_PATH`, `STATIC=dist`, чтобы он отдавал и игру), откройте игру с `?server=http://ваш-хост:8787`, создайте комнату и поделитесь кодом. Профили, комнаты и историю боёв сервер хранит в SQLite.

Прочие скрипты (`npm run …`): `typecheck`, `build`, `test:net` (тесты сервера, сети и симуляции без браузера), `map:td` / `map:td2` / `map:td3` / `map:island` / `map:playground` / `map:rooms` (пересобрать карты из генераторов), `prefabs`, `blocks`, `decor`. `make check` — типы и быстрые тесты.

## Как играть

- **ЛКМ по земле** — идти туда (путь в обход стен, по ступеням, вброд через воду); **ЛКМ по врагу** — подойти и ударить, держать — комбо из трёх; **Shift + ЛКМ** — бить на месте.
- **WASD** — ходьба клавишами, **Space** — перекат, **ПКМ** — лук, **Q** — спец-удар оружия, **1 / 2 / 3** — артефакты, **E** — зелье, **F** — использовать / говорить / строить / чинить, **I** — инвентарь, **M** / **Tab** — карта, **G** — позвать следующую волну раньше срока (бонус), **Esc** — пауза.
- Оборона куста: подойдите к площадке и нажмите **F** (или кликните по ней) — откроется меню башен; цифры выбирают башню, то же меню улучшает до III уровня или продаёт за 70 %. Уберегите куст до конца всех волн.

Клавиши разработчика (**F1**–**F10**: панель параметров, коллайдеры, телеметрия, бессмертие, замедление, FPS, редактор и прочее) и полное руководство по редактору — в вики: [design-editor.md](wiki/design-editor.md), [design-inventory.md](wiki/design-inventory.md), [design-tower-defence.md](wiki/design-tower-defence.md).

Полезные адреса: `?map=td` / `td2` / `td3` (карты обороны), `?map=island`, `?map=prefabs` (витрина пресетов), `?map=dungeon&seed=42&floor=2`, `?dev=playground` (тестовая арена), `?dev=editor` (редактор уровней).

## Где что лежит

| Папка | Что внутри |
|---|---|
| `src/sim/`, `src/game/` | Детерминированная симуляция боя и логика матча — без DOM, работает в браузере и в Node |
| `src/cgame/` | Клиентская часть боя: очередь событий, ввод, предсказание, виды по снимкам, меню обороны и HUD |
| `src/net/`, `server/` | Протокол, транспорты, кодек дельта-снимков; сервер на Node (комнаты, профили, матчи, SQLite) |
| `src/td/` | Оборона куста: башни, волны, стены и ворота, логова, масштаб |
| `src/mobs/`, `src/bosses/` | Враги Ордена, зверьё, мини-боссы и боссы |
| `src/level/`, `src/world/` | Воксельные уровни: блоки, палитра, мешер, столкновения, поиск пути, генераторы карт, библиотека пресетов, стриминг |
| `src/knight.ts`, `src/gear.ts`, `src/items.ts`, `src/weapons.ts`, `src/magic/` | Герой, снаряжение, предметы и зачарования, оружие, заклинания |
| `src/menu/`, `src/hud/` | Главное меню, лагерь, HUD, инвентарь, лавка, карта |
| `src/dev/` | Плейграунд и редактор уровней |
| `assets/` | Карты (JSON), формы блоков и декора (OBJ), пресеты |
| `tests/`, `server/test/` | Сквозные тесты Playwright и быстрые тесты Node |
| `wiki/` | Дизайн-вики — начинать с [wiki/index.md](wiki/index.md) |

Обзор архитектуры: [wiki/arch-layers.md](wiki/arch-layers.md). Бриф проекта и текущее состояние: [wiki/project-brief.md](wiki/project-brief.md).

## Лицензия

MIT — см. [LICENSE](LICENSE). Берите, меняйте, играйте.

## Тесты

```bash
mise exec -- npm run build
PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" mise exec -- npx playwright test
```

Сквозные тесты идут на установленном Google Chrome (без `playwright install`, см. [wiki/dev-testing.md](wiki/dev-testing.md)); `npm run test:net` прогоняет тесты сервера и симуляции за секунды.
