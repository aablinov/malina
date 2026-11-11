import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LibraryPrefab } from '../src/level/prefab-lib/types.ts';

/** The prefab library from assets/prefabs — the server builds expedition maps from the same pieces as the client (src/level/expedition-map.ts) */
export function loadPrefabs(dir: string): Record<string, LibraryPrefab> {
  const lib: Record<string, LibraryPrefab> = {};
  for (const f of readdirSync(dir).sort()) if (f.endsWith('.json')) lib[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8')) as LibraryPrefab;
  return lib;
}
