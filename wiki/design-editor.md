# Unreal Engine-style level editor

Version 1.1 of 2026-10-29. Replaces the editor description in [design-level-blocks.md](design-level-blocks.md) (section 9) and complements [design-level-decor.md](design-level-decor.md) (section 6), [style-world.md](style-world.md) (terrain), [style-lighting.md](style-lighting.md) (world settings). How to test — [dev-testing.md](dev-testing.md).

Open: `?dev=editor` (or F10 in the playground). Code — `src/dev/editor.ts` and `src/dev/editor/`.

## 1. Window

The layout is as in Unreal Engine 5; panels are resized with splitters:

| Where | What |
|---|---|
| Top | Menu bar (File, Edit, View, Window, Help), map name; toolbar — mode, gizmo (select / move / rotate / scale), snapping to grid and angle, undo, "Prefab", "Environment" (lighting sets and weather), "Weapons", "Play" |
| Left | **Prefabs** (`editor/prefabs.ts`) — tabs "All / Blocks / Decor / Kits / Light / Service / My prefabs", search, 3D previews (drawn gradually in a separate renderer). Click selects, drag places into the viewport. Above the list — the tools of the current mode (sliders for terrain) |
| Centre | Document tabs: the level and **Weapons**. The level — viewports (`editor/viewports.ts`) |
| Right | **Outliner** (`editor/outliner.ts`) and **Details / World settings** (`editor/ui.ts`, `PropGrid`) |
| Bottom | Status bar: prefabs, log, cell under the cursor, FPS |

## 2. Viewports

- One, two or four views: perspective, top, front, right (any view can be changed in its menu; also bottom, back, left). A single canvas — each view is drawn into its own rectangle (`setViewport` + `setScissor`). Alt+X — maximise the view.
- Draw modes: lit, unlit, wireframe, no post-processing. Post-processing (`Lighting.composer`) — only on the first view, if it is perspective.
- Camera: wheel — zoom toward the cursor, MMB or Alt+LMB — orbit around the target, RMB — pan, RMB + WASD / QE — fly; in brush modes WASD moves even without RMB. The axes in the corner are clickable (view along an axis); "Turntable" slowly rotates the scene. F — to the selection, Home — the whole map.
- "Show" menu: grid, light and spawn point icons, decor, weather, haze, statistics.

## 3. Modes

Tab — cycles "Selection → Blocks → Decor → Terrain", Shift+1…5 — straight to the one needed (the fifth is "Place").

- **Selection.** LMB selects a block, a decor item, a light or the spawn point (the nearest under the ray: icons → decor → voxels), Shift — add or remove, dragging over empty space — a marquee (in perspective it takes only the top blocks of columns, in orthographic views — everything). Double-click on terrain — the whole piece. RMB — menu: focus, duplicate, delete, rotate 90° around X / Y / Z, select all blocks of this kind, pick into the brush, create a prefab, put the spawn point or a light under the cursor.
- **Gizmo** (`TransformControls`, one per view): W — move, E — rotate by axes, R — scale (terrain — sizes and layers, light — range), Q — no gizmo, space — cycle. The highlight follows the gizmo; the edit is applied on release — as a single undo record.
  - Blocks: move — by whole cells, rotate — by quarters around the cell centre on any axis. The cell format stores only the rotation around the vertical (2 bits), so when rotating around X or Z the blocks are rearranged while the shape itself (stairs) does not tilt. Attached decor moves together with the blocks.
  - Decor — free on all axes (yaw, pitch, roll), 1/16 step. A spotlight rotates by its cone.
  - Arrows — nudge along the active view's screen by the nearest world axis (Shift — by 4), Shift+PgUp/PgDn — up and down.
- **Blocks, Decor, Terrain** — the previous brushes, unchanged (hotkeys — in the README and section 6 of [design-level-decor.md](design-level-decor.md)).
- **Place** — the selected prefab is placed by click into the cell under the cursor.

## 4. Outliner and details

The tree: map → Environment (sun, sky and global light, haze, weather, post-processing) → spawn point → lights → terrain → decor by category → blocks by type (with a count, up to 400 cells per type). Lazy and virtual — only visible rows are drawn. Search by name and type; eyes — visibility of icons, decor, weather and haze. Selecting in the viewport expands and scrolls the tree.

**Details** — each type has its own: block (position, rotation, type, palette properties), decor (position, rotation on three axes, type, anchor, light, collisions), light (type, colour, intensity, range, shadows; for a spotlight — cone, yaw, pitch), spawn point (cell and facing), terrain piece (centre and parameters). Numbers are dragged with the mouse over the field, as in Unreal (Shift — ×10, Alt — ×0.1). Every edit is undoable; consecutive edits of the same field merge into one record.

## 5. World, light, spawn point

- **World settings** (`src/world.ts`) live in the map in `meta.world` — only the differences from the defaults. Sun (colour, intensity, elevation, azimuth, shadows), sky and global light (background, sky light from above and reflected from the ground, strength, fill), haze (on, colour, start and end for the game camera — in the editor it scales with the camera distance), weather, post-processing (exposure, bloom, AO, saturation, contrast, vignette, shadow and highlight tint). Sets: day, morning, sunset, night, overcast, dungeon. Applied by `Lighting.applyWorld` — in the editor and in the game; the night on L stays its own thing.
- **Weather** (`src/weather.ts`): rain, thunderstorm (lightning flashes light up the sky), snow, leaf fall, sparks and ash; particles in a box around the camera, strength and wind.
- **Placed lights** — map entities `entities` with `kind: 'light'` (`LightData`: point or spot, colour, intensity, range, cone, pitch, shadows). In the editor — an icon and a range sphere on the selected one; in the game — real sources.
- **Spawn point** — `spawn` and the facing `meta.spawnYaw` (°, 0 — toward +X, 90 — toward +Z). The game places the hero there if the map is opened with `?map=…` (the default playground — as before).

## 6. Prefabs

Kits are functions in `src/level/kit.ts` (tree, hill, cliff, rock outcrop, riverbed, waterfall, bridge, portal, walls, stairway, platform, haystack). Everything they place via `level.set` is written as a single edit. **Library** (2026-10-29) — baked presets from `assets/prefabs/` ([design-prefab-library.md](design-prefab-library.md)): blocks + decor + light relative to the anchor, sections — the catalogue categories; in "Place" mode **R** rotates the preset by 90° (cells, block rotation, decor yaw and lights — together). **My prefabs** — a saved selection in the same format in localStorage `malina.editor.prefabs`; RMB → "Save to library (JSON)" downloads it as a file for `assets/prefabs/`.

## 7. Weapons

The "Weapons" tab (`src/dev/editor/weapons-panel.ts`, registry `src/weapons.ts`): a list with categories and search, a rotating model preview and the arcs of every combo strike to scale, all stats and the three strikes — as sliders, colours of the model parts, balance comparison (DPS, combo damage, reach, coverage, score — sword = 100). "Make active" writes the numbers into `SWORD` (`applyWeapon`); the game takes the active weapon at start (`?weapon=<id>` — any). Stored in localStorage `malina.weapons` and `malina.weapon`. Crit chance and multiplier are so far only in the balance calculation, not used in combat.

## 8. For tests

`window.__malina` in the editor: the previous API of brushes, decor and terrain plus `select`, `selection`, `gizmo(offset, [axis, degrees])`, `rotateSel`, `nudgeSel`, `deleteSel`, `duplicateSel`, `setTool`, `world`, `changeWorld`, `newLight`, `setSpawn`, `placePrefab(id, x, y, z)`, `viewports`, `setDoc`.

## 9. Next

1. Save the window and viewport layout between runs.
2. Burrows, chests and doors as entities with icons and details.
3. Crit and weapon weight — into combat; blade trail colours — from the weapon.
