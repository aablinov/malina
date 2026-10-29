import { Level } from './level.ts';
import type { PgLabel } from './playground-map.ts';
import { stampPrefab } from './prefab-lib/stamp.ts';
import type { LibraryPrefab } from './prefab-lib/types.ts';

/**
 * Витрина библиотеки пресетов (`?map=prefabs`): травяное поле, по категории — ряд вдоль X, каждый пресет с подписью
 * на полу. `npm run prefabs` пишет assets/maps/prefabs.json. Для ревью «похоже ли на референс» и для теста.
 */
export function buildPrefabsMap(list: LibraryPrefab[]): Level {
  const L = new Level('Витрина пресетов');
  const labels: PgLabel[] = [];
  const cats = [...new Set(list.map((p) => p.category))];
  const GAP = 5;
  let z = 0, maxX = 0;
  const spots: [LibraryPrefab, number, number][] = [];
  const ROW = 96; // ряд не длиннее ~100 м — дальше перенос на следующую строку той же категории
  for (const cat of cats) {
    const all = list.filter((p) => p.category === cat);
    for (let i = 0; i < all.length;) {
      const row: LibraryPrefab[] = [];
      let w = 0;
      while (i < all.length && (row.length === 0 || w + all[i].size[0] + GAP <= ROW)) { w += all[i].size[0] + GAP; row.push(all[i++]); }
      const depth = Math.max(...row.map((p) => p.size[2]));
      z += Math.ceil(depth / 2) + GAP;
      labels.push({ text: cat, x: -3, z, size: 1 });
      let x = 0;
      for (const p of row) {
        x += Math.ceil(p.size[0] / 2) + GAP;
        spots.push([p, x, z]);
        labels.push({ text: p.title + (p.seed > 1 ? ` ${p.seed}` : ''), x, z: z + Math.ceil(p.size[2] / 2) + 1.5 });
        x += Math.ceil(p.size[0] / 2);
      }
      maxX = Math.max(maxX, x);
      z += Math.ceil(depth / 2) + GAP;
    }
  }
  const X0 = -10, X1 = maxX + 10, Z0 = -8, Z1 = z + 8;
  for (let x = X0; x <= X1; x++) for (let zz = Z0; zz <= Z1; zz++) { L.set(x, -1, zz, 'grass'); L.set(x, -2, zz, 'dirt'); L.set(x, -3, zz, 'dirt'); }
  for (const [p, x, zz] of spots) {
    const r = stampPrefab(L, p, x, 0, zz);
    for (const d of r.decor) L.addDecor(d);
    L.entities.push(...r.entities);
  }
  L.spawn = [-4, 0, 0];
  L.meta.labels = labels;
  return L;
}
