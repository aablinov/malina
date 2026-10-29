import { Level, type DecorItem, type LevelEntity } from '../level.ts';
import type { LibraryPrefab, PrefabData } from './types.ts';
import { rotatePrefab } from './stamp.ts';

/** Что получает строитель: локальная карта с опорой в (0, 0, 0) — y = 0 первый слой воздуха, земля под ним — y = −1 */
export interface BuildCtx {
  L: Level;
  seed: number;
  /** Случай 0..1, детерминированный от зерна */
  rnd(): number;
  /** Декор: rot — рыск в градусах, on — клетка-опора (для настенного) */
  dec(name: string, x: number, y: number, z: number, rot?: number, on?: [number, number, number]): void;
  /** Свет: точечный или прожектор; данные — как у LightData (src/world.ts) */
  light(type: 'point' | 'spot', x: number, y: number, z: number, data?: Record<string, unknown>): void;
  /** Готовый предмет декора и сущность как есть (для вложенных пресетов) */
  put(d: DecorItem): void;
  putEntity(e: LevelEntity): void;
}

/** Вложить запечённый пресет в строитель: клетки, декор и свет со сдвигом (x, z) и поворотом на quarter четвертей — композиции собираются из средних пресетов */
export function stampInto(c: BuildCtx, p: PrefabData, x: number, z: number, quarter = 0): void {
  const r = rotatePrefab(p, quarter);
  for (const [dx, dy, dz, n, rot] of r.cells) c.L.set(x + dx, dy, z + dz, n, rot);
  for (const d of r.decor) c.put({ ...d, pos: [d.pos[0] + x, d.pos[1], d.pos[2] + z], ...(d.on ? { on: [d.on[0] + x, d.on[1], d.on[2] + z] as [number, number, number] } : {}) });
  for (const e of r.entities) c.putEntity({ ...e, x: e.x + x, z: e.z + z });
}

export interface Builder {
  id: string;
  title: string;
  category: string;
  hint?: string;
  /** Сколько вариантов запекать (разные зёрна) */
  variants?: number;
  build(c: BuildCtx): void;
}

/** mulberry32 — маленький детерминированный генератор */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const LIGHT_DEFAULTS = { color: '#ffc870', intensity: 6, distance: 8, angle: 35, pitch: -90, shadows: false };

/** Запечь строитель с зерном в пресет: клетки, декор и свет относительно опоры, габариты по всему содержимому */
export function bake(b: Builder, seed: number, id = b.id): LibraryPrefab {
  const L = new Level(b.title);
  const decor: DecorItem[] = [];
  const entities: LevelEntity[] = [];
  b.build({
    L, seed, rnd: prng(seed),
    dec: (name, x, y, z, rot, on) => { decor.push({ name, pos: [x, y, z], ...(rot ? { rot: [rot] } : {}), ...(on ? { on } : {}) }); },
    light: (type, x, y, z, data) => { entities.push({ kind: 'light', x, y, z, rot: 0, data: { ...LIGHT_DEFAULTS, ...(type === 'spot' ? { distance: 14, intensity: 12, color: '#fff2d8' } : {}), type, ...data } }); },
    put: (d) => { decor.push(d); },
    putEntity: (e) => { entities.push(e); },
  });
  const cells: LibraryPrefab['cells'] = [];
  L.forEach((x, y, z, _id, rot) => cells.push([x, y, z, L.nameAt(x, y, z), rot]));
  cells.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  const pts = [...cells.map((c) => [c[0], c[1], c[2]]), ...decor.map((d) => d.pos), ...entities.map((e) => [e.x, e.y, e.z])];
  const span = (i: number) => pts.length ? Math.ceil(Math.max(...pts.map((p) => p[i]))) - Math.floor(Math.min(...pts.map((p) => p[i]))) + 1 : 1;
  return { id, title: b.title, category: b.category, ...(b.hint ? { hint: b.hint } : {}), size: [span(0), span(1), span(2)], seed, cells, decor, entities };
}

/** Все варианты строителя: `<id>`, `<id>_2`, … с зёрнами 1, 2, … */
export function bakeAll(b: Builder): LibraryPrefab[] {
  const n = Math.max(1, b.variants ?? 1);
  return Array.from({ length: n }, (_, i) => bake(b, i + 1, i ? `${b.id}_${i + 1}` : b.id));
}
