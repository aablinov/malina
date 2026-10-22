import { blockDef, type BlockDef } from './palette.ts';

/**
 * Воксельная сетка уровня: чанки 16³, в клетке — индекс блока в палитре уровня и поворот.
 * Без зависимостей от three — этим же кодом карты экспортируются из node (scripts/export-map.ts).
 *
 * Координаты блока — целые, блок занимает [x, x+1) × [y, y+1) × [z, z+1). Могут быть отрицательными.
 */

export const CH = 16;
const CODE_ROT = 3;

export interface LevelJSON {
  format: 'malina-level';
  version: 1;
  name: string;
  /** Индекс в rows → имя блока; 0 всегда 'air' */
  palette: string[];
  /** Ряды: [y, z, [[x0, длина, индекс, поворот], …]] */
  rows: [number, number, [number, number, number, number][]][];
  /** Точки появления, свет, предметы — заполняет редактор позже */
  entities: LevelEntity[];
  spawn?: [number, number, number];
}

export interface LevelEntity { kind: string; x: number; y: number; z: number; rot?: number; data?: Record<string, unknown> }

export interface Bounds { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

export const chunkKey = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`;

export class Level {
  name: string;
  readonly chunks = new Map<string, Uint16Array>();
  /** Индекс → имя блока */
  readonly palette: string[] = ['air'];
  private readonly index = new Map<string, number>([['air', 0]]);
  private readonly defs: BlockDef[] = [blockDef('air')];
  readonly entities: LevelEntity[] = [];
  spawn: [number, number, number] | null = null;
  /** Чанки, которые надо перестроить (ключи) */
  readonly dirty = new Set<string>();
  version = 0;
  private bounds: Bounds | null = null;

  constructor(name = 'Без имени') { this.name = name; }

  idOf(name: string): number {
    let id = this.index.get(name);
    if (id === undefined) {
      id = this.palette.length;
      if (id >= 1 << 13) throw new Error('Палитра уровня переполнена');
      this.palette.push(name);
      this.index.set(name, id);
      this.defs.push(blockDef(name));
    }
    return id;
  }

  /** Сырой код клетки: id << 2 | rot; 0 — воздух */
  code(x: number, y: number, z: number): number {
    const c = this.chunks.get(chunkKey(x >> 4, y >> 4, z >> 4));
    return c ? c[((y & 15) * CH + (z & 15)) * CH + (x & 15)] : 0;
  }
  idAt(x: number, y: number, z: number): number { return this.code(x, y, z) >> 2; }
  rotAt(x: number, y: number, z: number): number { return this.code(x, y, z) & CODE_ROT; }
  nameAt(x: number, y: number, z: number): string { return this.palette[this.idAt(x, y, z)]; }
  defAt(x: number, y: number, z: number): BlockDef { return this.defs[this.idAt(x, y, z)]; }
  defOf(id: number): BlockDef { return this.defs[id]; }
  isAir(x: number, y: number, z: number): boolean { return this.code(x, y, z) === 0; }

  set(x: number, y: number, z: number, name: string, rot = 0): void {
    const id = name === 'air' ? 0 : this.idOf(name);
    const key = chunkKey(x >> 4, y >> 4, z >> 4);
    let c = this.chunks.get(key);
    if (!c) {
      if (id === 0) return;
      c = new Uint16Array(CH * CH * CH);
      this.chunks.set(key, c);
    }
    const i = ((y & 15) * CH + (z & 15)) * CH + (x & 15);
    const code = id === 0 ? 0 : (id << 2) | (rot & CODE_ROT);
    if (c[i] === code) return;
    c[i] = code;
    this.version++;
    this.bounds = null;
    // перестроить этот чанк и соседние, если клетка на границе
    const cx = x >> 4, cy = y >> 4, cz = z >> 4;
    this.dirty.add(key);
    const lx = x & 15, ly = y & 15, lz = z & 15;
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cy, cz)); else if (lx === 15) this.dirty.add(chunkKey(cx + 1, cy, cz));
    if (ly === 0) this.dirty.add(chunkKey(cx, cy - 1, cz)); else if (ly === 15) this.dirty.add(chunkKey(cx, cy + 1, cz));
    if (lz === 0) this.dirty.add(chunkKey(cx, cy, cz - 1)); else if (lz === 15) this.dirty.add(chunkKey(cx, cy, cz + 1));
  }

  /** Заполнить параллелепипед (включительно) */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string, rot = 0): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, name, rot);
  }

  clear(): void {
    for (const k of this.chunks.keys()) this.dirty.add(k);
    this.chunks.clear();
    this.entities.length = 0;
    this.spawn = null;
    this.version++;
    this.bounds = null;
  }

  /** Обойти все непустые клетки */
  forEach(cb: (x: number, y: number, z: number, id: number, rot: number) => void): void {
    for (const [key, c] of this.chunks) {
      const [cx, cy, cz] = key.split(',').map(Number);
      for (let i = 0; i < c.length; i++) {
        const code = c[i];
        if (!code) continue;
        const lx = i & 15, lz = (i >> 4) & 15, ly = i >> 8;
        cb(cx * CH + lx, cy * CH + ly, cz * CH + lz, code >> 2, code & CODE_ROT);
      }
    }
  }

  /** Границы непустых клеток (включительно) или null, если уровень пуст */
  getBounds(): Bounds | null {
    if (this.bounds) return this.bounds;
    let b: Bounds | null = null;
    this.forEach((x, y, z) => {
      if (!b) b = { minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z };
      else {
        if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
        if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
        if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
      }
    });
    this.bounds = b;
    return b;
  }

  /** Самый высокий непустой блок в колонке не выше yMax: его y или null */
  topAt(x: number, z: number, yMax = 255): number | null {
    const b = this.getBounds();
    if (!b) return null;
    for (let y = Math.min(yMax, b.maxY); y >= b.minY; y--) if (this.code(x, y, z)) return y;
    return null;
  }

  toJSON(): LevelJSON {
    // ряды вдоль X, пробеги одинаковых кодов
    const rows = new Map<string, [number, number, number, number][]>();
    const cells: [number, number, number, number][] = [];
    this.forEach((x, y, z, id, rot) => cells.push([y, z, x, (id << 2) | rot]));
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    for (const [y, z, x, code] of cells) {
      const k = `${y},${z}`;
      let runs = rows.get(k);
      if (!runs) { runs = []; rows.set(k, runs); }
      const last = runs[runs.length - 1];
      if (last && last[0] + last[1] === x && last[2] === code >> 2 && last[3] === (code & CODE_ROT)) last[1]++;
      else runs.push([x, 1, code >> 2, code & CODE_ROT]);
    }
    const out: LevelJSON['rows'] = [];
    for (const [k, runs] of rows) { const [y, z] = k.split(',').map(Number); out.push([y, z, runs]); }
    return { format: 'malina-level', version: 1, name: this.name, palette: this.palette.slice(), rows: out, entities: this.entities.slice(), ...(this.spawn ? { spawn: this.spawn } : {}) };
  }

  static fromJSON(j: LevelJSON): Level {
    if (j.format !== 'malina-level') throw new Error('Это не карта «Малины»');
    const L = new Level(j.name);
    for (const [y, z, runs] of j.rows) for (const [x0, n, idx, rot] of runs) {
      const name = j.palette[idx];
      if (!name || name === 'air') continue;
      for (let i = 0; i < n; i++) L.set(x0 + i, y, z, name, rot);
    }
    L.entities.push(...(j.entities ?? []));
    L.spawn = j.spawn ?? null;
    L.dirty.clear();
    return L;
  }

  clone(): Level { return Level.fromJSON(this.toJSON()); }
}
