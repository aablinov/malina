import * as THREE from 'three';
import type { Textures } from './textures';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

export type ColorLike = THREE.ColorRepresentation;
export type RGB = readonly [number, number, number];

interface SpawnOptions {
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

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  rot: THREE.Vector3;
  spin: number;
  drag: number;
  shrink: boolean;
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

/** Пул кубиков-частиц, рисуется одним InstancedMesh */
class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly items: Particle[] = [];

  constructor(scene: THREE.Scene, private readonly max: number, material: THREE.Material, private readonly ground = true) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.set(1, 1, 1));
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  spawn(p: SpawnOptions): void {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      pos: p.pos.clone(), vel: p.vel ? p.vel.clone() : new THREE.Vector3(),
      life: p.life ?? 1, maxLife: p.life ?? 1, size: p.size ?? 0.15,
      color: new THREE.Color(p.color ?? '#fff'), gravity: p.gravity ?? 12,
      rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: p.spin ?? 6, drag: p.drag ?? 0, shrink: p.shrink ?? true,
    });
  }

  update(dt: number): void {
    const it = this.items;
    for (let i = it.length - 1; i >= 0; i--) {
      const p = it[i];
      p.life -= dt;
      if (p.life <= 0) { it.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (this.ground && p.pos.y < p.size / 2) {
        p.pos.y = p.size / 2; p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; p.spin *= 0.5;
      }
      p.rot.x += p.spin * dt; p.rot.y += p.spin * dt * 0.7;
    }
    for (let i = 0; i < it.length; i++) {
      const p = it[i];
      const k = p.shrink ? Math.min(1, (p.life / p.maxLife) * 2.5) : 1;
      _s.setScalar(p.size * k);
      _q.setFromEuler(_e.set(p.rot.x, p.rot.y, p.rot.z));
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, p.color);
    }
    this.mesh.count = it.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const additive = (color: THREE.Color, opacity = 1, map?: THREE.Texture) => new THREE.MeshBasicMaterial({
  color, map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
});

export class FX {
  private readonly solid: Pool;
  private readonly glow: Pool;
  private readonly transients: Transient[] = [];
  private readonly texts: FloatText[] = [];
  shake = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly T: Textures,
    private readonly overlay: HTMLElement,
  ) {
    this.solid = new Pool(scene, 900, new THREE.MeshLambertMaterial());
    this.solid.mesh.castShadow = true;
    this.glow = new Pool(scene, 800, new THREE.MeshBasicMaterial({ toneMapped: false }), true);
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

  // ---------- временные фигуры ----------
  private add(obj: THREE.Object3D, dur: number, tick: (k: number) => void, dispose: () => void): void {
    this.scene.add(obj);
    this.transients.push({ obj, t: 0, dur, tick, dispose });
  }

  /** Плоская светящаяся дуга удара */
  arc(pos: THREE.Vector3, angle: number, color: THREE.Color, radius = 2.4, spread = 1.15, y = 0.75): void {
    const geo = new THREE.RingGeometry(radius * 0.38, radius, 32, 1, -spread, spread * 2);
    const mat = additive(color, 0.85);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = angle - Math.PI / 2;
    m.position.copy(pos); m.position.y = y;
    this.add(m, 0.22, (k) => { mat.opacity = 0.85 * (1 - k); m.scale.setScalar(0.85 + k * 0.3); }, () => { geo.dispose(); mat.dispose(); });
  }

  /** Узкая прямая черта — укол или разрез */
  line(from: THREE.Vector3, angle: number, len: number, color: THREE.Color, width = 0.45, dur = 0.18, y = 0.9): void {
    const geo = new THREE.PlaneGeometry(width, len);
    geo.translate(0, len / 2, 0);
    const mat = additive(color, 0.95);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.order = 'YXZ';
    m.rotation.set(Math.PI / 2, angle, 0);
    m.position.copy(from); m.position.y = y;
    this.add(m, dur, (k) => { mat.opacity = 0.95 * (1 - k); m.scale.set(1 - k * 0.7, 0.8 + k * 0.3, 1); }, () => { geo.dispose(); mat.dispose(); });
  }

  /** Кольцо, расходящееся по земле */
  shock(pos: THREE.Vector3, radius: number, color: THREE.Color = new THREE.Color(3, 0.6, 1.2), dur = 0.45, thick = 0.15): void {
    const geo = new THREE.RingGeometry(1 - thick, 1, 64);
    const mat = additive(color.clone().multiplyScalar(0.6));
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos); m.position.y = 0.15;
    this.add(m, dur, (k) => { m.scale.setScalar(0.3 + radius * Math.sqrt(k)); mat.opacity = 1 - k; }, () => { geo.dispose(); mat.dispose(); });
  }

  /** Круглая вспышка-ореол */
  flash(pos: THREE.Vector3, color: THREE.Color, size = 1.4, dur = 0.18): void {
    // вспышки приглушены, чтобы несколько попаданий подряд не слепили
    const mat = new THREE.SpriteMaterial({ map: this.T.glow, color: color.clone().multiplyScalar(0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    this.add(s, dur, (k) => { s.scale.setScalar(size * (0.6 + k * 0.8)); mat.opacity = 1 - k; }, () => mat.dispose());
  }

  /** Добавить своё временное тело (для особых эффектов) */
  custom(obj: THREE.Object3D, dur: number, tick: (k: number) => void, dispose: () => void = () => obj.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
  })): void {
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
    const el = document.createElement('div');
    el.className = 'dmg ' + cls;
    el.textContent = str;
    this.overlay.appendChild(el);
    this.texts.push({ el, pos: worldPos.clone(), t: 0, dur: 0.9, dx: (Math.random() - 0.5) * 30 });
  }

  update(dt: number, w: number, h: number): void {
    this.solid.update(dt);
    this.glow.update(dt);
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
      if (tx.t >= tx.dur) { tx.el.remove(); this.texts.splice(i, 1); continue; }
      _v.copy(tx.pos); _v.y += 1.2 + tx.t * 1.4;
      _v.project(this.camera);
      const x = (_v.x * 0.5 + 0.5) * w + tx.dx * tx.t, y = (-_v.y * 0.5 + 0.5) * h;
      const pop = tx.t < 0.1 ? 0.6 + tx.t * 6 : 1.2 - Math.min(0.2, (tx.t - 0.1));
      tx.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${pop})`;
      tx.el.style.opacity = String(Math.min(1, (tx.dur - tx.t) * 4));
    }
    this.shake = Math.max(0, this.shake - dt * 3);
  }
}
