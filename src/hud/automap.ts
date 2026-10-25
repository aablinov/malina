import { iconCanvas } from '../icons';
import type { Level } from '../level/level.ts';

/**
 * Карта с туманом войны в духе Diablo и Minecraft Dungeons (wiki/design-inventory.md, «Карта»):
 * открывается там, где герой прошёл; проходимое — тёмно-синяя заливка с белым пиксельным контуром, как в MCD.
 * Рисуется в изометрии камеры (поворот на 45° и сжатие по вертикали): верх экрана — туда же, куда смотрит игра.
 * Три вида: мини-карта в углу, прозрачная карта поверх игры (Tab, как в Diablo II) и полная карта (M).
 *
 * Клетка — колонна блоков: «пол», если на неё можно встать (верх выше соседей меньше чем на 1,5 м), «вода», иначе «стена».
 * Хранится тайлами 32 × 32 клетки (регион мира, src/world/regions.ts): карта растёт вместе с миром, тайл
 * создаётся, когда регион впервые появляется, а разведка тайла сохраняется и восстанавливается (base64).
 */

export interface MapMarker { x: number; z: number; icon: string; /** Серый (сундук уже открыт) */ dim?: boolean; /** Виден и без разведки */ always?: boolean }
export interface MapView { x: number; z: number; yaw: number }

const FLOOR = 1, WATER = 2, WALL = 3;
/** Пикселей холста на клетку */
const S = 6;
/** Клеток в тайле */
const T = 32;
/** Сжатие по вертикали: камера смотрит сверху под ≈ 44° */
const SQUASH = 0.7;
const C = Math.SQRT1_2;
const FILL = '#2c3a50', WATER_FILL = '#2c4f74', EDGE = '#f2f4f8';

interface Tile {
  tx: number; tz: number;
  kind: Uint8Array;
  seen: Uint8Array;
  art: HTMLCanvasElement; g: CanvasRenderingContext2D;
  lines: HTMLCanvasElement; lg: CanvasRenderingContext2D;
  walkable: number; opened: number;
}

const tileKey = (tx: number, tz: number): string => `${tx},${tz}`;

export class AutoMap {
  private readonly tiles = new Map<string, Tile>();
  private readonly icons = new Map<string, HTMLCanvasElement>();

  /** level — чтобы читать колонны; для статичной карты тайлы создаются сразу на всех границах */
  constructor(private readonly level: Level, whole = true) {
    if (!whole) return;
    const b = level.getBounds();
    if (!b) return;
    for (let tz = Math.floor(b.minZ / T); tz <= Math.floor(b.maxZ / T); tz++) for (let tx = Math.floor(b.minX / T); tx <= Math.floor(b.maxX / T); tx++) this.addTile(tx, tz);
  }

  /** Тайл региона (rx, rz): создать и прочитать колонны уровня; уже есть — пересчитать проходимость заново */
  addTile(tx: number, tz: number): Tile {
    const key = tileKey(tx, tz);
    let t = this.tiles.get(key);
    if (!t) {
      const art = document.createElement('canvas'), lines = document.createElement('canvas');
      art.width = art.height = lines.width = lines.height = T * S;
      t = { tx, tz, kind: new Uint8Array(T * T), seen: new Uint8Array(T * T), art, g: art.getContext('2d') as CanvasRenderingContext2D, lines, lg: lines.getContext('2d') as CanvasRenderingContext2D, walkable: 0, opened: 0 };
      this.tiles.set(key, t);
    }
    this.classify(t);
    // у соседей край этого тайла был «пустотой» — пересчитать их контуры
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = this.tiles.get(tileKey(tx + dx, tz + dz)); if (n) this.classify(n); }
    return t;
  }

  /** Верх колонны (x, z) и вода ли это; −Infinity — пусто */
  private column(x: number, z: number): [number, boolean] {
    const L = this.level, b = L.getBounds();
    if (!b) return [-Infinity, false];
    for (let y = b.maxY; y >= b.minY; y--) {
      const id = L.idAt(x, y, z);
      if (!id) continue;
      const d = L.defOf(id);
      const wet = /water|acid/.test(d.name);
      if (!d.collide && !wet) continue;
      return [y + (wet ? 0.5 : d.collide), wet];
    }
    return [-Infinity, false];
  }

  private classify(t: Tile): void {
    const x0 = t.tx * T, z0 = t.tz * T;
    // колонны с полем в одну клетку вокруг — чтобы сравнивать с соседями через край тайла
    const W = T + 2;
    const top = new Float32Array(W * W), water = new Uint8Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const [h, wet] = this.column(x0 + i - 1, z0 + j - 1); top[j * W + i] = h; water[j * W + i] = wet ? 1 : 0; }
    t.walkable = 0;
    for (let z = 0; z < T; z++) for (let x = 0; x < T; x++) {
      const k = (z + 1) * W + (x + 1), h = top[k];
      if (h === -Infinity) { t.kind[z * T + x] = 0; continue; }
      let lo = Infinity;
      for (const n of [k + 1, k - 1, k + W, k - W]) if (top[n] > -Infinity) lo = Math.min(lo, top[n]);
      const kind = water[k] ? WATER : h - (lo === Infinity ? h : lo) >= 1.5 ? WALL : FLOOR;
      t.kind[z * T + x] = kind;
      if (kind !== WALL) t.walkable++;
    }
    // уже разведанное перерисовать по новой классификации
    t.opened = 0;
    t.g.clearRect(0, 0, T * S, T * S); t.lg.clearRect(0, 0, T * S, T * S);
    for (let z = 0; z < T; z++) for (let x = 0; x < T; x++) if (t.seen[z * T + x] && this.open(t, x, z)) { t.opened++; this.paint(t, x, z); }
  }

  /** Доля разведанного, 0..1 */
  get explored(): number {
    let w = 0, o = 0;
    for (const t of this.tiles.values()) { w += t.walkable; o += t.opened; }
    return w ? o / w : 0;
  }

  private tileAt(x: number, z: number): Tile | undefined { return this.tiles.get(tileKey(Math.floor(x / T), Math.floor(z / T))); }

  private kindAt(x: number, z: number): number {
    const t = this.tileAt(x, z);
    return t ? t.kind[(z - t.tz * T) * T + (x - t.tx * T)] : 0;
  }

  private open(t: Tile, i: number, j: number): boolean {
    const k = i < 0 || j < 0 || i >= T || j >= T ? this.kindAt(t.tx * T + i, t.tz * T + j) : t.kind[j * T + i];
    return k === FLOOR || k === WATER;
  }

  /** Открыть клетки в радиусе r вокруг точки; true — открылось новое */
  reveal(x: number, z: number, r = 13): boolean {
    const cx = Math.round(x), cz = Math.round(z);
    let any = false;
    for (let zz = cz - r; zz <= cz + r; zz++) for (let xx = cx - r; xx <= cx + r; xx++) {
      if ((xx - cx) ** 2 + (zz - cz) ** 2 > r * r) continue;
      const t = this.tileAt(xx, zz);
      if (!t) continue;
      const i = xx - t.tx * T, j = zz - t.tz * T, k = j * T + i;
      if (t.seen[k]) continue;
      t.seen[k] = 1;
      any = true;
      if (this.open(t, i, j)) { t.opened++; this.paint(t, i, j); }
    }
    return any;
  }

  /** Открыть всё (для проверки) */
  revealAll(): void {
    for (const t of this.tiles.values()) for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const k = j * T + i;
      if (!t.seen[k]) { t.seen[k] = 1; if (this.open(t, i, j)) { t.opened++; this.paint(t, i, j); } }
    }
  }

  isSeen(x: number, z: number): boolean {
    const xx = Math.round(x), zz = Math.round(z), t = this.tileAt(xx, zz);
    return !!t && t.seen[(zz - t.tz * T) * T + (xx - t.tx * T)] === 1;
  }

  /** Разведка тайла как строка (base64 битов), чтобы сохранить; undefined — ничего не разведано */
  seenOf(tx: number, tz: number): string | undefined {
    const t = this.tiles.get(tileKey(tx, tz));
    if (!t || !t.opened && !t.seen.some((v) => v)) return undefined;
    const bytes = new Uint8Array(T * T / 8);
    for (let k = 0; k < T * T; k++) if (t.seen[k]) bytes[k >> 3] |= 1 << (k & 7);
    return btoa(String.fromCharCode(...bytes));
  }

  /** Восстановить разведку тайла из seenOf */
  restoreSeen(tx: number, tz: number, packed: string): void {
    const t = this.tiles.get(tileKey(tx, tz));
    if (!t) return;
    const bin = atob(packed);
    for (let k = 0; k < T * T; k++) if ((bin.charCodeAt(k >> 3) >> (k & 7)) & 1 && !t.seen[k]) {
      t.seen[k] = 1;
      if (this.open(t, k % T, (k / T) | 0)) { t.opened++; this.paint(t, k % T, (k / T) | 0); }
    }
  }

  /** Клетка: заливка и белый контур там, где сосед — стена или пустота */
  private paint(t: Tile, i: number, j: number): void {
    const g = t.g, k = t.kind[j * T + i], px = i * S, py = j * S;
    g.fillStyle = k === WATER ? WATER_FILL : FILL;
    g.fillRect(px, py, S, S);
    const L = 2;
    for (const c of [g, t.lg]) {
      c.fillStyle = EDGE;
      if (!this.open(t, i - 1, j)) c.fillRect(px, py, L, S);
      if (!this.open(t, i + 1, j)) c.fillRect(px + S - L, py, L, S);
      if (!this.open(t, i, j - 1)) c.fillRect(px, py, S, L);
      if (!this.open(t, i, j + 1)) c.fillRect(px, py + S - L, S, L);
    }
    // редкие белые ромбики по полу, как камешки на карте MCD
    const gx = t.tx * T + i, gz = t.tz * T + j;
    if (k === FLOOR && (((gx * 73856093) ^ (gz * 19349663)) % 61 + 61) % 61 === 0) { g.fillRect(px + 2, py + 1, 2, 1); g.fillRect(px + 1, py + 2, 4, 2); g.fillRect(px + 2, py + 4, 2, 1); }
  }

  /** Мир → экран: центр (cx, cy), k пикселей на клетку, вокруг точки (ox, oz) */
  static project(x: number, z: number, ox: number, oz: number, cx: number, cy: number, k: number): [number, number] {
    const u = (x - ox) * k, v = (z - oz) * k;
    return [cx + (u * C - v * C), cy + (u * C + v * C) * SQUASH];
  }

  /**
   * Нарисовать карту на холсте ctx: центр вида (ox, oz) → точка (cx, cy), k пикселей на клетку.
   * alpha — прозрачность; lines — только контур поверх едва заметной заливки (Tab, как в Diablo II).
   */
  draw(ctx: CanvasRenderingContext2D, ox: number, oz: number, cx: number, cy: number, k: number, hero: MapView, markers: MapMarker[], alpha = 1, lines = false): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, cy);
    ctx.scale(1, SQUASH);
    ctx.rotate(Math.PI / 4);
    ctx.scale(k / S, k / S);
    ctx.translate(-(ox + 0.5) * S, -(oz + 0.5) * S);
    // тайлы, которые могут попасть в холст: радиус вида в клетках с запасом на поворот
    const reach = Math.hypot(ctx.canvas.width, ctx.canvas.height) / k + T;
    for (const t of this.tiles.values()) {
      if (!t.opened) continue;
      const tcx = t.tx * T + T / 2, tcz = t.tz * T + T / 2;
      if (Math.abs(tcx - ox) > reach || Math.abs(tcz - oz) > reach) continue;
      const px = t.tx * T * S, pz = t.tz * T * S;
      if (lines) { ctx.globalAlpha = alpha * 0.22; ctx.drawImage(t.art, px, pz); ctx.globalAlpha = alpha; ctx.drawImage(t.lines, px, pz); }
      else ctx.drawImage(t.art, px, pz);
    }
    ctx.restore();
    // значки и герой — в экранных координатах, не сжимаются
    const sz = Math.max(14, Math.min(26, k * 2.2));
    for (const m of markers) {
      if (!m.always && !this.isSeen(m.x, m.z)) continue;
      const [x, y] = AutoMap.project(m.x, m.z, ox, oz, cx, cy, k);
      ctx.globalAlpha = m.dim ? 0.45 : 1;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.icon(m.icon), x - sz / 2, y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    const [hx, hy] = AutoMap.project(hero.x, hero.z, ox, oz, cx, cy, k);
    const [fx, fy] = AutoMap.project(hero.x + Math.sin(hero.yaw), hero.z + Math.cos(hero.yaw), ox, oz, cx, cy, k);
    const a = Math.atan2(fy - hy, fx - hx), r = Math.max(7, Math.min(13, k * 1.2));
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(-r * 0.75, r * 0.7); ctx.lineTo(-r * 0.35, 0); ctx.lineTo(-r * 0.75, -r * 0.7); ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b0f17';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  /** Подобрать k, чтобы разведанное (или вся карта) влезло в w × h */
  fit(w: number, h: number): { ox: number; oz: number; k: number } {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of this.tiles.values()) for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) if (t.seen[j * T + i] && this.open(t, i, j)) {
      const x = t.tx * T + i, z = t.tz * T + j;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    if (x0 === Infinity) {
      for (const t of this.tiles.values()) { x0 = Math.min(x0, t.tx * T); x1 = Math.max(x1, t.tx * T + T - 1); z0 = Math.min(z0, t.tz * T); z1 = Math.max(z1, t.tz * T + T - 1); }
      if (x0 === Infinity) { x0 = x1 = z0 = z1 = 0; }
    }
    const ox = (x0 + x1) / 2, oz = (z0 + z1) / 2;
    // размах повёрнутого прямоугольника: по ширине (dx + dz)·C, по высоте (dx + dz)·C·SQUASH
    const dx = x1 - x0 + 2, dz = z1 - z0 + 2, span = (dx + dz) * C;
    return { ox, oz, k: Math.min(w / span, h / (span * SQUASH)) * 0.92 };
  }

  private icon(name: string): HTMLCanvasElement {
    let c = this.icons.get(name);
    if (!c) { c = iconCanvas(name); this.icons.set(name, c); }
    return c;
  }
}
