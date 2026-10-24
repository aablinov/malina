import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import type { Knight } from '../knight';
import type { Terrain } from '../level/collide.ts';
import type { Target } from '../target';

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
  /** Вызывается один раз, когда здоровье кончилось: где лопнуло сердце */
  onDeath?: (at: THREE.Vector3) => void;
  protected flashT = 0;
  readonly flashMats: THREE.MeshLambertMaterial[] = [];
  protected readonly shimmers: Shimmer[] = [];
  protected time = 0;

  constructor(protected readonly h: BossHooks, readonly baseHp: number, readonly home: THREE.Vector3, readonly homeYaw = 0) {
    h.scene.add(this.group);
  }

  get alive(): boolean { return !this.dead; }

  /** Здоровье ×(1 + 0,75·(игроков − 1)) */
  setPlayers(n: number): void { this.maxHp = Math.round(this.baseHp * (1 + 0.75 * (n - 1))); this.hp = this.maxHp; }

  hit(dmg: number, _dir: THREE.Vector3, point: THREE.Vector3, _knock: number): void {
    if (this.dead || !this.awake) return;
    const v = this.heartOpen ? dmg * 2 : dmg;
    if (this.heartOpen) this.h.fx.text(point.clone().setY(point.y + 0.6), 'сердце! ×2', 'crit');
    this.hp = Math.max(0, this.hp - v);
    this.taken += v;
    this.flashT = 0.1;
    this.onHurt(v);
    if (this.hp <= 0) { this.dead = true; this.die(); }
  }

  /** Материал тела: вспыхивает белым от удара */
  lam(color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ color, map });
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
