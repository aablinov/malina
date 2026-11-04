# Source: eight castle references (siege, Bush Defence 3)

Added 2026-10-31. Eight pictures from the "castle siege" task brief ([../design-tower-defence.md](../design-tower-defence.md), section 9): five pieces of castle art and three screenshots from *The Lord of the Rings: The Battle for Middle-earth* — the wall mechanics. The castle in the game stands **on a meadow, not on an island**: the pictures are only about the look of the castle and the mechanics. Files — `castle-refs/`. The source is not edited.

| | |
|---|---|
| ![Island fort, map](castle-refs/castle-01-island-fort-map.webp) | ![City on a cliff](castle-refs/castle-02-cliff-city.webp) |
| **1. Island fort** (top-down map, Morvold Press). | **2. Fortress city on a cliff.** |
| ![Manor by a lake](castle-refs/castle-03-lake-manor.webp) | ![Castle with red roofs](castle-refs/castle-04-red-roofs.webp) |
| **3. Manor by a lake** (Ghibli style). | **4. Castle with red roofs** (Fran Hao Shuang). |
| ![Citadel on the water](castle-refs/castle-05-water-citadel.webp) | ![BFME: plots on the wall](castle-refs/castle-06-bfme-wall-plots.png) |
| **5. Citadel on the water.** | **6. BFME: ring wall, plots for buildings.** |
| ![BFME: courtyard](castle-refs/castle-07-bfme-courtyard.png) | ![BFME: breach](castle-refs/castle-08-bfme-wall-breach.png) |
| **7. BFME: fortress courtyard.** | **8. BFME: a breach in the wall.** |

## What is visible

**1. Island fort** — top-down view: a ring of walls with round towers at the corners, a gate with a pier, inside a courtyard with a well in the centre and buildings along the perimeter by the walls, crenellations along the outer face. **2, 5** — multi-tiered fortresses: crenellated walls, bastion towers, bridge-roads to the gates. **3** — a light house with a blue roof and a round tower in greenery by the water: daylight, cypresses, flowers. **4** — a castle with red roofs on a cliff above a meadow, a marsh and boardwalks in front.

**6–8 (BFME)** — the mechanics we reproduce: a round wall with **plots for buildings** inside and on the wall (6, 7), a courtyard with buildings around the centre (7), **a breach in the wall** from siege engines through which enemies run (8).

## What we take

| What | Where |
|---|---|
| A square of walls with bastions at the corners, a gate between two towers, a courtyard with a well, pads by the walls (1, 6, 7) | the `td3` map — `src/level/td-castle-map.ts` |
| Crenellations along the outer face, a walkway on top, stairs onto the wall (1, 2, 5) | walls of `bricks`, top of `tiles`, `bricks_stairs` steps |
| Daylight, a meadow, groves and flowers around (3, 4) | `meta.world`, meadow decor |
| A breach in the wall, enemies run inside, the wall is repaired (8) | `src/td/wall.ts`, `TowerDefense.breach`, F — repair |
| Buildings on the wall and inside — towers on pads (6, 7) | `TdPad.y`, bastions |
