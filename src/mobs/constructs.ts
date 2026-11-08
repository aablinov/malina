import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { C, glowMat, rand, RASP } from '../bosses/kit.ts';
import { Mob, type MobHooks } from './mob.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Constructs and relics (wiki/design-mobs.md, family F): druse golemling, hopping pot, guardian obelisk,
 * basket mimic, jam keg. Little brothers of the wardens Druse Golem and Order Cauldron.
 */

const lerpTo = (o: THREE.Object3D, x: number, k: number): void => { o.rotation.x += (x - o.rotation.x) * k; };
const FIRE = C(4, 1.4, 0.3), VIOLET = C(2, 0.9, 3.4), JAM = C(2.4, 0.3, 0.8);

/** 26. Druse Golemling — heavy: a ground slam sends a wave of spikes along a strip; the arms get stuck in the ground */
export class DruseGolemling extends Mob {
  readonly kind = 'druseling';
  readonly title = t('Druse Golemling');
  readonly cost = 8;
  readonly radius = 0.75;
  override readonly topY = 2.2;
  private readonly legs: THREE.Group[];
  private readonly arms: THREE.Group[];
  private readonly wave = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 90, at);
    this.speed = 2;
    this.turn = 2.5;
    this.keep = 3;
    this.mass = 2.5;
    this.loot = 3;
    const stone = this.lam('#8a8a8e', pixelTex('#8a8a8e', 14, 851)), dark = this.lam('#5a5a60', pixelTex('#5a5a60', 12, 852));
    const crystal = this.shimmer(RASP, C(3.4, 1.6, 2.4), 0, 1.6), eye = this.shimmer(C(3.4, 1.4, 2.2), C(4, 2.6, 1.6), 1, 2.2);
    const B = this.box.bind(this);
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.32, 0.6, 0);
      this.body.add(g);
      B(g, dark, 0.4, 0.6, 0.44, 0, -0.3, 0);
      return g;
    });
    // a boulder torso, the head sunk into the shoulders, raspberry druse crystals on the back
    B(this.body, stone, 1.2, 0.9, 0.8, 0, 1.1, 0);
    B(this.body, stone, 0.56, 0.4, 0.5, 0, 1.68, 0.12);
    for (const x of [-0.12, 0.12]) B(this.body, eye, 0.1, 0.06, 0.02, x, 1.7, 0.375);
    for (const [x, y, z, k, r] of [[-0.3, 1.7, -0.3, 0.3, -0.3], [0.25, 1.78, -0.25, 0.36, 0.25], [0, 1.95, -0.4, 0.26, 0], [0.45, 1.55, -0.35, 0.2, 0.5]] as const) B(this.body, crystal, k * 0.6, k * 1.4, k * 0.6, x, y, z, -0.3, 0, r);
    this.arms = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.78, 1.4, 0);
      this.body.add(g);
      B(g, stone, 0.38, 0.9, 0.42, 0, -0.45, 0);
      B(g, dark, 0.46, 0.36, 0.5, 0, -0.98, 0.04);
      return g;
    });
    this.place();
  }

  protected choose(dist: number, rel: number): string | null { return dist < 7 && Math.abs(rel) < 0.35 ? 'slam' : null; }
  protected override rest(): number { return rand(1.6, 2.4); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const from = this.pos.clone();
      this.wave.copy(this.fwd());
      this.field.markLine(from, this.wave, 6.5, 1.3, 0.9, () => {
        if (this.dead) return;
        if (!this.quiet) { boom(80, 30, 0.6, 0.7); hiss({ dur: 0.5, vol: 0.12, f: 2400, f1: 600, q: 0.8, type: 'bandpass' }); }
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.35);
        // spikes grow along the strip
        for (let d = 1; d <= 6.5; d += 0.8) this.h.fx.burst(from.clone().addScaledVector(this.wave, d).setY(this.ground + 0.2), [RASP, '#ffd0e0'], 4, { speed: 1, up: 5, size: 0.12, life: 0.45, glow: true, gravity: 12 });
        if (this.inLine(from, this.wave, 6.5, 1.3)) this.hurt(12, from, 5);
      });
    }
    // fists in the ground for 1.2 s — stunned
    if (t >= 1) { this.daze(1.2); return false; }
    return false;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 8), s = this.stride(5);
    lerpTo(this.legs[0], walk ? s * 0.4 : 0, k);
    lerpTo(this.legs[1], walk ? -s * 0.4 : 0, k);
    const a = this.state === 'attack' ? (this.st < 0.9 ? -2.8 : -0.9) : this.state === 'daze' ? -0.9 : walk ? s * 0.3 : 0;
    for (const arm of this.arms) lerpTo(arm, a, this.state === 'attack' && this.st >= 0.9 ? 1 : k);
    this.body.rotation.x = this.state === 'daze' || (this.state === 'attack' && this.st >= 0.9) ? 0.35 : 0;
    this.body.rotation.z = walk ? s * 0.05 : 0;
  }
}

/** 27. Hopping Pot — zone: leaps onto the hero, splashes and burning floor on landing; boils over up close */
export class HopPot extends Mob {
  readonly kind = 'pot';
  readonly title = t('Hopping Pot');
  readonly cost = 5;
  readonly radius = 0.6;
  override readonly topY = 1.4;
  private readonly pot = new THREE.Group();
  private readonly lid = new THREE.Group();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 50, at);
    this.speed = 0;
    this.keep = 1;
    this.mass = 1.5;
    this.loot = 2;
    const iron = this.lam('#a8704a', pixelTex('#a8704a', 10, 861)), dark = this.lam('#6a4434'), gold = this.lam('#e8b84a');
    const B = this.box.bind(this);
    this.body.add(this.pot);
    B(this.pot, iron, 0.9, 0.6, 0.9, 0, 0.5, 0);
    B(this.pot, iron, 0.76, 0.16, 0.76, 0, 0.13, 0);
    B(this.pot, dark, 0.96, 0.1, 0.96, 0, 0.84, 0);
    B(this.pot, gold, 0.94, 0.08, 0.94, 0, 0.55, 0);
    for (const [x, z] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) B(this.pot, dark, 0.16, 0.12, 0.16, x, 0.03, z);
    B(this.pot, this.shimmer(FIRE, RASP, 0, 2.4), 0.74, 0.06, 0.74, 0, 0.82, 0);
    // little eyes on the side, a berry emblem
    for (const x of [-0.16, 0.16]) B(this.pot, this.shimmer(C(4, 2.6, 0.8), FIRE, x, 3), 0.1, 0.08, 0.02, x, 0.62, 0.46);
    B(this.pot, this.lam('#c8245a'), 0.16, 0.16, 0.03, 0, 0.38, 0.46);
    this.lid.position.y = 0.88;
    this.pot.add(this.lid);
    B(this.lid, dark, 0.7, 0.08, 0.7, 0, 0.04, 0);
    B(this.lid, gold, 0.16, 0.12, 0.16, 0, 0.14, 0);
    this.place();
  }

  /** Moves only by hopping */
  protected override steer(dt: number): boolean { this.face(dt); return false; }

  protected choose(dist: number): string | null {
    if (dist < 1.9) return 'boil';
    return dist < 9 ? 'hop' : null;
  }
  protected override rest(): number { return rand(0.8, 1.4); }

  protected act(name: string, t: number, dt: number, dist: number): boolean {
    if (name === 'boil') {
      if (t - dt <= 0) this.field.markCircle(this.pos.clone(), 2.2, 0.7, () => {
        if (this.dead) return;
        if (!this.quiet) hiss({ dur: 0.6, vol: 0.15, f: 600, f1: 2400, q: 0.5, type: 'lowpass' });
        this.h.fx.burst(this.pos.clone().setY(this.ground + 1), [FIRE, RASP], 16, { speed: 4, up: 3, size: 0.1, life: 0.5, glow: true, gravity: 6 });
        if (this.inCircle(this.pos, 2.2)) this.hurt(7, this.pos, 6);
      });
      return t > 1;
    }
    // a leap onto the hero (up to 5 m): mark, flight, hit; after landing the lid is askew for 0.8 s — a window
    if (t - dt <= 0) {
      this.from.copy(this.pos);
      this.to.copy(this.pos).addScaledVector(this.fwd(), Math.min(5, dist));
      this.field.markCircle(this.to, 1.5, 0.8, () => {
        if (this.dead) return;
        if (!this.quiet) boom(110, 40, 0.5, 0.5);
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.2);
        this.h.fx.burst(this.to.clone().setY(this.ground + 0.3), [FIRE, RASP, '#ffd0a0'], 14, { speed: 4, up: 4, size: 0.1, life: 0.5, glow: true, gravity: 8 });
        if (this.inCircle(this.to, 1.5)) this.hurt(8, this.to, 4);
        this.field.hazard(this.to, 1.2, 2, 4, FIRE);
      });
    }
    if (t > 0.3 && t < 0.8) {
      const k = (t - 0.3) / 0.5;
      this.pos.lerpVectors(this.from, this.to, k);
      this.flyY = Math.sin(k * Math.PI) * 1.6;
    }
    if (t >= 0.8) this.flyY = 0;
    return t > 1.6;
  }

  protected animate(): void {
    const hop = this.state === 'attack' && this.attack === 'hop';
    // crouched — in flight the lid bounces — after landing it slid askew
    this.pot.scale.y = hop && this.st < 0.3 ? 0.8 : 1;
    this.lid.position.y = 0.88 + (hop && this.st > 0.3 && this.st < 0.8 ? 0.25 : 0) + (this.state === 'attack' && this.attack === 'boil' ? Math.abs(Math.sin(this.st * 30)) * 0.12 : 0);
    this.lid.rotation.z = hop && this.st >= 0.8 ? 0.5 : 0;
    this.lid.position.x = hop && this.st >= 0.8 ? 0.25 : 0;
  }
}

/** 28. Guardian Obelisk — support: a dome over allies within 6 m — they take half damage; pushes away up close */
export class WardObelisk extends Mob {
  readonly kind = 'obelisk';
  readonly title = t('Guardian Obelisk');
  readonly cost = 6;
  readonly radius = 0.6;
  override readonly topY = 3;
  private readonly gem = new THREE.Group();
  private readonly ring: THREE.Mesh;
  static readonly R = 6;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 70, at);
    this.speed = 0;
    this.keep = 0;
    this.mass = 99;
    this.loot = 2;
    this.aggro = 8;
    const stone = this.lam('#b8b4c0', pixelTex('#b8b4c0', 10, 871)), dark = this.lam('#6a6478'), gold = this.lam('#e8b84a');
    const B = this.box.bind(this);
    // a pedestal, a stepped pillar with runes, a berry crystal hovers above it
    B(this.body, dark, 1.1, 0.3, 1.1, 0, 0.15, 0);
    B(this.body, stone, 0.7, 1.4, 0.7, 0, 1, 0);
    B(this.body, stone, 0.5, 0.6, 0.5, 0, 2, 0);
    B(this.body, gold, 0.74, 0.08, 0.74, 0, 1.7, 0);
    for (const [y, ry] of [[0.8, 0], [1.25, Math.PI / 2]] as const) B(this.body, this.shimmer(VIOLET, RASP, y, 2), 0.2, 0.3, 0.72, 0, y, 0, 0, ry, 0);
    this.gem.position.y = 2.75;
    this.body.add(this.gem);
    B(this.gem, this.shimmer(RASP, VIOLET, 0, 1.6), 0.36, 0.36, 0.36, 0, 0, 0, 0.6, 0, 0.6);
    // the dome's boundary on the floor
    this.ring = new THREE.Mesh(new THREE.RingGeometry(WardObelisk.R - 0.12, WardObelisk.R, 64), glowMat(VIOLET.clone().multiplyScalar(0.45), 0.6, true));
    this.ring.rotation.x = -Math.PI / 2;
    h.scene.add(this.ring);
    this.place();
  }

  override dispose(): void { super.dispose(); this.h.scene.remove(this.ring); this.ring.geometry.dispose(); (this.ring.material as THREE.Material).dispose(); }

  protected override steer(): boolean { return false; }
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void { const p = this.pos.clone(); super.hit(dmg, dir, point, knock); this.pos.copy(p); }

  override update(dt: number): void {
    super.update(dt);
    this.ring.visible = !this.dead && this.alerted;
    this.ring.position.set(this.pos.x, 0.07, this.pos.z);
    if (this.dead || !this.alerted) return;
    // dome: allies within 6 m take half damage, violet sparks above them
    for (const m of this.mh.allies()) {
      if (m === this || Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) > WardObelisk.R) continue;
      m.ward = 0.3;
      if (rnd() < 0.05) this.h.fx.particle({ pos: m.pos.clone().setY(m.topY + 0.2), vel: new THREE.Vector3(0, 0.6, 0), life: 0.5, size: 0.08, color: VIOLET, gravity: 0 });
    }
  }

  protected choose(dist: number): string | null { return dist < 2.6 ? 'pulse' : null; }
  protected override rest(): number { return rand(1.6, 2.2); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) this.field.markCircle(this.pos.clone(), 2.6, 0.6, () => {
      if (this.dead) return;
      if (!this.quiet) voice({ type: 'sine', f: 440, f1: 220, dur: 0.5, vol: 0.05, verb: 0.5 });
      this.h.fx.shock(this.pos.clone().setY(this.ground + 0.2), 2.6, VIOLET.clone().multiplyScalar(0.5), 0.35, 0.12);
      if (this.inCircle(this.pos, 2.6)) this.hurt(4, this.pos, 8);
    }, VIOLET);
    return t > 0.8;
  }

  protected animate(): void {
    this.gem.rotation.y = this.time * (this.state === 'attack' ? 6 : 1.2);
    this.gem.position.y = 2.75 + Math.sin(this.time * 2) * 0.1;
  }
}

/** 29. Basket Mimic — surprise: pretends to be a basket of raspberries, comes alive up close and bites; drops lots of raspberries */
export class BasketMimic extends Mob {
  readonly kind = 'mimic';
  readonly title = t('Basket Mimic');
  readonly cost = 5;
  readonly radius = 0.55;
  override readonly topY = 1.2;
  private readonly lid = new THREE.Group();
  private readonly legs: THREE.Group[];
  private readonly teeth: THREE.Mesh[] = [];

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 55, at);
    this.speed = 3.2;
    this.keep = 1.2;
    this.loot = 8;
    this.aggro = 2.5;
    const wicker = this.lam('#c89a50', pixelTex('#c89a50', 14, 881)), band = this.lam('#8a5a2a'), berry = this.lam('#d0245a'), leaf = this.lam('#5aa03a');
    const tooth = this.lam('#f4ecd8'), tongue = this.lam('#c8202a');
    const B = this.box.bind(this);
    // a basket with a handle, a heap of berries on top — like a real reward
    B(this.body, wicker, 0.9, 0.5, 0.7, 0, 0.42, 0);
    B(this.body, band, 0.92, 0.06, 0.72, 0, 0.62, 0);
    B(this.body, tongue, 0.6, 0.06, 0.4, 0, 0.66, 0);
    for (const x of [-0.3, -0.1, 0.1, 0.3]) this.teeth.push(B(this.body, tooth, 0.08, 0.1, 0.06, x, 0.72, 0.3));
    this.lid.position.set(0, 0.68, -0.34);
    this.body.add(this.lid);
    B(this.lid, wicker, 0.9, 0.08, 0.7, 0, 0.04, 0.34);
    for (const [x, z] of [[-0.22, 0.2], [0.18, 0.3], [0, 0.45], [-0.1, 0.25], [0.26, 0.5], [-0.28, 0.5]] as const) B(this.lid, berry, 0.18, 0.16, 0.18, x, 0.15, z);
    B(this.lid, leaf, 0.22, 0.04, 0.12, 0.05, 0.25, 0.35, 0, 0.5, 0);
    for (const x of [-0.3, -0.1, 0.1, 0.3]) this.teeth.push(B(this.lid, tooth, 0.08, 0.1, 0.06, x, -0.04, 0.64));
    B(this.lid, band, 0.06, 0.5, 0.06, -0.38, 0.3, 0.34);
    B(this.lid, band, 0.06, 0.5, 0.06, 0.38, 0.3, 0.34);
    B(this.lid, band, 0.8, 0.06, 0.06, 0, 0.55, 0.34);
    this.legs = [[-0.25, 0.2], [0.25, 0.2], [-0.25, -0.2], [0.25, -0.2]].map(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0.18, z);
      this.body.add(g);
      B(g, band, 0.1, 0.2, 0.1, 0, -0.08, 0);
      return g;
    });
    this.place();
  }

  /** Asleep — a basket like any basket: no teeth, no legs */
  private get disguised(): boolean { return !this.alerted && !this.dead; }

  override notice(): void {
    const was = this.alerted;
    super.notice();
    if (!was && this.alerted) {
      // came alive: slammed the lid, "surprise!"
      this.h.fx.text(this.pos.clone().setY(this.ground + 1.6), t('surprise!'), 'crit');
      if (!this.quiet) { boom(220, 90, 0.2, 0.3); voice({ type: 'square', f: 300, f1: 600, dur: 0.15, vol: 0.04, lp: 2000 }); }
    }
  }

  protected choose(dist: number): string | null { return dist < 1.8 ? 'bite' : null; }
  protected override rest(): number { return rand(0.6, 1); }

  protected act(_name: string, t: number, dt: number): boolean {
    if (t - dt <= 0) {
      const c = this.pos.clone().addScaledVector(this.fwd(), 0.9);
      this.field.markCircle(c, 1, 0.4, () => {
        if (this.dead) return;
        if (!this.quiet) boom(260, 120, 0.15, 0.25);
        this.move(this.fwd(), 0.4);
        if (this.inCircle(c, 1)) this.hurt(9, this.pos, 3);
      });
    }
    return t > 0.7;
  }

  protected animate(dt: number, walk: boolean): void {
    const k = Math.min(1, dt * 14), s = this.stride(15);
    const hide = this.disguised;
    for (const t of this.teeth) t.visible = !hide;
    for (const [i, l] of this.legs.entries()) { l.visible = !hide; lerpTo(l, walk ? (i % 3 === 0 ? s : -s) * 0.7 : 0, k); }
    // the maw snaps while running and opens wide before the bite
    const open = hide ? 0 : this.state === 'attack' ? (this.st < 0.4 ? -0.9 : 0) : -0.25 - Math.abs(s) * 0.25;
    lerpTo(this.lid, open, k);
    this.body.position.y = walk ? Math.abs(s) * 0.1 : 0;
  }
}

/** 30. Jam Keg — bomber: rolls toward the hero, flares up with a mark and explodes into sticky jam; the blast hits allies too */
export class JamKeg extends Mob {
  readonly kind = 'keg';
  readonly title = t('Jam Keg');
  readonly cost = 3;
  readonly radius = 0.5;
  override readonly topY = 1.1;
  private readonly keg = new THREE.Group();
  private readonly fuse: THREE.Mesh;
  private blown = false;
  static readonly R = 2.4;

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 20, at);
    this.speed = 3.4;
    this.keep = 0.8;
    this.mass = 0.8;
    const wood = this.lam('#8a5a32', pixelTex('#8a5a32', 10, 891)), hoop = this.lam('#4a4a50'), label = this.lam('#f4ecd8'), jam = this.lam('#c8245a');
    const B = this.box.bind(this);
    this.keg.position.y = 0.5;
    this.body.add(this.keg);
    // a keg on its side: rolls along; a berry label, a fuse tail
    B(this.keg, wood, 0.9, 0.8, 0.8, 0, 0, 0);
    for (const x of [-0.32, 0.32]) B(this.keg, hoop, 0.08, 0.84, 0.84, x, 0, 0);
    B(this.keg, label, 0.36, 0.3, 0.84, 0, 0, 0);
    B(this.keg, jam, 0.18, 0.18, 0.86, 0, 0, 0);
    this.fuse = B(this.keg, glowMat(C(4, 2.6, 0.8)), 0.08, 0.2, 0.08, 0.46, 0.3, 0);
    this.place();
  }

  protected choose(dist: number): string | null { return dist < 2 ? 'fuse' : null; }

  protected act(_name: string, t: number, dt: number): boolean {
    // a 1.5 s circle mark, the fuse crackles — and an explosion
    if (t - dt <= 0) {
      if (!this.quiet) hiss({ dur: 1.5, vol: 0.06, f: 3000, f1: 5000, q: 2, type: 'bandpass' });
      this.field.markCircle(this.pos.clone(), JamKeg.R, 1.5, () => { if (!this.dead) this.vanish(); }, JAM);
    }
    if (rnd() < 0.5) this.h.fx.particle({ pos: this.fuse.getWorldPosition(new THREE.Vector3()), vel: new THREE.Vector3(rand(-1, 1), 2, rand(-1, 1)), life: 0.3, size: 0.06, color: C(4, 2.6, 0.8), gravity: 4 });
    return false;
  }

  /** The keg fell (from the fuse or a hit) — an explosion: to the hero and all mobs nearby, sticky jam on the floor */
  protected override die(): void {
    super.die();
    if (this.blown) return;
    this.blown = true;
    const c = this.pos.clone();
    if (!this.quiet) { boom(70, 25, 0.9, 0.9, 0, 0.5); hiss({ dur: 0.6, vol: 0.2, f: 1600, f1: 200, q: 0.4, type: 'lowpass' }); }
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.5);
    this.h.fx.shock(c.clone().setY(this.ground + 0.2), JamKeg.R, JAM, 0.4, 0.2);
    this.h.fx.burst(c.clone().setY(this.ground + 0.6), [JAM, '#e0306a', '#8a5a32'], 26, { speed: 6, up: 5, size: 0.12, life: 0.7, glow: true, gravity: 10 });
    if (this.inCircle(c, JamKeg.R)) this.hurt(12, c, 7);
    for (const m of this.mh.allies()) {
      if (m === this || Math.hypot(m.pos.x - c.x, m.pos.z - c.z) > JamKeg.R + m.radius) continue;
      const dir = new THREE.Vector3(m.pos.x - c.x, 0, m.pos.z - c.z);
      m.hit(30, dir.lengthSq() > 1e-4 ? dir.normalize() : new THREE.Vector3(0, 0, 1), m.pos.clone().setY(m.ground + 1), 1);
    }
    // sticky puddle: lives while the keg crumbles (the field goes with it)
    this.field.hazard(c, 1.8, 1.5, 0, JAM, 0.4);
  }

  protected animate(dt: number, walk: boolean): void {
    // rolling: spins around its axis; before the explosion swells and blinks
    if (walk) this.keg.rotation.x += dt * this.speed / 0.4;
    const fuse = this.state === 'attack';
    this.keg.scale.setScalar(fuse ? 1 + Math.max(0, this.st - 0.8) * 0.3 + Math.sin(this.st * 30) * 0.03 : 1);
    this.fuse.visible = !fuse || Math.sin(this.st * 25) > 0;
  }
}
