import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';
import { t } from '../i18n/i18n.ts';

/**
 * First Gardener — final boss (wiki/design-bosses.md, sections 1–5): the one who planted the first raspberry bush. An old
 * stone titan ~4 m: a mossy body, a straw hat of planks, a long beard of vines, a pick-hoe in hand, on the back
 * a small raspberry patch with burning berries; on the chest the largest berry, the heart (beats hard when dazed). The light of earth
 * shimmers into raspberry. Phase 1 (gardener): a hoe strike — a strip, spikes from the furrow, the hoe gets stuck (dazed); sowing —
 * five seeds in arcs around the hero, a thorn bush from each; a stomp all around; sprout minions. At 50 % — the transformation
 * "Titan Form": the world darkens, the camera pulls back, the hat flies off, the stone cracks, the warden grows 1.7× over 1.5 s,
 * the raspberry patch blooms; every step shakes the screen. Phase 2 (titan): "earthquake" — both fists into the ground, three spreading
 * waves, then winded (dazed); a boulder out of the ground in an arc — a rockfall; "harvest" — the hoe all around. Drops "Titan Form".
 * Moving parts: two legs, torso (with head, beard and garden), two arms (right with the hoe), hat, heart.
 */

const EARTH = C(4, 2.6, 0.8), LEAF = C(1.2, 3, 0.6), PINK = C(4, 1.7, 2.4), BLOOM = C(4, 3.6, 2.4);
const STONE = '#7a7468', MOSS = '#5a7a3a', PLANK = '#c8a060', VINE = '#3f6a2a';
const DUST = ['#7a7468', '#5a5248', '#5a7a3a'];
/** Growth in the second form and the transformation time */
const GROW = 1.7, GROW_T = 1.5;
const HOE_LEN = 10, HOE_W = 2.4, HOE_AIM = 0.8;
const QUAKE_R = [4.5, 8, 11.5] as const;

const sfx = {
  /** Ground impact: a low rumble and a crack */
  slam(k = 1) { boom(60, 22, 0.9 * k, 0.6 * k, 0.02, 0.5); hiss({ dur: 0.4, vol: 0.2 * k, f: 900, f1: 200, q: 0.7, type: 'lowpass', verb: 0.4 }); },
  /** Rustle of leaves: seeds, bushes */
  rustle() { hiss({ dur: 0.35, vol: 0.12, f: 2600, f1: 1200, q: 0.8, type: 'bandpass', verb: 0.3 }); },
  /** Stone step of the titan */
  step() { boom(48, 26, 0.35, 0.35); },
  /** Stone groan of the transformation */
  groan() { voice({ type: 'sawtooth', f: 70, f1: 40, dur: 1.6, vol: 0.09, detune: 25, lp: 700, lp1: 180, verb: 0.7 }); boom(40, 16, 1.8, 0.9, 0.1, 0.7); },
};

export class FirstGardener extends MiniBoss {
  readonly title = t('First Gardener');
  override readonly subtitle = t('the one who planted the raspberries');
  override readonly tier = 'final' as const;
  readonly drop = 'titanform';
  /** Grows in the second form — change together with the growth */
  radius = 1.3;
  override topY = 4.3;
  private readonly rig = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly hat = new THREE.Group();
  private readonly heart = new THREE.Group();
  /** Blooming of the raspberry patch and stone cracks (second form) — static, on the torso */
  private readonly bloom = new THREE.Group();
  private readonly cracks = new THREE.Group();
  private gait = 0;
  private last = '';
  /** Transformation: since its start, −1 — none yet */
  private growT = -1;
  private quakeHit = false;

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 3500, home, yaw, arena);
    this.speed = 2.2;
    this.keep = 3.5;
    this.turn = 2;
    this.build();
    this.reset();
  }

  protected build(): void {
    const stone = this.lam(STONE, pixelTex(STONE, 12, 951));
    const moss = this.lam(MOSS, pixelTex(MOSS, 14, 952));
    const plank = this.lam(PLANK, pixelTex(PLANK, 12, 953));
    const vine = this.lam(VINE, pixelTex(VINE, 10, 954));
    const wood = this.lam('#6b4a2a', pixelTex('#6b4a2a', 8, 955));
    const iron = this.lam('#8a8c90');
    const soil = this.lam('#4a3424', pixelTex('#4a3424', 10, 956));
    const glow = this.shimmer(EARTH, RASP, 0, 1.4);
    const eyes = this.shimmer(EARTH, RASP, 1.5, 2);
    const berry = this.shimmer(RASP, PINK, 1, 3);
    const heartM = this.shimmer(RASP, EARTH, 0, 3);
    const crackM = this.shimmer(EARTH, RASP, 2, 2.4);
    const B = this.box.bind(this);
    this.body.add(this.rig);
    // legs: stone pillars, moss on the feet
    for (const [g, s] of [[this.legL, -1], [this.legR, 1]] as const) {
      g.position.set(s * 0.55, 1.3, 0);
      this.rig.add(g);
      B(g, stone, 0.75, 1.3, 0.8, 0, -0.62, 0);
      B(g, moss, 0.85, 0.25, 0.95, 0, -1.18, 0.05);
    }
    // torso: a boulder, moss on the shoulders and belly, a glowing vein; head with slit eyes and a beard of vines
    this.torso.position.y = 1.3;
    this.rig.add(this.torso);
    B(this.torso, stone, 1.9, 1.6, 1.2, 0, 0.85, 0);
    B(this.torso, moss, 2.0, 0.3, 1.3, 0, 1.6, 0);
    B(this.torso, moss, 1.2, 0.35, 0.1, 0, 0.25, 0.62);
    B(this.torso, glow, 0.08, 0.9, 0.05, -0.55, 0.85, 0.61);
    B(this.torso, stone, 1.0, 0.95, 0.95, 0, 2.15, 0.05);
    B(this.torso, stone, 0.22, 0.3, 0.2, 0, 2.08, 0.6);
    B(this.torso, eyes, 0.7, 0.1, 0.05, 0, 2.3, 0.53);
    B(this.torso, vine, 0.85, 0.35, 0.25, 0, 1.75, 0.55);
    for (const [x, l] of [[-0.3, 0.9], [0, 1.2], [0.3, 0.8]] as const) B(this.torso, vine, 0.2, l, 0.18, x, 1.6 - l / 2, 0.64);
    B(this.torso, berry, 0.14, 0.14, 0.14, 0.12, 0.65, 0.72);
    // heart: the largest berry — on the chest, in a nest of moss
    this.heart.position.set(0.45, 1.0, 0.66);
    this.torso.add(this.heart);
    B(this.heart, heartM, 0.42, 0.48, 0.3, 0, 0, 0);
    for (const [x, y] of [[-0.14, 0.14], [0.14, 0.1], [0, -0.17], [0.15, -0.12], [-0.15, -0.1]] as const) B(this.heart, berry, 0.16, 0.16, 0.12, x, y, 0.13);
    B(this.heart, vine, 0.3, 0.1, 0.26, 0, 0.28, 0);
    // raspberry patch on the back: a ridge of earth, three bushes with berries
    B(this.torso, soil, 1.7, 0.3, 0.8, 0, 1.75, -0.95);
    for (const [x, hgt] of [[-0.55, 0.6], [0.05, 0.85], [0.6, 0.55]] as const) {
      B(this.torso, vine, 0.5, hgt, 0.5, x, 1.9 + hgt / 2, -0.95);
      B(this.torso, berry, 0.13, 0.13, 0.13, x + 0.2, 1.95 + hgt * 0.7, -0.75);
      B(this.torso, berry, 0.13, 0.13, 0.13, x - 0.15, 1.95 + hgt * 0.4, -1.2);
    }
    // blooming: bushes taller, berries bigger and denser, white flowers
    this.torso.add(this.bloom);
    for (let i = 0; i < 9; i++) {
      const x = -0.75 + (i % 3) * 0.75 + rand(-0.1, 0.1), z = -0.95 + (Math.floor(i / 3) - 1) * 0.3, y = 2.5 + rand(0, 0.7);
      B(this.bloom, i % 3 === 1 ? vine : berry, 0.22, 0.22, 0.22, x, y, z);
      if (i % 2 === 0) B(this.bloom, glowMat(BLOOM), 0.12, 0.05, 0.12, x + 0.1, y + 0.16, z + 0.1);
    }
    B(this.bloom, vine, 0.6, 0.6, 0.6, 0, 3.0, -0.95);
    // cracks: glowing veins on the chest, shoulders, head
    this.torso.add(this.cracks);
    for (const [w, hh, x, y, z, rz] of [[0.08, 1.1, 0.1, 0.9, 0.61, 0.4], [0.06, 0.7, -0.3, 0.5, 0.61, -0.6], [0.06, 0.8, 0.96, 0.9, 0, 0.2], [0.06, 0.8, -0.96, 1.0, 0, -0.3], [0.06, 0.5, 0.25, 2.3, 0.53, 0.5]] as const) {
      const m = B(this.cracks, crackM, w, hh, 0.05, x, y, z, 0, 0, rz);
      if (Math.abs(x) > 0.9) m.scale.set(0.05, hh, w * 8);
    }
    // hat of planks
    this.hat.position.set(0, 2.62, 0.05);
    this.torso.add(this.hat);
    B(this.hat, plank, 1.8, 0.12, 1.8, 0, 0, 0);
    B(this.hat, plank, 1.05, 0.45, 1.05, 0, 0.28, 0);
    B(this.hat, vine, 1.08, 0.1, 1.08, 0, 0.1, 0);
    // arms: the right holds the hoe (handle forward from the fist, the iron down at the end)
    for (const [g, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      g.position.set(s * 1.2, 1.5, 0);
      this.torso.add(g);
      B(g, moss, 0.7, 0.4, 0.75, 0, 0.05, 0);
      B(g, stone, 0.58, 1.3, 0.62, 0, -0.65, 0);
      B(g, stone, 0.72, 0.6, 0.72, 0, -1.5, 0);
    }
    B(this.armR, wood, 0.16, 0.16, 3.2, 0, -1.5, 0.9);
    B(this.armR, iron, 0.3, 0.95, 0.55, 0, -1.85, 2.4);
    B(this.armR, glow, 0.32, 0.12, 0.57, 0, -2.25, 2.4);
  }

  override reset(): void {
    super.reset();
    this.last = ''; this.gait = 0; this.growT = -1; this.quakeHit = false;
    this.setSize(1);
    this.speed = 2.2; this.keep = 3.5;
    this.hat.visible = true; this.hat.position.set(0, 2.62, 0.05); this.hat.rotation.set(0, 0, 0);
    this.bloom.visible = false; this.cracks.visible = false;
  }

  /** Body growth: with it — radius and top */
  private setSize(s: number): void {
    this.rig.scale.setScalar(s);
    this.radius = 1.3 * s;
    this.topY = 4.3 * s;
  }

  protected override cry(): void { if (!this.quiet) { voice({ type: 'sawtooth', f: 82, f1: 55, dur: 1.3, vol: 0.08, detune: 18, lp: 800, verb: 0.6 }); boom(50, 22, 1.1, 0.6, 0.1, 0.5); } }

  /** Transformation "Titan Form": darkness, camera back, the hat flies off, the stone cracks, growth 1.7× over 1.5 s */
  protected override onEnrage(): void {
    const fx = this.h.fx;
    this.growT = 0;
    this.speed = 1.7; this.keep = 4.5;
    this.cracks.visible = true;
    fx.title(t('Titan Form'), '#ffb040');
    fx.darken(1.8);
    fx.zoom = Math.max(fx.zoom, 0.45);
    fx.shake = Math.max(fx.shake, 1.2);
    fx.screenFlash('#ffb040', 0.35, 0.4);
    fx.shock(this.pos.clone().setY(0.1), 9, EARTH, 0.9, 0.25);
    fx.burst(this.pos.clone().setY(2.5), [EARTH, RASP, BLOOM, ...DUST], 50, { speed: 6, up: 6, size: 0.16, life: 1.2, glow: true, gravity: 6 });
    fx.light(this.pos.clone().setY(3), EARTH, 6, 16, 1.5);
    if (!this.quiet) sfx.groan();
    if (this.state !== 'daze' && this.state !== 'dead') this.go('attack', 'grow');
  }

  protected choose(dist: number): string | null {
    const r = rnd(), few = this.minions.length < 2;
    if (this.enraged) {
      if (dist < this.radius + 4.5) return this.pick(r < 0.4 ? 'harvest' : r < 0.75 ? 'quake' : 'boulder');
      return this.pick(r < 0.55 ? 'boulder' : r < 0.85 ? 'quake' : 'harvest');
    }
    if (dist < this.radius + 3) return this.pick(r < 0.45 ? 'hoe' : r < 0.8 ? 'stomp' : few ? 'gardeners' : 'seeds');
    if (dist < 9) return this.pick(r < 0.5 ? 'hoe' : r < 0.8 ? 'seeds' : few ? 'gardeners' : 'stomp');
    return this.pick(r < 0.6 ? 'seeds' : few ? 'gardeners' : 'hoe');
  }

  /** Do not repeat an attack twice in a row */
  private pick(a: string): string {
    if (a === this.last) a = ({ hoe: 'stomp', stomp: 'hoe', seeds: 'hoe', gardeners: 'seeds', quake: 'harvest', harvest: 'boulder', boulder: 'quake' } as Record<string, string>)[a] ?? a;
    this.last = a;
    return a;
  }

  protected act(name: string, ta: number, dt: number): boolean {
    const fx = this.h.fx, at = (x: number) => ta >= x && ta - dt < x;
    switch (name) {
      case 'grow': return ta > GROW_T + 0.3;
      case 'hoe': {
        // hoe overhead → a strip forward → strike, spikes from the furrow; the hoe stuck — dazed
        if (!this.hitDone) { this.hitDone = true; this.markLine(this.pos.clone().setY(0), this.fwd(), HOE_LEN, HOE_W, HOE_AIM, () => undefined, EARTH); }
        if (at(HOE_AIM)) {
          const from = this.pos.clone().setY(0), dir = this.fwd();
          if (!this.quiet) sfx.slam();
          fx.shake = Math.max(fx.shake, 0.8);
          fx.hitstop = Math.max(fx.hitstop, 0.05);
          fx.burst(from.clone().addScaledVector(dir, 3).setY(0.3), DUST, 20, { speed: 5, up: 5, size: 0.14, life: 0.8, gravity: 12 });
          this.spikes(from, dir);
          if (this.inLine(from, dir, HOE_LEN, HOE_W)) this.hurt(20, from, 8);
        }
        if (ta < HOE_AIM + 0.3) return false;
        fx.text(this.pos.clone().setY(this.topY + 0.6), t('hoe stuck!'), '');
        this.daze(2);
        return true;
      }
      case 'seeds': {
        // a handful of seeds: five arcs onto marks around the hero; where one lands — a thorn bush
        if (at(0.45)) {
          if (!this.quiet) sfx.rustle();
          const hero = this.heroAt(), hand = this.pos.clone().addScaledVector(this.fwd(), 0.6).setY(this.topY * 0.75);
          for (let i = 0; i < 5; i++) {
            const a = (i / 4) * Math.PI * 2 + rand(0, 1), p = i === 0 ? hero.clone() : hero.clone().add(new THREE.Vector3(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2));
            this.clampIn(p, 1.5);
            const dur = 1 + i * 0.08;
            this.markCircle(p, 1.4, dur, () => undefined, LEAF);
            const seed = new THREE.Mesh(UNIT, glowMat(LEAF));
            seed.scale.setScalar(0.25);
            this.lob(seed, hand, p, dur, 4, LEAF, (q) => this.sprout(q));
          }
        }
        return ta > 1.9;
      }
      case 'stomp': {
        if (!this.hitDone) { this.hitDone = true; this.markCircle(this.pos, 4, 0.9, () => undefined); }
        if (at(0.9)) {
          if (!this.quiet) sfx.slam(0.8);
          fx.shake = Math.max(fx.shake, 0.7);
          fx.shock(this.pos.clone().setY(0.1), 4.3, EARTH, 0.45, 0.25);
          fx.burst(this.pos.clone().setY(0.3), DUST, 18, { speed: 5, up: 4, size: 0.14, life: 0.7, gravity: 12 });
          if (this.inCircle(this.pos, 4)) this.hurt(18, this.pos, 10);
        }
        return ta > 1.4;
      }
      case 'gardeners': {
        if (at(0.5)) {
          if (!this.quiet) sfx.rustle();
          const n = rnd() < 0.5 ? 2 : 3;
          for (let i = 0; i < n; i++) {
            const a = this.yaw + (i - (n - 1) / 2) * 0.9;
            this.summon(this.pos.clone().add(new THREE.Vector3(Math.sin(a) * 3, 0, Math.cos(a) * 3)), { body: MOSS, head: VINE, eye: RASP, hp: 40, dmg: 6, speed: 2.8 });
          }
        }
        return ta > 1.1;
      }
      case 'quake': {
        // both fists into the ground → three waves spread one after another; then winded — dazed
        if (!this.hitDone) {
          this.hitDone = true;
          this.quakeHit = false;
          const c = this.pos.clone().setY(0);
          QUAKE_R.forEach((r, i) => {
            const r0: number = i === 0 ? 0 : QUAKE_R[i - 1] ?? 0;
            this.markCircle(c, r, 1.1 + i * 0.45, () => {
              if (this.state === 'dead') return;
              if (!this.quiet) sfx.slam(1 - i * 0.2);
              fx.shake = Math.max(fx.shake, 1.1 - i * 0.2);
              fx.shock(c.clone().setY(0.1), r, i === 1 ? RASP : EARTH, 0.4, 0.3);
              for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; fx.burst(c.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.9, 0.3, Math.sin(a) * r * 0.9)), DUST, 2, { speed: 3, up: 4, size: 0.16, life: 0.7, gravity: 12 }); }
              const hp = this.h.hero.pos, d = Math.hypot(hp.x - c.x, hp.z - c.z);
              if (!this.quakeHit && this.inCircle(c, r) && d > r0 - 0.6) { this.quakeHit = true; this.hurt(22, c, 9); }
            }, i === 1 ? RASP : C(2.2, 0.35, 0.18));
          });
        }
        if (at(1.1)) fx.hitstop = Math.max(fx.hitstop, 0.08);
        if (ta < 2.3) return false;
        fx.text(this.pos.clone().setY(this.topY + 0.6), t('winded!'), '');
        this.daze(2.5);
        return true;
      }
      case 'boulder': {
        // lean, a boulder out of the ground → a lob, a big mark; rockfall
        if (at(0.9)) {
          if (!this.quiet) sfx.slam(0.6);
          fx.burst(this.pos.clone().addScaledVector(this.fwd(), 1.5).setY(0.3), DUST, 16, { speed: 4, up: 5, size: 0.16, life: 0.8, gravity: 12 });
          const to = this.clampIn(this.heroAt(), 2.5), from = this.pos.clone().setY(this.topY + 0.5);
          this.markCircle(to, 3, 1.1, () => undefined);
          const rock = new THREE.Mesh(UNIT, new THREE.MeshLambertMaterial({ color: STONE }));
          rock.scale.setScalar(1.6);
          rock.castShadow = true;
          this.lob(rock, from, to, 1.1, 6, EARTH, (q) => {
            if (this.state === 'dead') return;
            if (!this.quiet) sfx.slam(1.1);
            fx.shake = Math.max(fx.shake, 1);
            fx.explosion(q.clone().setY(0.3), 3, EARTH);
            fx.burst(q.clone().setY(0.5), DUST, 26, { speed: 6, up: 6, size: 0.22, life: 1, gravity: 14 });
            if (this.inCircle(q, 3)) this.hurt(26, q, 10);
            this.hazard(q, 2.2, 6, 8, EARTH, 0.4);
          });
        }
        if (ta < 0.8) this.face(dt, 0.8);
        return ta > 2.1;
      }
      case 'harvest': {
        // the hoe all around: a mark 1 s → a full swing
        if (!this.hitDone) { this.hitDone = true; this.markCircle(this.pos, 6, 1, () => undefined); }
        if (at(1)) {
          if (!this.quiet) { sfx.slam(0.7); hiss({ dur: 0.5, vol: 0.2, f: 600, f1: 2400, q: 0.6, verb: 0.4 }); }
          fx.shake = Math.max(fx.shake, 0.8);
          for (let k = 0; k < 4; k++) fx.arc(this.pos, this.yaw + k * Math.PI / 2, k % 2 ? RASP : EARTH, 6.2, 0.85, 1.2);
          fx.shock(this.pos.clone().setY(0.1), 6.2, EARTH, 0.4, 0.2);
          if (this.inCircle(this.pos, 6)) this.hurt(24, this.pos, 12);
        }
        return ta > 1.7;
      }
    }
    return true;
  }

  /** Furrow: spikes rise out of the ground along the strip and go back */
  private spikes(from: THREE.Vector3, dir: THREE.Vector3): void {
    const mat = new THREE.MeshLambertMaterial({ color: STONE }), tip = glowMat(EARTH), g = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const d = 1.2 + i * 1.0, side = (i % 2 ? 1 : -1) * rand(0.1, 0.6), hh = rand(0.9, 1.6);
      const x = from.x + dir.x * d + dir.z * side, z = from.z + dir.z * d - dir.x * side;
      const s = new THREE.Mesh(UNIT, mat); s.scale.set(0.4, hh, 0.4); s.position.set(x, hh / 2, z); s.rotation.set(rand(-0.3, 0.3), rand(0, 3), rand(-0.3, 0.3)); g.add(s);
      const t = new THREE.Mesh(UNIT, tip); t.scale.set(0.2, 0.3, 0.2); t.position.set(x, hh + 0.1, z); g.add(t);
    }
    this.h.fx.custom(g, 1.2, (k) => { g.position.y = k < 0.15 ? -1.8 * (1 - k / 0.15) : k > 0.7 ? -1.8 * ((k - 0.7) / 0.3) : 0; }, () => { mat.dispose(); tip.dispose(); });
  }

  /** A seed landed: strike 12, a thorn bush — a zone 10/s for 5 s */
  private sprout(at: THREE.Vector3): void {
    if (this.state === 'dead') return;
    const fx = this.h.fx;
    fx.burst(at.clone().setY(0.3), [LEAF, VINE, RASP], 10, { speed: 3, up: 3, size: 0.1, life: 0.5, gravity: 10 });
    if (this.inCircle(at, 1.4)) this.hurt(12, at, 3);
    this.hazard(at, 1.3, 5, 10, LEAF, 0.3);
    const leaf = new THREE.MeshLambertMaterial({ color: VINE }), b = glowMat(RASP), g = new THREE.Group();
    g.position.copy(at).setY(0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, x = Math.cos(a) * 0.5, z = Math.sin(a) * 0.5, hh = rand(0.6, 1.1);
      const s = new THREE.Mesh(UNIT, leaf); s.scale.set(0.35, hh, 0.35); s.position.set(x, hh / 2, z); s.rotation.set(rand(-0.4, 0.4), a, rand(-0.4, 0.4)); g.add(s);
      const q = new THREE.Mesh(UNIT, b); q.scale.setScalar(0.14); q.position.set(x * 1.2, hh, z * 1.2); g.add(q);
    }
    fx.custom(g, 5, (k) => g.scale.setScalar(k < 0.06 ? k / 0.06 : k > 0.9 ? (1 - k) / 0.1 : 1), () => { leaf.dispose(); b.dispose(); });
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, A = this.state === 'attack' ? this.attack : '', fx = this.h.fx;
    // transformation: growth over 1.5 s, the hat flies up and back, stone crumbles
    if (this.growT >= 0 && this.growT < GROW_T + 1) {
      this.growT += dt;
      const k = Math.min(1, this.growT / GROW_T);
      this.setSize(1 + (GROW - 1) * (k * k * (3 - 2 * k)));
      if (this.hat.visible) {
        const hk = Math.min(1, this.growT / 0.9);
        this.hat.position.set(0, 2.62 + hk * 3, 0.05 - hk * 2.5);
        this.hat.rotation.set(-hk * 4, hk * 2, 0);
        if (hk >= 1) { this.hat.visible = false; fx.burst(this.pos.clone().setY(this.topY + 1.5), [PLANK, '#a07a40'], 12, { speed: 3, up: 2, size: 0.12, life: 0.7, gravity: 10 }); }
      }
      if (k < 1 && rnd() < 0.5) fx.burst(this.pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(1, this.topY), rand(-1, 1))), DUST, 1, { speed: 2, up: 1, size: 0.16, life: 0.8, gravity: 10 });
    }
    // steps: the legs walk, the torso sways; the titan shakes the ground with every step
    if (walk) {
      const was = this.gait % 0.5;
      this.gait += dt * (this.enraged ? 1.1 : 1.5) * this.speedK;
      const ph = this.gait * Math.PI * 2;
      this.legL.rotation.x = Math.sin(ph) * 0.5;
      this.legR.rotation.x = -Math.sin(ph) * 0.5;
      this.torso.rotation.z = Math.sin(ph) * 0.06;
      this.rig.position.y = Math.abs(Math.sin(ph)) * 0.1;
      if (this.gait % 0.5 < was) {
        if (this.enraged) { if (!this.quiet) sfx.step(); fx.shake = Math.max(fx.shake, 0.35); fx.shock(this.pos.clone().setY(0.08), 2.5, EARTH.clone().multiplyScalar(0.4), 0.4, 0.15); }
        fx.burst(this.pos.clone().setY(0.1), DUST, this.enraged ? 6 : 3, { speed: 1.5, up: 1, size: 0.12, life: 0.5, gravity: 8 });
      }
    } else if (this.state !== 'dead') {
      this.legL.rotation.x *= 0.85; this.legR.rotation.x *= 0.85;
      this.torso.rotation.z *= 0.85;
      this.rig.position.y *= 0.85;
    }
    // arms and lean by attack (arms: −3 — overhead, −1.4 — forward)
    let aL = -0.15, aR = -0.5, lean = Math.sin(t * 1.2) * 0.03, spin = 0;
    if (A === 'hoe') {
      if (S < HOE_AIM - 0.1) { aL = aR = -3; lean = -0.15; } else { aL = -1.0; aR = -0.9; lean = 0.45; }
    } else if (A === 'seeds') { aL = S < 0.45 ? -0.4 : -2.2; lean = S < 0.45 ? 0.1 : -0.1; }
    else if (A === 'stomp') { lean = S < 0.9 ? -0.15 : 0.15; aL = aR = -0.8; }
    else if (A === 'gardeners') { aL = aR = -1.6; lean = 0.25; }
    else if (A === 'grow') { aL = aR = -2.6; lean = -0.25; }
    else if (A === 'quake') { if (S < 1.0) { aL = aR = -3; lean = -0.2; } else { aL = aR = -1.2; lean = 0.55; } }
    else if (A === 'boulder') { if (S < 0.8) { aL = aR = -0.8; lean = 0.5; } else if (S < 1.1) { aL = aR = -3; lean = -0.2; } else { aL = aR = -1.4; lean = 0.15; } }
    else if (A === 'harvest') { aR = -1.5; aL = -0.6; spin = S < 1 ? -0.6 * Math.min(1, S / 0.6) : -0.6 + Math.PI * 2 * Math.min(1, (S - 1) / 0.35); }
    if (this.state === 'daze') { aL = -0.1; aR = this.enraged ? -0.2 : -1.0; lean = this.enraged ? 0.3 + Math.sin(t * 5) * 0.05 : 0.5; }
    const ease = Math.min(1, dt * 10);
    this.armL.rotation.x += (aL - this.armL.rotation.x) * ease;
    this.armR.rotation.x += (aR - this.armR.rotation.x) * ease;
    this.torso.rotation.x += (lean - this.torso.rotation.x) * ease;
    this.rig.rotation.y = A === 'harvest' ? spin : this.rig.rotation.y * 0.8;
    // heart: beats quietly, hard when dazed
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 4)) * 0.08;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.6 : 1));
    // the raspberry patch blooms at the middle of the growth
    if (!this.bloom.visible && this.growT > GROW_T * 0.5) { this.bloom.visible = true; fx.burst(this.pos.clone().setY(this.topY * 0.8), [BLOOM, RASP, LEAF], 20, { speed: 3, up: 3, size: 0.12, life: 0.8, glow: true, gravity: 4 }); }
  }
}
