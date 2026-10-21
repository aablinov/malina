import * as THREE from 'three';
import { raycastObstacles, type Obstacle } from '../collision';
import type { FX } from '../fx';
import type { Shootable } from '../gunplay';
import type { ArachnidTuning } from '../tuning';

/**
 * Мишени плейграунда: неподвижный манекен, манекен на рельсе, манекен-стрелок.
 * Каждый считает урон каждого попадания и средний урон в секунду за последние 3 с.
 */

const DPS_WINDOW = 3;

const mats = {
  body: new THREE.MeshLambertMaterial({ color: '#d8b779' }),
  bodyD: new THREE.MeshLambertMaterial({ color: '#b8935a' }),
  pole: new THREE.MeshLambertMaterial({ color: '#5a4630' }),
  ring: new THREE.MeshLambertMaterial({ color: '#c4284f' }),
  white: new THREE.MeshLambertMaterial({ color: '#f2efe6' }),
  shooter: new THREE.MeshLambertMaterial({ color: '#6aa84f' }),
  base: new THREE.MeshLambertMaterial({ color: '#4a4f57' }),
};

function box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export type DummyKind = 'static' | 'rail' | 'shooter';

export class Dummy implements Shootable {
  readonly pos: THREE.Vector3;
  readonly radius = 0.34;
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
  railSpeed = 4;
  private railDir = 1;
  railA = 0;
  railB = 0;
  // стрелок
  active = true;
  spitCd = 2;
  private spitT = 1;

  constructor(scene: THREE.Scene, overlay: HTMLElement, readonly kind: DummyKind, x: number, z: number, facing = 0, readonly name = '') {
    this.pos = new THREE.Vector3(x, 0, z);
    scene.add(this.group);
    this.group.position.copy(this.pos);
    this.group.rotation.y = facing;
    box(this.group, 0.6, 0.08, 0.6, mats.base, 0, 0.04, 0);
    this.group.add(this.body);
    const bodyMat = (kind === 'shooter' ? mats.shooter : mats.body).clone();
    const bodyMatD = mats.bodyD.clone();
    this.flashMats.push(bodyMat, bodyMatD);
    box(this.body, 0.1, 0.8, 0.1, mats.pole, 0, 0.45, 0);
    box(this.body, 0.5, 0.62, 0.3, bodyMat, 0, 1.12, 0);
    box(this.body, 0.36, 0.34, 0.34, bodyMatD, 0, 1.62, 0);
    // мишень на груди
    box(this.body, 0.3, 0.3, 0.02, mats.white, 0, 1.14, 0.16);
    box(this.body, 0.2, 0.2, 0.025, mats.ring, 0, 1.14, 0.165);
    box(this.body, 0.08, 0.08, 0.03, mats.white, 0, 1.14, 0.17);
    if (kind === 'shooter') box(this.body, 0.14, 0.14, 0.3, mats.shooter, 0, 1.62, 0.25);

    this.label = document.createElement('div');
    this.label.className = 'pg-dummy';
    overlay.appendChild(this.label);
  }

  hit(dmg: number, dir: THREE.Vector3, _point: THREE.Vector3, knock: number): void {
    this.simLog.push({ t: this.simTime, d: dmg });
    this.total += dmg;
    this.hits++;
    this.lastHit = dmg;
    this.flashT = 0.08;
    const k = 1.2 + knock * 3;
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

  update(dt: number, ctx: { hero: THREE.Vector3; obstacles: readonly Obstacle[]; spit: (from: THREE.Vector3, to: THREE.Vector3) => void }): void {
    this.simTime += dt;
    if (this.kind === 'rail') {
      this.pos.x += this.railDir * this.railSpeed * dt;
      if (this.pos.x > this.railB) { this.pos.x = this.railB; this.railDir = -1; }
      if (this.pos.x < this.railA) { this.pos.x = this.railA; this.railDir = 1; }
    }
    if (this.kind === 'shooter' && this.active) {
      const to = ctx.hero.clone().sub(this.pos);
      const d = Math.hypot(to.x, to.z);
      this.group.rotation.y = Math.atan2(to.x, to.z);
      this.spitT -= dt;
      if (this.spitT <= 0) {
        this.spitT = this.spitCd;
        if (d < 18) {
          const from = this.pos.clone().add(new THREE.Vector3(to.x / d * 0.4, SPIT_Y, to.z / d * 0.4));
          const los = raycastObstacles(from.x, from.z, to.x / d, to.z / d, d, SPIT_Y, ctx.obstacles);
          if (!los) ctx.spit(from, ctx.hero.clone().setY(SPIT_Y));
        }
      }
    }
    // качание от попаданий: пружина
    this.wobbleV.addScaledVector(this.wobble, -60 * dt);
    this.wobbleV.multiplyScalar(Math.exp(-6 * dt));
    this.wobble.addScaledVector(this.wobbleV, dt);
    this.group.position.copy(this.pos);
    this.body.rotation.set(this.wobble.y * 0.25, 0, -this.wobble.x * 0.25);
    this.body.rotation.y = 0;
    this.flashT = Math.max(0, this.flashT - dt);
    for (const m of this.flashMats) m.emissive.setScalar(this.flashT > 0 ? 0.7 : 0);
  }

  /** Подпись над манекеном */
  drawLabel(camera: THREE.Camera, w: number, h: number): void {
    const v = this.pos.clone().setY(2.15).project(camera);
    const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    this.label.style.display = on ? '' : 'none';
    if (!on) return;
    this.label.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%,-100%)`;
    const parts: string[] = [];
    if (this.name) parts.push(`<i>${this.name}</i>`);
    if (this.kind === 'rail') parts.push(`<i>${this.railSpeed} м/с</i>`);
    if (this.kind === 'shooter') parts.push(`<i>${this.active ? 'плюёт раз в ' + this.spitCd + ' с' : 'выключен'}</i>`);
    if (this.hits) parts.push(`<b>${fmt(this.lastHit)}</b> · Σ ${fmt(this.total)} · ${this.dps.toFixed(1)}/с`);
    const t = parts.join('<br>');
    if (t !== this.labelText) { this.labelText = t; this.label.innerHTML = t; }
  }
}

const fmt = (n: number): string => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

/** Высота плевка манекена-стрелка: стоя попадает, присев — пролетает над каской */
export const SPIT_Y = 1.55;

export interface Spit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  mesh: THREE.Mesh;
  /** Паутина ткача: замедляет и травит */
  web?: ArachnidTuning;
}

const spitGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const webGeo = new THREE.BoxGeometry(0.34, 0.34, 0.08);

export class Spits {
  readonly list: Spit[] = [];
  private readonly mat: THREE.MeshBasicMaterial;
  constructor(private readonly scene: THREE.Scene, private readonly fx: FX) {
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 3.2, 0.4), toneMapped: false });
  }

  fire(from: THREE.Vector3, to: THREE.Vector3, speed: number, dmg: number, color?: THREE.Color): void {
    const vel = to.clone().sub(from);
    vel.y = 0;
    vel.setLength(speed);
    const mesh = new THREE.Mesh(spitGeo, color ? new THREE.MeshBasicMaterial({ color, toneMapped: false }) : this.mat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.list.push({ pos: from.clone(), vel, life: 3, dmg, mesh });
  }

  /** Комок паутины: летит с заданной скоростью, крутится крестом */
  fireWeb(from: THREE.Vector3, vel: THREE.Vector3, t: ArachnidTuning): void {
    const mesh = new THREE.Mesh(webGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 3.4, 0.5), toneMapped: false }));
    const cross = new THREE.Mesh(webGeo, mesh.material);
    cross.rotation.z = Math.PI / 2;
    mesh.add(cross);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.list.push({ pos: from.clone(), vel: vel.clone(), life: 2.5, dmg: t.webDmg, mesh, web: t });
  }

  /** hitHero возвращает true, если попал (тогда плевок исчезает) */
  update(dt: number, obstacles: readonly Obstacle[], hitHero: (s: Spit) => boolean): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.life -= dt;
      const step = s.vel.length() * dt;
      const dir = s.vel.clone().normalize();
      const wall = raycastObstacles(s.pos.x, s.pos.z, dir.x, dir.z, step, s.pos.y, obstacles);
      if (wall) {
        s.pos.addScaledVector(dir, wall.t);
        this.fx.burst(s.pos.clone(), [new THREE.Color(0.9, 3, 0.4), '#3a6a1a'], 6, { speed: 2, up: 1.5, size: 0.07, life: 0.4, glow: true, gravity: 6 });
        this.remove(i);
        continue;
      }
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      if (s.web) { s.mesh.rotation.z += dt * 12; s.mesh.lookAt(s.pos.clone().add(s.vel)); s.mesh.rotateZ(s.life * 12); }
      else { s.mesh.rotation.x += dt * 9; s.mesh.rotation.y += dt * 7; }
      if (Math.random() < 0.5) this.fx.burst(s.pos.clone(), [new THREE.Color(0.6, 2.4, 0.3)], 1, { speed: 0.3, up: 0.2, size: 0.05, life: 0.3, glow: true, gravity: 0 });
      if (hitHero(s) || s.life <= 0) this.remove(i);
    }
  }

  private remove(i: number): void {
    const s = this.list[i];
    this.scene.remove(s.mesh);
    if (s.mesh.material !== this.mat) (s.mesh.material as THREE.Material).dispose();
    this.list.splice(i, 1);
  }

  clear(): void { for (let i = this.list.length - 1; i >= 0; i--) this.remove(i); }
}
