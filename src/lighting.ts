import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { sunOffset, tintVec, type WorldSettings } from './world.ts';

/**
 * Light and post-processing "as in Unreal" — the recognisable look of Minecraft Dungeons (wiki/style-lighting.md,
 * sources — wiki/sources/mcd-lighting.md):
 *
 *  1. A warm low sun with soft long shadows, the shadows are not black — the blue sky fills them (Hemisphere).
 *  2. Shading in crevices and at bases (GTAO) — by walls, under decor, at the hero's feet; cut-out leaves and grass do not occlude.
 *  3. Bloom on fire, magic, glowing mushrooms.
 *  4. Colour grading after ACES tone mapping: shadows go turquoise, highlights go warm, saturation slightly higher.
 *  5. Aerial haze: the distance gets lighter and bluer (Fog from the camera), without grey murk.
 *
 * Tilt-shift (blurring the top and bottom of the frame) existed and was removed on 23.10.2026: two full-screen passes at full resolution ate frames.
 *
 * `unreal = false` leaves only the sun, sky and bloom — as it was before this layer (compare: the U key).
 */

/**
 * Light occlusion without cut-out and transparent meshes: grass and leaves are planes, otherwise they produce blotches.
 * Sprites (spell and explosion flashes, loot on the floor) and points are hidden too: in the normals pass they were drawn
 * as opaque squares, and AO produced black squares around them.
 */
/** AO quality: buffer resolution divisor, samples per pixel, denoise samples (wiki/dev-performance.md) */
export const AO_QUALITY = { div: 2, samples: 6, denoise: 8 };

class SolidAOPass extends GTAOPass {
  // the method is missing from three's types, but GTAOPass itself has it and calls it before the normals pass. Our own traversal instead
  // of the base one (it hid only points and lines): one pass over the scene per frame instead of two
  overrideVisibility(): void {
    const cache = (this as unknown as { _visibilityCache: Map<THREE.Object3D, boolean> })._visibilityCache;
    this.scene.traverse((o) => {
      cache.set(o, o.visible);
      if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) { o.visible = false; return; }
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!(o as THREE.Mesh).isMesh || !m || Array.isArray(m)) return;
      if (m.alphaTest > 0 || m.transparent || (m as THREE.MeshBasicMaterial).isMeshBasicMaterial) o.visible = false;
    });
  }
  /** AO is soft anyway — compute at a fraction of the buffer resolution (at full it alone cost ~15 ms at 2048 × 1536) */
  setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width / AO_QUALITY.div)), Math.max(1, Math.round(height / AO_QUALITY.div)));
  }
}

/**
 * Pixel density of the post-processing buffer. On retina (DPR 2) the full-screen HDR buffer is the main cost of a frame:
 * measured 23.10.2026 (GPU, 2048 × 1536): DPR 2 — 20.8 ms, DPR 1.5 — 6.3 ms with AO and bloom. MSAA on this buffer is even dearer (35 ms).
 * We took 1.25 — frame headroom matters more than the last bit of sharpness.
 */
const POST_MAX_DPR = 1.25;

const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Colour grading in screen colours (after OutputPass): split toning, saturation, contrast, a light vignette */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 1 },
    uShadow: { value: new THREE.Vector3() },
    uHigh: { value: new THREE.Vector3() },
    uSat: { value: 1.1 },
    uContrast: { value: 0.98 },
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
  // soft MCD light: lots of sky, less sun — light shadows, block sides warm from the bounce below (hemiGround)
  sky: '#9ed6f0', haze: '#d6ecf4', hemiSky: '#bfe4ff', hemiGround: '#d8c49a', hemi: 2.0, ambient: 0.2,
  sun: '#ffdcae', sunI: 2.2, bloom: 0.42, exposure: 1.02,
  // Minecraft Dungeons pastel: saturation is not raised, highlights warm up slightly (wiki/style-terrain.md)
  shadow: [-0.02, 0.012, 0.045], high: [0.02, 0.012, -0.004], sat: 1.0,
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
  /** Where the sun shines from relative to the point the camera follows: low and from the side — long shadows */
  readonly sunOffset = new THREE.Vector3(-20, 26, 12);
  private mood: Mood = DAY;
  private day: Mood = DAY;
  private unrealOn = true;
  /** Map world settings (src/world.ts): day, haze in metres, post-processing; null — as designed in this file */
  private world: WorldSettings | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) { this.renderer = renderer; this.scene = scene;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 100 });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.hemi, this.ambient, this.sun, this.sun.target);
    // the shadow map is drawn once per frame: otherwise three redraws it on every renderer.render, and GTAO
    // makes a second pass over the scene for normals — shadows cost double
    renderer.shadowMap.autoUpdate = false;

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(Math.min(renderer.getPixelRatio(), POST_MAX_DPR));
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new SolidAOPass(scene, camera, 512, 512);
    this.ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.2, scale: 1, samples: AO_QUALITY.samples });
    this.ao.updatePdMaterial({ samples: AO_QUALITY.denoise });
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
    this.scene.fog = on && (this.world?.fog.enabled ?? true) ? this.fog : null;
    // the sun without colour grading — the old one, whiter and higher
    if (this.world && on) sunOffset(this.world, 35, this.sunOffset);
    else this.sunOffset.set(on ? -20 : -14, on ? 26 : 30, on ? 12 : 9);
    this.apply();
  }

  setNight(night: boolean): void {
    this.mood = night ? NIGHT : this.day;
    this.apply();
    this.unreal = this.unrealOn;
  }

  /** Map world settings: day takes the sun, sky, haze and colour grading from them; night (L) stays its own */
  applyWorld(ws: WorldSettings): void {
    const night = this.mood === NIGHT;
    this.world = ws;
    const p = ws.post;
    this.day = {
      sky: ws.sky.color, haze: ws.fog.color, hemiSky: ws.sky.hemiSky, hemiGround: ws.sky.hemiGround, hemi: ws.sky.hemi, ambient: ws.sky.ambient,
      sun: ws.sun.color, sunI: ws.sun.intensity, bloom: p.bloom, exposure: p.exposure,
      shadow: tintVec(p.shadowTint, p.tintAmount).toArray(), high: tintVec(p.highTint, p.tintAmount).toArray(), sat: p.saturation,
    };
    this.bloom.radius = p.bloomRadius;
    this.bloom.threshold = p.bloomThreshold;
    this.ao.blendIntensity = p.ao;
    this.ao.updateGtaoMaterial({ radius: p.aoRadius });
    this.grade.uniforms.uContrast.value = p.contrast;
    this.grade.uniforms.uVignette.value = p.vignette;
    this.sun.castShadow = ws.sun.shadows;
    this.setNight(night);
  }

  private apply(): void {
    const m = this.mood, u = this.unrealOn;
    this.scene.background = new THREE.Color(m.sky);
    this.hemi.color.set(m.hemiSky);
    this.hemi.groundColor.set(m.hemiGround);
    this.hemi.intensity = m.hemi;
    this.ambient.intensity = m.ambient;
    this.sun.color.set(u ? m.sun : m !== NIGHT ? '#fff0d2' : m.sun);
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

  /** Sun and shadows follow the point of interest; the haze starts behind it and thickens into the distance */
  follow(target: THREE.Vector3, camDist: number): void {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
    // the haze from the world settings is set for the game camera (24 m to the hero) — a farther camera, a farther haze
    const k = camDist / 24;
    this.fog.near = this.world ? this.world.fog.near * k : camDist * 0.9;
    this.fog.far = this.world ? this.world.fog.far * k : camDist * 4.2;
  }

  /** A frame through the composer (AO, bloom, colour grading); shadows update once, before the first pass */
  render(): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
  }

  /** A frame without post-processing (B in the playground, other editor viewports) — shadows update too */
  renderPlain(camera: THREE.Camera): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, camera);
  }
}
