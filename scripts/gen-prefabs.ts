/**
 * Библиотека пресетов (wiki/design-prefab-library.md): запекает строители src/level/prefab-lib/builders.ts
 * в assets/prefabs/<id>.json и собирает витрину assets/maps/prefabs.json (`?map=prefabs`).
 * Node ≥ 22.18 выполняет TypeScript сам:  node scripts/gen-prefabs.ts
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDERS } from '../src/level/prefab-lib/builders.ts';
import { bakeAll } from '../src/level/prefab-lib/build.ts';
import { buildPrefabsMap } from '../src/level/prefabs-map.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'prefabs');
mkdirSync(DIR, { recursive: true });
for (const f of readdirSync(DIR)) if (f.endsWith('.json')) rmSync(join(DIR, f));

const all = BUILDERS.flatMap(bakeAll);
for (const p of all) {
  writeFileSync(join(DIR, `${p.id}.json`), JSON.stringify(p));
  console.log(`${p.id}: ${p.cells.length} блоков, ${p.decor.length} декора, ${p.entities.length} света, ${p.size.join(' × ')}`);
}
const map = buildPrefabsMap(all);
const file = join(ROOT, 'assets', 'maps', 'prefabs.json');
writeFileSync(file, JSON.stringify(map.toJSON()));
let n = 0; map.forEach(() => n++);
console.log(`${file}: ${all.length} пресетов, ${n} блоков`);
