import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { bell, boom, deg, hiss, pluck, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, wrap, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Golden Warden — mini-boss (wiki/design-bosses.md, section 2): a rider of the Order in golden armour on a white-and-gold horse under
 * a raspberry caparison, a halberd in hand, a round shield overgrown with raspberry vine on the left arm. Attacks: a charge along a strip across
 * the whole arena (crashed into a wall — the horse stumbles, dazed, the berry emblem on the horse's chest open); a circular halberd sweep;
 * "phalanx" — a fan of seven ghostly swords, they fly one by one, each with its own pentatonic note — a chord together.
 * Shield: a hit from the front (±60°) — damage ×0.3. Drops "Phalanx of Blades".
 * Moving parts: horse, horse head, front pair of legs, hind pair of legs, rider, halberd, emblem (+ seven swords separately).
 */

const GOLD = C(4, 3, 1), SPECTRAL = C(2.6, 3, 4), DUST = ['#c8b890', '#9a8f70'];
/** Root of the sword chord: G4 */
const ROOT = 392;
const LANCE_LEN = 16, LANCE_W = 2.4, LANCE_SPEED = 15;
const BLADES = 7, BLADE_GAP = 0.18, BLADE_FLY = 0.45, BLADE_R = 1.1;

const sfx = {
  /** Hooves: two dull thuds */
  hoof() { boom(95, 45, 0.16, 0.22); boom(80, 40, 0.14, 0.18, 0.07); },
  /** Neigh: a saw with vibrato going down */
  neigh() {
    for (let i = 0; i < 4; i++) voice({ type: 'sawtooth', f: 620 - i * 60, f1: 480 - i * 70, dur: 0.16, vol: 0.035, delay: i * 0.12, detune: 25, lp: 2400, verb: 0.4 });
    hiss({ dur: 0.6, vol: 0.08, f: 2400, f1: 900, q: 0.8, verb: 0.3 });
  },
  /** Shield: metallic ring, non-harmonic overtones */
  clink() { for (const [f, d] of [[1240, 0], [1870, 0.005], [2630, 0.01]] as const) voice({ type: 'triangle', f, dur: 0.35, vol: 0.035, delay: d, verb: 0.35 }); hiss({ dur: 0.08, vol: 0.12, f: 5000, q: 1.2 }); },
  /** Halberd sweep: whistle */
  swing() { hiss({ dur: 0.45, vol: 0.25, f: 600, f1: 2600, q: 1.4 }); },
  /** Charge begins: horn and hoofbeats */
  charge() { voice({ type: 'sawtooth', f: 196, f1: 262, dur: 0.6, vol: 0.05, lp: 1400, verb: 0.5 }); boom(70, 35, 0.5, 0.5); },
  /** Crashed into a wall */
  crash() { boom(65, 22, 1, 0.9, 0, 0.5); hiss({ dur: 0.7, vol: 0.25, f: 1800, f1: 200, q: 0.5, type: 'lowpass' }); this.clink(); },
  /** A sword broke loose: its own pentatonic step, the bells build up into a chord */
  note(i: number) { bell(deg(ROOT, i), 1.6, 0.05, 0, 0.6); pluck(deg(ROOT / 2, i), 0.04); },
  /** A sword stuck in */
  stab() { boom(160, 70, 0.18, 0.2); hiss({ dur: 0.15, vol: 0.1, f: 3000, f1: 800, q: 0.9 }); },
};

/** Ghostly sword of the phalanx: hangs in the fan → flies straight into the mark */
interface Blade { g: THREE.Group; phase: 'off' | 'hover' | 'fly'; t: number; from: THREE.Vector3; to: THREE.Vector3 }

export class GoldenRider extends MiniBoss {
  readonly radius = 1.6;
  readonly title = t('Golden Warden');
  override readonly topY = 3.9;
  readonly drop = 'bladephalanx';
  private readonly horse = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legsF = new THREE.Group();
  private readonly legsB = new THREE.Group();
  private readonly rider = new THREE.Group();
  private readonly halberd = new THREE.Group();
  private readonly emblem = new THREE.Group();
  private readonly blades: Blade[] = [];
  private gait = 0;
  private readonly lanceDir = new THREE.Vector3();
  private lanceRun = 0;
  private lanceHit = false;

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 900, home, yaw, arena);
    this.speed = 4.5;
    this.keep = 3;
    this.turn = 2.6;
    this.build();
    this.reset();
  }

  protected build(): void {
    const coat = this.lam('#d9d2c0', pixelTex('#d9d2c0', 6, 431));
    const gold = this.lam('#e8b84a', pixelTex('#e8b84a', 8, 432));
    const cloth = this.lam('#a8143e', pixelTex('#a8143e', 8, 433));
    const dark = this.lam('#4a3a2e');
    const wood = this.lam('#7a5232');
    const steel = this.lam('#c9c6cf');
    const vine = this.lam('#3f7a34');
    const berry = this.shimmer(RASP, C(4, 1.7, 2.4), 1, 3);
    const heart = this.shimmer(GOLD, RASP, 0, 3);
    const glow = this.shimmer(GOLD, RASP, 2, 2);
    const B = this.box.bind(this);
    this.body.add(this.horse);
    // horse: body, armour on the croup and chest, raspberry caparison at the sides, tail
    B(this.horse, coat, 1.3, 1.1, 2.6, 0, 1.75, 0);
    B(this.horse, gold, 1.36, 0.5, 0.7, 0, 1.95, 1.0);
    B(this.horse, gold, 1.36, 0.45, 0.8, 0, 2.05, -0.95);
    for (const s of [-1, 1]) {
      B(this.horse, cloth, 0.08, 0.9, 2.2, s * 0.7, 1.55, 0);
      B(this.horse, gold, 0.1, 0.12, 2.2, s * 0.71, 1.12, 0);
    }
    B(this.horse, dark, 0.25, 0.9, 0.25, 0, 1.5, -1.4, -0.4);
    // emblem of the Order on the horse's chest — a berry of cubes: the heart, ×2 on it when the horse has stumbled
    this.emblem.position.set(0, 1.6, 1.34);
    this.horse.add(this.emblem);
    for (const [x, y, k] of [[0, 0, 0.32], [0.21, 0.18, 0.22], [-0.21, 0.18, 0.22], [0.21, -0.18, 0.22], [-0.21, -0.18, 0.22], [0, 0.34, 0.18], [0, -0.34, 0.18]] as const) B(this.emblem, heart, k, k, 0.12, x, y, 0);
    B(this.emblem, gold, 0.14, 0.2, 0.1, 0, 0.54, 0);
    // head: neck, muzzle in a golden chanfron, mane, eyes
    this.head.position.set(0, 2.1, 1.2);
    this.horse.add(this.head);
    B(this.head, coat, 0.6, 1.0, 0.6, 0, 0.45, 0.15, 0.45);
    B(this.head, coat, 0.55, 0.5, 1.0, 0, 0.95, 0.6);
    B(this.head, gold, 0.6, 0.2, 0.7, 0, 1.22, 0.55);
    B(this.head, gold, 0.12, 0.35, 0.12, 0, 1.45, 0.4);
    B(this.head, cloth, 0.16, 0.9, 0.3, 0, 0.75, -0.1, 0.45);
    for (const s of [-1, 1]) B(this.head, glowMat(GOLD), 0.06, 0.08, 0.12, s * 0.28, 1.02, 0.75);
    // legs in pairs: each pair is one part, swings in the gallop
    for (const [g, z] of [[this.legsF, 0.95], [this.legsB, -0.95]] as const) {
      g.position.set(0, 1.3, z);
      this.horse.add(g);
      for (const s of [-1, 1]) { B(g, coat, 0.32, 1.15, 0.32, s * 0.38, -0.6, 0); B(g, gold, 0.36, 0.2, 0.36, s * 0.38, -1.15, 0); }
    }
    // rider: armour, helmet with a plume, on the left arm (+x) — a shield with vine and berries
    this.rider.position.set(0, 2.3, -0.15);
    this.body.add(this.rider);
    B(this.rider, gold, 0.8, 0.9, 0.55, 0, 0.55, 0);
    B(this.rider, cloth, 0.84, 0.2, 0.58, 0, 0.15, 0);
    B(this.rider, gold, 0.56, 0.55, 0.55, 0, 1.3, 0);
    B(this.rider, dark, 0.42, 0.08, 0.05, 0, 1.3, 0.28);
    B(this.rider, glowMat(GOLD), 0.3, 0.04, 0.03, 0, 1.3, 0.31);
    B(this.rider, cloth, 0.14, 0.45, 0.7, 0, 1.72, -0.1);
    for (const s of [-1, 1]) B(this.rider, gold, 0.3, 0.3, 0.4, s * 0.52, 0.95, 0);
    const shield = new THREE.Group();
    shield.position.set(0.62, 0.6, 0.15);
    this.rider.add(shield);
    B(shield, gold, 0.12, 0.95, 0.95, 0, 0, 0, Math.PI / 4);
    B(shield, gold, 0.14, 1.0, 0.7, 0);
    B(shield, glow, 0.16, 0.24, 0.24, 0.02, 0, 0);
    for (const [y, z] of [[0.35, -0.3], [0.1, 0.38], [-0.3, -0.15], [-0.4, 0.3]] as const) { B(shield, vine, 0.18, 0.12, 0.42, 0.04, y, z, 0.6); B(shield, berry, 0.14, 0.14, 0.14, 0.1, y + 0.08, z); }
    // halberd: pivot at the rider's centre, the shaft to the right (−x); order YXZ — tilt, then rotation
    this.halberd.position.set(0, 0.7, 0);
    this.halberd.rotation.order = 'YXZ';
    this.rider.add(this.halberd);
    B(this.halberd, wood, 0.12, 3.0, 0.12, -0.7, 0.6, 0);
    B(this.halberd, steel, 0.08, 0.55, 0.7, -0.7, 1.75, 0.3);
    B(this.halberd, steel, 0.08, 0.5, 0.08, -0.7, 2.3, 0);
    B(this.halberd, glow, 0.1, 0.1, 0.5, -0.7, 1.75, 0.3);
    // seven ghostly swords — in the scene, hidden until the "phalanx"
    for (let i = 0; i < BLADES; i++) {
      const g = new THREE.Group();
      const m = this.shimmer(SPECTRAL, i % 2 ? GOLD : RASP, i * 0.6, 4);
      B(g, m, 0.1, 1.3, 0.04, 0, 0.65, 0);
      B(g, m, 0.42, 0.07, 0.07, 0, 0, 0);
      B(g, m, 0.07, 0.3, 0.07, 0, -0.18, 0);
      g.visible = false;
      this.h.scene.add(g);
      this.blades.push({ g, phase: 'off', t: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
  }

  override reset(): void { super.reset(); this.hideBlades(); }
  protected override die(): void { this.hideBlades(); super.die(); }
  protected override cry(): void { if (!this.quiet) { sfx.neigh(); boom(70, 30, 0.8, 0.4, 0.1, 0.5); } }

  /**
   * Shield: a hit while the hero is in front (±60°) — damage ×0.3. Only hits with knockback (sword, arrows, spells); zones and service
   * damage without knockback the shield does not catch. A dazed warden has lowered the shield.
   */
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.awake && !this.dead && this.state !== 'daze' && knock > 0) {
      const hero = this.h.hero.pos;
      if (Math.abs(wrap(Math.atan2(hero.x - this.pos.x, hero.z - this.pos.z) - this.yaw)) < Math.PI / 3) {
        dmg *= 0.3;
        const at = this.pos.clone().addScaledVector(this.fwd(), 0.9).setY(this.topY - 1);
        this.h.fx.text(at.clone().setY(at.y + 0.6), t('shield'), '');
        this.h.fx.burst(at, [GOLD, '#fff2c0'], 8, { speed: 4, up: 2, size: 0.07, life: 0.3, glow: true, gravity: 8 });
        if (!this.quiet) sfx.clink();
      }
    }
    super.hit(dmg, dir, point, knock);
  }

  protected choose(dist: number): string | null {
    if (dist < 4) return 'sweep';
    if (dist > 6 && rnd() < 0.55) return 'lance';
    return rnd() < 0.5 ? 'blades' : 'lance';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'lance': {
        // reared up, a strip across the arena → gallop straight through; ran into a wall — stumbled, dazed
        const AIM = 0.7;
        if (!this.hitDone) {
          this.hitDone = true;
          const to = this.heroAt().sub(this.pos.clone().setY(0));
          this.lanceDir.copy(to.lengthSq() > 1e-4 ? to.normalize() : this.fwd());
          this.yaw = Math.atan2(this.lanceDir.x, this.lanceDir.z);
          this.lanceRun = 0; this.lanceHit = false;
          this.markLine(this.pos, this.lanceDir, LANCE_LEN, LANCE_W, AIM, () => undefined);
          if (!this.quiet) sfx.neigh();
        }
        if (t < AIM) return false;
        if (t - dt < AIM && !this.quiet) sfx.charge();
        const step = LANCE_SPEED * this.speedK * dt, a = this.arena, R = this.radius + 0.15;
        const nx = this.pos.x + this.lanceDir.x * step, nz = this.pos.z + this.lanceDir.z * step;
        const wall = nx < a.x0 + R || nx > a.x1 - R || nz < a.z0 + R || nz > a.z1 - R;
        if (!wall) { this.move(this.lanceDir, step); this.lanceRun += step; }
        // the spear and the horse's chest: a strip in front of the warden
        if (!this.lanceHit && this.inLine(this.pos.clone().addScaledVector(this.lanceDir, -this.radius), this.lanceDir, this.radius * 2 + 1.6, LANCE_W)) {
          this.lanceHit = true;
          this.hurt(20, this.pos, 10);
          fx.hitstop = Math.max(fx.hitstop, 0.05);
        }
        if (rnd() < 0.6) fx.burst(this.pos.clone().setY(0.15), DUST, 2, { speed: 1.5, up: 1, size: 0.12, life: 0.5, gravity: 5 });
        if (wall && this.lanceRun < LANCE_LEN - 0.5) {
          if (!this.quiet) sfx.crash();
          fx.shake = Math.max(fx.shake, 0.9);
          fx.shock(this.pos.clone().addScaledVector(this.lanceDir, this.radius).setY(0.1), 2.5, GOLD, 0.4, 0.2);
          fx.burst(this.pos.clone().addScaledVector(this.lanceDir, this.radius).setY(1.5), [...DUST, GOLD], 20, { speed: 5, up: 4, size: 0.14, life: 0.8, gravity: 10 });
          this.daze(2);
          return true;
        }
        if (wall || this.lanceRun >= LANCE_LEN) return true;
        return false;
      }
      case 'sweep': {
        // halberd to the side — a circle; at the end a full turn
        if (!this.hitDone) { this.hitDone = true; this.markCircle(this.pos, 3.5, 0.6, () => undefined); }
        if (t >= 0.6 && t - dt < 0.6) {
          if (!this.quiet) sfx.swing();
          for (let i = 0; i < 4; i++) fx.arc(this.pos, this.yaw + i * Math.PI / 2, GOLD, 3.4, 1.6, 2.2);
          fx.shock(this.pos.clone().setY(0.1), 3.6, GOLD, 0.35, 0.18);
          if (this.inCircle(this.pos, 3.5)) this.hurt(16, this.pos, 7);
        }
        return t > 1.05;
      }
      case 'blades': {
        // a fan of swords above the rider; one by one they break loose at the hero, each with its own note
        if (!this.hitDone) {
          this.hitDone = true;
          for (const b of this.blades) { b.phase = 'hover'; b.t = 0; b.g.visible = true; }
          if (!this.quiet) bell(deg(ROOT, -5), 1.2, 0.04);
        }
        const gap = BLADE_GAP / this.speedK;
        for (let i = 0; i < BLADES; i++) {
          const at = 0.6 + i * gap, b = this.blades[i];
          if (t >= at && t - dt < at && b.phase === 'hover') {
            b.phase = 'fly'; b.t = 0;
            b.from.copy(b.g.position);
            b.to.copy(this.clampIn(this.heroAt().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(i === 0 ? 0 : 0.9)), 0.8));
            this.markCircle(b.to, BLADE_R, BLADE_FLY, () => undefined);
            if (!this.quiet) sfx.note(i);
          }
        }
        return t > 0.6 + BLADES * gap + 0.2;
      }
    }
    return true;
  }

  private hideBlades(): void { for (const b of this.blades) { b.phase = 'off'; b.g.visible = false; } }

  /** Swords: hang in a fan above the rider, fly straight, stick in */
  private tickBlades(dt: number): void {
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const center = this.pos.clone().setY(this.flyY + this.body.position.y + 4.4).addScaledVector(this.fwd(), -0.3);
    this.blades.forEach((b, i) => {
      if (b.phase === 'off') return;
      b.t += dt;
      if (b.phase === 'hover') {
        const a = ((i - (BLADES - 1) / 2) / ((BLADES - 1) / 2)) * 1.05;
        const dir = side.clone().multiplyScalar(Math.sin(a)).addScaledVector(up, Math.cos(a));
        b.g.position.copy(center).addScaledVector(dir, 1.3).addScaledVector(up, Math.sin(this.time * 4 + i) * 0.06);
        b.g.quaternion.setFromUnitVectors(up, dir);
        b.g.scale.setScalar(Math.min(1, b.t / 0.35));
        return;
      }
      const k = Math.min(1, b.t / BLADE_FLY);
      const d = b.to.clone().setY(0.2).sub(b.from).normalize();
      b.g.position.lerpVectors(b.from, b.to.clone().setY(0.2), k);
      b.g.quaternion.setFromUnitVectors(up, d.negate());
      if (rnd() < 0.8) this.h.fx.particle({ pos: b.g.position.clone(), vel: new THREE.Vector3(0, 0.3, 0), life: 0.3, size: 0.08, color: i % 2 ? GOLD : RASP, gravity: 0 });
      if (k >= 1) {
        b.phase = 'off'; b.g.visible = false;
        if (!this.quiet) sfx.stab();
        this.h.fx.burst(b.to.clone().setY(0.3), [SPECTRAL, GOLD, RASP], 10, { speed: 3, up: 3, size: 0.08, life: 0.5, glow: true, gravity: 6 });
        this.h.fx.shock(b.to.clone().setY(0.06), BLADE_R, SPECTRAL, 0.25, 0.1);
        if (this.state !== 'dead' && this.inCircle(b.to, BLADE_R)) this.hurt(10, b.to, 3);
      }
    });
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st;
    const charging = this.state === 'attack' && this.attack === 'lance' && S >= 0.7;
    const rearing = this.state === 'attack' && this.attack === 'lance' && S < 0.7;
    // gallop: leg pairs out of step, the body sways, the head nods, hoofbeats and dust on every beat
    if (walk || charging) {
      const was = this.gait % 1;
      this.gait += dt * (charging ? 3.2 : 2.1) * this.speedK;
      const k = this.gait % 1, ph = k * Math.PI * 2;
      this.legsF.rotation.x = Math.sin(ph) * 0.7;
      this.legsB.rotation.x = -Math.sin(ph + 0.6) * 0.7;
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.18;
      this.horse.rotation.x = Math.sin(ph) * 0.06;
      this.head.rotation.x = Math.sin(ph + 1) * 0.18;
      if (k < was) {
        if (!this.quiet) sfx.hoof();
        this.h.fx.burst(this.pos.clone().setY(0.1), DUST, 4, { speed: 1.2, up: 0.8, size: 0.1, life: 0.45, gravity: 6 });
      }
    } else if (this.state !== 'dead') {
      this.legsF.rotation.x *= 0.85; this.legsB.rotation.x *= 0.85;
      this.body.position.y *= 0.85;
      this.horse.rotation.x *= 0.85;
      this.head.rotation.x = Math.sin(t * 1.5) * 0.06;
    }
    // rears up before the charge: body back, front legs forward
    if (rearing) { const k = Math.sin(Math.min(1, S / 0.7) * Math.PI); this.horse.rotation.x = -0.45 * k; this.legsF.rotation.x = -0.9 * k; this.body.position.y = 0.4 * k; }
    // halberd: at rest — up; charge — levelled; sweep — sideways and a full turn
    const hb = this.halberd.rotation;
    if (this.state === 'attack' && this.attack === 'lance') hb.set(Math.min(1, S / 0.6) * 1.35, 0, 0);
    else if (this.state === 'attack' && this.attack === 'sweep') {
      const wind = Math.min(1, S / 0.5), spin = S < 0.6 ? -0.5 * wind : -0.5 + Math.min(1, (S - 0.6) / 0.3) * Math.PI * 2;
      hb.set(0, spin, 1.35 * wind);
    } else if (this.state === 'attack' && this.attack === 'blades') hb.set(-0.3, 0, -0.25);
    else { hb.x *= 0.85; hb.y = wrap(hb.y) * 0.85; hb.z *= 0.85; }
    // rider: sways in the saddle, raises the head on the "phalanx"
    this.rider.rotation.x = this.state === 'attack' && this.attack === 'blades' ? -0.15 : -this.horse.rotation.x * 0.5;
    this.rider.position.y = 2.3 + (this.state === 'sleep' ? 0 : Math.sin(t * 2) * 0.03);
    // dazed: the horse dropped onto its front legs, the rider slumped, the emblem beats hard
    if (this.state === 'daze') { this.horse.rotation.x = 0.22; this.legsF.rotation.x = 0.5; this.head.rotation.x = 0.4; this.rider.rotation.x = 0.35; }
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.emblem.scale.setScalar(beat * (this.heartOpen ? 1.4 : 1));
    this.tickBlades(dt);
  }
}
