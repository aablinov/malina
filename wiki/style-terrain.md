# Ground, stone and foliage: the pastel palette of Minecraft Dungeons

Version 1.2 of 2026-10-23. Source — the same 4 screenshots: [sources/mcd-lighting.md](sources/mcd-lighting.md). Light — [style-lighting.md](style-lighting.md). Code — `src/textures.ts` (`softFill`, `GRASS_*`, `DIRT_*`), `src/level/mesher.ts` (`macroTint`), `src/level/palette.ts` (`natural`).

## What the screenshots show

- **Grass is an almost flat fill.** Within one surface the brightness wanders by ±5–8 out of 255, there is no pixel noise. Variety comes in large soft blotches several metres across (lighter and yellower / darker), so no tile repetition is visible from afar — the grass looks "smeared".
- **The path** — a warm orange beige, soft light "footprints" ≈ 0.3 m fairly dense. **The edge is not ruler-straight:** the border with the grass is ragged, in steps of 1–2 pixels with a slight blur, wanders in bays and headlands a metre or two across, on the road — islands of grass, the grass is trampled in places (screenshot `mcd-01-village`).
- **The side of the earth** — a flat brown strip, grass hangs down from above.
- **Shadows are light:** the side of a ledge in shadow is still a warm brown, not black.
- **The colour is pastel:** moderate saturation, no "acid" green.
- **Fence stone** — a flat light bluish grey, the joints are barely visible; **ruins** — slaty blue-turquoise with moss; **floor slabs** — grey, the joint is light.
- **Foliage** — large "leaflets" of 2–3 pixels, olive green, lighter on top.

## How it is done

| What | How |
|---|---|
| Ground textures | `softFill`: a flat colour, grain ±2–3, 3–5 large blotches (circles fading out toward the edge, wrapping across the tile edge) — instead of pixel noise. Grass, grass side, earth, path, sand, gravel, stone, fringe, tufts, tall grass, fern |
| Blotches across the world | `macroTint` in the mesher: two layers of smooth noise (9 m and 3 m), light blotches warmer and yellower, dark ones cooler, ±6 %. Through vertex colour — free in the shader. Blocks with `natural: true` (grass, earth, path, sand, gravel), as well as fringe and tufts — the same tint as the ground under them |
| Ragged road edge | Mesher: grass and path have `bleed` in the palette — 4 masks; the block's top "encroaches" onto the top of a neighbouring natural ground of another kind by 0–8 px (half a metre), the depth wanders smoothly in steps of 2 px, converging toward the tile ends — neighbouring tiles join up; the outermost pixel — a halftone of the two materials, plus islands. The mask is chosen by hash and mirrored. The `detail` layer with `polygonOffset` — no flicker. At the large scale the edge is broken by the map generator: cells at the edge grow over with grass or are trampled into road by smooth noise (3 m) |
| Masonry | `softBricks`: every brick has its own tone ±8 %, the top row slightly lighter, the joint the same colour, darker by 12 % (for ruins 14 %). `softCobble`: rounded stones, lighter top-left. Slabs — 4 large slabs per tile, the joint is light top-left. Moss — `overlayBlobs`, soft blotches, denser on top. All variants of the "ruin" brick are in the slaty palette (with their own mossy one) — no motley |
| Foliage | `softLeaves`: "leaflets" of 2 × 2 from four tones, lighter on top; the cut-out one has holes along the edge. Brightness spread between crown blocks 0.12 (was 0.2) |
| No "checkerboard" | The block-to-block brightness spread of natural ground lowered from 0.08–0.14 to 0.02–0.03, of stone — to 0.03 |
| Light | More sky, less sun (2.0 / 2.2), the bounced light from below is warm `#d8c49a`, exposure 1.02, saturation in colour grading ×1.0 |

## Calibration by pixels

Colours are not by eye: the median of lit areas was taken from the reference, ours — the median of frame pixels (`gl.readPixels` 9 × 9 at a world point), the texture was tuned by the "target / measurement" ratio per channel.

| Surface | Reference | Was | Became |
|---|---|---|---|
| Grass top, in the sun | `#84aa58` (≈ 117–135) | `#64a229`, spread 81–124 | `#81ae51`, spread ±8 |
| Path | `#cba060` | `#826546` | `#cfaa61` |
| Side of a ledge in shadow | warm brown ≈ `#9b6d36` | `#352b1e` | brown, not black |
| Path (median / light footprints) | `#c89c5d` / `#d3a96a` | `#cfaa61`, round dots | `#cc9f5b`…`#cea15e` / `#d2ac6d` |
| Cobblestone top | `#a3a8ad` | grey `#8d8d8d` with noise | `#aeacad` |
| Slabs | `#a6a6a6` | beige-grey with dark joints | `#a1a3a2`…`#acaeac` |
| Ruin slate | `#587578` (in shadow) | lilac `#8b7f93` | `#6b7e82` (in the sun) |
| Foliage in the sun / in shadow | `#789a45` / `#4d7c2f` | dark `#3f7d2c` with black dots | `#7a9948` / `#4c6e2e` |

Base texture colours (before light): grass `#6d994e` / light `#7ba558` / dark `#608b46`, earth `#9a6942` / `#8a5c39`, path `#c99153` with footprints `#d6a466`, sand `#e4d19b`, stone `#a4abb4`; masonry: cobblestone `#88929d`, brick `#86919c`, slate `#6a8592`, slabs `#a0a2a2`, moss `#6f9a4c`; foliage `#486e37` / `#6b8a42` / `#839f52` / `#9cb063`, bushes a tone darker.

## Rules

- A new natural surface — through `softFill`, without `noiseFill` with a large spread.
- Detail — in large blotches and in shape (fringe, tufts, decor), not in pixel ripple.
- Do not raise saturation in colour grading — the pastel holds on the textures and the soft light.

## Next

- Wood (boards, logs, crates) and the house (plaster, brown brick) are still in the old palette.
