/**
 * Экспорт сгенерированных карт в assets/maps/*.json.
 * Node ≥ 22.18 выполняет TypeScript сам (type stripping), сборщик не нужен:
 *
 *   node scripts/export-map.ts garden
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGardenLevel } from '../src/level/garden.ts';
import type { Level } from '../src/level/level.ts';

const GENERATORS: Record<string, () => Level> = { garden: buildGardenLevel };

const name = process.argv[2] ?? 'garden';
const gen = GENERATORS[name];
if (!gen) { console.error(`Нет генератора «${name}». Есть: ${Object.keys(GENERATORS).join(', ')}`); process.exit(1); }
const level = gen();
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'maps');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${name}.json`);
const json = level.toJSON();
writeFileSync(file, JSON.stringify(json));
let n = 0;
level.forEach(() => n++);
console.log(`${file}: ${n} блоков, ${json.palette.length - 1} видов, ${json.rows.length} рядов`);
