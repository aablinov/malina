import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/**
 * Свет и постобработка «как в Unreal» — узнаваемая картинка Minecraft Dungeons (wiki/style-lighting.md,
 * источники — wiki/sources/mcd-lighting.md):
 *
 *  1. Тёплое низкое солнце с мягкими длинными тенями, тени не чёрные — их заливает голубое небо (Hemisphere).
 *  2. Затенение в щелях и у подножий (GTAO) — у стен, под декором, у ног героя; вырезные листья и трава не затеняют.
 *  3. Bloom на огне, магии, светящихся грибах.
 *  4. Цветокоррекция после тонмаппинга ACES: тени уходят в бирюзу, светлое — в тепло, насыщенность чуть выше.
 *  5. Воздушная дымка: дальнее светлеет и голубеет (Fog от камеры), без серой мути.
 *
 * Tilt-shift (размытие верха и низа кадра) был и убран 23.10.2026: два полноэкранных прохода на полном разрешении съедали кадры.
 *
 * `unreal = false` оставляет только солнце, небо и bloom — как было до этого слоя (сравнить: клавиша U).
 */

/** Лёгкое затенение без вырезных и прозрачных сеток: трава и листья — плоскости, иначе они дают пятна */
class SolidAOPass extends GTAOPass {
  // в типах three метода нет, в самом GTAOPass он есть и вызывается перед проходом нормалей
  overrideVisibility(): void {
    (GTAOPass.prototype as unknown as { overrideVisibility(this: GTAOPass): void }).overrideVisibility.call(this);
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!(o as THREE.Mesh).isMesh || !m || Array.isArray(m)) return;
      if (m.alphaTest > 0 || m.transparent || (m as THREE.MeshBasicMaterial).isMeshBasicMaterial) o.visible = false;
    });
  }
  /** AO мягкий и так — считаем в половине разрешения буфера (в полном он один стоил ~15 мс на 2048 × 1536) */
  setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
  }
}

/**
 * Плотность пикселей буфера постобработки. На ретине (DPR 2) полноэкранный HDR-буфер — главная цена кадра:
 * замер 23.10.2026 (GPU, 2048 × 1536): DPR 2 — 20,8 мс, DPR 1,5 — 6,3 мс с AO и bloom. MSAA на этом буфере ещё дороже (35 мс).
 * Взяли 1,25 — запас по кадрам важнее последней доли резкости.
 */
const POST_MAX_DPR = 1.25;

const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Цветокоррекция в экранных цветах (после OutputPass): раздельное тонирование, насыщенность, контраст, лёгкая виньетка */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 1 },
    uShadow: { value: new THREE.Vector3() },
    uHigh: { value: new THREE.Vector3() },
    uSat: { value: 1.1 },
    uContrast: { value: 1.04 },
    uVignette: { value: 0.12 },
  },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform float uAmount, uSat, uContrast, uVignette;
uniform vec3 uShadow, uHigh;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  vec3 c = t.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 g = c + uShadow * (1.0 - smoothstep(0.05, 0.6, l)) + uHigh * smoothstep(0.45, 1.0, l);
  float l2 = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(l2), g, uSat);
  g = (g - 0.5) * uContrast + 0.5;
  float v = smoothstep(0.9, 0.3, length((vUv - 0.5) * vec2(1.0, 0.85)));
  g *= mix(1.0 - uVignette, 1.0, v);
  gl_FragColor = vec4(mix(c, clamp(g, 0.0, 1.0), uAmount), t.a);
}`,
};

interface Mood {
  sky: string; haze: string; hemiSky: string; hemiGround: string; hemi: number; ambient: number;
  sun: string; sunI: number; bloom: number; exposure: number;
  shadow: [number, number, number]; high: [number, number, number]; sat: number;
}
const DAY: Mood = {
  sky: '#9ed6f0', haze: '#d6ecf4', hemiSky: '#bfe4ff', hemiGround: '#7fa45a', hemi: 1.2, ambient: 0.12,
  sun: '#ffdcae', sunI: 2.7, bloom: 0.42, exposure: 1.08,
  shadow: [-0.025, 0.012, 0.055], high: [0.045, 0.022, -0.02], sat: 1.12,
};
const NIGHT: Mood = {
  sky: '#0e2a44', haze: '#1b3c5c', hemiSky: '#5f8ed6', hemiGround: '#1d3a3a', hemi: 0.85, ambient: 0.1,
  sun: '#8fb4ff', sunI: 0.6, bloom: 0.75, exposure: 1.1,
  shadow: [-0.01, 0.02, 0.07], high: [0.05, 0.028, -0.005], sat: 1.06,
};

export class Lighting {
  readonly hemi = new THREE.HemisphereLight();
  readonly ambient = new THREE.AmbientLight('#ffffff');
  readonly sun = new THREE.DirectionalLight();
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly ao: SolidAOPass;
  readonly grade = new ShaderPass(GradeShader);
  private readonly fog = new THREE.Fog('#ffffff', 30, 120);
  /** Откуда светит солнце относительно точки, за которой следит камера: низко и сбоку — длинные тени */
  readonly sunOffset = new THREE.Vector3(-20, 26, 12);
  private mood: Mood = DAY;
  private unrealOn = true;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 100 });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.hemi, this.ambient, this.sun, this.sun.target);

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(Math.min(renderer.getPixelRatio(), POST_MAX_DPR));
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new SolidAOPass(scene, camera, 512, 512);
    this.ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.2, scale: 1, samples: 10 });
    this.ao.updatePdMaterial({ samples: 12 });
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), DAY.bloom, 0.4, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
    this.setNight(false);
  }

  get unreal(): boolean { return this.unrealOn; }
  set unreal(on: boolean) {
    this.unrealOn = on;
    this.ao.enabled = this.grade.enabled = on;
    this.scene.fog = on ? this.fog : null;
    // солнце без цветокоррекции — прежнее, белее и выше
    this.sunOffset.set(on ? -20 : -14, on ? 26 : 30, on ? 12 : 9);
    this.apply();
  }

  setNight(night: boolean): void {
    this.mood = night ? NIGHT : DAY;
    this.apply();
    this.unreal = this.unrealOn;
  }

  private apply(): void {
    const m = this.mood, u = this.unrealOn;
    this.scene.background = new THREE.Color(m.sky);
    this.hemi.color.set(m.hemiSky);
    this.hemi.groundColor.set(m.hemiGround);
    this.hemi.intensity = m.hemi;
    this.ambient.intensity = m.ambient;
    this.sun.color.set(u ? m.sun : m === DAY ? '#fff0d2' : m.sun);
    this.sun.intensity = m.sunI;
    this.bloom.strength = m.bloom;
    this.fog.color.set(m.haze);
    this.renderer.toneMappingExposure = u ? m.exposure : 1.05;
    const g = this.grade.uniforms;
    (g.uShadow.value as THREE.Vector3).set(...m.shadow);
    (g.uHigh.value as THREE.Vector3).set(...m.high);
    g.uSat.value = m.sat;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  /** Солнце и тени — за точкой интереса; дымка начинается за ней и густеет вдаль */
  follow(target: THREE.Vector3, camDist: number): void {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
    this.fog.near = camDist * 0.9;
    this.fog.far = camDist * 4.2;
  }

  render(): void { this.composer.render(); }
}
