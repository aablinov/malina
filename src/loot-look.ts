import * as THREE from 'three';
import { makeCanvas } from './headless.ts';
import { markShared } from './fx.ts';

/**
 * Shared look of treasures: a soft glow, a ray star behind a trophy and a pillar of light. Textures are drawn in code once.
 * An item on the floor can carry in userData:
 * - glow: THREE.Color — the colour of sparks around it, of the flash on landing and pickup;
 * - rarity: 0 common, 1 rare, 2 unique — strength of effects and sound;
 * - tick(t, grounded) — its own animation every frame (pulse, ray rotation).
 */
export interface LootData {
  glow?: THREE.Color;
  rarity?: number;
  tick?: (t: number, grounded: boolean) => void;
}

const canvasTexture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
  const c = makeCanvas(w, h);
  draw(c.getContext('2d') as CanvasRenderingContext2D);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

let glow: THREE.Texture | null = null, rays: THREE.Texture | null = null, beam: THREE.Texture | null = null, star: THREE.Texture | null = null;

/** Round halo: white in the centre, transparent at the edge */
export const glowTex = (): THREE.Texture => glow ??= canvasTexture(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});

/** Ray star — spins behind a trophy */
export const raysTex = (): THREE.Texture => rays ??= canvasTexture(128, 128, (g) => {
  g.translate(64, 64);
  for (let i = 0; i < 12; i++) {
    g.rotate(Math.PI / 6);
    const long = i % 2 === 0 ? 62 : 44;
    const gr = g.createLinearGradient(0, 0, 0, -long);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(-5, 0); g.lineTo(0, -long); g.lineTo(5, 0); g.closePath(); g.fill();
  }
  const c = g.createRadialGradient(0, 0, 0, 0, 0, 22);
  c.addColorStop(0, 'rgba(255,255,255,1)'); c.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = c; g.fillRect(-22, -22, 44, 44);
});

/** Pillar of light: brighter towards the middle and the bottom, fades at the top */
export const beamTex = (): THREE.Texture => beam ??= canvasTexture(32, 128, (g) => {
  for (let y = 0; y < 128; y++) {
    const v = Math.pow(y / 127, 1.4); // 0 at the top, 1 at the bottom
    const gr = g.createLinearGradient(0, 0, 32, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${v})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, y, 32, 1);
  }
});

/** Four-ray sparkle — the glint on treasures */
export const starTex = (): THREE.Texture => star ??= canvasTexture(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(14, 0, 4, 32); g.fillRect(0, 14, 32, 4);
  g.beginPath(); g.arc(16, 16, 6, 0, Math.PI * 2); g.fill();
});

/** Additive glow material (not tone-mapped — above one it glows through bloom) */
export const additive = (map: THREE.Texture, color: THREE.Color, opacity = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
});

export const additiveSprite = (map: THREE.Texture, color: THREE.Color, opacity = 1): THREE.SpriteMaterial => new THREE.SpriteMaterial({
  map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

/** Shared unit planes: centred and bottom-up (size via scale) */
let plane: THREE.PlaneGeometry | null = null, planeUp: THREE.PlaneGeometry | null = null;
const PLANE = (): THREE.PlaneGeometry => plane ??= markShared(new THREE.PlaneGeometry(1, 1));
const PLANE_UP = (): THREE.PlaneGeometry => planeUp ??= markShared(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0) as THREE.PlaneGeometry);

/** Pillar of light from two crossed planes: a wide soft one and a narrow bright one */
export function lightBeam(color: THREE.Color, height: number, width: number): { group: THREE.Group; mats: THREE.MeshBasicMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.MeshBasicMaterial[] = [];
  for (const [w, k] of [[width, 0.55], [width * 0.3, 1]] as const) {
    const m = additive(beamTex(), color.clone().multiplyScalar(k));
    mats.push(m);
    for (const r of [0, Math.PI / 2]) {
      const p = new THREE.Mesh(PLANE_UP(), m);
      p.scale.set(w, height, 1);
      p.rotation.y = r + Math.PI / 4;
      p.renderOrder = 3;
      group.add(p);
    }
  }
  return { group, mats };
}

/** Halo on the ground (flat, facing up) */
export function groundGlow(color: THREE.Color, size: number, opacity = 1): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(PLANE(), additive(glowTex(), color, opacity));
  m.scale.setScalar(size);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

/** Rainbow for confetti and chest gems: hue h 0..1, brightness k (above 1 — glows) */
export const rainbow = (h: number, k = 2.6): THREE.Color => new THREE.Color().setHSL(((h % 1) + 1) % 1, 1, 0.55).multiplyScalar(k);
