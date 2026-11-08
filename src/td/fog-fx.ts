import * as THREE from 'three';
import { glowTex } from '../loot-look.ts';
import type { SimFog } from '../sim/fog.ts';
import { LANTERN_FLAME } from '../sim/fog.ts';

/**
 * Misty Clearing (wiki/design-tower-defence.md, section 18) — the view of the mist: a ring of soft opaque planes from the
 * clearing's edge out to the forest (hides the Order until it steps onto the clearing), lanterns that push it back when lit,
 * the beacon's cold beam sweeping over the bush and cutting a lane through the mist, a violet glow around the bush, wisps
 * and a cloud that walks with every chief. Reads the simulation's lanterns and wisps (SimFog — the mirror in a network battle);
 * the wave modifier comes from `mod()`: thick mist creeps in, moonlight thins it, fireflies light up the enemies' spots.
 */

interface Puff { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; a: number; r: number; y: number; base: number; spin: number; phase: number; op: number }
interface Lamp { head: THREE.MeshStandardMaterial; glow: THREE.Sprite; pool: THREE.Mesh; k: number }

const LAMP_COLOR = new THREE.Color('#c58cff');
const BEAM_COLOR = new THREE.Color('#a8d4ff');
/** Mist cleared around a lit lantern, m */
const LAMP_CLEAR = 8.5;
/** Beam half-width, rad */
const BEAM_HALF = 0.17;

export class FogFx {
  readonly group = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly beam: THREE.Group;
  private readonly beamMats: THREE.MeshBasicMaterial[] = [];
  private readonly wispSprites = new Map<string, THREE.Sprite>();
  private readonly cloud: Puff[] = [];
  private time = 0;
  private creep = 0;
  private thin = 1;
  /** Beam angle now, rad (0 — along +X) */
  angle = 0;
  private readonly scene: THREE.Scene;
  private readonly fog: SimFog;
  private readonly mod: () => string | undefined;
  private readonly chiefs: () => readonly THREE.Vector3[];
  private readonly mistColor: THREE.Color;

  constructor(scene: THREE.Scene, fog: SimFog, bush: { x: number; z: number }, mod: () => string | undefined, chiefs: () => readonly THREE.Vector3[]) {
    this.scene = scene; this.fog = fog; this.mod = mod; this.chiefs = chiefs;
    const spec = fog.spec, tex = glowTex();
    this.mistColor = new THREE.Color(spec.color ?? '#b9b4d6');
    let seed = 7;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const puff = (a: number, r: number, y: number, size: number, base: number, list: Puff[]): void => {
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: this.mistColor, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      list.push({ mesh, mat, a, r, y, base, spin: (rnd() - 0.5) * 0.03, phase: rnd() * 6, op: 0 });
    };
    // the ring: thin at the clearing's edge, a wall by the forest; three heights so walkers sink into it
    const width = spec.outer + 6 - (spec.inner - 3);
    const n = Math.round(width * 9);
    for (let i = 0; i < n; i++) {
      const k = rnd(), r = spec.inner - 3 + k * width;
      const edge = Math.min(1, Math.max(0, (r - (spec.inner - 3)) / 7));
      puff(rnd() * Math.PI * 2, r, 0.3 + rnd() * 2.6, 6 + rnd() * 6 + k * 4, 0.28 + 0.5 * edge * edge, this.puffs);
    }
    // the chiefs' clouds: two pools of eight, placed around a chief every frame
    for (let i = 0; i < 16; i++) puff(rnd() * Math.PI * 2, 1.5 + rnd() * 2.5, 0.4 + rnd() * 2, 4 + rnd() * 3, 0.55, this.cloud);
    // lanterns: a dark post, a glass head, a glow and a pool of light on the ground
    const postGeo = new THREE.BoxGeometry(0.16, 2.1, 0.16), headGeo = new THREE.BoxGeometry(0.46, 0.56, 0.46), capGeo = new THREE.BoxGeometry(0.6, 0.12, 0.6);
    const postMat = new THREE.MeshStandardMaterial({ color: '#2a2230', roughness: 0.9 });
    for (const l of fog.lanterns) {
      const g = new THREE.Group();
      g.position.set(l.x, 0, l.z);
      const post = new THREE.Mesh(postGeo, postMat); post.position.y = 1.05; post.castShadow = true; g.add(post);
      const head = new THREE.MeshStandardMaterial({ color: '#3a2a4a', emissive: LAMP_COLOR, emissiveIntensity: 0, roughness: 0.4 });
      const hm = new THREE.Mesh(headGeo, head); hm.position.y = 2.35; g.add(hm);
      const cap = new THREE.Mesh(capGeo, postMat); cap.position.y = 2.7; g.add(cap);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: LAMP_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.y = 2.35; glow.scale.setScalar(3.2); g.add(glow);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(LAMP_CLEAR * 1.6, LAMP_CLEAR * 1.6), new THREE.MeshBasicMaterial({ map: tex, color: LAMP_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2; pool.position.y = 0.06; g.add(pool);
      this.group.add(g);
      this.lamps.push({ head, glow, pool, k: 0 });
    }
    // the bush glows violet — the only warm light on the clearing
    const bushPool = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: tex, color: '#b05cff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    bushPool.rotation.x = -Math.PI / 2; bushPool.position.set(bush.x, 0.05, bush.z);
    this.group.add(bushPool);
    // the beam: a wedge of light on the ground and a tall faint sheet along it
    this.beam = new THREE.Group();
    this.beam.position.set(bush.x, 0, bush.z);
    const len = spec.outer + 4;
    const wedge = new THREE.BufferGeometry();
    const w0 = 0.6, w1 = Math.tan(BEAM_HALF) * len;
    wedge.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -w0, len, 0, -w1, len, 0, w1, 0, 0, -w0, len, 0, w1, 0, 0, w0], 3));
    wedge.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    const ground = new THREE.MeshBasicMaterial({ color: BEAM_COLOR, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const gm = new THREE.Mesh(wedge, ground); gm.position.y = 0.08; this.beam.add(gm);
    const sheet = new THREE.MeshBasicMaterial({ map: tex, color: BEAM_COLOR, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(len, 4.5), sheet); sm.position.set(len / 2, 2.2, 0); this.beam.add(sm);
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: BEAM_COLOR, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    lamp.position.set(0, 3.4, 0); lamp.scale.setScalar(2.2);
    this.group.add(lamp);
    lamp.position.add(this.beam.position);
    this.beamMats.push(ground, sheet);
    this.group.add(this.beam);
    scene.add(this.group);
  }

  get count(): number { return this.puffs.length; }

  /** How much a point's mist is cleared, 0..1: lit lanterns and the beam */
  clear(x: number, z: number): number {
    let c = 0;
    for (let i = 0; i < this.lamps.length; i++) {
      const k = this.lamps[i].k;
      if (k <= 0) continue;
      const l = this.fog.lanterns[i], d = Math.hypot(x - l.x, z - l.z);
      if (d < LAMP_CLEAR) c = Math.max(c, k * Math.min(1, (LAMP_CLEAR - d) / 3));
    }
    const da = Math.abs(((Math.atan2(z - this.beam.position.z, x - this.beam.position.x) - this.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < BEAM_HALF * 1.3) c = Math.max(c, 0.75 * (1 - da / (BEAM_HALF * 1.3)));
    return c;
  }

  update(dt: number): void {
    this.time += dt;
    const spec = this.fog.spec, mod = this.mod();
    // the beacon turns at a steady pace
    this.angle = (this.time / spec.beam) * Math.PI * 2 % (Math.PI * 2);
    this.beam.rotation.y = -this.angle;
    const flick = 0.85 + 0.15 * Math.sin(this.time * 7.3) * Math.sin(this.time * 3.1);
    this.beamMats[0].opacity = (mod === 'moon' ? 0.1 : 0.16) * flick;
    this.beamMats[1].opacity = (mod === 'moon' ? 0.07 : 0.12) * flick;
    // modifiers: thick mist creeps 5 m onto the clearing, moonlight thins it
    this.creep += ((mod === 'thick' ? 5 : 0) - this.creep) * Math.min(1, dt * 0.6);
    this.thin += ((mod === 'moon' ? 0.55 : mod === 'thick' ? 1.25 : 1) - this.thin) * Math.min(1, dt * 0.6);
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.fog.lanterns[i], lamp = this.lamps[i];
      const want = l.lit ? 0.35 + 0.65 * (l.flame / LANTERN_FLAME) : 0;
      lamp.k += (want - lamp.k) * Math.min(1, dt * 3);
      const fl = 0.9 + 0.1 * Math.sin(this.time * 9 + i * 1.7);
      lamp.head.emissiveIntensity = 0.15 + lamp.k * 2.2 * fl;
      (lamp.glow.material as THREE.SpriteMaterial).opacity = lamp.k * 0.9 * fl;
      (lamp.pool.material as THREE.MeshBasicMaterial).opacity = lamp.k * 0.35 * fl;
    }
    const k = Math.min(1, dt * 2.5);
    for (const p of this.puffs) {
      p.a += p.spin * dt;
      const r = p.r - this.creep * Math.max(0, 1 - (p.r - spec.inner) / 20);
      const x = Math.cos(p.a) * r, z = Math.sin(p.a) * r;
      p.mesh.position.set(x, p.y, z);
      p.mesh.rotation.z = p.phase + this.time * 0.02;
      const want = Math.min(0.95, p.base * this.thin * (0.85 + 0.15 * Math.sin(this.time * 0.4 + p.phase)) * (1 - this.clear(x, z)));
      p.op += (want - p.op) * k;
      p.mat.opacity = p.op;
    }
    // chiefs walk in their own cloud (two at most)
    const chiefs = this.chiefs();
    for (let i = 0; i < this.cloud.length; i++) {
      const p = this.cloud[i], c = chiefs[i >> 3];
      p.a += 0.3 * dt;
      if (c) p.mesh.position.set(c.x + Math.cos(p.a) * p.r, p.y, c.z + Math.sin(p.a) * p.r);
      const want = c ? p.base * (0.8 + 0.2 * Math.sin(this.time + p.phase)) : 0;
      p.op += (want - p.op) * k;
      p.mat.opacity = p.op;
      p.mesh.visible = p.op > 0.01;
    }
    // wisps: cold blue lights that bob; the simulation decides who catches them
    const seen = new Set<string>();
    for (const w of this.fog.wisps) {
      seen.add(w.id);
      let s = this.wispSprites.get(w.id);
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#9fe8ff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
        s.scale.setScalar(1.4);
        this.group.add(s);
        this.wispSprites.set(w.id, s);
      }
      s.position.set(w.x, 1.2 + Math.sin(this.time * 3 + w.x) * 0.3, w.z);
      s.scale.setScalar(1.2 + 0.3 * Math.sin(this.time * 6));
    }
    for (const [id, s] of this.wispSprites) if (!seen.has(id)) { this.group.remove(s); s.material.dispose(); this.wispSprites.delete(id); }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; mat?.dispose(); });
  }
}
