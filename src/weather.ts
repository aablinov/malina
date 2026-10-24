import * as THREE from 'three';
import type { WeatherKind } from './world';

/**
 * Погода: частицы в коробке вокруг точки интереса (камеры или героя) — дождь штрихами, снег хлопьями, листопад,
 * искры с пеплом; гроза — сильный дождь и вспышки молний (подсветка неба). Без физики и столкновений: частица,
 * упавшая ниже коробки, возвращается наверх — дёшево и не зависит от размера карты.
 */

const BOX = 36, H = 22;

interface Look { count: number; color: string; size: number; fall: number; streak: number; sway: number; up?: boolean; opacity: number }
const LOOKS: Record<Exclude<WeatherKind, 'clear'>, Look> = {
  rain: { count: 2600, color: '#a8c4e0', size: 0, fall: 18, streak: 0.55, sway: 0, opacity: 0.55 },
  storm: { count: 5200, color: '#9db6d4', size: 0, fall: 26, streak: 0.8, sway: 0, opacity: 0.6 },
  snow: { count: 2400, color: '#ffffff', size: 0.12, fall: 1.6, streak: 0, sway: 0.8, opacity: 0.9 },
  leaves: { count: 500, color: '#d9a441', size: 0.16, fall: 1.4, streak: 0, sway: 1.6, opacity: 0.95 },
  embers: { count: 700, color: '#ff9a3c', size: 0.07, fall: -0.9, streak: 0, sway: 0.5, up: true, opacity: 1 },
};

export class Weather {
  readonly group = new THREE.Group();
  kind: WeatherKind = 'clear';
  intensity = 0.6;
  wind = 1.5;
  /** Вспышка молнии 0..1 — добавь к свету неба (гроза) */
  flash = 0;
  private obj: THREE.Points | THREE.LineSegments | null = null;
  private pos: Float32Array = new Float32Array(0);
  private seed: Float32Array = new Float32Array(0);
  private look: Look | null = null;
  private nextBolt = 3;
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'Погода';
    scene.add(this.group);
  }

  set(kind: WeatherKind, intensity: number, wind: number): void {
    this.intensity = intensity;
    this.wind = wind;
    if (kind === this.kind && this.obj) { this.applyCount(); return; }
    this.kind = kind;
    this.build();
  }

  private build(): void {
    if (this.obj) { this.group.remove(this.obj); this.obj.geometry.dispose(); (this.obj.material as THREE.Material).dispose(); this.obj = null; }
    this.look = this.kind === 'clear' ? null : LOOKS[this.kind];
    const L = this.look;
    if (!L) return;
    const n = L.count;
    this.seed = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) this.seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    if (L.streak > 0) {
      this.pos = new Float32Array(n * 6);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: L.color, transparent: true, opacity: L.opacity, depthWrite: false, fog: true }));
    } else {
      this.pos = new Float32Array(n * 3);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      const tex = dotTexture(this.kind === 'leaves');
      this.obj = new THREE.Points(g, new THREE.PointsMaterial({
        color: L.color, size: L.size, map: tex, transparent: true, opacity: L.opacity, depthWrite: false, sizeAttenuation: true,
        blending: L.up ? THREE.AdditiveBlending : THREE.NormalBlending, alphaTest: 0.05,
      }));
    }
    this.obj.frustumCulled = false;
    this.obj.name = this.kind;
    this.group.add(this.obj);
    this.applyCount();
  }

  private applyCount(): void {
    if (!this.obj || !this.look) return;
    const n = Math.round(this.look.count * THREE.MathUtils.clamp(this.intensity, 0, 1));
    this.obj.geometry.setDrawRange(0, this.look.streak > 0 ? n * 2 : n);
  }

  /** Сдвинуть частицы; focus — центр коробки (камера смотрит сюда) */
  update(dt: number, focus: THREE.Vector3): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 3.5);
    if (this.kind === 'storm') {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 2 + Math.random() * 7 * (1.2 - this.intensity); }
    }
    const L = this.look;
    if (!L || !this.obj) return;
    const n = L.count, s = this.seed, p = this.pos, t = this.t;
    const half = BOX / 2;
    for (let i = 0; i < n; i++) {
      const sx = s[i * 4], sz = s[i * 4 + 2], sp = 0.7 + s[i * 4 + 3] * 0.6;
      // высота — по кругу сверху вниз (или снизу вверх у искр), скорость у каждой своя
      let h = (s[i * 4 + 1] - (t * L.fall * sp) / H) % 1;
      if (h < 0) h += 1;
      const y = focus.y - 4 + h * H;
      const sway = L.sway ? Math.sin(t * 1.3 + i) * L.sway : 0;
      const drift = this.wind * (1 - h) * (L.fall > 0 ? H / Math.max(1, L.fall) : 4);
      const x = focus.x + ((sx * BOX + drift + sway - (focus.x % BOX) + BOX * 10) % BOX) - half;
      const z = focus.z + ((sz * BOX + Math.cos(t + i) * L.sway * 0.6 - (focus.z % BOX) + BOX * 10) % BOX) - half;
      if (L.streak > 0) {
        const k = i * 6, len = L.streak * sp;
        p[k] = x; p[k + 1] = y; p[k + 2] = z;
        p[k + 3] = x - this.wind * 0.03 * len; p[k + 4] = y + len; p[k + 5] = z;
      } else { p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z; }
    }
    (this.obj.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.kind = 'clear';
    this.build();
    this.group.removeFromParent();
  }
}

/** Мягкая круглая точка (снег, искры) или ромбик листа */
function dotTexture(leaf: boolean): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  if (leaf) {
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(16, 3); g.lineTo(28, 16); g.lineTo(16, 29); g.lineTo(4, 16); g.closePath(); g.fill();
  } else {
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
