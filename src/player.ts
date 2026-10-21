import * as THREE from 'three';
import { CFG, type Collider } from './config';
import type { Textures } from './textures';
import type { FX } from './fx';
import { buildGunModel, type WeaponDef } from './weapons';

function box(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const lerp = THREE.MathUtils.lerp;
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export class Player {
  readonly pos = new THREE.Vector3(0, 0, 2.2);
  facing = Math.PI * 0.75;
  /** Сплющивание после мощного выстрела, 0..1 */
  squash = 0;
  readonly maxHp: number = CFG.PLAYER_HP;
  hp: number = CFG.PLAYER_HP;
  /** Без сознания — лежит и ждёт подъёма */
  down = false;
  /** Множитель скорости ходьбы (турель замедляет) */
  speedMul = 1;
  /** Второй ствол в левой руке (мод узи) */
  akimbo = false;

  private phase = 0;
  private moving = 0;
  private recoil = 0;
  private recoilL = 0;
  private equipT = 1;
  private hurtT = 0;
  private dashT = 0;
  private spinAngle = 0;
  private readonly dashV = new THREE.Vector3();

  private readonly root: THREE.Group;
  private readonly model: THREE.Group;
  private readonly upper: THREE.Group;
  private readonly head: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  /** Держатель основного ствола у груди */
  private readonly hold = new THREE.Group();
  private readonly holdL = new THREE.Group();
  private readonly glowLight = new THREE.PointLight('#ffffff', 0, 3.5, 1.8);
  private readonly ring: THREE.Mesh;
  private gun: THREE.Group | null = null;
  private gunL: THREE.Group | null = null;

  constructor(scene: THREE.Scene, T: Textures, fx: FX) {
    const lam = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
    const skin = lam({ map: T.skin }), shirt = lam({ map: T.shirt }), over = lam({ map: T.overalls });
    const boot = lam({ color: '#4a2f1c' }), straw = lam({ map: T.straw }), band = lam({ color: '#c4284f' });
    const hairM = lam({ map: T.hair }), hairTop = lam({ color: '#6b3d1f' });

    this.root = new THREE.Group();
    scene.add(this.root);
    this.model = new THREE.Group();
    this.root.add(this.model);

    const mkLeg = (x: number) => {
      const p = new THREE.Group(); p.position.set(x, 0.72, 0);
      p.add(box(0.24, 0.62, 0.26, over, 0, -0.3, 0));
      p.add(box(0.26, 0.14, 0.32, boot, 0, -0.65, 0.02));
      this.model.add(p); return p;
    };
    this.legL = mkLeg(-0.13); this.legR = mkLeg(0.13);

    this.upper = new THREE.Group(); this.upper.position.y = 0.72; this.model.add(this.upper);
    this.upper.add(box(0.54, 0.2, 0.3, over, 0, 0.08, 0));
    this.upper.add(box(0.52, 0.5, 0.28, shirt, 0, 0.42, 0));
    this.upper.add(box(0.36, 0.34, 0.03, over, 0, 0.32, 0.15));
    this.upper.add(box(0.07, 0.3, 0.03, over, -0.15, 0.55, 0.15), box(0.07, 0.3, 0.03, over, 0.15, 0.55, 0.15));

    const mkArm = (x: number) => {
      const p = new THREE.Group(); p.position.set(x, 0.62, 0);
      p.add(box(0.2, 0.46, 0.22, shirt, 0, -0.2, 0));
      p.add(box(0.2, 0.16, 0.22, skin, 0, -0.5, 0));
      this.upper.add(p); return p;
    };
    this.armL = mkArm(-0.37); this.armR = mkArm(0.37);

    this.hold.position.set(0.16, 0.42, 0.3);
    this.upper.add(this.hold);
    this.holdL.position.set(-0.3, 0.42, 0.3);
    this.upper.add(this.holdL);
    this.glowLight.position.set(0, 0.1, 0.4);
    this.hold.add(this.glowLight);

    this.head = new THREE.Group(); this.head.position.y = 0.92; this.upper.add(this.head);
    const headMats = [hairM, hairM, hairTop, skin, new THREE.MeshLambertMaterial({ map: T.face }), hairTop];
    this.head.add(box(0.5, 0.5, 0.5, headMats, 0, 0.22, 0));
    this.head.add(box(0.9, 0.06, 0.9, straw, 0, 0.5, 0));
    this.head.add(box(0.54, 0.08, 0.54, band, 0, 0.56, 0));
    this.head.add(box(0.5, 0.2, 0.5, straw, 0, 0.68, 0));

    this.ring = fx.marker(new THREE.Color(2.2, 1.9, 0.6), 1.15);
  }

  get forward(): THREE.Vector3 { return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  get equipping(): boolean { return this.equipT < 0.5; }

  /** Взять ствол: прошлый уходит вниз, новый поднимается к груди */
  setWeapon(def: WeaponDef, level: number): void {
    for (const h of [this.hold, this.holdL]) {
      for (const c of [...h.children]) {
        if (c === this.glowLight) continue;
        h.remove(c);
        c.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      }
    }
    const s = def.id === 'bfg' || def.id === 'chaingun' ? 1.6 : def.id === 'uzi' ? 1.4 : 1.5;
    this.gun = buildGunModel(def, level);
    this.gun.scale.setScalar(s);
    this.hold.add(this.gun);
    this.gunL = null;
    if (def.id === 'uzi') {
      this.gunL = buildGunModel(def, level);
      this.gunL.scale.setScalar(s);
      this.holdL.add(this.gunL);
    }
    this.glowLight.color.copy(new THREE.Color(...def.glow).multiplyScalar(1 / 3.6));
    this.glowLight.intensity = 1.5 + level * 0.8;
    this.equipT = 0;
    this.akimbo = false;
  }

  /** Точки дул в мире: основной ствол и, если есть, второй */
  muzzles(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const g of [this.gun, this.akimbo ? this.gunL : null]) {
      if (!g) continue;
      out.push((g.userData.muzzle as THREE.Object3D).getWorldPosition(new THREE.Vector3()));
    }
    return out;
  }

  /** Отдача: left — от второго ствола */
  kick(amount: number, left = false): void {
    if (left) this.recoilL = Math.min(1, this.recoilL + amount);
    else this.recoil = Math.min(1, this.recoil + amount);
  }

  /** Крутить блок стволов пулемёта: speed — оборотов в секунду */
  spin(speed: number, dt: number): void {
    const s = this.gun?.userData.spin as THREE.Object3D | undefined;
    if (!s) return;
    this.spinAngle += speed * Math.PI * 2 * dt;
    s.rotation.z = this.spinAngle;
  }

  /** Рывок: сдвинуться на dist по направлению dir за time секунд */
  dash(dir: THREE.Vector3, dist: number, time: number): void {
    this.dashV.copy(dir).setY(0).normalize().multiplyScalar(dist / time);
    this.dashT = time;
  }
  get dashing(): boolean { return this.dashT > 0; }

  hurt(d: number): void {
    if (this.down) return;
    this.hp = Math.max(0, this.hp - d);
    this.hurtT = 0.15;
  }

  heal(n: number): void {
    if (this.down) return;
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  knockOut(): void {
    this.down = true;
    this.dashT = 0;
    this.akimbo = false;
  }

  revive(x: number, z: number): void {
    this.down = false;
    this.hp = this.maxHp;
    this.pos.set(x, 0, z);
    this.model.rotation.set(0, 0, 0);
  }

  update(dt: number, input: ReadonlySet<string>, aim: THREE.Vector3 | null, colliders: readonly Collider[]): void {
    if (this.down) {
      this.model.rotation.z = lerp(this.model.rotation.z, Math.PI / 2, Math.min(1, dt * 8));
      this.root.position.set(this.pos.x, 0.25, this.pos.z);
      this.ring.position.x = this.pos.x; this.ring.position.z = this.pos.z;
      return;
    }
    this.model.rotation.z = 0;

    const f = new THREE.Vector3(-1, 0, -1).normalize();
    const r = new THREE.Vector3(1, 0, -1).normalize();
    const dir = new THREE.Vector3();
    if (input.has('KeyW') || input.has('ArrowUp')) dir.add(f);
    if (input.has('KeyS') || input.has('ArrowDown')) dir.sub(f);
    if (input.has('KeyD') || input.has('ArrowRight')) dir.add(r);
    if (input.has('KeyA') || input.has('ArrowLeft')) dir.sub(r);
    const moving = dir.lengthSq() > 0;
    if (moving) this.pos.addScaledVector(dir.normalize(), CFG.PLAYER_SPEED * this.speedMul * dt);
    if (this.dashT > 0) {
      this.pos.addScaledVector(this.dashV, Math.min(dt, this.dashT));
      this.dashT -= dt;
    }
    const B = CFG.FIELD;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -B, B);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -B, B);
    for (const c of colliders) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz), min = c.r + 0.35;
      if (d < min && d > 1e-4) { this.pos.x = c.x + (dx / d) * min; this.pos.z = c.z + (dz / d) * min; }
    }

    if (aim) {
      let d = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z) - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 22);
    }

    this.moving = lerp(this.moving, moving ? 1 : 0, Math.min(1, dt * 10));
    this.phase += dt * 11 * this.moving;
    const sw = Math.sin(this.phase) * 0.75 * this.moving;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;

    // стойка: обе руки держат ствол у груди
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.recoilL = Math.max(0, this.recoilL - dt * 9);
    const bob = Math.sin(this.phase * 2) * 0.02 * this.moving;
    this.armR.rotation.set(-1.35 - this.recoil * 0.25, 0.15, 0);
    this.armL.rotation.set(this.akimbo ? -1.35 - this.recoilL * 0.25 : -1.25, this.akimbo ? -0.15 : 0.7, 0);
    this.upper.rotation.set(-this.recoil * 0.06, 0, 0);
    this.hold.position.set(0.16, 0.42 + bob, 0.3 - this.recoil * 0.14);
    this.hold.rotation.set(-this.recoil * 0.22, 0, 0);
    this.holdL.visible = this.akimbo;
    this.holdL.position.set(-0.3, 0.42 - bob, 0.3 - this.recoilL * 0.14);
    this.holdL.rotation.set(-this.recoilL * 0.22, 0, 0);

    // смена оружия: ствол поднимается снизу и встаёт на место
    if (this.equipT < 1) {
      this.equipT = Math.min(1, this.equipT + dt / 0.4);
      const k = easeOut(this.equipT);
      this.hold.position.y -= (1 - k) * 0.45;
      this.hold.rotation.x += (1 - k) * 1.1;
      this.armR.rotation.x += (1 - k) * 0.9;
      this.armL.rotation.x += (1 - k) * 0.9;
      const s = k < 0.7 ? lerp(0.6, 1.08, k / 0.7) : lerp(1.08, 1, (k - 0.7) / 0.3);
      this.hold.scale.setScalar(s);
    } else this.hold.scale.setScalar(1);

    this.hurtT = Math.max(0, this.hurtT - dt);
    this.squash = Math.max(this.squash - dt * 4, this.hurtT > 0 ? 0.6 : 0);
    const lift = Math.abs(Math.sin(this.phase)) * 0.07 * this.moving;
    this.root.position.set(this.pos.x, lift, this.pos.z);
    this.root.rotation.y = this.facing;
    this.model.scale.set(1 + this.squash * 0.15, 1 - this.squash * 0.15, 1 + this.squash * 0.15);
    this.ring.position.x = this.pos.x; this.ring.position.z = this.pos.z;
  }
}
