import * as THREE from 'three';
import type { FX } from '../../fx.ts';
import type { EntityState, SnapshotView } from '../../net/snapshot.ts';
import type { SimEvent } from '../../sim/events.ts';
import type { TdSpec } from '../../td/types.ts';
import { playTdEvents } from '../effects.ts';
import { BoltView } from './bolt-view.ts';
import { BushView } from './bush-view.ts';
import { LairView } from './lair-view.ts';
import { PadView } from './pad-view.ts';
import { PileView } from './pile-view.ts';
import { PoolView } from './pool-view.ts';
import { TowerView } from './tower-view.ts';
import { WallView } from './wall-view.ts';

/**
 * Bush Defence view — "cgame" (wiki/design-multiplayer.md): draws what came in the snapshot (src/net/snapshot.ts)
 * and plays events (src/cgame/effects.ts). Keeps no game state of its own: records give towers, projectiles, pools, piles,
 * walls, the bush and lairs by id prefix (src/sim/entities.ts); pads, walls, lanes and the bush stand where `spec` says.
 * Menu, HUD and hints are not here (src/cgame/td-ui.ts)
 */
export interface TdViewOpts { scene: THREE.Scene; fx: FX; quiet: () => boolean; spec: TdSpec; heroPos: () => THREE.Vector3; seat: () => number }

interface View { set(ent: EntityState): void; update(dt: number): void; dispose(): void; onEvent?(e: SimEvent): void }

export class TdView {
  /** Pad highlights: under the cursor and with the menu open (pad numbers or null) */
  hoverPad: number | null = null;
  menuPad: number | null = null;
  /** For tests: tower views by pad number */
  readonly towers = new Map<number, TowerView>();
  readonly pads: PadView[];
  private readonly views = new Map<string, View>();
  private readonly bushPos: THREE.Vector3;
  private time = 0;
  private readonly scene: THREE.Scene;
  private readonly fx: FX;
  private readonly quiet: () => boolean;
  private readonly spec: TdSpec;
  private readonly heroPos: () => THREE.Vector3;
  private readonly seat: () => number;

  constructor(o: TdViewOpts) {
    this.scene = o.scene; this.fx = o.fx; this.quiet = o.quiet; this.spec = o.spec; this.heroPos = o.heroPos; this.seat = o.seat;
    this.pads = o.spec.pads.map((p, i) => new PadView(o.scene, p, i));
    this.bushPos = new THREE.Vector3(o.spec.bush.x, o.spec.bush.y ?? 0, o.spec.bush.z);
  }

  /** Records and events of the last applied snapshot → create/update/remove views, play events */
  apply(v: SnapshotView<SimEvent>): void {
    for (const e of v.removed) this.drop(e.id);
    for (const e of v.added) this.ensure(e);
    for (const e of v.updated) this.ensure(e);
    for (const e of v.events) if (e.id) this.views.get(e.id)?.onEvent?.(e);
    playTdEvents(v.events, { fx: this.fx, quiet: this.quiet, heroPos: this.heroPos, bushPos: this.bushPos, seat: this.seat });
  }

  /** Per-frame/tick animation: swaying, sparks, projectile flight by k, pools */
  update(dt: number): void {
    this.time += dt;
    for (const p of this.pads) { p.hover = p.index === this.hoverPad || p.index === this.menuPad; p.occupied = this.towers.has(p.index); p.update(dt, this.time); }
    for (const w of this.views.values()) w.update(dt);
  }

  dispose(): void {
    for (const id of [...this.views.keys()]) this.drop(id);
    for (const p of this.pads) p.dispose();
  }

  /** Pad under the camera ray (the nearest) — number or null */
  padAt(ray: THREE.Ray): number | null {
    let best: PadView | null = null, bd = Infinity;
    for (const p of this.pads) {
      if (!p.hitBy(ray)) continue;
      const d = ray.origin.distanceToSquared(p.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? best.index : null;
  }

  /** View of a record: exists — update, otherwise create by id prefix */
  private ensure(e: EntityState): void {
    const w = this.views.get(e.id);
    if (w) { w.set(e); return; }
    const made = this.make(e);
    if (made) this.views.set(e.id, made);
  }

  private make(e: EntityState): View | null {
    const id = e.id;
    if (id === 'bush') return new BushView(this.scene, this.fx, this.spec.bush, e);
    if (id.startsWith('lair:')) {
      const lane = this.spec.lanes.find((l) => l.id === id.slice(5));
      return lane && lane.points.length ? new LairView(this.scene, this.fx, lane, e) : null;
    }
    if (id.startsWith('w:')) {
      const ws = this.spec.walls?.find((wl) => wl.id === id.slice(2));
      return ws ? new WallView(this.scene, this.fx, ws, e) : null;
    }
    if (id.startsWith('pool')) return new PoolView(this.scene, this.fx, e);
    if (/^t\d+$/.test(id)) {
      const t = new TowerView(this.scene, this.fx, e);
      this.towers.set(Number(id.slice(1)), t);
      return t;
    }
    if (/^b\d+$/.test(id)) return new BoltView(this.scene, this.fx, e);
    if (/^p\d+$/.test(id)) return new PileView(this.scene, this.fx, e);
    return null;
  }

  private drop(id: string): void {
    const w = this.views.get(id);
    if (!w) return;
    w.dispose();
    this.views.delete(id);
    if (/^t\d+$/.test(id)) this.towers.delete(Number(id.slice(1)));
  }
}
