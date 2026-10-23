import { Level, type LevelJSON } from './level.ts';
import { WALL_H, type RoomMeta, type RoomType, type Side } from './rooms.ts';

/**
 * Генератор этажа подземелья (design-dungeon.md, раздел 3): сетка 5 × 5 с шагом 32 м,
 * главный путь случайным блужданием 5–6 комнат (последняя — босс), 1–2 ответвления по 1–2 комнаты,
 * комнаты — заготовки из assets/maps/rooms/*.json, коридоры 3 клетки шириной.
 * Детерминирован от seed.
 */

export const GRID = 5;
export const STEP = 32;

export interface FloorOpts {
  seed: number;
  /** Номер этажа 1..3 — торговец обязателен на 2 и 3 */
  floor?: number;
  rooms: LevelJSON[];
}

interface Cell { gx: number; gz: number; type: RoomType; room: LevelJSON; links: Side[]; order: number }

const OPP: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
const DIR: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const pick = <T>(arr: readonly T[], r: () => number): T => arr[Math.floor(r() * arr.length)];

function roomMeta(j: LevelJSON): RoomMeta | null {
  const m = j.meta?.room as RoomMeta | undefined;
  return m && m.type ? m : null;
}

/** Раскладка этажа: какие комнаты где и чем связаны */
export function layoutFloor(seed: number, floor = 1): { cells: Cell[]; types: RoomType[] } {
  const r = rng(seed * 7919 + floor);
  for (let attempt = 0; attempt < 50; attempt++) {
    const used = new Map<string, Cell>();
    const key = (gx: number, gz: number) => `${gx},${gz}`;
    const mainLen = 5 + Math.floor(r() * 2);
    let gx = 1 + Math.floor(r() * (GRID - 2)), gz = 1 + Math.floor(r() * (GRID - 2));
    const path: Cell[] = [];
    const add = (x: number, z: number, type: RoomType): Cell => {
      const c: Cell = { gx: x, gz: z, type, room: null as unknown as LevelJSON, links: [], order: used.size };
      used.set(key(x, z), c);
      return c;
    };
    const link = (a: Cell, b: Cell) => {
      const side: Side = b.gx > a.gx ? 'e' : b.gx < a.gx ? 'w' : b.gz > a.gz ? 's' : 'n';
      a.links.push(side); b.links.push(OPP[side]);
    };
    let cur = add(gx, gz, 'start');
    path.push(cur);
    let ok = true;
    for (let i = 1; i < mainLen; i++) {
      const options = (['n', 'e', 's', 'w'] as Side[]).filter((s) => {
        const nx = cur.gx + DIR[s][0], nz = cur.gz + DIR[s][1];
        return nx >= 0 && nz >= 0 && nx < GRID && nz < GRID && !used.has(key(nx, nz));
      });
      if (!options.length) { ok = false; break; }
      const s = pick(options, r);
      const next = add(cur.gx + DIR[s][0], cur.gz + DIR[s][1], i === mainLen - 1 ? 'boss' : 'combat');
      link(cur, next);
      path.push(next);
      cur = next;
    }
    if (!ok) continue;
    // ответвления: элитная, кладовая/торговец, алтарь
    const extras: RoomType[] = ['elite', floor >= 2 ? 'merchant' : (r() < 0.5 ? 'merchant' : 'storage')];
    if (r() < 0.6) extras.push('altar');
    const branches = 1 + Math.floor(r() * 2);
    let placed = 0;
    for (let b = 0; b < branches && extras.length; b++) {
      const from = pick(path.slice(0, -1), r);
      const len = 1 + Math.floor(r() * 2);
      let at = from;
      for (let i = 0; i < len && extras.length; i++) {
        const options = (['n', 'e', 's', 'w'] as Side[]).filter((s) => {
          const nx = at.gx + DIR[s][0], nz = at.gz + DIR[s][1];
          return nx >= 0 && nz >= 0 && nx < GRID && nz < GRID && !used.has(key(nx, nz));
        });
        if (!options.length) break;
        const s = pick(options, r);
        const next = add(at.gx + DIR[s][0], at.gz + DIR[s][1], extras.shift()!);
        link(at, next);
        at = next;
        placed++;
      }
    }
    if (placed === 0) continue;
    const cells = [...used.values()];
    return { cells, types: cells.map((c) => c.type) };
  }
  throw new Error('Не удалось разложить этаж');
}

/** Собрать этаж в один уровень */
export function buildFloor(o: FloorOpts): Level {
  const floor = o.floor ?? 1;
  const r = rng(o.seed * 104729 + floor * 31);
  const byType = new Map<RoomType, LevelJSON[]>();
  for (const j of o.rooms) {
    const m = roomMeta(j);
    if (!m) continue;
    byType.set(m.type, [...(byType.get(m.type) ?? []), j]);
  }
  if (!byType.get('combat')?.length) throw new Error('Нет ни одной боевой комнаты-заготовки');
  const { cells } = layoutFloor(o.seed, floor);
  const L = new Level(`Этаж ${floor} · seed ${o.seed}`);
  const origin = -Math.floor((GRID * STEP) / 2);

  const placed: { cell: Cell; x0: number; z0: number; meta: RoomMeta }[] = [];
  for (const cell of cells) {
    const pool = byType.get(cell.type) ?? byType.get('combat')!;
    cell.room = pick(pool, r);
    const meta = roomMeta(cell.room)!;
    const level = Level.fromJSON(cell.room);
    // центр ячейки — на середине двери, т.е. на клетке floor(w/2)
    const cx = origin + cell.gx * STEP + STEP / 2, cz = origin + cell.gz * STEP + STEP / 2;
    const x0 = cx - Math.floor(meta.w / 2), z0 = cz - Math.floor(meta.d / 2);
    level.forEach((x, y, z, id, rot) => L.set(x + x0, y, z + z0, level.palette[id], rot));
    for (const e of level.entities) {
      if (e.kind === 'door') {
        const side = (e.data?.side as Side) ?? 'n';
        if (!cell.links.includes(side)) continue;
      }
      L.entities.push({ ...e, x: e.x + x0, z: e.z + z0, data: { ...(e.data ?? {}), room: cell.type, cell: [cell.gx, cell.gz] } });
    }
    // декор комнаты — со сдвигом, вместе с клеткой крепления
    for (const dc of level.decor) {
      L.addDecor({ ...dc, pos: [dc.pos[0] + x0, dc.pos[1], dc.pos[2] + z0], ...(dc.on ? { on: [dc.on[0] + x0, dc.on[1], dc.on[2] + z0] } : {}) });
    }
    if (cell.type === 'start' && level.spawn) L.spawn = [level.spawn[0] + x0, level.spawn[1], level.spawn[2] + z0];
    // лишние двери закладываем стеной
    for (const side of ['n', 'e', 's', 'w'] as Side[]) {
      if (cell.links.includes(side)) continue;
      const camSide = side === 'e' || side === 's';
      for (let k = -1; k <= 1; k++) {
        const x = side === 'n' || side === 's' ? x0 + Math.floor(meta.w / 2) + k : side === 'w' ? x0 : x0 + meta.w - 1;
        const z = side === 'w' || side === 'e' ? z0 + Math.floor(meta.d / 2) + k : side === 'n' ? z0 : z0 + meta.d - 1;
        for (let y = 0; y < (camSide ? 1 : WALL_H); y++) L.set(x, y, z, 'bricks');
      }
    }
    placed.push({ cell, x0, z0, meta });
  }

  // коридоры: от двери к двери по прямой, 3 клетки шириной, стены по бокам
  const find = (gx: number, gz: number) => placed.find((p) => p.cell.gx === gx && p.cell.gz === gz)!;
  for (const p of placed) for (const side of p.cell.links) {
    if (side !== 'e' && side !== 's') continue; // каждую пару — один раз
    const q = find(p.cell.gx + DIR[side][0], p.cell.gz + DIR[side][1]);
    const cxA = p.x0 + Math.floor(p.meta.w / 2), czA = p.z0 + Math.floor(p.meta.d / 2);
    if (side === 'e') {
      const z = czA;
      for (let x = p.x0 + p.meta.w; x < q.x0; x++) {
        for (let k = -1; k <= 1; k++) L.set(x, -1, z + k, (x + k) % 2 ? 'tiles' : 'cobble');
        L.set(x, -1, z - 2, 'bricks'); L.set(x, -1, z + 2, 'bricks');
        for (let y = 0; y < WALL_H; y++) L.set(x, y, z - 2, 'bricks');
        L.set(x, 0, z + 2, 'bricks');
        if ((x - p.x0) % 5 === 2) L.set(x, 0, z - 1, 'torch');
      }
    } else {
      const x = cxA;
      for (let z = p.z0 + p.meta.d; z < q.z0; z++) {
        for (let k = -1; k <= 1; k++) L.set(x + k, -1, z, (z + k) % 2 ? 'tiles' : 'cobble');
        L.set(x - 2, -1, z, 'bricks'); L.set(x + 2, -1, z, 'bricks');
        for (let y = 0; y < WALL_H; y++) L.set(x - 2, y, z, 'bricks');
        L.set(x + 2, 0, z, 'bricks');
        if ((z - p.z0) % 5 === 2) L.set(x - 1, 0, z, 'torch');
      }
    }
  }
  L.meta = { floor, seed: o.seed, rooms: placed.map((p) => ({ type: p.cell.type, cell: [p.cell.gx, p.cell.gz], x0: p.x0, z0: p.z0, w: p.meta.w, d: p.meta.d, links: p.cell.links })) };
  L.dirty.clear();
  return L;
}
