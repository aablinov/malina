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
