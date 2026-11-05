import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss, type Minion } from './mini.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Judge of the Order — legendary floor boss (wiki/design-bosses.md, sections 1–4): a paladin golem of the Raspberry Order in white-and-
 * gold armour, a raspberry cloak, a helmet with a glowing visor slit. A great sword in the right hand, golden scales in the left,
 * the berry heart lies on one pan (beats hard when dazed). Attacks: pillars of light from marks around the hero, "verdict" —
 * sword up, a strip forward and a strike with a shockwave along it, a sword sweep all around up close, squires (three). A fallen
 * squire leaves a glowing grave; "resurrection" — the judge raises the scales and for 2 s pulls the fallen out of the graves: three hits
 * in that time break the rite, he staggers — dazed, heart open. Rage: the pillars go in a spiral across the whole arena,
 * the verdict leaves a burning strip of light. Drops "Heavenly Judgement" or the "Bastion" aura.
 * Moving parts: two legs, torso (with cloak), head, sword arm, scales arm, scales beam, heart.
 */

const HOLY = C(4, 3.6, 2.4), GOLD = C(4, 3.0, 1.2), WHITE = C(4, 4, 3.6), PINK = C(4, 1.7, 2.4);
const ARMOR = '#e8e2d0', TRIM = '#e8b84a', CLOAK = '#a8204a', STEEL = '#d8dde6', DARK = '#5a5248';
const DUST = ['#e8e2d0', '#c8c0aa', '#e8b84a'];
/** Squires: armour and helmet mixed */
const SQUIRES = [{ body: '#c8ccd4', head: '#e8b84a' }, { body: '#e8e2d0', head: '#a8204a' }, { body: '#9aa0aa', head: '#e8e2d0' }];

const sfx = {
  /** Choir: a high pure tone and a ring */
  choir() { voice({ type: 'triangle', f: 520, f1: 780, dur: 1.0, vol: 0.05, lp: 3000, verb: 0.7 }); bell(1040, 1.0, 0.04); },
  /** Pillar of light: hiss and a ring from above */
  pillar() { hiss({ dur: 0.4, vol: 0.18, f: 4000, f1: 1200, q: 0.6, type: 'highpass', verb: 0.5 }); bell(rand(1200, 1500), 0.6, 0.03); },
  /** Sword strike into the floor */
  slam() { boom(65, 22, 1.2, 0.9, 0, 0.6); hiss({ dur: 0.7, vol: 0.22, f: 1200, f1: 150, q: 0.5, type: 'lowpass' }); bell(330, 1.4, 0.05); },
  /** Whistle of the sword */
  swish() { hiss({ dur: 0.35, vol: 0.2, f: 900, f1: 3500, q: 1.2, type: 'bandpass' }); },
  /** Rite of resurrection: a hum from bottom to top */
  raise() { voice({ type: 'sawtooth', f: 90, f1: 360, dur: 2.0, vol: 0.05, lp: 600, lp1: 2400, verb: 0.7 }); },
  /** Rite broken: the ring of a cracked bell */
  broken() { bell(220, 1.6, 0.07); hiss({ dur: 0.8, vol: 0.2, f: 2500, f1: 400, q: 0.5, type: 'lowpass' }); },
};

/** Squire's grave: a slab and a glowing skull */
interface Grave { pos: THREE.Vector3; g: THREE.Group; glow: THREE.MeshBasicMaterial; mats: THREE.Material[] }

export class OrderJudge extends MiniBoss {
  readonly radius = 1.5;
  readonly title = t('Judge of the Order');
  override readonly subtitle = t('legendary warden');
  override readonly topY = 4.6;
  readonly drop = 'judgement';
  override readonly tier = 'boss' as const;
  /** Auras to choose from after the victory, chance % — the Order's shield or punishing light */
  override readonly auras = [['bastion', 50], ['halo', 50]] as const;
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly swordArm = new THREE.Group();
  private readonly scalesArm = new THREE.Group();
  private readonly beam = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly heart = new THREE.Group();
  private stepT = 0;
  /** Living squires — we watch who fell, to leave a grave */
  private readonly squires: Minion[] = [];
  private readonly graves: Grave[] = [];
  /** Hits on the judge during the rite of resurrection */
  private raiseHits = 0;
  private readonly aim = new THREE.Vector3();
  private readonly at = new THREE.Vector3();

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 2000, home, yaw, arena);
    this.speed = 2.4;
    this.keep = 3.5;
    this.turn = 2.6;
    this.build();
    this.reset();
  }

  protected build(): void {
    const armor = this.lam(ARMOR, pixelTex(ARMOR, 6, 811));
    const trim = this.lam(TRIM, pixelTex(TRIM, 10, 812));
    const cloak = this.lam(CLOAK, pixelTex(CLOAK, 9, 813));
    const steel = this.lam(STEEL, pixelTex(STEEL, 5, 814));
    const dark = this.lam(DARK, pixelTex(DARK, 7, 815));
    const glow = this.shimmer(HOLY, RASP, 0, 1.8);
    const blade = this.shimmer(WHITE, HOLY, 1, 2.4);
    const heartMat = this.shimmer(RASP, PINK, 0, 3);
    const B = this.box.bind(this);
    // legs: two blocks in armour, a golden greave
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.6, 1.2, 0);
      this.body.add(g);
      B(g, armor, 0.75, 1.1, 0.85, 0, -0.6, 0);
      B(g, trim, 0.85, 0.16, 0.95, 0, -1.12, 0.05);
      this.legs.push(g);
    }
    // torso: armour, golden belt and pauldrons, a raspberry surcoat with the raspberry sign, a cloak to the heels behind
    this.torso.position.y = 1.2;
    this.body.add(this.torso);
    B(this.torso, armor, 2.2, 1.9, 1.3, 0, 0.95, 0);
    B(this.torso, trim, 2.3, 0.22, 1.4, 0, 0.1, 0);
    for (const s of [-1, 1]) B(this.torso, trim, 0.8, 0.4, 1.2, s * 1.2, 1.85, 0);
    B(this.torso, cloak, 0.9, 1.7, 0.06, 0, 0.6, 0.67);
    for (const [x, y, k] of [[0, 1.2, 0.26], [0.2, 1.02, 0.18], [-0.2, 1.02, 0.18], [0, 0.84, 0.18]] as const) B(this.torso, glow, k, k, 0.05, x, y, 0.71);
    B(this.torso, cloak, 2.3, 3.0, 0.08, 0, 0.3, -0.72, 0.08);
    B(this.torso, cloak, 0.08, 2.6, 1.0, 1.18, 0.4, -0.25);
    B(this.torso, cloak, 0.08, 2.6, 1.0, -1.18, 0.4, -0.25);
    // head: bucket helmet, the visor slit glows, a golden crest
    this.head.position.set(0, 3.15, 0.05);
    this.body.add(this.head);
    B(this.head, armor, 0.95, 0.95, 0.95, 0, 0.45, 0);
    B(this.head, dark, 0.7, 0.14, 0.06, 0, 0.5, 0.48);
    B(this.head, glow, 0.6, 0.08, 0.04, 0, 0.5, 0.51);
    B(this.head, glow, 0.08, 0.4, 0.04, 0, 0.28, 0.5);
    B(this.head, trim, 0.16, 0.35, 0.9, 0, 1.05, 0);
    // right arm: armoured, a sword in the fist — guard, the blade glows
    this.swordArm.position.set(1.5, 2.95, 0);
    this.body.add(this.swordArm);
    B(this.swordArm, armor, 0.6, 1.1, 0.6, 0, -0.5, 0);
    B(this.swordArm, trim, 0.66, 0.3, 0.66, 0, -1.1, 0);
    B(this.swordArm, trim, 0.9, 0.14, 0.2, 0, -1.3, 0);
    B(this.swordArm, steel, 0.36, 2.4, 0.12, 0, -2.55, 0);
    B(this.swordArm, blade, 0.12, 2.3, 0.14, 0, -2.55, 0);
    // left arm: the scales — a beam on the fist, two golden pans, the berry heart on the right pan
    this.scalesArm.position.set(-1.5, 2.95, 0);
    this.body.add(this.scalesArm);
    B(this.scalesArm, armor, 0.6, 1.1, 0.6, 0, -0.5, 0);
    B(this.scalesArm, trim, 0.66, 0.3, 0.66, 0, -1.1, 0);
    this.beam.position.set(0, -1.2, 0);
    this.scalesArm.add(this.beam);
    B(this.beam, trim, 0.12, 0.6, 0.12, 0, 0.25, 0);
    B(this.beam, trim, 1.8, 0.1, 0.1, 0, 0.55, 0);
    for (const s of [-1, 1]) {
      B(this.beam, trim, 0.04, 0.6, 0.04, s * 0.85, 0.25, 0);
      B(this.beam, trim, 0.6, 0.08, 0.6, s * 0.85, -0.06, 0);
    }
    this.heart.position.set(0.85, 0.12, 0);
    this.beam.add(this.heart);
    for (const [x, y, z, k] of [[0, 0, 0, 0.3], [0.14, 0.12, 0.1, 0.18], [-0.14, 0.12, -0.1, 0.18], [0.12, 0.14, -0.12, 0.16], [-0.1, 0.16, 0.12, 0.16], [0, 0.26, 0, 0.14]] as const) B(this.heart, heartMat, k, k, k, x, y, z);
  }

  override reset(): void {
    super.reset();
    this.squires.length = 0;
    this.clearGraves();
  }

  protected override die(): void {
    super.die();
    this.squires.length = 0;
    this.clearGraves();
  }

  /** Hits during the rite: three — and the rite is broken, the judge is dazed */
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    super.hit(dmg, dir, point, knock);
    if (this.dead || this.state !== 'attack' || this.attack !== 'raise' || this.st < 0.3) return;
    this.raiseHits++;
    this.h.fx.text(this.pos.clone().setY(this.topY + 0.5), `${this.raiseHits}/3`, 'crit');
    if (this.raiseHits >= 3) {
      if (!this.quiet) sfx.broken();
      this.h.fx.text(this.pos.clone().setY(this.topY + 1.1), t('rite broken!'), 'crit');
      this.h.fx.burst(this.beam.getWorldPosition(new THREE.Vector3()), [HOLY, RASP, WHITE], 22, { speed: 4, up: 3, size: 0.12, life: 0.7, glow: true, gravity: 6 });
      this.h.fx.shake = Math.max(this.h.fx.shake, 0.5);
      this.daze(2.5);
    }
  }

  override update(dt: number): void {
    super.update(dt);
    // a fallen squire leaves a grave with a glowing skull
    for (let i = this.squires.length - 1; i >= 0; i--) if (this.squires[i].dead) { this.addGrave(this.squires[i].pos); this.squires.splice(i, 1); }
    for (const g of this.graves) g.glow.color.copy(HOLY).lerp(RASP, 0.5 + 0.5 * Math.sin(this.time * 3 + g.pos.x)).multiplyScalar(0.7);
  }

  private addGrave(p: THREE.Vector3): void {
    const stone = new THREE.MeshLambertMaterial({ color: '#8a8478' }), glow = glowMat(HOLY);
    const g = new THREE.Group();
    const slab = new THREE.Mesh(UNIT, stone); slab.scale.set(0.55, 0.75, 0.16); slab.position.set(0, 0.37, -0.25); slab.rotation.x = -0.12; slab.castShadow = true;
    const skull = new THREE.Mesh(UNIT, glow); skull.scale.set(0.32, 0.28, 0.3); skull.position.set(0, 0.15, 0.15);
    g.add(slab, skull);
    g.position.set(p.x, 0, p.z);
    this.h.scene.add(g);
    this.graves.push({ pos: p.clone().setY(0), g, glow, mats: [stone, glow] });
    this.h.fx.burst(p.clone().setY(0.4), [HOLY, '#8a8478'], 8, { speed: 1.5, up: 2, size: 0.1, life: 0.5, gravity: 6 });
  }

  private clearGraves(): void {
    for (const g of this.graves.splice(0)) { this.h.scene.remove(g.g); for (const m of g.mats) m.dispose(); }
  }

  protected choose(dist: number): string | null {
    const alive = this.squires.length;
    if (this.graves.length > 0 && rnd() < 0.6) { this.raiseHits = 0; return 'raise'; }
    if (alive + this.graves.length === 0 && rnd() < 0.25) return 'squires';
    if (dist < 4.2) return rnd() < 0.7 ? 'sweep' : 'verdict';
    return rnd() < 0.5 ? 'pillars' : 'verdict';
  }

  /** Pillar of light at a point: a tall glowing bar with a halo fades in half a second */
  private pillar(at: THREE.Vector3, r: number, dmg: number): void {
    const fx = this.h.fx, g = new THREE.Group();
    const core = glowMat(WHITE, 1, true), halo = glowMat(HOLY.clone().lerp(RASP, rnd() * 0.3), 0.45, true);
    const a = new THREE.Mesh(UNIT, core); a.scale.set(r * 0.9, 14, r * 0.9); a.position.y = 7;
    const b = new THREE.Mesh(UNIT, halo); b.scale.set(r * 1.6, 14, r * 1.6); b.position.y = 7;
    g.add(a, b);
    g.position.set(at.x, 0, at.z);
    fx.custom(g, 0.5, (k) => { g.scale.set(1 - k * 0.8, 1, 1 - k * 0.8); core.opacity = 1 - k; halo.opacity = 0.45 * (1 - k); }, () => { core.dispose(); halo.dispose(); });
    fx.light(at.clone().setY(2), HOLY, 5, 10, 0.3);
    fx.shock(at.clone().setY(0.08), r + 0.3, HOLY, 0.35, 0.14);
    fx.burst(at.clone().setY(0.3), [HOLY, WHITE, RASP], 10, { speed: 4, up: 5, size: 0.08, life: 0.5, glow: true, gravity: 6 });
    fx.shake = Math.max(fx.shake, 0.25);
    if (!this.quiet) sfx.pillar();
    if (dmg > 0 && this.inCircle(at, r)) this.hurt(dmg, at, 3);
  }

  /** Light on a grave: a pillar while the rite runs */
  private column(at: THREE.Vector3, dur: number): void {
    const m = glowMat(HOLY, 0.4, true), c = new THREE.Mesh(UNIT, m);
    c.scale.set(0.9, 8, 0.9);
    c.position.set(at.x, 4, at.z);
    this.h.fx.custom(c, dur, (k) => {
      m.opacity = 0.15 + k * 0.5 + Math.sin(k * 40) * 0.05;
      c.scale.x = c.scale.z = 0.5 + k * 0.6;
      if (rnd() < 0.4) this.h.fx.particle({ pos: at.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0.1, rand(-0.4, 0.4))), vel: new THREE.Vector3(0, rand(2, 4), 0), life: 0.6, size: 0.08, color: HOLY, gravity: -1 });
    }, () => m.dispose());
  }

  protected act(name: string, ta: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'pillars': {
        // scales up: marks under the hero and around; in rage also a spiral across the whole arena
        if (!this.hitDone) {
          this.hitDone = true;
          if (!this.quiet) sfx.choir();
          const n = this.enraged ? 5 : 3;
          for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2), p = this.clampIn(this.heroAt().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(i === 0 ? 0 : rand(1.8, 3.2))));
            this.markCircle(p, 1.6, 1.0 + i * 0.08, () => this.pillar(p, 1.6, 16), HOLY);
          }
          if (this.enraged) {
            const a = this.arena, c = new THREE.Vector3((a.x0 + a.x1) / 2, 0, (a.z0 + a.z1) / 2), a0 = rand(0, Math.PI * 2);
            for (let i = 0; i < 14; i++) {
              const ang = a0 + i * 0.85, rr = 1.5 + i * 0.75;
              const p = this.clampIn(c.clone().add(new THREE.Vector3(Math.cos(ang) * rr, 0, Math.sin(ang) * rr)));
              this.markCircle(p, 1.4, 1.1 + i * 0.12, () => this.pillar(p, 1.4, 16), HOLY.clone().lerp(RASP, 0.3));
            }
          }
        }
        if (ta < 0.8) this.face(dt, 0.8);
        return ta > (this.enraged ? 2.9 : 1.6);
      }
      case 'verdict': {
        // sword up, a strip forward — and a strike: a wave along the strip; in rage the strip burns with light
        const AIM = 0.4, LEN = 12, W = 2.2, FIRE = AIM + 0.8;
        if (ta < AIM) this.face(dt, 1.4);
        if (!this.hitDone && ta >= AIM) {
          this.hitDone = true;
          this.aim.copy(this.fwd());
          this.at.copy(this.pos).setY(0);
          const from = this.at.clone(), dir = this.aim.clone();
          if (!this.quiet) sfx.choir();
          this.markLine(from, dir, LEN, W, FIRE - AIM, () => {
            if (!this.quiet) sfx.slam();
            fx.shake = Math.max(fx.shake, 0.9);
            fx.hitstop = Math.max(fx.hitstop, 0.05);
            fx.screenFlash('#fff2d0', 0.2, 0.15);
            for (let i = 0; i <= 6; i++) {
              const p = from.clone().addScaledVector(dir, 1.5 + i * 1.75);
              fx.shock(p.clone().setY(0.08), 1.4, HOLY, 0.3 + i * 0.05, 0.16);
              fx.burst(p.clone().setY(0.3), i % 2 ? DUST : [HOLY, WHITE], 5, { speed: 3, up: 4, size: 0.12, life: 0.6, glow: i % 2 === 0, gravity: 10 });
              if (this.enraged) this.hazard(p, 1.15, 5, 10, GOLD);
            }
            fx.light(from.clone().addScaledVector(dir, 6).setY(1.5), HOLY, 6, 14, 0.35);
            if (this.inLine(from, dir, LEN, W)) this.hurt(22, from, 8);
          }, GOLD);
        }
        if (ta < FIRE + 0.6) return false;
        // the sword is stuck in the stone: occasionally staggers (the main window is the broken rite)
        if (rnd() < 0.2) { fx.text(this.pos.clone().setY(this.topY + 0.8), t('sword stuck!'), 'crit'); this.daze(1.5); }
        return true;
      }
      case 'sweep': {
        // sword to the side — and a turn with the whole body: a circle around itself
        if (!this.hitDone) {
          this.hitDone = true;
          this.at.copy(this.pos).setY(0);
          const c = this.at.clone();
          this.markCircle(c, 3.5, 0.6, () => {
            if (!this.quiet) sfx.swish();
            fx.shock(c.clone().setY(0.3), 3.7, HOLY, 0.3, 0.2);
            fx.burst(c.clone().setY(1.2), [HOLY, WHITE], 12, { speed: 5, up: 1, size: 0.08, life: 0.4, glow: true, gravity: 4 });
            if (this.inCircle(c, 3.5)) this.hurt(16, c, 6);
          }, HOLY.clone().lerp(RASP, 0.4));
        }
        return ta > 1.15;
      }
      case 'squires': {
        // sword to the sky: three squires rise out of the light
        if (!this.hitDone) {
          this.hitDone = true;
          if (!this.quiet) sfx.choir();
          const f = this.fwd(), side = new THREE.Vector3(f.z, 0, -f.x);
          [[-2.5, 1], [2.5, 1], [0, 2.8]].forEach(([s, k], i) => {
            const p = this.pos.clone().setY(0).addScaledVector(side, s).addScaledVector(f, k);
            this.markCircle(p, 0.9, 0.7, () => {
              const look = SQUIRES[i % SQUIRES.length];
              this.squires.push(this.summon(p, { body: look.body, head: look.head, eye: HOLY, size: 1.15, hp: 35, dmg: 7, speed: 2.8 }));
              fx.light(p.clone().setY(1.5), HOLY, 3, 6, 0.3);
            }, HOLY);
          });
        }
        return ta > 1.3;
      }
      case 'raise': {
        // scales up, 2 s of the rite: light on the graves; not broken — the squires rise again
        const CH = 2.3;
        if (!this.hitDone) {
          this.hitDone = true;
          if (!this.quiet) sfx.raise();
          fx.text(this.pos.clone().setY(this.topY + 0.8), t('resurrection!'), 'crit');
          for (const g of this.graves) this.column(g.pos, CH);
        }
        if (rnd() < 0.5) fx.particle({ pos: this.heart.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1))), vel: new THREE.Vector3(0, 1.5, 0), life: 0.5, size: 0.09, color: rnd() < 0.6 ? HOLY : RASP, gravity: 0 });
        if (ta < CH) return false;
        const room = Math.max(0, 5 - this.squires.length);
        for (const g of this.graves.slice(0, room)) {
          const look = SQUIRES[Math.floor(rand(0, SQUIRES.length))];
          this.squires.push(this.summon(g.pos, { body: look.body, head: look.head, eye: RASP, size: 1.15, hp: 35, dmg: 7, speed: 2.8 }));
          this.pillar(g.pos, 0.6, 0);
        }
        this.clearGraves();
        return true;
      }
    }
    return true;
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, st = this.state, atk = st === 'attack' ? this.attack : '';
    if (st === 'dead') return;
    // step: heavy, legs in turn, the body sways; on a step — the clank of armour and dust
    if (walk) {
      const was = this.stepT % 1;
      this.stepT += dt * 1.5 * this.speedK;
      const k = this.stepT % 1, ph = this.stepT * Math.PI * 2;
      this.legs.forEach((g, i) => { g.rotation.x = Math.sin(ph + i * Math.PI) * 0.35; });
      this.body.rotation.z = Math.sin(ph) * 0.04;
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.1;
      if ((was < 0.5 && k >= 0.5) || k < was) {
        if (!this.quiet) boom(55, 25, 0.3, 0.3);
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.12);
        this.h.fx.burst(this.pos.clone().setY(0.1), DUST, 4, { speed: 1.4, up: 0.8, size: 0.1, life: 0.5, gravity: 6 });
      }
    } else {
      this.legs.forEach((g) => { g.rotation.x *= 0.8; });
      this.body.rotation.z *= 0.85;
      this.body.position.y *= 0.8;
    }
    // sword: at rest — slanted forward; verdict — up and down into the floor; sweep — sideways and a turn; squires — to the sky
    let sw = -0.9, sz = -0.08, sc = -0.5, lean = 0, spin = 0;
    if (st === 'sleep') { sw = -0.7; lean = 0.15; }
    if (atk === 'verdict') {
      const up = Math.min(1, S / 0.5), down = THREE.MathUtils.clamp((S - 1.1) / 0.1, 0, 1);
      sw = -0.9 - 2.2 * up + 2.45 * down;
      lean = -0.15 * up + 0.4 * down;
    }
    if (atk === 'sweep') {
      sw = -1.5; sz = -0.9;
      const k = THREE.MathUtils.clamp((S - 0.5) / 0.35, 0, 1);
      spin = -k * Math.PI * 2;
      lean = 0.1;
    }
    if (atk === 'squires') { sw = -3.0; lean = -0.1; }
    if (atk === 'pillars') { sc = -2.9; lean = -0.08; }
    if (atk === 'raise') { sc = -3.0; sw = -0.6; lean = -0.15 + Math.sin(t * 9) * 0.02; }
    if (st === 'daze') { sw = -0.3; sc = 0; lean = 0.4; }
    this.swordArm.rotation.x += (sw - this.swordArm.rotation.x) * Math.min(1, dt * (atk === 'verdict' ? 20 : 12));
    this.swordArm.rotation.z += (sz - this.swordArm.rotation.z) * Math.min(1, dt * 12);
    this.scalesArm.rotation.x += (sc - this.scalesArm.rotation.x) * Math.min(1, dt * 8);
    this.scalesArm.rotation.z = 0.08;
    // the beam is always level (the pans hang), sways; trembles in the rite
    this.beam.rotation.x = -this.scalesArm.rotation.x;
    this.beam.rotation.z = Math.sin(t * 1.3) * 0.12 + (atk === 'raise' ? Math.sin(t * 20) * 0.08 : 0) - this.scalesArm.rotation.z;
    this.body.rotation.y = spin;
    this.body.rotation.x += (lean - this.body.rotation.x) * Math.min(1, dt * 8);
    // head: lowered in sleep, wobbles when dazed
    this.head.rotation.set(st === 'sleep' ? 0.35 : 0, st === 'daze' ? Math.sin(t * 5) * 0.3 : 0, 0);
    if (st !== 'sleep' && rnd() < 0.05) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-1.2, 1.2), rand(1, 4), rand(-0.8, 0.8))), vel: new THREE.Vector3(0, 0.6, 0), life: 0.8, size: 0.07, color: HOLY, gravity: 0 });
    // berry heart on the pan: beats hard when dazed
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.6 : 1));
  }
}
