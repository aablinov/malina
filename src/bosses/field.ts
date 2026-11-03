import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { glowTex } from '../loot-look.ts';
import { C, glowMat, rand, UNIT, type BossHooks } from './kit.ts';

/**
 * Сила боя — на полу (wiki/design-bosses.md, раздел 2): метки атак (круг, полоса), снаряды по дуге, опасные зоны.
 * Общее для стражей и рядовых мобов (wiki/design-mobs.md): у каждого бойца своё поле, урон — через его hurtHero.
 */

// ---------- метки на полу ----------

interface Mark { mesh: THREE.Mesh; t: number; dur: number; done: () => void; pulse: boolean }
const RED = C(2.2, 0.35, 0.18);

/** Круг: наливается за dur, по краю — яркое кольцо; на исходе — done */
function circleMesh(r: number, color: THREE.Color): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), glowMat(color.clone().multiplyScalar(0.35), 0, true));
  m.rotation.x = -Math.PI / 2;
  const edge = new THREE.Mesh(new THREE.RingGeometry(r * 0.92, r, 48), glowMat(color, 0.9, true));
  edge.position.z = 0.004;
  m.add(edge);
  return m;
}

/** Полоса: от from на len вдоль dir, ширина w */
function lineMesh(len: number, w: number, color: THREE.Color): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, len);
  g.translate(0, len / 2, 0);
  const m = new THREE.Mesh(g, glowMat(color.clone().multiplyScalar(0.4), 0, true));
  m.rotation.x = -Math.PI / 2;
  const eg = new THREE.PlaneGeometry(w, len);
  eg.translate(0, len / 2, 0);
  const edge = new THREE.Mesh(eg, glowMat(color, 0.25, true));
  edge.scale.x = 0.25;
  edge.position.z = 0.004;
  m.add(edge);
  return m;
}

// ---------- снаряды по дуге и опасные зоны ----------

interface Lob { mesh: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number; trail: THREE.Color; land: (at: THREE.Vector3) => void }
interface Hazard { pos: THREE.Vector3; r: number; t: number; dps: number; color: THREE.Color; slow: number }
/** Прямой выстрел (болт, стрела): только вид — урон считает тот, кто стрелял, по метке-полосе */
interface Shot { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; len: number; t: number; dur: number }

export class Field {
  private readonly marks: Mark[] = [];
  private readonly lobs: Lob[] = [];
  private readonly hazards: Hazard[] = [];
  private readonly shots: Shot[] = [];
  private hazardTick = 0;
  /** Замедление героя от зон (0..1) */
  heroSlow = 0;

  private readonly h: BossHooks;
  constructor(h: BossHooks) { this.h = h;}

  /** Круг-метка: наливается dur секунд, потом done (там и бьют) */
  markCircle(at: THREE.Vector3, r: number, dur: number, done: () => void, color = RED): void {
    const m = circleMesh(r, color);
    m.position.set(at.x, 0.06, at.z);
    this.h.scene.add(m);
    this.marks.push({ mesh: m, t: 0, dur, done, pulse: true });
  }
  /** Полоса-метка от from вдоль dir */
  markLine(from: THREE.Vector3, dir: THREE.Vector3, len: number, w: number, dur: number, done: () => void, color = RED): void {
    const m = lineMesh(len, w, color);
    m.position.set(from.x, 0.06, from.z);
    // после поворота плоскости на пол локальная +Y смотрит в −Z; поворот по Z разворачивает полосу вдоль dir
    m.rotation.z = Math.atan2(-dir.x, -dir.z);
    this.h.scene.add(m);
    this.marks.push({ mesh: m, t: 0, dur, done, pulse: false });
  }
  /** Снаряд по дуге из from в to за dur с высотой h; land — на месте падения */
  lob(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, dur: number, h: number, trail: THREE.Color, land: (at: THREE.Vector3) => void): void {
    mesh.position.copy(from);
    this.h.scene.add(mesh);
    this.lobs.push({ mesh, from: from.clone(), to: to.clone().setY(0), t: 0, dur, h, trail, land });
  }
  /** Опасная зона: dps урона в секунду, slow — замедление героя внутри */
  hazard(pos: THREE.Vector3, r: number, t: number, dps: number, color: THREE.Color, slow = 0): void {
    this.hazards.push({ pos: pos.clone().setY(0), r, t, dps, color, slow });
    this.h.fx.decal(pos.clone().setY(0.03), glowTex(), color.clone().multiplyScalar(0.3), r * 2.4, t, true, 0.85);
  }
  /** Убрать всё с пола */
  clear(): void {
    for (const b of this.shots.splice(0)) this.disposeMesh(b.mesh);
    for (const m of this.marks.splice(0)) this.disposeMesh(m.mesh);
    for (const l of this.lobs.splice(0)) this.disposeMesh(l.mesh);
    this.hazards.length = 0;
    this.heroSlow = 0;
  }

  private disposeMesh(o: THREE.Object3D): void {
    this.h.scene.remove(o);
    o.traverse((x) => { if (x instanceof THREE.Mesh) { x.geometry !== UNIT && x.geometry.dispose(); (x.material as THREE.Material).dispose(); } });
  }

  /** Выстрел из from вдоль dir на len метров со скоростью speed, на высоте y */
  shot(from: THREE.Vector3, dir: THREE.Vector3, len: number, color: THREE.Color, speed = 60, y = 1.2): void {
    const mesh = new THREE.Mesh(UNIT, glowMat(color));
    mesh.scale.set(0.06, 0.06, 0.7);
    mesh.rotation.y = Math.atan2(dir.x, dir.z);
    mesh.position.copy(from).setY(y);
    this.h.scene.add(mesh);
    this.shots.push({ mesh, from: from.clone().setY(y), dir: dir.clone(), len, t: 0, dur: len / speed });
  }

  update(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const b = this.shots[i];
      b.t += dt;
      b.mesh.position.copy(b.from).addScaledVector(b.dir, Math.min(1, b.t / b.dur) * b.len);
      if (b.t >= b.dur) { this.shots.splice(i, 1); this.disposeMesh(b.mesh); }
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = 0.15 + k * 0.6 + (k > 0.7 ? Math.sin(m.t * 40) * 0.1 : 0);
      if (m.pulse) { const s = 0.3 + 0.7 * k; m.mesh.scale.setScalar(s); }
      if (m.t >= m.dur) { this.marks.splice(i, 1); this.disposeMesh(m.mesh); m.done(); }
    }
    for (let i = this.lobs.length - 1; i >= 0; i--) {
      const l = this.lobs[i];
      l.t += dt;
      const k = Math.min(1, l.t / l.dur);
      l.mesh.position.lerpVectors(l.from, l.to, k);
      l.mesh.position.y = THREE.MathUtils.lerp(l.from.y, 0.3, k) + Math.sin(Math.PI * k) * l.h;
      l.mesh.rotation.set(l.t * 6, l.t * 4, 0);
      if (rnd() < 0.7) this.h.fx.particle({ pos: l.mesh.position.clone(), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.2, 0.8), rand(-0.3, 0.3)), life: 0.4, size: rand(0.08, 0.16), color: l.trail, gravity: -0.5 });
      if (k >= 1) { this.lobs.splice(i, 1); this.disposeMesh(l.mesh); l.land(l.to.clone()); }
    }
    const hero = this.h.hero.pos;
    let dps = 0, slow = 0;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const z = this.hazards[i];
      z.t -= dt;
      if (z.t <= 0) { this.hazards.splice(i, 1); continue; }
      if (rnd() < 0.3 * Math.min(1, z.t)) this.h.fx.particle({ pos: z.pos.clone().add(new THREE.Vector3(rand(-z.r, z.r) * 0.6, 0.05, rand(-z.r, z.r) * 0.6)), vel: new THREE.Vector3(0, rand(0.8, 1.8), 0), life: rand(0.3, 0.6), size: rand(0.06, 0.12), color: z.color, gravity: -1 });
      if (Math.hypot(hero.x - z.pos.x, hero.z - z.pos.z) < z.r) { dps = Math.max(dps, z.dps); slow = Math.max(slow, z.slow); }
    }
    this.heroSlow = slow;
    this.hazardTick = dps > 0 ? this.hazardTick - dt : 0;
    if (dps > 0 && this.hazardTick <= 0) { this.hazardTick = 0.25; this.h.hurtHero(dps * 0.25, hero, 0); }
  }
}
