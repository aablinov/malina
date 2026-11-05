import * as THREE from 'three';
import { glowTex } from '../loot-look.ts';
import type { TdLane, TdMist } from './types.ts';

/**
 * Mist at the enemy camps (wiki/design-tower-defence.md, section 9): spawn points are hidden both from the yard and from the walls.
 * Around the start of each lane within `radius` — layers of soft opaque planes (the same radial texture as the lava
 * haze, but normal blending, to cover rather than glow) at three heights; denser towards the centre,
 * slowly drifting and breathing. Enabled by the `meta.td.mist` field (`TdMist`).
 */
export type { TdMist };

interface Puff { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; base: number; phase: number; cx: number; cz: number; r: number; a: number; ay: number; ry: number }

export class MistFx {
  readonly group = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private time = 0;

  private readonly scene: THREE.Scene;
  readonly spec: TdMist;
  constructor(scene: THREE.Scene, lanes: readonly TdLane[], spec: TdMist) { this.scene = scene; this.spec = spec;
    const tex = glowTex();
    const color = new THREE.Color(spec.color ?? '#dde6ec');
    const density = spec.density ?? 0.7;
    let seed = 1;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const l of lanes) {
      const [cx, cz] = l.points[0];
      const n = Math.round(10 + spec.radius * 1.6);
      for (let i = 0; i < n; i++) {
        // closer to the centre — bigger and denser; at the edge — sparser and more transparent
        const k = Math.sqrt(rnd()), a = rnd() * Math.PI * 2, r = k * spec.radius;
        const size = 6 + (1 - k) * 8 + rnd() * 3;
        const y = 0.35 + rnd() * 2.2;
        const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
        mesh.renderOrder = 3;
        this.group.add(mesh);
        this.puffs.push({ mesh, mat, base: density * (0.35 + (1 - k) * 0.4), phase: rnd() * 6, cx, cz, r, a, ay: 0.02 + rnd() * 0.04, ry: rnd() * Math.PI });
      }
    }
    scene.add(this.group);
  }

  get count(): number { return this.puffs.length; }

  update(dt: number): void {
    this.time += dt;
    for (const p of this.puffs) {
      p.a += p.ay * dt;
      p.mesh.position.x = p.cx + Math.cos(p.a) * p.r;
      p.mesh.position.z = p.cz + Math.sin(p.a) * p.r;
      p.mesh.rotation.z = p.ry + this.time * 0.02;
      p.mat.opacity = p.base * (0.85 + 0.15 * Math.sin(this.time * 0.4 + p.phase));
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const p of this.puffs) { p.mat.dispose(); p.mesh.geometry.dispose(); }
  }
}
