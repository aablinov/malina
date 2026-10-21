import * as THREE from 'three';
import { raycastObstacles, type Obstacle } from './collision';
import { protects, type CoverPoint } from './cover';
import type { FirearmId } from './firearms';
import type { FX } from './fx';
import type { FireRequest, GunEvent, GunState, Rand, Shootable } from './gunplay';
import { emptyInput, Hero, type HeroInput, type HeroLook } from './hero';
import type { NavGrid } from './nav';
import type { Textures } from './textures';
import { GRENADE, JAILERS, type JailerKind, type JailerTuning } from './tuning';

/**
 * «Тюремщики» — бойцы ЧВК в чёрной форме, утащившие малину.
 * Тело — тот же Hero, что у игрока: та же стойка, магазины, перезарядка. ИИ управляет им через HeroInput,
 * как сетевой игрок.
 *
 * ИИ:
 * - стрелок (AR-15) выбирает укрытие, закрывающее от героя, прячется, выглядывает и бьёт очередями,
 *   перезаряжается в укрытии; за высоким укрытием выходит вбок, за низким — встаёт из приседа;
 * - двустволка перебегает ближе и врывается вплотную, вблизи — дуплет;
 * - огнемётчик медленно идёт напролом и жжёт; баллоны на спине взрываются от попаданий сзади и сбоку;
 * - целятся с ошибкой и задержкой реакции, по движущемуся герою мажут сильнее;
 * - разбуженный поднимает тревогу — просыпаются соседи.
 */

export type JailerState = 'ест малину' | 'тревога' | 'к укрытию' | 'прячется' | 'выглядывает' | 'сближается' | 'стреляет' | 'жжёт' | 'перезарядка' | 'бросает гранату' | 'бежит от гранаты' | 'убит';

export const JAILER_NAMES: Record<JailerKind, string> = { rifle: 'Стрелок', shotgun: 'Двустволка', flamer: 'Огнемётчик' };
const WEAPON: Record<JailerKind, FirearmId> = { rifle: 'ar15', shotgun: 'dbl', flamer: 'flamer' };

/** Чёрная форма ЧВК, балаклава, малиновая нашивка */
const PMC_LOOK: Partial<HeroLook> = {
  team: '#c4284f', shirt: '#2c2f36', pants: '#26282e', boot: '#141414', glove: '#111214', vest: '#1a1c21', pouch: '#363a42',
  helmet: '#1e2024', strap: '#0e0f11', pad: '#3a3e46', balaclava: true, eyes: [3.6, 0.25, 0.15],
};

export interface JailerContext {
  player: Hero;
  obstacles: readonly Obstacle[];
  nav: NavGrid;
  covers: readonly CoverPoint[];
  others: readonly Jailer[];
  /** Разбудить соседей */
  alert(from: Jailer): void;
  /** Живые гранаты на поле: от них убегают */
  dangers: readonly { pos: THREE.Vector3; fuse: number }[];
  /** Бросить гранату из руки в точку; fuse — остаток фитиля */
  throwGrenade(from: THREE.Vector3, target: THREE.Vector3, fuse: number, who: Jailer): void;
  /** Крикнуть (всплывающая надпись) */
  say(text: string, who: Jailer): void;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class Jailer implements Shootable {
  readonly hero: Hero;
  readonly kind: JailerKind;
  readonly T: JailerTuning;
  readonly name: string;
  readonly input: HeroInput = emptyInput();
  readonly spawn: THREE.Vector3;
  state: JailerState = 'ест малину';
  awake = false;
  /** Баллоны огнемётчика: Shootable со своей прочностью */
  readonly tanks: (Shootable & { hp: number; exploded: boolean }) | null = null;
  /** Баллоны только что взорвались — playground делает взрыв и сбрасывает флаг */
  blastPending = false;
  deadT = 0;

  private cover: CoverPoint | null = null;
  private coverT = 0;
  private path: THREE.Vector3[] = [];
  private repathT = 0;
  private phase: 'hide' | 'peek' = 'hide';
  private phaseT = 0;
  private seeT = 0;
  private burstT = 0;
  private holdT = 0;
  private aimOff = new THREE.Vector3();
  private aimOffT = 0;
  private lastSeen = new THREE.Vector3();
  private readonly peek = new THREE.Vector3();
  private blindT = 0;
  private alertT = -1;
  /** Гранаты: сколько осталось, пауза, план броска */
  grenadesLeft = 0;
  private grenadeCdT = 0.8;
  private grenadeCheckT = 0;
  private throwPlan: { t: number; releaseAt: number; target: THREE.Vector3 } | null = null;
  private stillT = 0;
  private readonly playerPrev = new THREE.Vector3();
  private strafeT = 0;
  private strafe = 1;
  private readonly tankMeshes: THREE.Mesh[] = [];
  private berry: THREE.Mesh | null = null;
  private idleT = 0;

  constructor(
    scene: THREE.Scene, T: Textures, fx: FX, kind: JailerKind, x: number, z: number, yaw: number,
    private readonly rand: Rand,
    onFire: (req: FireRequest, h: Hero) => void,
    onGunEvent: (ev: GunEvent, g: GunState, h: Hero) => void,
  ) {
    this.kind = kind;
    this.T = JAILERS[kind];
    this.name = JAILER_NAMES[kind];
    this.hero = new Hero(scene, T, fx, WEAPON[kind], rand, onFire, onGunEvent, { ...PMC_LOOK, backpack: kind !== 'flamer' });
    this.hero.maxHp = this.hero.hp = this.T.hp;
    this.hero.showStamina = false;
    this.hero.gunner.infinite = true;
    this.hero.place(x, z, yaw);
    this.grenadesLeft = this.T.grenades;
    this.spawn = new THREE.Vector3(x, 0, z);
    this.input.aim.set(x + Math.sin(yaw) * 5, 0, z + Math.cos(yaw) * 5);

    if (kind === 'flamer') {
      // два баллона со смесью на спине, жёлтые полосы опасности
      const red = new THREE.MeshLambertMaterial({ color: '#b3361f' });
      const band = new THREE.MeshLambertMaterial({ color: '#e3bd1c' });
      const dark = new THREE.MeshLambertMaterial({ color: '#1a1b1e' });
      for (const sx of [-0.11, 0.11]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.56, 0.19), red);
        t.position.set(sx, 0.02, -0.14);
        t.castShadow = true;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.2), band);
        b.position.y = 0.12;
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.07), dark);
        v.position.y = 0.32;
        t.add(b, v);
        this.hero.backMount.add(t);
        this.tankMeshes.push(t);
      }
      const self = this;
      const tanks = {
        hp: this.T.tankHp, exploded: false, radius: 0.24, shieldY: undefined as number | undefined,
        get pos() { return self.hero.pos.clone().add(new THREE.Vector3(-Math.sin(self.hero.upperYaw) * 0.42, 0, -Math.cos(self.hero.upperYaw) * 0.42)); },
        get alive() { return !tanks.exploded; },
        hit(dmg: number) {
          if (tanks.exploded) return;
          tanks.hp -= dmg;
          self.wake();
          for (const m of self.tankMeshes) (m.material as THREE.MeshLambertMaterial).emissive?.setRGB(0.6, 0.2, 0);
          if (tanks.hp <= 0) {
            tanks.exploded = true;
            self.blastPending = true;
            for (const m of self.tankMeshes) m.visible = false;
          }
        },
      };
      this.tanks = tanks;
    }

    // спящий тюремщик ест малину: ягода в левой руке
    this.berry = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: '#c4284f', emissive: '#ff2a55', emissiveIntensity: 0.6 }));
    scene.add(this.berry);
  }

  // ---------- как цель ----------
  get pos(): THREE.Vector3 { return this.hero.pos; }
  readonly radius = 0.4;
  get alive(): boolean { return !this.hero.down; }
  get shieldY(): number | undefined { return this.hero.crouched ? 0.8 : undefined; }

  hit(dmg: number): void {
    if (this.hero.down) return;
    this.hero.hurt(dmg);
    this.wake();
    // под огнём — бегом к укрытию
    this.coverT = 0;
    if (this.phase === 'peek' && this.kind === 'rifle' && this.rand() < 0.5) { this.phase = 'hide'; this.phaseT = this.T.hideTime; }
  }

  /** Пуля прошла рядом — пригнуться / сменить позицию */
  suppress(): void {
    if (!this.awake) { this.wake(); return; }
    if (this.kind === 'rifle' && this.phase === 'peek' && this.rand() < 0.35) { this.phase = 'hide'; this.phaseT = this.T.hideTime * 0.7; }
  }

  wake(): void {
    if (this.awake || this.hero.down) return;
    this.awake = true;
    this.state = 'тревога';
    this.alertT = 0.5;
    if (this.berry) this.berry.visible = false;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.hero.object);
    this.hero.object.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    if (this.berry) scene.remove(this.berry);
  }

  // ---------- ИИ ----------

  update(dt: number, ctx: JailerContext): void {
    const I = this.input;
    I.fire = false; I.run = false; I.aimDown = false; I.crouch = false; I.roll = false; I.reload = false; I.slot = null;
    I.move.set(0, 0);
    const H = this.hero;

    if (H.down) {
      this.state = 'убит';
      this.deadT += dt;
      H.update(dt, I, ctx.obstacles);
      return;
    }
    if (!this.awake) {
      this.state = 'ест малину';
      this.idleT += dt;
      H.update(dt, I, ctx.obstacles);
      if (this.berry) {
        // подносит ягоду ко рту
        const k = (Math.sin(this.idleT * 1.6) + 1) / 2;
        const side = new THREE.Vector3(Math.cos(H.upperYaw), 0, -Math.sin(H.upperYaw));
        this.berry.position.copy(H.pos).addScaledVector(side, 0.32).add(new THREE.Vector3(Math.sin(H.upperYaw) * 0.3, 1.2 + k * 0.35, Math.cos(H.upperYaw) * 0.3));
        this.berry.rotation.y += dt * 2;
      }
      return;
    }
    if (this.alertT >= 0) {
      this.alertT -= dt;
      if (this.alertT < 0) ctx.alert(this);
    }

    const P = ctx.player;
    const toP = new THREE.Vector3(P.pos.x - H.pos.x, 0, P.pos.z - H.pos.z);
    const dist = toP.length();
    const los = this.lineOfSight(ctx, H.pos, P);
    if (los && !P.down) { this.seeT += dt; this.lastSeen.copy(P.pos); } else this.seeT = 0;
    const canShoot = los && this.seeT >= this.T.reaction && !P.down;

    // точка прицела: с упреждением и ошибкой, которая обновляется несколько раз в секунду
    this.aimOffT -= dt;
    if (this.aimOffT <= 0) {
      this.aimOffT = 0.25 + this.rand() * 0.15;
      const moving = Math.hypot(P.vel.x, P.vel.z) > 1 ? 1.6 : 1;
      const crouch = P.crouched ? 0.8 : 1;
      const sigma = Math.tan(THREE.MathUtils.degToRad(this.T.aimErr * moving * crouch)) * Math.max(dist, 2);
      const g = () => (this.rand() + this.rand() + this.rand() - 1.5) * 1.15;
      this.aimOff.set(g() * sigma, 0, g() * sigma);
    }
    const aimAt = (los ? P.pos : this.lastSeen).clone().addScaledVector(P.vel, los ? 0.12 : 0).add(this.aimOff);

    const gun = H.gun;
    const lowAmmo = gun.rounds <= Math.max(1, gun.capacity * 0.3);

    // герой долго стоит на месте (засел за укрытием) — повод для гранаты
    if (P.pos.distanceTo(this.playerPrev) < 1.2) this.stillT += dt; else { this.stillT = 0; this.playerPrev.copy(P.pos); }

    // граната рядом — бежать, всё остальное потом
    if (this.fleeGrenade(dt, ctx)) { H.update(dt, I, ctx.obstacles); return; }

    // бросок уже идёт: стоит, смотрит в цель, в нужный момент отпускает
    if (this.throwPlan) {
      const tp = this.throwPlan;
      tp.t += dt;
      this.state = 'бросает гранату';
      I.aim.copy(tp.target);
      if (tp.t >= tp.releaseAt) {
        ctx.throwGrenade(H.handWorld(), tp.target, GRENADE.fuse - tp.releaseAt, this);
        this.throwPlan = null;
      }
      H.update(dt, I, ctx.obstacles);
      return;
    }
    if (this.wantGrenade(dt, ctx, dist, los)) { H.update(dt, I, ctx.obstacles); return; }

    if (this.kind === 'rifle') this.rifle(dt, ctx, dist, los, canShoot, aimAt, lowAmmo);
    else if (this.kind === 'shotgun') this.shotgun(dt, ctx, dist, los, canShoot, aimAt);
    else this.flamer(dt, ctx, dist, los, canShoot, aimAt);

    if (gun.reload) this.state = 'перезарядка';
    H.update(dt, I, ctx.obstacles);
  }

  private lineOfSight(ctx: JailerContext, from: THREE.Vector3, P: Hero): boolean {
    const dx = P.pos.x - from.x, dz = P.pos.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return true;
    const y = P.crouched ? 1.1 : 1.5;
    return !raycastObstacles(from.x, from.z, dx / d, dz / d, d, y, ctx.obstacles);
  }

  /** Стрелок: укрытие → прячется → выглядывает очередями */
  private rifle(dt: number, ctx: JailerContext, dist: number, _los: boolean, canShoot: boolean, aimAt: THREE.Vector3, lowAmmo: boolean): void {
    const H = this.hero, I = this.input, P = ctx.player;
    this.coverT -= dt;
    if (!this.cover || this.coverT <= 0 || !protects(this.cover, P.pos)) {
      this.cover = this.pickCover(ctx, this.T.preferMin, this.T.preferMax);
      this.coverT = 2.5 + this.rand();
      this.phase = 'hide';
      this.phaseT = this.T.hideTime * 0.5;
    }
    I.aim.copy(aimAt);
    const c = this.cover;
    if (!c) {
      // укрытия нет: держит дистанцию, смещается вбок и стреляет
      this.state = canShoot ? 'стреляет' : 'сближается';
      const want = dist > this.T.preferMax ? 1 : dist < this.T.preferMin ? -1 : 0;
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 1 + this.rand() * 1.5; this.strafe = -this.strafe; }
      const fwd = new THREE.Vector3(P.pos.x - H.pos.x, 0, P.pos.z - H.pos.z).normalize();
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(this.strafe * 0.6);
      const goal = H.pos.clone().addScaledVector(fwd, want * 3).addScaledVector(side, 2);
      this.walkTo(dt, ctx, goal, false);
      if (canShoot) this.burst(dt, true);
      return;
    }

    const toCover = Math.hypot(c.pos.x - H.pos.x, c.pos.z - H.pos.z);
    if (toCover > 0.6 && this.phase === 'hide') {
      this.state = 'к укрытию';
      const run = toCover > 4 && !canShoot;
      this.walkTo(dt, ctx, c.pos, run);
      this.wantCrouch(false);
      if (canShoot && toCover < 6) this.burst(dt, false);
      // не видит героя — смотрит по ходу
      if (!canShoot && I.move.lengthSq() > 0.01) I.aim.copy(H.pos).add(new THREE.Vector3(I.move.x, 0, I.move.y).multiplyScalar(4));
      return;
    }

    this.phaseT -= dt;
    const low = c.h < 1.5;
    if (this.phase === 'hide') {
      this.state = 'прячется';
      this.wantCrouch(low);
      if (!low) this.walkTo(dt, ctx, c.pos, false);
      if (lowAmmo && !H.gun.reload) I.reload = true;
      if (this.phaseT <= 0 && !H.gun.reload) {
        this.phase = 'peek';
        this.phaseT = this.T.peekTime * (0.8 + this.rand() * 0.4);
        // откуда выглядывать; если неоткуда — сменить укрытие
        const pk = this.peekPoint(ctx, c);
        if (pk) this.peek.copy(pk); else this.coverT = 0;
      }
    } else {
      this.state = canShoot ? 'стреляет' : 'выглядывает';
      this.wantCrouch(false);
      if (!low) this.walkTo(dt, ctx, this.peek, false);
      // выглянул, а героя не видно — укрытие больше не годится
      if (!canShoot) { this.blindT += dt; if (this.blindT > 1.2) { this.coverT = 0; this.blindT = 0; } } else this.blindT = 0;
      I.aimDown = canShoot;
      if (canShoot) this.burst(dt, true);
      if (this.phaseT <= 0 || (lowAmmo && !canShoot)) { this.phase = 'hide'; this.phaseT = this.T.hideTime * (0.8 + this.rand() * 0.5); }
    }
  }

  /** Двустволка: перебежками ближе, вплотную — дуплет */
  private shotgun(dt: number, ctx: JailerContext, dist: number, los: boolean, canShoot: boolean, aimAt: THREE.Vector3): void {
    const H = this.hero, I = this.input, P = ctx.player;
    I.aim.copy(aimAt);
    this.wantCrouch(false);
    if (H.gun.reload) {
      // перезаряжается — отходит вбок, к укрытию, если есть рядом
      this.state = 'перезарядка';
      const c = this.pickCover(ctx, 3, 10, 6);
      if (c) this.walkTo(dt, ctx, c.pos, false);
      return;
    }
    if (dist > this.T.preferMax || !los) {
      this.state = 'сближается';
      // бежит, если герой его не видит или далеко
      this.walkTo(dt, ctx, P.pos, !canShoot || dist > 9);
      return;
    }
    this.state = 'стреляет';
    if (dist > 3) this.walkTo(dt, ctx, P.pos, false);
    if (!canShoot) return;
    // вплотную — держит спуск для дуплета, дальше — одиночный
    this.holdT -= dt;
    if (dist < 3.8) {
      I.fire = this.holdT > -0.4;
      if (this.holdT < -0.9) this.holdT = 0.4;
    } else {
      this.burstT -= dt;
      if (this.burstT <= 0) { I.fire = true; this.burstT = 0.45 + this.rand() * 0.3; }
    }
  }

  /** Огнемётчик: идёт напролом и жжёт */
  private flamer(dt: number, ctx: JailerContext, dist: number, los: boolean, canShoot: boolean, aimAt: THREE.Vector3): void {
    const I = this.input, P = ctx.player;
    I.aim.copy(aimAt);
    this.wantCrouch(false);
    if (dist > 2.6 || !los) this.walkTo(dt, ctx, P.pos, false);
    if (canShoot && dist < this.hero.gun.def.t.range - 0.3) { I.fire = true; this.state = 'жжёт'; }
    else this.state = 'сближается';
  }

  /** Очереди: burst выстрелов, потом пауза */
  private burst(dt: number, still: boolean): void {
    const I = this.input;
    this.burstT -= dt;
    if (this.burstT > 0) return;
    I.fire = true;
    const g = this.hero.gun;
    this.holdT += dt;
    if (this.holdT >= this.T.burst / g.def.t.rate) {
      this.holdT = 0;
      this.burstT = this.T.burstPause * (still ? 1 : 1.5) * (0.7 + this.rand() * 0.6);
      I.fire = false;
    }
  }

  private wantCrouch(on: boolean): void { if (this.hero.crouched !== on) this.input.crouch = true; }

  /** Идти к точке по навигационной сетке */
  private walkTo(dt: number, ctx: JailerContext, goal: THREE.Vector3, run: boolean): void {
    const H = this.hero, I = this.input;
    this.repathT -= dt;
    if (ctx.nav.clearLine(H.pos.x, H.pos.z, goal.x, goal.z)) this.path = [goal.clone()];
    else if (this.repathT <= 0 || !this.path.length) { this.path = ctx.nav.path(H.pos, goal); this.repathT = 0.4; }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - H.pos.x, this.path[0].z - H.pos.z) < 0.5) this.path.shift();
    const wp = this.path[0];
    if (!wp) return;
    const dx = wp.x - H.pos.x, dz = wp.z - H.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) return;
    const k = Math.min(1, d / 0.6);
    I.move.set((dx / d) * k, (dz / d) * k);
    // не толпиться
    for (const o of ctx.others) {
      if (o === this || o.hero.down) continue;
      const ox = H.pos.x - o.hero.pos.x, oz = H.pos.z - o.hero.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 1.1 && od > 1e-3) { I.move.x += (ox / od) * 0.6; I.move.y += (oz / od) * 0.6; }
    }
    if (I.move.lengthSq() > 1) I.move.normalize();
    I.run = run && !I.fire;
  }

  /** Лучшее укрытие от героя в нужной дистанции; занятые другими — хуже */
  private pickCover(ctx: JailerContext, min: number, max: number, near = 14): CoverPoint | null {
    const H = this.hero, P = ctx.player.pos;
    let best: CoverPoint | null = null, bestS = -Infinity;
    const mid = (min + max) / 2;
    for (const c of ctx.covers) {
      const dSelf = c.pos.distanceTo(H.pos);
      if (dSelf > near) continue;
      if (!protects(c, P)) continue;
      const dP = c.pos.distanceTo(P);
      if (dP < min * 0.7) continue;
      // из укрытия должно быть откуда стрелять: над низким — встав, у высокого — шагнув вбок
      if (this.kind === 'rifle' && !this.peekPoint(ctx, c)) continue;
      let s = -dSelf * 0.8 - Math.abs(dP - mid) * 0.5 + (c.h < 1.5 ? 1.2 : 0) + this.rand() * 0.5;
      for (const o of ctx.others) if (o !== this && !o.hero.down && o.cover && o.cover.pos.distanceTo(c.pos) < 1.4) s -= 8;
      if (s > bestS) { bestS = s; best = c; }
    }
    return best;
  }

  /** Точка, откуда из этого укрытия видно героя; null — неоткуда */
  private peekPoint(ctx: JailerContext, c: CoverPoint): THREE.Vector3 | null {
    const P = ctx.player;
    const from = (p: THREE.Vector3, y: number) => {
      const dx = P.pos.x - p.x, dz = P.pos.z - p.z, d = Math.hypot(dx, dz);
      return d > 0 && !raycastObstacles(p.x, p.z, dx / d, dz / d, d, y, ctx.obstacles);
    };
    if (c.h < 1.5) return from(c.pos, 1.5) ? c.pos : null;
    const fx = P.pos.x - c.pos.x, fz = P.pos.z - c.pos.z;
    const d = Math.hypot(fx, fz) || 1;
    const lat = new THREE.Vector3(fz / d, 0, -fx / d);
    for (const k of [1.0, -1.0, 1.6, -1.6]) {
      const p = c.pos.clone().addScaledVector(lat, k);
      if (ctx.nav.walkable(p.x, p.z) && ctx.nav.clearLine(c.pos.x, c.pos.z, p.x, p.z) && from(p, 1.5)) return p;
    }
    return null;
  }

  /** Убегает от гранаты, если стоит в её радиусе */
  private fleeGrenade(dt: number, ctx: JailerContext): boolean {
    const H = this.hero;
    let worst: { pos: THREE.Vector3; fuse: number } | null = null;
    for (const g of ctx.dangers) {
      if (g.pos.y > 1.6 || g.fuse > 2.8) continue;
      if (Math.hypot(g.pos.x - H.pos.x, g.pos.z - H.pos.z) < GRENADE.radius + 0.8 && (!worst || g.fuse < worst.fuse)) worst = g;
    }
    if (!worst) return false;
    this.state = 'бежит от гранаты';
    this.throwPlan = null;
    const away = new THREE.Vector3(H.pos.x - worst.pos.x, 0, H.pos.z - worst.pos.z);
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
    away.normalize();
    const goal = ctx.nav.nearestFree(H.pos.x + away.x * 6, H.pos.z + away.z * 6);
    this.wantCrouch(false);
    this.walkTo(dt, ctx, goal, true);
    this.input.aim.copy(goal);
    return true;
  }

  /**
   * Решить, бросать ли гранату: есть гранаты, пауза прошла, герой на нужной дистанции
   * и засел — за укрытием (не видно), присел или долго стоит на месте.
   */
  private wantGrenade(dt: number, ctx: JailerContext, dist: number, los: boolean): boolean {
    const H = this.hero, P = ctx.player, T = this.T;
    this.grenadeCdT -= dt;
    this.grenadeCheckT -= dt;
    if (this.grenadesLeft <= 0 || this.grenadeCdT > 0 || this.grenadeCheckT > 0 || H.gun.reload || P.down) return false;
    this.grenadeCheckT = 0.5;
    if (dist < T.grenadeMin || dist > Math.min(T.grenadeMax, GRENADE.range)) return false;
    const dug = !los || P.crouched || this.stillT > 1.2;
    if (!dug || this.rand() > 0.6) return false;
    const target = (los ? P.pos.clone().addScaledVector(P.vel, 0.5) : this.lastSeen.clone());
    // бросает не идеально: разброс растёт с дальностью
    const spread = 0.35 + dist * 0.07;
    target.x += (this.rand() - 0.5) * 2 * spread;
    target.z += (this.rand() - 0.5) * 2 * spread;
    // высокая стена прямо перед лицом — граната отскочит в своих
    const dx = target.x - H.pos.x, dz = target.z - H.pos.z, d = Math.hypot(dx, dz) || 1;
    if (raycastObstacles(H.pos.x, H.pos.z, dx / d, dz / d, Math.min(d, 2.5), 2.2, ctx.obstacles)) return false;
    // свои в радиусе цели — не бросает
    for (const o of ctx.others) if (o !== this && !o.hero.down && o.pos.distanceTo(target) < GRENADE.radius + 0.5) return false;
    this.grenadesLeft--;
    this.grenadeCdT = T.grenadeCd;
    const releaseAt = H.throwGesture(T.cook);
    this.throwPlan = { t: 0, releaseAt, target };
    this.state = 'бросает гранату';
    this.input.aim.copy(target);
    this.wantCrouch(false);
    ctx.say('Граната!', this);
    return true;
  }

  /** Пройти ли дальше: тело убрано */
  get removable(): boolean { return this.hero.down && this.deadT > 6; }
}

/** Свободная от бликов функция: угол между направлением ствола и целью */
export function angleTo(from: THREE.Vector3, yaw: number, to: THREE.Vector3): number {
  return Math.abs(wrap(Math.atan2(to.x - from.x, to.z - from.z) - yaw));
}
