/**
 * Экспорт сгенерированных карт в assets/maps/*.json.
 * Node ≥ 22.18 выполняет TypeScript сам (type stripping), сборщик не нужен:
 *
 *   node scripts/export-map.ts garden   — огород → assets/maps/garden.json
 *   node scripts/export-map.ts rooms    — комнаты подземелья → assets/maps/rooms/*.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGardenLevel } from '../src/level/garden.ts';
import { ROOM_TEMPLATES, roomFromTemplate } from '../src/level/rooms.ts';
import type { Level } from '../src/level/level.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'maps');

function save(sub: string, name: string, level: Level): void {
  const dir = join(DIR, sub);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  const json = level.toJSON();
  writeFileSync(file, JSON.stringify(json));
  let n = 0;
  level.forEach(() => n++);
  console.log(`${file}: ${n} блоков, ${json.palette.length - 1} видов, ${json.rows.length} рядов`);
}

const what = process.argv[2] ?? 'garden';
if (what === 'garden') save('', 'garden', buildGardenLevel());
else if (what === 'rooms') for (const t of ROOM_TEMPLATES) save('rooms', t.name, roomFromTemplate(t));
else { console.error(`Нечего экспортировать: «${what}». Есть: garden, rooms`); process.exit(1); }
