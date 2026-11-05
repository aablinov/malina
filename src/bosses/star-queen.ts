import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss, type Minion } from './mini.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Queen of the Star Garden — legendary floor boss (wiki/design-bosses.md, sections 1–4; a schematic "Rennala"):
 * a tall queen of the Order in a stepped night-coloured dress with a gold hem, no legs — hovers above the floor; on her head
 * a crown of white stars and raspberry seeds, in her right hand a staff with a star, behind her back a huge raspberry "moon"
 * of cubes, shimmering gold and raspberry. The berry heart glows on her chest. Keeps far away.
 * Attacks: a starfall on marks at the hero (denser in rage), a comet from the staff along a strip (in rage — a fan of three),
 * apprentices — three glowing pupils and a shield of light: while at least one lives, damage does not pass (a strong hit breaks
 * the shield); the last one died — the shield bursts, the queen is dazed, heart open. In rage — "night": the moon grows,
 * stars rain on the whole arena except the bright circle in her shadow; after the night exhausted.
 * Drops "Starfall", aura — "Clarity". Moving parts: dress, head, two sleeves, staff, moon, heart, shield.
 */

const STAR = C(3.6, 3.6, 4), GOLD = C(4, 3.6, 2.4), PINK = C(4, 1.7, 2.4), SKY = C(1.2, 1.8, 4);
const SAFE_COL = C(1.6, 3.6, 2.2);
/** Radius of the bright circle in the "night" and the rain duration */
const SAFE = 3.4, NIGHT = 4.2;
/** Shield: durability reserve against direct hits and the time limit */
const SHIELD_HP = 400, SHIELD_MAX = 12;

const sfx = {
  /** A star is born: a high chime */
  twinkle(i: number) { bell(1320 + (i % 4) * 330, 0.5, 0.03, 0, 0.7); },
  /** A star fell: a dull thud and sparks */
  impact() { boom(120, 50, 0.3, 0.3); hiss({ dur: 0.25, vol: 0.1, f: 3500, f1: 900, q: 0.8, type: 'bandpass' }); },
  /** Comet: a whistle from top to bottom and a roll of thunder */
  comet() { hiss({ dur: 0.5, vol: 0.2, f: 5000, f1: 600, q: 0.7, type: 'bandpass', verb: 0.6 }); boom(90, 35, 0.6, 0.5, 0.3, 0.5); },
  /** Apprentices: a choir of three voices */
  choir() { for (const [f, d] of [[392, 0], [494, 0.1], [587, 0.2]] as const) voice({ type: 'triangle', f, dur: 1.2, vol: 0.04, delay: d, verb: 0.8 }); },
  /** The shield burst: a glassy ring */
  shatter() { for (const [f, d] of [[1760, 0], [2217, 0.03], [2637, 0.06], [1319, 0.1]] as const) bell(f, 0.6, 0.04, d, 0.7); hiss({ dur: 0.5, vol: 0.18, f: 6000, f1: 2000, q: 0.6, type: 'highpass', verb: 0.6 }); },
  /** Night: a low hum and a bell */
  night() { bell(130, 2.5, 0.08, 0, 0.9); voice({ type: 'sawtooth', f: 65, f1: 98, dur: 2.5, vol: 0.05, lp: 600, lp1: 1800, verb: 0.8 }); },
};

export class StarQueen extends MiniBoss {
  readonly radius = 1.1;
  readonly title = t('Queen of the Star Garden');
  override readonly subtitle = t('legendary raspberry guardian');
  override readonly topY = 4.6;
  readonly drop = 'starfall';
  override readonly tier = 'boss' as const;
  /** Auras to choose from after the victory, chance % — the star garden: clarity, blades, cold of the night */
  override readonly auras = [['clarity', 40], ['blades', 30], ['frost', 30]] as const;
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly staff = new THREE.Group();
  private readonly moon = new THREE.Group();
  private readonly heart = new THREE.Group();
  private readonly star = new THREE.Group();
  private readonly bubble: THREE.Mesh;
  private readonly bubbleMat = glowMat(SKY.clone().multiplyScalar(0.35), 0.35, true);
  /** Deferred actions (the star falls a little later than the mark was laid) */
  private readonly later: { t: number; fn: () => void }[] = [];
  private students: Minion[] = [];
  private shield = false;
  private shieldHp = 0;
  private shieldT = 0;
  private moonK = 1;
  private rainT = 0;
  private studentsCd = 8;
  private nightCd = 99;
  private readonly aim = new THREE.Vector3();

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 1700, home, yaw, arena);
    this.speed = 2.2;
    this.keep = 8;
    this.turn = 2.4;
    this.bubble = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 1), this.bubbleMat);
    this.build();
    this.reset();
  }

  protected build(): void {
    const gown = this.lam('#2a3a6a', pixelTex('#2a3a6a', 10, 731));
    const deep = this.lam('#1c2648');
    const gold = this.lam('#e8c060');
    const skin = this.lam('#e8d8e0');
    const wood = this.lam('#4a3a5a');
    const heartM = this.shimmer(RASP, PINK, 0, 3);
    const starM = this.shimmer(STAR, GOLD, 0.5, 2.2);
    const B = this.box.bind(this);
    // dress: four steps, narrower towards the top; a gold hem along the edge of each
    const tiers = [[1.8, 0.6, 0.3], [1.45, 0.6, 0.9], [1.1, 0.6, 1.5], [0.85, 0.65, 2.1]] as const;
    for (const [w, hh, y] of tiers) {
      B(this.body, y < 1 ? deep : gown, w, hh, w * 0.85, 0, y, 0);
      B(this.body, gold, w + 0.04, 0.07, w * 0.85 + 0.04, 0, y - hh / 2 + 0.04, 0);
    }
    B(this.body, gold, 0.95, 0.12, 0.8, 0, 2.45, 0);
    // berry heart on the chest
    this.heart.position.set(0, 2.1, 0.4);
    this.body.add(this.heart);
    for (const [x, y, z, k] of [[0, 0, 0, 0.24], [0.13, 0.07, 0, 0.15], [-0.13, 0.07, 0, 0.15], [0, 0.07, 0.12, 0.15], [0, -0.1, 0.04, 0.15], [0, 0.2, 0, 0.13]] as const) B(this.heart, heartM, k, k, k, x, y, z);
    // head, tall collar and crown: white stars alternating with raspberry seeds
    this.head.position.set(0, 2.55, 0);
    this.body.add(this.head);
    B(this.head, gown, 0.75, 0.35, 0.3, 0, 0.3, -0.3);
    B(this.head, skin, 0.5, 0.5, 0.48, 0, 0.32, 0);
    B(this.head, glowMat(SKY), 0.32, 0.06, 0.04, 0, 0.36, 0.25);
    B(this.head, gold, 0.56, 0.08, 0.54, 0, 0.6, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, big = i % 2 === 0;
      B(this.head, big ? starM : heartM, big ? 0.1 : 0.12, big ? 0.28 : 0.12, big ? 0.1 : 0.12, Math.sin(a) * 0.3, big ? 0.78 : 0.7, Math.cos(a) * 0.3);
    }
    // bell sleeves; gold cuffs
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.6, 2.35, 0);
      this.body.add(g);
      B(g, gown, 0.32, 0.9, 0.34, 0, -0.42, 0);
      B(g, gown, 0.44, 0.3, 0.46, 0, -0.85, 0);
      B(g, gold, 0.46, 0.06, 0.48, 0, -1.0, 0);
      this.arms.push(g);
    }
    // staff with a star: held in the right hand, the hinge at the wrist
    this.staff.position.set(-0.75, 1.4, 0.3);
    this.body.add(this.staff);
    B(this.staff, wood, 0.1, 2.8, 0.1, 0, 0.3, 0);
    B(this.staff, gold, 0.2, 0.1, 0.2, 0, 1.6, 0);
    this.star.position.set(0, 1.95, 0);
    this.staff.add(this.star);
    B(this.star, starM, 0.32, 0.32, 0.32, 0, 0, 0, 0, 0, Math.PI / 4);
    for (const [x, y] of [[0, 0.3], [0, -0.3], [0.3, 0], [-0.3, 0]]) B(this.star, starM, 0.1, 0.1, 0.1, x, y, 0);
    // the moon behind her back: a flat disc of seed cubes, light runs over it in rings
    this.moon.position.set(0, 2.9, -0.75);
    this.body.add(this.moon);
    const ring = [0, 1, 2].map((i) => this.shimmer(GOLD, RASP, i * 1.2, 1.1));
    for (let ix = -4; ix <= 4; ix++) for (let iy = -4; iy <= 4; iy++) {
      const r = Math.hypot(ix, iy);
      if (r > 4.3) continue;
      B(this.moon, ring[Math.floor(r) % 3], 0.36, 0.36, 0.14, ix * 0.37, iy * 0.37, (ix + iy) % 2 ? 0 : -0.06);
    }
    // the apprentices' shield: a bright bubble around
    this.bubble.position.y = 2.1;
    this.bubble.visible = false;
    this.group.add(this.bubble);
  }

  override reset(): void {
    super.reset();
    this.later.length = 0;
    this.students = [];
    this.shield = false; this.shieldT = 0; this.moonK = 1;
    this.studentsCd = 8; this.nightCd = 99;
  }

  protected override die(): void {
    super.die();
    this.later.length = 0;
    this.students = [];
    this.shield = false;
  }

  protected override onEnrage(): void {
    this.nightCd = 0;
    this.h.fx.screenFlash('#a0b8ff', 0.25, 0.3);
  }

  /** While an apprentice lives the shield holds the hit (except in daze); a strong hit breaks the shield */
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.shield && this.state !== 'daze' && this.awake && !this.dead) {
      this.shieldHp -= dmg;
      this.h.fx.text(point.clone().setY(point.y + 0.6), t('shield'));
      this.h.fx.flash(point.clone(), SKY, 0.8, 0.12);
      if (this.shieldHp <= 0) this.dropShield(false);
      return;
    }
    super.hit(dmg, dir, point, knock);
  }

  protected choose(): string | null {
    if (this.enraged && this.nightCd <= 0) return 'night';
    if (this.studentsCd <= 0 && !this.shield) return 'students';
    return rnd() < 0.5 ? 'starfall' : 'comet';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'starfall': {
        // marks one after another: the first under the hero, the rest around; the stars fall in turn
        if (!this.hitDone) {
          this.hitDone = true;
          const n = this.enraged ? 14 : 8;
          for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2), r = i === 0 ? 0 : rand(1.5, 5.5);
            this.fallingStar(this.clampIn(this.heroAt().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), 1), 1.0 + i * 0.16, 1.3, i);
          }
        }
        return t > 1.6;
      }
      case 'comet': {
        // staff forward — a strip to the hero (in rage — a fan of three) — a comet flies along it
        if (!this.hitDone) {
          this.hitDone = true;
          this.aim.copy(this.heroAt()).sub(this.pos).setY(0);
          if (this.aim.lengthSq() < 1e-4) this.aim.copy(this.fwd());
          this.aim.normalize();
          this.yaw = Math.atan2(this.aim.x, this.aim.z);
          const from = this.pos.clone().setY(0);
          for (const da of this.enraged ? [-0.35, 0, 0.35] : [0]) {
            const dir = this.aim.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), da);
            this.markLine(from, dir, 18, 1.6, 0.9, () => this.comet(from, dir), GOLD);
          }
        }
        return t > 1.5;
      }
      case 'students': {
        // choir — three apprentices step out of the stars, the shield wraps the queen
        if (!this.hitDone) { this.hitDone = true; this.studentsCd = 20; if (!this.quiet) sfx.choir(); }
        for (let i = 0; i < 3; i++) {
          const at = 0.4 + i * 0.2;
          if (t >= at && t - dt < at) {
            const a = this.yaw + (i - 1) * 1.1;
            this.students.push(this.summon(this.pos.clone().add(new THREE.Vector3(Math.sin(a) * 2.6, 0, Math.cos(a) * 2.6)), { body: '#c8d4ff', head: '#2a3a6a', eye: STAR, size: 0.9, hp: 40, dmg: 6, speed: 2.6 }));
            fx.burst(this.star.getWorldPosition(new THREE.Vector3()), [STAR, GOLD], 10, { speed: 2, up: 2, size: 0.1, life: 0.6, glow: true, gravity: 0 });
          }
        }
        if (t >= 1.0 && t - dt < 1.0) {
          this.shield = true; this.shieldHp = SHIELD_HP; this.shieldT = 0;
          fx.shock(this.pos.clone().setY(2), 2.4, SKY, 0.4, 0.2);
        }
        return t > 1.4;
      }
      case 'night': {
        // the moon grows, stars rain on the whole arena; it is bright only in her shadow
        if (!this.hitDone) {
          this.hitDone = true;
          this.nightCd = 22;
          this.rainT = 0;
          this.safeRing();
          if (!this.quiet) sfx.night();
          fx.screenFlash('#203060', 0.35, 0.6);
        }
        this.moonK = Math.min(1.9, this.moonK + dt * 1.5);
        if (t > 0.4 && t < NIGHT) {
          this.rainT -= dt;
          if (this.rainT <= 0) {
            this.rainT = 0.14;
            const a = this.arena;
            for (let k = 0, made = 0; k < 12 && made < 3; k++) {
              const p = new THREE.Vector3(rand(a.x0 + 1, a.x1 - 1), 0, rand(a.z0 + 1, a.z1 - 1));
              if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < SAFE + 1.5) continue;
              this.fallingStar(p, 0.8, 1.5, made++);
            }
          }
        }
        if (t < NIGHT + 1) return false;
        this.daze(2);
        return true;
      }
    }
    return true;
  }

  /** A mark and, at the end, a star that falls into it from above: damage 14 */
  private fallingStar(at: THREE.Vector3, dur: number, r: number, i: number): void {
    this.markCircle(at, r, dur, () => {
      const fx = this.h.fx;
      fx.burst(at.clone().setY(0.3), [STAR, GOLD, RASP], 10, { speed: 3, up: 3, size: 0.1, life: 0.5, glow: true, gravity: 6 });
      fx.shock(at.clone().setY(0.08), r, GOLD.clone().multiplyScalar(0.6), 0.3, 0.12);
      if (!this.quiet && i % 3 === 0) sfx.impact();
      if (this.inCircle(at, r)) this.hurt(14, at, 3);
    }, GOLD);
    this.later.push({ t: dur - 0.3, fn: () => {
      const m = new THREE.Mesh(UNIT, glowMat(i % 3 === 2 ? RASP : STAR));
      m.scale.setScalar(0.45);
      this.lob(m, at.clone().add(new THREE.Vector3(rand(-1, 1), 13, rand(-1, 1))), at, 0.3, 0, GOLD, () => undefined);
      if (!this.quiet && i % 4 === 0) sfx.twinkle(i);
    } });
  }

  /** The comet flies along the strip: damage 20 */
  private comet(from: THREE.Vector3, dir: THREE.Vector3): void {
    const fx = this.h.fx;
    if (!this.quiet) sfx.comet();
    const mat = glowMat(STAR), tail = glowMat(GOLD.clone().multiplyScalar(0.6), 0.7, true), g = new THREE.Group();
    this.box(g, mat, 0.6, 0.6, 0.6, 0, 0, 0, 0.6, 0.6, 0);
    this.box(g, tail, 0.4, 0.4, 2.2, 0, 0, -1.3);
    g.rotation.y = Math.atan2(dir.x, dir.z);
    fx.custom(g, 0.4, (k) => {
      g.position.copy(from).addScaledVector(dir, 18 * k).setY(1.1);
      if (rnd() < 0.8) fx.particle({ pos: g.position.clone(), vel: new THREE.Vector3(rand(-0.5, 0.5), rand(0, 1), rand(-0.5, 0.5)), life: 0.4, size: 0.12, color: rnd() < 0.7 ? GOLD : RASP, gravity: 0 });
    }, () => { mat.dispose(); tail.dispose(); });
    fx.light(from.clone().setY(1.5), GOLD, 5, 10, 0.4);
    if (this.inLine(from, dir, 18, 1.6)) this.hurt(20, from, 6);
  }

  /** Bright circle under the queen: stars do not fall there */
  private safeRing(): void {
    const at = this.pos.clone();
    const fill = new THREE.MeshBasicMaterial({ color: SAFE_COL.clone().multiplyScalar(0.25), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const edgeM = new THREE.MeshBasicMaterial({ color: SAFE_COL, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const fillG = new THREE.CircleGeometry(SAFE, 40), edgeG = new THREE.RingGeometry(SAFE - 0.18, SAFE, 48);
    const disc = new THREE.Mesh(fillG, fill), edge = new THREE.Mesh(edgeG, edgeM);
    disc.add(edge);
    edge.position.z = 0.004;
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(at.x, 0.07, at.z);
    this.h.fx.custom(disc, NIGHT + 0.6, (k) => {
      const a = Math.min(1, k * 8) * Math.min(1, (1 - k) * 8);
      fill.opacity = 0.6 * a; edgeM.opacity = a * (0.75 + Math.sin(this.time * 6) * 0.25);
    }, () => { fill.dispose(); edgeM.dispose(); fillG.dispose(); edgeG.dispose(); });
  }

  /** The shield fades: the apprentices fell — the queen is dazed (the main damage window); broken or expired — no daze */
  private dropShield(stun: boolean): void {
    if (!this.shield) return;
    this.shield = false;
    const fx = this.h.fx, c = this.pos.clone().setY(2.1);
    fx.burst(c, [SKY, STAR, RASP], 30, { speed: 6, up: 2, size: 0.14, life: 0.8, glow: true, gravity: 4 });
    fx.shock(this.pos.clone().setY(0.1), 3, SKY, 0.4, 0.15);
    fx.text(c.clone().setY(this.topY + 0.6), t('shield shattered'), 'crit');
    if (!this.quiet) sfx.shatter();
    if (stun && !this.dead) this.daze(2.5);
  }

  override update(dt: number): void {
    super.update(dt);
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      l.t -= dt;
      if (l.t <= 0) { this.later.splice(i, 1); l.fn(); }
    }
    if (this.shield) {
      this.shieldT += dt;
      this.students = this.students.filter((s) => !s.dead);
      if (this.students.length === 0) this.dropShield(true);
      else if (this.shieldT > SHIELD_MAX) this.dropShield(false);
    }
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, dead = this.state === 'dead', daze = this.state === 'daze';
    if (this.awake) { this.studentsCd -= dt; this.nightCd -= dt; }
    const atk = this.state === 'attack' ? this.attack : '';
    // hovers ~1 m above the floor, sways slowly; sinks lower when dazed
    if (!dead) {
      this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, (daze ? 0.35 : 1) + Math.sin(t * 1.3) * 0.15, 0.08);
      this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, daze ? 0.25 : walk ? 0.08 : 0, 0.1);
    }
    // head: drooping in sleep and in daze, thrown back in the night
    this.head.rotation.x = this.state === 'sleep' || daze ? 0.4 : atk === 'night' ? -0.4 : Math.sin(t * 0.8) * 0.05;
    // sleeves: raised in the starfall and the night, spread on the apprentices, the right one reaches forward on the comet
    const up = atk === 'starfall' || atk === 'night';
    this.arms.forEach((g, i) => {
      const s = i ? 1 : -1, right = i === 0;
      const rx = up ? -2.6 + Math.sin(S * 6 + i) * 0.15 : atk === 'comet' && right ? (S < 0.5 ? -0.4 : -1.4) : atk === 'students' ? -1.2 : daze ? 0.15 : -0.25;
      g.rotation.set(rx, 0, s * (atk === 'students' ? 0.8 : 0.12));
    });
    // staff: on the comet — a lunge forward with the star, in the starfall — raised
    const srx = atk === 'comet' ? (S < 0.5 ? -0.3 : 1.25) : up ? -0.2 : daze ? 0.5 : 0.08;
    this.staff.rotation.x = THREE.MathUtils.lerp(this.staff.rotation.x, srx, 0.2);
    this.staff.position.y = THREE.MathUtils.lerp(this.staff.position.y, up ? 2.0 : atk === 'comet' && S > 0.5 ? 1.8 : 1.4, 0.15);
    this.star.rotation.z += dt * 2;
    this.star.scale.setScalar(1 + Math.max(0, Math.sin(t * 5)) * 0.15 + (atk === 'comet' && S < 0.9 ? S * 0.6 : 0));
    // moon: rotates slowly; grows in the night, then subsides
    if (atk !== 'night') this.moonK = THREE.MathUtils.lerp(this.moonK, 1, 0.03);
    this.moon.scale.setScalar(this.moonK);
    this.moon.rotation.z += dt * 0.15;
    // heart: beats quietly, dazed — hard
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 4)) * 0.1;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.9 : 1));
    // shield: breathes and flickers
    this.bubble.visible = this.shield && !dead;
    if (this.shield) {
      this.bubble.rotation.y += dt * 0.6;
      this.bubble.scale.setScalar(1 + Math.sin(t * 3) * 0.03);
      this.bubbleMat.opacity = 0.28 + Math.sin(t * 7) * 0.06;
    }
    // star sparks around
    if (!dead && this.state !== 'sleep' && rnd() < 0.4) {
      const a = rand(0, Math.PI * 2), r = rand(0.8, 1.8) * this.moonK;
      this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(1, 4.2) + this.body.position.y * 0.5, Math.sin(a) * r)), vel: new THREE.Vector3(0, rand(0.1, 0.4), 0), life: rand(0.5, 1), size: rand(0.05, 0.1), color: rnd() < 0.6 ? STAR : rnd() < 0.5 ? GOLD : RASP, gravity: 0 });
    }
  }
}
