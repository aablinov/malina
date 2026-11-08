/**
 * Export of generated maps into assets/maps/*.json.
 * Node ≥ 22.18 runs TypeScript directly (type stripping), no bundler needed:
 *
 *   node scripts/export-map.ts playground — playground → assets/maps/playground.json
 *   node scripts/export-map.ts rooms    — dungeon rooms → assets/maps/rooms/*.json
 *   node scripts/export-map.ts island   — map 1 "Island" from presets → assets/maps/island.json
 *   node scripts/export-map.ts td       — "Bush Defence" map → assets/maps/td.json
 *   node scripts/export-map.ts td2      — "Crystal Glade" map (Bush Defence 2) → assets/maps/td2.json
 *   node scripts/export-map.ts td3      — "Castle on the Meadow" map (siege, Bush Defence 3) → assets/maps/td3.json
 *   node scripts/export-map.ts td4      — "Raspberry Spiral" map (Bush Defence 4) → assets/maps/td4.json
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOM_TEMPLATES, roomFromTemplate } from '../src/level/rooms.ts';
import { buildPlaygroundLevel } from '../src/level/playground-map.ts';
import type { Level } from '../src/level/level.ts';
import { buildIslandMap } from '../src/level/island-map.ts';
import { buildTdMap } from '../src/level/td-map.ts';
import { buildTdGladeMap } from '../src/level/td-glade-map.ts';
import { buildTdCastleMap } from '../src/level/td-castle-map.ts';
import { buildTdSpiralMap } from '../src/level/td-spiral-map.ts';
import type { LibraryPrefab } from '../src/level/prefab-lib/types.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'maps');

function save(sub: string, name: string, level: Level): void {
  const dir = join(DIR, sub);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  const json = level.toJSON();
  writeFileSync(file, JSON.stringify(json));
  let n = 0;
  level.forEach(() => n++);
  console.log(`${file}: ${n} blocks, ${json.palette.length - 1} kinds, ${json.rows.length} rows`);
}

const what = process.argv[2] ?? 'garden';
if (what === 'playground') save('', 'playground', buildPlaygroundLevel().level);
else if (what === 'rooms') for (const t of ROOM_TEMPLATES) save('rooms', t.name, roomFromTemplate(t));
else if (what === 'island' || what === 'td' || what === 'td2' || what === 'td3' || what === 'td4') {
  // preset library — from assets/prefabs/*.json (written by npm run prefabs)
  const dir = join(DIR, '..', 'prefabs');
  const lib: Record<string, LibraryPrefab> = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) { const p = JSON.parse(readFileSync(join(dir, f), 'utf8')) as LibraryPrefab; lib[p.id] = p; }
  save('', what, what === 'island' ? buildIslandMap(lib) : what === 'td' ? buildTdMap(lib) : what === 'td2' ? buildTdGladeMap(lib) : what === 'td3' ? buildTdCastleMap(lib) : buildTdSpiralMap(lib));
} else { console.error(`Nothing to export: "${what}". Available: playground, rooms, island, td, td2, td3, td4`); process.exit(1); }
