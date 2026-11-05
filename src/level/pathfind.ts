import * as THREE from 'three';
import { overlapsY, type Obstacle } from '../collision.ts';
import { distToObstacle } from '../collision.ts';
import { BODY_H, collideTop, STEP, type Terrain } from './collide.ts';
import type { Level } from './level.ts';

/**
 * Hero pathfinding over level blocks — for mouse clicks (go there, approach a target).
 * Nodes are points of a 0.5 m grid (two per block, so both halves of a stair are visible) at the floor height under them.
 * Moving to a neighbour: up by at most a step (0.5 m — stairs, half-block), down up to dropMax (jump off an edge),
 * free above the floor for the hero's height. Diagonals only if both side neighbours are free (no corner cutting).
 * Nodes by walls cost more — the path runs through the middle of a passage. The finished path is straightened: extra nodes on a line are dropped.
 */

const G = 0.5;
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
/** How many nodes one search may expand (≈ an 85 × 85 m field on one level) */
const MAX_EXPAND = 30000;

export interface PathOptions {
  /** Flat obstacles (barrels, crates, decor) — to go around */
  solids?: readonly Obstacle[];
  /** How far down one may drop, m */
  dropMax?: number;
  /** Cap on expanded cells (search cost); MAX_EXPAND by default — for the hero, cheaper for mobs */
  maxExpand?: number;
}

interface Node { i: number; j: number; y: number; g: number; f: number; parent: Node | null; closed: boolean; wall: boolean }

const key = (i: number, j: number, y: number): number => ((i + 2048) * 4096 + (j + 2048)) * 128 + Math.round(y * 2) + 32;

export class Pathfinder {
  private readonly level: Level;
  private readonly terrain: Terrain;
  constructor(level: Level, terrain: Terrain) { this.level = level; this.terrain = terrain; }

  /** Above floor y at point (x, z) it is free for the hero's height */
  private clear(x: number, z: number, y: number): boolean {
    const cx = Math.floor(x + 0.5), cz = Math.floor(z + 0.5);
    for (let cy = Math.floor(y + STEP + 1e-3); cy < y + BODY_H; cy++) {
      if (collideTop(this.level, cx, cy, cz, x, z) > y + STEP + 1e-3) return false;
    }
    return true;
  }

  /** The floor under a point if one can stand on it: from height from, up by at most STEP, down by at most dropMax */
  private stand(x: number, z: number, from: number, dropMax: number, solids: readonly Obstacle[]): number | null {
    const f = this.terrain.floorAt(x, z, from);
    if (f === -Infinity || f < from - dropMax - 1e-3) return null;
    if (!this.clear(x, z, f)) return null;
    for (const o of solids) if ((o.y0 === undefined ? f < 1 : overlapsY(o, f, BODY_H)) && distToObstacle(x, z, o) < 0.35) return null;
    return f;
  }

  /**
   * Path from a to b: the points to walk through (the first is the next one, the last is b or the reachable point closest to b).
   * An empty array — the hero is already there.
   */
  find(a: THREE.Vector3, b: THREE.Vector3, opts: PathOptions = {}): THREE.Vector3[] {
    const solids = opts.solids ?? [];
    const dropMax = opts.dropMax ?? 3;
    // in an open field — straight away
    if (this.straight(a, b, solids)) return [b.clone()];
    const si = Math.round((a.x - 0.25) / G), sj = Math.round((a.z - 0.25) / G);
    const gx = b.x, gz = b.z, gy = b.y;
    const nodes = new Map<number, Node>();
    const heap: Node[] = [];
    const push = (n: Node): void => {
      heap.push(n);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p].f <= heap[k].f) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = (): Node => {
      const top = heap[0], last = heap.pop() as Node;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l].f < heap[m].f) m = l;
          if (r < heap.length && heap[r].f < heap[m].f) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const px = (i: number): number => i * G + 0.25;
    // the floor under a grid node is computed many times (neighbours, walls, diagonals) — memoised for the search
    const memo = new Map<number, number | null>();
    const DROPS = [dropMax, 0.6, 0.01, 1];
    const standAt = (i: number, j: number, from: number, drop: 0 | 1 | 2 | 3): number | null => {
      const k = key(i, j, from) * 4 + drop;
      let v = memo.get(k);
      if (v === undefined) { v = this.stand(px(i), px(j), from, DROPS[drop], solids); memo.set(k, v); }
      return v;
    };
    const h = (i: number, j: number, y: number): number => {
      const dx = Math.abs(px(i) - gx), dz = Math.abs(px(j) - gz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz) + Math.abs(y - gy) * 0.5;
    };
    // a wall nearby (on any of the four sides) — the node costs more
    const nearWall = (i: number, j: number, y: number): boolean => {
      for (let d = 0; d < 4; d++) {
        const [di, dj] = DIRS8[d];
        if (standAt(i + di, j + dj, y, 1) === null) return true;
      }
      return false;
    };

    // start: the grid point closest to the hero where one can stand
    let start: Node | null = null;
    for (const [di, dj] of [[0, 0], ...DIRS8]) {
      const y = standAt(si + di, sj + dj, a.y, 3);
      if (y !== null) { start = { i: si + di, j: sj + dj, y, g: 0, f: 0, parent: null, closed: false, wall: false }; break; }
    }
    if (!start) return [b.clone()];
    start.f = h(start.i, start.j, start.y);
    nodes.set(key(start.i, start.j, start.y), start);
    push(start);

    let best = start, bestH = start.f;
    let goal: Node | null = null;
    let expanded = 0;
    const maxExpand = opts.maxExpand ?? MAX_EXPAND;
    while (heap.length && expanded < maxExpand) {
      const n = pop();
      if (n.closed) continue;
      n.closed = true;
      expanded++;
      const hn = h(n.i, n.j, n.y);
      if (hn < bestH) { bestH = hn; best = n; }
      if (Math.hypot(px(n.i) - gx, px(n.j) - gz) < 0.4 && Math.abs(n.y - gy) < 0.75) { goal = n; break; }
      for (let d = 0; d < 8; d++) {
        const [di, dj] = DIRS8[d];
        const i = n.i + di, j = n.j + dj;
        const y = standAt(i, j, n.y, 0);
        if (y === null) continue;
        // diagonal — no corner cutting and no height changes
        if (d >= 4) {
          const ya = standAt(n.i + di, n.j, n.y, 2), yb = standAt(n.i, n.j + dj, n.y, 2);
          if (ya === null || yb === null || Math.abs(y - n.y) > 1e-3) continue;
        }
        const k = key(i, j, y);
        let m = nodes.get(k);
        if (m?.closed) continue;
        if (!m) { m = { i, j, y, g: Infinity, f: 0, parent: null, closed: false, wall: nearWall(i, j, y) }; nodes.set(k, m); }
        const cost = (d >= 4 ? Math.SQRT2 : 1) * G * (m.wall ? 1.8 : 1) + Math.max(0, y - n.y) * 0.3;
        const g = n.g + cost;
        if (g >= m.g) continue;
        m.g = g;
        m.parent = n;
        m.f = g + h(i, j, y);
        push(m);
      }
    }

    // the goal is unreachable — go to the closest reachable point
    const end = goal ?? best;
    const raw: THREE.Vector3[] = [];
    for (let n: Node | null = end; n; n = n.parent) raw.push(new THREE.Vector3(px(n.i), n.y, px(n.j)));
    raw.reverse();
    if (goal) raw.push(new THREE.Vector3(gx, goal.y, gz));
    return this.smooth(a, raw, solids);
  }

  /** Straightening: from the current point straight to the farthest one with a level passage */
  private smooth(a: THREE.Vector3, raw: THREE.Vector3[], solids: readonly Obstacle[]): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    let from = a.clone();
    let k = 0;
    while (k < raw.length) {
      let far = k;
      for (let m = raw.length - 1; m > k; m--) if (this.straight(from, raw[m], solids)) { far = m; break; }
      out.push(raw[far]);
      from = raw[far];
      k = far + 1;
    }
    return out;
  }

  /** One can walk straight from a to b: at every 0.2 m step there is floor, the difference is at most a step, a hero-wide corridor is free */
  straight(a: THREE.Vector3, b: THREE.Vector3, solids: readonly Obstacle[] = []): boolean {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) return true;
    const n = Math.ceil(d / 0.2);
    const sx = -dz / d * 0.3, sz = dx / d * 0.3;
    let y = a.y;
    for (let s = 1; s <= n; s++) {
      const t = s / n, x = a.x + dx * t, z = a.z + dz * t;
      const f = this.stand(x, z, y, STEP, solids);
      if (f === null || Math.abs(f - y) > STEP + 1e-3) return false;
      // the hero's shoulders: on both sides of the line it is also free and the floor is the same
      for (const k of [-1, 1]) {
        const fs = this.stand(x + sx * k, z + sz * k, y, STEP, solids);
        if (fs === null || Math.abs(fs - f) > STEP + 1e-3) return false;
      }
      y = f;
    }
    return Math.abs(y - b.y) < STEP + 1e-3;
  }
}
