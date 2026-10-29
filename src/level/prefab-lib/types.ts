import type { DecorItem, LevelEntity } from '../level.ts';

/**
 * Библиотека пресетов (wiki/design-prefab-library.md): готовые куски мира — блоки, декор и свет относительно опорной клетки
 * (низ, центр). Запекаются кодом (`npm run prefabs`) в assets/prefabs/*.json, в редакторе — вкладка «Библиотека».
 * Тот же формат у «Моих префабов» редактора (сохранённое выделение), только без категории и размера.
 */
export interface PrefabData {
  id: string;
  title: string;
  /** [dx, dy, dz, блок, поворот] от опорной клетки */
  cells: [number, number, number, string, number][];
  decor: DecorItem[];
  entities: LevelEntity[];
}

export interface LibraryPrefab extends PrefabData {
  /** Раздел каталога: природа, руины, поселение… */
  category: string;
  hint?: string;
  /** Габариты в клетках: ширина (X), высота (Y), глубина (Z) */
  size: [number, number, number];
  /** Зерно варианта */
  seed: number;
}
