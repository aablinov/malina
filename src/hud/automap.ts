import { iconCanvas } from '../icons';
import type { Level } from '../level/level.ts';

/**
 * Карта с туманом войны в духе Diablo и Minecraft Dungeons (wiki/design-inventory.md, «Карта»):
 * открывается там, где герой прошёл; проходимое — тёмно-синяя заливка с белым пиксельным контуром, как в MCD.
 * Рисуется в изометрии камеры (поворот на 45° и сжатие по вертикали): верх экрана — туда же, куда смотрит игра.
 * Три вида: мини-карта в углу, прозрачная карта поверх игры (Tab, как в Diablo II) и полная карта (M).
 *
 * Клетка — колонна блоков: «пол», если на неё можно встать (верх выше соседей меньше чем на 1,5 м), «вода», иначе «стена».
 */

export interface MapMarker { x: number; z: number; icon: string; /** Серый (сундук уже открыт) */ dim?: boolean; /** Виден и без разведки */ always?: boolean }
export interface MapView { x: number; z: number; yaw: number }

const FLOOR = 1, WATER = 2, WALL = 3;
/** Пикселей холста на клетку */
const S = 6;
/** Сжатие по вертикали: камера смотрит сверху под ≈ 44° */
const SQUASH = 0.7;
const C = Math.SQRT1_2;
const FILL = '#2c3a50', WATER_FILL = '#2c4f74', EDGE = '#f2f4f8';

export class AutoMap {
  readonly minX: number;
  readonly minZ: number;
  readonly w: number;
  readonly h: number;
  private readonly kind: Uint8Array;
  private readonly seen: Uint8Array;
  /** Разведанное, клетка — S × S пикселей */
  readonly art: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  /** Только контур разведанного — для прозрачной карты поверх игры */
  private readonly lines: HTMLCanvasElement;
  private readonly lg: CanvasRenderingContext2D;
  private walkable = 0;
  private opened = 0;
  private readonly icons = new Map<string, HTMLCanvasElement>();

  constructor(level: Level) {
    const b = level.getBounds() ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0, minY: 0, maxY: 0 };
    this.minX = b.minX; this.minZ = b.minZ;
    this.w = b.maxX - b.minX + 1; this.h = b.maxZ - b.minZ + 1;
    const N = this.w * this.h;
    const top = new Float32Array(N).fill(-Infinity);
    const water = new Uint8Array(N);
    level.forEach((x, y, z, id) => {
      const d = level.defOf(id);
      const k = (z - b.minZ) * this.w + (x - b.minX);
      const wet = /water|acid/.test(d.name);
      if (!d.collide && !wet) return;
      const H = y + (wet ? 0.5 : d.collide);
      if (H > top[k]) { top[k] = H; water[k] = wet ? 1 : 0; }
    });
    this.kind = new Uint8Array(N);
    for (let z = 0; z < this.h; z++) for (let x = 0; x < this.w; x++) {
      const k = z * this.w + x;
      if (top[k] === -Infinity) continue;
      let lo = Infinity;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h) continue;
        const t = top[nz * this.w + nx];
        if (t > -Infinity) lo = Math.min(lo, t);
      }
      this.kind[k] = water[k] ? WATER : top[k] - (lo === Infinity ? top[k] : lo) >= 1.5 ? WALL : FLOOR;
      if (this.kind[k] !== WALL) this.walkable++;
    }
    this.seen = new Uint8Array(N);
    this.art = document.createElement('canvas');
    this.art.width = this.w * S; this.art.height = this.h * S;
    this.g = this.art.getContext('2d') as CanvasRenderingContext2D;
    this.lines = document.createElement('canvas');
    this.lines.width = this.art.width; this.lines.height = this.art.height;
    this.lg = this.lines.getContext('2d') as CanvasRenderingContext2D;
  }

  /** Доля разведанного, 0..1 */
  get explored(): number { return this.walkable ? this.opened / this.walkable : 0; }

  private open(i: number, j: number): boolean { const k = this.kind[j * this.w + i]; return k === FLOOR || k === WATER; }

  /** Открыть клетки в радиусе r вокруг точки; true — открылось новое */
  reveal(x: number, z: number, r = 13): boolean {
    const cx = Math.round(x) - this.minX, cz = Math.round(z) - this.minZ;
    let any = false;
    for (let j = Math.max(0, cz - r); j <= Math.min(this.h - 1, cz + r); j++) for (let i = Math.max(0, cx - r); i <= Math.min(this.w - 1, cx + r); i++) {
      const k = j * this.w + i;
      if (this.seen[k] || (i - cx) ** 2 + (j - cz) ** 2 > r * r) continue;
      this.seen[k] = 1;
      any = true;
      if (this.kind[k] === FLOOR || this.kind[k] === WATER) { this.opened++; this.paint(i, j); }
    }
    return any;
  }

  /** Открыть всё (для проверки) */
  revealAll(): void { for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) { const k = j * this.w + i; if (!this.seen[k]) { this.seen[k] = 1; if (this.open(i, j)) { this.opened++; this.paint(i, j); } } } }

  isSeen(x: number, z: number): boolean {
    const i = Math.round(x) - this.minX, j = Math.round(z) - this.minZ;
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.seen[j * this.w + i] === 1;
  }

  /** Клетка: заливка и белый контур там, где сосед — стена или пустота */
  private paint(i: number, j: number): void {
    const g = this.g, k = this.kind[j * this.w + i], px = i * S, py = j * S;
    g.fillStyle = k === WATER ? WATER_FILL : FILL;
    g.fillRect(px, py, S, S);
    const L = 2;
    for (const c of [g, this.lg]) {
      c.fillStyle = EDGE;
      if (i === 0 || !this.open(i - 1, j)) c.fillRect(px, py, L, S);
      if (i === this.w - 1 || !this.open(i + 1, j)) c.fillRect(px + S - L, py, L, S);
      if (j === 0 || !this.open(i, j - 1)) c.fillRect(px, py, S, L);
      if (j === this.h - 1 || !this.open(i, j + 1)) c.fillRect(px, py + S - L, S, L);
    }
    // редкие белые ромбики по полу, как камешки на карте MCD
    if (k === FLOOR && ((i * 73856093) ^ (j * 19349663)) % 61 === 0) { g.fillRect(px + 2, py + 1, 2, 1); g.fillRect(px + 1, py + 2, 4, 2); g.fillRect(px + 2, py + 4, 2, 1); }
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
    ctx.translate(-(ox - this.minX + 0.5) * S, -(oz - this.minZ + 0.5) * S);
    if (lines) { ctx.globalAlpha = alpha * 0.22; ctx.drawImage(this.art, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(this.lines, 0, 0); }
    else ctx.drawImage(this.art, 0, 0);
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
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) if (this.seen[j * this.w + i] && this.open(i, j)) {
      x0 = Math.min(x0, i); x1 = Math.max(x1, i); z0 = Math.min(z0, j); z1 = Math.max(z1, j);
    }
    if (x0 === Infinity) { x0 = 0; x1 = this.w - 1; z0 = 0; z1 = this.h - 1; }
    const ox = this.minX + (x0 + x1) / 2, oz = this.minZ + (z0 + z1) / 2;
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
