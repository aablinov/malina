import * as THREE from 'three';
import type { Obstacle } from './collision';

/**
 * Навигационная сетка для врагов: клетки 0,5 м, препятствия раздуты на радиус тела.
 * Даёт путь в обход стен (A*, 8 направлений, со спрямлением) и проверку прямой —
 * ею проверяются прыжки: враг не прыгает через стены и укрытия и не приземляется в них.
 */
export class NavGrid {
  readonly cell: number;
  readonly n: number;
  private readonly half: number;
  private readonly walk: Uint8Array;

  constructor(half: number, obstacles: readonly Obstacle[], inflate = 0.7, cell = 0.5) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil((half * 2) / cell);
    this.walk = new Uint8Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
      let ok = Math.abs(x) < half - inflate && Math.abs(z) < half - inflate;
      if (ok) for (const o of obstacles) if (distToObstacle(x, z, o) < inflate) { ok = false; break; }
      this.walk[j * this.n + i] = ok ? 1 : 0;
    }
  }

  private idx(x: number, z: number): [number, number] {
    return [Math.floor((x + this.half) / this.cell), Math.floor((z + this.half) / this.cell)];
  }

  walkable(x: number, z: number): boolean {
    const [i, j] = this.idx(x, z);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return false;
    return this.walk[j * this.n + i] === 1;
  }

  /** Прямая от a до b проходит только по свободным клеткам */
  clearLine(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** Ближайшая свободная точка к p (поиск по кольцам) */
  nearestFree(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    if (this.walkable(x, z)) return out.set(x, 0, z);
    for (let r = 1; r < 12; r++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r * this.cell, pz = z + Math.sin(a) * r * this.cell;
        if (this.walkable(px, pz)) return out.set(px, 0, pz);
      }
    }
    return out.set(x, 0, z);
  }

  /** Путь A* от a к b; первая точка — следующий узел, последняя — b (или ближайшая к b свободная) */
  path(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    const goal = this.nearestFree(b.x, b.z);
    if (this.clearLine(a.x, a.z, goal.x, goal.z)) return [goal];
    const start = this.nearestFree(a.x, a.z);
    const [si, sj] = this.idx(start.x, start.z);
    const [gi, gj] = this.idx(goal.x, goal.z);
    const n = this.n;
    const S = sj * n + si, G = gj * n + gi;
    const g = new Float32Array(n * n).fill(Infinity);
    const from = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    // простая двоичная куча
    const heap: number[] = [];
    const f = new Float32Array(n * n);
    const push = (v: number) => {
      heap.push(v);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop() as number;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    const h = (v: number) => { const i = v % n, j = (v / n) | 0; const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    g[S] = 0; f[S] = h(S); push(S);
    let found = false;
    let iter = 0;
    while (heap.length && iter++ < 12000) {
      const v = pop();
      if (closed[v]) continue;
      closed[v] = 1;
      if (v === G) { found = true; break; }
      const vi = v % n, vj = (v / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = vi + di, nj = vj + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const u = nj * n + ni;
        if (!this.walk[u] || closed[u]) continue;
        // по диагонали — только если не срезаем угол
        if (di && dj && (!this.walk[vj * n + ni] || !this.walk[nj * n + vi])) continue;
        const cost = g[v] + (di && dj ? 1.414 : 1);
        if (cost < g[u]) { g[u] = cost; f[u] = cost + h(u); from[u] = v; push(u); }
      }
    }
    if (!found) return [goal];
    const cells: THREE.Vector3[] = [];
    for (let v = G; v !== -1 && v !== S; v = from[v]) {
      cells.push(new THREE.Vector3(-this.half + ((v % n) + 0.5) * this.cell, 0, -this.half + (((v / n) | 0) + 0.5) * this.cell));
    }
    cells.reverse();
    cells[cells.length - 1] = goal;
    // спрямление: выкидываем узлы, до которых видно напрямую
    const out: THREE.Vector3[] = [];
    let cur = a.clone();
    let k = 0;
    while (k < cells.length) {
      let far = k;
      for (let m = cells.length - 1; m > k; m--) if (this.clearLine(cur.x, cur.z, cells[m].x, cells[m].z)) { far = m; break; }
      out.push(cells[far]);
      cur = cells[far];
      k = far + 1;
    }
    return out;
  }
}

/** Расстояние от точки до прямоугольника препятствия */
export function distToObstacle(x: number, z: number, o: Obstacle): number {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const dx = x - o.x, dz = z - o.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const qx = Math.max(Math.abs(lx) - o.hx, 0), qz = Math.max(Math.abs(lz) - o.hz, 0);
  return Math.hypot(qx, qz);
}
