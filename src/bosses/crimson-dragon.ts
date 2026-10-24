import * as THREE from 'three';
import { resolveCircle } from '../collision';
import { HERO } from '../tuning';
import { glowTex } from '../loot-look';
import { bossSfx } from './boss-audio';
import type { Rect } from './arena';
import { DragonRig, REST, type DragonLook, type Pose } from './dragon-rig';
import { Boss, C, glowMat, rand, RASP, UNIT, wrap, type BossHooks } from './kit';

/**
 * Багровый дракон — первый мини-босс (wiki/design-bosses.md, раздел 5). Тело из кубов цвета углей, светятся трещины лавы,
 * шипы, край перепонок, глаза, корона из костянок и сердце-ягода; свет переливается огонь ↔ малина.
 * Атаки: укус, хвост по кругу, огненное дыхание с горящим полом, «Небесный молот» — взлёт и падение метеором,
 * после него оглушён и сердце открыто (×2). Фаза 2 (< 50 %): быстрее, ярче, за молотом три малых метеора.
 */

const FIRE = C(4, 1.4, 0.3), EMBER = C(4, 2.6, 0.8), PINK = C(4, 1.7, 2.4);
const SPEED = 4.2;
const TURN = 3.4;
/** Прыжки: отскок назад, вбок (сменить позицию) и бросок на героя издалека */
type LeapKind = 'back' | 'side' | 'pounce';
const FLY_Y = 17;

type State = 'sleep' | 'wake' | 'idle' | 'walk' | 'bite' | 'tail' | 'breath' | 'hammer' | 'leap' | 'daze' | 'roar' | 'dead';

/** Багровый: чешуя цвета углей и крови, перепонки красные, свет огонь ↔ малина */
export const CRIMSON_LOOK: DragonLook = {
  size: 0.045,
  scale: '#b3303a', dark: '#5e1f27', belly: '#d8743e', plate: '#3a1418', membrane: '#4e1018', bone: '#e2d2b0', claw: '#1c1214',
  glowA: FIRE, glowB: RASP, eyeA: C(4, 3.4, 1.4), eyeB: C(4, 1.6, 0.8), crownA: RASP, crownB: PINK,
};

/** Спит: лёг, шея и хвост свернулись кольцом, крылья сложены */
const SLEEP: Pose = { ...REST, low: 1, neck: -0.15, spread: 0, dip: 0.15, curl: 1, side: 1 };

interface Burn { pos: THREE.Vector3; t: number; r: number }

export class CrimsonDragon extends Boss {
  readonly radius = 1.8;
  readonly title = 'Багровый дракон';
  override readonly topY = 3;
  state: State = 'sleep';
  /** Время в текущем состоянии */
  st = 0;
  phase2 = false;
  private flyY = 0;
  private cd = 1;
  private hammerT = 9;
  private breathCd = 2;
  private farT = 0;
  private leapCd = 1.5;
  private nearT = 0;
  private strafe = 1;
  private strafeT = 2;
  private readonly leapFrom = new THREE.Vector3();
  private readonly leapTo = new THREE.Vector3();
  private leapKind: LeapKind = 'back';
  private leapDur = 0.6;
  private leapH = 2;
  private hitDone = false;
  private walkPhase = 0;
  private stepSide = 0;
  /** Куда падать (тень) и куда смотреть при дыхании */
  private readonly aim = new THREE.Vector3();
  private sweep0 = 0;
  private sweepDir = 1;
  private tickT = 0;
  private boost = 1;
  private deathT = 0;
  private readonly burns: Burn[] = [];
  private readonly meteors: { at: THREE.Vector3; t: number; ring: THREE.Mesh }[] = [];
  private want: Pose = { ...REST };
  private readonly rig: DragonRig;
  private readonly shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

  constructor(h: BossHooks, home: THREE.Vector3, homeYaw: number, readonly arena: Rect) {
    super(h, 900, home, homeYaw);
    this.setPlayers(1);
    this.rig = new DragonRig(this, CRIMSON_LOOK);
    this.group.add(this.rig.root);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 40), glowMat(C(1.6, 0.2, 0.08), 0, true));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.visible = false;
    // край тени: яркое кольцо, где кончается удар
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), glowMat(C(3, 0.5, 0.25), 0.9, true));
    edge.position.z = 0.005;
    this.shadow.add(edge);
    h.scene.add(this.shadow);
    this.reset();
  }

  // ---------- состояние ----------
  reset(): void {
    this.hp = this.maxHp;
    this.dead = false;
    this.awake = false;
    this.heartOpen = false;
    this.phase2 = false;
    this.pos.copy(this.home);
    this.yaw = this.homeYaw;
    this.flyY = 0;
    this.deathT = 0;
    this.taken = 0;
    this.go('sleep');
    Object.assign(this.rig.pose, SLEEP);
    this.want = { ...SLEEP };
    this.rig.root.rotation.set(0, 0, 0);
    this.rig.root.scale.setScalar(1);
    this.group.visible = true;
    this.shadow.visible = false;
    this.burns.length = 0;
    for (const m of this.meteors.splice(0)) { this.h.scene.remove(m.ring); }
    this.apply(0);
  }

  wake(): void {
    if (this.awake || this.dead) return;
    this.awake = true;
    this.go('wake');
  }

  /** Сменить состояние */
  private go(s: State): void { this.state = s; this.st = 0; this.hitDone = false; }

  private get quiet(): boolean { return this.h.quiet(); }
  private get speedK(): number { return this.phase2 ? 1.25 : 1; }

  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    // в небе не достать
    if (this.flyY > 2.5) return;
    super.hit(dmg, dir, point, knock);
  }

  protected override onHurt(): void {
    if (!this.phase2 && this.hp > 0 && this.hp < this.maxHp * 0.5) {
      this.phase2 = true;
      // фаза 2 начинается с рёва, если дракон не в воздухе и не оглушён
      if (this.state !== 'hammer' && this.state !== 'daze') this.go('roar');
    }
  }

  protected die(): void {
    this.heartOpen = false;
    this.flyY = 0;
    this.shadow.visible = false;
    this.go('dead');
    if (!this.quiet) bossSfx.death();
    this.h.fx.slowmo = Math.max(this.h.fx.slowmo, 0.6);
  }

  // ---------- мозг ----------
  update(dt: number): void {
    this.st += dt;
    const hero = this.h.hero.pos;
    const dx = hero.x - this.pos.x, dz = hero.z - this.pos.z, dist = Math.hypot(dx, dz);
    const toHero = Math.atan2(dx, dz), rel = wrap(toHero - this.yaw);
    this.want = { ...REST, spread: this.phase2 ? 0.95 : 0.8 };
    let walk = 0;
    this.heartOpen = false;
    const S = this.st;

    switch (this.state) {
      case 'sleep': {
        this.want = { ...SLEEP };
        // дым и искры из ноздрей на выдохе
        if (Math.sin(this.time * 1.3) > 0.97 && Math.random() < 0.5) this.puff(0.4);
        break;
      }
      case 'wake': {
        // встаёт, расправляет крылья, рёв
        if (S < 0.9) this.want = { ...REST, low: 1 - S / 0.9, neck: S / 0.9, spread: 0 };
        else this.want = { ...REST, rear: 1, spread: 1, jaw: 1, neck: 1.4, dip: -0.3 };
        if (S >= 0.9 && !this.hitDone) { this.hitDone = true; this.roar(1.2); }
        this.turnTo(toHero, dt, 1.5);
        if (S > 2.6) this.go('idle');
        break;
      }
      case 'roar': {
        this.want = { ...REST, rear: 1, spread: 1, jaw: 1, neck: 1.4, dip: -0.3 };
        if (S > 0.3 && !this.hitDone) { this.hitDone = true; this.roar(1); this.h.fx.text(this.pos.clone().setY(4.5), 'ярость!', 'crit'); }
        if (S > 1.8) { this.cd = 0.4; this.go('idle'); }
        break;
      }
      case 'idle':
      case 'walk': {
        this.cd -= dt; this.hammerT -= dt; this.breathCd -= dt; this.leapCd -= dt; this.strafeT -= dt;
        this.farT = dist > 10.5 ? this.farT + dt : 0;
        this.nearT = dist < 3.6 ? this.nearT + dt : 0;
        const facing = Math.abs(rel) < 0.45;
        // герой под самой мордой — отскок назад, не дожидаясь атаки
        if (this.nearT > 0.5 && this.leapCd <= 0) { this.startLeap('back'); break; }
        if (this.cd <= 0) {
          if (this.hammerT <= 0 || this.farT > 2.2) { this.startHammer(); break; }
          if (Math.abs(rel) > 1.75 && dist < 6.5) { this.go('tail'); if (!this.quiet) bossSfx.tail(); break; }
          if (facing && dist < 5) { this.go('bite'); if (!this.quiet) bossSfx.bite(); break; }
          if (facing && dist > 9 && dist < 16 && this.leapCd <= 0 && Math.random() < 0.6) { this.startLeap('pounce'); break; }
          if (facing && dist > 5.5 && dist < 11.5 && this.breathCd <= 0) { this.startBreath(rel); break; }
        }
        // далеко — бежит к герою; на средней дистанции кружит боком, держа морду к герою; рядом — разворачивается
        this.turnTo(toHero, dt, dist < 5.5 ? 1.4 : 1);
        if (this.strafeT <= 0) { this.strafeT = rand(1.2, 2.4); this.strafe = Math.random() < 0.5 ? -1 : 1; }
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        if (dist > 7 && Math.abs(rel) < 1.2) {
          walk = 1;
          const sp = SPEED * this.speedK * dt;
          this.pos.x += fx * sp; this.pos.z += fz * sp;
        } else if (dist > 4.2 && Math.abs(rel) < 1.2) {
          walk = 1;
          const sp = SPEED * 0.6 * this.speedK * dt, fwd = dist > 5.2 ? 0.5 : 0;
          this.pos.x += (fz * this.strafe + fx * fwd) * sp; this.pos.z += (-fx * this.strafe + fz * fwd) * sp;
        }
        this.state = walk ? 'walk' : 'idle';
        break;
      }
      case 'leap': this.leap(dt, S); break;
      case 'bite': {
        // замах: голова назад, пасть открыта; рывок вперёд и щелчок
        const W = 0.4 / this.speedK;
        if (S < W) { this.want = { ...REST, neck: 1.35, jaw: 0.8, dip: -0.2, low: 0.15 }; this.turnTo(toHero, dt, 0.8); }
        else if (S < W + 0.18) {
          this.want = { ...REST, neck: 0.05, jaw: 0, dip: 0.35 };
          this.moveFwd(4.5 * dt);
          if (!this.hitDone && S > W + 0.08) {
            this.hitDone = true;
            if (this.inCone(this.pos, this.yaw, 5.6, 0.5)) this.h.hurtHero(18, this.pos, 7);
            this.h.fx.burst(this.mouthPos(), ['#fff4dc', EMBER], 8, { speed: 3, up: 2, size: 0.08, life: 0.3, glow: true });
            this.h.fx.shake = Math.max(this.h.fx.shake, 0.3);
          }
        } else this.want = { ...REST, neck: 0.6, dip: 0.2 };
        // после укуса часто отпрыгивает вбок — меняет позицию
        if (S > W + 0.6) { if (this.leapCd <= 0 && Math.random() < 0.45) this.startLeap('side'); else this.endAttack(0.35); }
        break;
      }
      case 'tail': {
        // закрутка — и полный оборот, хвост метёт круг 4,8 м
        const W = 0.6 / this.speedK, A = 0.5;
        if (S < W) this.want = { ...REST, curl: 1, low: 0.25, spread: 0.5 };
        else if (S < W + A) {
          const k = (S - W) / A;
          this.yaw += (Math.PI * 2 / A) * dt;
          this.want = { ...REST, curl: -1, low: 0.2, spread: 0.6 };
          if (!this.hitDone && k > 0.3 && dist < 6.2 + HERO.radius) { this.hitDone = true; this.h.hurtHero(14, this.pos, 10); }
          if (Math.random() < 0.6) this.h.fx.burst(this.tailTip(), [EMBER, FIRE], 2, { speed: 1, up: 1, size: 0.08, life: 0.4, glow: true, gravity: -1 });
        } else this.want = { ...REST, curl: 0.3 };
        if (S > W + A + 0.4) { if (this.leapCd <= 0 && Math.random() < 0.5) this.startLeap('back'); else this.endAttack(0.3); }
        break;
      }
      case 'breath': this.breathe(dt, S); break;
      case 'hammer': this.hammer(dt, S); break;
      case 'daze': {
        // оглушён: лежит, пасть открыта, сердце бьётся — урон ×2
        this.heartOpen = S > 0.15;
        this.want = { ...REST, low: 0.75, neck: -0.3, jaw: 0.6, spread: 0.4, dip: 0.3 };
        if (Math.random() < 0.25) this.h.fx.particle({ pos: this.headPos().add(new THREE.Vector3(Math.cos(this.time * 6) * 0.7, 0.9, Math.sin(this.time * 6) * 0.7)), vel: new THREE.Vector3(0, 0.3, 0), life: 0.4, size: 0.1, color: PINK, gravity: 0 });
        if (S > 1.8) { this.heartOpen = false; this.endAttack(0.5); }
        break;
      }
      case 'dead': this.dying(dt, S); break;
    }

    this.updateBurns(dt);
    this.updateMeteors(dt);
    // тело не проходит сквозь стены арены и колонны, героя расталкивает
    if (this.state !== 'dead' && this.flyY < 1) {
      const p = new THREE.Vector3(this.pos.x, 0, this.pos.z);
      resolveCircle(p, this.radius - 0.4, this.h.obstacles());
      const a = this.arena;
      this.pos.x = THREE.MathUtils.clamp(p.x, a.x0 + 1.2, a.x1 - 1.2);
      this.pos.z = THREE.MathUtils.clamp(p.z, a.z0 + 1.2, a.z1 - 1.2);
      // героя расталкивает корпус — отрезок вдоль хребта, а не круг
      if (this.state !== 'sleep') {
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), half = this.rig.bodyLen / 2;
        const along = THREE.MathUtils.clamp(dx * fx + dz * fz, -half, half);
        const ex = dx - fx * along, ez = dz - fz * along, d = Math.hypot(ex, ez), R = 0.9 + HERO.radius;
        if (d < R) { const k = (R - d) / Math.max(d, 0.01); hero.x += ex * k; hero.z += ez * k; }
      }
    }
    this.pos.y = this.flyY;
    // шаги: на каждом полупериоде ходьбы — удар в землю и пыль
    if (walk) {
      this.walkPhase += dt * 6.5 * this.speedK;
      const side = Math.sin(this.walkPhase) > 0 ? 1 : -1;
      if (side !== this.stepSide) {
        this.stepSide = side;
        if (!this.quiet) bossSfx.step(0.8);
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.12);
        const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), right = new THREE.Vector3(fwd.z, 0, -fwd.x);
        this.h.fx.burst(this.pos.clone().addScaledVector(right, side * 0.9).addScaledVector(fwd, -0.9).setY(0.1), ['#9a8f70', '#6b5a4a'], 5, { speed: 1.2, up: 0.8, size: 0.1, life: 0.5, gravity: 6 });
      }
    }
    this.apply(dt, walk);
  }

  private turnTo(a: number, dt: number, k = 1): void {
    const d = wrap(a - this.yaw), m = TURN * k * this.speedK * dt;
    this.yaw += Math.max(-m, Math.min(m, d));
  }

  private moveFwd(d: number): void { this.pos.x += Math.sin(this.yaw) * d; this.pos.z += Math.cos(this.yaw) * d; }

  private endAttack(cd: number): void { this.cd = cd / this.speedK; this.go('idle'); }

  private roar(big: number): void {
    if (!this.quiet) bossSfx.roar(big);
    const fx = this.h.fx;
    fx.shake = Math.max(fx.shake, 0.9 * big);
    fx.shock(this.pos.clone().setY(0.1), 7 * big, FIRE.clone().multiplyScalar(0.5), 0.6, 0.12);
    fx.burst(this.mouthPos(), [FIRE, EMBER, RASP], 24, { speed: 5, up: 2, size: 0.1, life: 0.7, glow: true, gravity: 1 });
    this.h.fx.burst(this.pos.clone().setY(0.2), ['#9a8f70', '#6b5a4a', '#8a7a60'], 30, { speed: 6, up: 1, size: 0.14, life: 0.8, gravity: 4 });
  }

  /** Дым и искры из ноздрей */
  private puff(k: number): void {
    const p = this.mouthPos();
    for (let i = 0; i < 4; i++) this.h.fx.particle({ pos: p.clone(), vel: new THREE.Vector3(rand(-0.3, 0.3) + Math.sin(this.yaw) * k, rand(0.4, 0.9), rand(-0.3, 0.3) + Math.cos(this.yaw) * k), life: rand(0.6, 1.1), size: rand(0.1, 0.18), color: i % 2 ? EMBER : RASP, gravity: -0.5 });
  }

  // ---------- прыжки ----------
  private startLeap(kind: LeapKind): void {
    const hero = this.h.hero.pos, a = this.arena;
    const away = new THREE.Vector3(this.pos.x - hero.x, 0, this.pos.z - hero.z);
    if (away.lengthSq() < 1e-3) away.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    away.normalize();
    const side = new THREE.Vector3(away.z, 0, -away.x).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
    this.leapFrom.copy(this.pos).setY(0);
    if (kind === 'back') this.leapTo.copy(this.pos).addScaledVector(away, 7).addScaledVector(side, rand(-2, 2));
    else if (kind === 'side') this.leapTo.copy(this.pos).addScaledVector(side, 7).addScaledVector(away, 1.5);
    else this.leapTo.set(hero.x, 0, hero.z).addScaledVector(away, 2.6);
    // не за стены: если упирается — в другую сторону
    const inside = (p: THREE.Vector3) => p.x > a.x0 + 2 && p.x < a.x1 - 2 && p.z > a.z0 + 2 && p.z < a.z1 - 2;
    if (!inside(this.leapTo) && kind !== 'pounce') this.leapTo.copy(this.pos).addScaledVector(side, -7);
    this.leapTo.x = THREE.MathUtils.clamp(this.leapTo.x, a.x0 + 2, a.x1 - 2);
    this.leapTo.z = THREE.MathUtils.clamp(this.leapTo.z, a.z0 + 2, a.z1 - 2);
    this.leapTo.y = 0;
    this.leapKind = kind;
    const d = this.leapFrom.distanceTo(this.leapTo);
    this.leapDur = kind === 'pounce' ? 0.55 + d * 0.025 : 0.5;
    this.leapH = kind === 'pounce' ? 3.2 : 1.8;
    this.leapCd = this.phase2 ? 1.6 : 2.4;
    this.go('leap');
  }

  private leap(dt: number, S: number): void {
    const CROUCH = this.leapKind === 'pounce' ? 0.3 : 0.14, fx = this.h.fx, hero = this.h.hero.pos;
    if (S < CROUCH) {
      // присел перед прыжком: колени согнуты, крылья вверх
      this.want = { ...REST, low: 0.45, spread: 1, neck: 0.8, jaw: this.leapKind === 'pounce' ? 0.6 : 0 };
      if (this.leapKind === 'pounce') this.turnTo(Math.atan2(hero.x - this.pos.x, hero.z - this.pos.z), dt, 2);
      return;
    }
    const k = Math.min(1, (S - CROUCH) / this.leapDur);
    if (!this.hitDone) { this.hitDone = true; if (!this.quiet) bossSfx.flap(1.2); fx.burst(this.pos.clone().setY(0.2), ['#9a8f70', '#6b5a4a'], 14, { speed: 4, up: 1.2, size: 0.14, life: 0.6, gravity: 5 }); }
    const e = k < 1 ? 1 - (1 - k) * (1 - k) : 1;
    this.pos.x = THREE.MathUtils.lerp(this.leapFrom.x, this.leapTo.x, e);
    this.pos.z = THREE.MathUtils.lerp(this.leapFrom.z, this.leapTo.z, e);
    this.flyY = Math.sin(Math.PI * k) * this.leapH;
    // в прыжке морда к герою (отскок и смена позиции), бросок — пасть открыта, лапы вперёд
    this.turnTo(Math.atan2(hero.x - this.pos.x, hero.z - this.pos.z), dt, 2.5);
    this.want = { ...REST, spread: 1, neck: this.leapKind === 'pounce' ? 0.4 : 1.1, jaw: this.leapKind === 'pounce' ? 1 : 0, dip: this.leapKind === 'pounce' ? 0.4 : 0, low: 0.2 };
    if (k < 1) return;
    // приземление: пыль, тряска; бросок бьёт тех, кто под лапами
    this.flyY = 0;
    if (!this.quiet) bossSfx.step(this.leapKind === 'pounce' ? 1.6 : 1);
    fx.shake = Math.max(fx.shake, this.leapKind === 'pounce' ? 0.7 : 0.35);
    fx.shock(this.pos.clone().setY(0.08), this.leapKind === 'pounce' ? 3.5 : 2.5, C(1.4, 1.2, 1), 0.4, 0.15);
    fx.burst(this.pos.clone().setY(0.2), ['#9a8f70', '#6b5a4a', '#8a7a60'], 20, { speed: 5, up: 1.5, size: 0.16, life: 0.7, gravity: 5 });
    if (this.leapKind === 'pounce' && Math.hypot(hero.x - this.pos.x, hero.z - this.pos.z) < 3.2 + HERO.radius) this.h.hurtHero(16, this.pos, 8);
    this.endAttack(this.leapKind === 'pounce' ? 0.15 : 0.25);
  }

  // ---------- огненное дыхание ----------
  private startBreath(rel: number): void {
    this.go('breath');
    this.breathCd = 6;
    // ведёт поток от дальней от героя стороны через героя
    this.sweepDir = rel >= 0 ? 1 : -1;
    this.sweep0 = this.yaw - this.sweepDir * 0.7;
    if (!this.quiet) bossSfx.inhale(0.9 / this.speedK);
  }

  private breathe(dt: number, S: number): void {
    const W = 0.9 / this.speedK, A = 1.6, fx = this.h.fx;
    if (S < W) {
      // вдох: на дыбы, горло разгорается, искры втягиваются в пасть
      const k = S / W;
      this.want = { ...REST, rear: 1, neck: 1.5, jaw: 0.5 + k * 0.4, spread: 0.7, dip: -0.4 };
      this.rig.throat.opacity = k;
      this.boost = 1 + k * 0.8;
      const m = this.mouthPos();
      if (Math.random() < 0.8) {
        const from = m.clone().add(new THREE.Vector3(rand(-2, 2), rand(-1.5, 1), rand(-2, 2)));
        fx.particle({ pos: from, vel: m.clone().sub(from).multiplyScalar(2.2), life: 0.45, size: 0.08, color: EMBER, gravity: 0 });
      }
      return;
    }
    if (S < W + A) {
      // поток: голова ведёт дугу ±40°, огонь летит из пасти, где лёг — горит пол
      const k = (S - W) / A;
      this.yaw = this.sweep0 + this.sweepDir * 1.4 * k;
      this.want = { ...REST, neck: 0.75, jaw: 1, spread: 0.7, dip: 0.45, low: 0.1 };
      this.rig.throat.opacity = 1;
      if (!this.hitDone) { this.hitDone = true; if (!this.quiet) bossSfx.breath(A); fx.light(this.mouthPos(), '#ff8030', 14, 12, A + 0.2); }
      const m = this.mouthPos(), dir = new THREE.Vector3(Math.sin(this.yaw), -0.2, Math.cos(this.yaw)).normalize();
      for (let i = 0; i < 6; i++) {
        const v = dir.clone().add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.08, 0.1), rand(-0.15, 0.15))).multiplyScalar(rand(8, 12));
        fx.particle({ pos: m.clone(), vel: v, life: rand(0.5, 0.8), size: rand(0.18, 0.4), color: Math.random() < 0.3 ? RASP : Math.random() < 0.6 ? FIRE : EMBER, gravity: -1, drag: 1.5 });
      }
      this.tickT -= dt;
      if (this.tickT <= 0) {
        this.tickT = 0.2;
        if (this.inCone(this.pos, this.yaw, 11.5, 0.24)) this.h.hurtHero(26 * 0.2, this.pos, 1.5);
        const d = rand(4.5, 10.5);
        this.addBurn(new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * d, 0, this.pos.z + Math.cos(this.yaw) * d), 3, 1);
      }
      return;
    }
    this.rig.throat.opacity = Math.max(0, this.rig.throat.opacity - dt * 2);
    this.boost = 1;
    this.want = { ...REST, neck: 0.8, jaw: 0.2 };
    if (Math.random() < 0.3) this.puff(0.2);
    if (S > W + A + 0.7) this.endAttack(0.7);
  }

  // ---------- Небесный молот ----------
  private startHammer(): void {
    this.go('hammer');
    this.hammerT = this.phase2 ? 10 : 13;
    this.farT = 0;
  }

  private hammer(dt: number, S: number): void {
    const fx = this.h.fx, hero = this.h.hero.pos;
    const CROUCH = 0.45, UP = 0.9, HOVER = 1.0, LOCK = 0.55, FALL = 0.42;
    const R = 4.5;
    if (S < CROUCH) {
      this.want = { ...REST, low: 0.6, spread: 1, neck: 0.7 };
      return;
    }
    if (S < CROUCH + UP) {
      // взлёт: мощные взмахи, пыль кольцом, тело уходит вверх за кадр
      if (!this.hitDone) {
        this.hitDone = true;
        if (!this.quiet) bossSfx.takeoff();
        fx.shock(this.pos.clone().setY(0.1), 5, C(1.2, 1.1, 0.9), 0.5, 0.2);
        fx.burst(this.pos.clone().setY(0.2), ['#9a8f70', '#6b5a4a', '#8a7a60'], 30, { speed: 6, up: 1.5, size: 0.16, life: 0.9, gravity: 3 });
        fx.shake = Math.max(fx.shake, 0.5);
      }
      const k = (S - CROUCH) / UP;
      this.flyY = FLY_Y * k * k;
      this.want = { ...REST, spread: 1, neck: 1.2, dip: -0.2 };
      this.aim.set(hero.x, 0, hero.z);
      return;
    }
    if (S < CROUCH + UP + HOVER + LOCK) {
      // тень: следит за героем, потом замирает и наливается красным; вой падения
      const t = S - CROUCH - UP;
      if (t < HOVER) this.aim.lerp(new THREE.Vector3(hero.x, 0, hero.z), Math.min(1, dt * 5));
      else if (this.hitDone) { this.hitDone = false; if (!this.quiet) bossSfx.fall(LOCK + FALL); }
      this.flyY = FLY_Y;
      this.pos.x = this.aim.x; this.pos.z = this.aim.z;
      const a = this.arena;
      this.aim.x = THREE.MathUtils.clamp(this.aim.x, a.x0 + 1.5, a.x1 - 1.5);
      this.aim.z = THREE.MathUtils.clamp(this.aim.z, a.z0 + 1.5, a.z1 - 1.5);
      const k = t / (HOVER + LOCK);
      this.shadow.visible = true;
      this.shadow.position.set(this.aim.x, 0.07, this.aim.z);
      this.shadow.scale.setScalar(R * (0.35 + 0.65 * k));
      this.shadow.material.opacity = 0.2 + k * 0.6 + (t > HOVER ? Math.sin(t * 40) * 0.1 : 0);
      this.want = { ...REST, spread: 0.2, neck: 0.3, dip: 0.8, low: 0.2 };
      return;
    }
    const t = S - CROUCH - UP - HOVER - LOCK;
    if (t < FALL) {
      // падение: крылья сложены, голова вниз, огненный след
      const k = t / FALL;
      this.flyY = FLY_Y * (1 - k * k);
      this.want = { ...REST, spread: 0, neck: 0.3, dip: 0.8, low: 0.3 };
      for (let i = 0; i < 4; i++) fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-1, 1), this.flyY + rand(0, 2), rand(-1, 1))), vel: new THREE.Vector3(0, rand(4, 8), 0), life: rand(0.3, 0.6), size: rand(0.2, 0.4), color: Math.random() < 0.5 ? FIRE : EMBER, gravity: -2 });
      return;
    }
    // удар: кратер, кольца, горящий пол — и оглушён
    this.flyY = 0;
    this.shadow.visible = false;
    const c = this.aim.clone();
    if (!this.quiet) bossSfx.slam();
    fx.shake = Math.max(fx.shake, 1.4);
    fx.hitstop = Math.max(fx.hitstop, 0.08);
    fx.screenFlash('#ff8040', 0.3, 0.2);
    fx.light(c.clone().setY(1.5), '#ff7030', 16, 14, 0.9);
    fx.shock(c.clone().setY(0.08), R * 1.25, FIRE, 0.5, 0.28);
    fx.shock(c.clone().setY(0.08), R * 0.8, EMBER, 0.4, 0.2);
    fx.burst(c.clone().setY(0.8), [FIRE, EMBER, RASP], 40, { speed: 12, up: 7, size: 0.1, life: 0.9, glow: true, gravity: 5 });
    fx.burst(c.clone().setY(0.3), ['#6b5040', '#8a6a50', '#5a5a5a', '#4a3a30'], 26, { speed: 7, up: 8, size: 0.24, life: 1.4, gravity: 14 });
    this.crater(c, R);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + rand(-0.2, 0.2), d = rand(1.6, R); this.addBurn(new THREE.Vector3(c.x + Math.cos(a) * d, 0, c.z + Math.sin(a) * d), 3.5, 1.1); }
    if (Math.hypot(hero.x - c.x, hero.z - c.z) < R + HERO.radius) this.h.hurtHero(34, c, 10);
    if (this.phase2) for (let i = 0; i < 3; i++) this.addMeteor(0.35 + i * 0.4);
    if (!this.quiet) bossSfx.daze();
    this.go('daze');
  }

  /** Кратер: кольцо камней выпирает из земли и медленно уходит обратно */
  private crater(c: THREE.Vector3, R: number): void {
    const mat = new THREE.MeshLambertMaterial({ color: '#5a4a3e' });
    const g = new THREE.Group();
    g.position.copy(c);
    const parts: THREE.Mesh[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, m = new THREE.Mesh(UNIT, mat), s = rand(0.35, 0.7);
      m.scale.set(s, s * rand(0.8, 1.5), s);
      m.position.set(Math.cos(a) * R * 0.75, 0, Math.sin(a) * R * 0.75);
      m.rotation.set(rand(-0.5, 0.5), a, rand(-0.5, 0.5));
      m.castShadow = true;
      g.add(m); parts.push(m);
    }
    this.h.fx.custom(g, 4, (t) => { for (const m of parts) m.position.y = (t < 0.05 ? t / 0.05 : 1 - Math.max(0, t - 0.6) / 0.4) * m.scale.y * 0.4 - 0.2; }, () => mat.dispose());
  }

  // ---------- горящий пол и малые метеоры ----------
  private addBurn(pos: THREE.Vector3, t: number, r: number): void {
    this.burns.push({ pos, t, r });
    this.h.fx.decal(pos.clone().setY(0.03), glowTex(), FIRE.clone().multiplyScalar(0.25), r * 2.4, t, true, 0.8);
  }

  private updateBurns(dt: number): void {
    const hero = this.h.hero.pos;
    let touching = false;
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i];
      b.t -= dt;
      if (b.t <= 0) { this.burns.splice(i, 1); continue; }
      if (Math.random() < 0.35 * Math.min(1, b.t)) this.h.fx.particle({ pos: b.pos.clone().add(new THREE.Vector3(rand(-b.r, b.r) * 0.6, 0.05, rand(-b.r, b.r) * 0.6)), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1, 2.2), rand(-0.2, 0.2)), life: rand(0.3, 0.6), size: rand(0.07, 0.14), color: Math.random() < 0.6 ? FIRE : RASP, gravity: -1.5 });
      if (Math.hypot(hero.x - b.pos.x, hero.z - b.pos.z) < b.r) touching = true;
    }
    // горящий пол: 10 урона в секунду, тиками по 0,25 с
    this.burnTick = touching ? this.burnTick - dt : 0;
    if (touching && this.burnTick <= 0) { this.burnTick = 0.25; this.h.hurtHero(2.5, this.h.hero.pos, 0); }
  }
  private burnTick = 0;

  private addMeteor(delay: number): void {
    const hero = this.h.hero.pos;
    const at = new THREE.Vector3(hero.x + rand(-2.5, 2.5), 0.07, hero.z + rand(-2.5, 2.5));
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.6, 32), glowMat(C(2, 0.3, 0.1), 0, true));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(at);
    this.h.scene.add(ring);
    this.meteors.push({ at, t: -delay, ring });
  }

  private updateMeteors(dt: number): void {
    const fx = this.h.fx;
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const mat = m.ring.material as THREE.MeshBasicMaterial;
      mat.opacity = m.t < 0 ? 0 : Math.min(1, m.t * 2) * (0.6 + Math.sin(m.t * 30) * 0.2);
      if (m.t > 0 && m.t < 0.8 && Math.random() < 0.7) fx.particle({ pos: m.at.clone().setY(12 - m.t * 14), vel: new THREE.Vector3(0, -14, 0), life: 0.2, size: 0.4, color: FIRE, gravity: 0 });
      if (m.t < 0.8) continue;
      this.h.scene.remove(m.ring);
      mat.dispose();
      this.meteors.splice(i, 1);
      if (!this.quiet) bossSfx.pebble();
      fx.shock(m.at, 1.8, FIRE, 0.35, 0.15);
      fx.burst(m.at.clone().setY(0.5), [FIRE, EMBER, RASP], 16, { speed: 5, up: 4, size: 0.08, life: 0.6, glow: true, gravity: 6 });
      fx.shake = Math.max(fx.shake, 0.35);
      this.addBurn(m.at.clone().setY(0), 2.5, 0.9);
      if (Math.hypot(this.h.hero.pos.x - m.at.x, this.h.hero.pos.z - m.at.z) < 1.6 + HERO.radius) this.h.hurtHero(14, m.at, 6);
    }
  }

  // ---------- смерть ----------
  private dying(dt: number, S: number): void {
    // заваливается набок, свет гаснет; на 2,2 с тело рассыпается малиновыми кубами, сердце лопается
    this.want = { ...REST, low: 1, neck: -0.5, jaw: 0.7, spread: 0.6, dip: 0.3 };
    this.rig.root.rotation.z = Math.min(1, S / 1.4) * 0.9;
    this.boost = Math.max(0.15, 1 - S / 2);
    if (S > 2.2 && this.deathT === 0) {
      this.deathT = 1;
      const fx = this.h.fx, c = this.heartPos();
      fx.screenFlash('#ffb0d0', 0.4, 0.3);
      fx.burst(c, [RASP, PINK, C(4, 3.4, 2)], 50, { speed: 7, up: 6, size: 0.12, life: 1.2, glow: true, gravity: 3 });
      fx.burst(this.pos.clone().setY(1.5), ['#6a1c20', '#33161a', '#a2452e', '#8a2a2c'], 60, { speed: 5, up: 5, size: 0.3, life: 1.6, gravity: 10 });
      fx.shock(this.pos.clone().setY(0.1), 6, RASP, 0.6, 0.2);
      this.onDeath?.(new THREE.Vector3(c.x, 0, c.z));
    }
    if (this.deathT > 0) {
      this.deathT += dt;
      const k = Math.max(0, 1 - (this.deathT - 1) / 0.6);
      this.rig.root.scale.setScalar(k);
      if (k <= 0) this.group.visible = false;
    }
  }

  // ---------- точки на теле ----------
  private world(o: THREE.Object3D): THREE.Vector3 { this.group.updateMatrixWorld(true); return o.getWorldPosition(new THREE.Vector3()); }
  mouthPos(): THREE.Vector3 { return this.world(this.rig.mouth); }
  headPos(): THREE.Vector3 { return this.world(this.rig.head); }
  heartPos(): THREE.Vector3 { return this.world(this.rig.heart); }
  private tailTip(): THREE.Vector3 { return this.world(this.rig.tail[this.rig.tail.length - 1]); }

  // ---------- поза → кости ----------
  private apply(dt: number, walk = 0): void {
    const t = this.time;
    this.tickLook(dt, this.boost * (this.phase2 ? 1.35 : 1) * (this.state === 'sleep' ? 0.6 + 0.2 * Math.sin(t * 1.3) : 1));
    this.group.position.set(this.pos.x, this.flyY, this.pos.z);
    this.rig.root.rotation.y = this.yaw;
    const flap = this.flyY > 0.3 || this.state === 'wake' || this.state === 'roar' ? this.rig.pose.spread : 0;
    this.rig.apply(this.want, dt > 0 ? Math.min(1, dt * 7) : 1, t, walk ? this.walkPhase : null, flap, this.state === 'sleep');
    // сердце бьётся: в оглушении — крупно и часто
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.45 : 1 + Math.max(0, Math.sin(t * 5)) * 0.12;
    this.rig.heart.scale.setScalar(beat * (this.heartOpen ? 1.4 : 1));
    // ярость: корона горит
    if (this.phase2 && this.state !== 'dead' && Math.random() < 0.4) {
      const hp = this.headPos();
      this.h.fx.particle({ pos: hp.add(new THREE.Vector3(rand(-0.25, 0.25), 0.7, rand(-0.25, 0.25))), vel: new THREE.Vector3(0, rand(0.8, 1.6), 0), life: rand(0.3, 0.5), size: rand(0.06, 0.12), color: Math.random() < 0.5 ? RASP : FIRE, gravity: -1 });
    }
  }
}
