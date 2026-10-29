import type { LibraryPrefab } from './types.ts';

/** Библиотека пресетов: всё из assets/prefabs/ вшивается в сборку (`npm run prefabs` пишет файлы из строителей) */
const all = import.meta.glob('../../../assets/prefabs/*.json', { eager: true, import: 'default' }) as Record<string, LibraryPrefab>;

export const LIBRARY: LibraryPrefab[] = Object.entries(all).sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p);
export const LIBRARY_CATEGORIES: string[] = [...new Set(LIBRARY.map((p) => p.category))];
export const libraryPrefab = (id: string): LibraryPrefab | undefined => LIBRARY.find((p) => p.id === id);

export { rotatePrefab, stampPrefab } from './stamp.ts';
export type { LibraryPrefab, PrefabData } from './types.ts';
