import * as THREE from 'three';
import { resolveCircle, type Obstacle } from './collision';
import { buildFirearm, buildMagazine, buildShell, type FirearmId, type GunRig } from './firearms';
import type { FX } from './fx';
import { Gunner, RELOAD_MARKS, type FireRequest, type GunEvent, type GunState, type Rand } from './gunplay';
import { pixelTex, type Textures } from './textures';
import { HERO, SPREAD, WEIGHT_MUL } from './tuning';

/**
 * Боец отряда: блочная модель с суставами (ADR-003), тактическое передвижение и стойка (ADR-002, раздел 10).
 * Симуляция (update) не зависит от рендера и читает только HeroInput — под будущую сеть.
 * Анимация процедурная: руки и ноги ставятся двухзвенной IK.
 */

export interface HeroInput {
  /** Направление движения в мире (x, z), длина 0..1 */
  move: THREE.Vector2;
  /** Точка прицела на земле */
  aim: THREE.Vector3;
  run: boolean;
  /** ПКМ: прицеливание */
  aimDown: boolean;
  fire: boolean;
  /** Нажатия (true один кадр) */
  crouch: boolean;
  roll: boolean;
  reload: boolean;
  slot: 'primary' | 'pistol' | null;
}

export function emptyInput(): HeroInput {
  return { move: new THREE.Vector2(), aim: new THREE.Vector3(0, 0, 5), run: false, aimDown: false, fire: false, crouch: false, roll: false, reload: false, slot: null };
}

export type MoveState = 'стоит' | 'ходьба' | 'бег' | 'прицел' | 'присед' | 'присед + прицел' | 'перекат' | 'без сознания';

// ---------- размеры модели, м ----------
const HIP_W = 0.12;
const THIGH = 0.4;
const SHIN = 0.38;
const ANKLE = 0.1;
const HIP_Y = ANKLE + THIGH + SHIN; // 0,88 — таз при прямых ногах
const SHOULDER = new THREE.Vector3(0.29, 0.3, 0);
const UPPER_ARM = 0.33;
const FOREARM = 0.31;
const HAND = 0.055;
const GUN_SCALE = 0.85;
/** Блейдинг: левое плечо вперёд, рад */
const BLADE = -0.38;
/** Высота головы стоя и в приседе — для попаданий плевков */
export const HEAD_TOP = { stand: 1.95, crouch: 1.45 };

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (k: number, dt: number): number => 1 - Math.exp(-k * dt);
const smooth = (t: number): number => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const seg = (k: number, a: number, b: number): number => smooth((k - a) / Math.max(1e-4, b - a));
const deg = THREE.MathUtils.degToRad;

function box(w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Двухзвенная IK: вернуть локоть (колено) для плеча s, цели t и подсказки направления pole */
function solveIK(s: THREE.Vector3, t: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, outElbow: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(t, s);
  let d = dir.length();
  if (d < 1e-5) { dir.set(0, -1, 0); d = 1e-5; } else dir.divideScalar(d);
  d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(dir, -dir.z);
  p.normalize();
  outElbow.copy(s).addScaledVector(dir, cosA * a).addScaledVector(p, sinA * a);
}

const DOWN = new THREE.Vector3(0, -1, 0);
/** Повернуть сегмент (ось −Y) из точки from в точку to */
function aimSegment(o: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  o.position.copy(from);
  const d = new THREE.Vector3().subVectors(to, from);
  if (d.lengthSq() < 1e-10) return;
  o.quaternion.setFromUnitVectors(DOWN, d.normalize());
}

interface Limb { upper: THREE.Group; lower: THREE.Group; end: THREE.Group }

/** Поза оружия в «верхней» системе (центр груди, повёрнута к прицелу): позиция и углы */
interface GunPose { p: THREE.Vector3; yaw: number; pitch: number; roll: number }
const pose = (x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): GunPose => ({ p: new THREE.Vector3(x, y, z), yaw, pitch, roll });
const POSES = {
  rifle: {
    ready: pose(-0.1, 0.25, 0.4), ads: pose(-0.06, 0.33, 0.38), low: pose(-0.02, 0.04, 0.34, 0.75, 0.5, -0.2),
    reload: pose(-0.05, 0.14, 0.36, 0.3, -0.12, -0.55), break: pose(-0.05, 0.16, 0.34, 0.35, -0.08, -0.15),
  },
  pistol: {
    ready: pose(-0.03, 0.26, 0.6), ads: pose(0, 0.34, 0.62), low: pose(-0.08, 0.06, 0.3, 0.2, 0.9, 0),
    reload: pose(-0.03, 0.17, 0.38, 0.2, -0.35, -0.3), break: pose(-0.03, 0.17, 0.38),
  },
};

export class Hero {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  hp: number = HERO.hp;
  stamina: number = HERO.stamina;
  down = false;
  god = false;
  crouched = false;
  aiming = false;
  running = false;
  /** Фактическая скорость по перемещению, м/с (для телеметрии) */
  speed = 0;
  /** Куда смотрят корпус и ствол / куда идут ноги, рад */
  upperYaw = 0;
  legYaw = 0;
  readonly gunner: Gunner;
  /** Касается стены в этом кадре */
  touching = false;

  private rollT = 0;
  private readonly rollDir = new THREE.Vector3();
  private staminaIdle = 99;
  private exhaustT = 0;
  private hurtT = 0;
  private downT = 0;

  // анимация
  private phase = 0;
  private gaitW = 0;
  private readonly moveDir = new THREE.Vector3(0, 0, 1);
  private aimK = 0;
  private runK = 0;
  private crouchK = 0;
  private kick = 0;
  private boltT = 1;
  private shoulderKick = 0;
  private equipK = 1;

  // модель
  private readonly root = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly chest = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: Limb[];
  private readonly arms: Limb[];
  private readonly gunMount = new THREE.Group();
  private rig: GunRig;
  private readonly rigs = new Map<FirearmId, GunRig>();
  /** Магазин или патроны в левой руке во время перезарядки */
  private readonly handMag = new THREE.Group();
  private readonly stamRing: THREE.Mesh;
  private readonly stamMat: THREE.MeshBasicMaterial;
  private readonly vestMats: THREE.Material[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    T: Textures,
    private readonly fx: FX,
    primary: FirearmId,
    rand: Rand,
    onFire: (req: FireRequest, hero: Hero) => void,
    private readonly onGunEvent: (ev: GunEvent, gun: GunState, hero: Hero) => void = () => {},
    teamColor = '#c4284f',
  ) {
    this.gunner = new Gunner(primary, rand, (ev, g) => this.gunEvent(ev, g), (req) => onFire(req, this));

    const lam = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
    const M = {
      skin: lam({ map: pixelTex('#d9a07a', 6, 30) }),
      face: lam({ map: T.face }),
      shirt: lam({ map: pixelTex('#6f7a52', 7, 31) }),
      pants: lam({ map: pixelTex('#4d523c', 6, 32) }),
      boot: lam({ map: pixelTex('#3a2b1e', 5, 33) }),
      glove: lam({ map: pixelTex('#2b2b2b', 5, 34) }),
      vest: lam({ map: pixelTex('#5b6b3a', 8, 35) }),
      pouch: lam({ map: pixelTex('#4a5730', 6, 36) }),
      helmet: lam({ map: pixelTex('#56653a', 7, 37) }),
      strap: lam({ color: '#2f3524' }),
      team: lam({ color: teamColor, emissive: teamColor, emissiveIntensity: 0.15 }),
      pad: lam({ map: pixelTex('#3c432c', 6, 38) }),
    };
    this.vestMats.push(M.vest, M.pouch);
    scene.add(this.root);
    this.root.add(this.hips);

    // таз и пояс
    this.hips.add(box(0.44, 0.18, 0.28, M.pants, 0, 0.0, 0));
    this.hips.add(box(0.46, 0.06, 0.3, M.strap, 0, 0.07, 0));
    this.hips.add(box(0.1, 0.12, 0.08, M.pouch, 0.17, 0.0, 0.14)); // подсумок на поясе
    this.hips.add(this.spine);
    this.spine.position.y = 0.08;
    this.spine.rotation.order = 'YXZ';
    this.spine.add(box(0.4, 0.26, 0.24, M.shirt, 0, 0.12, 0));
    this.spine.add(this.chest);
    this.chest.position.y = 0.24;
    this.chest.rotation.order = 'YXZ';

    // грудь, бронежилет, подсумки, нашивка цвета отряда
    this.chest.add(box(0.5, 0.36, 0.28, M.shirt, 0, 0.18, 0));
    this.chest.add(box(0.54, 0.34, 0.34, M.vest, 0, 0.15, 0));
    for (const x of [-0.14, 0, 0.14]) this.chest.add(box(0.11, 0.13, 0.07, M.pouch, x, 0.05, 0.2));
    this.chest.add(box(0.12, 0.07, 0.02, M.team, 0.14, 0.26, 0.175));
    this.chest.add(box(0.4, 0.3, 0.12, M.pouch, 0, 0.16, -0.22)); // рюкзачок
    this.chest.add(box(0.14, 0.06, 0.36, M.strap, -0.2, 0.33, 0), box(0.14, 0.06, 0.36, M.strap, 0.2, 0.33, 0));

    // голова в каске
    this.head.position.set(0, 0.36, 0.01);
    this.head.rotation.order = 'YXZ';
    this.chest.add(this.head);
    const headMats = [M.skin, M.skin, M.skin, M.skin, M.face, M.skin];
    this.head.add(box(0.44, 0.44, 0.44, headMats, 0, 0.23, 0));
    this.head.add(box(0.5, 0.2, 0.5, M.helmet, 0, 0.45, -0.01));
    this.head.add(box(0.54, 0.05, 0.54, M.helmet, 0, 0.36, 0));
    this.head.add(box(0.5, 0.14, 0.06, M.helmet, 0, 0.3, -0.25)); // затылок

    // руки: плечо, предплечье, кисть — соседние группы на груди, ставятся IK
    const mkArm = (): Limb => {
      const upper = new THREE.Group(), lower = new THREE.Group(), end = new THREE.Group();
      upper.add(box(0.17, UPPER_ARM, 0.17, M.shirt, 0, -UPPER_ARM / 2, 0));
      upper.add(box(0.19, 0.12, 0.19, M.pad, 0, -0.04, 0)); // наплечник
      lower.add(box(0.15, FOREARM, 0.15, M.shirt, 0, -FOREARM / 2, 0));
      end.add(box(0.12, 0.13, 0.12, M.glove, 0, 0, 0));
      this.chest.add(upper, lower, end);
      return { upper, lower, end };
    };
    this.arms = [mkArm(), mkArm()]; // 0 — левая (+X), 1 — правая (−X)
    this.arms[0].end.add(this.handMag);

    // ноги — в системе корня, ставятся IK
    const mkLeg = (): Limb => {
      const upper = new THREE.Group(), lower = new THREE.Group(), end = new THREE.Group();
      upper.add(box(0.19, THIGH, 0.21, M.pants, 0, -THIGH / 2, 0));
      lower.add(box(0.17, SHIN, 0.19, M.pants, 0, -SHIN / 2, 0));
      lower.add(box(0.19, 0.12, 0.08, M.pad, 0, -0.02, 0.08)); // наколенник
      end.add(box(0.2, ANKLE, 0.3, M.boot, 0, -ANKLE / 2, 0.04));
      this.root.add(upper, lower, end);
      return { upper, lower, end };
    };
    this.legs = [mkLeg(), mkLeg()];

    // оружие
    this.root.add(this.gunMount);
    this.gunMount.rotation.order = 'YXZ';
    this.rig = this.rigFor(primary);

    // дуга выносливости на земле
    this.stamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 0.4), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.stamRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 48, 1, 0, Math.PI * 2), this.stamMat);
    this.stamRing.rotation.x = -Math.PI / 2;
    this.stamRing.position.y = 0.03;
    this.root.add(this.stamRing);

    this.showGun();
  }

  // ---------- состояние ----------

  get gun(): GunState { return this.gunner.gun; }
  get rolling(): boolean { return this.rollT > 0; }
  get exhausted(): boolean { return this.exhaustT > 0; }
  /** Неуязвим (начало переката или бессмертие) */
  get invulnerable(): boolean { return this.god || (this.rolling && HERO.rollTime - this.rollT < HERO.rollIframes); }
  /** Верх головы: плевки ниже этой высоты попадают */
  get headTop(): number { return THREE.MathUtils.lerp(HEAD_TOP.stand, HEAD_TOP.crouch, this.crouchK); }

  get state(): MoveState {
    if (this.down) return 'без сознания';
    if (this.rolling) return 'перекат';
    if (this.running) return 'бег';
    if (this.crouched) return this.aiming ? 'присед + прицел' : 'присед';
    if (this.aiming) return 'прицел';
    return this.speed > 0.3 ? 'ходьба' : 'стоит';
  }

  /** Множитель разброса от стойки и движения */
  get spreadMul(): number {
    let m = 1;
    if (this.aiming) m *= SPREAD.aim;
    if (this.crouched) m *= SPREAD.crouch;
    const mv = THREE.MathUtils.clamp(this.speed / Math.max(0.1, HERO.walk), 0, 1);
    m *= 1 + (SPREAD.move - 1) * mv;
    return m;
  }

  /** Точка дула в мире */
  muzzle(out = new THREE.Vector3()): THREE.Vector3 { return this.rig.muzzle.getWorldPosition(out); }

  hurt(d: number): boolean {
    if (this.down || this.invulnerable) return false;
    this.hp = Math.max(0, this.hp - d);
    this.hurtT = 0.2;
    if (this.hp <= 0) { this.down = true; this.downT = 0; this.gunner.gun.cancelReload(); }
    return true;
  }

  revive(): void { this.down = false; this.hp = HERO.hp; }

  place(x: number, z: number, yaw = 0): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.upperYaw = this.legYaw = yaw;
  }

  setPrimary(id: FirearmId): void {
    this.gunner.setPrimary(id, HERO.switchTime);
    if (this.gunner.active === 'primary') this.showGun();
  }

  // ---------- симуляция ----------

  update(dt: number, input: HeroInput, obstacles: readonly Obstacle[]): void {
    const H = HERO;
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.down) {
      this.downT += dt;
      this.vel.set(0, 0, 0);
      this.speed = 0;
      this.running = this.aiming = false;
      this.animate(dt);
      return;
    }

    // выносливость
    this.exhaustT = Math.max(0, this.exhaustT - dt);
    this.staminaIdle += dt;

    const mv = new THREE.Vector3(input.move.x, 0, input.move.y);
    const moving = mv.lengthSq() > 0.01;
    if (moving && mv.lengthSq() > 1) mv.normalize();
    const moveDir = moving ? mv.clone().normalize() : null;

    if (input.crouch && !this.rolling) this.crouched = !this.crouched;

    // перекат
    if (input.roll && !this.rolling && !this.exhausted && this.stamina > 0) {
      this.rollDir.copy(moveDir ?? new THREE.Vector3(Math.sin(this.legYaw), 0, Math.cos(this.legYaw)));
      this.rollT = H.rollTime;
      this.spendStamina(H.rollCost);
      if (this.gun.cancelReload()) this.gunEvent('reloadCancel', this.gun);
    }

    this.aiming = input.aimDown && !this.rolling;
    this.running = input.run && moving && !this.aiming && !this.rolling && !this.exhausted && this.stamina > 0;
    if (this.running) {
      this.crouched = false;
      this.stamina -= H.runDrain * dt;
      this.staminaIdle = 0;
      if (this.stamina <= 0) { this.stamina = 0; this.exhaustT = H.exhaust; this.running = false; }
    }
    if (this.staminaIdle > H.regenDelay) this.stamina = Math.min(H.stamina, this.stamina + H.regen * dt);

    // прицел и повороты
    const toAim = new THREE.Vector3(input.aim.x - this.pos.x, 0, input.aim.z - this.pos.z);
    const aimYaw = toAim.lengthSq() > 0.09 ? Math.atan2(toAim.x, toAim.z) : this.upperYaw;

    const prev = this.pos.clone();
    if (this.rolling) {
      const step = Math.min(dt, this.rollT);
      this.vel.copy(this.rollDir).multiplyScalar(H.rollDist / H.rollTime);
      this.pos.addScaledVector(this.vel, step);
      this.rollT -= dt;
      if (this.rollT <= 0) { this.rollT = 0; this.vel.multiplyScalar(H.walk / (H.rollDist / H.rollTime)); }
      const ry = Math.atan2(this.rollDir.x, this.rollDir.z);
      this.upperYaw = ry; this.legYaw = ry;
    } else {
      let target = H.walk;
      if (this.crouched) target = this.aiming ? H.crouchAim : H.crouch;
      else if (this.aiming) target = H.aim;
      else if (this.running) target = H.run;
      const w = WEIGHT_MUL[this.gun.def.weight];
      target *= w;
      if (moveDir && !this.running) {
        const back = moveDir.x * Math.sin(aimYaw) + moveDir.z * Math.cos(aimYaw);
        if (back < -0.35) target *= THREE.MathUtils.lerp(1, H.backMul, Math.min(1, (-back - 0.35) / 0.4));
      }
      const want = moveDir ? moveDir.clone().multiplyScalar(target * Math.min(1, mv.length())) : new THREE.Vector3();
      const diff = want.clone().sub(this.vel);
      const rate = (moveDir ? H.accel : H.decel) * dt;
      if (diff.length() > rate) diff.setLength(rate);
      this.vel.add(diff);
      this.pos.addScaledVector(this.vel, dt);

      // корпус — к прицелу (на бегу — по ходу), ноги — по движению, но не дальше 70° от корпуса
      const upperTarget = this.running && moveDir ? Math.atan2(moveDir.x, moveDir.z) : aimYaw;
      this.upperYaw = wrap(this.upperYaw + wrap(upperTarget - this.upperYaw) * damp(H.turnRate, dt));
      const tw = deg(H.twist);
      let legTarget = this.legYaw;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0.4) {
        const vy = Math.atan2(this.vel.x, this.vel.z);
        let rel = wrap(vy - this.upperYaw);
        if (Math.abs(rel) > deg(110)) rel = wrap(rel + Math.PI); // ход спиной: ноги смотрят вперёд, шагают назад
        legTarget = this.upperYaw + THREE.MathUtils.clamp(rel, -tw, tw);
        this.legYaw = wrap(this.legYaw + wrap(legTarget - this.legYaw) * damp(10, dt));
      } else {
        // стоя: таз доворачивается, только когда корпус ушёл дальше предела
        const rel = wrap(this.upperYaw - this.legYaw);
        if (Math.abs(rel) > tw) this.legYaw = wrap(this.upperYaw - Math.sign(rel) * tw);
        else if (Math.abs(rel) > deg(45)) this.legYaw = wrap(this.legYaw + rel * damp(2.5, dt));
      }
    }
    this.touching = resolveCircle(this.pos, H.radius, obstacles);
    this.pos.y = 0;
    this.speed = dt > 0 ? prev.distanceTo(this.pos) / dt : 0;
    if (this.touching && dt > 0) this.vel.copy(this.pos).sub(prev).divideScalar(dt);

    // оружие
    if (input.slot) {
      this.gunner.select(input.slot, H.switchTime);
    }
    this.gunner.update(dt, {
      trigger: input.fire,
      reloadPressed: input.reload,
      canFire: !this.running && !this.rolling && this.runK < 0.35,
      interrupt: this.running || this.rolling,
      spreadMul: this.spreadMul,
    });

    this.animate(dt);
  }

  private spendStamina(n: number): void {
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaIdle = 0;
    if (this.stamina <= 0) this.exhaustT = HERO.exhaust;
  }

  // ---------- события оружия ----------

  private rigFor(id: FirearmId): GunRig {
    let r = this.rigs.get(id);
    if (!r) {
      r = buildFirearm(id);
      r.root.scale.setScalar(GUN_SCALE);
      r.root.visible = false;
      this.gunMount.add(r.root);
      this.rigs.set(id, r);
    }
    return r;
  }

  private showGun(): void {
    for (const r of this.rigs.values()) r.root.visible = false;
    this.rig = this.rigFor(this.gun.def.id);
    this.rig.root.visible = true;
    if (this.rig.mag) this.rig.mag.visible = true;
    if (this.rig.hinge) this.rig.hinge.rotation.x = 0;
    this.setHandItem(null);
  }

  private setHandItem(kind: 'mag' | 'shells' | null): void {
    for (const c of [...this.handMag.children]) this.handMag.remove(c);
    if (!kind) return;
    if (kind === 'mag') {
      const m = buildMagazine(this.gun.def.id);
      m.scale.setScalar(GUN_SCALE);
      m.position.set(0, 0.02, 0.0);
      this.handMag.add(m);
    } else {
      const a = buildShell(), b = buildShell();
      a.position.set(-0.016, 0.05, 0); b.position.set(0.016, 0.05, 0);
      this.handMag.add(a, b);
    }
  }

  private gunEvent(ev: GunEvent, g: GunState): void {
    const r = this.rig;
    if (ev === 'draw') { this.equipK = 0; this.showGun(); }
    if (ev === 'shot') {
      this.kick = Math.min(1.3, this.kick + g.def.t.kick);
      this.shoulderKick = Math.min(1.5, this.shoulderKick + 1);
      this.boltT = 0;
      if (g.def.reload === 'mag') this.fx.casing(r.port.getWorldPosition(new THREE.Vector3()), this.upperYaw + Math.PI);
    }
    if (ev === 'magOut' && r.mag) {
      this.dropMagazine(r);
      r.mag.visible = false;
    }
    if (ev === 'magIn') { if (r.mag) r.mag.visible = true; this.setHandItem(null); }
    if (ev === 'eject' && r.breech) {
      const p = r.breech.getWorldPosition(new THREE.Vector3());
      this.fx.casing(p, this.upperYaw + Math.PI * 0.5, true);
      this.fx.casing(p, this.upperYaw - Math.PI * 0.5, true);
    }
    if (ev === 'shellsIn') this.setHandItem(null);
    if (ev === 'reloadCancel') {
      if (r.mag) r.mag.visible = true;
      if (r.hinge) r.hinge.rotation.x = 0;
      this.setHandItem(null);
    }
    this.onGunEvent(ev, g, this);
  }

  /** Пустой магазин падает на пол и лежит несколько секунд */
  private dropMagazine(r: GunRig): void {
    if (!r.mag) return;
    const m = buildMagazine(this.gun.def.id);
    r.mag.updateWorldMatrix(true, false);
    r.mag.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    const p0 = m.position.clone();
    const q0 = m.quaternion.clone();
    const v = new THREE.Vector3(Math.sin(this.upperYaw) * 0.6 + (Math.random() - 0.5) * 0.6, 0.4, Math.cos(this.upperYaw) * 0.6 + (Math.random() - 0.5) * 0.6);
    const spin = new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 4 - 2, Math.random() * 8 - 4);
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.random() * 6, 0));
    const dur = 8;
    const g = 12;
    const tLand = (v.y + Math.sqrt(v.y * v.y + 2 * g * Math.max(0, p0.y - 0.04))) / g;
    this.scene.add(m);
    this.fx.custom(m, dur, (k) => {
      const t = k * dur;
      const tt = Math.min(t, tLand);
      m.position.set(p0.x + v.x * tt, Math.max(0.04, p0.y + v.y * tt - 0.5 * g * tt * tt), p0.z + v.z * tt);
      if (t < tLand) m.quaternion.copy(q0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(spin.x * t, spin.y * t, spin.z * t)));
      else m.quaternion.slerp(flat, Math.min(1, (t - tLand) * 10));
    }, () => { /* геометрию оставляем — её мало */ });
  }

  // ---------- анимация ----------

  private animate(dt: number): void {
    const H = HERO;
    const g = this.gun;
    const rel = g.reload;
    const pistol = g.def.cls === 'pistol';
    const P = pistol ? POSES.pistol : POSES.rifle;

    this.aimK += ((this.aiming ? 1 : 0) - this.aimK) * damp(14, dt);
    this.runK += ((this.running || this.rolling ? 1 : 0) - this.runK) * damp(10, dt);
    this.crouchK += ((this.crouched ? 1 : 0) - this.crouchK) * damp(12, dt);
    this.kick = Math.max(0, this.kick - dt * 9);
    this.shoulderKick = Math.max(0, this.shoulderKick - dt * 10);
    this.boltT = Math.min(1, this.boltT + dt / 0.08);
    this.equipK = Math.min(1, this.equipK + dt / Math.max(0.05, H.switchTime));

    // походка
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const stepLen = this.running ? H.runStep : this.crouched ? H.crouchStep : H.step;
    this.gaitW += (THREE.MathUtils.clamp(sp / 0.8, 0, 1) - this.gaitW) * damp(8, dt);
    if (sp > 0.05) this.moveDir.lerp(new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize(), damp(12, dt)).normalize();
    const prevPhase = this.phase;
    this.phase += (sp * dt) / (2 * stepLen) * Math.PI * 2;
    if (this.gaitW > 0.4 && Math.floor(prevPhase / Math.PI) !== Math.floor(this.phase / Math.PI)) this.onStep?.();

    // таз
    const roll = this.rolling ? 1 - this.rollT / H.rollTime : 0;
    const drop = THREE.MathUtils.lerp(H.stanceDrop * (1 - this.runK * 0.6), H.crouchDrop, this.crouchK);
    const bobAmp = (this.running ? 0.045 : 0.025) * this.gaitW;
    let hipY = HIP_Y - drop - bobAmp * (0.5 - 0.5 * Math.cos(2 * this.phase)) * 2 + bobAmp;
    if (this.rolling) hipY = THREE.MathUtils.lerp(hipY, 0.42, Math.sin(roll * Math.PI));
    if (this.down) hipY = 0.3;
    this.root.position.copy(this.pos);
    this.hips.position.set(0, hipY, 0);
    this.hips.rotation.set(0, 0, 0);
    this.hips.rotation.order = 'YXZ';
    this.hips.rotation.y = this.legYaw;
    if (this.rolling) this.hips.rotation.x = roll * Math.PI * 2;
    if (this.down) { this.hips.rotation.x = -Math.PI / 2 * Math.min(1, this.downT * 4); }

    // корпус: поворот к прицелу распределён по позвоночнику, наклон вперёд, покачивание, отдача
    const twist = THREE.MathUtils.clamp(wrap(this.upperYaw - this.legYaw), -deg(H.twist) * 1.2, deg(H.twist) * 1.2);
    const lean = deg(THREE.MathUtils.lerp(H.lean, H.runLean, this.runK)) + this.crouchK * deg(6);
    const swayR = Math.sin(this.phase) * deg(H.sway) * this.gaitW;
    const kickBack = deg(g.def.t.shoulderKick) * this.shoulderKick;
    const flinch = this.hurtT > 0 ? Math.sin(this.hurtT * 40) * 0.08 : 0;
    const blade = BLADE * (1 - this.runK) * (pistol ? 0.4 : 1);
    this.spine.rotation.set(lean * 0.6 - kickBack * 0.3 + flinch, twist * 0.45 + blade * 0.4, swayR);
    this.chest.rotation.set(lean * 0.4 - kickBack * 0.7, twist * 0.55 + blade * 0.6, -swayR * 0.5);
    this.head.rotation.set(-lean + kickBack * 0.4, -blade, 0);

    this.root.updateMatrixWorld(true);

    // поза оружия
    const tgt = new THREE.Vector3();
    let yaw = 0, pitch = 0, rl = 0;
    const blend = (pz: GunPose, w: number) => { tgt.addScaledVector(pz.p, w); yaw += pz.yaw * w; pitch += pz.pitch * w; rl += pz.roll * w; };
    let reloadW = 0;
    let reloadPose = P.reload;
    if (rel) {
      const k = rel.t / rel.dur;
      reloadW = seg(k, 0, 0.1) * (1 - seg(k, 0.9, 1));
      if (rel.kind === 'break') reloadPose = POSES.rifle.break;
    }
    const lowW = Math.max(this.runK, 1 - this.equipK);
    const readyW = (1 - this.aimK) * (1 - reloadW) * (1 - lowW);
    const adsW = this.aimK * (1 - reloadW) * (1 - lowW);
    const rw = reloadW * (1 - lowW);
    blend(P.ready, readyW); blend(P.ads, adsW); blend(reloadPose, rw); blend(P.low, lowW);
    // покачивание ствола при ходьбе, в прицеле меньше
    const swayAmt = (1 - this.aimK * 0.7) * this.gaitW;
    tgt.x += Math.sin(this.phase) * 0.012 * swayAmt;
    tgt.y += Math.abs(Math.cos(this.phase)) * 0.014 * swayAmt;
    // отдача: назад и вверх
    tgt.z -= this.kick * (pistol ? 0.05 : 0.07);
    pitch -= this.kick * (pistol ? 0.35 : 0.18);
    if (this.equipK < 1) tgt.y -= (1 - smooth(this.equipK)) * 0.25;

    // «верхняя» система: центр груди, повёрнута к прицелу (в перекате — кувыркается с телом)
    const chestOrigin = this.chest.getWorldPosition(new THREE.Vector3());
    const upperQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rolling ? roll * Math.PI * 2 : 0, this.upperYaw, 0, 'YXZ'));
    if (this.down) upperQ.setFromEuler(new THREE.Euler(-Math.PI / 2, this.legYaw, 0, 'YXZ'));
    const gunWorld = tgt.clone().applyQuaternion(upperQ).add(chestOrigin);
    this.gunMount.position.copy(gunWorld).sub(this.root.position);
    const poseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, rl, 'YXZ'));
    this.gunMount.quaternion.copy(upperQ).multiply(poseQ);

    // детали ствола: затвор, переламывание
    const r = this.rig;
    if (r.bolt) r.bolt.position.z = (r.bolt.userData.z0 as number) - Math.sin(this.boltT * Math.PI) * (pistol ? 0.03 : 0.045);
    if (r.hinge) {
      let open = 0;
      if (rel && rel.kind === 'break') { const k = rel.t / rel.dur; open = seg(k, 0.06, 0.18) * (1 - seg(k, 0.8, 0.9)); }
      r.hinge.rotation.x = open * 0.75;
    }
    this.gunMount.updateMatrixWorld(true);

    // руки
    this.poseArms(rel ? rel.t / rel.dur : -1);

    // ноги
    this.poseLegs(stepLen);

    // дуга выносливости
    const sk = this.stamina / H.stamina;
    this.stamRing.visible = sk < 0.999 && !this.down;
    if (this.stamRing.visible) {
      const geo = this.stamRing.geometry as THREE.RingGeometry;
      const want = Math.max(0.01, sk) * Math.PI * 2;
      if (Math.abs(geo.parameters.thetaLength - want) > 0.02) {
        geo.dispose();
        this.stamRing.geometry = new THREE.RingGeometry(0.62, 0.72, 48, 1, Math.PI / 2 - want / 2, want);
      }
      this.stamMat.color.setRGB(this.exhausted ? 2.2 : 1.6, this.exhausted ? 0.3 : 1.5, this.exhausted ? 0.2 : 0.4);
    }
  }

  /** Обработчик шага — для звука */
  onStep?: () => void;

  private poseArms(k: number): void {
    const chestInv = new THREE.Matrix4().copy(this.chest.matrixWorld).invert();
    const toChest = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(chestInv);
    const r = this.rig;
    const gripR = toChest(r.gripR);
    let gripL = toChest(r.gripL);
    const rel = this.gun.reload;

    if (rel && k >= 0) {
      const pouch = new THREE.Vector3(0.08, 0.05, 0.24);
      const well = toChest(r.magWell);
      const below = well.clone().add(new THREE.Vector3(0, -0.12, 0.02));
      const marks = RELOAD_MARKS[rel.kind];
      const at = (ev: GunEvent) => marks.find((m) => m.ev === ev)?.at ?? 1;
      let p: THREE.Vector3;
      let item: 'mag' | 'shells' | null = null;
      if (rel.kind === 'break') {
        const breech = r.breech ? toChest(r.breech) : well;
        const sIn = at('shellsIn');
        if (k < 0.22) p = gripL;
        else if (k < 0.38) p = gripL.clone().lerp(pouch, seg(k, 0.22, 0.38));
        else if (k < 0.48) p = pouch;
        else if (k < sIn) { p = pouch.clone().lerp(breech, seg(k, 0.48, sIn - 0.02)); }
        else p = breech.clone().lerp(gripL, seg(k, sIn + 0.02, sIn + 0.14));
        if (k >= 0.42 && k < sIn) item = 'shells';
      } else {
        const out = at('magOut'), inn = at('magIn'), rack = rel.kind === 'full' ? at('rack') : -1;
        const port = toChest(r.bolt ?? r.port);
        if (k < out) p = gripL.clone().lerp(well, seg(k, 0, out));
        else if (k < out + 0.14) p = well.clone().lerp(pouch, seg(k, out, out + 0.14));
        else if (k < inn - 0.2) p = pouch;
        else if (k < inn - 0.06) p = pouch.clone().lerp(below, seg(k, inn - 0.2, inn - 0.06));
        else if (k < inn) p = below.clone().lerp(well, seg(k, inn - 0.06, inn));
        else if (rack > 0 && k < rack + 0.06) {
          // рука к рукояти затвора и рывок назад
          const pull = port.clone().add(new THREE.Vector3(0, 0, -0.08));
          p = k < rack - 0.04 ? well.clone().lerp(port, seg(k, inn, rack - 0.04)) : port.clone().lerp(pull, seg(k, rack - 0.04, rack));
        } else {
          const from = rack > 0 ? port : well;
          p = from.clone().lerp(gripL, seg(k, rack > 0 ? rack + 0.06 : inn, 1));
        }
        if (k >= out + 0.16 && k < inn) item = 'mag';
      }
      gripL = p;
      if ((item !== null) !== (this.handMag.children.length > 0)) this.setHandItem(item);
    }

    const sides: [Limb, THREE.Vector3, number][] = [[this.arms[0], gripL, 1], [this.arms[1], gripR, -1]];
    for (const [limb, target, side] of sides) {
      const s = new THREE.Vector3(SHOULDER.x * side, SHOULDER.y, SHOULDER.z);
      const pole = new THREE.Vector3(0.7 * side, -1, -0.35);
      const elbow = new THREE.Vector3();
      solveIK(s, target, UPPER_ARM, FOREARM + HAND, pole, elbow);
      aimSegment(limb.upper, s, elbow);
      const wrist = target.clone();
      aimSegment(limb.lower, elbow, wrist);
      limb.end.position.copy(wrist);
      limb.end.quaternion.copy(limb.lower.quaternion);
    }
  }

  private poseLegs(stepLen: number): void {
    const H = HERO;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.legYaw);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(yawQ); // +X — левая сторона героя
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ);
    const hipsM = this.hips.matrixWorld;
    const toRoot = (v: THREE.Vector3) => v.applyMatrix4(hipsM).sub(this.root.position);
    const footW = 0.14 + this.crouchK * 0.04;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const limb = this.legs[i];
      const hip = toRoot(new THREE.Vector3(HIP_W * side, -0.06, 0));
      let foot: THREE.Vector3;
      if (this.rolling || this.down) {
        // в перекате ноги поджаты к тазу
        foot = toRoot(new THREE.Vector3(HIP_W * side, this.down ? -0.75 : -0.42, this.down ? 0 : 0.18));
      } else {
        const ph = (this.phase + (i === 0 ? 0 : Math.PI)) % (Math.PI * 2);
        let s: number, lift = 0;
        if (ph < Math.PI) s = 1 - 2 * (ph / Math.PI);
        else { const u = (ph - Math.PI) / Math.PI; s = -1 + 2 * smooth(u); lift = Math.sin(u * Math.PI) * H.stepLift * (this.running ? 1.4 : 1); }
        const neutral = fwd.clone().multiplyScalar((side > 0 ? 0.1 : -0.08) * (1 - this.gaitW) + this.crouchK * (side > 0 ? 0.12 : -0.1) * (1 - this.gaitW));
        foot = right.clone().multiplyScalar(footW * side)
          .add(neutral)
          .addScaledVector(this.moveDir, s * stepLen * 0.5 * this.gaitW)
          .add(new THREE.Vector3(0, ANKLE + lift * this.gaitW, 0));
      }
      // колени — вперёд и чуть наружу
      const pole = fwd.clone().addScaledVector(right, 0.15 * side).add(new THREE.Vector3(0, 0.1, 0));
      if (this.rolling || this.down) pole.copy(new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(hipsM)));
      const knee = new THREE.Vector3();
      solveIK(hip, foot, THIGH, SHIN, pole, knee);
      aimSegment(limb.upper, hip, knee);
      aimSegment(limb.lower, knee, foot);
      limb.end.position.copy(foot);
      if (this.rolling || this.down) limb.end.quaternion.copy(limb.lower.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
      else limb.end.quaternion.copy(yawQ);
    }
  }

  /** Для оверлея коллайдеров и тестов: мировые точки модели */
  get object(): THREE.Object3D { return this.root; }
}
