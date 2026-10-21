import * as THREE from 'three';

/** Двухзвенная IK: вернуть локоть (колено) для плеча s, цели t и подсказки направления pole */
export function solveIK(s: THREE.Vector3, t: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, outElbow: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(t, s);
  let d = dir.length();
  if (d < 1e-5) { dir.set(0, -1, 0); d = 1e-5; } else dir.divideScalar(d);
  d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(dir, -dir.z);
  p.normalize();
  outElbow.copy(s).addScaledVector(dir, cosA * a).addScaledVector(p, sinA * a);
}

const DOWN = new THREE.Vector3(0, -1, 0);
/** Повернуть сегмент (ось −Y) из точки from в точку to */
export function aimSegment(o: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  o.position.copy(from);
  const d = new THREE.Vector3().subVectors(to, from);
  if (d.lengthSq() < 1e-10) return;
  o.quaternion.setFromUnitVectors(DOWN, d.normalize());
}

