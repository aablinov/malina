import * as THREE from 'three';
import type { ExpeditionSpec } from '../../expedition/types.ts';
import type { FX } from '../../fx.ts';
import type { EntityState, SnapshotView } from '../../net/snapshot.ts';
import type { SimEvent } from '../../sim/events.ts';
import { PAD_R } from '../../sim/objective.ts';
import { playTdEvents } from '../effects.ts';
import { BushView } from './bush-view.ts';
import { DropView } from './drop-view.ts';
import { PileView } from './pile-view.ts';

/**
 * Expedition view — "cgame" (wiki/design-expeditions.md): draws the mission's things from the snapshot records by id prefix —
 * lairs, beacons, the planted bush, the extraction pad with its balloon, points of interest, seeds, secondary objectives —
 * and plays their events. Keeps no game state: everything comes from the records of src/sim/expedition.ts
 */
export interface ExpeditionViewOpts { scene: THREE.Scene; fx: FX; quiet: () => boolean; spec: ExpeditionSpec; heroPos: () => THREE.Vector3; seat: () => number }

interface View { set(ent: EntityState): void; update(dt: number, time: number): void; dispose(): void }

const SEED_COLOR: Record<string, string> = { common: '#8fd45a', rare: '#5ab8ff', golden: '#ffcc3a' };
const glow = (c: string, k = 2.2): THREE.Color => new THREE.Color(c).multiplyScalar(k);
const lambert = (c: string): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: c });
const basic = (c: THREE.Color, opacity = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: c, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  return b;
};
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

abstract class GroupView implements View {
  readonly g = new THREE.Group();
  protected readonly scene: THREE.Scene;
  constructor(scene: THREE.Scene) { this.scene = scene; scene.add(this.g); }
  abstract set(ent: EntityState): void;
  update(_dt: number, _time: number): void {}
  dispose(): void {
    this.scene.remove(this.g);
    this.g.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
  }
}

/** Lair: a thorny mound; the lower its health, the more it sinks; burnt — charred stumps */
class NestView extends GroupView {
  private readonly mound = new THREE.Group();
  private readonly rubble = new THREE.Group();
  private k = 1;
  private shake = 0;
  constructor(scene: THREE.Scene, e: EntityState) {
    super(scene);
    const s = 0.8 + num(e.size) * 0.35, dark = lambert('#4a2f3a'), thorn = lambert('#7a2f4a'), mouth = basic(glow('#ff5a8a', 1.6));
    this.mound.add(box(2.2 * s, 1.0 * s, 2.2 * s, dark, 0, 0.5 * s), box(1.5 * s, 0.8 * s, 1.5 * s, dark, 0, 1.3 * s), box(0.8 * s, 0.5 * s, 0.8 * s, thorn, 0, 1.9 * s), box(0.7 * s, 0.6 * s, 0.2, mouth, 0, 0.5 * s, 1.12 * s));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, t = box(0.18, 0.9 * s, 0.18, thorn, Math.cos(a) * 1.2 * s, 0.9 * s, Math.sin(a) * 1.2 * s); t.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); this.mound.add(t); }
    const ash = lambert('#2a2226');
    for (let i = 0; i < 5; i++) { const a = i * 1.3; this.rubble.add(box(0.5, 0.25 + (i % 2) * 0.2, 0.5, ash, Math.cos(a) * 0.8 * s, 0.15, Math.sin(a) * 0.8 * s)); }
    this.g.add(this.mound, this.rubble);
    this.set(e);
  }
  set(e: EntityState): void {
    this.g.position.set(num(e.x), num(e.y), num(e.z));
    const k = num(e.maxHp) ? num(e.hp) / num(e.maxHp) : 0;
    if (k < this.k) this.shake = 0.25;
    this.k = k;
    this.mound.visible = !e.dead;
    this.rubble.visible = !!e.dead;
  }
  update(dt: number, time: number): void {
    this.shake = Math.max(0, this.shake - dt);
    this.mound.scale.y = 0.7 + 0.3 * this.k;
    this.mound.position.x = this.shake > 0 ? Math.sin(time * 70) * 0.06 : 0;
  }
}

/** Beacon: a stone post with a brazier; lighting — the flame grows with the charge, lit — a tall steady fire */
class BeaconView extends GroupView {
  private readonly flame: THREE.Mesh;
  private readonly light = new THREE.PointLight('#ffb040', 0, 14);
  private k = 0;
  private lit = false;
  constructor(scene: THREE.Scene, e: EntityState) {
    super(scene);
    const stone = lambert('#8d8a80');
    this.flame = box(0.5, 0.9, 0.5, basic(glow('#ffb040', 2.6)), 0, 2.5);
    this.flame.castShadow = false;
    this.light.position.set(0, 2.6, 0);
    this.g.add(box(0.9, 0.4, 0.9, stone, 0, 0.2), box(0.45, 1.6, 0.45, stone, 0, 1.0), box(0.9, 0.3, 0.9, lambert('#4b4640'), 0, 1.95), this.flame, this.light);
    this.set(e);
  }
  set(e: EntityState): void {
    this.g.position.set(num(e.x), num(e.y), num(e.z));
    this.lit = e.state === 'lit';
    this.k = this.lit ? 1 : e.state === 'lighting' ? 0.15 + 0.6 * num(e.k) : 0;
  }
  update(_dt: number, time: number): void {
    const f = this.k * (1 + Math.sin(time * 11) * 0.12);
    this.flame.visible = this.k > 0;
    this.flame.scale.set(0.6 + f * 0.8, 0.4 + f * (this.lit ? 2.2 : 1.2), 0.6 + f * 0.8);
    this.flame.position.y = 2.1 + this.flame.scale.y * 0.45;
    this.light.intensity = f * (this.lit ? 30 : 12);
  }
}

/** Extraction pad: a ring on the ground; called — it pulses; ready — the balloon stands on it; gone — it rises away */
class ExtractView extends GroupView {
  private readonly ring: THREE.Mesh;
  private readonly balloon = new THREE.Group();
  private state = 'idle';
  private rise = 0;
  constructor(scene: THREE.Scene, e: EntityState) {
    super(scene);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(PAD_R - 0.25, PAD_R, 48), basic(glow('#7ad0ff', 1.6), 0.8));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    const red = lambert('#d8345a'), cream = lambert('#f4e6c8'), wood = lambert('#8a5a32');
    this.balloon.add(box(3.2, 2.6, 3.2, red, 0, 5.2), box(2.4, 0.8, 2.4, cream, 0, 6.9), box(2.4, 0.7, 2.4, cream, 0, 3.6), box(1.5, 0.9, 1.5, wood, 0, 0.55));
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) this.balloon.add(box(0.06, 2.6, 0.06, wood, x * 0.7, 2.2, z * 0.7));
    this.g.add(this.ring, this.balloon);
    this.set(e);
  }
  set(e: EntityState): void {
    this.g.position.set(num(e.x), num(e.y), num(e.z));
    if (e.state === 'ready' && this.state !== 'ready') this.rise = 30;
    this.state = String(e.state);
  }
  update(dt: number, time: number): void {
    (this.ring.material as THREE.MeshBasicMaterial).opacity = this.state === 'idle' ? 0.35 : 0.55 + Math.sin(time * 5) * 0.3;
    this.balloon.visible = this.state === 'ready' || this.state === 'gone';
    // lands in a second and a half, leaves slowly
    this.rise = this.state === 'gone' ? this.rise + dt * 5 : Math.max(0, this.rise - dt * 20);
    this.balloon.position.y = this.rise + Math.sin(time * 1.4) * 0.12;
  }
}

/** Point of interest: a basket; with a seed in it — a glowing gem of the rarity's colour on top */
class PoiView extends GroupView {
  private readonly gem: THREE.Mesh | null = null;
  constructor(scene: THREE.Scene, e: EntityState, y: number) {
    super(scene);
    this.g.add(box(0.8, 0.5, 0.8, lambert('#b98a4a'), 0, 0.25), box(0.9, 0.12, 0.9, lambert('#8a5a32'), 0, 0.55), box(0.5, 0.25, 0.5, lambert('#d8345a'), 0, 0.68));
    const seed = String(e.seed ?? '');
    if (seed) { this.gem = box(0.28, 0.28, 0.28, basic(glow(SEED_COLOR[seed] ?? '#ffffff')), 0, 1.3); this.gem.castShadow = false; this.g.add(this.gem); }
    this.g.position.set(num(e.x), y, num(e.z));
  }
  set(): void {}
  update(_dt: number, time: number): void { if (this.gem) { this.gem.rotation.y = time * 2; this.gem.position.y = 1.3 + Math.sin(time * 3) * 0.12; } }
}

/** A seed on the ground (its carrier fell) */
class SeedView extends GroupView {
  constructor(scene: THREE.Scene, e: EntityState) {
    super(scene);
    const m = box(0.3, 0.3, 0.3, basic(glow(SEED_COLOR[String(e.seed)] ?? '#ffffff')), 0, 0.5);
    m.castShadow = false;
    this.g.add(m);
    this.g.position.set(num(e.x), num(e.y), num(e.z));
  }
  set(): void {}
  update(_dt: number, time: number): void { this.g.children[0].rotation.y = time * 2.5; this.g.children[0].position.y = 0.5 + Math.sin(time * 4) * 0.1; }
}

/** Secondary objective: an Order chest, an altar, a watchtower; done — dimmed (a horn-blowers' nest is a NestView) */
class SideView extends GroupView {
  private readonly mark: THREE.Mesh;
  constructor(scene: THREE.Scene, e: EntityState, y: number) {
    super(scene);
    const kind = String(e.kind);
    if (kind === 'chest') this.g.add(box(1.1, 0.7, 0.8, lambert('#7a4a2a'), 0, 0.35), box(1.16, 0.2, 0.86, lambert('#d8b040'), 0, 0.8));
    else if (kind === 'altar') this.g.add(box(1.4, 0.4, 1.4, lambert('#b9b4a8'), 0, 0.2), box(0.9, 0.7, 0.9, lambert('#d6d1c4'), 0, 0.75));
    else if (kind === 'watchtower') { this.g.add(box(1.4, 0.3, 1.4, lambert('#8a5a32'), 0, 3.2), box(1.6, 0.6, 1.6, lambert('#a06a3a'), 0, 3.65)); for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) this.g.add(box(0.18, 3.1, 0.18, lambert('#6a4426'), x * 0.6, 1.55, z * 0.6)); }
    this.mark = box(0.22, 0.22, 0.22, basic(glow('#ffe27a')), 0, kind === 'watchtower' ? 4.6 : 1.7);
    this.mark.castShadow = false;
    this.g.add(this.mark);
    this.g.position.set(num(e.x), y, num(e.z));
    this.set(e);
  }
  set(e: EntityState): void { this.mark.visible = !e.done; }
  update(_dt: number, time: number): void { this.mark.rotation.y = time * 2; }
}

export class ExpeditionView {
  private readonly views = new Map<string, View>();
  private time = 0;
  private readonly o: ExpeditionViewOpts;
  private readonly bushPos = new THREE.Vector3();
  /** Floor under a point — the level's terrain (records of flat things carry no height) */
  floorAt: (x: number, z: number) => number = () => 0;

  constructor(o: ExpeditionViewOpts) {
    this.o = o;
    const plot = o.spec.objective.kind === 'bush' ? o.spec.objective.sites[0] : o.spec.extraction;
    this.bushPos.set(plot.x, 0, plot.z);
  }

  apply(v: SnapshotView<SimEvent>): void {
    for (const e of v.removed) this.drop(e.id);
    for (const e of v.added) this.ensure(e);
    for (const e of v.updated) this.ensure(e);
    // piles, drops and the bush play the defence's effects; the mission's own — below
    playTdEvents(v.events, { fx: this.o.fx, quiet: this.o.quiet, heroPos: this.o.heroPos, bushPos: this.bushPos, seat: this.o.seat });
    this.play(v.events);
  }

  update(dt: number): void {
    this.time += dt;
    for (const w of this.views.values()) w.update(dt, this.time);
  }

  dispose(): void { for (const id of [...this.views.keys()]) this.drop(id); }

  private ensure(e: EntityState): void {
    const w = this.views.get(e.id);
    if (w) { w.set(e); return; }
    const made = this.make(e);
    if (made) this.views.set(e.id, made);
  }

  private make(e: EntityState): View | null {
    const id = e.id, { scene, fx } = this.o;
    if (id === 'bush') { const p = this.o.spec.objective.sites[0]; return wrap(new BushView(scene, fx, { x: p.x, z: p.z, y: this.floorAt(p.x, p.z), hp: num(e.maxHp) }, e)); }
    if (id === 'extract') return new ExtractView(scene, e);
    if (/^(lair|side)\d+$/.test(id)) return new NestView(scene, e);
    if (/^beacon\d+$/.test(id)) return new BeaconView(scene, e);
    if (/^poi\d+$/.test(id)) return new PoiView(scene, e, this.floorAt(num(e.x), num(e.z)));
    if (/^seed\d+$/.test(id)) return new SeedView(scene, e);
    if (id.startsWith('s:')) return e.kind === 'horns' ? null : new SideView(scene, e, this.floorAt(num(e.x), num(e.z)));
    if (/^p\d+$/.test(id)) return wrap(new PileView(scene, fx, e));
    if (/^d\d+$/.test(id)) return wrap(new DropView(scene, fx, e));
    return null;
  }

  private drop(id: string): void {
    const w = this.views.get(id);
    if (!w) return;
    w.dispose();
    this.views.delete(id);
  }

  private play(events: readonly SimEvent[]): void {
    const { fx } = this.o;
    const at = (e: SimEvent, dy = 0): THREE.Vector3 => new THREE.Vector3(num(e.x), num(e.y) + dy, num(e.z));
    for (const e of events) {
      switch (e.t) {
        case 'nest.hurt': fx.burst(at(e, 1), ['#7a2f4a', '#4a2f3a', glow('#ff5a8a', 1.4)], 6, { speed: 3, up: 2.5, size: 0.12, life: 0.5 }); break;
        case 'nest.die':
          fx.burst(at(e, 1), ['#4a2f3a', '#2a2226', glow('#ff9a3a')], 40, { speed: 6, up: 6, size: 0.18, life: 1, gravity: 10 });
          fx.shock(at(e, 0.06), 5, glow('#ff9a3a'), 0.6, 0.2);
          fx.pillar(at(e), glow('#ff9a3a', 2.6), 9, 0.6);
          fx.shake = Math.max(fx.shake, 0.5);
          break;
        case 'beacon.light': fx.burst(at(e, 2.4), [glow('#ffb040'), '#ffffff'], 12, { speed: 2, up: 3, size: 0.1, life: 0.6, glow: true, gravity: 3 }); break;
        case 'beacon.lit':
          fx.pillar(at(e), glow('#ffd070', 3), 14, 0.7);
          fx.ring(at(e, 0.06), 7, glow('#ffd070'), 0.8, 0.16, 2);
          fx.flash(at(e, 2.6), glow('#ffd070', 3), 3, 0.35);
          break;
        case 'bush.plant': fx.burst(at(e, 0.5), ['#6fd24a', '#d8345a', '#8a5a32'], 24, { speed: 3, up: 4, size: 0.12, life: 0.8, gravity: 8 }); fx.ring(at(e, 0.06), 4, glow('#6fd24a'), 0.6, 0.14, 1); break;
        case 'exp.raid': fx.shock(at(e, 0.06), 4, glow('#d8345a'), 0.7, 0.18); break;
        case 'poi.take': fx.burst(at(e, 0.6), ['#d8345a', '#ffcc3a'], 14, { speed: 3, up: 4, size: 0.1, life: 0.6 }); fx.text(at(e, 1.2), `+${num(e.n)}`, 'berry'); break;
        case 'seed.take': fx.burst(at(e, 0.6), [glow(SEED_COLOR[String(e.seed)] ?? '#ffffff')], 10, { speed: 2, up: 3, size: 0.09, life: 0.5, glow: true, gravity: 3 }); break;
        case 'exp.side': fx.pillar(at(e), glow('#ffe27a', 2.4), 7, 0.4); fx.ring(at(e, 0.06), 3, glow('#ffe27a'), 0.5, 0.12, 1); break;
        case 'horn.start': fx.text(at(e, 2.2), '♪', 'bad'); fx.ring(at(e, 0.06), 3, glow('#ffd15c'), 0.6, 0.12, 1); break;
        case 'horn.call': fx.shock(at(e, 0.06), 8, glow('#ffd15c'), 0.8, 0.2); fx.text(at(e, 2.4), '♪♪♪', 'bad'); break;
        case 'hero.totem': fx.pillar(at(e), glow('#ff5a8a', 2.6), 10, 0.6); fx.ring(at(e, 0.06), 3, glow('#ff5a8a'), 0.6, 0.14, 1); break;
        case 'hero.raised': fx.burst(at(e, 0.8), [glow('#8be38f'), '#ffffff'], 16, { speed: 2, up: 4, size: 0.1, life: 0.7, glow: true, gravity: 3 }); break;
        case 'extract.call': fx.ring(at(e, 0.06), PAD_R + 2, glow('#7ad0ff'), 1, 0.2, 2); break;
        case 'extract.ready': fx.pillar(at(e), glow('#7ad0ff', 2.6), 16, 0.8); break;
        default: break;
      }
    }
  }
}

/** The defence's views take no time argument */
function wrap(v: { set(e: EntityState): void; update(dt: number): void; dispose(): void }): View {
  return { set: (e) => v.set(e), update: (dt) => v.update(dt), dispose: () => v.dispose() };
}
