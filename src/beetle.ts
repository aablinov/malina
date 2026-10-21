import * as THREE from 'three';
import { CFG, type Vec2 } from './config';
import type { Bush } from './bush';

const OUTLINE = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.25), side: THREE.BackSide, toneMapped: false });

const ICE = new THREE.MeshStandardMaterial({ color: '#bfefff', transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.1, emissive: '#3aa8ff', emissiveIntensity: 0.6, depthWrite: false });

export type BeetleKind = 'small' | 'big' | 'fast' | 'spitter' | 'bombardier';

/** Стрельба жука издалека */
export interface RangedStats {
  /** С какого расстояния стреляет */
  range: number;
  /** С какого расстояния переключается на героя */
  aggro: number;
  /** Пауза между очередями, с */
  cd: number;
  /** Плевков в очереди */
  burst: number;
  speed: number;
  /** Урон герою */
  dmg: number;
  /** Урон кусту */
  bushDmg: number;
  /** Цвет снаряда (HDR) */
  color: [number, number, number];
}

export interface BeetleStats {
  hp: number;
  speed: number;
  /** Урон кусту в секунду */
  bite: number;
  radius: number;
  scale: number;
  shell: string;
  sheen: string;
  ranged?: RangedStats;
}

const KINDS: Record<BeetleKind, BeetleStats> = {
  small: { hp: 10, speed: 1.9, bite: 1.3, radius: 0.45, scale: 1, shell: '#22365e', sheen: '#2f7f7a' },
  big: { hp: 40, speed: 1.2, bite: 3.2, radius: 0.75, scale: 1.65, shell: '#5a2475', sheen: '#9a3bb0' },
  fast: { hp: 6, speed: 3.2, bite: 0.9, radius: 0.38, scale: 0.8, shell: '#7a2a12', sheen: '#e0642a' },
  // плевун: быстрый, держит дистанцию и плюётся кислотой
  spitter: {
    hp: 12, speed: 2.9, bite: 0.6, radius: 0.42, scale: 0.95, shell: '#23401a', sheen: '#7aff3a',
    ranged: { range: 7, aggro: 13, cd: 1.8, burst: 1, speed: 10, dmg: 6, bushDmg: 3, color: [0.9, 3.4, 0.4] },
  },
  // бомбардир: ещё быстрее, стреляет очередью из трёх горячих капель
  bombardier: {
    hp: 20, speed: 3.1, bite: 0.8, radius: 0.5, scale: 1.1, shell: '#4a160a', sheen: '#ff7a1a',
    ranged: { range: 8, aggro: 14, cd: 2.6, burst: 3, speed: 12, dmg: 5, bushDmg: 2, color: [3.4, 1.3, 0.3] },
  },
};

/** Кого жук преследует: старый Player и новый Hero подходят оба */
export interface BeetleTarget { readonly pos: THREE.Vector3; readonly down: boolean }

export type BiteHandler = (beetle: Beetle, bush: Bush, damage: number) => void;
/** Жук стреляет из точки from в точку to; atPlayer — целится в героя */
export type ShootHandler = (beetle: Beetle, from: THREE.Vector3, to: THREE.Vector3, r: RangedStats, atPlayer: boolean) => void;

export class Beetle {
  readonly K: BeetleStats;
  readonly maxHp: number;
  hp: number;
  readonly speed: number;
  readonly bite: number;
  readonly radius: number;
  readonly pos: THREE.Vector3;
  dead = false;
  /** Урон, ещё не показанный цифрой, и когда цифра была в последний раз */
  numAcc = 0;
  numT = 0;
  /** Сколько ещё секунд жук заморожен */
  frozenT = 0;

  private readonly gate: THREE.Vector3;
  private passedGate = false;
  private target: Bush | null = null;
  private chasePlayer = false;
  private chewing = false;
  private hitFlash = 0;
  private readonly knock = new THREE.Vector3();
  private phase = Math.random() * 10;
  private facing: number;
  private spawnT = 0;
  private shootT = 1 + Math.random();
  private burstLeft = 0;
  private burstT = 0;
  private strafe = Math.random() < 0.5 ? 1 : -1;
  private strafeT = 0;
  private sac: THREE.Mesh | null = null;
  private sacMat: THREE.MeshStandardMaterial | null = null;

  private readonly mats: THREE.MeshStandardMaterial[];
  private readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly mandL: THREE.Mesh;
  private readonly mandR: THREE.Mesh;
  private readonly legs: THREE.Group[] = [];
  private readonly outlines: THREE.Mesh[] = [];
  private readonly ice: THREE.Mesh;
  private iceShow = true;

  constructor(private readonly scene: THREE.Scene, readonly kind: BeetleKind, spawn: Vec2, gate: Vec2, mul = 1) {
    const K = KINDS[kind];
    this.K = K;
    this.maxHp = Math.round(K.hp * (1 + (mul - 1) * 1.5));
    this.hp = this.maxHp;
    this.speed = K.speed * mul;
    this.bite = K.bite;
    this.radius = K.radius;
    this.pos = new THREE.Vector3(spawn[0] + (Math.random() - 0.5) * 2, 0, spawn[1] + (Math.random() - 0.5) * 2);
    this.gate = new THREE.Vector3(gate[0] + (Math.random() - 0.5) * 1.5, 0, gate[1] + (Math.random() - 0.5) * 1.5);
    this.facing = Math.atan2(-this.pos.x, -this.pos.z);

    const std = (color: string, o: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.35, ...o });
    const shell = std(K.shell);
    const sheen = std(K.sheen, { emissive: K.sheen, emissiveIntensity: 0.15 });
    const dark = std('#14161c');
    const leg = std('#0d0d10', { roughness: 0.6 });
    this.mats = [shell, sheen, dark, leg];
    const eye = new THREE.MeshStandardMaterial({ color: '#300', emissive: '#ff2a1a', emissiveIntensity: 3 });

    this.group.add(this.body);
    this.group.scale.setScalar(K.scale);
    const add = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body, outline = true): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      if (outline) {
        const o = new THREE.Mesh(m.geometry, OUTLINE);
        o.scale.set((w + 0.08) / w, (h + 0.08) / h, (d + 0.08) / d);
        o.visible = false;
        m.add(o);
        this.outlines.push(o);
      }
      return m;
    };
    add(0.64, 0.32, 0.74, shell, 0, 0.36, -0.12);
    add(0.03, 0.02, 0.72, dark, 0, 0.53, -0.12, this.body, false);
    add(0.18, 0.02, 0.3, sheen, -0.16, 0.525, -0.18, this.body, false);
    add(0.18, 0.02, 0.3, sheen, 0.16, 0.525, -0.18, this.body, false);
    add(0.5, 0.25, 0.26, dark, 0, 0.34, 0.33);
    this.head.position.set(0, 0.3, 0.5);
    this.body.add(this.head);
    add(0.34, 0.2, 0.22, dark, 0, 0, 0.04, this.head);
    add(0.08, 0.08, 0.05, eye, -0.11, 0.03, 0.15, this.head, false);
    add(0.08, 0.08, 0.05, eye, 0.11, 0.03, 0.15, this.head, false);
    this.mandL = add(0.06, 0.05, 0.16, leg, -0.09, -0.06, 0.2, this.head, false);
    this.mandR = add(0.06, 0.05, 0.16, leg, 0.09, -0.06, 0.2, this.head, false);
    for (const s of [-1, 1]) {
      const a = add(0.03, 0.03, 0.34, leg, s * 0.12, 0.12, 0.26, this.head, false);
      a.rotation.set(-0.6, s * 0.4, 0);
    }
    if (kind === 'big') {
      const h1 = add(0.12, 0.12, 0.42, dark, 0, 0.16, 0.22, this.head);
      h1.rotation.x = -0.7;
      add(0.09, 0.2, 0.09, dark, 0, 0.36, 0.38, this.head, false);
    }
    for (const s of [-1, 1]) for (const z of [0.3, 0.05, -0.22]) {
      const p = new THREE.Group();
      p.position.set(s * 0.26, 0.28, z);
      this.body.add(p);
      const l1 = add(0.3, 0.05, 0.05, leg, s * 0.15, 0, 0, p, false); l1.rotation.z = s * -0.45;
      const l2 = add(0.05, 0.26, 0.05, leg, s * 0.3, -0.16, 0, p, false); l2.rotation.z = s * 0.25;
      p.userData.side = s;
      this.legs.push(p);
    }

    if (K.ranged) {
      // светящийся мешок с кислотой или горячей смесью
      const c = new THREE.Color(...K.ranged.color).multiplyScalar(1 / 3.4);
      this.sacMat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2, roughness: 0.3 });
      this.sac = add(0.42, 0.3, 0.34, this.sacMat, 0, 0.42, -0.5);
      if (kind === 'bombardier') {
        add(0.08, 0.08, 0.14, this.sacMat, -0.08, 0.06, 0.2, this.head, false);
        add(0.08, 0.08, 0.14, this.sacMat, 0.08, 0.06, 0.2, this.head, false);
      }
    }

    this.ice = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 1.25), ICE);
    this.ice.position.set(0, 0.35, 0.05);
    this.ice.visible = false;
    this.body.add(this.ice);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  /** Поставить жука в точку (строй в плейграунде): сразу «прошёл ворота» и смотрит по курсу yaw */
  placeAt(x: number, z: number, yaw: number): void {
    this.pos.set(x, 0, z);
    this.gate.set(x, 0, z);
    this.facing = yaw;
    this.group.position.copy(this.pos);
    this.group.rotation.y = yaw;
  }

  /** Остановить жука: ice — во льду, иначе просто оглушён */
  freeze(sec: number, ice = true): void {
    if (sec > this.frozenT) this.iceShow = ice;
    this.frozenT = Math.max(this.frozenT, sec);
  }

  /** Красная обводка, когда жук под прицелом */
  setOutline(on: boolean): void { for (const o of this.outlines) o.visible = on; }

  /** Возвращает true, если жук погиб */
  damage(d: number, dir?: THREE.Vector3): boolean {
    this.hp -= d;
    this.hitFlash = 0.12;
    if (dir) this.knock.addScaledVector(dir, this.kind === 'big' ? 2.5 : 6);
    if (this.hp <= 0) this.dead = true;
    return this.dead;
  }

  private pickTarget(bushes: readonly (Bush | null)[]): void {
    let best: Bush | null = null, bd = Infinity;
    for (const b of bushes) {
      if (!b || b.dead) continue;
      const d = b.pos.distanceToSquared(this.pos) * (b.ready ? 0.7 : 1);
      if (d < bd) { bd = d; best = b; }
    }
    this.target = best;
    this.chasePlayer = !best;
  }

  /** Жук стреляет издалека */
  get ranged(): RangedStats | undefined { return this.K.ranged; }

  update(dt: number, t: number, bushes: readonly (Bush | null)[], player: BeetleTarget, beetles: readonly Beetle[], onBite: BiteHandler, onShoot: ShootHandler): void {
    this.spawnT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.frozenT > 0) {
      // во льду: не двигается и не ест
      this.frozenT = Math.max(0, this.frozenT - dt);
      this.ice.visible = this.iceShow && this.frozenT > 0;
      this.chewing = false;
      this.pos.addScaledVector(this.knock, dt * 0.3);
      this.knock.multiplyScalar(Math.exp(-10 * dt));
      const fl = this.hitFlash > 0 ? 0.45 : 0;
      const tint = this.iceShow ? [0.25, 0.6, 0.9] : [0.35, 0.3, 0.05];
      for (const m of this.mats) { m.emissive.setRGB(fl + tint[0], fl + tint[1], fl + tint[2]); m.emissiveIntensity = 1; }
      if (!this.iceShow) this.body.rotation.z = Math.sin(this.frozenT * 30) * 0.08;
      this.group.position.set(this.pos.x, 0, this.pos.z);
      return;
    }
    this.ice.visible = false;
    this.body.rotation.z = 0;
    if (!this.passedGate && Math.hypot(this.pos.x - this.gate.x, this.pos.z - this.gate.z) < 1.2) this.passedGate = true;
    if (this.passedGate && (!this.target || this.target.dead) && !this.chasePlayer) this.pickTarget(bushes);
    if (this.chasePlayer && bushes.some((b) => b && !b.dead)) { this.chasePlayer = false; this.pickTarget(bushes); }

    const target = this.target && !this.target.dead ? this.target : null;
    let dest: THREE.Vector3;
    if (!this.passedGate) dest = this.gate;
    else if (target) dest = target.pos;
    else dest = player.pos;

    const R = this.K.ranged;
    // стрелок переключается на героя, если тот рядом
    let atPlayer = false;
    if (R && this.passedGate && !player.down && player.pos.distanceTo(this.pos) < R.aggro) { dest = player.pos; atPlayer = true; }

    const dx = dest.x - this.pos.x, dz = dest.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.chewing = false;
    let mv = 0;
    const sp = this.speed * Math.min(1, this.spawnT * 2);
    if (R && this.passedGate) {
      // держит дистанцию: подходит, отступает, кружит вбок
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 1.2 + Math.random() * 1.5; }
      const nx = dx / Math.max(dist, 1e-4), nz = dz / Math.max(dist, 1e-4);
      let fwd = 0;
      if (dist > R.range) fwd = 1;
      else if (dist < R.range * 0.55) fwd = -0.8;
      const side = dist <= R.range ? 0.55 * this.strafe : 0;
      this.pos.x += (nx * fwd - nz * side) * sp * dt;
      this.pos.z += (nz * fwd + nx * side) * sp * dt;
      mv = fwd !== 0 || side !== 0 ? 1 : 0;
      // стрельба: мешок разгорается перед плевком
      this.shootT -= dt;
      if (this.sacMat) this.sacMat.emissiveIntensity = 1.2 + Math.max(0, 0.5 - this.shootT) * 6;
      if (dist <= R.range + 0.5 && this.shootT <= 0 && this.burstLeft === 0) { this.burstLeft = R.burst; this.burstT = 0; }
      if (this.burstLeft > 0) {
        this.burstT -= dt;
        if (this.burstT <= 0) {
          const from = this.pos.clone().setY(0.55 * this.K.scale).addScaledVector(new THREE.Vector3(nx, 0, nz), 0.6 * this.K.scale);
          onShoot(this, from, dest.clone().setY(atPlayer ? 0.9 : 0.6), R, atPlayer);
          this.burstLeft--;
          this.burstT = 0.16;
          if (this.burstLeft === 0) this.shootT = R.cd * (0.8 + Math.random() * 0.4);
        }
      }
      if (this.sac) this.sac.scale.setScalar(1 + Math.max(0, 0.5 - this.shootT) * 0.4);
    } else {
      const reach = this.passedGate && target ? 0.45 + this.radius * 0.9 : (this.chasePlayer ? 1.1 : 0.3);
      if (dist > reach) {
        this.pos.x += (dx / dist) * sp * dt;
        this.pos.z += (dz / dist) * sp * dt;
        mv = 1;
      } else if (this.passedGate && target) {
        this.chewing = true;
        onBite(this, target, this.bite * dt);
      }
    }

    for (const o of beetles) {
      if (o === this || o.dead) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const d = Math.hypot(ox, oz), min = (this.radius + o.radius) * 0.85;
      if (d < min && d > 1e-4) {
        const push = (min - d) * 0.5;
        this.pos.x += (ox / d) * push; this.pos.z += (oz / d) * push;
      }
    }
    this.pos.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.exp(-8 * dt));
    if (this.passedGate) {
      // за стены поля не уходят
      const B = CFG.FIELD + 0.5;
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -B, B);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, -B, B);
    }

    if (dist > 0.01) {
      let d = Math.atan2(dx, dz) - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 8);
    }

    this.phase += dt * (mv ? this.speed * 9 : (this.chewing ? 4 : 0));
    this.legs.forEach((p, i) => {
      const side = p.userData.side as number;
      const off = (i % 2 === 0 ? 0 : Math.PI) + (side > 0 ? Math.PI : 0);
      p.rotation.y = Math.sin(this.phase + off) * 0.45 * mv;
      p.rotation.z = Math.max(0, Math.cos(this.phase + off)) * 0.25 * mv * side;
    });
    const chew = this.chewing ? Math.sin(t * 22) : 0;
    this.head.rotation.x = chew * 0.15 + (this.chewing ? 0.25 : 0);
    this.mandL.rotation.y = 0.3 + chew * 0.35;
    this.mandR.rotation.y = -0.3 - chew * 0.35;

    const fl = this.hitFlash > 0 ? 0.45 : 0;
    for (const m of this.mats) { m.emissive.setRGB(fl, fl, fl); m.emissiveIntensity = fl ? 1 : (m === this.mats[1] ? 0.15 : 0); }
    if (!fl) this.mats[1].emissive.set(this.K.sheen);

    this.body.scale.setScalar(Math.min(1, this.spawnT * 3));
    this.body.position.y = Math.abs(Math.sin(this.phase * 2)) * 0.03 * mv;
    this.group.position.set(this.pos.x, 0, this.pos.z);
    this.group.rotation.y = this.facing;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o instanceof THREE.Mesh && o.material !== OUTLINE && o.material !== ICE) o.geometry.dispose(); });
    this.ice.geometry.dispose();
    this.mats.forEach((m) => m.dispose());
    this.sacMat?.dispose();
  }
}
