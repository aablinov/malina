import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, RASP, rand, type BossHooks } from './kit.ts';
import { MiniBoss, type MiniState } from './mini.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Night Rider — mini-boss (wiki/design-bosses.md, section 2): a ghostly horse of semi-transparent dark blue cubes,
 * turquoise eyes; on it a dark hooded armoured knight, a ragged raspberry cloak, a glaive. The berry heart is on the rider's chest.
 * Attacks: fades and appears behind the hero's back with a strike; charges along a strip — crashed into a wall, dazed; calls two
 * ghostly knights; up close — scythes with the glaive. In rage fades twice in a row. Drops "Fallen Wardens".
 * Moving parts: horse (body, neck, tail), head, front legs, hind legs, rider, cloak, glaive, heart.
 */

const TEAL = C(0.6, 3.4, 3.2), DEEP = C(0.25, 1.2, 2.6), PINK = C(4, 1.7, 2.4);

const sfx = {
  /** Ghost neigh: a saw sliding up and down */
  neigh() {
    voice({ type: 'sawtooth', f: 420, f1: 900, dur: 0.35, vol: 0.05, lp: 2400, verb: 0.6 });
    voice({ type: 'sawtooth', f: 900, f1: 300, dur: 0.6, vol: 0.04, delay: 0.3, lp: 1800, lp1: 500, verb: 0.7 });
  },
  /** Hoof strike */
  hoof() { boom(90, 40, 0.18, 0.25); },
  /** Fades / appears: rustle of wind */
  fade() { hiss({ dur: 0.6, vol: 0.18, f: 2400, f1: 500, q: 0.5, type: 'bandpass', attack: 0.1, verb: 0.7 }); },
  /** Glaive swing */
  swish() { hiss({ dur: 0.25, vol: 0.22, f: 600, f1: 3200, q: 0.7, type: 'bandpass' }); },
  /** Summoning bell: a low funeral toll */
  toll() { bell(196, 2.2, 0.09, 0, 0.8); bell(147, 2.6, 0.06, 0.15, 0.8); },
  /** The horse crashed into a wall */
  crash() { boom(70, 25, 0.9, 0.8, 0, 0.5); hiss({ dur: 0.5, vol: 0.2, f: 1200, f1: 200, q: 0.5, type: 'lowpass' }); },
};

export class NightRider extends MiniBoss {
  readonly radius = 1.3;
  readonly title = t('Night Rider');
  override readonly topY = 3.4;
  readonly drop = 'fallenguards';
  private readonly horse = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legsF = new THREE.Group();
  private readonly legsB = new THREE.Group();
  private readonly rider = new THREE.Group();
  private readonly cloak = new THREE.Group();
  private readonly glaive = new THREE.Group();
  private readonly heart = new THREE.Group();
  /** All materials with their original opacity — for fading */
  private readonly fadeMats: { m: THREE.Material; base: number }[] = [];
  /** Visibility 0..1: below 0.3 — hits pass through */
  private fade = 1;
  private gallop = 0;
  private summonCd = 5;
  /** Rage: the second fade in a row is already running */
  private twice = false;
  private readonly spot = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly lastP = new THREE.Vector3();
  private ran = 0;

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 800, home, yaw, arena);
    this.speed = 4.2;
    this.keep = 3;
    this.build();
    this.reset();
  }

  protected build(): void {
    const ghost = this.lam('#2a3550'); ghost.transparent = true; ghost.opacity = 0.75; ghost.depthWrite = false;
    const mane = this.lam('#1a2238'); mane.transparent = true; mane.opacity = 0.8; mane.depthWrite = false;
    const armor = this.lam('#1c2230');
    const steel = this.lam('#5a6478');
    const cloth = this.lam('#8a1040'); cloth.side = THREE.DoubleSide;
    const eye = this.shimmer(TEAL, DEEP, 0, 3);
    const edge = this.shimmer(TEAL, RASP, 1, 2);
    const berry = this.shimmer(RASP, PINK, 0, 3);
    const B = this.box.bind(this);
    this.body.add(this.horse, this.rider);
    // horse: body, neck, tail; the raspberry sign of the Order on the flanks
    B(this.horse, ghost, 1.0, 0.9, 2.3, 0, 1.55, 0);
    B(this.horse, ghost, 0.55, 1.0, 0.6, 0, 2.15, 1.0, -0.5);
    B(this.horse, mane, 0.2, 0.9, 0.3, 0, 2.3, 0.8, -0.5);
    B(this.horse, mane, 0.25, 0.9, 0.25, 0, 1.55, -1.3, 0.6);
    for (const s of [-1, 1]) B(this.horse, edge, 0.04, 0.3, 0.3, s * 0.52, 1.6, 0.2, 0, 0, Math.PI / 4);
    // head: a skull muzzle and turquoise eyes
    this.head.position.set(0, 2.55, 1.3);
    this.horse.add(this.head);
    B(this.head, ghost, 0.48, 0.5, 0.95, 0, 0, 0.3, 0.35);
    B(this.head, mane, 0.12, 0.25, 0.12, 0.15, 0.32, 0.05);
    B(this.head, mane, 0.12, 0.25, 0.12, -0.15, 0.32, 0.05);
    for (const s of [-1, 1]) B(this.head, eye, 0.06, 0.08, 0.16, s * 0.25, 0.06, 0.3);
    // legs in pairs, hung from the body — the gallop swings the whole pair
    this.legsF.position.set(0, 1.15, 0.85);
    this.legsB.position.set(0, 1.15, -0.85);
    this.horse.add(this.legsF, this.legsB);
    for (const g of [this.legsF, this.legsB]) for (const s of [-1, 1]) B(g, ghost, 0.26, 1.15, 0.28, s * 0.3, -0.57, s * 0.12);
    // rider: saddle-legs, armour, pauldrons, a hood with a turquoise slit
    this.rider.position.set(0, 2.0, -0.1);
    B(this.rider, armor, 1.15, 0.3, 0.7, 0, 0, 0);
    B(this.rider, armor, 0.8, 0.9, 0.5, 0, 0.6, 0);
    for (const s of [-1, 1]) B(this.rider, steel, 0.32, 0.22, 0.45, s * 0.52, 1.0, 0);
    B(this.rider, armor, 0.56, 0.56, 0.56, 0, 1.33, 0);
    B(this.rider, steel, 0.5, 0.12, 0.5, 0, 1.6, 0);
    B(this.rider, eye, 0.36, 0.07, 0.05, 0, 1.36, 0.29);
    // berry heart on the chest
    this.heart.position.set(0, 0.62, 0.27);
    this.rider.add(this.heart);
    for (const [x, y, k] of [[0, 0, 0.24], [0.15, 0.13, 0.15], [-0.15, 0.13, 0.15], [0.15, -0.13, 0.15], [-0.15, -0.13, 0.15], [0, 0.25, 0.13]] as const) B(this.heart, berry, k, k, 0.08, x, y, 0);
    // cloak: three ragged strips from the shoulders
    this.cloak.position.set(0, 1.05, -0.28);
    this.rider.add(this.cloak);
    B(this.cloak, cloth, 0.85, 1.1, 0.04, 0, -0.55, 0);
    B(this.cloak, cloth, 0.32, 0.6, 0.04, 0.26, -1.35, -0.02, 0.12);
    B(this.cloak, cloth, 0.26, 0.42, 0.04, -0.24, -1.28, -0.02, -0.1);
    // glaive in the right hand: shaft forward, the blade glows
    this.glaive.position.set(0.6, 0.55, 0.15);
    this.rider.add(this.glaive);
    B(this.glaive, steel, 0.09, 0.09, 2.6, 0, 0, 0.6);
    B(this.glaive, edge, 0.06, 0.32, 0.95, 0, 0.1, 2.2);
    B(this.glaive, steel, 0.25, 0.1, 0.1, 0, 0, 1.7);
    // everything transparent — so it can fade
    this.body.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.Material;
      if (this.fadeMats.some((f) => f.m === m)) return;
      this.fadeMats.push({ m, base: m.opacity });
      m.transparent = true;
    });
  }

  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.fade < 0.3 && this.state !== 'daze') return; // faded — the sword passes through
    super.hit(dmg, dir, point, knock);
  }

  protected override daze(sec: number): void { this.fade = 1; this.flyY = 0; super.daze(sec); }

  override reset(): void { this.fade = 1; this.twice = false; this.summonCd = 5; super.reset(); }

  protected choose(dist: number): string | null {
    if (dist < 3.5) return rnd() < 0.8 ? 'reap' : 'vanish';
    if (this.summonCd <= 0 && this.minions.length < 3) return 'summon';
    if (dist > 5 && rnd() < 0.45) return 'charge';
    return 'vanish';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'vanish': {
        // fades (0.4 s) → gone (0.8 s) → mark behind the hero's back (0.6 s) → appears with a strike
        const FADE = 0.4, GONE = 1.2, MARK = 1.8;
        if (!this.hitDone) { this.hitDone = true; if (!this.quiet) sfx.fade(); }
        if (t < FADE) { this.fade = 1 - t / FADE; this.wisp(3); return false; }
        if (t < MARK) {
          this.fade = 0; this.flyY = 5; // up high: does not push and does not catch hits
          if (t - dt < GONE && t >= GONE) {
            const h = this.heroAt(), away = h.clone().sub(this.pos.clone().setY(0));
            if (away.lengthSq() < 0.01) away.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
            this.spot.copy(this.clampIn(h.addScaledVector(away.normalize(), 1.6), 2));
            this.markCircle(this.spot, 2.1, MARK - GONE, () => undefined, TEAL);
          }
          return false;
        }
        if (t - dt < MARK) {
          // appeared: a glaive strike all around
          this.pos.set(this.spot.x, 0, this.spot.z); this.flyY = 0;
          const h = this.heroAt(); this.yaw = Math.atan2(h.x - this.pos.x, h.z - this.pos.z);
          if (!this.quiet) { sfx.fade(); sfx.swish(); }
          fx.burst(this.spot.clone().setY(1.5), [TEAL, DEEP, RASP], 22, { speed: 4, up: 3, size: 0.12, life: 0.6, glow: true, gravity: 2 });
          fx.shock(this.spot.clone().setY(0.08), 2.3, TEAL, 0.35, 0.15);
          fx.arc(this.spot, this.yaw, TEAL, 2.4, 1.6, 1.2);
          if (this.inCircle(this.spot, 2.1)) this.hurt(16, this.spot, 6);
        }
        this.fade = Math.min(1, (t - MARK) / 0.15);
        if (t < MARK + 0.5) return false;
        // rage: fades once more in a row
        if (this.enraged && !this.twice) { this.twice = true; this.go('attack', 'vanish'); return false; }
        this.twice = false;
        return true;
      }
      case 'charge': {
        // a strip to the hero → gallop straight through; crashed into a wall — dazed, heart open
        const AIM = 0.6, LEN = 15, SPD = 17;
        if (!this.hitDone) {
          this.hitDone = true; this.ran = 0;
          const h = this.heroAt();
          this.dir.set(h.x - this.pos.x, 0, h.z - this.pos.z);
          if (this.dir.lengthSq() < 0.01) this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.dir.normalize();
          this.yaw = Math.atan2(this.dir.x, this.dir.z);
          this.markLine(this.pos.clone().setY(0), this.dir, LEN, 2.2, AIM, () => undefined, TEAL);
          if (!this.quiet) sfx.neigh();
          this.lastP.copy(this.pos);
          return false;
        }
        if (t < AIM) return false;
        // ran into something: the position was clipped (arena wall or a column)
        const step = SPD * dt, moved = Math.hypot(this.pos.x - this.lastP.x, this.pos.z - this.lastP.z);
        const stuck = t - dt > AIM && moved < step * 0.35;
        if (stuck || this.ran >= LEN) {
          if (stuck) {
            if (!this.quiet) sfx.crash();
            fx.shake = Math.max(fx.shake, 0.8); fx.hitstop = Math.max(fx.hitstop, 0.05);
            fx.burst(this.pos.clone().addScaledVector(this.dir, 1.2).setY(1.2), ['#9a8f70', '#5a5a6a', TEAL], 20, { speed: 5, up: 4, size: 0.14, life: 0.8, gravity: 10 });
            this.daze(2);
          } else this.daze(0.9); // galloped past — reins the horse in, open for a moment
          return true;
        }
        this.lastP.copy(this.pos);
        this.move(this.dir, step); this.ran += step;
        this.wisp(2);
        if (rnd() < 0.3 && !this.quiet) sfx.hoof();
        if (this.alive && !this.flyY && Math.hypot(this.h.hero.pos.x - this.pos.x, this.h.hero.pos.z - this.pos.z) < this.radius + 0.9 && !this.lanced) {
          this.lanced = true; this.hurt(18, this.pos, 9);
          fx.flash(this.h.hero.pos.clone().setY(1), TEAL, 1.6);
        }
        return false;
      }
      case 'summon': {
        // the bell — two blue funnels on the floor — ghostly knights rise out of them
        const n = Math.min(2, 3 - this.minions.length);
        if (!this.hitDone) {
          this.hitDone = true; this.summonCd = 11;
          if (!this.quiet) sfx.toll();
          for (let i = 0; i < n; i++) {
            const a = this.yaw + (i ? 1 : -1) * 1.1;
            const at = this.clampIn(this.pos.clone().add(new THREE.Vector3(Math.sin(a) * 2.8, 0, Math.cos(a) * 2.8)), 1.5);
            this.markCircle(at, 1.1, 0.8, () => {
              if (this.dead || this.minions.length >= 3) return;
              this.summon(at, { body: '#2a3550', head: '#5a6478', eye: TEAL, hp: 30, dmg: 6, speed: 2.7, ghost: true });
              fx.burst(at.clone().setY(0.5), [TEAL, DEEP], 14, { speed: 2, up: 4, size: 0.1, life: 0.7, glow: true, gravity: -1 });
              fx.shock(at.clone().setY(0.06), 1.3, DEEP, 0.4, 0.12);
            }, DEEP);
          }
        }
        if (rnd() < 0.5) fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(1.5, 3.5), rand(-1, 1))), vel: new THREE.Vector3(0, 1.2, 0), life: 0.6, size: 0.12, color: DEEP, gravity: 0 });
        return t > 1.1;
      }
      case 'reap': {
        // glaive wind-up to the right (0.45 s) → a wide sweep in a cone ahead
        const WIND = 0.45;
        if (!this.hitDone) { this.hitDone = true; this.lanced = false; }
        if (t < WIND) { this.face(dt, 1.5); return false; }
        if (!this.lanced) {
          this.lanced = true;
          if (!this.quiet) sfx.swish();
          fx.arc(this.pos, this.yaw, TEAL, 3.4, 1.3, 1.4);
          fx.arc(this.pos, this.yaw, RASP, 2.8, 1.1, 1.0);
          if (this.inCone(this.pos, this.yaw, 3.6, 1.15)) this.hurt(14, this.pos, 6);
        }
        return t > WIND + 0.45;
      }
    }
    return true;
  }

  /** The charge has already hit the hero (once per attack); for the scythe — the sweep already happened */
  private lanced = false;

  protected override go(s: MiniState, attack = ''): void {
    super.go(s, attack);
    if (s === 'attack') this.lanced = false;
  }

  /** Turquoise wisps of mist from the horse */
  private wisp(n: number): void {
    for (let i = 0; i < n; i++) {
      if (rnd() > 0.5) continue;
      this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.7, 0.7), this.flyY + rand(0.3, 2.2), rand(-1.2, 1.2))), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.4, 1.2), rand(-0.3, 0.3)), life: rand(0.4, 0.9), size: rand(0.08, 0.16), color: rnd() < 0.8 ? TEAL : RASP, gravity: -0.5 });
    }
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, A = this.state === 'attack' ? this.attack : '';
    if (this.awake) this.summonCd -= dt;
    // fading: outside the "fade" attack — appears at once
    if (A !== 'vanish') { this.fade = Math.min(1, this.fade + dt * 4); if (this.state !== 'dead') this.flyY = 0; }
    for (const f of this.fadeMats) f.m.opacity = f.base * this.fade;
    this.body.visible = this.fade > 0.02;
    if (this.state !== 'dead') this.body.scale.set(1, 0.6 + 0.4 * this.fade, 1);
    // gallop: the leg pairs swing towards each other, the body dips
    const charging = A === 'charge' && S > 0.6;
    const rate = charging ? 16 : walk ? 9 : 0;
    if (rate) {
      const was = Math.sin(this.gallop);
      this.gallop += dt * rate;
      if (was < 0 && Math.sin(this.gallop) >= 0 && walk && !this.quiet) sfx.hoof();
    }
    const sw = rate ? Math.sin(this.gallop) : 0;
    this.legsF.rotation.x = sw * 0.65;
    this.legsB.rotation.x = -sw * 0.65;
    this.horse.position.y = rate ? Math.abs(Math.cos(this.gallop)) * 0.18 : Math.sin(t * 2) * 0.04;
    this.horse.rotation.x = rate ? sw * 0.06 : 0;
    // head: nods in the run, lowered in sleep, thrown up on the neigh; dazed — drooping
    let nod = rate ? sw * 0.15 : Math.sin(t * 1.3) * 0.05;
    if (this.state === 'sleep') nod = 0.4;
    if (A === 'charge' && S < 0.6) nod = -0.5;
    if (this.state === 'daze') nod = 0.55;
    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, nod, 0.25);
    // rider: sways in the saddle, leans forward for the charge, slumps when dazed
    const lean = charging ? 0.35 : this.state === 'daze' ? -0.3 : 0;
    this.rider.rotation.x = THREE.MathUtils.lerp(this.rider.rotation.x, lean, 0.2);
    this.rider.position.y = 2.0 + this.horse.position.y * 0.7;
    // cloak: flutters, at speed — almost horizontal backwards
    this.cloak.rotation.x = -(charging ? 1.1 : walk ? 0.45 : 0.12) - Math.abs(Math.sin(t * (charging ? 14 : 5))) * 0.12;
    this.cloak.rotation.z = Math.sin(t * 3.1) * 0.08;
    // glaive: wind-up to the right → sweep to the left; charge — levelled; otherwise — slanted forward
    let gy = 0.15, gx = 0.35;
    if (A === 'reap') { const k = S < 0.45 ? S / 0.45 : Math.min(1, (S - 0.45) / 0.15); gy = S < 0.45 ? 0.15 + k * 1.2 : 1.35 - k * 2.9; gx = 0.1; }
    else if (charging) { gy = -0.1; gx = 0.05; }
    else if (this.state === 'daze') { gy = 0.6; gx = 0.9; }
    else if (this.state === 'sleep') { gy = 0; gx = 1.1; }
    this.glaive.rotation.y = THREE.MathUtils.lerp(this.glaive.rotation.y, gy, A === 'reap' && S > 0.45 ? 0.6 : 0.2);
    this.glaive.rotation.x = THREE.MathUtils.lerp(this.glaive.rotation.x, gx, 0.2);
    // wisps of mist all the time, less often in sleep
    if (this.state !== 'dead' && this.fade > 0.5) this.wisp(this.state === 'sleep' ? 1 : rate ? 2 : 1);
    // berry heart: dazed — beats hard
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.6 : 1));
  }
}
