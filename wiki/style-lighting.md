# Unreal-style lighting: the inspiration layer

Version 1.5 of 2026-10-24. Ground palette — [style-terrain.md](style-terrain.md). Complements [style-guide.md](style-guide.md) (the "Colour and light" section). Source — [sources/mcd-lighting.md](sources/mcd-lighting.md): 4 screenshots of Minecraft Dungeons (Unreal Engine 4). Code — `src/lighting.ts`, class `Lighting`; in the playground **U** toggles Unreal-style ↔ simple light, **B** — post-processing as a whole, **L** — day and night.

## Why the picture looks "Unreal"

All games on Unreal share a recognisable default set: filmic tonemapping, soft shadows with a coloured sky fill, shading in crevices, bloom, haze, colour grading and — in Minecraft Dungeons especially — a shallow depth of field, which makes the world look like a toy diorama (we do not reproduce it yet — expensive, see layer 8). Each technique on its own is unnoticeable, together — "that" light.

## Layers in order

| # | Layer | Ours | Settings (day) |
|---|---|---|---|
| 1 | **Sun** | `DirectionalLight` warm `#ffdcae`, low and from the side (`sunOffset` −20, 26, 12) — long shadows to the right and down, as in the screenshots; PCF soft shadows 2048² around the hero | 2.2 |
| 2 | **Sky** | `HemisphereLight` blue from above, warm sandy from below (bounced light) — shadows are light and bluish, the sides of blocks in shadow stay brown, not black, as in Minecraft Dungeons | `#bfe4ff` / `#d8c49a`, 2.0 |
| 3 | **AO** | `GTAOPass` (radius 0.55 m, 12 samples, blend 0.85). Cut-out, transparent and self-lit meshes, as well as sprites (flashes) and points, do not enter the normal pass (`SolidAOPass`) — otherwise grass planes give blotches and spell flashes give black squares. Blocks are already vertex-shaded, AO adds crevices at decor, items and the hero's feet | |
| 4 | **Bloom** | `UnrealBloomPass`: fire, magic, glowing mushrooms, lantern glass (the `glow` layer) | 0.42 (night 0.75) |
| 5 | **Tonemapping** | ACES, exposure 1.02 | |
| 6 | **Colour grading** | after tonemapping: shadows → turquoise (−0.02, +0.012, +0.045), highlights slightly warmer (+0.02, +0.012, −0.004), saturation ×1.0 and contrast ×0.98 — pastel, as in the reference, vignette 0.12 (barely noticeable) | |
| 7 | **Haze** | `Fog` from the camera: starts behind the hero (0.9 × the camera distance), thickens into the distance (4.2 ×) toward a light blue `#d6ecf4` — the far part brightens, like the air in the screenshots | |
| ~~8~~ | ~~**Tilt-shift**~~ | **Removed on 2026-10-23:** two full-screen Gaussian passes at full resolution (at DPR 2 — 2048 × 1536) noticeably ate frames. If brought back — only on a downscaled copy of the frame and with depth-based blur | |

Night: a lunar blue light 0.6, sky `#5f8ed6`, haze `#1b3c5c`, shadows go deeper into blue; torches, mushrooms, lanterns and fireflies shine (the 8 nearest sources — real `PointLight`s).

## The map's world settings

Since 2026-10-24 the day is set by the map: `meta.world` (`src/world.ts`) — sun, sky and global light, haze, weather, post-processing; edited in the editor ("World settings", presets in "Environment", [design-editor.md](design-editor.md)). `Lighting.applyWorld` replaces the day set, night (L) keeps its own. Without `meta.world` everything is as described above. Haze in the settings — in metres for the game camera (24 m to the hero), in the editor it scales with the camera distance. Weather — `src/weather.ts`.

## Frame cost

Measured by GPU time (`EXT_disjoint_timer_query_webgl2`), playground, retina 2048 × 1536:

| What | ms per frame |
|---|---|
| without post-processing (straight to screen, with MSAA) | 7.8 |
| was: DPR 2 buffer, AO at full resolution | 37 |
| of which AO | ≈ 15 |
| bloom, colour grading | < 0.5 |
| **became: buffer no denser than DPR 1.5, AO at half the buffer** | **12.5** |
| the same with 4× MSAA on the buffer (not taken) | 35.6 |
| **now: buffer no denser than DPR 1.25** (1280 × 960 on 2048 × 1536) | **10.0** — same as without post-processing (10.3 in the same measurement) |

The main cost is the full-screen HDR buffer on retina and AO at full resolution (it draws the scene once more for the normals). Hence `POST_MAX_DPR = 1.25` (was 1.5 — lowered for frame headroom) and `SolidAOPass.setSize` halves the size; AO is soft, there is no visible difference, pixel textures stay crisp.

## Rules

- **Shadows are coloured, not black.** If the texture is not visible in shadow — there is too little sky, not too much sun.
- **Haze is light and blue.** Grey "dirty" fog is still not used (style-guide: "fog and dirty filters — no" refined: atmospheric haze in the distance — yes).
- **Few things glow.** The `glow` layer and fire — only for real light sources and magic.
- **The vignette is barely noticeable** (0.12), no film grain and no chromatic aberration.

## What next

- A stronger torch glow on neighbouring blocks (currently 8 sources per scene; in the dungeon there are more — baked "light in vertices" is needed for distant torches).
- Grass fringe along ledge edges and a dense scatter of small grass — from the same source, that is already decor.
- A cheap tilt-shift replacement: blur at a quarter of the resolution and blending by depth — if the "diorama" is needed again.
