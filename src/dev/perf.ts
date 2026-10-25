import * as THREE from 'three';

/**
 * Замеры кадра (F8, wiki/dev-performance.md): сколько миллисекунд ушло на симуляцию и на рендер, сколько вызовов
 * отрисовки, треугольников, шейдерных программ, геометрий и текстур живёт в рендерере. Длинные кадры (дольше LONG_MS)
 * копятся в журнал с метками причин — код ставит `perf.mark('fountain')` в точках, где рождаются тяжёлые эффекты.
 * GPU-время — через EXT_disjoint_timer_query_webgl2, если браузер даёт (в Chrome на Mac обычно нет → «н/д»).
 */

export interface PerfFrame {
  /** Стенное время кадра, мс (между двумя requestAnimationFrame) */
  ms: number;
  /** Симуляция: сумма всех tick за кадр */
  tickMs: number;
  /** Рендер: камера, HUD, композер */
  renderMs: number;
  /** GPU, мс; -1 — нет данных */
  gpuMs: number;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  /** Метки причин, поставленные в этом кадре */
  marks: string[];
}

export interface PerfSnapshot {
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  avgTickMs: number;
  avgRenderMs: number;
  gpuMs: number;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  /** Длинные кадры с момента reset(): время, мс и метки */
  long: { t: number; ms: number; tickMs: number; renderMs: number; marks: string[] }[];
}

export const LONG_MS = 25;
const WINDOW = 120;
const LONG_MAX = 64;

interface GpuTimer {
  ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
  gl: WebGL2RenderingContext;
  pending: WebGLQuery[];
  active: WebGLQuery | null;
  last: number;
}

export class Perf {
  private readonly ring: PerfFrame[] = [];
  private head = 0;
  private readonly long: PerfSnapshot['long'] = [];
  private marks: string[] = [];
  private tickMs = 0;
  private renderMs = 0;
  private t0 = 0;
  private time = 0;
  private readonly gpu: GpuTimer | null;
  /** Включён ли сбор (иначе ничего не стоит) */
  enabled = true;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    // info сбрасывается руками: композер делает несколько проходов за кадр, и автосброс считал бы только последний
    renderer.info.autoReset = false;
    this.gpu = initGpuTimer(renderer);
  }

  /** Начало кадра: обнулить счётчики рендерера */
  begin(): void {
    if (!this.enabled) return;
    this.renderer.info.reset();
    this.tickMs = 0; this.renderMs = 0;
  }

  /** Метка причины тяжёлого кадра: ставится в точках спавна эффектов */
  mark(tag: string): void {
    if (this.enabled && this.marks.length < 16) this.marks.push(tag);
  }

  /** Обёртки замеров: измеряют стенное время блока */
  tickStart(): void { this.t0 = performance.now(); }
  tickEnd(): void { this.tickMs += performance.now() - this.t0; }
  renderStart(): void {
    this.t0 = performance.now();
    if (this.gpu) gpuBegin(this.gpu);
  }
  renderEnd(): void {
    this.renderMs += performance.now() - this.t0;
    if (this.gpu) gpuEnd(this.gpu);
  }

  /** Конец кадра: real — стенное время кадра в секундах */
  end(real: number): PerfFrame | null {
    if (!this.enabled) return null;
    this.time += real;
    const info = this.renderer.info;
    const f: PerfFrame = {
      ms: real * 1000, tickMs: this.tickMs, renderMs: this.renderMs, gpuMs: this.gpu ? gpuPoll(this.gpu) : -1,
      calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries, textures: info.memory.textures, marks: this.marks,
    };
    this.marks = [];
    this.ring[this.head] = f;
    this.head = (this.head + 1) % WINDOW;
    if (f.ms > LONG_MS) {
      this.long.push({ t: this.time, ms: f.ms, tickMs: f.tickMs, renderMs: f.renderMs, marks: f.marks });
      if (this.long.length > LONG_MAX) this.long.shift();
    }
    return f;
  }

  /** Сбросить журнал длинных кадров и окно */
  reset(): void {
    this.ring.length = 0; this.head = 0; this.long.length = 0; this.time = 0;
  }

  /** Сводка по окну последних кадров */
  snapshot(): PerfSnapshot {
    const fs = this.ring.filter(Boolean);
    const n = fs.length || 1;
    const ms = fs.map((f) => f.ms).sort((a, b) => a - b);
    const last = fs.length ? this.ring[(this.head + WINDOW - 1) % WINDOW] : null;
    const avg = (k: (f: PerfFrame) => number) => fs.reduce((s, f) => s + k(f), 0) / n;
    return {
      frames: fs.length,
      avgMs: avg((f) => f.ms), p95Ms: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] ?? 0, maxMs: ms[ms.length - 1] ?? 0,
      avgTickMs: avg((f) => f.tickMs), avgRenderMs: avg((f) => f.renderMs),
      gpuMs: last?.gpuMs ?? -1,
      calls: last?.calls ?? 0, triangles: last?.triangles ?? 0, programs: last?.programs ?? 0,
      geometries: last?.geometries ?? 0, textures: last?.textures ?? 0,
      long: [...this.long],
    };
  }

  /** Строки для оверлея F8 */
  html(): string {
    const s = this.snapshot();
    const fps = s.avgMs > 0 ? 1000 / s.avgMs : 0;
    const gpu = s.gpuMs >= 0 ? `${s.gpuMs.toFixed(1)}` : 'н/д';
    const lastLong = s.long[s.long.length - 1];
    return [
      `<b>${fps.toFixed(0)}</b> FPS · кадр ${s.avgMs.toFixed(1)} мс · p95 ${s.p95Ms.toFixed(1)} · макс ${s.maxMs.toFixed(1)}`,
      `CPU: симуляция ${s.avgTickMs.toFixed(1)} · рендер ${s.avgRenderMs.toFixed(1)} · GPU ${gpu}`,
      `вызовов ${s.calls} · треугольников ${(s.triangles / 1000).toFixed(0)}k · программ ${s.programs}`,
      `геометрий ${s.geometries} · текстур ${s.textures} · длинных кадров ${s.long.length}`,
      lastLong ? `<span class="bad">последний длинный: ${lastLong.ms.toFixed(0)} мс${lastLong.marks.length ? ` (${lastLong.marks.join(', ')})` : ''}</span>` : '',
    ].filter(Boolean).join('<br>');
  }
}

function initGpuTimer(renderer: THREE.WebGLRenderer): GpuTimer | null {
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) return null;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['ext'] | null;
  if (!ext) return null;
  return { ext, gl, pending: [], active: null, last: -1 };
}

function gpuBegin(t: GpuTimer): void {
  if (t.active || t.pending.length > 4) return;
  const q = t.gl.createQuery();
  if (!q) return;
  t.gl.beginQuery(t.ext.TIME_ELAPSED_EXT, q);
  t.active = q;
}

function gpuEnd(t: GpuTimer): void {
  if (!t.active) return;
  t.gl.endQuery(t.ext.TIME_ELAPSED_EXT);
  t.pending.push(t.active);
  t.active = null;
}

/** Забрать готовые результаты; возвращает последнее известное GPU-время, мс */
function gpuPoll(t: GpuTimer): number {
  const { gl } = t;
  while (t.pending.length) {
    const q = t.pending[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
    const disjoint = gl.getParameter(t.ext.GPU_DISJOINT_EXT) as boolean;
    if (!disjoint) t.last = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
    gl.deleteQuery(q);
    t.pending.shift();
  }
  return t.last;
}
