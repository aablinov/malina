import * as THREE from 'three';

/**
 * Glowing blade trail (light trail): a ribbon between the blade base and tip over the last fractions of a second.
 * Points are taken once per frame and smoothed with a Catmull–Rom spline, so a fast swing gives an even arc.
 * HDR colour (> 1) — bloom picks up the ribbon. Brightness falls with the point's age and towards the blade base; the fresh edge is
 * color, the tail blends into color2 (two tempers — two colours), at the very tip a white core (core).
 */

const MAX = 96;
const SUB = 4;

interface Sample { base: THREE.Vector3; tip: THREE.Vector3; t: number }

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function catmull(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, k: number, out: THREE.Vector3): THREE.Vector3 {
  const k2 = k * k, k3 = k2 * k;
  return out.set(0, 0, 0)
    .addScaledVector(p0, -0.5 * k3 + k2 - 0.5 * k)
    .addScaledVector(p1, 1.5 * k3 - 2.5 * k2 + 1)
    .addScaledVector(p2, -1.5 * k3 + 2 * k2 + 0.5 * k)
    .addScaledVector(p3, 0.5 * k3 - 0.5 * k2);
}

export class SwordTrail {
  /** How long a trail point lives, s */
  life = 0.16;
  readonly color = new THREE.Color(2.2, 2.6, 3.2);
  /** Trail tail colour: color blends into it as the point ages */
  readonly color2 = new THREE.Color(2.2, 2.6, 3.2);
  /** White core at the tip: 0 — none, 1 — the fresh edge is almost white */
  core = 0.35;
  /** Trail width: fraction of the blade from the tip (1 — the whole blade) */
  width = 0.85;
  private readonly samples: Sample[] = [];
  private readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo = new THREE.BufferGeometry();

  constructor(scene: THREE.Scene) {
    const n = MAX * SUB;
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  /** Add the blade position at time t (called while the swing is in progress) */
  push(base: THREE.Vector3, tip: THREE.Vector3, t: number): void {
    const b = _a.copy(tip).lerp(base, this.width);
    this.samples.push({ base: b.clone(), tip: tip.clone(), t });
    if (this.samples.length > MAX) this.samples.shift();
  }

  /** Break the trail: the next swing starts a new ribbon */
  cut(): void { this.samples.length = 0; }

  get visible(): boolean { return this.mesh.visible; }

  update(now: number): void {
    while (this.samples.length && now - this.samples[0].t > this.life) this.samples.shift();
    const S = this.samples;
    if (S.length < 2) { this.geo.setDrawRange(0, 0); this.mesh.visible = false; return; }
    this.mesh.visible = true;
    let v = 0;
    const put = (base: THREE.Vector3, tip: THREE.Vector3, t: number): void => {
      const age = Math.min(1, (now - t) / this.life), fade = 1 - age;
      const k = fade * fade;
      const a = this.color, b = this.color2, w = Math.min(1, age * 1.6);
      // the fresh edge is white hot, towards the tail — the second colour
      const hot = this.core * fade * fade * fade * 2.4;
      const r = (a.r + (b.r - a.r) * w) * k + hot, g = (a.g + (b.g - a.g) * w) * k + hot, bl = (a.b + (b.b - a.b) * w) * k + hot;
      this.pos.set([base.x, base.y, base.z, tip.x, tip.y, tip.z], v * 6);
      // the trail fades towards the base, brightest at the tip
      this.col.set([r * 0.08, g * 0.08, bl * 0.08, r, g, bl], v * 6);
      v++;
    };
    for (let i = 0; i < S.length - 1; i++) {
      const p0 = S[Math.max(0, i - 1)], p1 = S[i], p2 = S[i + 1], p3 = S[Math.min(S.length - 1, i + 2)];
      for (let s = 0; s < SUB; s++) {
        const k = s / SUB;
        put(catmull(p0.base, p1.base, p2.base, p3.base, k, _a), catmull(p0.tip, p1.tip, p2.tip, p3.tip, k, _b), p1.t + (p2.t - p1.t) * k);
      }
    }
    const last = S[S.length - 1];
    put(last.base, last.tip, last.t);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, (v - 1) * 6);
  }
}
