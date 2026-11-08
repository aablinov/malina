/** Mist over the lairs (`src/td/mist-fx.ts`): radius, density 0..1, colour */
export interface TdMist { radius: number; density?: number; color?: string }

/**
 * Bush Defence mode (tower defence, wiki/design-tower-defence.md): everything the map tells the mode lives in `meta.td`.
 * Coordinates are world metres, like mob posts and chests. A map with `meta.td` is played in this mode (src/td/td.ts).
 */

/** Tower pad: cell centre; the tower occupies a circle of radius ~1.2 m. y — floor height (pads on castle walls) */
export interface TdPad { x: number; z: number; y?: number }

/**
 * Enemy lane: from the lair (first point) to the bush (last); enemies walk the points, towers hit the one furthest along the lane.
 * Siege (wiki section 9): a lane may end at a wall or gate (`wall` — an id from `walls`): enemies hit it at the end of the lane,
 * and once the breach is open they continue along `inner` to the bush. Flyers take `inner` right away.
 */
export interface TdLane { id: string; title: string; points: [number, number][]; wall?: string; inner?: [number, number][] }

/**
 * Castle wall or gate (siege, wiki section 9): a rectangle of cells [x0..x1] × [z0..z1], blocks from y0 to y1, health.
 * breach — the cell of the outer face where enemies hit and where the breach opens (±2 cells along the wall, full thickness); out — unit vector pointing outward.
 * A gate (`gate`) is an opening without blocks: the leaves are closed to enemies, the hero passes through the wicket.
 */
export interface TdWall {
  id: string; title: string; kind: 'wall' | 'gate';
  x0: number; z0: number; x1: number; z1: number; y0: number; y1: number;
  hp: number; breach: [number, number]; out: [number, number];
}

/** The raspberry bush — what we defend: where it stands and how much it can take */
/** The bush: where it stands and its health; y — floor height under it (the plateau of map 4), 0 if absent */
export interface TdBush { x: number; y?: number; z: number; hp: number }

/** Wave group: kind — a mob from the roster (src/mobs/roster.ts), count of them every `every` seconds along lane `lane` (id), starting `delay` seconds after the wave begins */
export interface TdWaveGroup { kind: string; count: number; every: number; lane: string; delay?: number }

/** Wave: groups and the raspberry bounty for clearing it */
export interface TdWave { title?: string; groups: TdWaveGroup[]; bounty: number }

export interface TdSpec {
  bush: TdBush;
  lanes: TdLane[];
  pads: TdPad[];
  /** Raspberries at the start */
  berries: number;
  /** Waves in order; none — the mode waits, enemies come only from the F1 panel */
  waves?: TdWave[];
  /** Rest between waves, s */
  rest?: number;
  /** Pack level on the first wave (then +3 per wave, src/td/scaling.ts); none — 1 */
  level?: number;
  /** Castle walls and gates (siege); none — the bush stands in the open */
  walls?: TdWall[];
  /** Which towers can be built (src/td/towers.ts); none — the five basic ones */
  towers?: string[];
  /** Wall repair price: raspberries per 100 health (none — 20) */
  repair?: number;
  /** Mist at the enemy camps (src/td/mist-fx.ts): spawn points are hidden */
  mist?: TdMist;
}
