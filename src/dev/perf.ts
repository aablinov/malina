import * as THREE from 'three';
import { t } from '../i18n/i18n.ts';

/**
 * Frame measurements (F8, wiki/dev-performance.md): how many milliseconds went to the simulation and to the render, how many draw
 * calls, triangles, shader programs, geometries and textures live in the renderer. Long frames (longer than LONG_MS)
 * accumulate in a log with cause marks — the code puts `perf.mark('fountain')` where heavy effects are born.
 * GPU time — via EXT_disjoint_timer_query_webgl2 when the browser provides it (Chrome on Mac usually does not → "n/a").
 */

export interface PerfFrame {
  /** Wall time of the frame, ms (between two requestAnimationFrame) */
  ms: number;
  /** Simulation: the sum of all ticks in the frame */
  tickMs: number;
  /** Render: camera, HUD, composer */
  renderMs: number;
  /** GPU, ms; -1 — no data */
  gpuMs: number;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  /** Cause marks set in this frame */
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
  /** Long frames since reset(): time, ms and marks */
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
  /** Whether collection is on (otherwise it costs nothing) */
  enabled = true;

  private readonly renderer: THREE.WebGLRenderer;
  constructor(renderer: THREE.WebGLRenderer) { this.renderer = renderer;
    // info is reset by hand: the composer makes several passes per frame, and auto-reset would count only the last one
    renderer.info.autoReset = false;
    this.gpu = initGpuTimer(renderer);
  }

  /** Frame start: zero the renderer counters */
  begin(): void {
    if (!this.enabled) return;
    this.renderer.info.reset();
    this.tickMs = 0; this.renderMs = 0;
  }

  /** Cause mark of a heavy frame: set where effects spawn */
  mark(tag: string): void {
    if (this.enabled && this.marks.length < 16) this.marks.push(tag);
  }

  /** Measurement wrappers: measure the wall time of a block */
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

  /** Frame end: real — wall time of the frame in seconds */
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

  /** Reset the long-frame log and the window */
  reset(): void {
    this.ring.length = 0; this.head = 0; this.long.length = 0; this.time = 0;
  }

  /** Summary over the window of recent frames */
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

  /** Lines for the F8 overlay */
  html(): string {
    const s = this.snapshot();
    const fps = s.avgMs > 0 ? 1000 / s.avgMs : 0;
    const gpu = s.gpuMs >= 0 ? `${s.gpuMs.toFixed(1)}` : t('n/a');
    const lastLong = s.long[s.long.length - 1];
    return [
      t('<b>{fps}</b> FPS · frame {avg} ms · p95 {p95} · max {max}', { fps: fps.toFixed(0), avg: s.avgMs.toFixed(1), p95: s.p95Ms.toFixed(1), max: s.maxMs.toFixed(1) }),
      t('CPU: simulation {tick} · render {render} · GPU {gpu}', { tick: s.avgTickMs.toFixed(1), render: s.avgRenderMs.toFixed(1), gpu }),
      t('calls {calls} · triangles {tris}k · programs {programs}', { calls: s.calls, tris: (s.triangles / 1000).toFixed(0), programs: s.programs }),
      t('geometries {geometries} · textures {textures} · long frames {long}', { geometries: s.geometries, textures: s.textures, long: s.long.length }),
      lastLong ? `<span class="bad">${t('last long: {ms} ms', { ms: lastLong.ms.toFixed(0) })}${lastLong.marks.length ? ` (${lastLong.marks.join(', ')})` : ''}</span>` : '',
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

/** Collect finished results; returns the last known GPU time, ms */
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
