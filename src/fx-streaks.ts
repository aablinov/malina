import * as THREE from 'three';

/**
 * Glowing streak ribbons behind a flying "head" (wiki/design-weapon-arts.md, section 7): souls, drops, stars, lightning arcs
 * and crescents fly along curves with a juicy tail behind them — a bright core and a wide soft halo, narrowing and fading towards the end.
 * The head moves along the function path(k) (k — flight fraction 0..1), the ribbon is the history of its positions over the last tail seconds;
 * always faces the camera. All ribbons are one mesh with dynamic buffers, one draw call; room for 96 ribbons,
 * the oldest gives way (wiki/dev-performance.md).
 */

const MAX = 96;
const PTS = 28;
/** Two strips per ribbon: halo and core */
const STRIPS = 2;
const VPS = PTS * 2; // vertices per strip

export interface StreakOptions {
  /** Where the head is at fraction k = 0..1 */
  path: (k: number, out: THREE.Vector3) => THREE.Vector3;
  /** Head flight time, s */
  dur: number;
  /** Head colour (HDR) and tail colour */
  color: THREE.Color;
  color2?: THREE.Color;
  /** Core width at the head, m */
  width: number;
  /** Tail length, s */
  tail?: number;
  /** Halo: how many times wider than the core (0 — none) */
  halo?: number;
  /** White core at the head: 1 — white hot, 0 — pure colour (fire, blood) */
  core?: number;
  /** Every frame of the flight — where the head is (sparks, light) */
  onHead?: (p: THREE.Vector3, k: number) => void;
  /** The head has arrived */
  onEnd?: (p: THREE.Vector3) => void;
}

interface Streak {
  o: StreakOptions;
  t: number;
  /** Head history: x, y, z, time */
  hist: Float32Array;
  n: number;
  head: number;
  alive: boolean;
  ended: boolean;
  start: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Streaks {
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mesh: THREE.Mesh;
  private readonly list: Streak[] = [];
  private next = 0;
  private time = 0;

  private readonly camera: THREE.Camera;
  constructor(scene: THREE.Scene, camera: THREE.Camera) { this.camera = camera;
    const nv = MAX * STRIPS * VPS;
    this.pos = new Float32Array(nv * 3);
    this.col = new Float32Array(nv * 3);
    const idx: number[] = [];
    for (let s = 0; s < MAX * STRIPS; s++) {
      const o = s * VPS;
      for (let i = 0; i < PTS - 1; i++) { const a = o + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
    for (let i = 0; i < MAX; i++) this.list.push({ o: null as unknown as StreakOptions, t: 0, hist: new Float32Array(PTS * 4), n: 0, head: 0, alive: false, ended: false, start: 0 });
  }

  get count(): number { return this.list.filter((s) => s.alive).length; }

  /** Launch a ribbon */
  add(o: StreakOptions): void {
    let s = this.list.find((x) => !x.alive);
    if (!s) { s = this.list[this.next]; this.next = (this.next + 1) % MAX; }
    s.o = o; s.t = 0; s.n = 0; s.head = 0; s.alive = true; s.ended = false; s.start = this.time;
    this.sample(s, 0);
  }

  private sample(s: Streak, k: number): void {
    s.o.path(Math.min(1, k), _p);
    const i = s.head;
    s.hist[i * 4] = _p.x; s.hist[i * 4 + 1] = _p.y; s.hist[i * 4 + 2] = _p.z; s.hist[i * 4 + 3] = this.time;
    s.head = (s.head + 1) % PTS;
    s.n = Math.min(PTS, s.n + 1);
  }

  update(dt: number): void {
    this.time += dt;
    let any = false;
    for (let si = 0; si < MAX; si++) {
      const s = this.list[si];
      const base = si * STRIPS * VPS;
      if (!s.alive) { this.blank(base); continue; }
      const o = s.o, tail = o.tail ?? 0.25;
      s.t += dt;
      const k = s.t / o.dur;
      if (!s.ended) {
        this.sample(s, k);
        o.onHead?.(_p, Math.min(1, k));
        if (k >= 1) { s.ended = true; o.onEnd?.(_p.clone()); }
      }
      // after the flight ends the tail drains over tail
      if (s.ended && this.time - this.newest(s) > tail) { s.alive = false; this.blank(base); continue; }
      any = true;
      this.write(s, base, tail);
    }
    this.mesh.visible = any;
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }

  private newest(s: Streak): number { return s.hist[((s.head - 1 + PTS) % PTS) * 4 + 3]; }

  private blank(base: number): void {
    // invisible strip: zero colour (additively draws nothing)
    if (this.col[base * 3] === 0 && this.col[base * 3 + 3] === 0) return;
    this.col.fill(0, base * 3, (base + STRIPS * VPS) * 3);
  }

  /** Ribbon strips: from head to tail, width and brightness fall with the point's age */
  private write(s: Streak, base: number, tail: number): void {
    const o = s.o, cam = this.camera.position, c1 = o.color, c2 = o.color2 ?? o.color;
    const halo = o.halo ?? 2.6;
    for (let strip = 0; strip < STRIPS; strip++) {
      const wMul = strip === 0 ? halo : 1, bright = strip === 0 ? 0.28 : 1;
      const vb = base + strip * VPS;
      for (let j = 0; j < PTS; j++) {
        const idx = Math.min(j, s.n - 1);
        const hi = ((s.head - 1 - idx) % PTS + PTS) % PTS;
        _a.set(s.hist[hi * 4], s.hist[hi * 4 + 1], s.hist[hi * 4 + 2]);
        const age = (this.time - s.hist[hi * 4 + 3]) / tail;
        // direction along the ribbon — towards the neighbouring point
        const nj = Math.min(idx + 1, s.n - 1), pj = Math.max(idx - 1, 0);
        const ni = ((s.head - 1 - nj) % PTS + PTS) % PTS, pi = ((s.head - 1 - pj) % PTS + PTS) % PTS;
        _b.set(s.hist[ni * 4], s.hist[ni * 4 + 1], s.hist[ni * 4 + 2]);
        _d.set(s.hist[pi * 4], s.hist[pi * 4 + 1], s.hist[pi * 4 + 2]).sub(_b);
        _v.copy(cam).sub(_a);
        _s.crossVectors(_d, _v);
        const L = _s.length();
        const life = j >= s.n ? 0 : Math.max(0, 1 - age);
        const w = o.width * wMul * (0.15 + 0.85 * life) * 0.5;
        if (L > 1e-6) _s.multiplyScalar(w / L); else _s.set(0, w, 0);
        const v = (vb + j * 2) * 3;
        this.pos[v] = _a.x + _s.x; this.pos[v + 1] = _a.y + _s.y; this.pos[v + 2] = _a.z + _s.z;
        this.pos[v + 3] = _a.x - _s.x; this.pos[v + 4] = _a.y - _s.y; this.pos[v + 5] = _a.z - _s.z;
        // the head is hotter (with white), towards the tail — the second colour
        const f = life * life * bright, hot = strip === 1 ? life * life * life * 1.2 * (o.core ?? 1) : 0, m = Math.min(1, age * 1.4);
        const r = (c1.r + (c2.r - c1.r) * m) * f + hot, g = (c1.g + (c2.g - c1.g) * m) * f + hot, b = (c1.b + (c2.b - c1.b) * m) * f + hot;
        this.col[v] = r; this.col[v + 1] = g; this.col[v + 2] = b;
        this.col[v + 3] = r; this.col[v + 4] = g; this.col[v + 5] = b;
      }
    }
  }
}
