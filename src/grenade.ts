import * as THREE from 'three';
import { raycastObstacles, type Obstacle } from './collision';
import type { FX } from './fx';
import { distToObstacle } from './nav';
import { GRENADE } from './tuning';

/**
 * Гранаты РГД-5: летят по дуге, отскакивают от стен и пола, взрываются по фитилю.
 * Пока граната лежит, на земле видно кольцо радиуса поражения — чтобы успеть убежать или откатиться.
 */

export interface Grenade {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Сколько осталось до взрыва, с */
  fuse: number;
  mesh: THREE.Group;
  ring: THREE.Mesh;
  /** Кто бросил — для журнала и тестов */
  owner: string;
}

const G = 14;
const bodyGeo = new THREE.BoxGeometry(0.13, 0.15, 0.13);
const capGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
const leverGeo = new THREE.BoxGeometry(0.03, 0.12, 0.04);
const bodyMat = new THREE.MeshLambertMaterial({ color: '#4c5a2e' });
const capMat = new THREE.MeshLambertMaterial({ color: '#8a8f96' });

export class Grenades {
  readonly list: Grenade[] = [];
  /** Сколько брошено и взорвано — для телеметрии и тестов */
  thrown = 0;
  exploded = 0;

  constructor(private readonly scene: THREE.Scene, private readonly fx: FX, private readonly onExplode: (at: THREE.Vector3, g: Grenade) => void) {}

  /** Модель гранаты (её же держит рука при броске) */
  static model(): THREE.Group {
    const g = new THREE.Group();
    const b = new THREE.Mesh(bodyGeo, bodyMat);
    const c = new THREE.Mesh(capGeo, capMat); c.position.y = 0.1;
    const l = new THREE.Mesh(leverGeo, capMat); l.position.set(0.07, 0.03, 0);
    b.castShadow = true;
    g.add(b, c, l);
    return g;
  }

  /**
   * Бросок из from в target. fuse — сколько осталось фитиля (бросающий мог «готовить» гранату).
   * Траектория: время полёта растёт с дальностью, скорость считается под попадание в точку.
   */
  throw(from: THREE.Vector3, target: THREE.Vector3, fuse: number, owner = ''): Grenade {
    const d = new THREE.Vector3(target.x - from.x, 0, target.z - from.z);
    let dist = d.length();
    if (dist > GRENADE.range) { d.setLength(GRENADE.range); dist = GRENADE.range; }
    const T = 0.45 + dist * 0.06;
    const vel = new THREE.Vector3(d.x / T, (0.1 - from.y + 0.5 * G * T * T) / T, d.z / T);
    const mesh = Grenades.model();
    mesh.position.copy(from);
    this.scene.add(mesh);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.3, 0.2), transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(GRENADE.radius - 0.12, GRENADE.radius, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    this.scene.add(ring);
    const g: Grenade = { pos: from.clone(), vel, fuse, mesh, ring, owner };
    this.list.push(g);
    this.thrown++;
    return g;
  }

  update(dt: number, obstacles: readonly Obstacle[]): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.fuse -= dt;
      if (g.fuse <= 0) {
        const at = g.pos.clone();
        this.remove(i);
        this.exploded++;
        this.onExplode(at, g);
        continue;
      }
      g.vel.y -= G * dt;
      // по горизонтали — отскок от стен и укрытий выше гранаты
      const h = new THREE.Vector3(g.vel.x, 0, g.vel.z);
      const step = h.length() * dt;
      if (step > 1e-5) {
        const dir = h.clone().normalize();
        const hit = raycastObstacles(g.pos.x, g.pos.z, dir.x, dir.z, step + 0.08, g.pos.y, obstacles);
        if (hit) {
          g.pos.x += dir.x * Math.max(0, hit.t - 0.08);
          g.pos.z += dir.z * Math.max(0, hit.t - 0.08);
          const dot = g.vel.x * hit.nx + g.vel.z * hit.nz;
          g.vel.x = (g.vel.x - 2 * dot * hit.nx) * 0.45;
          g.vel.z = (g.vel.z - 2 * dot * hit.nz) * 0.45;
          this.fx.burst(g.pos.clone(), ['#6a604f'], 2, { speed: 1, up: 1, size: 0.04, life: 0.3 });
        } else {
          g.pos.x += g.vel.x * dt;
          g.pos.z += g.vel.z * dt;
        }
      }
      const prevY = g.pos.y;
      g.pos.y += g.vel.y * dt;
      // крыша укрытия: падая сверху, граната ложится на него
      let floor = 0.08;
      for (const o of obstacles) if (prevY >= o.h && distToObstacle(g.pos.x, g.pos.z, o) === 0) floor = Math.max(floor, o.h + 0.08);
      // пол: отскок и качение
      if (g.pos.y < floor) {
        g.pos.y = floor;
        if (Math.abs(g.vel.y) > 1.2) { g.vel.y = -g.vel.y * 0.35; g.vel.x *= 0.6; g.vel.z *= 0.6; }
        else { g.vel.y = 0; const k = Math.exp(-4 * dt); g.vel.x *= k; g.vel.z *= k; }
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.vel.length() * dt * 2;
      g.mesh.rotation.z += g.vel.length() * dt * 1.3;
      // кольцо опасности: ярче и чаще мигает к концу фитиля
      g.ring.position.set(g.pos.x, 0.04, g.pos.z);
      const urgency = 1 - Math.min(1, g.fuse / 2.5);
      const blink = 0.5 + 0.5 * Math.sin((3.2 - g.fuse) * (6 + urgency * 18));
      (g.ring.material as THREE.MeshBasicMaterial).opacity = g.vel.lengthSq() < 4 ? 0.25 + 0.5 * blink * (0.4 + urgency * 0.6) : 0.1;
    }
  }

  private remove(i: number): void {
    const g = this.list[i];
    this.scene.remove(g.mesh, g.ring);
    g.ring.geometry.dispose();
    (g.ring.material as THREE.Material).dispose();
    this.list.splice(i, 1);
  }

  clear(): void { for (let i = this.list.length - 1; i >= 0; i--) this.remove(i); }
}
