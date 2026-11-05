import { Level } from './level.ts';

/**
 * Dungeon rooms — ASCII templates (design-dungeon.md, section 3).
 * `npm run map:rooms` turns them into assets/maps/rooms/*.json; after that they can be edited in the editor,
 * and the floor generator (dungeon.ts) takes the ready JSON.
 *
 * Legend:  # wall · . floor · o column · = low cover · ~ acid · n burrow · c chest
 *          D door (a 3-cell opening centred on a side; the generator walls up the unused ones)
 *          S spawn point · M merchant · A altar · B boss · T torch
 * Strings are rows along Z (top to bottom: from −Z to +Z), characters run along X.
 * The floor is the top of cells y = −1, walls are y 0..2 (1 block on the camera side, +X and +Z).
 */

export type RoomType = 'start' | 'combat' | 'elite' | 'storage' | 'merchant' | 'altar' | 'boss';
export type Side = 'n' | 'e' | 's' | 'w';

export interface RoomMeta {
  type: RoomType;
  w: number;
  d: number;
  /** Sides with doors (templates have all four) */
  doors: Side[];
}

export interface RoomTemplate { name: string; type: RoomType; rows: string[] }

function hash(x: number, z: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const WALL_H = 3;

/** Validate a template: a rectangle, a frame of walls and doors, 3-cell doors centred on each side */
export function validateRoom(t: RoomTemplate): void {
  const d = t.rows.length, w = t.rows[0]?.length ?? 0;
  if (d < 8 || w < 8) throw new Error(`Room "${t.name}": too small`);
  for (const r of t.rows) if (r.length !== w) throw new Error(`Room "${t.name}": rows of different length (${r.length} ≠ ${w})`);
  const cx = Math.floor(w / 2), cz = Math.floor(d / 2);
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const ch = t.rows[z][x];
    const border = x === 0 || z === 0 || x === w - 1 || z === d - 1;
    if (border) {
      const doorN = z === 0 && Math.abs(x - cx) <= 1, doorS = z === d - 1 && Math.abs(x - cx) <= 1;
      const doorW = x === 0 && Math.abs(z - cz) <= 1, doorE = x === w - 1 && Math.abs(z - cz) <= 1;
      const want = doorN || doorS || doorW || doorE ? 'D' : '#';
      if (ch !== want) throw new Error(`Room "${t.name}": expected "${want}" at (${x}, ${z}), found "${ch}"`);
    } else if (!'.o=~ncSMABT'.includes(ch)) throw new Error(`Room "${t.name}": unknown character "${ch}" at (${x}, ${z})`);
  }
}

/** A room in local coordinates: template cell (x, z) → block (x, y, z), floor at y = −1 */
export function roomFromTemplate(t: RoomTemplate): Level {
  validateRoom(t);
  const L = new Level(t.name);
  const d = t.rows.length, w = t.rows[0].length;
  const cx = Math.floor(w / 2), cz = Math.floor(d / 2);
  const floor = (x: number, z: number) => {
    const r = hash(x, z, 1);
    L.set(x, -1, z, r < 0.12 ? 'cobble' : r < 0.2 ? 'bricks_mossy' : r < 0.25 ? 'bricks_cracked' : 'tiles');
  };
  const wall = (x: number, z: number, h: number) => {
    L.set(x, -1, z, 'bricks');
    for (let y = 0; y < h; y++) {
      const r = hash(x, z, 10 + y);
      L.set(x, y, z, r < 0.1 ? 'bricks_mossy' : r < 0.18 ? 'bricks_cracked' : 'bricks');
    }
  };
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const ch = t.rows[z][x];
    // walls on the camera side (+X, +Z) are low so they do not hide the room
    const camSide = x === w - 1 || z === d - 1;
    switch (ch) {
      case '#': wall(x, z, camSide ? 1 : WALL_H); break;
      case 'D': {
        floor(x, z);
        const side: Side = z === 0 ? 'n' : z === d - 1 ? 's' : x === 0 ? 'w' : 'e';
        if (x === cx || z === cz) L.entities.push({ kind: 'door', x, y: 0, z, data: { side } });
        break;
      }
      case 'o': floor(x, z); L.set(x, 0, z, 'bricks'); L.set(x, 1, z, 'bricks'); L.set(x, 2, z, 'bricks_slab'); break;
      case '=': floor(x, z); L.set(x, 0, z, hash(x, z, 3) < 0.5 ? 'bricks_low' : 'cobble_low'); break;
      case '~': L.set(x, -2, z, 'stone'); L.set(x, -1, z, 'acid'); break;
      case 'n': floor(x, z); L.set(x, 0, z, 'hole'); L.entities.push({ kind: 'hole', x, y: 0, z }); break;
      case 'c': floor(x, z); L.set(x, 0, z, 'crate'); L.entities.push({ kind: 'chest', x, y: 0, z }); break;
      case 'T': floor(x, z); L.set(x, 0, z, 'torch'); break;
      case 'S': floor(x, z); L.spawn = [x, 0, z]; L.entities.push({ kind: 'spawn', x, y: 0, z }); break;
      case 'M': floor(x, z); L.entities.push({ kind: 'merchant', x, y: 0, z }); break;
      case 'A': floor(x, z); L.set(x, 0, z, 'bricks_slab'); L.entities.push({ kind: 'altar', x, y: 0, z }); break;
      case 'B': floor(x, z); L.entities.push({ kind: 'boss', x, y: 0, z }); break;
      default: floor(x, z);
    }
  }
  dressRoom(L, t);
  const meta: RoomMeta = { type: t.type, w, d, doors: ['n', 'e', 's', 'w'] };
  L.meta = { room: meta };
  L.dirty.clear();
  return L;
}

/**
 * Room "dressing": decor on top of the blocks (src/level/decor.ts), deterministic from the cells.
 * Walkable items only — the template's paths and cover do not change. On the far walls (−Z, −X, the tall ones) —
 * banners, cobwebs in the corners, roots; on the floor by the walls — rubble, bricks, bones; candles by the altar, glow mushrooms by the burrow.
 */
function dressRoom(L: Level, t: RoomTemplate): void {
  const d = t.rows.length, w = t.rows[0].length;
  const cx = Math.floor(w / 2), cz = Math.floor(d / 2);
  const at = (x: number, z: number) => t.rows[z]?.[x] ?? '#';
  const nearDoor = (x: number, z: number) => (Math.abs(x - cx) <= 2 && (z <= 1 || z >= d - 2)) || (Math.abs(z - cz) <= 2 && (x <= 1 || x >= w - 2));
  const put = (name: string, x: number, y: number, z: number, rot: number, on?: [number, number, number]) =>
    L.addDecor({ name, pos: [x, y, z], ...(rot ? { rot: [rot] } : {}), ...(on ? { on } : {}) });
  // north wall (z = 0), the face towards the room is z = 0.5
  for (let x = 2; x < w - 2; x++) {
    if (Math.abs(x - cx) <= 2) continue;
    const r = hash(x, 0, 40);
    if ((x - 2) % 6 === 3 && t.type !== 'storage') put('banner', x, 2.6, 0.5, 0, [x, 2, 0]);
    else if (r < 0.14) put('roots', x, 2.5, 0.5, 0, [x, 2, 0]);
  }
  // west wall (x = 0), the face towards the room is x = 0.5, the item faces +X
  for (let z = 2; z < d - 2; z++) {
    if (Math.abs(z - cz) <= 2) continue;
    if (hash(0, z, 41) < 0.16) put('roots', 0.5, 2.5, z, -90, [0, 2, z]);
  }
  // a cobweb in the far corner and sometimes by the west wall
  put('cobweb', 1, 2.4, 0.5, 0, [1, 2, 0]);
  if (hash(w, d, 42) < 0.6) put('cobweb', 0.5, 2.4, d - 3, -90, [0, 2, d - 3]);
  // junk on the floor by the walls
  const JUNK = ['rubble', 'bricks_loose', 'bones', 'rubble'];
  for (let z = 1; z < d - 1; z++) for (let x = 1; x < w - 1; x++) {
    if (at(x, z) !== '.' || nearDoor(x, z)) continue;
    const wall = at(x - 1, z) === '#' || at(x, z - 1) === '#' || at(x + 1, z) === '#' || at(x, z + 1) === '#';
    if (!wall || hash(x, z, 43) > 0.07) continue;
    put(JUNK[Math.floor(hash(x, z, 44) * JUNK.length)], x + (hash(x, z, 45) - 0.5) * 0.5, 0, z + (hash(x, z, 46) - 0.5) * 0.5, Math.round(hash(x, z, 47) * 24) * 15);
  }
  // candles by the altar, mushrooms by the burrows, candles by the boss throne
  for (let z = 1; z < d - 1; z++) for (let x = 1; x < w - 1; x++) {
    const ch = at(x, z);
    if (ch === 'A') for (const [dx, dz] of [[-1, 0], [1, 0]]) put('candles', x + dx, 0, z + dz, 0);
    if (ch === 'n' && hash(x, z, 48) < 0.7) put('mushrooms_glow', x + 0.9, 0, z - 0.6, Math.round(hash(x, z, 49) * 24) * 15);
    if (ch === 'B') for (const [dx, dz] of [[-2, -2], [2, -2]]) put('candles', x + dx, 0, z + dz, 0);
  }
}

// ---------- templates ----------

export const ROOM_TEMPLATES: RoomTemplate[] = [
  { name: 'start', type: 'start', rows: [
    '#########DDD########',
    '#..................#',
    '#.T..............T.#',
    '#..................#',
    '#....o........o....#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    'D........S.........D',
    'D..................D',
    'D..................D',
    '#..................#',
    '#..................#',
    '#..................#',
    '#....o........o....#',
    '#..................#',
    '#.T..............T.#',
    '#..................#',
    '#########DDD########',
  ] },
  { name: 'combat-pillars', type: 'combat', rows: [
    '#########DDD########',
    '#..................#',
    '#.T..............T.#',
    '#...o..........o...#',
    '#..................#',
    '#......===.........#',
    '#..................#',
    '#..n...........n...#',
    '#..................#',
    'D......o....o......D',
    'D..................D',
    'D......o....o......D',
    '#..................#',
    '#..n...........n...#',
    '#..................#',
    '#.........===......#',
    '#..................#',
    '#...o..........o...#',
    '#.T..............T.#',
    '#########DDD########',
  ] },
  { name: 'combat-acid', type: 'combat', rows: [
    '#########DDD########',
    '#..................#',
    '#.T....~~~.......T.#',
    '#.....~~~~~........#',
    '#......~~~.........#',
    '#..................#',
    '#..=...............#',
    '#..=.....n.....=...#',
    '#..=...........=...#',
    'D..................D',
    'D........o.........D',
    'D..................D',
    '#...=...........=..#',
    '#...=....n......=..#',
    '#...............=..#',
    '#..................#',
    '#.........~~~......#',
    '#.T......~~~~~...T.#',
    '#.........~~~......#',
    '#########DDD########',
  ] },
  { name: 'combat-hall', type: 'combat', rows: [
    '###########DDD##########',
    '#......................#',
    '#.T..o......o......o.T.#',
    '#......................#',
    '#..n.......===.......n.#',
    '#......................#',
    '#....==..........==....#',
    'D......................D',
    'D...........o..........D',
    'D......................D',
    '#....==..........==....#',
    '#......................#',
    '#..n.......===.......n.#',
    '#......................#',
    '#.T..o......o......o.T.#',
    '###########DDD##########',
  ] },
  { name: 'combat-cross', type: 'combat', rows: [
    '#########DDD########',
    '#..................#',
    '#.T..=........=..T.#',
    '#....=........=....#',
    '#.......n..n.......#',
    '#..................#',
    '#..o............o..#',
    '#..................#',
    '#....====..====....#',
    'D..................D',
    'D..................D',
    'D..................D',
    '#....====..====....#',
    '#..................#',
    '#..o............o..#',
    '#..................#',
    '#.......n..n.......#',
    '#....=........=....#',
    '#.T..=........=..T.#',
    '#########DDD########',
  ] },
  { name: 'elite', type: 'elite', rows: [
    '###########DDD##########',
    '#......................#',
    '#.T.o..............o.T.#',
    '#......~~......~~......#',
    '#..n...~~..==..~~..n...#',
    '#..........==..........#',
    '#......................#',
    'D.....o....oo....o.....D',
    'D......................D',
    'D.....o....oo....o.....D',
    '#......................#',
    '#..........==..........#',
    '#..n...~~..==..~~..n...#',
    '#......~~......~~......#',
    '#.T.o..............o.T.#',
    '###########DDD##########',
  ] },
  { name: 'storage', type: 'storage', rows: [
    '#########DDD########',
    '#..................#',
    '#.T..c.......c...T.#',
    '#....c.......c.....#',
    '#..................#',
    '#..................#',
    '#......o....o......#',
    '#..................#',
    '#..................#',
    'D......c....c......D',
    'D..................D',
    'D......c....c......D',
    '#..................#',
    '#..................#',
    '#......o....o......#',
    '#..................#',
    '#....c.......c.....#',
    '#.T..c.......c...T.#',
    '#..................#',
    '#########DDD########',
  ] },
  { name: 'merchant', type: 'merchant', rows: [
    '#########DDD########',
    '#..................#',
    '#.T..............T.#',
    '#..................#',
    '#......o....o......#',
    '#..................#',
    '#........M.........#',
    '#......cc.cc.......#',
    '#..................#',
    'D..................D',
    'D..................D',
    'D..................D',
    '#..................#',
    '#..................#',
    '#......o....o......#',
    '#..................#',
    '#..................#',
    '#.T..............T.#',
    '#..................#',
    '#########DDD########',
  ] },
  { name: 'altar', type: 'altar', rows: [
    '#########DDD########',
    '#..................#',
    '#.T..............T.#',
    '#..................#',
    '#....o........o....#',
    '#.......~~~~.......#',
    '#......~~..~~......#',
    '#......~.AA.~......#',
    '#......~.AA.~......#',
    'D......~~..~~......D',
    'D.......~~~~.......D',
    'D..................D',
    '#..................#',
    '#..................#',
    '#....o........o....#',
    '#..................#',
    '#..................#',
    '#.T..............T.#',
    '#..................#',
    '#########DDD########',
  ] },
  { name: 'boss', type: 'boss', rows: [
    '###########DDD##########',
    '#......................#',
    '#.T..................T.#',
    '#...o..............o...#',
    '#......................#',
    '#..n................n..#',
    '#..........==..........#',
    'D..........BB..........D',
    'D..........BB..........D',
    'D..........==..........D',
    '#..n................n..#',
    '#......................#',
    '#...o..............o...#',
    '#.T..................T.#',
    '#......................#',
    '###########DDD##########',
  ] },
];
