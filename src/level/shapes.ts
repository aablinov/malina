import { parseObj, rotateShape, type Shape } from './obj.ts';

/**
 * Реестр форм: все assets/blocks/*.obj вшиваются в сборку (сборка — один файл).
 * Добавил файл — форма доступна по имени файла без расширения.
 */
const files = import.meta.glob('../../assets/blocks/*.obj', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const shapes = new Map<string, Shape>();
for (const [path, text] of Object.entries(files)) {
  const name = path.split('/').pop()!.replace(/\.obj$/, '');
  shapes.set(name, parseObj(name, text));
}

const rotated = new Map<string, Shape>();

export function getShape(name: string, rot = 0): Shape {
  rot = ((rot % 4) + 4) % 4;
  const key = `${name}:${rot}`;
  let s = rotated.get(key);
  if (s) return s;
  const base = shapes.get(name);
  if (!base) throw new Error(`Нет формы блока «${name}» (assets/blocks/${name}.obj)`);
  s = rotateShape(base, rot);
  rotated.set(key, s);
  return s;
}

export function shapeNames(): string[] { return [...shapes.keys()]; }

/**
 * Формы декора: assets/decor/*.obj (scripts/gen-decor.mjs). Не ограничены кубом 0..1, начало координат — точка опоры.
 * Грани декора соседями не прячутся, поэтому cull снимается.
 */
const decorFiles = import.meta.glob('../../assets/decor/*.obj', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const decorShapes = new Map<string, Shape>();
for (const [path, text] of Object.entries(decorFiles)) {
  const name = path.split('/').pop()!.replace(/\.obj$/, '');
  const s = parseObj(name, text);
  decorShapes.set(name, { ...s, tris: s.tris.map((t) => ({ ...t, cull: -1 })) });
}

/** Форма декора по имени; если такой нет — форма блока (у декора можно взять, например, «cube») */
export function getDecorShape(name: string): Shape {
  const s = decorShapes.get(name);
  if (s) return s;
  if (shapes.has(name)) return { ...getShape(name), tris: getShape(name).tris.map((t) => ({ ...t, cull: -1 })) };
  throw new Error(`Нет формы декора «${name}» (assets/decor/${name}.obj)`);
}
