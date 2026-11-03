import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import { Gear } from '../gear.ts';
import { nullFx } from '../headless.ts';
import { Profile, xpToNext, type ProfileData } from '../items.ts';
import { emptyInput, Knight, type KnightInput, type Strike } from '../knight.ts';
import { obstaclesOf, terrainOf, type Terrain } from '../level/collide.ts';
import type { Level } from '../level/level.ts';
import { Pack } from '../mobs/pack.ts';
import { rnd } from '../rng.ts';
import { SimWorld, type SimHooks } from '../sim/world.ts';
import type { Target } from '../target.ts';
import { SWORD } from '../tuning.ts';
import type { TdSpec } from '../td/types.ts';
import { makeTextures, type Textures } from '../textures.ts';

/**
 * Безголовый бой обороны (wiki/design-multiplayer.md): мир симуляции, герои партии со снаряжением и стая врагов —
 * те же классы, что в браузере, но без рендера (`src/headless.ts`). Сервер считает по нему матч (src/game/match.ts),
 * тесты гоняют настоящие волны в Node. Герой каждого места — `Knight` + `Gear` по его профилю (набор обороны)
 */
export interface BattleHero {
  seat: number;
  knight: Knight;
  gear: Gear;
  profile: Profile;
  input: KnightInput;
  bow: boolean;
  /** Перекат защёлкнут до шага, который его прочтёт */
  rolled: boolean;
  lavaT: number;
  downT: number;
  /** Опыт на старте — награда за бой считается от него */
  xp0: number;
}

/** Без сил — встаёт через, с */
const REVIVE_S = 2;
const LAVA_S = 0.4;
const LAVA_DMG = 6;

let textures: Textures | null = null;
/** Всего опыта героя от первого уровня — чтобы посчитать, сколько набрано за бой */
export const xpTotal = (d: ProfileData): number => { let n = d.xp; for (let l = 1; l < d.level; l++) n += xpToNext(l); return n; };

export class HeadlessBattle {
  readonly world: SimWorld;
  readonly pack: Pack;
  readonly heroes = new Map<number, BattleHero>();
  readonly level: Level;
  readonly terrain: Terrain;
  readonly scene = new THREE.Scene();
  readonly fx = nullFx();
  private readonly levelObstacles: Obstacle[];
  private readonly lava: boolean;
  /** Цель мобов по умолчанию, когда героев нет: далеко и без сил */
  private readonly nobody: Knight;

  constructor(map: { level: Level; td: TdSpec }, seed: number, players: number, personal = true) {
    textures ??= makeTextures();
    this.level = map.level;
    this.terrain = terrainOf(map.level);
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
    };
    this.pack = new Pack(bossHooks, (at, n) => { if (this.world.td) this.world.td.fallen++; this.world.piles.drop(at, n); });
    const hooks: SimHooks = {
      foes: () => this.pack.mobs.filter((m) => m.alive),
      heroes: () => [...this.heroes.values()].map((h) => ({ pos: h.knight.pos, get down() { return h.knight.down; }, seat: h.seat })),
      spawnMob: (kind, at) => this.pack.spawn(kind, at),
      setScale: (l, p) => this.pack.setScale(l, p),
      levelChanged: () => { this.levelObstacles.length = 0; this.levelObstacles.push(...obstaclesOf(map.level, 0, b.minX, b.minZ, b.maxX, b.maxZ)); this.foeCache = null; },
      step: (dt) => this.stepActors(dt),
    };
    this.world = new SimWorld(hooks, { seed, level: map.level, td: map.td, players, personal });
  }

  private foeCache: Obstacle[] | null = null;
  private foeKey: Obstacle[] | null = null;
  private foeObstacles(): Obstacle[] {
    const towers = this.world.foeSolids;
    if (!this.foeCache || this.foeKey !== towers) { this.foeCache = this.levelObstacles.concat(towers); this.foeKey = towers; }
    return this.foeCache;
  }

  /** Герой места seat по профилю (копия; в бой — набор обороны, как в браузере). Появляется у точки карты */
  addHero(seat: number, data: ProfileData): BattleHero {
    const knight = new Knight(this.scene, textures!);
    knight.tune = structuredClone(SWORD);
    const sp = this.level.spawn ?? [this.world.td!.bush.pos.x, 0, this.world.td!.bush.pos.z + 4];
    const a = (seat / 4) * Math.PI * 2;
    knight.place(sp[0] + Math.cos(a) * 1.2, sp[2] + Math.sin(a) * 1.2, Math.PI, sp[1]);
    const profile = new Profile(structuredClone(data), false);
    profile.tdKit();
    const gear = new Gear({
      scene: this.scene, fx: this.fx, hero: knight, terrain: this.terrain, targets: () => this.targets(), blast: () => {},
      sound: () => {}, toast: () => {}, banner: () => {}, quiet: () => true,
    }, profile);
    const h: BattleHero = { seat, knight, gear, profile, input: emptyInput(), bow: false, rolled: false, lavaT: 0, downT: 0, xp0: xpTotal(profile.data) };
    knight.onStrike = (s) => this.strike(s, h);
    this.heroes.set(seat, h);
    this.world.td?.fund(seat);
    return h;
  }

  removeHero(seat: number): void {
    const h = this.heroes.get(seat);
    if (!h) return;
    this.scene.remove(h.knight.object);
    this.heroes.delete(seat);
  }

  /** Цели меча, стрел и заклинаний: враги и лёд на башнях */
  targets(): Target[] { return [...this.pack.targets(), ...(this.world.td?.targets() ?? [])]; }

  /** Удар моба по герою: урон и отброс (как hurtHero плейграунда, без искр и звука) */
  private hurt(k: Knight, dmg: number, from: THREE.Vector3, knock: number): void {
    if (!k.hurt(dmg)) return;
    if (knock > 0) {
      const d = new THREE.Vector3(k.pos.x - from.x, 0, k.pos.z - from.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      k.vel.addScaledVector(d.normalize(), knock);
    }
  }

  /** Удар меча: цели в дуге перед героем (и в волне добивающего), без стены между — как `strike` плейграунда */
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

  /** Герои и стая — внутри шага мира (крючок `step`): снаряжение, движение, лава, подъём без сил; потом стая и таймеры fx */
  private stepActors(dt: number): void {
    const solids = this.world.solids;
    for (const h of this.heroes.values()) {
      const k = h.knight;
      if (k.down) { h.downT += dt; if (h.downT > REVIVE_S) { k.revive(); h.downT = 0; } }
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

  /** Шаг боя */
  step(dt: number): void { this.world.step(dt); }

  /** Награда каждому: непотраченная малина и опыт за бой */
  rewards(): Map<number, { berries: number; xp: number }> {
    const out = new Map<number, { berries: number; xp: number }>();
    for (const h of this.heroes.values()) out.set(h.seat, { berries: Math.max(0, Math.floor(this.world.td?.berries(h.seat) ?? 0)), xp: Math.max(0, Math.floor(xpTotal(h.profile.data) - h.xp0)) });
    return out;
  }
}
