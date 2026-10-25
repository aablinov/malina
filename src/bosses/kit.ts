import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import type { Knight } from '../knight';
import type { Terrain } from '../level/collide.ts';
import type { Target } from '../target';
import { HERO } from '../tuning';
import { dmgMult, hpMult, lootMult, type BossScale } from './scaling';

/**
 * Общее для стражей Малины (wiki/design-bosses.md): цель для меча и заклинаний, здоровье с множителем на игроков,
 * сердце-ягода (открыто — урон ×2), вспышка от удара, материалы с переливом «стихия ↔ малина».
 */

export interface BossHooks {
  scene: THREE.Scene;
  fx: FX;
  hero: Knight;
  terrain: Terrain;
  /** Стены арены и колонны — дракон обходит их телом */
  obstacles: () => readonly Obstacle[];
  /** Ударить героя: урон, откуда, сила отброса (м/с) */
  hurtHero(dmg: number, from: THREE.Vector3, knock: number): void;
  /** Звук выключен (тест ведёт ввод сам) */
  quiet(): boolean;
}

export const C = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
/** Угол из [−π, π] */
export const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
export const UNIT = new THREE.BoxGeometry(1, 1, 1);

/** Малина: цвет сердца и короны у всех стражей */
export const RASP = C(3.4, 0.35, 1.1);

/** Светящийся материал (без тонмаппинга, светит в bloom) */
export const glowMat = (c: THREE.Color, opacity = 1, additive = false): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: c.clone(), toneMapped: false, transparent: opacity < 1 || additive, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive });

/** Перелив: материал меняет цвет между a и b со своей фазой — у каждой детали своя, свет «бежит» по телу */
export interface Shimmer { mat: THREE.MeshBasicMaterial; a: THREE.Color; b: THREE.Color; phase: number; speed: number }

export abstract class Boss implements Target {
  readonly pos = new THREE.Vector3();
  readonly group = new THREE.Group();
  abstract readonly radius: number;
  abstract readonly title: string;
  /** Подпись под именем на полосе */
  readonly subtitle: string = 'страж малины';
  readonly topY: number = 3;
  hp = 1;
  maxHp = 1;
  /** Боец проснулся (арена закрыта) */
  awake = false;
  dead = false;
  /** Сердце открыто — урон ×2 */
  heartOpen = false;
  yaw = 0;
  /** Всего получено урона (для тестов) */
  taken = 0;
  /** Ослаблен аурой «Голодная тень»: урон по нему ×(1 + exposeK), осталось exposeT с */
  exposeK = 0;
  exposeT = 0;
  /** Вызывается один раз, когда здоровье кончилось: где лопнуло сердце */
  onDeath?: (at: THREE.Vector3) => void;
  protected flashT = 0;
  readonly flashMats: THREE.MeshLambertMaterial[] = [];
  protected readonly shimmers: Shimmer[] = [];
  protected time = 0;

  /** Уровень и число игроков (src/bosses/scaling.ts): здоровье, урон, малина */
  readonly scale: BossScale = { level: 1, players: 1 };
  protected readonly h: BossHooks;

  constructor(hooks: BossHooks, readonly baseHp: number, readonly home: THREE.Vector3, readonly homeYaw = 0) {
    // весь урон стража по героям — через hurtHero: здесь он домножается на масштаб (атаки, зоны, подручные)
    this.h = { ...hooks, hurtHero: (dmg, from, knock) => hooks.hurtHero(dmg * this.dmgMult, from, knock) };
    hooks.scene.add(this.group);
  }

  get alive(): boolean { return !this.dead; }
  /** Множитель урона по героям от уровня и числа игроков */
  get dmgMult(): number { return dmgMult(this.scale); }
  /** Множитель малины */
  get lootMult(): number { return lootMult(this.scale); }

  /**
   * Задать уровень и число игроков: здоровье = база × множитель. В бою доля здоровья сохраняется
   * (зашёл второй игрок — страж крепчает, но не лечится); спящий — с полным здоровьем
   */
  setScale(level: number, players: number): void {
    const k = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.scale.level = level;
    this.scale.players = players;
    this.maxHp = Math.round(this.baseHp * hpMult(this.scale));
    this.hp = this.awake && !this.dead ? Math.max(1, Math.round(this.maxHp * k)) : this.maxHp;
  }
  /** Только число игроков (уровень прежний) */
  setPlayers(n: number): void { this.setScale(this.scale.level, n); }

  hit(dmg: number, _dir: THREE.Vector3, point: THREE.Vector3, _knock: number): void {
    if (this.dead || !this.awake) return;
    const v = (this.heartOpen ? dmg * 2 : dmg) * (this.exposeT > 0 ? 1 + this.exposeK : 1);
    if (this.heartOpen) this.h.fx.text(point.clone().setY(point.y + 0.6), 'сердце! ×2', 'crit');
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

  /** Материал тела: вспыхивает белым от удара */
  lam(color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshLambertMaterial {
    // текстура pixelTex уже в цвете — второй раз не красим, иначе цвет темнеет вдвое
    const m = new THREE.MeshLambertMaterial(map ? { map } : { color });
    this.flashMats.push(m);
    return m;
  }

  /** Светящийся материал с переливом между a и b */
  shimmer(a: THREE.Color, b: THREE.Color, phase = Math.random() * 6, speed = 1.6): THREE.MeshBasicMaterial {
    const mat = glowMat(a);
    this.shimmers.push({ mat, a, b, phase, speed });
    return mat;
  }

  /** Кадр: перелив и вспышка; boost — общая яркость свечения (вдох, ярость, гаснет на смерти) */
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

  // ---------- урон герою ----------
  /** Герой в круге */
  protected inCircle(c: THREE.Vector3, r: number): boolean { const p = this.h.hero.pos; return Math.hypot(p.x - c.x, p.z - c.z) < r + HERO.radius; }
  /** Герой в полосе от from вдоль dir длиной len, шириной w */
  protected inLine(from: THREE.Vector3, dir: THREE.Vector3, len: number, w: number): boolean {
    const p = this.h.hero.pos, dx = p.x - from.x, dz = p.z - from.z;
    const along = dx * dir.x + dz * dir.z, side = Math.abs(dx * dir.z - dz * dir.x);
    return along > -HERO.radius && along < len + HERO.radius && side < w / 2 + HERO.radius;
  }
  protected hurt(dmg: number, from: THREE.Vector3, knock = 4): void { this.h.hurtHero(dmg, from, knock); }
  /** Герой в конусе перед точкой from: half — полуугол, рад */
  protected inCone(from: THREE.Vector3, yaw: number, range: number, half: number): boolean {
    const p = this.h.hero.pos, dx = p.x - from.x, dz = p.z - from.z, d = Math.hypot(dx, dz);
    if (d > range + 0.4) return false;
    return d < 0.8 || Math.abs(wrap(Math.atan2(dx, dz) - yaw)) <= half;
  }

  abstract update(dt: number): void;
  /** Проснуться: арена закрылась */
  abstract wake(): void;
  /** Вернуть на место, спит, здоровье полное */
  abstract reset(): void;
  protected abstract die(): void;
  protected onHurt(_v: number): void { /* реакция на удар — у стража своя */ }
}
