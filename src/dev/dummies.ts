import * as THREE from 'three';
import type { Target } from '../target';
import { pixelTex } from '../textures';

/**
 * Соломенные чучела плейграунда — цели для меча: неподвижные и на рельсе.
 * Каждое считает урон каждого удара и средний урон в секунду за последние 3 с.
 */

const DPS_WINDOW = 3;

const mats = {
  straw: new THREE.MeshLambertMaterial({ map: pixelTex('#e8c35a', 12, 81) }),
  sack: new THREE.MeshLambertMaterial({ map: pixelTex('#cfa877', 8, 82) }),
  pole: new THREE.MeshLambertMaterial({ map: pixelTex('#7a5232', 8, 83) }),
  rope: new THREE.MeshLambertMaterial({ color: '#8a5a2a' }),
  stitch: new THREE.MeshLambertMaterial({ color: '#3a2414' }),
  ring: new THREE.MeshLambertMaterial({ color: '#d23a5c' }),
  white: new THREE.MeshLambertMaterial({ color: '#fff4dc' }),
};

function box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export type DummyKind = 'static' | 'rail';

export class Dummy implements Target {
  readonly pos: THREE.Vector3;
  readonly radius = 0.38;
  readonly alive = true;
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  total = 0;
  hits = 0;
  lastHit = 0;
  private wobble = new THREE.Vector2();
  private wobbleV = new THREE.Vector2();
  private flashT = 0;
  private readonly flashMats: THREE.MeshLambertMaterial[] = [];
  private readonly label: HTMLDivElement;
  private labelText = '';

  // рельс
  railSpeed = 2;
  private railDir = 1;
  railA = 0;
  railB = 0;

  constructor(scene: THREE.Scene, overlay: HTMLElement, readonly kind: DummyKind, x: number, z: number, facing = 0, readonly name = '') {
    this.pos = new THREE.Vector3(x, 0, z);
    scene.add(this.group);
    this.group.position.copy(this.pos);
    this.group.rotation.y = facing;
    box(this.group, 0.5, 0.12, 0.5, mats.pole, 0, 0.06, 0);
    this.group.add(this.body);
    const straw = mats.straw.clone(), sack = mats.sack.clone();
    this.flashMats.push(straw, sack);
    // кол, соломенное тело с перевязками, руки-палка, голова-мешок с вышитым лицом
    box(this.body, 0.12, 0.9, 0.12, mats.pole, 0, 0.5, 0);
    box(this.body, 0.56, 0.66, 0.38, straw, 0, 1.12, 0);
    for (const y of [0.88, 1.36]) box(this.body, 0.6, 0.06, 0.42, mats.rope, 0, y, 0);
    box(this.body, 1.3, 0.1, 0.1, mats.pole, 0, 1.3, 0);
    for (const x of [-0.62, 0.62]) box(this.body, 0.16, 0.22, 0.16, straw, x, 1.26, 0);
    box(this.body, 0.46, 0.44, 0.42, sack, 0, 1.68, 0);
    for (const x of [-0.1, 0.1]) box(this.body, 0.07, 0.07, 0.02, mats.stitch, x, 1.72, 0.215);
    box(this.body, 0.2, 0.04, 0.02, mats.stitch, 0, 1.58, 0.215);
    // мишень на груди
    box(this.body, 0.3, 0.3, 0.02, mats.white, 0, 1.12, 0.2);
    box(this.body, 0.2, 0.2, 0.025, mats.ring, 0, 1.12, 0.205);
    box(this.body, 0.08, 0.08, 0.03, mats.white, 0, 1.12, 0.21);

    this.label = document.createElement('div');
    this.label.className = 'pg-dummy';
    overlay.appendChild(this.label);
  }

  hit(dmg: number, dir: THREE.Vector3, _point: THREE.Vector3, knock: number): void {
    this.simLog.push({ t: this.simTime, d: dmg });
    this.total += dmg;
    this.hits++;
    this.lastHit = dmg;
    this.flashT = 0.1;
    const k = 1.5 + knock * 3;
    this.wobbleV.x += dir.x * k;
    this.wobbleV.y += dir.z * k;
  }

  /** Время симуляции — DPS не зависит от замедления времени */
  private simTime = 0;
  private readonly simLog: { t: number; d: number }[] = [];

  get dps(): number {
    const from = this.simTime - DPS_WINDOW;
    while (this.simLog.length && this.simLog[0].t < from) this.simLog.shift();
    return this.simLog.reduce((a, h) => a + h.d, 0) / DPS_WINDOW;
  }

  reset(): void {
    this.total = 0; this.hits = 0; this.lastHit = 0;
    this.simLog.length = 0;
    this.wobble.set(0, 0); this.wobbleV.set(0, 0);
  }

  update(dt: number): void {
    this.simTime += dt;
    if (this.kind === 'rail') {
      this.pos.x += this.railDir * this.railSpeed * dt;
      if (this.pos.x > this.railB) { this.pos.x = this.railB; this.railDir = -1; }
      if (this.pos.x < this.railA) { this.pos.x = this.railA; this.railDir = 1; }
    }
    // качание от ударов: пружина
    this.wobbleV.addScaledVector(this.wobble, -60 * dt);
    this.wobbleV.multiplyScalar(Math.exp(-6 * dt));
    this.wobble.addScaledVector(this.wobbleV, dt);
    this.group.position.copy(this.pos);
    this.body.rotation.set(this.wobble.y * 0.25, 0, -this.wobble.x * 0.25);
    this.flashT = Math.max(0, this.flashT - dt);
    for (const m of this.flashMats) m.emissive.setScalar(this.flashT > 0 ? 0.7 : 0);
  }

  /** Подпись над чучелом */
  drawLabel(camera: THREE.Camera, w: number, h: number): void {
    const v = this.pos.clone().setY(2.25).project(camera);
    const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    this.label.style.display = on ? '' : 'none';
    if (!on) return;
    this.label.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%,-100%)`;
    const parts: string[] = [];
    if (this.name) parts.push(`<i>${this.name}</i>`);
    if (this.kind === 'rail') parts.push(`<i>${this.railSpeed} м/с</i>`);
    if (this.hits) parts.push(`<b>${fmt(this.lastHit)}</b> · Σ ${fmt(this.total)} · ${this.dps.toFixed(1)}/с`);
    const t = parts.join('<br>');
    if (t !== this.labelText) { this.labelText = t; this.label.innerHTML = t; }
  }
}

const fmt = (n: number): string => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
