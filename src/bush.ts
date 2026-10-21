import * as THREE from 'three';
import { CFG, type Plot } from './config';
import type { Textures } from './textures';

const GREEN = new THREE.Color('#79b83e');
const PINK = new THREE.Color('#f08aa0');
const RED = new THREE.Color('#d0123f');
const _d = new THREE.Object3D();
const _c = new THREE.Color();

export interface BushOptions {
  /** Сразу взрослый куст */
  mature?: boolean;
  /** Сколько секунд урожая уже накоплено */
  harvestT?: number;
}

export class Bush {
  readonly pos: THREE.Vector3;
  /** Секунды роста от ростка */
  growT: number;
  /** Секунды до следующего урожая */
  harvestT: number;
  ready = false;
  readonly maxHp: number = CFG.BUSH_HP;
  hp: number = CFG.BUSH_HP;
  dead = false;
  private shake = 0;
  private readonly seed = Math.random() * 100;

  private readonly group: THREE.Group;
  private readonly inner: THREE.Group;
  private readonly leaves: THREE.InstancedMesh;
  private readonly berries: THREE.InstancedMesh;
  private readonly berryMat: THREE.MeshStandardMaterial;
  private readonly berryPos: THREE.Vector3[] = [];

  constructor(private readonly scene: THREE.Scene, T: Textures, readonly plot: Plot, { mature = false, harvestT = 0 }: BushOptions = {}) {
    this.pos = new THREE.Vector3(plot.x, 0, plot.z);
    this.growT = mature ? CFG.GROW_TIME : 0;
    this.harvestT = harvestT;

    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.inner = new THREE.Group();
    this.group.add(this.inner);
    scene.add(this.group);

    const cane = new THREE.MeshLambertMaterial({ color: '#6b4a2b' });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.0, 0.07), cane);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      m.position.set(Math.cos(a) * 0.18, 0.5, Math.sin(a) * 0.18);
      m.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      m.castShadow = true;
      this.inner.add(m);
    }

    const leafMat = new THREE.MeshLambertMaterial({ map: T.bushLeaves });
    const NL = 38;
    this.leaves = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), leafMat, NL);
    for (let i = 0; i < NL; i++) {
      const y = 0.15 + Math.random() * 0.95;
      const rr = (0.22 + Math.random() * 0.36) * (1 - ((y - 0.15) / 1.1) * 0.55);
      const a = Math.random() * Math.PI * 2;
      _d.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      _d.rotation.set(0, Math.random() * 1.5, 0);
      _d.scale.setScalar(0.24 + Math.random() * 0.14);
      _d.updateMatrix();
      this.leaves.setMatrixAt(i, _d.matrix);
      this.leaves.setColorAt(i, _c.setScalar(0.75 + Math.random() * 0.35));
    }
    this.leaves.castShadow = true;
    this.leaves.receiveShadow = true;
    this.inner.add(this.leaves);

    this.berryMat = new THREE.MeshStandardMaterial({ map: T.berry, color: GREEN.clone(), roughness: 0.35, emissive: new THREE.Color('#ff1f4f'), emissiveIntensity: 0 });
    const NB = 16;
    this.berries = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.berryMat, NB);
    for (let i = 0; i < NB; i++) {
      const y = 0.3 + Math.random() * 0.7;
      const rr = 0.48 * (1 - ((y - 0.15) / 1.1) * 0.5) + 0.04;
      const a = (i / NB) * Math.PI * 2 + Math.random() * 0.4;
      this.berryPos.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    this.berries.castShadow = true;
    this.inner.add(this.berries);
    this.updateBerries(0, 0);
  }

  get mature(): boolean { return this.growT >= CFG.GROW_TIME; }
  get growK(): number { return Math.min(1, this.growT / CFG.GROW_TIME); }
  get harvestK(): number { return this.ready ? 1 : Math.min(1, this.harvestT / CFG.HARVEST_TIME); }

  private updateBerries(k: number, t: number): void {
    const vis = this.mature ? k : 0;
    for (let i = 0; i < this.berryPos.length; i++) {
      const p = this.berryPos[i];
      const s = vis <= 0 ? 0.0001 : (0.06 + vis * 0.09) * (this.ready ? 1 + Math.sin(t * 6 + i) * 0.12 : 1);
      _d.position.copy(p);
      _d.rotation.set(0, i, 0);
      _d.scale.setScalar(s);
      _d.updateMatrix();
      this.berries.setMatrixAt(i, _d.matrix);
    }
    this.berries.instanceMatrix.needsUpdate = true;
    if (k < 0.6) _c.copy(GREEN).lerp(PINK, k / 0.6); else _c.copy(PINK).lerp(RED, (k - 0.6) / 0.4);
    this.berryMat.color.copy(_c);
    this.berryMat.emissiveIntensity = this.ready ? 1.2 + Math.sin(t * 5) * 0.6 : 0;
  }

  /**
   * growing — идёт ли сейчас рост (только днём).
   * Возвращает true в кадр, когда урожай созрел.
   */
  update(dt: number, t: number, growing = true): boolean {
    let justReady = false;
    const g = growing ? dt : 0;
    if (!this.mature) {
      this.growT += g;
    } else if (!this.ready) {
      this.harvestT += g;
      if (this.harvestT >= CFG.HARVEST_TIME) { this.ready = true; justReady = true; }
    }
    const k = this.growK;
    const s = 0.3 + 0.7 * (k * k * (3 - 2 * k));
    this.inner.scale.setScalar(s);
    this.shake = Math.max(0, this.shake - dt);
    const sh = this.shake > 0 ? Math.sin(t * 60) * 0.08 * (this.shake / 0.3) : 0;
    this.inner.rotation.z = sh + Math.sin(t * 1.3 + this.seed) * 0.02;
    this.inner.rotation.x = sh * 0.6;
    this.updateBerries(this.harvestK, t);
    return justReady;
  }

  harvest(): void {
    this.ready = false;
    this.harvestT = 0;
  }

  heal(n: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    return this.hp - before;
  }

  damage(d: number): void {
    this.hp -= d;
    this.shake = 0.3;
    if (this.hp <= 0) this.dead = true;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.berryMat.dispose();
  }
}
