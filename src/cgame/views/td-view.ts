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
 * Вид обороны куста — «cgame» (wiki/design-multiplayer.md): рисует то, что пришло в снимке (src/net/snapshot.ts),
 * и играет события (src/cgame/effects.ts). Своего состояния игры не держит: записи дают башни, снаряды, лужи, кучки,
 * стены, куст и логова по приставке id (src/sim/entities.ts); площадки, стены, дороги и куст стоят там, где говорит `spec`.
 * Меню, HUD и подсказки — не здесь (src/cgame/td-ui.ts)
 */
export interface TdViewOpts { scene: THREE.Scene; fx: FX; quiet: () => boolean; spec: TdSpec; heroPos: () => THREE.Vector3; seat: () => number }

interface View { set(ent: EntityState): void; update(dt: number): void; dispose(): void; onEvent?(e: SimEvent): void }

export class TdView {
  /** Подсветка площадок: под курсором и с открытым меню (номера площадок или null) */
  hoverPad: number | null = null;
  menuPad: number | null = null;
  /** Для тестов: вью башен по номеру площадки */
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
    this.bushPos = new THREE.Vector3(o.spec.bush.x, 0, o.spec.bush.z);
  }

  /** Записи и события последнего применённого снимка → создать/обновить/убрать вью, сыграть события */
  apply(v: SnapshotView<SimEvent>): void {
    for (const e of v.removed) this.drop(e.id);
    for (const e of v.added) this.ensure(e);
    for (const e of v.updated) this.ensure(e);
    for (const e of v.events) if (e.id) this.views.get(e.id)?.onEvent?.(e);
    playTdEvents(v.events, { fx: this.fx, quiet: this.quiet, heroPos: this.heroPos, bushPos: this.bushPos, seat: this.seat });
  }

  /** Анимация за кадр/тик: качание, искры, полёт снарядов по k, лужи */
  update(dt: number): void {
    this.time += dt;
    for (const p of this.pads) { p.hover = p.index === this.hoverPad || p.index === this.menuPad; p.occupied = this.towers.has(p.index); p.update(dt, this.time); }
    for (const w of this.views.values()) w.update(dt);
  }

  dispose(): void {
    for (const id of [...this.views.keys()]) this.drop(id);
    for (const p of this.pads) p.dispose();
  }

  /** Площадка под лучом камеры (ближайшая) — номер или null */
  padAt(ray: THREE.Ray): number | null {
    let best: PadView | null = null, bd = Infinity;
    for (const p of this.pads) {
      if (!p.hitBy(ray)) continue;
      const d = ray.origin.distanceToSquared(p.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? best.index : null;
  }

  /** Вью записи: есть — обновить, нет — создать по приставке id */
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
