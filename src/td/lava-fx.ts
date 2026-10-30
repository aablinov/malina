import * as THREE from 'three';
import type { FX } from '../fx';
import type { Level } from '../level/level.ts';
import { glowTex } from '../loot-look';
import { C, glowMat } from '../bosses/kit';

/**
 * Живая лава (wiki/design-tower-defence.md, раздел 7): над каждым разломом — мягкая оранжевая **дымка** (плоскости с
 * радиальной текстурой, аддитивно, дышат), из лавы у героя поднимаются **искры и пепел**. Сама лава светит запечённым
 * светом на блоки вокруг (bakedLight блока `lava`) и эмиссией под bloom (mesher.ts).
 */
const HAZE = C(1.6, 0.6, 0.15);
const EMBER = [C(3.4, 1.4, 0.3), C(3.0, 0.8, 0.15), C(2.4, 2.0, 0.6)];

export class LavaFx {
  readonly group = new THREE.Group();
  /** Клетки лавы (x, z) */
  readonly cells: [number, number][] = [];
  private readonly hazes: { mat: THREE.MeshBasicMaterial; mesh: THREE.Mesh; phase: number; base: number }[] = [];
  private time = 0;

  constructor(private readonly scene: THREE.Scene, private readonly fx: FX, level: Level) {
    const b = level.getBounds();
    if (!b) return;
    const tiles = new Map<string, { n: number; sx: number; sz: number; y: number }>();
    for (let x = b.minX; x <= b.maxX; x++) for (let z = b.minZ; z <= b.maxZ; z++) {
      const t = level.topAt(x, z);
      if (t === null || level.nameAt(x, t, z) !== 'lava') continue;
      this.cells.push([x, z]);
      const k = `${Math.floor(x / 6)},${Math.floor(z / 6)},${t}`;
      const c = tiles.get(k) ?? { n: 0, sx: 0, sz: 0, y: t };
      c.n++; c.sx += x; c.sz += z;
      tiles.set(k, c);
    }
    // дымка: по одной плоскости на клетку 6 × 6 м, где лавы хотя бы 4 клетки; размер и яркость — от доли лавы
    const tex = glowTex();
    for (const c of tiles.values()) {
      if (c.n < 4) continue;
      const mat = glowMat(HAZE, 0.2, true);
      mat.map = tex;
      const size = 5 + Math.min(1, c.n / 36) * 5;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(c.sx / c.n, c.y + 1.45, c.sz / c.n);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.hazes.push({ mat, mesh, phase: Math.random() * 6, base: 0.1 + Math.min(1, c.n / 36) * 0.12 });
    }
    scene.add(this.group);
  }

  update(dt: number, hero: THREE.Vector3): void {
    this.time += dt;
    for (const h of this.hazes) {
      h.mat.opacity = h.base * (0.8 + 0.2 * Math.sin(this.time * 0.7 + h.phase));
      h.mesh.position.y += Math.sin(this.time * 0.5 + h.phase) * dt * 0.02;
    }
    // искры: две клетки лавы в 22 м от героя за кадр
    if (!this.cells.length) return;
    for (let i = 0; i < 2; i++) {
      const [x, z] = this.cells[Math.floor(Math.random() * this.cells.length)];
      if (Math.abs(x - hero.x) > 22 || Math.abs(z - hero.z) > 22 || Math.random() < 0.5) continue;
      const ember = Math.random() < 0.7;
      this.fx.particle({
        pos: new THREE.Vector3(x + (Math.random() - 0.5), 0.05, z + (Math.random() - 0.5)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, ember ? 1 + Math.random() * 1.2 : 0.5, (Math.random() - 0.5) * 0.4),
        life: ember ? 1.2 + Math.random() : 2, size: ember ? 0.07 : 0.1, color: ember ? EMBER[Math.floor(Math.random() * EMBER.length)] : '#3a2a24', gravity: ember ? -0.3 : -0.1, drag: 0.5,
      }, ember);
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const h of this.hazes) { h.mat.dispose(); h.mesh.geometry.dispose(); }
  }
}
