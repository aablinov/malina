import * as THREE from 'three';
import { markShared } from './fx';

/**
 * Общий вид сокровищ: мягкое свечение, лучи-звезда за трофеем и столб света. Текстуры рисуются кодом один раз.
 * Предмет на полу может нести в userData:
 * - glow: THREE.Color — цвет искр вокруг, вспышки при приземлении и подборе;
 * - rarity: 0 обычный, 1 редкий, 2 уникальный — сила эффектов и звука;
 * - tick(t, grounded) — своя анимация каждый кадр (пульс, вращение лучей).
 */
export interface LootData {
  glow?: THREE.Color;
  rarity?: number;
  tick?: (t: number, grounded: boolean) => void;
}

const canvasTexture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d') as CanvasRenderingContext2D);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

let glow: THREE.Texture | null = null, rays: THREE.Texture | null = null, beam: THREE.Texture | null = null, star: THREE.Texture | null = null;

/** Круглый ореол: белый в центре, к краю прозрачный */
export const glowTex = (): THREE.Texture => glow ??= canvasTexture(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});

/** Звезда из лучей — крутится за трофеем */
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

/** Столб света: ярче к середине и к низу, сверху тает */
export const beamTex = (): THREE.Texture => beam ??= canvasTexture(32, 128, (g) => {
  for (let y = 0; y < 128; y++) {
    const v = Math.pow(y / 127, 1.4); // 0 сверху, 1 снизу
    const gr = g.createLinearGradient(0, 0, 32, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${v})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, y, 32, 1);
  }
});

/** Четырёхлучевая искорка — блеск на сокровищах */
export const starTex = (): THREE.Texture => star ??= canvasTexture(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(14, 0, 4, 32); g.fillRect(0, 14, 32, 4);
  g.beginPath(); g.arc(16, 16, 6, 0, Math.PI * 2); g.fill();
});

/** Аддитивный материал свечения (не тонируется — ярче единицы светится через bloom) */
export const additive = (map: THREE.Texture, color: THREE.Color, opacity = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
});

export const additiveSprite = (map: THREE.Texture, color: THREE.Color, opacity = 1): THREE.SpriteMaterial => new THREE.SpriteMaterial({
  map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

/** Общие единичные плоскости: центрированная и от низа вверх (размер — через scale) */
let plane: THREE.PlaneGeometry | null = null, planeUp: THREE.PlaneGeometry | null = null;
const PLANE = (): THREE.PlaneGeometry => plane ??= markShared(new THREE.PlaneGeometry(1, 1));
const PLANE_UP = (): THREE.PlaneGeometry => planeUp ??= markShared(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0) as THREE.PlaneGeometry);

/** Столб света из двух скрещённых плоскостей: широкий мягкий и узкий яркий */
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

/** Ореол на земле (плоский, смотрит вверх) */
export function groundGlow(color: THREE.Color, size: number, opacity = 1): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(PLANE(), additive(glowTex(), color, opacity));
  m.scale.setScalar(size);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

/** Радуга для конфетти и камней сундука: оттенок h 0..1, яркость k (больше 1 — светится) */
export const rainbow = (h: number, k = 2.6): THREE.Color => new THREE.Color().setHSL(((h % 1) + 1) % 1, 1, 0.55).multiplyScalar(k);
