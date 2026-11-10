import * as THREE from 'three';
import { obstaclesOf, terrainOf, type Terrain } from '../../src/level/collide.ts';
import { Gear } from '../../src/gear.ts';
import { nullFx } from '../../src/headless.ts';
import { Profile } from '../../src/items.ts';
import { emptyInput, Knight, type KnightInput } from '../../src/knight.ts';
import { Pack } from '../../src/mobs/pack.ts';
import type { Obstacle } from '../../src/collision.ts';
import { SimWorld, type SimHooks } from '../../src/sim/world.ts';
import { makeTextures } from '../../src/textures.ts';
import type { Target } from '../../src/target.ts';
import { loadMap } from './sim-helpers.ts';

/**
 * Headless battle (wiki/design-multiplayer.md): the same hero, gear and pack classes as in the browser, in Node
 * with a scene without rendering and `nullFx`. This is how the server will run the battle and tests will drive real waves without a browser
 */
export interface HeadlessBattle {
  world: SimWorld;
  hero: Knight;
  gear: Gear;
  pack: Pack;
  input: KnightInput;
  terrain: Terrain;
  profile: Profile;
  /** Step of the whole battle: gear, hero, pack (inside the world), defence, piles, fx timers */
  step(dt?: number): void;
  /** Damage to heroes from mobs (for assertions) */
  heroHurt: number;
}

export function headlessBattle(mapId: string, seed: number, o: { players?: number; quietHero?: boolean } = {}): HeadlessBattle {
  const { level, td } = loadMap(mapId);
  const scene = new THREE.Scene();
  const fx = nullFx();
  const T = makeTextures();
  const terrain = terrainOf(level);
  const b = level.getBounds() ?? { minX: -64, maxX: 64, minZ: -64, maxZ: 64, minY: -1, maxY: 0 };
  const levelObstacles: Obstacle[] = obstaclesOf(level, 0, b.minX, b.minZ, b.maxX, b.maxZ);
  const hero = new Knight(scene, T);
  const spawn = level.spawn ?? [td.bush.x, 0, td.bush.z + 4];
  hero.place(spawn[0], spawn[2], Math.PI, spawn[1]);
  const input = emptyInput();
  const profile = new Profile(Profile.starter());
  let world: SimWorld | null = null;
  let pack: Pack | null = null;
  const out = { heroHurt: 0 } as HeadlessBattle;
  const foeObstacles = (): Obstacle[] => levelObstacles.concat(world?.foeSolids ?? []);
  const bossHooks = {
    scene, fx, hero, terrain,
    obstacles: () => foeObstacles(),
    hurtHero: (dmg: number, from: THREE.Vector3, knock: number) => {
      const hp0 = hero.hp;
      if (!hero.hurt(dmg)) return;
      out.heroHurt += hp0 - hero.hp;
      if (knock > 0) { const d = new THREE.Vector3(hero.pos.x - from.x, 0, hero.pos.z - from.z); if (d.lengthSq() < 1e-4) d.set(0, 0, 1); hero.vel.addScaledVector(d.normalize(), knock); }
    },
    quiet: () => true,
  };
  const targets = (): Target[] => [...(pack?.targets() ?? []), ...(world?.td?.targets() ?? [])];
  const gear = new Gear({
    scene, fx, hero, terrain, targets, blast: () => {}, sound: () => {}, toast: () => {}, banner: () => {}, quiet: () => true,
  }, profile);
  pack = new Pack(bossHooks, (at, n, base, kind) => { if (world?.td) world.td.killed(at, n, base, kind); else world?.piles.drop(at, n); });
  const pk = pack;
  const hooks: SimHooks = {
    foes: () => pk.mobs.filter((m) => m.alive),
    heroes: () => [{ pos: hero.pos, get down() { return hero.down; }, seat: 0 }],
    spawnMob: (kind, at) => pk.spawn(kind, at),
    setScale: (l, p) => pk.setScale(l, p),
    step: (dt) => {
      gear.update(dt, false, input.aim);
      hero.slow = Math.min(0.8, pk.heroSlow);
      hero.update(dt, input, (world?.solids ?? []), terrain);
      pk.update(dt);
      fx.update(dt, 0, 0);
    },
  };
  world = new SimWorld(hooks, { seed, level, mode: { kind: 'td', td }, players: o.players ?? 1, personal: false });
  world.td!.fund(0);
  hero.onStrike = (s) => {
    // sword strike on targets in the arc — as in the playground, without effects
    let n = 0;
    for (const t of targets()) {
      if (!t.alive) continue;
      const dx = t.pos.x - s.from.x, dz = t.pos.z - s.from.z, d = Math.hypot(dx, dz);
      if (d - t.radius > s.range) continue;
      const a = Math.atan2(Math.sin(Math.atan2(dx, dz) - s.yaw), Math.cos(Math.atan2(dx, dz) - s.yaw));
      if (Math.abs(a) > s.half + Math.atan(t.radius / Math.max(d, 0.3))) continue;
      const { dmg } = gear.meleeDamage(s.dmg);
      t.hit(dmg, new THREE.Vector3(dx, 0, dz).normalize(), t.pos.clone().setY(1), s.knock);
      gear.onHit(dmg, true, t.pos, t);
      n++;
    }
    return n;
  };
  Object.assign(out, { world, hero, gear, pack, input, terrain, profile, step: (dt = 1 / 60) => { world!.takeEvents(); world!.step(dt); } });
  return out;
}
