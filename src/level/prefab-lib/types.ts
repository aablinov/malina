import type { DecorItem, LevelEntity } from '../level.ts';

/**
 * Prefab library (wiki/design-prefab-library.md): ready pieces of the world — blocks, decor and light relative to the anchor cell
 * (bottom, centre). Baked by code (`npm run prefabs`) into assets/prefabs/*.json; in the editor — the "Library" tab.
 * The editor's "My prefabs" (a saved selection) use the same format, just without category and size.
 */
export interface PrefabData {
  id: string;
  title: string;
  /** [dx, dy, dz, block, rotation] from the anchor cell */
  cells: [number, number, number, string, number][];
  decor: DecorItem[];
  entities: LevelEntity[];
}

export interface LibraryPrefab extends PrefabData {
  /** Catalogue section: nature, ruins, settlement… */
  category: string;
  hint?: string;
  /** Size in cells: width (X), height (Y), depth (Z) */
  size: [number, number, number];
  /** Variant seed */
  seed: number;
}
