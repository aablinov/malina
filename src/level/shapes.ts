import { parseObj, rotateShape, type Shape } from './obj.ts';

/**
 * Shape registry: all assets/blocks/*.obj are baked into the build (the build is a single file).
 * Add a file — the shape is available by the file name without the extension.
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
  if (!base) throw new Error(`No block shape "${name}" (assets/blocks/${name}.obj)`);
  s = rotateShape(base, rot);
  rotated.set(key, s);
  return s;
}

export function shapeNames(): string[] { return [...shapes.keys()]; }

/**
 * Decor shapes: assets/decor/*.obj (scripts/gen-decor.mjs). Not limited to the 0..1 cube, the origin is the pivot point.
 * Decor faces are not hidden by neighbours, so cull is removed.
 */
const decorFiles = import.meta.glob('../../assets/decor/*.obj', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const decorShapes = new Map<string, Shape>();
for (const [path, text] of Object.entries(decorFiles)) {
  const name = path.split('/').pop()!.replace(/\.obj$/, '');
  const s = parseObj(name, text);
  decorShapes.set(name, { ...s, tris: s.tris.map((t) => ({ ...t, cull: -1 })) });
}

/** Decor shape by name; if there is none — a block shape (decor may use, for example, "cube") */
export function getDecorShape(name: string): Shape {
  const s = decorShapes.get(name);
  if (s) return s;
  if (shapes.has(name)) return { ...getShape(name), tris: getShape(name).tris.map((t) => ({ ...t, cull: -1 })) };
  throw new Error(`No decor shape "${name}" (assets/decor/${name}.obj)`);
}
