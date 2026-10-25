import * as THREE from 'three';
import { pixelTex } from '../textures';
import { boom, hiss, voice } from '../spell-audio';
import { C, rand, RASP } from '../bosses/kit';
import { Mob, type MobHooks } from './mob';

/**
 * Рыцари Малины (wiki/design-mobs.md, семья B): скелет «голем» — две ноги, корпус, шлем, две руки. Белые доспехи
 * с малиновой каймой, красный плащ с белой ягодой, на щите — малина, щель шлема светится белым ↔ малиновым.
 */

const EYE = C(2.6, 2.8, 3.4);

const sfx = {
  /** Взмах меча */
  swing() { hiss({ dur: 0.18, vol: 0.12, f: 2400, f1: 900, q: 1.2, type: 'bandpass' }); },
  /** Удар щитом: глухой лязг */
  bash() { boom(120, 50, 0.4, 0.5); voice({ type: 'triangle', f: 330, dur: 0.4, vol: 0.04, verb: 0.4 }); },
};

/** Части рыцаря: всё, что качается */
interface Rig { legs: THREE.Group[]; torso: THREE.Group; head: THREE.Group; arms: THREE.Group[] }

/** Ягода-герб из кубиков: ряды 2-3-3-2-1 и листик сверху; u — размер кубика, z — на какой стороне (знак — куда смотрит) */
function berry(m: Mob, parent: THREE.Object3D, mat: THREE.Material, leaf: THREE.Material, u: number, x: number, y: number, z: number, tilt = 0): void {
  const rows = [[-0.5, 0.5], [-1, 0, 1], [-1, 0, 1], [-0.5, 0.5], [0]];
  rows.forEach((row, i) => { for (const c of row) m.box(parent, mat, u, u, 0.03, x + c * u, y + (1.5 - i) * u, z, tilt); });
  m.box(parent, leaf, u * 1.6, u * 0.6, 0.03, x + u * 0.3, y + 2.4 * u, z, tilt, 0, 0.3);
}

/** Тело рыцаря: ноги, корпус с поясом и плащом, шлем со щелью и плюмажем, наплечники, руки */
function buildKnight(m: Mob, body: THREE.Group, seed: number, plume: boolean): Rig {
  const white = m.lam('#eceae4', pixelTex('#eceae4', 6, seed));
  const trim = m.lam('#c8245a');
  const gold = m.lam('#e8b84a');
  const dark = m.lam('#2a2630');
  const cape = m.lam('#b3122e', pixelTex('#b3122e', 6, seed + 1));
  const snow = m.lam('#fff6ee'), leaf = m.lam('#5aa03a');
  const eye = m.shimmer(EYE, RASP, Math.random() * 6, 2);
  const B = m.box.bind(m);
  const legs = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.17, 0.72, 0);
    body.add(g);
    B(g, white, 0.26, 0.6, 0.3, 0, -0.3, 0);
    B(g, dark, 0.28, 0.14, 0.34, 0, -0.65, 0.02);
    return g;
  });
  const torso = new THREE.Group();
  torso.position.y = 0.72;
  body.add(torso);
  B(torso, white, 0.7, 0.74, 0.42, 0, 0.37, 0);
  B(torso, trim, 0.72, 0.1, 0.44, 0, 0.06, 0);
  B(torso, gold, 0.14, 0.12, 0.05, 0, 0.06, 0.23);
  // герб на груди: малиновая ягода
  berry(m, torso, trim, leaf, 0.07, 0, 0.44, 0.22);
  // плащ: одна пластина за спиной, на ней белая ягода
  B(torso, cape, 0.66, 1.0, 0.05, 0, 0.18, -0.25, 0.08);
  berry(m, torso, snow, snow, 0.09, 0, 0.3, -0.285, 0.08);
  // наплечники с малиновой каймой
  for (const s of [-1, 1]) { B(torso, white, 0.3, 0.16, 0.46, s * 0.44, 0.74, 0); B(torso, trim, 0.32, 0.05, 0.48, s * 0.44, 0.66, 0); }
  const head = new THREE.Group();
  head.position.y = 1.46;
  body.add(head);
  B(head, white, 0.5, 0.52, 0.5, 0, 0.26, 0);
  B(head, dark, 0.38, 0.1, 0.03, 0, 0.3, 0.255);
  B(head, eye, 0.3, 0.05, 0.03, 0, 0.3, 0.26);
  B(head, trim, 0.52, 0.06, 0.52, 0, 0.06, 0);
  if (plume) B(head, trim, 0.1, 0.18, 0.46, 0, 0.6, -0.02);
  else B(head, gold, 0.08, 0.1, 0.08, 0, 0.56, 0);
  const arms = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.46, 1.36, 0);
    body.add(g);
    B(g, white, 0.2, 0.6, 0.24, 0, -0.28, 0);
    B(g, dark, 0.22, 0.14, 0.26, 0, -0.58, 0);
    return g;
  });
  return { legs, torso, head, arms };
}

/** Короткий меч в правой руке: рукоять, гарда, клинок вдоль руки */
function sword(m: Mob, arm: THREE.Group): void {
  const steel = m.lam('#d8dde4'), gold = m.lam('#e8b84a'), grip = m.lam('#5a3a24');
  const B = m.box.bind(m);
  B(arm, grip, 0.07, 0.07, 0.2, 0, -0.62, 0.05);
  B(arm, gold, 0.32, 0.06, 0.08, 0, -0.62, 0.16);
  B(arm, steel, 0.06, 0.12, 0.72, 0, -0.62, 0.54);
  B(arm, m.lam('#c8245a'), 0.07, 0.07, 0.07, 0, -0.62, -0.06);
}

/** Шаг рыцаря: ноги и руки вразмах */
function walkPose(r: Rig, s: number, walk: boolean, dt: number): void {
  const k = Math.min(1, dt * 12);
  const a = walk ? s * 0.55 : 0;
  r.legs[0].rotation.x += (a - r.legs[0].rotation.x) * k;
  r.legs[1].rotation.x += (-a - r.legs[1].rotation.x) * k;
}

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };

/** 4. Оруженосец — толпа: короткий меч, два взмаха; слабая броня */
export class Squire extends Mob {
  readonly kind = 'squire';
  readonly title = 'Оруженосец';
  readonly cost = 3;
  readonly radius = 0.45;
  override readonly topY = 2;
  private readonly rig: Rig;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 45, at);
    this.speed = 3.3;
    this.keep = 1.5;
    this.rig = buildKnight(this, this.body, 611, false);
    sword(this, this.rig.arms[1]);
    this.place();
  }

  protected choose(dist: number): string | null { return dist < 2.6 ? 'slash' : null; }

  protected act(_name: string, t: number, dt: number): boolean {
    // два взмаха: на каждый — короткая полоса перед ним, удар по её концу, шажок вперёд
    for (const at of [0, 0.55]) {
      if (t >= at && t - dt < at) {
        const from = this.pos.clone(), dir = this.fwd();
        this.field.markLine(from, dir, 2.3, 1.8, 0.4, () => {
          if (this.dead) return;
          if (!this.quiet) sfx.swing();
          this.move(dir, 0.35);
          if (this.inLine(from, dir, 2.3, 1.8)) this.hurt(6, this.pos, 3);
        });
      }
    }
    if (t < 0.4) this.face(dt, 0.6);
    return t > 1.2;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 14), r = this.rig;
    walkPose(r, this.stride(), walk, dt);
    let sword = walk ? -0.5 + this.stride() * 0.3 : -0.6;
    if (this.state === 'attack') { const u = this.st % 0.55; sword = u < 0.4 ? -0.4 - (u / 0.4) * 2.2 : -2.6 + ((u - 0.4) / 0.15) * 2.4; }
    lerpTo(r.arms[1], sword, this.state === 'attack' ? 1 : k);
    lerpTo(r.arms[0], walk ? -this.stride() * 0.4 : 0, k);
    this.body.rotation.x = this.state === 'daze' ? 0.25 : 0;
  }
}

/** 5. Щитоносец — стена: башенный щит держит удары спереди, удар щитом отбрасывает; после удара щит опущен */
export class ShieldKnight extends Mob {
  readonly kind = 'shield';
  readonly title = 'Щитоносец';
  readonly cost = 6;
  readonly radius = 0.55;
  override readonly topY = 2.1;
  private readonly rig: Rig;
  private readonly shield = new THREE.Group();
  private bashDir = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 80, at);
    this.speed = 2.3;
    this.turn = 3;
    this.keep = 1.8;
    this.mass = 2.5;
    this.loot = 2;
    this.rig = buildKnight(this, this.body, 621, true);
    sword(this, this.rig.arms[1]);
    // башенный щит на левой руке: белое поле, золотой обод, малина с листиком
    const white = this.lam('#f4f2ec', pixelTex('#f4f2ec', 5, 622)), gold = this.lam('#e8b84a'), leaf = this.lam('#5aa03a');
    const glow = this.shimmer(RASP.clone().multiplyScalar(0.55), C(1.9, 0.8, 1.1), 0, 1.6);
    const B = this.box.bind(this);
    // рука вперёд на 0,9 рад — щит стоит прямо перед корпусом
    this.shield.position.set(0.3, -0.75, 0.1);
    this.shield.rotation.x = 0.9;
    this.rig.arms[0].add(this.shield);
    B(this.shield, white, 0.86, 1.25, 0.1, 0, 0, 0);
    for (const [w, hh, x, y] of [[0.94, 0.08, 0, 0.62], [0.94, 0.08, 0, -0.62], [0.08, 1.3, 0.44, 0], [0.08, 1.3, -0.44, 0]] as const) B(this.shield, gold, w, hh, 0.12, x, y, 0);
    berry(this, this.shield, glow, leaf, 0.13, 0, -0.06, 0.07);
    this.place();
  }

  /** Щит поднят: спереди проходит 0,2 урона; после удара щитом и в оглушении — опущен */
  get shieldUp(): boolean { return !(this.state === 'daze' || (this.state === 'attack' && this.st > 0.75)); }

  protected override guard(dir: THREE.Vector3): number {
    if (!this.shieldUp) return 1;
    // dir — от героя к рыцарю; спереди — когда удар летит навстречу взгляду
    const f = this.fwd();
    return dir.x * f.x + dir.z * f.z < -0.3 ? 0.2 : 1;
  }

  protected choose(dist: number, rel: number): string | null { return dist < 3.2 && Math.abs(rel) < 0.5 ? 'bash' : null; }
  protected override rest(): number { return rand(1.4, 2); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const from = this.pos.clone();
      this.bashDir.copy(this.fwd());
      this.field.markLine(from, this.bashDir, 3, 1.4, 0.7, () => {
        if (this.dead) return;
        if (!this.quiet) sfx.bash();
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.2);
        if (this.inLine(from, this.bashDir, 3, 1.4)) this.hurt(10, from, 8);
      });
    }
    // рывок щитом вперёд — и щит опущен, пока рыцарь выпрямляется: окно для удара
    if (t > 0.6 && t < 0.8) this.move(this.bashDir, 7 * dt);
    return t > 1.9;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 10), r = this.rig;
    walkPose(r, this.stride(7), walk, dt);
    // щит перед собой; в рывке — выброшен вперёд, после — опущен
    const bash = this.state === 'attack' ? (this.st < 0.6 ? -0.9 : this.st < 0.8 ? -1.5 : 0.1) : this.state === 'daze' ? 0.2 : -0.9;
    lerpTo(r.arms[0], bash, k);
    lerpTo(r.arms[1], walk ? -0.4 + this.stride(7) * 0.2 : -0.5, k);
    this.body.rotation.x = this.state === 'attack' && this.st < 0.6 ? -0.12 : this.state === 'attack' && this.st < 0.8 ? 0.2 : 0;
  }
}
