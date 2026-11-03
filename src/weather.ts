import * as THREE from 'three';
import type { WeatherKind } from './world.ts';

/**
 * Погода: частицы в коробке вокруг точки интереса (камеры или героя) — дождь штрихами, снег хлопьями, листопад,
 * искры с пеплом; гроза — сильный дождь и вспышки молний (подсветка неба). Без физики и столкновений: частица,
 * упавшая ниже коробки, возвращается наверх — дёшево и не зависит от размера карты.
 * Положение каждой частицы считает вершинный шейдер по сиду и времени (wiki/dev-performance.md): буфер заливается
 * один раз при смене погоды, с кадра в кадр меняются только uniform-ы (время, центр коробки, ветер).
 */

const BOX = 36, H = 22;

interface Look { count: number; color: string; size: number; fall: number; streak: number; sway: number; up?: boolean; opacity: number }
const LOOKS: Record<Exclude<WeatherKind, 'clear'>, Look> = {
  rain: { count: 2600, color: '#a8c4e0', size: 0, fall: 18, streak: 0.55, sway: 0, opacity: 0.55 },
  storm: { count: 5200, color: '#9db6d4', size: 0, fall: 26, streak: 0.8, sway: 0, opacity: 0.6 },
  snow: { count: 2400, color: '#ffffff', size: 0.12, fall: 1.6, streak: 0, sway: 0.8, opacity: 0.9 },
  leaves: { count: 500, color: '#d9a441', size: 0.16, fall: 1.4, streak: 0, sway: 1.6, opacity: 0.95 },
  embers: { count: 700, color: '#ff9a3c', size: 0.07, fall: -0.9, streak: 0, sway: 0.5, up: true, opacity: 1 },
  fireflies: { count: 420, color: '#b4ff6a', size: 0.09, fall: -0.25, streak: 0, sway: 1.4, up: true, opacity: 1 },
};

export class Weather {
  readonly group = new THREE.Group();
  kind: WeatherKind = 'clear';
  intensity = 0.6;
  wind = 1.5;
  /** Вспышка молнии 0..1 — добавь к свету неба (гроза) */
  flash = 0;
  private obj: THREE.Points | THREE.LineSegments | null = null;
  private look: Look | null = null;
  private readonly u = { uTime: { value: 0 }, uFocus: { value: new THREE.Vector3() }, uWind: { value: 0 }, uFall: { value: 0 }, uStreak: { value: 0 }, uSway: { value: 0 } };
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
    // на вершину: сид (4 случайных числа, у штриха — одинаковый на оба конца) и признак конца штриха
    const per = L.streak > 0 ? 2 : 1;
    const seed = new Float32Array(n * per * 4), end = new Float32Array(n * per);
    for (let i = 0; i < n; i++) {
      const a = Math.random(), b = Math.random(), c = Math.random(), d = Math.random();
      for (let k = 0; k < per; k++) { const o = (i * per + k) * 4; seed[o] = a; seed[o + 1] = b; seed[o + 2] = c; seed[o + 3] = d; end[i * per + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * per * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('end', new THREE.BufferAttribute(end, 1));
    this.u.uFall.value = L.fall; this.u.uStreak.value = L.streak; this.u.uSway.value = L.sway;
    let mat: THREE.Material;
    if (L.streak > 0) {
      mat = new THREE.LineBasicMaterial({ color: L.color, transparent: true, opacity: L.opacity, depthWrite: false, fog: true });
      this.obj = new THREE.LineSegments(g, mat);
    } else {
      const tex = dotTexture(this.kind === 'leaves');
      mat = new THREE.PointsMaterial({
        color: L.color, size: L.size, map: tex, transparent: true, opacity: L.opacity, depthWrite: false, sizeAttenuation: true,
        blending: L.up ? THREE.AdditiveBlending : THREE.NormalBlending, alphaTest: 0.05,
      });
      this.obj = new THREE.Points(g, mat);
    }
    this.gpu(mat);
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

  /** Положение частицы в вершинном шейдере — та же формула, что раньше считалась на CPU */
  private gpu(m: THREE.Material): void {
    const u = this.u;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 seed; attribute float end;
uniform float uTime; uniform vec3 uFocus; uniform float uWind; uniform float uFall; uniform float uStreak; uniform float uSway;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  const float BOX = ${BOX.toFixed(1)}, H = ${H.toFixed(1)}, hb = BOX * 0.5;
  float t = uTime, idx = seed.x * 1000.0, sp = 0.7 + seed.w * 0.6;
  // высота — по кругу сверху вниз (или снизу вверх у искр), скорость у каждой своя
  float h = fract(seed.y - (t * uFall * sp) / H);
  float y = uFocus.y - 4.0 + h * H;
  float sway = sin(t * 1.3 + idx) * uSway;
  float drift = uWind * (1.0 - h) * (uFall > 0.0 ? H / max(1.0, uFall) : 4.0);
  float x = uFocus.x + mod(seed.x * BOX + drift + sway - mod(uFocus.x, BOX) + BOX * 10.0, BOX) - hb;
  float z = uFocus.z + mod(seed.z * BOX + cos(t + idx) * uSway * 0.6 - mod(uFocus.z, BOX) + BOX * 10.0, BOX) - hb;
  float len = uStreak * sp * end;
  transformed = vec3(x - uWind * 0.03 * len, y + len, z);
}`);
    };
    m.customProgramCacheKey = () => 'weather';
  }

  /** Сдвинуть частицы; focus — центр коробки (камера смотрит сюда) */
  update(dt: number, focus: THREE.Vector3): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 3.5);
    if (this.kind === 'storm') {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 2 + Math.random() * 7 * (1.2 - this.intensity); }
    }
    if (!this.look || !this.obj) return;
    this.u.uTime.value = this.t;
    this.u.uFocus.value.copy(focus);
    this.u.uWind.value = this.wind;
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
