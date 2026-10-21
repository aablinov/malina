import * as THREE from 'three';
import type { Obstacle } from '../collision';

/**
 * Отладочные оверлеи: F2 — коллайдеры и хитбоксы, F3 — луч прицела и конус разброса.
 */

const lineMat = (color: string) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false });

export class Overlays {
  colliders = false;
  aim = false;
  private readonly obsLines: THREE.LineSegments;
  private readonly circles: THREE.LineLoop[] = [];
  private readonly circleMat = lineMat('#ffe14a');
  private readonly aimLine: THREE.Line;
  private readonly coneLine: THREE.LineSegments;

  constructor(private readonly scene: THREE.Scene, obstacles: readonly Obstacle[]) {
    // рёбра каждого препятствия на его «пулевой» высоте
    const pts: number[] = [];
    for (const o of obstacles) {
      const c = Math.cos(o.rot), s = Math.sin(o.rot);
      const corner = (lx: number, lz: number): [number, number] => [o.x + lx * c + lz * s, o.z - lx * s + lz * c];
      const cs = [corner(-o.hx, -o.hz), corner(o.hx, -o.hz), corner(o.hx, o.hz), corner(-o.hx, o.hz)];
      for (let i = 0; i < 4; i++) {
        const a = cs[i], b = cs[(i + 1) % 4];
        for (const y of [0.02, o.h]) pts.push(a[0], y, a[1], b[0], y, b[1]);
        pts.push(a[0], 0.02, a[1], a[0], o.h, a[1]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.obsLines = new THREE.LineSegments(g, lineMat('#3cf0ff'));
    this.obsLines.renderOrder = 10;
    this.obsLines.visible = false;
    scene.add(this.obsLines);

    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat('#ff4a4a'));
    this.coneLine = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 4 }, () => new THREE.Vector3())), lineMat('#ffa04a'));
    for (const l of [this.aimLine, this.coneLine]) { l.renderOrder = 10; l.visible = false; l.frustumCulled = false; scene.add(l); }
  }

  /** Круги тел: героя, манекенов, жуков */
  drawCircles(list: { x: number; z: number; r: number; y?: number }[]): void {
    while (this.circles.length < list.length) {
      const pts = Array.from({ length: 32 }, (_, i) => new THREE.Vector3(Math.cos((i / 32) * Math.PI * 2), 0, Math.sin((i / 32) * Math.PI * 2)));
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), this.circleMat);
      l.renderOrder = 10;
      this.scene.add(l);
      this.circles.push(l);
    }
    this.circles.forEach((l, i) => {
      const c = list[i];
      l.visible = this.colliders && !!c;
      if (!c) return;
      l.position.set(c.x, c.y ?? 0.05, c.z);
      l.scale.setScalar(c.r);
    });
  }

  /** Луч прицела и конус разброса от дула */
  drawAim(muzzle: THREE.Vector3, yaw: number, spread: number, len: number): void {
    this.aimLine.visible = this.coneLine.visible = this.aim;
    if (!this.aim) return;
    const dir = (a: number) => new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const end = muzzle.clone().addScaledVector(dir(yaw), len);
    (this.aimLine.geometry as THREE.BufferGeometry).setFromPoints([muzzle, end]);
    const l = muzzle.clone().addScaledVector(dir(yaw - spread), len);
    const r = muzzle.clone().addScaledVector(dir(yaw + spread), len);
    (this.coneLine.geometry as THREE.BufferGeometry).setFromPoints([muzzle, l, muzzle, r]);
  }

  private pathLines: THREE.LineSegments | null = null;
  /** Пути врагов по навигационной сетке */
  drawPaths(paths: THREE.Vector3[][]): void {
    const pts: THREE.Vector3[] = [];
    for (const p of paths) for (let i = 0; i + 1 < p.length; i++) pts.push(p[i].clone().setY(0.08), p[i + 1].clone().setY(0.08));
    if (!this.pathLines) {
      this.pathLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat('#ff5ad2'));
      this.pathLines.renderOrder = 10;
      this.pathLines.frustumCulled = false;
      this.scene.add(this.pathLines);
    }
    this.pathLines.geometry.dispose();
    this.pathLines.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.pathLines.visible = pts.length > 0;
  }

  update(): void { this.obsLines.visible = this.colliders; }
}
