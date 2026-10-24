import * as THREE from 'three';
import type { Obstacle } from './collision';
import type { Textures } from './textures';
import { pixelTex } from './textures';

/**
 * Лавки как в лагере Minecraft Dungeons (wiki/design-inventory.md, раздел «Торговцы»): кузнец — каменная стена
 * с горном и наковальней, навес в жёлто-бирюзовую полоску; торговец — ящики и бочки, навес в красно-оранжевую.
 * За прилавком житель (у кузнеца светятся глаза), над лавкой — имя пиксельным шрифтом. Прилавок и лавка — препятствие.
 * Торговля — окно src/hud/shop.ts, открывается на F рядом с прилавком.
 */

export type MerchantKind = 'smith' | 'merchant';

export const MERCHANT_TITLE: Record<MerchantKind, string> = { smith: 'Кузнец', merchant: 'Торговец' };

const ROT = (deg: number): number => THREE.MathUtils.degToRad(deg);

/** Коробка с текстурой, повторённой по метрам (пиксели не растягиваются на большую грань) */
function tiled(w: number, h: number, d: number, tex: THREE.Texture, x: number, y: number, z: number, tint?: string): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: t, color: tint ?? '#ffffff' }));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cube(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

const glow = (c: string, k = 2.6): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

export class Merchant {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  /** Где встать покупателю: перед прилавком */
  readonly front: THREE.Vector3;
  readonly solid: Obstacle;
  private readonly npc = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly label: HTMLDivElement;
  private readonly fire: THREE.PointLight | null = null;
  private t = Math.random() * 6;

  /** yaw — куда смотрит прилавок: 0 — к +Z */
  constructor(scene: THREE.Scene, overlay: HTMLElement, T: Textures, readonly kind: MerchantKind, x: number, z: number, yaw: number, y = 0) {
    this.pos = new THREE.Vector3(x, y, z);
    const g = this.group;
    g.position.copy(this.pos);
    g.rotation.y = yaw;
    scene.add(g);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.front = this.pos.clone().addScaledVector(fwd, 1.9);
    this.solid = { x, z, hx: 1.7, hz: 1.6, rot: -yaw, h: 2.4 };

    const wood = pixelTex('#9a6a3a', 7, 120), darkWood = pixelTex('#5e3d22', 6, 121);
    // прилавок из досок
    g.add(tiled(2.8, 0.85, 0.7, T.planks, 0, 0.425, 1.05));
    g.add(tiled(2.9, 0.1, 0.8, T.planks, 0, 0.9, 1.05, '#e8c890'));
    // столбы и навес в полоску
    for (const [px, pz] of [[-1.45, 0.65], [1.45, 0.65], [-1.45, -1.25], [1.45, -1.25]]) g.add(tiled(0.18, 2.9, 0.18, darkWood, px, 1.45, pz));
    const stripes = kind === 'smith' ? ['#f2c94a', '#5ab8b0'] : ['#e8452e', '#f59a23'];
    const awning = new THREE.Group();
    // навес над задней половиной лавки: житель за прилавком виден сверху, как в MCD
    awning.position.set(0, 2.95, -0.35);
    awning.rotation.x = ROT(12);
    for (let i = 0; i < 6; i++) {
      const c = stripes[i % 2];
      awning.add(cube(0.52, 0.08, 2.5, new THREE.MeshLambertMaterial({ map: pixelTex(c, 8, 130 + i) }), -1.3 + i * 0.52, 0, 0));
      awning.add(cube(0.52, 0.22, 0.06, new THREE.MeshLambertMaterial({ map: pixelTex(c, 8, 140 + i) }), -1.3 + i * 0.52, -0.12, 1.25));
    }
    g.add(awning);

    if (kind === 'smith') {
      // каменная стена с горном и наковальня
      g.add(tiled(3.4, 2.6, 0.45, T.stoneBricksMossy, 0, 1.3, -1.55));
      g.add(tiled(1.0, 1.0, 0.5, T.stoneBricks, -0.9, 0.9, -1.15, '#9a9a9a'));
      g.add(cube(0.6, 0.35, 0.1, glow('#ff8a2a', 2.2), -0.9, 0.85, -0.88));
      this.fire = new THREE.PointLight('#ff9a3a', 6, 6, 1.6);
      this.fire.position.set(-0.9, 1.1, -0.5);
      g.add(this.fire);
      const iron = new THREE.MeshLambertMaterial({ map: pixelTex('#4a4e57', 6, 122) });
      g.add(cube(0.25, 0.4, 0.25, iron, 0.95, 0.2, -0.6), cube(0.55, 0.15, 0.3, iron, 0.95, 0.47, -0.6), cube(0.2, 0.1, 0.2, iron, 1.25, 0.5, -0.6));
      // молот на прилавке и топор на стойке
      g.add(cube(0.08, 0.08, 0.5, new THREE.MeshLambertMaterial({ map: wood }), 0.8, 1.0, 1.0), cube(0.22, 0.14, 0.14, iron, 0.8, 1.02, 1.28));
      g.add(cube(0.06, 1.2, 0.06, new THREE.MeshLambertMaterial({ map: darkWood }), 1.75, 0.6, 1.2), cube(0.36, 0.3, 0.06, new THREE.MeshLambertMaterial({ map: pixelTex('#d8dde4', 6, 123) }), 1.75, 1.15, 1.2));
    } else {
      // ящики, бочка и мешки с товаром
      g.add(tiled(0.8, 0.8, 0.8, T.crate, -1.0, 0.4, -0.9), tiled(0.6, 0.6, 0.6, T.crate, -1.0, 1.1, -0.9));
      g.add(tiled(0.7, 0.9, 0.7, darkWood, 1.0, 0.45, -0.9), cube(0.72, 0.06, 0.72, new THREE.MeshLambertMaterial({ map: pixelTex('#4a4e57', 6, 124) }), 1.0, 0.7, -0.9));
      g.add(cube(0.4, 0.3, 0.3, new THREE.MeshLambertMaterial({ map: pixelTex('#c8b07a', 8, 125) }), -0.7, 1.08, 1.05));
      g.add(cube(0.22, 0.22, 0.22, new THREE.MeshLambertMaterial({ color: '#c4284f', emissive: '#c4284f', emissiveIntensity: 0.25 }), 0.6, 1.06, 1.0));
      g.add(cube(0.22, 0.22, 0.22, new THREE.MeshLambertMaterial({ color: '#c4284f', emissive: '#c4284f', emissiveIntensity: 0.25 }), 0.85, 1.06, 1.1));
    }

    // житель за прилавком: роба, крупная голова с носом, руки скрещены
    const robe = kind === 'smith' ? '#3a3036' : '#4f7a3a';
    const skin = new THREE.MeshLambertMaterial({ map: pixelTex('#c99a78', 6, 126) });
    const cloth = new THREE.MeshLambertMaterial({ map: pixelTex(robe, 8, 127) });
    this.npc.position.set(0, 0, 0.4);
    g.add(this.npc);
    this.npc.add(cube(0.52, 1.25, 0.36, cloth, 0, 0.62, 0));
    if (kind === 'smith') this.npc.add(cube(0.42, 0.8, 0.04, new THREE.MeshLambertMaterial({ map: pixelTex('#5e3d22', 6, 128) }), 0, 0.75, 0.19));
    this.npc.add(cube(0.6, 0.22, 0.26, cloth, 0, 1.0, 0.22), cube(0.4, 0.18, 0.2, skin, 0, 1.0, 0.3));
    this.head.position.set(0, 1.25, 0);
    this.npc.add(this.head);
    this.head.add(cube(0.5, 0.6, 0.5, skin, 0, 0.3, 0));
    this.head.add(cube(0.12, 0.24, 0.12, skin, 0, 0.18, 0.3));
    this.head.add(cube(0.42, 0.06, 0.02, new THREE.MeshLambertMaterial({ color: '#3a2a1e' }), 0, 0.44, 0.26));
    const eye = kind === 'smith' ? glow('#c27aff', 3) : new THREE.MeshLambertMaterial({ color: '#2f6f3a' });
    this.head.add(cube(0.1, 0.07, 0.02, eye, -0.12, 0.36, 0.26), cube(0.1, 0.07, 0.02, eye, 0.12, 0.36, 0.26));
    if (kind === 'merchant') this.head.add(cube(0.56, 0.12, 0.56, new THREE.MeshLambertMaterial({ map: pixelTex('#c8a060', 8, 129) }), 0, 0.64, 0), cube(0.38, 0.14, 0.38, new THREE.MeshLambertMaterial({ map: pixelTex('#c8a060', 8, 131) }), 0, 0.76, 0));

    this.label = document.createElement('div');
    this.label.className = 'npc-label';
    this.label.textContent = MERCHANT_TITLE[kind];
    overlay.appendChild(this.label);
  }

  /** Житель дышит и смотрит на героя, горн мерцает */
  update(dt: number, hero: THREE.Vector3): void {
    this.t += dt;
    this.npc.position.y = Math.sin(this.t * 2) * 0.015;
    const local = this.group.worldToLocal(hero.clone());
    const want = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.8, 0.8);
    this.head.rotation.y += (want - this.head.rotation.y) * Math.min(1, dt * 4);
    if (this.fire) this.fire.intensity = 5 + Math.sin(this.t * 13) * 0.8 + Math.sin(this.t * 7.3) * 0.6;
  }

  /** Рядом с прилавком — можно торговать */
  near(p: THREE.Vector3): boolean { return Math.hypot(p.x - this.front.x, p.z - this.front.z) < 1.6 && Math.abs(p.y - this.pos.y) < 1.5; }

  drawLabel(camera: THREE.Camera, w: number, h: number): void {
    const v = this.pos.clone().setY(this.pos.y + 3.4).project(camera);
    const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    this.label.style.display = on ? '' : 'none';
    if (on) this.label.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%,-100%)`;
  }
}
