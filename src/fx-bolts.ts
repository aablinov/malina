import * as THREE from 'three';

/**
 * Молнии и огненные кубы одним InstancedMesh на слой (wiki/dev-performance.md): раньше каждый сегмент молнии был
 * отдельным мешем со своим материалом (до 60 на небесный разряд), теперь — экземпляр с цветом и прозрачностью
 * в атрибутах. Ничего не создаётся в бою; при нехватке места самые старые уступают.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Материал с прозрачностью на экземпляр: атрибут aAlpha умножает альфу */
function alphaMaterial(additive: boolean): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: '#ffffff', toneMapped: false, transparent: true, depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha; varying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );');
  };
  m.customProgramCacheKey = () => 'instAlpha';
  return m;
}

/** Слой экземпляров-кубов с цветом и альфой */
class Layer {
  readonly mesh: THREE.InstancedMesh;
  readonly alpha: THREE.InstancedBufferAttribute;
  /** Сколько экземпляров рисовать: верхняя граница занятых слотов */
  used = 0;

  readonly cap: number;
  constructor(scene: THREE.Scene, cap: number, additive: boolean) { this.cap = cap;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.alpha);
    this.mesh = new THREE.InstancedMesh(geo, alphaMaterial(additive), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < cap; i++) { this.mesh.setColorAt(i, _c.set(1, 1, 1)); this.mesh.setMatrixAt(i, ZERO); }
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  set(i: number, m: THREE.Matrix4, color: THREE.Color, alpha: number): void {
    this.mesh.setMatrixAt(i, m);
    this.mesh.setColorAt(i, color);
    this.alpha.setX(i, alpha);
  }

  clear(i: number): void { this.mesh.setMatrixAt(i, ZERO); }

  flush(): void {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}

/** Одна молния: отрезок слотов [start, start + n) в обоих слоях */
interface Bolt { start: number; n: number; t: number; dur: number; core: THREE.Color; halo: THREE.Color; shrink: number; alive: boolean }

/** Сегмент: позиция, поворот, длина и ширина — чтобы пересчитывать матрицу при усадке */
const SEG = 9; // px py pz qx qy qz qw len w

export class Bolts {
  private readonly core: Layer;
  private readonly halo: Layer;
  private readonly seg: Float32Array;
  private readonly bolts: Bolt[] = [];
  private cursor = 0;

  private readonly cap: number;
  constructor(scene: THREE.Scene, cap: number = 2048) { this.cap = cap;
    this.core = new Layer(scene, cap, false);
    this.halo = new Layer(scene, cap, true);
    this.seg = new Float32Array(cap * SEG);
  }

  /** Ломаная молния из брусков: ядро и мягкий ореол, мерцает и тает; branches — отростки */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, width: number, branches: number, dur = 0.32): void {
    const len = from.distanceTo(to);
    const nMain = Math.max(3, Math.round(len * 1.2));
    const total = nMain + branches * 3;
    if (total > this.cap) return;
    // место: подряд, с переносом в начало; чьи слоты заняли — те молнии гаснут
    if (this.cursor + total > this.cap) this.cursor = 0;
    const start = this.cursor;
    this.cursor += total;
    for (const b of this.bolts) if (b.alive && b.start < start + total && start < b.start + b.n) this.kill(b);
    let i = start;
    const seg = (a: THREE.Vector3, b: THREE.Vector3, w: number): void => {
      const l = a.distanceTo(b), o = i * SEG;
      i++;
      if (l < 1e-3) { this.seg[o + 7] = 0; return; }
      _p.copy(a).lerp(b, 0.5);
      _dir.copy(b).sub(a).normalize();
      _m.lookAt(_dir, _s.set(0, 0, 0), _up);
      _q.setFromRotationMatrix(_m);
      this.seg[o] = _p.x; this.seg[o + 1] = _p.y; this.seg[o + 2] = _p.z;
      this.seg[o + 3] = _q.x; this.seg[o + 4] = _q.y; this.seg[o + 5] = _q.z; this.seg[o + 6] = _q.w;
      this.seg[o + 7] = l; this.seg[o + 8] = w;
    };
    const path = (a: THREE.Vector3, b: THREE.Vector3, n: number, jag: number, w: number): THREE.Vector3[] => {
      const pts = [a.clone()];
      for (let k = 1; k < n; k++) pts.push(a.clone().lerp(b, k / n).add(new THREE.Vector3(rnd(-jag, jag), rnd(-jag, jag) * 0.5, rnd(-jag, jag))));
      pts.push(b.clone());
      for (let k = 0; k < pts.length - 1; k++) seg(pts[k], pts[k + 1], w);
      return pts;
    };
    const pts = path(from, to, nMain, Math.min(0.9, len * 0.07), width);
    for (let k = 0; k < branches; k++) {
      const p = pts[1 + Math.floor(Math.random() * (pts.length - 2))];
      path(p, p.clone().add(new THREE.Vector3(rnd(-1.6, 1.6), rnd(-1.8, -0.4), rnd(-1.6, 1.6))), 3, 0.3, width * 0.55);
    }
    const b: Bolt = {
      start, n: total, t: 0, dur, alive: true, shrink: 1,
      core: new THREE.Color(3.6, 3.8, 4).lerp(color, 0.25), halo: color.clone().multiplyScalar(0.5),
    };
    this.bolts.push(b);
    this.core.used = this.halo.used = Math.max(this.core.used, start + total);
    this.write(b, 1, 0.5, true);
  }

  private kill(b: Bolt): void {
    b.alive = false;
    for (let i = b.start; i < b.start + b.n; i++) { this.core.clear(i); this.halo.clear(i); }
  }

  private write(b: Bolt, aCore: number, aHalo: number, visible: boolean): void {
    for (let i = b.start; i < b.start + b.n; i++) {
      const o = i * SEG, len = this.seg[o + 7];
      if (!len || !visible) { this.core.clear(i); this.halo.clear(i); continue; }
      const w = this.seg[o + 8] * b.shrink;
      _p.set(this.seg[o], this.seg[o + 1], this.seg[o + 2]);
      _q.set(this.seg[o + 3], this.seg[o + 4], this.seg[o + 5], this.seg[o + 6]);
      _m.compose(_p, _q, _s.set(w, w, len));
      this.core.set(i, _m, b.core, aCore);
      _m.compose(_p, _q, _s.set(w * 3.5, w * 3.5, len));
      this.halo.set(i, _m, b.halo, aHalo);
    }
  }

  update(dt: number): void {
    let live = 0;
    for (let j = this.bolts.length - 1; j >= 0; j--) {
      const b = this.bolts[j];
      if (!b.alive) { this.bolts.splice(j, 1); continue; }
      b.t += dt;
      const k = b.t / b.dur;
      if (k >= 1) { this.kill(b); this.bolts.splice(j, 1); continue; }
      b.shrink *= 0.97;
      // мерцание: в первой половине жизни случайные кадры гаснут
      this.write(b, 1 - k * k, 0.5 * (1 - k), k > 0.5 || Math.random() > 0.25);
      live++;
    }
    if (!live) { this.core.used = this.halo.used = 0; this.cursor = 0; }
    this.core.flush(); this.halo.flush();
  }
}

/** Огненный куб: летит от центра, кувыркается, раздувается и гаснет */
const CUBE = 16; // mx my mz vx vy vz sx sy sz t dur size r g b _
export class Cubes {
  private readonly layer: Layer;
  private readonly d: Float32Array;
  private n = 0;

  private readonly cap: number;
  constructor(scene: THREE.Scene, cap: number = 512, additive = true) { this.cap = cap;
    this.layer = new Layer(scene, cap, additive);
    this.d = new Float32Array(cap * CUBE);
  }

  /** n кубов из точки mid разлетаются на R; цвета — случайно из списка; size — базовый размер */
  burst(mid: THREE.Vector3, R: number, n: number, colors: THREE.Color[], size: number, life: [number, number] = [0.35, 0.6]): void {
    for (let k = 0; k < n; k++) {
      let i: number;
      if (this.n < this.cap) i = this.n++; else i = Math.floor(Math.random() * this.cap);
      const o = i * CUBE, d = this.d;
      _dir.set(rnd(-1, 1), rnd(0.2, 1.1), rnd(-1, 1)).normalize().multiplyScalar(R * rnd(0.5, 1));
      d[o] = mid.x; d[o + 1] = mid.y; d[o + 2] = mid.z;
      d[o + 3] = _dir.x; d[o + 4] = _dir.y; d[o + 5] = _dir.z;
      d[o + 6] = rnd(-6, 6); d[o + 7] = rnd(-6, 6); d[o + 8] = rnd(-6, 6);
      d[o + 9] = 0; d[o + 10] = rnd(life[0], life[1]); d[o + 11] = size;
      const c = colors[Math.floor(Math.random() * colors.length)];
      d[o + 12] = c.r; d[o + 13] = c.g; d[o + 14] = c.b;
    }
    this.layer.used = this.n;
  }

  update(dt: number): void {
    const d = this.d;
    for (let i = this.n - 1; i >= 0; i--) {
      const o = i * CUBE;
      d[o + 9] += dt;
      const t = d[o + 9] / d[o + 10];
      if (t >= 1) {
        const last = --this.n;
        if (i !== last) d.copyWithin(o, last * CUBE, last * CUBE + CUBE);
        this.layer.clear(last);
        continue;
      }
      const e = 1 - (1 - t) ** 3;
      _p.set(d[o] + d[o + 3] * e, d[o + 1] + d[o + 4] * e, d[o + 2] + d[o + 5] * e);
      _q.setFromEuler(new THREE.Euler(d[o + 6] * t, d[o + 7] * t, d[o + 8] * t));
      const sc = d[o + 11] * (0.6 + t * 1.2) * (1 - t * 0.6);
      _m.compose(_p, _q, _s.setScalar(sc));
      this.layer.set(i, _m, _c.setRGB(d[o + 12], d[o + 13], d[o + 14]), 1 - t * t);
    }
    this.layer.used = this.n;
    this.layer.flush();
  }
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
