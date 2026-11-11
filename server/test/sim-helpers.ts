import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { Level, type LevelJSON } from '../../src/level/level.ts';
import type { MatchMap } from '../../src/sim/rules.ts';
import type { TdSpec } from '../../src/td/types.ts';
import { SimWorld, type Foe, type HeroLike, type MarchingMob, type SimHooks } from '../../src/sim/world.ts';

export const MAPS = join(import.meta.dirname, '..', '..', 'assets', 'maps');

export function loadMap(id: string): MatchMap & { td: TdSpec } {
  const j = JSON.parse(readFileSync(join(MAPS, `${id}.json`), 'utf8')) as LevelJSON;
  const level = Level.fromJSON(j);
  const td = level.meta.td as TdSpec;
  return { level, td, mode: { kind: 'td', td } };
}

/** Stub enemy: walks the road to the bush, hits it at the end; dies from tower damage */
export class StubMob implements Foe, MarchingMob {
  readonly pos: THREE.Vector3;
  readonly radius = 0.4;
  readonly topY = 1.2;
  readonly title: string;
  hp: number;
  maxHp: number;
  dead = false;
  gone = false;
  march: THREE.Vector3[] | null = null;
  laneId: string | null = null;
  marchI = 0;
  aggro = 10;
  yaw = 0;
  readonly ghost = false;
  speed = 2.5;
  /** Hits the bush once a second for 5 */
  hitT = 0;
  chillK = 0; chillT = 0;
  stunT = 0;
  readonly kind: string;
  constructor(kind: string, at: THREE.Vector3, hp: number) { this.kind = kind; this.pos = at.clone(); this.hp = this.maxHp = hp; this.title = kind; }
  get alive(): boolean { return !this.dead; }
  get progress(): number { return this.march ? this.marchI / this.march.length : 0; }
  extendMarch(points: THREE.Vector3[]): void { this.march?.push(...points); }
  hit(dmg: number): void { if (this.dead) return; this.hp -= dmg; if (this.hp <= 0) { this.dead = true; } }
  chill(k: number, sec: number): void { this.chillK = k; this.chillT = sec; }
  stun(sec: number): void { this.stunT = Math.max(this.stunT, sec); }
  expose(): void { /* none */ }
  step(dt: number, hurtBush: (dmg: number, from: THREE.Vector3) => void): void {
    if (this.dead) return;
    this.chillT -= dt; this.stunT -= dt;
    if (this.stunT > 0 || !this.march) return;
    const to = this.march[this.marchI];
    if (!to) { this.hitT -= dt; if (this.hitT <= 0) { this.hitT = 1; hurtBush(5, this.pos); } return; }
    const d = new THREE.Vector3().subVectors(to, this.pos).setY(0), len = d.length();
    const v = this.speed * (this.chillT > 0 ? 1 - this.chillK : 1) * dt;
    if (len <= v) { this.pos.copy(to); this.marchI++; } else this.pos.addScaledVector(d.normalize(), v);
  }
}

/** Defence world with stub enemies and a hero by the bush */
export function tdWorld(id: string, seed: number, o: { players?: number; personal?: boolean; mobHp?: number } = {}) {
  const { level, td } = loadMap(id);
  const mobs: StubMob[] = [];
  const hero: HeroLike & { pos: THREE.Vector3; down: boolean } = { pos: new THREE.Vector3(td.bush.x, 0, td.bush.z + 3), down: false, seat: 0 };
  let scale = { level: 1, players: 1 };
  const hooks: SimHooks = {
    foes: () => mobs.filter((m) => !m.dead),
    heroes: () => [hero],
    spawnMob: (kind, at) => { const m = new StubMob(kind, at, Math.round((o.mobHp ?? 30) * (1 + 0.5 * (scale.level - 1)))); mobs.push(m); return m; },
    setScale: (l, p) => { scale = { level: l, players: p }; },
  };
  const world = new SimWorld(hooks, { seed, level, mode: { kind: 'td', td }, players: o.players ?? 1, personal: o.personal ?? false });
  const sim = world.td!;
  sim.fund(0);
  /** Step of the world and the stubs; the fallen drop raspberries, like the pack */
  /** Events of the last step (the world accumulates them until taken, like a snapshot) */
  let events: import('../../src/sim/events.ts').SimEvent[] = [];
  const step = (dt = 1 / 60): void => {
    events = world.takeEvents();
    world.step(dt);
    for (const m of mobs) {
      const was = m.dead;
      // at the end of the road hits the castle wall if it is intact on this road, else the bush; a breach extends the road inside
      m.step(dt, (dmg, from) => {
        const wl = m.laneId ? sim.lane(m.laneId)?.wall : undefined, wall = wl ? sim.wall(wl) : undefined;
        if (wall && !wall.dead && m.march && m.march.length <= (sim.lane(m.laneId!)?.points.length ?? 0)) wall.hurt(dmg * 10, from); else sim.bush.hurt(dmg, from);
      });
      if (!was && m.dead) sim.killed(m.pos, 3, 2);
    }
    for (let i = mobs.length - 1; i >= 0; i--) if (mobs[i].dead) mobs.splice(i, 1);
  };
  return { world, sim, mobs, hero, step, level, td, events: () => events };
}
