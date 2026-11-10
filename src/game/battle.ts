import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import { Gear } from '../gear.ts';
import { nullFx } from '../headless.ts';
import { BATTLE_ARROWS, Profile, xpToNext, type ProfileData } from '../items.ts';
import { emptyInput, Knight, type KnightInput, type Strike } from '../knight.ts';
import { obstaclesOf, terrainOf, type Terrain } from '../level/collide.ts';
import { Pathfinder } from '../level/pathfind.ts';
import { ROUTE_BUDGET, ROUTE_EXPAND } from '../mobs/mob.ts';
import type { Level } from '../level/level.ts';
import { Pack } from '../mobs/pack.ts';
import { rnd } from '../rng.ts';
import type { MatchMap } from '../sim/rules.ts';
import { SimWorld, type SimHooks } from '../sim/world.ts';
import type { Target } from '../target.ts';
import { SWORD } from '../tuning.ts';
import { makeTextures, type Textures } from '../textures.ts';

/**
 * Headless battle (wiki/design-multiplayer.md): the simulation world, party heroes with gear and the enemy pack —
 * the same classes as in the browser, but without rendering (`src/headless.ts`). The server runs the match on it (src/game/match.ts),
 * tests run real waves in Node. The hero of each seat is `Knight` + `Gear` from its profile (the defence kit)
 */
export interface BattleHero {
  seat: number;
  knight: Knight;
  gear: Gear;
  profile: Profile;
  input: KnightInput;
  bow: boolean;
  /** Roll latched until the step that reads it */
  rolled: boolean;
  lavaT: number;
  downT: number;
  /** Experience at the start — the battle reward is counted from it */
  xp0: number;
}

/** Exhausted — gets up after, s */
const REVIVE_S = 2;
const LAVA_S = 0.4;
const LAVA_DMG = 6;

let textures: Textures | null = null;
/** Total hero experience since level one — to count how much was gained in the battle */
export const xpTotal = (d: ProfileData): number => { let n = d.xp; for (let l = 1; l < d.level; l++) n += xpToNext(l); return n; };

export class HeadlessBattle {
  readonly world: SimWorld;
  readonly pack: Pack;
  readonly heroes = new Map<number, BattleHero>();
  readonly level: Level;
  readonly terrain: Terrain;
  readonly pathfinder: Pathfinder;
  readonly scene = new THREE.Scene();
  readonly fx = nullFx();
  private readonly levelObstacles: Obstacle[];
  private readonly lava: boolean;
  /** Default mob target when there are no heroes: far away and exhausted */
  private readonly nobody: Knight;

  constructor(map: MatchMap, seed: number, players: number, personal = true) {
    textures ??= makeTextures();
    this.level = map.level;
    this.terrain = terrainOf(map.level);
    this.pathfinder = new Pathfinder(map.level, this.terrain);
    const b = map.level.getBounds() ?? { minX: -64, maxX: 64, minZ: -64, maxZ: 64, minY: -1, maxY: 0 };
    this.levelObstacles = obstaclesOf(map.level, 0, b.minX, b.minZ, b.maxX, b.maxZ);
    this.lava = map.level.palette.includes('lava');
    this.nobody = new Knight(this.scene, textures);
    this.nobody.place(0, -1000, 0);
    this.nobody.hp = 0; this.nobody.down = true;
    const bossHooks = {
      scene: this.scene, fx: this.fx, hero: this.nobody, terrain: this.terrain,
      obstacles: () => this.foeObstacles(),
      hurtHero: () => {},
      quiet: () => true,
      heroes: () => [...this.heroes.values()].map((h) => h.knight),
      hurtKnight: (k: Knight, dmg: number, from: THREE.Vector3, knock: number) => this.hurt(k, dmg, from, knock),
      route: (from: THREE.Vector3, to: THREE.Vector3) => this.route(from, to),
    };
    this.pack = new Pack(bossHooks, (at, n, base, kind) => { if (this.world.rules) this.world.rules.killed(at, n, base, kind); else this.world.piles.drop(at, n); });
    const hooks: SimHooks = {
      foes: () => this.pack.mobs.filter((m) => m.alive),
      heroes: () => [...this.heroes.values()].map((h) => ({ pos: h.knight.pos, get down() { return h.knight.down; }, seat: h.seat })),
      spawnMob: (kind, at) => this.pack.spawn(kind, at),
      setScale: (l, p) => this.pack.setScale(l, p),
      levelChanged: () => { this.levelObstacles.length = 0; this.levelObstacles.push(...obstaclesOf(map.level, 0, b.minX, b.minZ, b.maxX, b.maxZ)); this.foeCache = null; },
      step: (dt) => this.stepActors(dt),
      raise: (seat, at) => {
        const h = this.heroes.get(seat);
        if (!h) return;
        if (at) h.knight.place(at.x, at.z, h.knight.yaw, at.y);
        h.knight.revive();
        h.downT = 0;
      },
    };
    this.world = new SimWorld(hooks, { seed, level: map.level, mode: map.mode, players, personal });
  }

  /** Detour paths per tick — no more than ROUTE_BUDGET (like the botlib routing limit): the other mobs get theirs next tick */
  private routeTick = -1;
  private routeN = 0;
  private route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const tick = this.world.tick;
    if (tick !== this.routeTick) { this.routeTick = tick; this.routeN = 0; }
    if (++this.routeN > ROUTE_BUDGET) return null;
    return this.pathfinder.find(from, to, { solids: this.world.foeSolids, maxExpand: ROUTE_EXPAND });
  }

  private foeCache: Obstacle[] | null = null;
  private foeKey: Obstacle[] | null = null;
  private foeObstacles(): Obstacle[] {
    const towers = this.world.foeSolids;
    if (!this.foeCache || this.foeKey !== towers) { this.foeCache = this.levelObstacles.concat(towers); this.foeKey = towers; }
    return this.foeCache;
  }

  /** Hero of seat `seat` from the profile (a copy: own gear goes into battle, as in the browser). Appears at the map's point */
  addHero(seat: number, data: ProfileData): BattleHero {
    const knight = new Knight(this.scene, textures!);
    knight.tune = structuredClone(SWORD);
    const sp = this.level.spawn ?? this.world.rules?.muster ?? [0, 0, 0];
    const a = (seat / 4) * Math.PI * 2;
    knight.place(sp[0] + Math.cos(a) * 1.2, sp[2] + Math.sin(a) * 1.2, Math.PI, sp[1]);
    const profile = new Profile(structuredClone(data));
    profile.data.arrows = Math.max(profile.data.arrows, BATTLE_ARROWS);
    const gear = new Gear({
      scene: this.scene, fx: this.fx, hero: knight, terrain: this.terrain, targets: () => this.targets(), blast: () => {},
      sound: () => {}, toast: () => {}, banner: () => {}, quiet: () => true,
    }, profile);
    const h: BattleHero = { seat, knight, gear, profile, input: emptyInput(), bow: false, rolled: false, lavaT: 0, downT: 0, xp0: xpTotal(profile.data) };
    knight.onStrike = (s) => this.strike(s, h);
    this.heroes.set(seat, h);
    this.world.rules?.fund(seat);
    return h;
  }

  removeHero(seat: number): void {
    const h = this.heroes.get(seat);
    if (!h) return;
    this.scene.remove(h.knight.object);
    this.heroes.delete(seat);
  }

  /** Targets of sword, arrows and spells: enemies and ice on towers */
  targets(): Target[] { return [...this.pack.targets(), ...(this.world.rules?.targets() ?? [])]; }

  /** Mob hit on a hero: damage and knockback (like the playground's hurtHero, without sparks and sound) */
  private hurt(k: Knight, dmg: number, from: THREE.Vector3, knock: number): void {
    if (!k.hurt(dmg)) return;
    if (knock > 0) {
      const d = new THREE.Vector3(k.pos.x - from.x, 0, k.pos.z - from.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      k.vel.addScaledVector(d.normalize(), knock);
    }
  }

  /** Sword strike: targets in the arc in front of the hero (and in the finisher's wave), no wall in between — like the playground's `strike` */
  private strike(s: Strike, h: BattleHero): number {
    const who = h.knight, g = h.gear;
    const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const finisher = s.step === 2;
    const impact = s.from.clone().addScaledVector(fwd, 1.5).setY(who.pos.y);
    const hit = new Set<Target>();
    const waveR = who.tune.shockR * g.stats.waveMult;
    for (const t of this.targets()) {
      if (!t.alive || Math.abs(t.pos.y - who.pos.y) > 1.6) continue;
      const dx = t.pos.x - s.from.x, dz = t.pos.z - s.from.z, d = Math.hypot(dx, dz);
      const inArc = d - t.radius <= s.range && (d < 0.7 || Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - s.yaw), Math.cos(Math.atan2(dx, dz) - s.yaw))) <= s.half + Math.atan(t.radius / Math.max(d, 0.3)));
      const inWave = finisher && Math.hypot(t.pos.x - impact.x, t.pos.z - impact.z) - t.radius <= waveR;
      if (!inArc && !inWave) continue;
      if (this.terrain.blocked(s.from.x, s.from.z, t.pos.x, t.pos.z, who.pos.y + 0.5)) continue;
      hit.add(t);
    }
    let smite = false;
    for (const t of hit) {
      const dir = new THREE.Vector3(t.pos.x - s.from.x, 0, t.pos.z - s.from.z).normalize();
      const point = t.pos.clone().setY(1.1).addScaledVector(dir, -t.radius);
      const d = g.meleeDamage(s.dmg);
      t.hit(d.dmg, dir, point, s.knock * g.stats.knockMult);
      g.arts.onHitTarget(t, point, dir, d.crit, finisher);
      g.onHit(d.dmg, true, t.pos, t);
      smite ||= !finisher && g.stats.smiteChance > 0 && rnd() < g.stats.smiteChance;
    }
    if (smite) {
      const r = who.tune.shockR * 0.7;
      for (const t of this.targets()) if (t.alive && !hit.has(t) && Math.hypot(t.pos.x - impact.x, t.pos.z - impact.z) - t.radius <= r) {
        t.hit(Math.round(s.dmg * g.stats.meleeMult * 0.5), new THREE.Vector3(t.pos.x - impact.x, 0, t.pos.z - impact.z).normalize(), t.pos.clone().setY(1), 1);
      }
    }
    g.arts.onStrike(s, [...hit], impact);
    return hit.size;
  }

  /** Heroes and the pack inside the world step (the `step` hook): gear, movement, lava, getting up from exhaustion; then the pack and fx timers */
  private stepActors(dt: number): void {
    const solids = this.world.solids;
    for (const h of this.heroes.values()) {
      const k = h.knight;
      if (k.down && !this.world.rules?.ownsDowned) { h.downT += dt; if (h.downT > REVIVE_S) { k.revive(); h.downT = 0; } }
      k.slow = Math.min(0.8, this.pack.slowFor(k));
      h.input.roll = h.rolled;
      h.rolled = false;
      h.gear.update(dt, h.bow && !k.down, h.input.aim);
      k.update(dt, h.input, solids, this.terrain);
      h.input.roll = false;
      if (!k.down && this.lava && this.level.nameAt(Math.round(k.pos.x), Math.floor(k.pos.y - 0.01), Math.round(k.pos.z)) === 'lava') {
        h.lavaT -= dt;
        if (h.lavaT <= 0) { h.lavaT = LAVA_S; this.hurt(k, LAVA_DMG, k.pos, 0); }
      } else h.lavaT = 0;
    }
    this.pack.update(dt);
    this.fx.update(dt, 0, 0);
  }

  /** Battle step */
  step(dt: number): void { this.world.step(dt); }

  /** Reward to everyone: the match loot — only when the rules pay it (a defended bush; lost — it burns), and the battle experience */
  rewards(): Map<number, { berries: number; xp: number }> {
    const out = new Map<number, { berries: number; xp: number }>();
    const rules = this.world.rules;
    for (const h of this.heroes.values()) out.set(h.seat, { berries: rules?.paid ? Math.max(0, Math.floor(rules.lootOf(h.seat))) : 0, xp: Math.max(0, Math.floor(xpTotal(h.profile.data) - h.xp0)) });
    return out;
  }
}
