import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { C, glowMat, rand, RASP, UNIT } from '../bosses/kit.ts';
import { HEAL, Mob, type MobHooks } from './mob.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Mages of the Order (wiki/design-mobs.md, family A): the "mage" skeleton — a robe without legs, an illager head in a hood, two arms,
 * an item (staff, book). Keep distance, cast standing still — while casting they are easiest to hit.
 * Light shows the role: green heals, raspberry with fire attacks, violet summons.
 */

const FIRE = C(4, 1.4, 0.3), VIOLET = C(2, 0.7, 3.4);

/** Mage parts */
interface Rig { robe: THREE.Group; head: THREE.Group; arms: THREE.Group[] }

/** Stepped robe (wider toward the floor), belt, hood, illager face with a nose, glowing eyes */
function buildMage(m: Mob, body: THREE.Group, robeColor: string, trimColor: string, eye: THREE.Color, seed: number): Rig {
  const robe = m.lam(robeColor, pixelTex(robeColor, 8, seed)), trim = m.lam(trimColor);
  const face = m.lam('#8a9098', pixelTex('#8a9098', 8, seed + 1)), nose = m.lam('#767c84'), brow = m.lam('#3a3a42');
  const glow = m.shimmer(eye, RASP, rnd() * 6, 1.6);
  const B = m.box.bind(m);
  const g = new THREE.Group();
  body.add(g);
  B(g, robe, 0.86, 0.5, 0.62, 0, 0.25, 0);
  B(g, robe, 0.74, 0.5, 0.52, 0, 0.72, 0);
  B(g, robe, 0.66, 0.5, 0.44, 0, 1.18, 0);
  B(g, trim, 0.88, 0.08, 0.64, 0, 0.04, 0);
  B(g, trim, 0.14, 1.3, 0.04, 0, 0.7, 0.29);
  B(g, trim, 0.68, 0.1, 0.46, 0, 0.96, 0);
  const head = new THREE.Group();
  head.position.y = 1.44;
  body.add(head);
  B(head, robe, 0.56, 0.56, 0.54, 0, 0.3, -0.03);
  B(head, face, 0.44, 0.46, 0.06, 0, 0.26, 0.24);
  B(head, nose, 0.1, 0.2, 0.1, 0, 0.18, 0.3);
  B(head, brow, 0.36, 0.05, 0.03, 0, 0.36, 0.275);
  for (const x of [-0.11, 0.11]) B(head, glow, 0.08, 0.06, 0.03, x, 0.31, 0.275);
  const arms = [-1, 1].map((s) => {
    const a = new THREE.Group();
    a.position.set(s * 0.42, 1.34, 0.02);
    body.add(a);
    B(a, robe, 0.2, 0.56, 0.22, 0, -0.26, 0);
    B(a, face, 0.16, 0.12, 0.16, 0, -0.58, 0);
    return a;
  });
  return { robe: g, head, arms };
}

/** Hovers, swaying; arms by pose */
function hover(r: Rig, time: number, walk: boolean, dt: number, arms: [number, number]): void {
  const k = Math.min(1, dt * 10);
  r.robe.position.y = 0.04 + Math.sin(time * 2.2) * 0.04;
  r.robe.rotation.x = walk ? 0.08 : 0;
  for (let i = 0; i < 2; i++) r.arms[i].rotation.x += (arms[i] - r.arms[i].rotation.x) * k;
}

/** 1. Berry Healer — heals a wounded ally with a beam, every 8 s a healing ring; a hit interrupts the cast */
export class BerryHealer extends Mob {
  readonly kind = 'healer';
  readonly title = t('Berry Healer');
  readonly cost = 6;
  readonly radius = 0.48;
  override readonly topY = 2.1;
  private readonly rig: Rig;
  private readonly tip = new THREE.Group();
  /** Beam: a stretched glowing cube from the staff to the ally */
  private readonly beam: THREE.Mesh;
  private patient: Mob | null = null;
  private castHp = 0;
  private ringCd = 4;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 45, at);
    this.speed = 2.4;
    this.keep = 7;
    this.loot = 2;
    this.rig = buildMage(this, this.body, '#3f8f5a', '#c8245a', HEAL, 661);
    // staff with a bush on top: leaves and a glowing berry
    const wood = this.lam('#7a5232'), leaf = this.lam('#5aa03a');
    const B = this.box.bind(this);
    const arm = this.rig.arms[1];
    B(arm, wood, 0.08, 1.7, 0.08, 0, -0.55, 0.12);
    this.tip.position.set(0, 0.32, 0.12);
    arm.add(this.tip);
    B(this.tip, leaf, 0.34, 0.16, 0.34, 0, 0, 0);
    B(this.tip, this.shimmer(RASP, HEAL, 0, 2.4), 0.18, 0.18, 0.18, 0, 0.14, 0);
    this.beam = new THREE.Mesh(UNIT, glowMat(HEAL, 0.7, true));
    this.beam.visible = false;
    h.scene.add(this.beam);
    this.place();
  }

  override dispose(): void {
    super.dispose();
    this.h.scene.remove(this.beam);
    (this.beam.material as THREE.Material).dispose();
  }

  private hurtAllies(r: number): Mob[] {
    return this.mh.allies().filter((m) => m !== this && m.hp < m.maxHp * 0.85 && Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) < r);
  }

  protected choose(dist: number): string | null {
    if (dist < 2.2) return 'poke';
    if (this.ringCd <= 0 && this.hurtAllies(5).length >= 2) return 'ring';
    const list = this.hurtAllies(11).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    this.patient = list[0] ?? null;
    return this.patient ? 'heal' : null;
  }

  override update(dt: number): void {
    this.ringCd -= dt;
    super.update(dt);
    // the beam is visible only during the heal cast
    const on = this.state === 'attack' && this.attack === 'heal' && !!this.patient && this.st > 0.3;
    this.beam.visible = on;
    if (on && this.patient) {
      const a = this.tip.getWorldPosition(new THREE.Vector3()), b = this.patient.pos.clone().setY(this.patient.topY * 0.55);
      this.beam.position.copy(a).add(b).multiplyScalar(0.5);
      this.beam.lookAt(b);
      const w = 0.12 + Math.sin(this.time * 20) * 0.03;
      this.beam.scale.set(w, w, a.distanceTo(b));
    }
  }

  protected act(name: string, tm: number, dt: number): boolean {
    switch (name) {
      case 'poke':
        // staff shove: a circle around herself, knocks back
        if (tm - dt <= 0) this.field.markCircle(this.pos.clone(), 1.9, 0.5, () => { if (!this.dead && this.inCircle(this.pos, 1.9)) this.hurt(4, this.pos, 7); });
        return tm > 0.7;
      case 'ring':
        if (tm - dt <= 0) {
          if (!this.quiet) voice({ type: 'sine', f: 520, f1: 780, dur: 1, vol: 0.05, verb: 0.6 });
          this.field.markCircle(this.pos.clone(), 5, 1, () => {
            if (this.dead) return;
            this.h.fx.shock(this.pos.clone().setY(0.1), 5, HEAL.clone().multiplyScalar(0.5), 0.5, 0.15);
            for (const m of this.mh.allies()) if (Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) < 5) m.heal(m.maxHp * 0.3);
          }, HEAL);
          this.ringCd = 8;
        }
        return tm > 1.2;
      default: {
        // beam: 9 health per second, up to 2.4 s; hit — the cast is broken, the healer is dazed
        if (tm - dt <= 0) { this.castHp = this.hp; if (!this.quiet) hiss({ dur: 0.5, vol: 0.08, f: 2600, f1: 3400, q: 2, type: 'bandpass', verb: 0.5 }); }
        this.face(dt, 0.5);
        const p = this.patient;
        if (this.hp < this.castHp) { this.patient = null; this.h.fx.text(this.pos.clone().setY(this.topY + 0.4), t('interrupted!'), 'crit'); this.daze(1.2); return false; }
        if (!p || p.dead || p.hp >= p.maxHp || Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) > 13) { this.patient = null; return tm > 0.3; }
        if (tm > 0.3) p.heal(9 * dt);
        if (tm > 2.4) { this.patient = null; return true; }
        return false;
      }
    }
  }

  protected animate(dt: number, walk: boolean): void {
    const cast = this.state === 'attack';
    hover(this.rig, this.time, walk, dt, cast ? [-1.4, -1.6] : [walk ? -0.2 : 0, -0.5]);
    this.rig.head.rotation.x = this.state === 'daze' ? 0.3 : 0;
  }
}

/** 2. Ember Mage — fire berries in an arc onto marks; up close — teleports away */
export class EmberMage extends Mob {
  readonly kind = 'pyro';
  readonly title = t('Ember Mage');
  readonly cost = 6;
  readonly radius = 0.48;
  override readonly topY = 2.4;
  private readonly rig: Rig;
  private readonly hands: THREE.Mesh[] = [];
  private blinkCd = 0;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 40, at);
    this.speed = 2.4;
    this.keep = 8;
    this.loot = 2;
    this.rig = buildMage(this, this.body, '#a3204a', '#e8b84a', FIRE, 671);
    const B = this.box.bind(this);
    // tall hat with a gem, glowing palms, a book
    const hat = this.lam('#7a1236', pixelTex('#7a1236', 8, 673));
    B(this.rig.head, hat, 0.6, 0.36, 0.58, 0, 0.72, -0.03);
    B(this.rig.head, this.shimmer(FIRE, RASP, 0, 2), 0.2, 0.2, 0.04, 0, 0.72, 0.27);
    for (const a of this.rig.arms) this.hands.push(B(a, this.shimmer(FIRE, C(4, 2.6, 0.8), rnd() * 6, 3), 0.18, 0.14, 0.18, 0, -0.6, 0));
    B(this.rig.arms[0], this.lam('#6a3a24'), 0.36, 0.08, 0.28, 0.1, -0.66, 0.14);
    B(this.rig.arms[0], this.lam('#f4ecd8'), 0.32, 0.03, 0.24, 0.1, -0.61, 0.14);
    this.place();
  }

  protected choose(dist: number): string | null {
    if (this.blinkCd <= 0 && dist < 3.2) return 'blink';
    return dist < 13 ? 'volley' : null;
  }
  protected override rest(): number { return rand(1.6, 2.4); }

  override update(dt: number): void { this.blinkCd -= dt; super.update(dt); }

  protected act(name: string, t: number, dt: number): boolean {
    if (name === 'blink') {
      // shrank — flash — appeared 6 m from the hero
      if (t >= 0.3 && t - dt < 0.3) {
        const hero = this.h.hero.pos;
        const a = Math.atan2(this.pos.x - hero.x, this.pos.z - hero.z) + rand(-0.8, 0.8);
        this.h.fx.burst(this.pos.clone().setY(1), [FIRE, RASP], 14, { speed: 3, up: 2, size: 0.1, life: 0.4, glow: true, gravity: 0 });
        if (!this.quiet) hiss({ dur: 0.25, vol: 0.15, f: 600, f1: 3000, q: 0.8, type: 'bandpass' });
        this.pos.set(hero.x + Math.sin(a) * 6, 0, hero.z + Math.cos(a) * 6);
        this.h.fx.burst(this.pos.clone().setY(1), [FIRE, RASP], 14, { speed: 3, up: 2, size: 0.1, life: 0.4, glow: true, gravity: 0 });
        this.blinkCd = 6;
      }
      this.body.scale.setScalar(t < 0.3 ? 1 - t * 2.5 : Math.min(1, 0.25 + (t - 0.3) * 4));
      return t > 0.5;
    }
    // volley: three berries onto marks near the hero
    this.face(dt, 0.7);
    for (let i = 0; i < 3; i++) {
      const at = 0.6 + i * 0.2;
      if (t >= at && t - dt < at) {
        const to = this.heroAt().add(new THREE.Vector3(rand(-1.6, 1.6), 0, rand(-1.6, 1.6)).multiplyScalar(i === 0 ? 0.15 : 1));
        const from = this.hands[i % 2].getWorldPosition(new THREE.Vector3());
        const mesh = new THREE.Mesh(UNIT, glowMat(i % 2 ? RASP : FIRE));
        mesh.scale.setScalar(0.3);
        if (!this.quiet) boom(200, 90, 0.2, 0.15);
        this.field.markCircle(to, 1.3, 0.9, () => undefined);
        this.field.lob(mesh, from, to, 0.9, 2.2, FIRE, (p) => {
          if (!this.quiet) hiss({ dur: 0.35, vol: 0.12, f: 1400, f1: 200, q: 0.5, type: 'lowpass' });
          this.h.fx.burst(p.clone().setY(0.3), [FIRE, RASP], 10, { speed: 3, up: 3, size: 0.1, life: 0.5, glow: true, gravity: 6 });
          if (this.inCircle(p, 1.3)) this.hurt(9, p, 3);
          this.field.hazard(p, 1.1, 2, 4, FIRE);
        });
      }
    }
    return t > 1.5;
  }

  protected animate(dt: number, walk: boolean): void {
    const cast = this.state === 'attack' && this.attack === 'volley';
    hover(this.rig, this.time, walk, dt, cast ? [-1.2 - Math.sin(this.st * 14) * 0.3, -1.2 + Math.sin(this.st * 14) * 0.3] : [-0.5, walk ? -0.2 : 0]);
    if (this.state !== 'attack' || this.attack !== 'blink') this.body.scale.setScalar(1);
  }
}

/** 3. Vine Summoner — berrylings climb out of circles on the floor (no more than 6 of his own); stands still while casting */
export class VineSummoner extends Mob {
  readonly kind = 'summoner';
  readonly title = t('Vine Summoner');
  readonly cost = 7;
  readonly radius = 0.5;
  override readonly topY = 2.3;
  private readonly rig: Rig;
  private readonly crown: THREE.Group = new THREE.Group();
  private readonly called: Mob[] = [];
  private summonCd = 1;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 50, at);
    this.speed = 2.2;
    this.keep = 8;
    this.loot = 3;
    this.rig = buildMage(this, this.body, '#4a2a5a', '#c8245a', VIOLET, 681);
    const B = this.box.bind(this);
    // a crown of drupelets above the hood and a censer staff with a vine
    this.crown.position.y = 0.66;
    this.rig.head.add(this.crown);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; B(this.crown, this.shimmer(RASP, VIOLET, i, 1.8), 0.12, 0.14, 0.12, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2); }
    const wood = this.lam('#4a3020'), vine = this.lam('#4a8a3a');
    const arm = this.rig.arms[1];
    B(arm, wood, 0.08, 1.8, 0.08, 0, -0.5, 0.12);
    B(arm, vine, 0.12, 0.6, 0.12, 0, 0.1, 0.12, 0, 0, 0.3);
    B(arm, this.shimmer(VIOLET, RASP, 0, 2.2), 0.22, 0.22, 0.22, 0, 0.42, 0.12);
    this.place();
  }

  protected choose(dist: number): string | null {
    if (dist < 2.4) return 'shove';
    for (let i = this.called.length - 1; i >= 0; i--) if (this.called[i].dead || this.called[i].gone) this.called.splice(i, 1);
    if (this.summonCd <= 0 && this.called.length < 6) return 'summon';
    return null;
  }
  protected override rest(): number { return rand(1, 1.6); }

  override update(dt: number): void { this.summonCd -= dt; super.update(dt); }

  protected act(name: string, t: number, dt: number): boolean {
    if (name === 'shove') {
      if (t - dt <= 0) this.field.markCircle(this.pos.clone(), 2.2, 0.55, () => {
        if (this.dead) return;
        this.h.fx.shock(this.pos.clone().setY(0.1), 2.2, VIOLET.clone().multiplyScalar(0.5), 0.35, 0.12);
        if (this.inCircle(this.pos, 2.2)) this.hurt(5, this.pos, 8);
      });
      return t > 0.8;
    }
    // three circles in front — a berryling climbs out of each
    if (t - dt <= 0) {
      if (!this.quiet) voice({ type: 'sawtooth', f: 90, f1: 140, dur: 1.4, vol: 0.04, lp: 700, verb: 0.6 });
      const f = this.fwd(), side = new THREE.Vector3(f.z, 0, -f.x);
      const n = Math.min(3, 6 - this.called.length);
      for (let i = 0; i < n; i++) {
        const at = this.pos.clone().addScaledVector(f, 2).addScaledVector(side, (i - (n - 1) / 2) * 1.4);
        this.field.markCircle(at, 0.7, 1.4, () => {
          if (this.dead) return;
          const m = this.mh.spawn('berryling', at);
          if (!m) return;
          m.summoned = true;
          m.notice();
          this.called.push(m);
          this.h.fx.burst(at.clone().setY(0.2), [VIOLET, RASP, '#5aa03a'], 10, { speed: 2.5, up: 3, size: 0.1, life: 0.5, glow: true, gravity: 6 });
        }, VIOLET);
      }
      this.summonCd = 7;
    }
    return t > 1.7;
  }

  protected animate(dt: number, walk: boolean): void {
    const cast = this.state === 'attack' && this.attack === 'summon';
    hover(this.rig, this.time, walk, dt, cast ? [-2.6, -2.6] : [walk ? -0.2 : 0, -0.4]);
    this.crown.rotation.y = this.time * (cast ? 4 : 0.8);
  }
}
