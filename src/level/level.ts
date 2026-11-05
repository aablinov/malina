import { blockDef, type BlockDef } from './palette.ts';

/**
 * Voxel grid of the level: 16³ chunks, a cell holds the block index in the level palette and the rotation.
 * No dependency on three — the same code exports maps from node (scripts/export-map.ts).
 *
 * Block coordinates are integers, a block occupies [x, x+1) × [y, y+1) × [z, z+1). They may be negative.
 */

export const CH = 16;
const CODE_ROT = 3;

export interface LevelJSON {
  format: 'malina-level';
  version: 1;
  name: string;
  /** Index in rows → block name; 0 is always 'air' */
  palette: string[];
  /** Rows: [y, z, [[x0, length, index, rotation], …]] */
  rows: [number, number, [number, number, number, number][]][];
  /** Spawn points, lights, items — the editor fills them later */
  entities: LevelEntity[];
  spawn?: [number, number, number];
  /** Arbitrary data: for room templates — type and doors */
  meta?: Record<string, unknown>;
  /** Free decor on top of blocks (src/level/decor.ts); old maps lack the field */
  decor?: DecorItem[];
}

export interface LevelEntity { kind: string; x: number; y: number; z: number; rot?: number; data?: Record<string, unknown> }

/**
 * Decor item: stands anywhere with a 1/16 step and at any angle, but is made "of blocks" (wiki/design-level-decor.md).
 * Decor has no logic — whatever breaks or opens is a prop (props.ts) or an entity.
 */
export interface DecorItem {
  /** Name from the decor registry (src/level/decor.ts) */
  name: string;
  /** Pivot point in metres, world coordinates (x, z — as for cell centres) */
  pos: [number, number, number];
  /** [yaw, pitch, roll] in degrees; yaw as for blocks — 90° turns +X into +Z */
  rot?: number[];
  /** The cell the item is attached to (a torch to a wall): erase the cell in the editor — the item is removed with it */
  on?: [number, number, number];
}

export interface Bounds { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

export const chunkKey = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`;

export class Level {
  name: string;
  readonly chunks = new Map<string, Uint16Array>();
  /** Index → block name */
  readonly palette: string[] = ['air'];
  private readonly index = new Map<string, number>([['air', 0]]);
  private readonly defs: BlockDef[] = [blockDef('air')];
  readonly entities: LevelEntity[] = [];
  /** Decor; after changing it call touchDecor() so the renderer and collisions rebuild */
  readonly decor: DecorItem[] = [];
  /** Grows on every decor change */
  decorVersion = 0;
  spawn: [number, number, number] | null = null;
  meta: Record<string, unknown> = {};
  /** Chunks that need rebuilding (keys) */
  readonly dirty = new Set<string>();
  version = 0;
  private bounds: Bounds | null = null;

  constructor(name = 'Untitled') { this.name = name; }

  idOf(name: string): number {
    let id = this.index.get(name);
    if (id === undefined) {
      id = this.palette.length;
      if (id >= 1 << 13) throw new Error('Level palette overflow');
      this.palette.push(name);
      this.index.set(name, id);
      this.defs.push(blockDef(name));
    }
    return id;
  }

  /** Raw cell code: id << 2 | rot; 0 — air */
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
    // bounds grow in place, without scanning all cells; erasing does not shrink them (a superset is safe: it is a search range)
    if (id !== 0 && this.bounds) {
      const b = this.bounds;
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
      if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
    }
    // rebuild this chunk and the neighbours if the cell is on the border
    const cx = x >> 4, cy = y >> 4, cz = z >> 4;
    this.dirty.add(key);
    const lx = x & 15, ly = y & 15, lz = z & 15;
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cy, cz)); else if (lx === 15) this.dirty.add(chunkKey(cx + 1, cy, cz));
    if (ly === 0) this.dirty.add(chunkKey(cx, cy - 1, cz)); else if (ly === 15) this.dirty.add(chunkKey(cx, cy + 1, cz));
    if (lz === 0) this.dirty.add(chunkKey(cx, cy, cz - 1)); else if (lz === 15) this.dirty.add(chunkKey(cx, cy, cz + 1));
  }

  /** Put a ready chunk (a copy from the source map, src/world/map-source.ts): the palettes must match */
  putChunk(key: string, data: Uint16Array): void {
    this.chunks.set(key, data);
    this.version++;
    const [cx, cy, cz] = key.split(',').map(Number);
    this.dirty.add(key);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nk = chunkKey(cx + dx, cy + dy, cz + dz);
      if (this.chunks.has(nk)) this.dirty.add(nk);
    }
    if (this.bounds) {
      const b = this.bounds;
      b.minX = Math.min(b.minX, cx * CH); b.maxX = Math.max(b.maxX, cx * CH + CH - 1);
      b.minY = Math.min(b.minY, cy * CH); b.maxY = Math.max(b.maxY, cy * CH + CH - 1);
      b.minZ = Math.min(b.minZ, cz * CH); b.maxZ = Math.max(b.maxZ, cz * CH + CH - 1);
    }
  }

  /** The same palette as another level (to copy chunks without re-encoding) */
  adoptPalette(from: Level): void { for (const name of from.palette) this.idOf(name); }

  /** Remove a whole chunk (region unloading, src/world/regions.ts): the renderer tears it down, the bounds remain a superset */
  removeChunk(key: string): boolean {
    if (!this.chunks.delete(key)) return false;
    this.dirty.add(key);
    this.version++;
    return true;
  }

  /** Chunk keys of a 32 × 32 m region (2 × 2 chunks along X and Z, all along Y) */
  chunkKeysOf(rx: number, rz: number): string[] {
    const out: string[] = [];
    for (const k of this.chunks.keys()) {
      const [cx, , cz] = k.split(',').map(Number);
      if ((cx >> 1) === rx && (cz >> 1) === rz) out.push(k);
    }
    return out;
  }

  /** Fill a box (inclusive) */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string, rot = 0): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, name, rot);
  }

  clear(): void {
    for (const k of this.chunks.keys()) this.dirty.add(k);
    this.chunks.clear();
    this.entities.length = 0;
    this.decor.length = 0;
    this.decorVersion++;
    this.spawn = null;
    this.meta = {};
    this.version++;
    this.bounds = null;
  }

  /** Decor changed: the renderer and collisions will rebuild */
  touchDecor(): void { this.decorVersion++; }
  addDecor(d: DecorItem): DecorItem { this.decor.push(d); this.decorVersion++; return d; }
  removeDecor(d: DecorItem): void {
    const i = this.decor.indexOf(d);
    if (i >= 0) { this.decor.splice(i, 1); this.decorVersion++; }
  }

  /** Visit all non-empty cells */
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

  /** Bounds of non-empty cells (inclusive) or null if the level is empty */
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

  /** The highest non-empty block in the column not above yMax: its y or null */
  topAt(x: number, z: number, yMax = 255): number | null {
    const b = this.getBounds();
    if (!b) return null;
    for (let y = Math.min(yMax, b.maxY); y >= b.minY; y--) if (this.code(x, y, z)) return y;
    return null;
  }

  toJSON(): LevelJSON {
    // rows along X, runs of identical codes
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
    return { format: 'malina-level', version: 1, name: this.name, palette: this.palette.slice(), rows: out, entities: this.entities.slice(), ...(this.decor.length ? { decor: this.decor.map((d) => ({ ...d })) } : {}), ...(this.spawn ? { spawn: this.spawn } : {}), ...(Object.keys(this.meta).length ? { meta: this.meta } : {}) };
  }

  static fromJSON(j: LevelJSON): Level {
    if (j.format !== 'malina-level') throw new Error('Not a Malina map');
    const L = new Level(j.name);
    for (const [y, z, runs] of j.rows) for (const [x0, n, idx, rot] of runs) {
      const name = j.palette[idx];
      if (!name || name === 'air') continue;
      for (let i = 0; i < n; i++) L.set(x0 + i, y, z, name, rot);
    }
    L.entities.push(...(j.entities ?? []));
    for (const d of j.decor ?? []) L.decor.push({ ...d });
    L.spawn = j.spawn ?? null;
    Object.assign(L.meta, j.meta ?? {});
    L.dirty.clear();
    return L;
  }

  clone(): Level { return Level.fromJSON(this.toJSON()); }
}
