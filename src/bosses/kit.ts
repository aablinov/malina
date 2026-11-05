import * as THREE from 'three';
import { rnd } from '../rng.ts';
import type { Obstacle } from '../collision.ts';
import type { FX } from '../fx.ts';
import type { Knight } from '../knight.ts';
import type { Terrain } from '../level/collide.ts';
import type { Target } from '../target.ts';
import { HERO } from '../tuning.ts';
import { dmgMult, hpMult, lootMult, type BossScale } from './scaling.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Shared by the wardens of Malina (wiki/design-bosses.md): a target for sword and spells, health with a multiplier for players,
 * a berry heart (open — damage ×2), a flash on hit, materials shimmering "element ↔ raspberry".
 */

export interface BossHooks {
  scene: THREE.Scene;
  fx: FX;
  hero: Knight;
  terrain: Terrain;
  /** Arena walls and columns — the dragon steers its body around them */
  obstacles: () => readonly Obstacle[];
  /** Hit the hero: damage, from where, knockback strength (m/s) */
  hurtHero(dmg: number, from: THREE.Vector3, knock: number): void;
  /** Sound is off (the test drives input itself) */
  quiet(): boolean;
}

export const C = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
export const rand = (a: number, b: number): number => a + rnd() * (b - a);
/** Angle in [−π, π] */
export const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
export const UNIT = new THREE.BoxGeometry(1, 1, 1);

/** Raspberry: colour of the heart and crown of every warden */
export const RASP = C(3.4, 0.35, 1.1);

/** Glowing material (no tone mapping, shines in bloom) */
export const glowMat = (c: THREE.Color, opacity = 1, additive = false): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: c.clone(), toneMapped: false, transparent: opacity < 1 || additive, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive });

/** Shimmer: the material changes colour between a and b with its own phase — each part has its own, light "runs" along the body */
export interface Shimmer { mat: THREE.MeshBasicMaterial; a: THREE.Color; b: THREE.Color; phase: number; speed: number }

export abstract class Boss implements Target {
  readonly pos = new THREE.Vector3();
  readonly group = new THREE.Group();
  abstract readonly radius: number;
  abstract readonly title: string;
  /** Caption under the name on the bar */
  readonly subtitle: string = t('raspberry warden');
  readonly topY: number = 3;
  hp = 1;
  maxHp = 1;
  /** The fighter is awake (arena closed) */
  awake = false;
  dead = false;
  /** Heart open — damage ×2 */
  heartOpen = false;
  yaw = 0;
  /** Total damage taken (for tests) */
  taken = 0;
  /** Weakened by the "Hungry Shadow" aura: damage to it ×(1 + exposeK), exposeT s left */
  exposeK = 0;
  exposeT = 0;
  /** Called once when health runs out: where the heart burst */
  onDeath?: (at: THREE.Vector3) => void;
  protected flashT = 0;
  readonly flashMats: THREE.MeshLambertMaterial[] = [];
  protected readonly shimmers: Shimmer[] = [];
  protected time = 0;

  /** Level and number of players (src/bosses/scaling.ts): health, damage, raspberries */
  readonly scale: BossScale = { level: 1, players: 1 };
  protected readonly h: BossHooks;

  readonly baseHp: number;
  readonly home: THREE.Vector3;
  readonly homeYaw: number;
  constructor(hooks: BossHooks, baseHp: number, home: THREE.Vector3, homeYaw: number = 0) { this.baseHp = baseHp; this.home = home; this.homeYaw = homeYaw;
    // all warden damage to heroes goes through hurtHero: here it is multiplied by the scale (attacks, zones, minions)
    this.h = { ...hooks, hurtHero: (dmg, from, knock) => hooks.hurtHero(dmg * this.dmgMult, from, knock) };
    hooks.scene.add(this.group);
  }

  get alive(): boolean { return !this.dead; }
  /** Multiplier of damage to heroes from level and number of players */
  get dmgMult(): number { return dmgMult(this.scale); }
  /** Raspberry multiplier */
  get lootMult(): number { return lootMult(this.scale); }

  /**
   * Set the level and number of players: health = base × multiplier. In a fight the health fraction is kept
   * (a second player joined — the warden gets tougher but does not heal); asleep — with full health
   */
  setScale(level: number, players: number): void {
    const k = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.scale.level = level;
    this.scale.players = players;
    this.maxHp = Math.round(this.baseHp * hpMult(this.scale));
    this.hp = this.awake && !this.dead ? Math.max(1, Math.round(this.maxHp * k)) : this.maxHp;
  }
  /** Only the number of players (level unchanged) */
  setPlayers(n: number): void { this.setScale(this.scale.level, n); }

  hit(dmg: number, _dir: THREE.Vector3, point: THREE.Vector3, _knock: number): void {
    if (this.dead || !this.awake) return;
    const v = (this.heartOpen ? dmg * 2 : dmg) * (this.exposeT > 0 ? 1 + this.exposeK : 1);
    if (this.heartOpen) this.h.fx.text(point.clone().setY(point.y + 0.6), t('heart! ×2'), 'crit');
    this.hp = Math.max(0, this.hp - v);
    this.taken += v;
    this.flashT = 0.1;
    this.onHurt(v);
    if (this.hp <= 0) { this.dead = true; this.die(); }
  }

  expose(k: number, sec: number): void {
    if (this.dead) return;
    this.exposeK = this.exposeT > 0 ? Math.max(this.exposeK, k) : k;
    this.exposeT = Math.max(this.exposeT, sec);
  }

  /** Body material: flashes white on hit */
  lam(color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshLambertMaterial {
    // the pixelTex texture is already coloured — do not tint it a second time, or the colour darkens twice
    const m = new THREE.MeshLambertMaterial(map ? { map } : { color });
    this.flashMats.push(m);
    return m;
  }

  /** Glowing material shimmering between a and b */
  shimmer(a: THREE.Color, b: THREE.Color, phase = rnd() * 6, speed = 1.6): THREE.MeshBasicMaterial {
    const mat = glowMat(a);
    this.shimmers.push({ mat, a, b, phase, speed });
    return mat;
  }

  /** Frame: shimmer and flash; boost — overall glow brightness (inhale, rage, fades on death) */
  protected tickLook(dt: number, boost: number): void {
    this.time += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.exposeT -= dt;
    for (const m of this.flashMats) m.emissive.setScalar(this.flashT > 0 ? 0.6 : 0);
    for (const s of this.shimmers) {
      const k = 0.5 + 0.5 * Math.sin(this.time * s.speed + s.phase);
      s.mat.color.copy(s.a).lerp(s.b, k).multiplyScalar(boost);
    }
  }

  box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(UNIT, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = !(mat instanceof THREE.MeshBasicMaterial);
    parent.add(m);
    return m;
  }

  protected fwd(): THREE.Vector3 { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  protected move(dir: THREE.Vector3, d: number): void { this.pos.x += dir.x * d; this.pos.z += dir.z * d; }
  protected heroAt(): THREE.Vector3 { return this.h.hero.pos.clone().setY(0); }

  // ---------- damage to the hero ----------
  /** Hero in a circle */
  protected inCircle(c: THREE.Vector3, r: number): boolean { const p = this.h.hero.pos; return Math.hypot(p.x - c.x, p.z - c.z) < r + HERO.radius; }
  /** Hero in a strip from `from` along dir, length len, width w */
  protected inLine(from: THREE.Vector3, dir: THREE.Vector3, len: number, w: number): boolean {
    const p = this.h.hero.pos, dx = p.x - from.x, dz = p.z - from.z;
    const along = dx * dir.x + dz * dir.z, side = Math.abs(dx * dir.z - dz * dir.x);
    return along > -HERO.radius && along < len + HERO.radius && side < w / 2 + HERO.radius;
  }
  protected hurt(dmg: number, from: THREE.Vector3, knock = 4): void { this.h.hurtHero(dmg, from, knock); }
  /** Hero in a cone in front of point `from`: half — half-angle, rad */
  protected inCone(from: THREE.Vector3, yaw: number, range: number, half: number): boolean {
    const p = this.h.hero.pos, dx = p.x - from.x, dz = p.z - from.z, d = Math.hypot(dx, dz);
    if (d > range + 0.4) return false;
    return d < 0.8 || Math.abs(wrap(Math.atan2(dx, dz) - yaw)) <= half;
  }

  abstract update(dt: number): void;
  /** Wake up: the arena closed */
  abstract wake(): void;
  /** Put back in place, asleep, full health */
  abstract reset(): void;
  protected abstract die(): void;
  protected onHurt(_v: number): void { /* reaction to a hit — each warden has its own */ }
}
