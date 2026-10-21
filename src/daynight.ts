import * as THREE from 'three';
import { CFG } from './config';

export type Phase = 'day' | 'night';
export type PhaseEvent = 'dusk' | 'dawn' | null;

interface LightPreset {
  bg: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemi: number;
  amb: THREE.Color;
  ambI: number;
  sun: THREE.Color;
  sunI: number;
  exposure: number;
  bloom: number;
}

const C = (h: string) => new THREE.Color(h);
const DAY: LightPreset = {
  bg: C('#8cc0e8'), hemiSky: C('#d6ecff'), hemiGround: C('#6a5a3a'), hemi: 1.15,
  amb: C('#ffffff'), ambI: 0.22, sun: C('#fff0d2'), sunI: 2.7, exposure: 1.0, bloom: 0.3,
};
const NIGHT: LightPreset = {
  bg: C('#0a1628'), hemiSky: C('#7a98e0'), hemiGround: C('#2a2018'), hemi: 0.7,
  amb: C('#3050a0'), ambI: 0.3, sun: C('#a8bcff'), sunI: 0.95, exposure: 0.95, bloom: 0.6,
};
const SUNSET_BG = C('#e0866a');
const SUNSET_SUN = C('#ff9a5a');

export interface SceneLights {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
  bloom: { strength: number };
}

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Смена дня и ночи: днём растёт малина, ночью приходят жуки */
export class DayNight {
  phase: Phase = 'day';
  /** Номер текущих суток, с 1 */
  day = 1;
  /** Сколько ночей пережито */
  survived = 0;
  /** Секунды с начала текущей фазы */
  t = 0;
  length: number = CFG.FIRST_DAY;
  /** 0 — ясный день, 1 — глубокая ночь, плавно на закате и рассвете */
  night = 0;
  /** Смещение солнца или луны относительно камеры */
  readonly sunOffset = new THREE.Vector3();

  private readonly bg = new THREE.Color();
  private readonly tmp = new THREE.Color();

  get left(): number { return Math.max(0, this.length - this.t); }
  get progress(): number { return Math.min(1, this.t / this.length); }
  /** Растёт ли сейчас малина */
  get growing(): boolean { return this.phase === 'day'; }

  update(dt: number): PhaseEvent {
    this.t += dt;
    let ev: PhaseEvent = null;
    if (this.t >= this.length) {
      this.t = 0;
      if (this.phase === 'day') {
        this.phase = 'night';
        this.length = CFG.NIGHT_LENGTH;
        ev = 'dusk';
      } else {
        this.phase = 'day';
        this.length = CFG.DAY_LENGTH;
        this.day++;
        this.survived++;
        ev = 'dawn';
      }
    }
    const tw = CFG.TWILIGHT;
    const edge = smooth((this.t - (this.length - tw)) / tw);
    this.night = this.phase === 'day' ? edge : 1 - edge;
    return ev;
  }

  apply(L: SceneLights): void {
    const k = this.night;
    const dusk = Math.sin(k * Math.PI); // сильнее всего в середине заката
    this.bg.copy(DAY.bg).lerp(NIGHT.bg, k).lerp(SUNSET_BG, dusk * 0.45);
    (L.scene.background as THREE.Color).copy(this.bg);
    if (L.scene.fog) L.scene.fog.color.copy(this.bg);
    L.hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, k);
    L.hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, k);
    L.hemi.intensity = THREE.MathUtils.lerp(DAY.hemi, NIGHT.hemi, k);
    L.ambient.color.copy(DAY.amb).lerp(NIGHT.amb, k);
    L.ambient.intensity = THREE.MathUtils.lerp(DAY.ambI, NIGHT.ambI, k);
    L.sun.color.copy(DAY.sun).lerp(NIGHT.sun, k).lerp(this.tmp.copy(SUNSET_SUN), dusk * 0.7);
    L.sun.intensity = THREE.MathUtils.lerp(DAY.sunI, NIGHT.sunI, k) * (1 - dusk * 0.35);
    L.renderer.toneMappingExposure = THREE.MathUtils.lerp(DAY.exposure, NIGHT.exposure, k);
    L.bloom.strength = THREE.MathUtils.lerp(DAY.bloom, NIGHT.bloom, k);

    // солнце идёт по небу с утра до вечера, ночью светит луна
    const p = this.phase === 'day' ? this.progress : 0;
    const sunX = THREE.MathUtils.lerp(-20, 20, p);
    const sunY = 12 + Math.sin(p * Math.PI) * 16;
    this.sunOffset.set(sunX, sunY, 9).lerp(new THREE.Vector3(-14, 26, 8), k);
  }
}
