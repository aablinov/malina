import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { C, rand, RASP } from '../bosses/kit.ts';
import type { Target } from '../target.ts';
import { Mob, type MobHooks } from './mob.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Raspberry Knights (wiki/design-mobs.md, family B): the "golem" skeleton — two legs, torso, helmet, two arms. White armour
 * with raspberry trim, a red cloak with a white berry, a raspberry on the shield, the helmet slit glows white ↔ raspberry.
 */

const EYE = C(2.6, 2.8, 3.4);

const sfx = {
  /** Sword swing */
  swing() { hiss({ dur: 0.18, vol: 0.12, f: 2400, f1: 900, q: 1.2, type: 'bandpass' }); },
  /** Shield bash: a dull clang */
  bash() { boom(120, 50, 0.4, 0.5); voice({ type: 'triangle', f: 330, dur: 0.4, vol: 0.04, verb: 0.4 }); },
};

/** Knight parts: everything that sways */
interface Rig { legs: THREE.Group[]; torso: THREE.Group; head: THREE.Group; arms: THREE.Group[] }

/** Berry emblem of cubes: rows 2-3-3-2-1 and a leaf on top; u — cube size, z — which side (sign — which way it faces) */
function berry(m: Mob, parent: THREE.Object3D, mat: THREE.Material, leaf: THREE.Material, u: number, x: number, y: number, z: number, tilt = 0): void {
  const rows = [[-0.5, 0.5], [-1, 0, 1], [-1, 0, 1], [-0.5, 0.5], [0]];
  rows.forEach((row, i) => { for (const c of row) m.box(parent, mat, u, u, 0.03, x + c * u, y + (1.5 - i) * u, z, tilt); });
  m.box(parent, leaf, u * 1.6, u * 0.6, 0.03, x + u * 0.3, y + 2.4 * u, z, tilt, 0, 0.3);
}

/** Knight body: legs, torso with belt and cloak, helmet with a slit and plume, pauldrons, arms */
function buildKnight(m: Mob, body: THREE.Group, seed: number, plume: boolean): Rig {
  const white = m.lam('#eceae4', pixelTex('#eceae4', 6, seed));
  const trim = m.lam('#c8245a');
  const gold = m.lam('#e8b84a');
  const dark = m.lam('#2a2630');
  const cape = m.lam('#b3122e', pixelTex('#b3122e', 6, seed + 1));
  const snow = m.lam('#fff6ee'), leaf = m.lam('#5aa03a');
  const eye = m.shimmer(EYE, RASP, rnd() * 6, 2);
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
  // emblem on the chest: a raspberry
  berry(m, torso, trim, leaf, 0.07, 0, 0.44, 0.22);
  // cloak: one plate behind the back with a white berry on it
  B(torso, cape, 0.66, 1.0, 0.05, 0, 0.18, -0.25, 0.08);
  berry(m, torso, snow, snow, 0.09, 0, 0.3, -0.285, 0.08);
  // pauldrons with raspberry trim
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

/** Short sword in the right hand: grip, guard, blade along the arm */
function sword(m: Mob, arm: THREE.Group): void {
  const steel = m.lam('#d8dde4'), gold = m.lam('#e8b84a'), grip = m.lam('#5a3a24');
  const B = m.box.bind(m);
  B(arm, grip, 0.07, 0.07, 0.2, 0, -0.62, 0.05);
  B(arm, gold, 0.32, 0.06, 0.08, 0, -0.62, 0.16);
  B(arm, steel, 0.06, 0.12, 0.72, 0, -0.62, 0.54);
  B(arm, m.lam('#c8245a'), 0.07, 0.07, 0.07, 0, -0.62, -0.06);
}

/** Knight step: legs and arms swinging */
function walkPose(r: Rig, s: number, walk: boolean, dt: number): void {
  const k = Math.min(1, dt * 12);
  const a = walk ? s * 0.55 : 0;
  r.legs[0].rotation.x += (a - r.legs[0].rotation.x) * k;
  r.legs[1].rotation.x += (-a - r.legs[1].rotation.x) * k;
}

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };

/** 4. Squire — crowd: a short sword, two swings; weak armour */
export class Squire extends Mob {
  readonly kind = 'squire';
  override readonly knight = true;
  readonly title = t('Squire');
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
    // two swings: for each a short strip in front of him, a hit at its end, a small step forward
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

/** 5. Shieldbearer — wall: the tower shield holds hits from the front, the shield bash knocks back; after the bash the shield is lowered */
export class ShieldKnight extends Mob {
  readonly kind = 'shield';
  override readonly knight = true;
  readonly title = t('Shieldbearer');
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
    // tower shield on the left arm: white field, golden rim, a raspberry with a leaf
    const white = this.lam('#f4f2ec', pixelTex('#f4f2ec', 5, 622)), gold = this.lam('#e8b84a'), leaf = this.lam('#5aa03a');
    const glow = this.shimmer(RASP.clone().multiplyScalar(0.55), C(1.9, 0.8, 1.1), 0, 1.6);
    const B = this.box.bind(this);
    // arm forward by 0.9 rad — the shield stands right in front of the torso
    this.shield.position.set(0.3, -0.75, 0.1);
    this.shield.rotation.x = 0.9;
    this.rig.arms[0].add(this.shield);
    B(this.shield, white, 0.86, 1.25, 0.1, 0, 0, 0);
    for (const [w, hh, x, y] of [[0.94, 0.08, 0, 0.62], [0.94, 0.08, 0, -0.62], [0.08, 1.3, 0.44, 0], [0.08, 1.3, -0.44, 0]] as const) B(this.shield, gold, w, hh, 0.12, x, y, 0);
    berry(this, this.shield, glow, leaf, 0.13, 0, -0.06, 0.07);
    this.place();
  }

  /** Shield up: 0.2 of damage goes through from the front; after the shield bash and when stunned — lowered */
  get shieldUp(): boolean { return !(this.state === 'daze' || (this.state === 'attack' && this.st > 0.75)); }

  protected override guard(dir: THREE.Vector3): number {
    if (!this.shieldUp) return 1;
    // dir — from the hero to the knight; from the front — when the hit comes toward his gaze
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
    // shield lunge forward — and the shield is lowered while the knight straightens up: a window for a hit
    if (t > 0.6 && t < 0.8) this.move(this.bashDir, 7 * dt);
    return t > 1.9;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 10), r = this.rig;
    walkPose(r, this.stride(7), walk, dt);
    // shield in front; in the lunge thrust forward, afterwards lowered
    const bash = this.state === 'attack' ? (this.st < 0.6 ? -0.9 : this.st < 0.8 ? -1.5 : 0.1) : this.state === 'daze' ? 0.2 : -0.9;
    lerpTo(r.arms[0], bash, k);
    lerpTo(r.arms[1], walk ? -0.4 + this.stride(7) * 0.2 : -0.5, k);
    this.body.rotation.x = this.state === 'attack' && this.st < 0.6 ? -0.12 : this.state === 'attack' && this.st < 0.8 ? 0.2 : 0;
  }
}

/** 6. Spearman — range: a 4 m spear thrust along a strip; open after the thrust */
export class Spearman extends Mob {
  readonly kind = 'spear';
  override readonly knight = true;
  readonly title = t('Spearman');
  readonly cost = 4;
  readonly radius = 0.45;
  override readonly topY = 2;
  private readonly rig: Rig;
  private readonly lunge = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 50, at);
    this.speed = 2.8;
    this.keep = 3.4;
    this.rig = buildKnight(this, this.body, 701, true);
    // long spear in the right hand: shaft, raspberry pennant, tip
    const wood = this.lam('#7a5232'), steel = this.lam('#d8dde4'), flag = this.lam('#c8245a');
    const B = this.box.bind(this);
    const arm = this.rig.arms[1];
    B(arm, wood, 0.07, 0.07, 2.4, 0, -0.6, 0.6);
    B(arm, steel, 0.1, 0.14, 0.4, 0, -0.6, 1.95);
    B(arm, flag, 0.03, 0.22, 0.3, 0.04, -0.46, 1.55);
    this.place();
  }

  protected choose(dist: number, rel: number): string | null { return dist < 4.6 && Math.abs(rel) < 0.4 ? 'thrust' : null; }
  protected override rest(): number { return rand(1.2, 1.8); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const from = this.pos.clone();
      this.lunge.copy(this.fwd());
      this.field.markLine(from, this.lunge, 4.2, 0.9, 0.6, () => {
        if (this.dead) return;
        if (!this.quiet) sfx.swing();
        if (this.inLine(from, this.lunge, 4.2, 0.9)) this.hurt(8, from, 5);
      });
    }
    // thrust: a step forward after the spear, then 0.8 s pulling it out — a window
    if (t > 0.6 && t < 0.75) this.move(this.lunge, 4 * dt);
    return t > 1.55;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 12), r = this.rig;
    walkPose(r, this.stride(), walk, dt);
    // spear drawn back — thrust forward — slowly returns
    const spear = this.state === 'attack' ? (this.st < 0.6 ? -1.2 : this.st < 0.75 ? -1.65 : -1.65 + (this.st - 0.75) * 0.5) : -1.4;
    r.arms[1].position.z = this.state === 'attack' ? (this.st < 0.6 ? -0.3 : this.st < 0.75 ? 0.5 : 0.5 - (this.st - 0.75) * 0.6) : 0;
    lerpTo(r.arms[1], spear, this.state === 'attack' ? 1 : k);
    lerpTo(r.arms[0], walk ? -this.stride() * 0.4 : -0.3, k);
  }
}

/** 7. Crossbowman — shooter: a bolt along a line mark; reloads for 2 s — defenceless */
export class Crossbowman extends Mob {
  readonly kind = 'crossbow';
  override readonly knight = true;
  readonly title = t('Crossbowman');
  readonly cost = 4;
  readonly radius = 0.45;
  override readonly topY = 2;
  private readonly rig: Rig;
  private readonly bow = new THREE.Group();
  private readonly aim = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 40, at);
    this.speed = 2.6;
    this.keep = 9;
    this.aggro = 16;
    this.rig = buildKnight(this, this.body, 711, false);
    // both hands hold the crossbow in front of the chest: stock, bow, string
    const wood = this.lam('#7a5232'), steel = this.lam('#a8b0b8'), str = this.lam('#f4ecd8');
    const B = this.box.bind(this);
    this.bow.position.set(0, 1.2, 0.5);
    this.body.add(this.bow);
    B(this.bow, wood, 0.1, 0.1, 0.8, 0, 0, 0);
    B(this.bow, steel, 0.9, 0.08, 0.08, 0, 0.02, 0.3);
    B(this.bow, str, 0.86, 0.02, 0.02, 0, 0.06, 0.1);
    this.place();
  }

  protected choose(dist: number, rel: number): string | null { return dist < 15 && Math.abs(rel) < 0.3 ? 'shoot' : null; }
  protected override rest(): number { return rand(0.6, 1); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const from = this.pos.clone();
      this.aim.copy(this.fwd());
      this.field.markLine(from, this.aim, 15, 0.5, 0.75, () => {
        if (this.dead) return;
        if (!this.quiet) { voice({ type: 'triangle', f: 220, f1: 90, dur: 0.12, vol: 0.06 }); hiss({ dur: 0.2, vol: 0.1, f: 3000, f1: 1200, q: 1, type: 'bandpass' }); }
        this.field.shot(from, this.aim, 15, C(3.4, 2.6, 1.4));
        if (this.inLine(from, this.aim, 15, 0.5)) this.hurt(8, from, 3);
      });
    }
    // 2 s reload: cranks the winch — a window
    return t > 2.8;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 12), r = this.rig;
    walkPose(r, this.stride(), walk, dt);
    const reload = this.state === 'attack' && this.st > 0.8;
    // hands on the crossbow; during reload it is lowered, the right hand cranks the winch
    lerpTo(r.arms[0], reload ? -0.5 : -1.3, k);
    lerpTo(r.arms[1], reload ? -0.6 + Math.sin(this.st * 14) * 0.4 : -1.3, reload ? 1 : k);
    this.bow.rotation.x = reload ? 0.7 : 0;
    this.bow.position.y = reload ? 0.95 : 1.2;
  }
}

/** Planted banner: a target for the sword, falls after three hits; while it stands knights within 6 m are inspired */
class Standard implements Target {
  readonly pos = new THREE.Vector3();
  readonly radius = 0.35;
  readonly topY = 2.6;
  hits = 0;
  up = false;
  readonly group = new THREE.Group();

  private readonly owner: Mob;
  private readonly scene: THREE.Scene;
  constructor(owner: Mob, scene: THREE.Scene, mats: { pole: THREE.Material; cloth: THREE.Material; trim: THREE.Material; berry: THREE.Material }) { this.owner = owner; this.scene = scene;
    const B = owner.box.bind(owner);
    B(this.group, mats.pole, 0.1, 2.8, 0.1, 0, 1.4, 0);
    B(this.group, mats.trim, 0.9, 0.08, 0.08, 0.38, 2.7, 0);
    B(this.group, mats.cloth, 0.8, 1.1, 0.04, 0.38, 2.12, 0);
    berry(owner, this.group, mats.berry, mats.berry, 0.08, 0.38, 2.12, 0.03);
    this.group.visible = false;
    scene.add(this.group);
  }

  get alive(): boolean { return this.up && !this.owner.dead; }

  plant(at: THREE.Vector3): void { this.pos.copy(at).setY(0); this.group.position.copy(this.pos); this.group.visible = true; this.up = true; this.hits = 0; }

  hit(_dmg: number, dir: THREE.Vector3): void {
    if (!this.alive) return;
    this.hits++;
    this.group.rotation.z = -dir.x * 0.15 * this.hits;
    if (this.hits >= 3) this.fall();
  }

  fall(): void { this.up = false; this.group.visible = false; this.group.rotation.set(0, 0, 0); }

  dispose(): void { this.scene.remove(this.group); }
}

/** 8. Bannerman — support: plants a banner, nearby knights +25 % damage and speed; break the banner (3 hits) */
export class BannerBearer extends Mob {
  readonly kind = 'banner';
  override readonly knight = true;
  readonly title = t('Bannerman');
  readonly cost = 7;
  readonly radius = 0.45;
  override readonly topY = 2;
  private readonly rig: Rig;
  private readonly carried = new THREE.Group();
  readonly standard: Standard;
  private plantCd = 0;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 55, at);
    this.speed = 2.6;
    this.keep = 4.5;
    this.loot = 2;
    this.rig = buildKnight(this, this.body, 721, true);
    const mats = { pole: this.lam('#5a3a24'), cloth: this.lam('#b3122e', pixelTex('#b3122e', 6, 722)), trim: this.lam('#e8b84a'), berry: this.lam('#fff6ee') };
    // banner in hand until planted
    const B = this.box.bind(this);
    this.carried.position.set(0, -0.6, 0.1);
    this.rig.arms[1].add(this.carried);
    B(this.carried, mats.pole, 0.08, 2.4, 0.08, 0, 0.6, 0);
    B(this.carried, mats.cloth, 0.6, 0.8, 0.04, 0.3, 1.4, 0);
    berry(this, this.carried, mats.berry, mats.berry, 0.06, 0.3, 1.4, 0.03);
    this.standard = new Standard(this, h.scene, mats);
    this.place();
  }

  override extras(): Target[] { return this.standard.alive ? [this.standard] : []; }

  override dispose(): void { super.dispose(); this.standard.dispose(); }

  protected override die(): void { super.die(); this.standard.fall(); }

  protected choose(dist: number): string | null {
    if (!this.standard.up && this.plantCd <= 0) return 'plant';
    return dist < 2.2 ? 'poke' : null;
  }

  override update(dt: number): void {
    this.plantCd -= dt;
    const was = this.standard.up;
    super.update(dt);
    if (was && !this.standard.up && !this.dead) { this.plantCd = 6; this.h.fx.burst(this.standard.pos.clone().setY(1.5), ['#b3122e', '#e8b84a'], 12, { speed: 3, up: 2, size: 0.1, life: 0.6, gravity: 6 }); }
    this.carried.visible = !this.standard.up;
    // the banner inspires knights within 6 m, and the bannerman himself
    if (this.standard.alive) {
      for (const m of this.mh.allies()) if (m.knight && Math.hypot(m.pos.x - this.standard.pos.x, m.pos.z - this.standard.pos.z) < 6) m.rally = 0.3;
      this.standard.group.children[2].rotation.y = Math.sin(this.time * 2) * 0.15;
    }
  }

  protected act(name: string, t: number, dt: number): boolean {
    if (name === 'plant') {
      // raised the banner — and slams it into the ground, a raspberry wave in a 6 m circle
      if (t >= 0.6 && t - dt < 0.6) {
        const at = this.pos.clone().addScaledVector(this.fwd(), 0.9);
        this.standard.plant(at);
        if (!this.quiet) { boom(140, 60, 0.4, 0.4); voice({ type: 'triangle', f: 392, f1: 523, dur: 0.6, vol: 0.05, verb: 0.5 }); }
        this.h.fx.shock(at.clone().setY(0.1), 6, RASP.clone().multiplyScalar(0.4), 0.5, 0.12);
      }
      return t > 0.9;
    }
    if (t - dt <= 0) this.field.markCircle(this.pos.clone().addScaledVector(this.fwd(), 1), 1.1, 0.45, () => { if (!this.dead && this.inCircle(this.pos.clone().addScaledVector(this.fwd(), 1), 1.1)) this.hurt(5, this.pos, 4); });
    return t > 0.7;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 12), r = this.rig;
    walkPose(r, this.stride(), walk, dt);
    const plant = this.state === 'attack' && this.attack === 'plant';
    lerpTo(r.arms[1], plant ? (this.st < 0.6 ? -2.6 : -0.6) : this.standard.up ? -0.5 : -0.2, plant ? k * 1.5 : k);
    lerpTo(r.arms[0], this.state === 'attack' && !plant ? -1.4 : walk ? -this.stride() * 0.4 : 0, k);
  }
}

/** 9. Hammerer — tank: a two-handed hammer onto a circle mark; slow, stunned after the hit */
export class Hammerer extends Mob {
  readonly kind = 'hammer';
  override readonly knight = true;
  readonly title = t('Hammerer');
  readonly cost = 9;
  readonly radius = 0.65;
  override readonly topY = 2.5;
  private readonly rig: Rig;
  private readonly big = new THREE.Group();
  private readonly smashAt = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 120, at);
    this.speed = 1.8;
    this.turn = 2.5;
    this.keep = 2;
    this.mass = 3;
    this.loot = 3;
    // bigger than the other knights
    this.big.scale.setScalar(1.25);
    this.body.add(this.big);
    this.rig = buildKnight(this, this.big, 731, true);
    // hammer in both hands: long handle, head with a raspberry stripe
    const wood = this.lam('#5a3a24'), steel = this.lam('#c8ccd2', pixelTex('#c8ccd2', 6, 732)), trim = this.lam('#c8245a');
    const B = this.box.bind(this);
    const arm = this.rig.arms[1];
    B(arm, wood, 0.09, 0.09, 1.3, 0, -0.62, 0.35);
    B(arm, steel, 0.5, 0.4, 0.4, 0, -0.62, 1.05);
    B(arm, trim, 0.52, 0.1, 0.42, 0, -0.62, 1.05);
    this.place();
  }

  protected choose(dist: number, rel: number): string | null { return dist < 3.6 && Math.abs(rel) < 0.5 ? 'smash' : null; }
  protected override rest(): number { return rand(1.4, 2); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      this.smashAt.copy(this.pos).addScaledVector(this.fwd(), 1.8);
      this.field.markCircle(this.smashAt, 2.2, 1, () => {
        if (this.dead) return;
        if (!this.quiet) { boom(70, 25, 0.8, 0.8, 0, 0.4); hiss({ dur: 0.4, vol: 0.15, f: 800, f1: 150, q: 0.5, type: 'lowpass' }); }
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.5);
        this.h.fx.shock(this.smashAt.clone().setY(0.1), 2.4, C(1.6, 1.4, 1.2), 0.35, 0.15);
        this.h.fx.burst(this.smashAt.clone().setY(0.2), ['#8a8a8a', '#c8b89a'], 14, { speed: 4, up: 3, size: 0.12, life: 0.5, gravity: 8 });
        if (this.inCircle(this.smashAt, 2.2)) this.hurt(16, this.smashAt, 9);
      });
    }
    // the hammer is stuck: stunned 1.4 s
    if (t >= 1.1) { this.daze(1.4); return false; }
    return false;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 8), r = this.rig;
    walkPose(r, this.stride(6), walk, dt);
    // hammer over the head — and down; when stunned it lies on the ground
    const a = this.state === 'attack' ? (this.st < 1 ? -2.9 * Math.min(1, this.st / 0.7) : 0.3) : this.state === 'daze' ? 0.4 : -0.7;
    lerpTo(r.arms[1], a, this.state === 'attack' && this.st >= 1 ? 1 : k);
    lerpTo(r.arms[0], a, this.state === 'attack' && this.st >= 1 ? 1 : k);
    this.body.rotation.x = this.state === 'attack' && this.st >= 1 ? 0.25 : this.state === 'daze' ? 0.2 : 0;
  }
}
