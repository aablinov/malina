# Map 1: the drawn plan of the island

Files: `map-01/map.webp` — the map drawing (an island with mountains, a pyramid temple, a fort, a village of huts, a river with waterfalls, ships), `map-01/plan.png` — the same picture with markup, `map-01/plan.html` — the markup source (SVG over the picture, rendered in Chrome).

**What is on the markup:** 7 biomes (snow — the Grey Mountains, jungle with crystals — the temple, palm groves, the cliffs and ruins of the West Hill, a meadow with a golden grove, hot springs, the fort and the village), roads, 14 enemy groups in path order, 7 ambushes, 5 patrols, the boss on the pyramid, Soller by the statue, 4 bridges between the islands (B1–B4), 4 river crossings (M1–M4), 13 chests and a scattering of crates. Scale: the whole picture is 256 × 256 m, 1 m ≈ 7.5 px.

**What was taken:** everything — the map generator `src/level/island-map.ts` is written in the pixels of this picture ([design-map-island.md](../design-map-island.md)). Not done: ships (no preset), waterfalls into the sea, the crocodile and background animals.
