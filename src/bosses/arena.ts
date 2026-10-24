import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import type { Knight } from '../knight';
import { bossSfx } from './boss-audio';
import type { BossBar } from './boss-bar';
import { glowMat, RASP, UNIT, type Boss } from './kit';

/**
 * Арена стража (wiki/design-bosses.md, раздел 1): невидимый квадрат у входа — герой вошёл, за спиной поднимаются решётки,
 * страж просыпается, сверху полоса. Герой пал — страж на месте и спит, решётки опущены, героя ставит у входа.
 * Страж побеждён — решётки уходят в пол.
 */

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface ArenaSpec {
  trigger: Rect;
  /** Ворота: центр, ширина (вдоль X, если rot = 0) */
  gates: { x: number; z: number; w: number; rot?: number }[];
  /** Куда ставить героя после гибели */
  exit: { x: number; z: number; yaw: number };
}
export type ArenaState = 'idle' | 'fight' | 'won';

const RISE = 0.55;

export class Arena {
  state: ArenaState = 'idle';
  /** Подъём решёток 0..1 */
  private gateK = 0;
  private gateWant = 0;
  private failed = false;
  private winT = 0;
  private readonly gateObjs: THREE.Group[] = [];
  private readonly closed: Obstacle[];
  /** Победа: где лопнуло сердце (плейграунд роняет гримуар) */
  onWin?: (at: THREE.Vector3) => void;
  onStart?: () => void;

  constructor(scene: THREE.Scene, private readonly fx: FX, readonly spec: ArenaSpec, readonly boss: Boss, private readonly bar: BossBar, private readonly quiet: () => boolean) {
    const iron = new THREE.MeshLambertMaterial({ color: '#2e2a30' });
    const rust = new THREE.MeshLambertMaterial({ color: '#5a3a2e' });
    const berry = glowMat(RASP);
    this.closed = spec.gates.map((g) => ({ x: g.x, z: g.z, hx: g.w / 2, hz: 0.3, rot: g.rot ?? 0, h: 3 }));
    for (const g of spec.gates) {
      // решётка: прутья с остриями, две перекладины, посередине знак Ордена — ромб-ягода
      const grp = new THREE.Group();
      grp.position.set(g.x, 0, g.z);
      grp.rotation.y = g.rot ?? 0;
      const n = Math.max(3, Math.round(g.w / 0.42));
      for (let i = 0; i < n; i++) {
        const x = -g.w / 2 + (i + 0.5) * (g.w / n);
        const bar = new THREE.Mesh(UNIT, iron); bar.scale.set(0.14, 2.8, 0.14); bar.position.set(x, 1.4, 0); bar.castShadow = true; grp.add(bar);
        const tip = new THREE.Mesh(UNIT, rust); tip.scale.set(0.2, 0.2, 0.2); tip.position.set(x, 2.9, 0); tip.rotation.set(Math.PI / 4, 0, Math.PI / 4); grp.add(tip);
      }
      for (const y of [0.6, 2.2]) { const r = new THREE.Mesh(UNIT, rust); r.scale.set(g.w, 0.16, 0.2); r.position.y = y; grp.add(r); }
      const emblem = new THREE.Mesh(UNIT, berry); emblem.scale.setScalar(0.42); emblem.position.set(0, 1.4, 0.05); emblem.rotation.z = Math.PI / 4; grp.add(emblem);
      grp.visible = false;
      scene.add(grp);
      this.gateObjs.push(grp);
    }
    boss.onDeath = (at) => this.win(at);
  }

  /** Препятствия ворот: пока подняты */
  get solids(): readonly Obstacle[] { return this.gateK > 0.5 ? this.closed : []; }

  inside(r: Rect, p: THREE.Vector3): boolean { return p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1; }

  /** Закрыть арену и разбудить стража (вошёл в квадрат или тест) */
  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'fight';
    this.gateWant = 1;
    if (!this.quiet()) bossSfx.gate(true);
    this.boss.wake();
    this.bar.show(this.boss);
    this.onStart?.();
  }

  private win(at: THREE.Vector3): void {
    this.state = 'won';
    this.winT = 2.2;
    this.onWin?.(at);
  }

  /** Сброс: страж спит на месте, решётки внизу (N на плейграунде) */
  reset(): void {
    this.state = 'idle';
    this.gateWant = 0;
    this.boss.reset();
    this.bar.hide();
  }

  update(dt: number, hero: Knight): void {
    if (this.state === 'idle' && !hero.down && !this.failed && this.inside(this.spec.trigger, hero.pos)) this.start();
    if (this.state === 'fight' && hero.down) {
      // герой пал: арена сбрасывается, когда он встанет — у входа
      this.failed = true;
      this.reset();
      if (!this.quiet()) bossSfx.gate(false);
    }
    if (this.failed && !hero.down) {
      this.failed = false;
      hero.place(this.spec.exit.x, this.spec.exit.z, this.spec.exit.yaw);
      this.fx.text(hero.pos.clone().setY(1.6), 'страж ждёт', 'bad');
    }
    if (this.state === 'won' && this.winT > 0) {
      this.winT -= dt;
      if (this.winT <= 0) { this.gateWant = 0; this.bar.hide(); if (!this.quiet()) bossSfx.gate(false); }
    }
    this.bar.update(dt);
    // решётки: быстро вверх с отскоком, медленно вниз
    const was = this.gateK;
    this.gateK = this.gateWant > this.gateK ? Math.min(1, this.gateK + dt / RISE) : Math.max(0, this.gateK - dt / (RISE * 2));
    if (was < 1 && this.gateK === 1) { this.fx.shake = Math.max(this.fx.shake, 0.4); for (const g of this.spec.gates) this.fx.burst(new THREE.Vector3(g.x, 0.1, g.z), ['#9a8f70', '#6b5a4a'], 14, { speed: 2.5, up: 1.5, size: 0.12, life: 0.6, gravity: 8 }); }
    const k = this.gateK, e = k < 1 && this.gateWant ? 1 - (1 - k) ** 3 : k * k;
    for (const g of this.gateObjs) { g.visible = k > 0; g.position.y = -3 + 3 * e; }
  }
}
