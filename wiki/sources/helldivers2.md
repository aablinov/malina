# Source: Helldivers 2 (notes on the mission loop)

Added 2026-11-10. Notes on how Helldivers 2 (Arrowhead, 2024) builds a session, written from play knowledge for the "Expeditions" mode ([../design-expeditions.md](../design-expeditions.md), [../adr-006-expeditions.md](../adr-006-expeditions.md)). No screenshots. The source is not edited.

## What is there

| Layer | How it works | What it gives the player |
|---|---|---|
| Loop | ship → war map → operation of 1–3 missions → loadout → pick a landing point → objectives → extraction → results | a 15–40 min session with a clear start and end |
| Mission map | large and procedural; a primary objective in several steps, secondary objectives, enemy outposts in three sizes, points of interest with loot | the squad chooses the route and how much to risk |
| Victory | the mission counts once the primary objective is done; extraction is optional, but only extraction carries the samples out | a constant choice: leave now or grab more |
| Stratagems | 4 slots of called-in support on cooldowns: strikes, sentries, supplies, heavy weapons | the build is picked before the mission, power arrives in bursts |
| Alarm | patrols roam the map; an enemy that spots the squad calls reinforcements unless killed in time | you can go around, you can clear quietly, a mistake grows into a big fight |
| Death | a shared pool of reinforcements; a teammate calls the fallen back in; samples drop where the carrier died | death costs tempo, not the run, and is a reason to go back for the loot |
| Timer | 40 minutes, then support is cut off and the shuttle arrives | pressure without an instant loss |
| Difficulty | 10 steps unlocked one at a time; higher steps add enemy kinds and rarer samples | a mastery ladder for dozens of hours |
| Modifiers | operation effects and planet weather: fog, fire tornadoes, longer cooldowns | the same objective plays differently |
| Currencies | requisition (stratagems), samples of three rarities (ship modules), medals (warbonds that never expire) | every activity has its own reward, nothing is lost by waiting |
| Meta | a shared war, weekly orders, a personal daily order | a reason to log in today and a sense of a common cause |

## Conclusions

1. Interest rests on **decisions inside the mission** — route, noise or stealth, when to leave — more than on the amount of content.
2. **Extraction is a stake:** everything found can be lost in the last minute.
3. **Chaos from your own power:** called-in support is strong and imprecise, so every mission produces a story.
4. **Nothing expires:** progress has no deadlines and there is no fear of missing out.

## What we take

| Technique | Where | Status |
|---|---|---|
| Operation of 2–3 missions, mission board, landing point choice | [../design-expeditions.md](../design-expeditions.md), sections 1–2 | planned |
| Primary and secondary objectives, lairs, points of interest on a seeded map | sections 3–4 | planned |
| Called-in support as "parcels from the camp", towers as portable sentries | section 5 | planned |
| Patrols, a caller enemy, an alarm meter; dusk instead of a hard timer | section 6 | planned |
| Shared reinforcements, revive by a teammate | section 7 | planned |
| Samples carried out only by extraction — seeds of three rarities | section 8 | planned |
| Modifiers, difficulty ladder, daily order, permanent upgrades | sections 9–10 | planned |
| ~~Friendly fire~~ | — | not taken: the game is a kind adventure for ages 10–14 |
| ~~Shared war map for the whole server~~ | — | not taken for now: operations live in the room |
