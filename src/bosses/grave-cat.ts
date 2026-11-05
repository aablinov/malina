import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, rand, RASP, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Grave Cat — mini-boss (wiki/design-bosses.md, section 2): a lean cat warden of the crypt, its fur is mossy stone,
 * a rusty short sword in its teeth, a crown of raspberry drupelets on its head, a ragged raspberry cloak, the tail ends in a torch
 * with turquoise soul fire. Fast: "Rift" — vanishes in a burst and appears in a burst at the hero (in rage — a chain of three),
 * after the chain its head spins — dazed, the berry heart on its chest open. A pounce onto a mark, two sword swings
 * up close. Drops "Rift". Moving parts: body, head (with the sword in its teeth), two pairs of paws, two tail links,
 * berry heart.
 */

const TURQ = C(0.6, 3.4, 3.2), SOUL = C(0.9, 4, 3.6), PINK = C(4, 1.7, 2.4);
/** "Rift" burst: radius, mark fill at itself and at the hero */
const BLINK_R = 2.2, BLINK_OUT = 0.4, BLINK_IN = 0.5;

const sfx = {
  /** "Rift" mark: a thin ring of souls */
  charge() { voice({ type: 'sine', f: 900, f1: 1800, dur: 0.35, vol: 0.04, verb: 0.5 }); bell(1320, 0.6, 0.03, 0, 0.6); },
  /** Pop: vanished or appeared */
  pop() { boom(160, 50, 0.35, 0.45); hiss({ dur: 0.35, vol: 0.2, f: 3000, f1: 600, q: 0.7, type: 'lowpass', verb: 0.4 }); },
  /** Sword swing: whistle */
  swish() { hiss({ dur: 0.18, vol: 0.18, f: 1200, f1: 4000, q: 1.2 }); },
  /** Ring of the rusty blade on the target */
  clang() { for (const f of [620, 930]) voice({ type: 'square', f, dur: 0.15, vol: 0.02, lp: 2500, verb: 0.3 }); },
  /** Landing after the pounce */
  land() { boom(80, 30, 0.5, 0.6, 0, 0.4); hiss({ dur: 0.4, vol: 0.15, f: 800, f1: 200, q: 0.5, type: 'lowpass' }); },
  /** The cat hisses before the pounce */
  hissCat() { hiss({ dur: 0.35, vol: 0.12, f: 2500, f1: 5000, q: 0.6, type: 'highpass' }); },
};

export class GraveCat extends MiniBoss {
  readonly radius = 0.9;
  readonly title = t('Grave Cat');
  override readonly topY = 2.4;
  readonly drop = 'blink';
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legsF = new THREE.Group();
  private readonly legsB = new THREE.Group();
  private readonly tail1 = new THREE.Group();
  private readonly tail2 = new THREE.Group();
  private readonly heart = new THREE.Group();
  private torch!: THREE.Mesh;
  private walkT = 0;
  /** Vanished during the "Rift": invisible and invulnerable */
  private gone = false;
  /** The "Rift" chain is over (from the mark callback) */
  private blinkDone = false;
  private readonly jumpFrom = new THREE.Vector3();
  private readonly jumpAt = new THREE.Vector3();

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 700, home, yaw, arena);
    this.speed = 5;
    this.keep = 2.5;
    this.turn = 5;
    this.build();
    this.reset();
  }

  override reset(): void {
    this.gone = false;
    this.blinkDone = false;
    this.body.visible = true;
    super.reset();
  }

  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.gone) return;
    super.hit(dmg, dir, point, knock);
  }

  protected override cry(): void {
    if (this.quiet) return;
    // the crypt's meow-howl: two saws going down and a hiss
    voice({ type: 'sawtooth', f: 700, f1: 260, dur: 0.8, vol: 0.06, detune: 20, lp: 2400, lp1: 600, verb: 0.6 });
    voice({ type: 'sawtooth', f: 1050, f1: 390, dur: 0.7, vol: 0.03, delay: 0.05, lp: 2400, verb: 0.6 });
    sfx.hissCat();
  }

  protected build(): void {
    const fur = this.lam('#6a7a64', pixelTex('#6a7a64', 10, 611));
    const dark = this.lam('#3e4a3a', pixelTex('#3e4a3a', 8, 612));
    const cape = this.lam('#8a1838', pixelTex('#8a1838', 8, 613));
    const rust = this.lam('#8a5a3a', pixelTex('#8a5a3a', 6, 614));
    const wood = this.lam('#5a3a24');
    const eye = this.shimmer(TURQ, SOUL, 0, 4);
    const rune = this.shimmer(TURQ, RASP, 0, 1.6);
    const berry = this.shimmer(RASP, PINK, 1, 3);
    const B = this.box.bind(this);
    this.body.add(this.torso, this.legsF, this.legsB);
    // body: lean, a dark spine on top; a collar with runes — shimmer turquoise ↔ raspberry
    B(this.torso, fur, 0.9, 0.75, 1.8, 0, 1.15, 0);
    B(this.torso, dark, 0.6, 0.12, 1.6, 0, 1.56, -0.05);
    B(this.torso, rune, 0.96, 0.16, 0.22, 0, 1.35, 0.8);
    // ragged cloak: a sheet on the back and strips of different length at the sides
    B(this.torso, cape, 1.06, 0.08, 1.2, 0, 1.6, -0.1);
    for (const [x, z, h] of [[-0.53, 0.3, 0.5], [-0.53, -0.15, 0.75], [-0.53, -0.55, 0.4], [0.53, 0.25, 0.65], [0.53, -0.25, 0.35], [0.53, -0.6, 0.6]] as const) B(this.torso, cape, 0.06, h, 0.36, x, 1.6 - h / 2, z);
    // berry heart on the chest: ×2 on it while the head spins
    this.heart.position.set(0, 1.0, 0.92);
    this.torso.add(this.heart);
    for (const [x, y, k] of [[0, 0, 0.26], [0.16, 0.13, 0.16], [-0.16, 0.13, 0.16], [0.16, -0.13, 0.16], [-0.16, -0.13, 0.16], [0, 0.24, 0.13]] as const) B(this.heart, berry, k, k, 0.1, x, y, 0);
    // head: muzzle, tall pointed ears, turquoise eyes, a crown of drupelets between the ears
    this.head.position.set(0, 1.65, 1.0);
    this.torso.add(this.head);
    B(this.head, fur, 0.8, 0.68, 0.7, 0, 0, 0);
    B(this.head, dark, 0.42, 0.28, 0.24, 0, -0.14, 0.44);
    for (const s of [-1, 1]) {
      B(this.head, dark, 0.2, 0.6, 0.14, s * 0.27, 0.58, -0.05, 0, 0, -s * 0.12);
      B(this.head, eye, 0.2, 0.1, 0.05, s * 0.2, 0.08, 0.36);
    }
    for (const [x, y] of [[0, 0.44], [-0.1, 0.42], [0.1, 0.42], [0, 0.55], [-0.06, 0.52], [0.06, 0.52]] as const) B(this.head, berry, 0.11, 0.11, 0.11, x, y, 0.05);
    // rusty sword in the teeth: across the muzzle, blade to the right
    B(this.head, wood, 0.3, 0.1, 0.1, -0.15, -0.2, 0.5);
    B(this.head, dark, 0.06, 0.26, 0.14, 0.02, -0.2, 0.5);
    B(this.head, rust, 1.0, 0.07, 0.16, 0.55, -0.2, 0.5);
    B(this.head, rune, 0.7, 0.03, 0.04, 0.5, -0.2, 0.585);
    // paws: two pairs, each swings as a whole from the shoulder
    this.legsF.position.set(0, 0.8, 0.62);
    this.legsB.position.set(0, 0.8, -0.62);
    for (const g of [this.legsF, this.legsB]) for (const s of [-1, 1]) { B(g, fur, 0.28, 0.8, 0.3, s * 0.3, -0.4, 0); B(g, dark, 0.3, 0.14, 0.38, s * 0.3, -0.73, 0.04); }
    // tail: two links, a torch with soul fire at the end
    this.tail1.position.set(0, 1.35, -0.9);
    this.torso.add(this.tail1);
    B(this.tail1, dark, 0.18, 0.18, 0.9, 0, 0, -0.45);
    this.tail2.position.set(0, 0, -0.9);
    this.tail1.add(this.tail2);
    B(this.tail2, dark, 0.16, 0.16, 0.7, 0, 0, -0.35);
    B(this.tail2, wood, 0.16, 0.4, 0.16, 0, 0.2, -0.72);
    B(this.tail2, rust, 0.24, 0.1, 0.24, 0, 0.42, -0.72);
    this.torch = B(this.tail2, this.shimmer(TURQ, SOUL, 2, 6), 0.22, 0.3, 0.22, 0, 0.6, -0.72);
  }

  protected choose(dist: number, rel: number): string | null {
    if (dist < 3 && Math.abs(rel) < 1) return rnd() < 0.75 ? 'swipe' : 'blink';
    if (dist > 4 && rnd() < 0.45) return 'pounce';
    if (dist > 3) return 'blink';
    return null;
  }

  protected act(name: string, ta: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'blink': {
        // mark at itself → burst, vanished → mark at the hero → appeared with a second burst; in rage — a chain of three
        if (!this.hitDone) { this.hitDone = true; this.blinkDone = false; this.blinkStep(0, this.enraged ? 3 : 1); }
        if (!this.gone) this.face(dt, 2);
        if (this.blinkDone && !this.gone) {
          // the head spins: staggers, heart open
          fx.text(this.pos.clone().setY(this.topY + 0.8), t('dizzy!'), 'crit');
          this.daze(1.8);
          return true;
        }
        if (ta > 8) { this.appear(); return true; } // safety: the mark was removed
        return false;
      }
      case 'pounce': {
        // crouched, hissed → mark at the hero → an arc onto it → paw strike
        const CROUCH = 0.35, AIR = 0.6;
        this.face(dt, 2);
        if (ta < CROUCH) { if (ta - dt <= 0 && !this.quiet) sfx.hissCat(); return false; }
        if (!this.hitDone) {
          this.hitDone = true;
          this.jumpFrom.copy(this.pos).setY(0);
          this.jumpAt.copy(this.clampIn(this.heroAt(), 1.2));
          this.markCircle(this.jumpAt, 2.2, AIR, () => undefined);
        }
        const k = Math.min(1, (ta - CROUCH) / AIR);
        this.pos.x = THREE.MathUtils.lerp(this.jumpFrom.x, this.jumpAt.x, k);
        this.pos.z = THREE.MathUtils.lerp(this.jumpFrom.z, this.jumpAt.z, k);
        this.flyY = Math.sin(Math.PI * k) * 3;
        if (k < 1) return false;
        if (this.flyY !== 0) {
          this.flyY = 0;
          if (!this.quiet) sfx.land();
          fx.shake = Math.max(fx.shake, 0.6);
          fx.hitstop = Math.max(fx.hitstop, 0.04);
          fx.shock(this.jumpAt.clone().setY(0.08), 2.6, TURQ, 0.35, 0.2);
          fx.burst(this.jumpAt.clone().setY(0.3), ['#7a7a6a', '#4a5244', '#5a5a5a'], 16, { speed: 5, up: 4, size: 0.14, life: 0.8, gravity: 12 });
          if (this.inCircle(this.jumpAt, 2.2)) this.hurt(16, this.jumpAt, 6);
        }
        return ta > CROUCH + AIR + 0.35;
      }
      case 'swipe': {
        // two quick sword swings in front
        const hits = [0.3, 0.62];
        if (ta < 0.25) this.face(dt, 2.5);
        for (const at of hits) {
          if (ta >= at && ta - dt < at) {
            if (!this.quiet) sfx.swish();
            const f = this.fwd(), c = this.pos.clone().addScaledVector(f, 1.4).setY(1.3);
            fx.burst(c, [TURQ, '#c8a070', RASP], 10, { speed: 4, up: 1, size: 0.08, life: 0.3, glow: true, gravity: 2 });
            fx.flash(c, TURQ.clone().multiplyScalar(0.6), 1.6, 0.12);
            if (this.inCone(this.pos, this.yaw, 2.8, 1.0)) { this.hurt(12, this.pos, 3); if (!this.quiet) sfx.clang(); }
          }
        }
        return ta > 0.95;
      }
    }
    return true;
  }

  /** One "Rift" of the chain: i — index, n — how many in total */
  private blinkStep(i: number, n: number): void {
    const live = () => this.state === 'attack' && this.attack === 'blink';
    const from = this.pos.clone().setY(0);
    if (!this.quiet) sfx.charge();
    this.markCircle(from, BLINK_R, BLINK_OUT, () => {
      if (!live()) return;
      this.blast(from);
      this.gone = true;
      this.body.visible = false;
      // will appear next to the hero: at the side or behind, not right up close
      const a = rand(0, Math.PI * 2);
      const to = this.clampIn(this.heroAt().add(new THREE.Vector3(Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3)), 1.2);
      if (!this.quiet) sfx.charge();
      this.markCircle(to, BLINK_R, BLINK_IN, () => {
        if (!live()) { this.appear(); return; }
        this.pos.x = to.x; this.pos.z = to.z;
        this.appear();
        this.blast(to);
        if (i + 1 < n) this.blinkStep(i + 1, n); else this.blinkDone = true;
      }, TURQ);
    }, TURQ);
  }

  private appear(): void {
    this.gone = false;
    this.body.visible = true;
    const hero = this.h.hero.pos;
    this.yaw = Math.atan2(hero.x - this.pos.x, hero.z - this.pos.z);
  }

  /** Burst of soul fire: flash, ring, damage to the hero in the circle */
  private blast(at: THREE.Vector3): void {
    const fx = this.h.fx;
    if (!this.quiet) sfx.pop();
    fx.shock(at.clone().setY(0.1), BLINK_R + 0.3, TURQ, 0.35, 0.22);
    fx.flash(at.clone().setY(1.2), SOUL.clone().multiplyScalar(0.5), 3, 0.2);
    fx.burst(at.clone().setY(1), [TURQ, SOUL, RASP], 22, { speed: 5, up: 3, size: 0.1, life: 0.6, glow: true, gravity: 2 });
    fx.light(at.clone().setY(1.5), '#5ff0e0', 10, 7, 0.35);
    if (this.inCircle(at, BLINK_R)) this.hurt(10, at, 4);
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st;
    const atk = this.state === 'attack' ? this.attack : '';
    // walk: paws in pairs back and forth, the body sways
    let swing = 0;
    if (walk) { this.walkT += dt * 9 * this.speedK; swing = Math.sin(this.walkT) * 0.6; }
    let bob = walk ? Math.abs(Math.sin(this.walkT)) * 0.08 : Math.sin(t * 2) * 0.02;
    let sx = 1, sy = 1, twist = 0, pitch = 0, roll = 0;
    if (this.state === 'sleep') { sy = 0.82; bob = 0; }
    if (atk === 'pounce') {
      if (S < 0.35) { sx = 1.12; sy = 0.75; pitch = 0.15; } // crouched
      else if (this.flyY > 0) { sy = 1.1; sx = 0.92; pitch = -0.25; swing = 0.9; } // stretched out in the leap
    }
    if (atk === 'swipe') {
      // wind-up to the left → strike to the right, twice; with the whole body
      const k = S < 0.3 ? S / 0.3 : S < 0.62 ? (S - 0.3) / 0.32 : (S - 0.62) / 0.33;
      const dirn = S < 0.3 ? 1 : S < 0.62 ? -1 : 1;
      twist = dirn * (S < 0.25 ? -0.6 * k : Math.sin(Math.min(1, k) * Math.PI) * 0.7 - 0.2);
    }
    if (atk === 'blink' && !this.gone) { sy = 1 + Math.sin(t * 30) * 0.05; sx = 1 - Math.sin(t * 30) * 0.05; }
    if (this.state === 'daze') { roll = Math.sin(t * 6) * 0.2; twist = Math.sin(t * 4.3) * 0.25; }
    if (this.state !== 'dead') {
      this.body.position.y = bob;
      this.body.scale.lerp(new THREE.Vector3(sx, sy, sx), 0.35);
      this.body.rotation.set(pitch, twist, roll);
    }
    this.legsF.rotation.x = swing;
    this.legsB.rotation.x = -swing;
    // head: when dazed leans and circles, in the fight slightly lowered
    this.head.rotation.set(this.state === 'daze' ? 0.3 : this.state === 'sleep' ? 0.35 : 0.05, this.state === 'daze' ? Math.sin(t * 5) * 0.4 : 0, this.state === 'daze' ? Math.cos(t * 5) * 0.2 : 0);
    // tail with the torch: arcs up, the second link bends in a wave
    this.tail1.rotation.set(-0.7 + Math.sin(t * 2.2) * 0.12, Math.sin(t * 1.7) * 0.35, 0);
    this.tail2.rotation.set(-0.5 + Math.sin(t * 2.2 + 1) * 0.2, Math.sin(t * 1.7 + 1) * 0.3, 0);
    // soul fire on the torch: turquoise tongues and sparks
    this.torch.scale.set(0.22, 0.3 + Math.sin(t * 17) * 0.06, 0.22);
    if (this.state !== 'dead' && !this.gone && rnd() < (this.state === 'sleep' ? 0.25 : 0.6)) {
      const p = this.torch.getWorldPosition(new THREE.Vector3());
      this.h.fx.particle({ pos: p.add(new THREE.Vector3(rand(-0.08, 0.08), 0.1, rand(-0.08, 0.08))), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.8, 1.6), rand(-0.2, 0.2)), life: rand(0.3, 0.55), size: rand(0.06, 0.13), color: rnd() < 0.8 ? TURQ : RASP, gravity: -1 });
    }
    // berry heart: beats quietly, open — hard
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.5 : 1));
  }
}
