import * as THREE from 'three';
import type { Textures } from './textures.ts';
import { FxPool } from './pool.ts';
import { Bolts, Cubes } from './fx-bolts.ts';
import { Streaks, type StreakOptions } from './fx-streaks.ts';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

export type ColorLike = THREE.ColorRepresentation;
export type RGB = readonly [number, number, number];

export interface SpawnOptions {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life?: number;
  size?: number;
  color?: ColorLike;
  gravity?: number;
  spin?: number;
  drag?: number;
  shrink?: boolean;
}

export interface BurstOptions {
  speed?: number;
  size?: number;
  life?: number;
  up?: number;
  glow?: boolean;
  gravity?: number;
  drag?: number;
}

/** Временный объект эффекта: живёт dur секунд, каждый кадр получает долю 0..1 */
interface Transient {
  obj: THREE.Object3D;
  t: number;
  dur: number;
  tick(k: number): void;
  dispose(): void;
}

interface FloatText {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  dur: number;
  dx: number;
}
/** Сколько цифр урона на экране одновременно: дальше самая старая уступает место */
const MAX_TEXTS = 48;

/**
 * Пул кубиков-частиц, рисуется одним InstancedMesh. Данные — в типизированных массивах (структура массивов), живые
 * частицы лежат плотно в начале; смерть — свап с последней. Спавн ничего не выделяет; при переполнении самая старая
 * частица уступает место (wiki/dev-performance.md)
 */
const F = 20; // полей на частицу
const P_POS = 0, P_VEL = 3, P_LIFE = 6, P_MAX = 7, P_SIZE = 8, P_COL = 9, P_GRAV = 12, P_ROT = 13, P_SPIN = 16, P_DRAG = 17, P_SHRINK = 18;
class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly d: Float32Array;
  private n = 0;
  private oldest = 0;

  private readonly max: number;
  private readonly ground: boolean;
  constructor(scene: THREE.Scene, max: number, material: THREE.Material, ground: boolean = true) { this.max = max; this.ground = ground;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.set(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.d = new Float32Array(max * F);
    scene.add(this.mesh);
  }

  get count(): number { return this.n; }

  spawn(p: SpawnOptions): void {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else { i = this.oldest; this.oldest = (this.oldest + 1) % this.max; }
    const d = this.d, o = i * F;
    d[o + P_POS] = p.pos.x; d[o + P_POS + 1] = p.pos.y; d[o + P_POS + 2] = p.pos.z;
    if (p.vel) { d[o + P_VEL] = p.vel.x; d[o + P_VEL + 1] = p.vel.y; d[o + P_VEL + 2] = p.vel.z; } else d[o + P_VEL] = d[o + P_VEL + 1] = d[o + P_VEL + 2] = 0;
    d[o + P_LIFE] = d[o + P_MAX] = p.life ?? 1;
    d[o + P_SIZE] = p.size ?? 0.15;
    _c.set(p.color ?? '#fff');
    d[o + P_COL] = _c.r; d[o + P_COL + 1] = _c.g; d[o + P_COL + 2] = _c.b;
    d[o + P_GRAV] = p.gravity ?? 12;
    d[o + P_ROT] = Math.random() * 6; d[o + P_ROT + 1] = Math.random() * 6; d[o + P_ROT + 2] = Math.random() * 6;
    d[o + P_SPIN] = p.spin ?? 6;
    d[o + P_DRAG] = p.drag ?? 0;
    d[o + P_SHRINK] = p.shrink ?? true ? 1 : 0;
  }

  update(dt: number): void {
    const d = this.d;
    for (let i = this.n - 1; i >= 0; i--) {
      const o = i * F;
      d[o + P_LIFE] -= dt;
      if (d[o + P_LIFE] <= 0) {
        // свап с последней живой
        const last = --this.n;
        if (i !== last) d.copyWithin(o, last * F, last * F + F);
        continue;
      }
      d[o + P_VEL + 1] -= d[o + P_GRAV] * dt;
      const drag = d[o + P_DRAG];
      if (drag) { const k = Math.max(0, 1 - drag * dt); d[o + P_VEL] *= k; d[o + P_VEL + 1] *= k; d[o + P_VEL + 2] *= k; }
      d[o + P_POS] += d[o + P_VEL] * dt; d[o + P_POS + 1] += d[o + P_VEL + 1] * dt; d[o + P_POS + 2] += d[o + P_VEL + 2] * dt;
      const size = d[o + P_SIZE];
      if (this.ground && d[o + P_POS + 1] < size / 2) {
        d[o + P_POS + 1] = size / 2; d[o + P_VEL + 1] *= -0.3; d[o + P_VEL] *= 0.6; d[o + P_VEL + 2] *= 0.6; d[o + P_SPIN] *= 0.5;
      }
      const spin = d[o + P_SPIN];
      d[o + P_ROT] += spin * dt; d[o + P_ROT + 1] += spin * dt * 0.7;
    }
    if (this.oldest >= this.n) this.oldest = 0;
    const m = this.mesh, mat = m.instanceMatrix.array as Float32Array, col = m.instanceColor!.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const o = i * F;
      const k = d[o + P_SHRINK] ? Math.min(1, (d[o + P_LIFE] / d[o + P_MAX]) * 2.5) : 1;
      _s.setScalar(d[o + P_SIZE] * k);
      _q.setFromEuler(_e.set(d[o + P_ROT], d[o + P_ROT + 1], d[o + P_ROT + 2]));
      _v.set(d[o + P_POS], d[o + P_POS + 1], d[o + P_POS + 2]);
      _m.compose(_v, _q, _s);
      _m.toArray(mat, i * 16);
      col[i * 3] = d[o + P_COL]; col[i * 3 + 1] = d[o + P_COL + 1]; col[i * 3 + 2] = d[o + P_COL + 2];
    }
    m.count = this.n;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor!.needsUpdate = true;
  }
}

const additive = (color: THREE.Color, opacity = 1, map?: THREE.Texture) => new THREE.MeshBasicMaterial({
  color, ...(map ? { map } : {}), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
});

/** Общие ресурсы: их не трогает дефолтный dispose в FX.custom (wiki/dev-performance.md) */
const SHARED = new WeakSet<THREE.Material | THREE.BufferGeometry>();
export function markShared<T extends THREE.Material | THREE.BufferGeometry>(r: T): T { SHARED.add(r); return r; }
/** Освободить геометрию и материалы тела, кроме общих */
export function disposeOwned(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Sprite) && !(o instanceof THREE.Line) && !(o instanceof THREE.Points)) return;
    const g = (o as THREE.Mesh).geometry;
    if (g && !SHARED.has(g)) g.dispose();
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : [mats]) if (m && !SHARED.has(m)) m.dispose();
  });
}

/** Квантованные общие геометрии колец и дуг: ключ — толщина или размах с шагом 0,05 */
const ringGeos = new Map<string, THREE.RingGeometry>();
const ringGeo = (inner: number, segments: number, start = 0, length = Math.PI * 2): THREE.RingGeometry => {
  const q = Math.round(inner * 20) / 20, qs = Math.round(start * 20) / 20, ql = Math.round(length * 20) / 20;
  const key = `${q},${segments},${qs},${ql}`;
  let g = ringGeos.get(key);
  if (!g) ringGeos.set(key, g = markShared(new THREE.RingGeometry(q, 1, segments, 1, qs, ql)));
  return g;
};
/** Единичная плоскость: от (0,0) вверх до (0,1) — для черт; и центрированная — для декалей */
let planeUp: THREE.PlaneGeometry | null = null, planeC: THREE.PlaneGeometry | null = null;
const PLANE_UP = (): THREE.PlaneGeometry => planeUp ??= markShared(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0) as THREE.PlaneGeometry);
const PLANE_C = (): THREE.PlaneGeometry => planeC ??= markShared(new THREE.PlaneGeometry(1, 1));

/** Слот пула временных тел: материал свой на слот (цвет и прозрачность правятся), геометрия общая */
interface Slot<M extends THREE.Material> { obj: THREE.Mesh<THREE.BufferGeometry, M> | THREE.Sprite; mat: M; gen: number }

const WHITE = new THREE.Color(1, 1, 1);
/** Стена кольца: открытый цилиндр высотой 1 от земли вверх, текстура — яркий низ, тающий вверх */
let wallGeo: THREE.CylinderGeometry | null = null;
const WALL = (): THREE.CylinderGeometry => wallGeo ??= markShared(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0) as THREE.CylinderGeometry);
let wallT: THREE.CanvasTexture | null = null;
function wallTex(): THREE.CanvasTexture {
  if (wallT) return wallT;
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d')!, gr = g.createLinearGradient(0, 64, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  return wallT = new THREE.CanvasTexture(c);
}

/** Вспышка настоящего света: точечный источник из пула */
const SHOCK_COLOR = new THREE.Color(3, 0.6, 1.2);

interface LightFlash { light: THREE.PointLight; t: number; dur: number; peak: number }

export class FX {
  private readonly solid: Pool;
  private readonly glow: Pool;
  /** Молнии и светящиеся кубы — экземплярами (src/fx-bolts.ts) */
  private readonly bolts: Bolts;
  private readonly cubes: Cubes;
  private readonly cubesSolid: Cubes;
  /** Ленты-шлейфы по кривым (src/fx-streaks.ts) */
  private readonly streaks: Streaks;
  private readonly transients: Transient[] = [];
  /** Пулы временных тел: кольца, вспышки, дуги, черты, декали — ничего не создаётся в бою */
  private readonly shocks: FxPool<Slot<THREE.MeshBasicMaterial>>;
  private readonly flashes: FxPool<Slot<THREE.SpriteMaterial>>;
  private readonly planes: FxPool<Slot<THREE.MeshBasicMaterial>>;
  private readonly decals: FxPool<Slot<THREE.MeshBasicMaterial>>;
  private readonly texts: FloatText[] = [];
  private readonly freeTexts: FloatText[] = [];
  /** Пул света заклинаний: источники всегда в сцене (с нулевой силой), чтобы число огней не менялось и шейдеры не пересобирались */
  private readonly lights: LightFlash[] = [];
  private readonly flashEl: HTMLDivElement;
  private flashT = 0;
  private flashDur = 1;
  private flashPeak = 0;
  shake = 0;
  /** Стоп-кадр, с реального времени: пока > 0, цикл игры почти останавливает симуляцию */
  hitstop = 0;
  /** Замедление, с реального времени: пока > 0, игра идёт втрое медленнее (легендарные и мифические удары) */
  slowmo = 0;
  /** Камера подаётся назад: доля дистанции, тает сама */
  zoom = 0;
  private readonly darkEl: HTMLDivElement;
  private darkT = 0;
  private darkDur = 0;
  private readonly titleEl: HTMLDivElement;
  private titleT = 0;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly T: Textures;
  private readonly overlay: HTMLElement;
  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    T: Textures,
    overlay: HTMLElement) { this.scene = scene; this.camera = camera; this.T = T; this.overlay = overlay;
    this.solid = new Pool(scene, 900, new THREE.MeshLambertMaterial());
    const meshSlot = (): Slot<THREE.MeshBasicMaterial> => {
      const mat = markShared(additive(new THREE.Color('#fff')));
      const obj = new THREE.Mesh(PLANE_C(), mat);
      obj.matrixAutoUpdate = true;
      return { obj, mat, gen: 0 };
    };
    this.shocks = new FxPool(meshSlot, 48, 'drop');
    this.planes = new FxPool(meshSlot, 64, 'drop');
    this.decals = new FxPool(() => {
      const mat = markShared(new THREE.MeshBasicMaterial({ map: T.glow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      const obj = new THREE.Mesh(PLANE_C(), mat);
      obj.rotation.x = -Math.PI / 2;
      obj.renderOrder = 1;
      return { obj, mat, gen: 0 };
    }, 48, 'drop');
    this.flashes = new FxPool(() => {
      const mat = markShared(new THREE.SpriteMaterial({ map: T.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      return { obj: new THREE.Sprite(mat), mat, gen: 0 };
    }, 64, 'drop');
    this.solid.mesh.castShadow = true;
    this.glow = new Pool(scene, 800, new THREE.MeshBasicMaterial({ toneMapped: false }), true);
    this.bolts = new Bolts(scene);
    this.cubes = new Cubes(scene, 512, true);
    this.cubesSolid = new Cubes(scene, 256, false);
    this.streaks = new Streaks(scene, camera);
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 10, 1.4);
      light.position.set(0, -50, 0);
      scene.add(light);
      this.lights.push({ light, t: 1, dur: 1, peak: 0 });
    }
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'fx-flash';
    document.body.appendChild(this.flashEl);
    this.darkEl = document.createElement('div');
    this.darkEl.className = 'fx-dark';
    document.body.appendChild(this.darkEl);
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'fx-title';
    document.body.appendChild(this.titleEl);
  }

  // ---------- детали каста (wiki/design-spells.md, раздел 5) ----------

  /** Засветка экрана цветом стихии: strength 0..1 — пик непрозрачности */
  screenFlash(color: string, strength = 0.3, dur = 0.18): void {
    if (strength < this.flashPeak * (1 - this.flashT / this.flashDur)) return;
    this.flashEl.style.background = `radial-gradient(ellipse at center, ${color} 0%, ${color} 35%, transparent 100%)`;
    this.flashT = 0; this.flashDur = dur; this.flashPeak = strength;
  }

  /** Мир темнеет и выцветает на dur секунд (мифическое заклинание): быстро наползает, держится, тает */
  darken(dur = 0.6): void { this.darkT = 0; this.darkDur = dur; }

  /** Крупное название заклинания по центру экрана */
  title(text: string, color: string): void {
    this.titleEl.textContent = text;
    this.titleEl.style.setProperty('--c', color);
    this.titleEl.classList.remove('show'); void this.titleEl.offsetWidth; this.titleEl.classList.add('show');
    this.titleT = 1.8;
  }

  /** Вспышка настоящего света в точке: освещает пол и стены вокруг, гаснет за dur. follow — каждый кадр двигать за снарядом */
  light(pos: THREE.Vector3, color: ColorLike, intensity: number, dist = 10, dur = 0.5): THREE.PointLight {
    const f = this.lights.reduce((a, b) => (a.t / a.dur >= b.t / b.dur ? a : b));
    f.light.color.set(color); f.light.distance = dist; f.light.position.copy(pos);
    f.t = 0; f.dur = dur; f.peak = intensity;
    f.light.intensity = intensity;
    return f.light;
  }

  /** След на полу: выжженное пятно, иней. additive — светится; иначе затемняет */
  decal(pos: THREE.Vector3, map: THREE.Texture, color: ColorLike, size: number, dur: number, additive = false, opacity = 1): void {
    const s = this.decals.acquire();
    if (!s) return;
    const { mat, obj: m } = s;
    if (mat.map !== map || mat.toneMapped === additive) { mat.map = map; mat.toneMapped = !additive; mat.needsUpdate = true; }
    mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.color.set(color); mat.opacity = 0;
    m.scale.setScalar(size);
    m.rotation.z = Math.random() * Math.PI * 2;
    m.position.copy(pos); m.position.y += 0.03 + Math.random() * 0.01;
    // плавно проявляется, держится и тает в последней трети
    this.pooled(this.decals, s, dur, (k) => { mat.opacity = opacity * Math.min(1, k * 12) * Math.min(1, (1 - k) * 3); });
  }

  // ---------- частицы ----------
  burst(pos: THREE.Vector3, color: ColorLike | ColorLike[], n = 10, { speed = 3, size = 0.14, life = 0.8, up = 3, glow = false, gravity = 12, drag = 0 }: BurstOptions = {}): void {
    const pool = glow ? this.glow : this.solid;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      pool.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3)),
        vel: new THREE.Vector3(Math.cos(a) * sp, up * (0.5 + Math.random()), Math.sin(a) * sp),
        life: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8),
        color: Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color, gravity, drag,
      });
    }
  }

  /** Одна частица с полным контролем (искры, втягивающиеся в точку, и т. п.) */
  particle(p: SpawnOptions, glow = true): void {
    (glow ? this.glow : this.solid).spawn(p);
  }

  /** Направленный веер частиц */
  spray(pos: THREE.Vector3, dir: THREE.Vector3, color: ColorLike | ColorLike[], n: number, { speed = 6, size = 0.08, life = 0.35, glow = true, gravity = 4, spread = 0.5 }: BurstOptions & { spread?: number } = {}): void {
    const pool = glow ? this.glow : this.solid;
    const base = Math.atan2(dir.x, dir.z);
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * spread * 2;
      const sp = speed * (0.5 + Math.random() * 0.7);
      pool.spawn({
        pos: pos.clone(), vel: new THREE.Vector3(Math.sin(a) * sp, (Math.random() - 0.2) * sp * 0.4, Math.cos(a) * sp),
        life: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8),
        color: Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color, gravity, spin: 10,
      });
    }
  }

  /** Ломаная молния из светящихся брусков: ядро и мягкий ореол, мерцает и тает; branches — отростки */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, width: number, branches: number, dur = 0.32): void {
    this.bolts.bolt(from, to, color, width, branches, dur);
  }

  /** Светящиеся кубы разлетаются от mid на R, раздуваются и гаснут; additive — складываются светом */
  fireCubes(mid: THREE.Vector3, R: number, n: number, colors: THREE.Color[], size: number, additive = true, life: [number, number] = [0.35, 0.6]): void {
    (additive ? this.cubes : this.cubesSolid).burst(mid, R, n, colors, size, life);
  }

  // ---------- временные фигуры ----------
  private add(obj: THREE.Object3D, dur: number, tick: (k: number) => void, dispose: () => void): void {
    this.scene.add(obj);
    this.transients.push({ obj, t: 0, dur, tick, dispose });
  }

  /** Тело из пула живёт dur секунд, затем возвращается в пул (если слот не был перехвачен) */
  private pooled<M extends THREE.Material>(pool: FxPool<Slot<M>>, s: Slot<M>, dur: number, tick: (k: number) => void): void {
    const gen = ++s.gen;
    this.add(s.obj, dur, tick, () => { if (s.gen === gen) pool.release(s); });
  }

  /** Плоская светящаяся дуга удара; inner — доля внутреннего радиуса (0,38 — веер, 0,75 — тонкий серп) */
  arc(pos: THREE.Vector3, angle: number, color: THREE.Color, radius = 2.4, spread = 1.15, y = 0.75, inner = 0.38): void {
    const s = this.planes.acquire();
    if (!s) return;
    const { mat, obj: m } = s;
    m.geometry = ringGeo(inner, 32, -spread, spread * 2);
    mat.color.copy(color); mat.opacity = 0.85;
    m.rotation.set(-Math.PI / 2, 0, angle - Math.PI / 2);
    m.position.copy(pos); m.position.y = y;
    this.pooled(this.planes, s, 0.22, (k) => { mat.opacity = 0.85 * (1 - k); m.scale.setScalar(radius * (0.85 + k * 0.3)); });
  }

  /** Узкая прямая черта — укол или разрез */
  line(from: THREE.Vector3, angle: number, len: number, color: THREE.Color, width = 0.45, dur = 0.18, y = 0.9): void {
    const s = this.planes.acquire();
    if (!s) return;
    const { mat, obj: m } = s;
    m.geometry = PLANE_UP();
    mat.color.copy(color); mat.opacity = 0.95;
    m.rotation.order = 'YXZ';
    m.rotation.set(Math.PI / 2, angle, 0);
    m.position.copy(from); m.position.y = y;
    this.pooled(this.planes, s, dur, (k) => { mat.opacity = 0.95 * (1 - k); m.scale.set(width * (1 - k * 0.7), len * (0.8 + k * 0.3), 1); });
  }

  /** Кольцо, расходящееся по земле */
  shock(pos: THREE.Vector3, radius: number, color: THREE.Color = SHOCK_COLOR, dur = 0.45, thick = 0.15): void {
    const s = this.shocks.acquire();
    if (!s) return;
    const { mat, obj: m } = s;
    m.geometry = ringGeo(1 - thick, 64);
    mat.color.copy(color).multiplyScalar(0.6); mat.opacity = 1;
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.position.copy(pos); m.position.y = 0.15;
    m.scale.setScalar(0.3);
    this.pooled(this.shocks, s, dur, (k) => { m.scale.setScalar(0.3 + radius * Math.sqrt(k)); mat.opacity = 1 - k; });
  }

  /** Светящаяся лента за головой, летящей по path (src/fx-streaks.ts) */
  streak(o: StreakOptions): void { this.streaks.add(o); }
  get streakCount(): number { return this.streaks.count; }

  /**
   * Сочное кольцо: широкий мягкий ореол, яркий тонкий обод с белым и полупрозрачная стена света над ним,
   * тающая вверх (как кольца у артефактов MCD). Подпись как у shock
   */
  ring(pos: THREE.Vector3, radius: number, color: THREE.Color = SHOCK_COLOR, dur = 0.45, thick = 0.15, wall = 1): void {
    radius *= 0.92 + Math.random() * 0.18;
    // цвет насыщенный: слабые составляющие ниже 1, иначе наложение колец выгорает в белое пятно
    const k = 1 / Math.max(1, color.r, color.g, color.b);
    this.shock(pos, radius, color.clone().multiplyScalar(0.55 * k * 1.6), dur * 1.1, Math.min(0.6, thick * 2.6));
    this.shock(pos, radius * 1.02, color.clone().multiplyScalar(k * 1.25).lerp(WHITE, 0.15), dur, Math.max(0.03, thick * 0.35));
    if (wall <= 0) return;
    const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.15 * k * 1.6), map: wallTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    const m = new THREE.Mesh(WALL(), mat);
    m.position.copy(pos); m.position.y += 0.05;
    m.renderOrder = 4;
    this.custom(m, dur * 1.15, (t) => {
      const r = 0.3 + radius * Math.sqrt(t);
      m.scale.set(r, wall * (0.35 + 0.7 * (1 - t)) * Math.min(1.3, 0.4 + radius * 0.2), r);
      mat.opacity = (1 - t) * (1 - t);
    });
  }

  /** Круглая вспышка-ореол */
  flash(pos: THREE.Vector3, color: THREE.Color, size = 1.4, dur = 0.18): void {
    const sl = this.flashes.acquire();
    if (!sl) return;
    const { mat, obj: s } = sl;
    // вспышки приглушены, чтобы несколько попаданий подряд не слепили
    mat.color.copy(color).multiplyScalar(0.35); mat.opacity = 1;
    s.position.copy(pos);
    s.scale.setScalar(size * 0.6);
    this.pooled(this.flashes, sl, dur, (k) => { s.scale.setScalar(size * (0.6 + k * 0.8)); mat.opacity = 1 - k; });
  }

  /** Добавить своё временное тело (для особых эффектов); по умолчанию освобождает его геометрию и материалы, кроме общих (markShared) */
  custom(obj: THREE.Object3D, dur: number, tick: (k: number) => void, dispose: () => void = () => disposeOwned(obj)): void {
    this.add(obj, dur, tick, dispose);
  }

  /** Попадание по жуку: искры и брызги панциря */
  hit(at: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, power = 1): void {
    const p = at.clone().setY(0.45);
    this.spray(p, dir, [color, new THREE.Color(3, 2.6, 1.6)], Math.round(5 * power), { speed: 6, spread: 0.6, life: 0.25 });
    this.spray(p, dir, ['#3a5a1a', '#5a7a2a', '#1a2a0a'], Math.round(3 * power), { speed: 3, glow: false, gravity: 12, size: 0.08, life: 0.6, spread: 0.9 });
  }

  /** Взрыв: огненный шар, дым, обломки, кольцо */
  explosion(at: THREE.Vector3, r: number, tint: THREE.Color = new THREE.Color(3, 1.3, 0.3)): void {
    const c = at.clone(); c.y = Math.max(0.5, c.y);
    this.flash(c, tint.clone().multiplyScalar(1.1), Math.min(6, r * 1.5), 0.25);
    for (let i = 0; i < 4 + r; i++) {
      const p = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * r * 0.8, Math.random() * r * 0.4, (Math.random() - 0.5) * r * 0.8));
      const col = Math.random() < 0.5 ? tint.clone() : new THREE.Color(3.2, 2.4, 0.8);
      this.flash(p, col.multiplyScalar(0.7), Math.min(3, r * (0.4 + Math.random() * 0.4)), 0.25 + Math.random() * 0.2);
    }
    this.burst(c, [tint, new THREE.Color(3.2, 2.6, 1)], Math.round(10 + r * 6), { speed: r * 3, up: r * 1.5, size: 0.09, life: 0.5, glow: true, gravity: 4 });
    this.burst(c, ['#2a2622', '#3a3430', '#4a443e'], Math.round(6 + r * 3), { speed: r * 0.8, up: 2.5, size: 0.3, life: 1.3, gravity: -1.2, drag: 2 });
    this.burst(at.clone().setY(0.1), ['#6b452c', '#8b5e3c', '#5a5a5a'], Math.round(4 + r * 3), { speed: r * 1.5, up: 5, size: 0.14, life: 1 });
    this.shock(at, r, tint, 0.35, 0.25);
    this.shake = Math.max(this.shake, Math.min(1.2, 0.25 + r * 0.18));
  }

  /** Светящийся квадрат на земле (под игроком или целью) */
  marker(color: ColorLike, size = 1.1): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ map: this.T.square, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.04;
    m.renderOrder = 2;
    this.scene.add(m);
    return m;
  }

  /** Всплывающая надпись над точкой мира */
  text(worldPos: THREE.Vector3, str: string, cls = ''): void {
    // div-ы переиспользуются: создание и удаление узлов на каждое попадание дёргает раскладку
    let tx: FloatText;
    if (this.texts.length >= MAX_TEXTS) { tx = this.texts.shift()!; tx.pos.copy(worldPos); }
    else if (this.freeTexts.length) { tx = this.freeTexts.pop()!; tx.pos.copy(worldPos); this.overlay.appendChild(tx.el); }
    else { const el = document.createElement('div'); this.overlay.appendChild(el); tx = { el, pos: worldPos.clone(), t: 0, dur: 0.9, dx: 0 }; }
    tx.el.className = 'dmg ' + cls;
    tx.el.textContent = str;
    tx.t = 0; tx.dur = 0.9; tx.dx = (Math.random() - 0.5) * 30;
    this.texts.push(tx);
  }

  update(dt: number, w: number, h: number): void {
    this.solid.update(dt);
    this.glow.update(dt);
    this.bolts.update(dt);
    this.cubes.update(dt);
    this.cubesSolid.update(dt);
    this.streaks.update(dt);
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const tr = this.transients[i];
      tr.t += dt;
      const k = tr.t / tr.dur;
      if (k >= 1) {
        this.scene.remove(tr.obj);
        tr.dispose();
        this.transients.splice(i, 1);
        continue;
      }
      tr.tick(k);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const tx = this.texts[i];
      tx.t += dt;
      if (tx.t >= tx.dur) { tx.el.remove(); this.texts.splice(i, 1); this.freeTexts.push(tx); continue; }
      _v.copy(tx.pos); _v.y += 1.2 + tx.t * 1.4;
      _v.project(this.camera);
      const x = (_v.x * 0.5 + 0.5) * w + tx.dx * tx.t, y = (-_v.y * 0.5 + 0.5) * h;
      const pop = tx.t < 0.1 ? 0.6 + tx.t * 6 : 1.2 - Math.min(0.2, (tx.t - 0.1));
      tx.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${pop.toFixed(3)})`;
      tx.el.style.opacity = String(Math.min(1, (tx.dur - tx.t) * 4));
    }
    this.shake = Math.max(0, this.shake - dt * 3);
    for (const f of this.lights) {
      if (f.t >= f.dur) { f.light.intensity = 0; continue; }
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.light.intensity = f.peak * (1 - k) * (1 - k);
    }
  }

  /** Засветка и стоп-кадр живут в реальном времени, а не в игровом */
  updateReal(real: number): void {
    this.hitstop = Math.max(0, this.hitstop - real);
    this.slowmo = Math.max(0, this.slowmo - real);
    this.zoom = Math.max(0, this.zoom - real * 0.25);
    if (this.darkT < this.darkDur + 0.5) {
      this.darkT += real;
      const t = this.darkT, d = this.darkDur;
      this.darkEl.style.opacity = String(t < 0.12 ? t / 0.12 : t < d ? 1 : Math.max(0, 1 - (t - d) / 0.5));
    }
    if (this.titleT > 0) { this.titleT -= real; if (this.titleT <= 0) this.titleEl.classList.remove('show'); }
    if (this.flashT < this.flashDur) {
      this.flashT += real;
      const k = Math.min(1, this.flashT / this.flashDur);
      this.flashEl.style.opacity = String(this.flashPeak * (1 - k) * (1 - k));
    } else if (this.flashPeak) { this.flashPeak = 0; this.flashEl.style.opacity = '0'; }
  }
}
