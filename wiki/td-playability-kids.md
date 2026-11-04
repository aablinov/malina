# Bush Defence through the eyes of a 10–14-year-old

Version 1.0 of 2026-11-01. A playtest-based review of the mechanics of the [design-tower-defence.md](design-tower-defence.md) mode: where a child finds it hard or boring, what the best games of the genre do, and what we take from that. Three proposals from the top are already done (section 4); the rest is a backlog with estimates.

## 1. Who it is for and what we want

The player is 10–14 years old: reads quickly but dislikes long text; prefers **a hero in the thick of battle** over menus; takes a loss hard but gladly tries again if it is clear what went wrong. The tone is a friendly adventure, not Dark Souls. From this, three rules:

1. **Visible means understandable.** Danger is shown on screen (marker, colour, sound), not hidden in numbers.
2. **One decision at a time.** "Tower or sword", "repair or build" — yes; tables and fine-grained economy — no.
3. **A mistake never punishes forever.** What is broken can be repaired, what was missed comes back, a loss has a clear reason.

## 2. What exists and where the friction is

| Mechanic | What works | Where a child hits friction |
|---|---|---|
| Pads and towers for raspberries | Simple menu 1–5, price visible, upgrade and sell | Range not visible before building; unclear which tower counters whom |
| Waves along the roads | Lairs raise the alarm, wave banner, G — call early for a bonus | Who is coming — only the wave name; hunters and mini-bosses are a surprise |
| Raspberries from the fallen — in piles | Juicy, streak sound | Chasing every pile in the middle of a fight — the child chooses between fighting and gathering, and raspberries are wasted |
| Tower hunters (new) | The hero has work besides building | A tower gets gnawed off-screen — the player finds out when it is already ruins |
| Mini-bosses (new) | An event every three waves | No warning — unclear what to prepare for |
| Sutler (new) | The "tower or sword" choice | A child has to compare prices and weapon power; the ▲ / ▼ arrow in the shop helps |
| Defeat | N — restart, fast | The whole map from wave one: on wave 9 that is 15 minutes of progress |
| Roads and walls (td2) | Pretty | The walls boxed in the pads — unreachable (fixed) |

## 3. Best practices of the genre

- **Kingdom Rush** — wave preview (enemy icons at the entrance), early call for a reward (we have it), hero on the field, stars per map.
- **Bloons TD** — range circle while building, explicit "counters" (ice against fast ones), endless wave retries.
- **Plants vs. Zombies** — roles clear at first glance, new enemies introduced one at a time with a hint, auto-collecting sun near the cursor.
- **Dungeon Defenders / Orcs Must Die** — hero and traps together, a shop between waves, a "core under attack" signal with an arrow.
- **Common to kids' TD** — resources are collected automatically or in one click, threats are readable by colour (ice — blue, fire — orange), a loss rolls back one wave, not to the start.

## 4. Proposals: value and cost

Value — for children aged 10–14; cost — work in code. Those marked ✅ are done.

| # | Proposal | Value | Cost | Status |
|---|---|---|---|---|
| 1 | **Raspberry magnet**: pulls from 6 m (was 2.4), after a repelled wave all raspberries fly to the hero | high | low | ✅ |
| 2 | **Next-wave card**: who and how many, hunters (⚠ gnawer, ❄ warlock) and ♛ mini-boss in colour | high | low | ✅ |
| 3 | **"Tower in trouble" signal**: a blinking line with an arrow and distance, a marker on the map, a short sound if the tower is far away | high | medium | ✅ |
| 4 | Tower range circle when hovering a card in the pad menu | high | low | backlog |
| 5 | Retry the wave instead of the whole map: "The bush withered — try wave N again" with towers as at the start of the wave | high | medium | backlog |
| 6 | "Counter" hint in the pad menu: "against moths — spire", "against warlocks — spire, it does not freeze" | medium | low | backlog |
| 7 | First appearance of a new enemy — a card with a picture and one line "how to beat it" (as in PvZ) | medium | medium | backlog |
| 8 | Easy mode in settings: bush ×1.5, raspberries ×1.3, pause while the pad menu is open | medium | low | backlog |
| 9 | Stars per map (bush intact at 100/60/30 %) and a mark in the camp | medium | low | backlog |
| 10 | Build pause: time slows to ×0.3 while the pad menu is open | medium | low | backlog |

Why these three first: they are **cheap and remove the main friction** — the child stops being torn between fighting and gathering, knows in advance what is coming, and learns about a tower in trouble in time. The new mechanics (hunters, mini-bosses) would have read as unfair without 2 and 3.

## 5. How it is done (top 3)

- **Magnet** — `Props.berryReach` (6 m on defence maps), `Props.harvest()` — for 4 s all raspberries on the ground fly to the hero; called from `TowerDefense` when a wave is repelled (`TdHooks.harvest`).
- **Wave card** — `TowerDefense.wavePreview()` in the defence HUD while no wave is running: kinds and count (accounting for players), hunters in blue, mini-boss in raspberry.
- **Tower in trouble** — `Tower.onAlarm` (wounded, frozen, destroyed) → `TowerDefense.alarms`: a `.td-alarm` line with an arrow in the camera's screen direction and the distance, a marker on the minimap (`alarmMarkers`), a double beep no more than once per 2 s if the tower is farther than 8 m. The signal clears itself: after 4 s (ruins — 8 s), when the ice has melted or the ruins are repaired.
- Test — `tests/td-help.spec.ts`.
