import * as THREE from 'three';
import { pixelTex } from '../textures.ts';
import type { Target } from '../target.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss, type MiniState } from './mini.ts';

/**
 * Рдяный Змей — босс этажа (wiki/design-bosses.md, раздел 4): огромный огненный змей — тупая кубическая голова
 * с челюстью, клыками, горящими глазами и короной из костянок, за ней четыре горба-сегмента. Горбы не на IK: голова
 * пишет свой путь, горбы стоят на нём через равные отрезки. Чешуя — тлеющий уголь, трещины переливаются
 * огонь ↔ малина. Сердце-ягода — под челюстью.
 * Бой: ныряет в землю — под землёй видно только бегущий холм и искры (урон не проходит) → круг под героем 0,9 с →
 * выныривает (22, отброс 9), брызги лавы — горящие лужи; застрял, торчит наполовину — оглушён 2 с (главное окно).
 * Ползёт — за ним горящая колея; вплотную — укус конусом (18); плюётся огнём по меткам (3, в ярости 6; по 14 + лужа).
 * Ярость: в центре арены вспыхивает малиновый куст; раз в ~10 с змей обвивает его и пьёт — лечится 6 %/с три
 * секунды; срубить куст тремя ударами — питьё сорвано, змей оглушён 2,5 с. Роняет «Пламенного змея» / «Кровавый пакт».
 * Подвижных частей: голова, челюсть, сердце, четыре горба, холм под землёй.
 */

const FIRE = C(4, 1.4, 0.3), EMBER = C(4, 2.6, 0.8), PINK = C(4, 1.7, 2.4);
const DIRT = ['#5a3a22', '#3a2416', '#7a5232'];
const Y = new THREE.Vector3(0, 1, 0);
/** Горбы: размер и шаг вдоль пути головы */
const SEGS = [1.5, 1.35, 1.15, 0.9], GAP = 1.3;

const sfx = {
  /** Шипение змея: шум с фильтром и низкий хрип */
  hiss() { hiss({ dur: 0.7, vol: 0.22, f: 3000, f1: 1200, q: 0.8, type: 'bandpass', attack: 0.05, verb: 0.4 }); voice({ type: 'sawtooth', f: 80, f1: 55, dur: 0.6, vol: 0.05, lp: 500 }); },
  /** Ныряет / выныривает: грохот земли */
  dig() { boom(60, 25, 0.9, 0.8, 0, 0.5); hiss({ dur: 0.8, vol: 0.25, f: 900, f1: 150, q: 0.5, type: 'lowpass' }); },
  /** Укус: щелчок челюсти */
  bite() { boom(160, 60, 0.15, 0.4); hiss({ dur: 0.2, vol: 0.2, f: 500, f1: 2500, q: 0.7, type: 'bandpass' }); },
  /** Плевок огнём */
  spit() { hiss({ dur: 0.35, vol: 0.18, f: 1200, f1: 400, q: 0.6, type: 'lowpass' }); boom(120, 50, 0.2, 0.25); },
  splat() { boom(100, 40, 0.35, 0.35); hiss({ dur: 0.4, vol: 0.15, f: 1500, f1: 200, q: 0.5, type: 'lowpass' }); },
  /** Пьёт из куста: булькающие глотки */
  gulp() { voice({ type: 'sine', f: rand(110, 160), f1: rand(60, 90), dur: 0.18, vol: 0.06, verb: 0.3 }); },
};

/** Горящий малиновый куст второй фазы: цель — три удара рубят его, змей не допьёт */
class Bush implements Target {
  readonly pos: THREE.Vector3;
  readonly radius = 0.8;
  readonly topY = 1.5;
  readonly group = new THREE.Group();
  hits = 0;
  private flashT = 0;
  private readonly mats: THREE.Material[] = [];
  private readonly leaf: THREE.MeshLambertMaterial;

  private readonly h: BossHooks;
  private readonly chopped: () => void;
  constructor(h: BossHooks, at: THREE.Vector3, chopped: () => void) { this.h = h; this.chopped = chopped;
    this.pos = at.clone().setY(0);
    this.leaf = new THREE.MeshLambertMaterial({ color: '#3a5a22' });
    const dark = new THREE.MeshLambertMaterial({ color: '#2a3a1a' });
    const berry = glowMat(RASP), flame = glowMat(FIRE, 0.7, true);
    this.mats.push(this.leaf, dark, berry, flame);
    const B = (m: THREE.Material, w: number, hh: number, d: number, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(UNIT, m); o.scale.set(w, hh, d); o.position.set(x, y, z); this.group.add(o);
    };
    B(dark, 0.25, 0.5, 0.25, 0, 0.25, 0);
    B(this.leaf, 1.3, 0.8, 1.3, 0, 0.8, 0);
    B(this.leaf, 0.8, 0.5, 0.8, 0.1, 1.35, -0.1);
    for (const [x, y, z] of [[0.66, 0.9, 0.2], [-0.5, 1.0, 0.66], [0.2, 1.62, 0.3], [-0.66, 0.7, -0.3], [0.3, 0.6, -0.66]] as const) B(berry, 0.24, 0.24, 0.24, x, y, z);
    B(flame, 1.5, 0.12, 1.5, 0, 0.05, 0);
    this.group.position.copy(this.pos);
    h.scene.add(this.group);
    h.fx.burst(this.pos.clone().setY(0.6), [FIRE, RASP, '#3a5a22'], 20, { speed: 3, up: 4, size: 0.12, life: 0.7, glow: true, gravity: 5 });
  }

  get alive(): boolean { return this.hits < 3; }

  hit(_dmg: number, _dir: THREE.Vector3, point: THREE.Vector3): void {
    if (!this.alive) return;
    this.hits++;
    this.flashT = 0.12;
    this.h.fx.burst(point.clone().setY(1), ['#3a5a22', FIRE, RASP], 10, { speed: 3, up: 3, size: 0.1, life: 0.5, gravity: 8 });
    this.h.fx.text(this.pos.clone().setY(2), `${this.hits}/3`, 'crit');
    if (this.hits >= 3) this.chopped();
  }

  /** Кадр: горит, вздрагивает от ударов; срубленный — пень */
  update(dt: number): void {
    this.flashT = Math.max(0, this.flashT - dt);
    this.leaf.emissive.setScalar(this.flashT > 0 ? 0.6 : 0);
    const s = this.alive ? 1 - this.hits * 0.15 : 0.25;
    this.group.scale.set(1, THREE.MathUtils.lerp(this.group.scale.y, s, 0.2), 1);
    if (this.alive && Math.random() < 0.4) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.6, 1.6), rand(-0.6, 0.6))), vel: new THREE.Vector3(0, rand(0.8, 1.6), 0), life: rand(0.3, 0.6), size: rand(0.06, 0.12), color: Math.random() < 0.6 ? FIRE : RASP, gravity: -1 });
  }

  /** Вырос заново */
  regrow(): void { this.hits = 0; }

  dispose(): void {
    this.h.scene.remove(this.group);
    for (const m of this.mats) m.dispose();
  }
}

export class CrimsonSerpent extends MiniBoss {
  readonly radius = 1.4;
  readonly title = 'Рдяный Змей';
  override readonly topY = 3.2;
  readonly drop = 'flameserpent';
  override readonly tier = 'boss' as const;
  /** Ауры на выбор после победы, шанс % — огонь: жжение или кровь */
  override readonly auras = [['inferno', 50], ['pact', 50]] as const;
  private readonly head = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly heart = new THREE.Group();
  private readonly segs: THREE.Group[] = [];
  private readonly mound = new THREE.Group();
  /** Путь головы: новые точки — в начале */
  private readonly path: THREE.Vector3[] = [];
  private readonly segAt: THREE.Vector3[] = SEGS.map(() => new THREE.Vector3());
  /** Под землёй: урон не проходит, видно только холм */
  private under = false;
  /** Застрял после выныривания — торчит наполовину */
  private stuck = false;
  /** Насколько ушёл в землю, м */
  private sink = 0;
  private bur = 0;
  private readonly mole = new THREE.Vector3();
  private readonly markAt = new THREE.Vector3();
  private readonly lastP = new THREE.Vector3();
  private trail = 0;
  private bush: Bush | null = null;
  private drinkCd = 6;
  private drinking = false;
  private orbit = 0;

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 1800, home, yaw, arena);
    this.speed = 3.4;
    this.keep = 2.6;
    this.turn = 2.6;
    this.build();
    this.reset();
  }

  protected build(): void {
    const scale = this.lam('#7a2a1a', pixelTex('#7a2a1a', 10, 911));
    const dark = this.lam('#4a1a12', pixelTex('#4a1a12', 8, 912));
    const bone = this.lam('#e8dcc0');
    const eye = this.shimmer(EMBER, FIRE, 0, 3);
    const berry = this.shimmer(RASP, PINK, 0, 3);
    const B = this.box.bind(this);
    this.body.add(this.head);
    // голова: череп, морда, шея к земле; глаза горят; трещины лавы; корона из костянок
    this.head.position.set(0, 1.7, 0.2);
    B(this.head, scale, 1.7, 1.0, 1.7, 0, 0.2, 0);
    B(this.head, dark, 1.3, 0.55, 0.8, 0, 0.05, 1.1);
    B(this.head, dark, 1.2, 1.7, 1.1, 0, -0.9, -0.5);
    for (const s of [-1, 1]) B(this.head, eye, 0.3, 0.18, 0.2, s * 0.55, 0.45, 0.78);
    B(this.head, this.shimmer(FIRE, RASP, 1, 2), 1.72, 0.08, 0.5, 0, 0.5, -0.3);
    for (const [x, z, k] of [[0, 0, 0.32], [0.45, -0.2, 0.24], [-0.45, -0.2, 0.24], [0.3, 0.35, 0.22], [-0.3, 0.35, 0.22]] as const) B(this.head, this.shimmer(RASP, PINK, x * 4, 2.5), k, k, k, x, 0.85, z);
    // челюсть: петля сзади снизу, клыки вверх
    this.jaw.position.set(0, -0.3, -0.5);
    this.head.add(this.jaw);
    B(this.jaw, dark, 1.4, 0.35, 1.9, 0, -0.1, 0.95);
    for (const s of [-1, 1]) B(this.jaw, bone, 0.16, 0.36, 0.16, s * 0.48, 0.2, 1.75);
    // сердце-ягода под челюстью
    this.heart.position.set(0, -0.75, 0.25);
    this.head.add(this.heart);
    for (const [x, y, k] of [[0, 0, 0.36], [0.22, 0.12, 0.22], [-0.22, 0.12, 0.22], [0, -0.22, 0.22], [0, 0.26, 0.18]] as const) B(this.heart, berry, k, k, k, x, y, 0.12);
    // горбы: кубы чешуи, гребень, светящаяся трещина
    SEGS.forEach((k, i) => {
      const g = new THREE.Group();
      this.body.add(g);
      B(g, i % 2 ? dark : scale, k, k * 0.9, k * 1.1, 0, 0, 0);
      B(g, this.shimmer(FIRE, RASP, i * 1.3, 2), k * 1.02, k * 0.12, k * 0.4, 0, k * 0.2, 0);
      B(g, dark, k * 0.3, k * 0.35, k * 0.5, 0, k * 0.6, 0);
      this.segs.push(g);
    });
    // холм над змеем под землёй
    this.group.add(this.mound);
    const dirt = this.lam(DIRT[0]);
    B(this.mound, dirt, 1.8, 0.5, 1.8, 0, 0.2, 0);
    B(this.mound, this.lam(DIRT[1]), 1.0, 0.4, 1.0, 0.2, 0.55, -0.1);
    this.mound.visible = false;
  }

  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.under && this.state !== 'daze') return; // под землёй — меч рубит землю
    super.hit(dmg, dir, point, knock);
  }

  /** Под землёй — только бугор: героя не толкает */
  protected override get solid(): boolean { return !this.under; }
  protected override daze(sec: number): void { this.under = false; this.stuck = false; this.drinking = false; super.daze(sec); }

  override targets(): Target[] { return [...super.targets(), ...(this.bush?.alive && this.awake && !this.dead ? [this.bush] : [])]; }

  override reset(): void {
    this.under = false; this.stuck = false; this.drinking = false; this.drinkCd = 6; this.sink = 0;
    this.killBush();
    super.reset();
    this.straighten();
    this.lastP.copy(this.pos);
  }

  protected override die(): void { this.under = false; this.drinking = false; this.killBush(); super.die(); }

  protected override onEnrage(): void {
    // в центре арены вспыхивает куст — змей будет пить из него
    const a = this.arena;
    this.killBush();
    this.bush = new Bush(this.h, new THREE.Vector3((a.x0 + a.x1) / 2, 0, (a.z0 + a.z1) / 2), () => this.chop());
    this.drinkCd = 6;
  }

  protected override go(s: MiniState, attack = ''): void {
    super.go(s, attack);
    this.bur = 0;
    if (s !== 'attack' || attack !== 'drink') this.drinking = false;
  }

  private killBush(): void { this.bush?.dispose(); this.bush = null; }

  /** Куст срублен: питьё сорвано — змей оглушён; иначе просто отсрочка */
  private chop(): void {
    const b = this.bush;
    if (!b) return;
    this.h.fx.shock(b.pos.clone().setY(0.08), 2.4, RASP, 0.4, 0.15);
    if (this.state === 'attack' && this.attack === 'drink') { this.h.fx.text(this.pos.clone().setY(this.topY + 0.8), 'питьё сорвано!', 'crit'); this.daze(2.5); }
    this.drinkCd = 10;
  }

  protected choose(dist: number): string | null {
    if (this.bush && this.drinkCd <= 0) return 'drink';
    if (dist < 4.2) return Math.random() < 0.65 ? 'lunge' : 'burrow';
    if (dist > 7 && Math.random() < 0.55) return 'burrow';
    return Math.random() < 0.5 ? 'spit' : 'burrow';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'burrow': {
        // ныряет (0,5 с) → холм бежит к герою (до 1,4 с) → круг под героем 0,9 с → выныривает → застрял, оглушён
        const DIVE = 0.5, RUN = 1.4, MARK = 0.9;
        if (!this.hitDone) {
          this.hitDone = true;
          if (!this.quiet) { sfx.hiss(); sfx.dig(); }
          fx.shake = Math.max(fx.shake, 0.4);
          fx.burst(this.pos.clone().setY(0.4), DIRT, 26, { speed: 5, up: 6, size: 0.16, life: 0.9, gravity: 12 });
        }
        if (t < DIVE) return false;
        if (this.bur === 0) { this.bur = 1; this.under = true; this.mole.copy(this.pos).setY(0); }
        const hero = this.heroAt();
        if (this.bur === 1) {
          const d = hero.clone().sub(this.mole), l = d.length(), sp = (this.enraged ? 9 : 7) * dt;
          if (l > 0.8) this.mole.addScaledVector(d, Math.min(sp, l - 0.8) / l);
          this.clampIn(this.mole, 2);
          if (Math.random() < 0.6) fx.burst(this.mole.clone().setY(0.3), DIRT, 2, { speed: 2, up: 3, size: 0.12, life: 0.5, gravity: 10 });
          if (l < 1.2 || t > DIVE + RUN) {
            this.bur = 2;
            this.markAt.copy(this.clampIn(hero.clone(), 2));
            this.markCircle(this.markAt, 3, MARK, () => this.erupt(), FIRE);
          }
        } else if (this.bur === 2) this.mole.lerp(this.markAt, Math.min(1, dt * 6));
        if (Math.random() < 0.5) fx.particle({ pos: this.mole.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0.4, rand(-0.8, 0.8))), vel: new THREE.Vector3(0, rand(1, 2.5), 0), life: 0.5, size: rand(0.08, 0.14), color: Math.random() < 0.7 ? FIRE : RASP, gravity: -1 });
        if (t > 5) { this.under = false; this.straighten(); return true; } // подстраховка: метку смахнуло — вылез сам
        return false;
      }
      case 'lunge': {
        // откидывает голову (0,45 с) → бросок вперёд с укусом конусом
        const WIND = 0.45;
        if (t < WIND) { this.face(dt, 2); return false; }
        if (t - dt < WIND) {
          if (!this.quiet) sfx.bite();
          fx.arc(this.pos, this.yaw, FIRE, 3.6, 1.0, 1.2);
          if (this.inCone(this.pos, this.yaw, this.radius + 2.4, 0.75)) this.hurt(18, this.pos, 7);
        }
        if (t < WIND + 0.2) this.move(this.fwd(), dt * 6);
        return t > WIND + 0.65;
      }
      case 'spit': {
        // вскидывает голову — комья огня по меткам вокруг героя
        const n = this.enraged ? 6 : 3;
        this.face(dt);
        for (let i = 0; i < n; i++) {
          const at = 0.4 + i * 0.2;
          if (t >= at && t - dt < at) {
            const to = this.clampIn(this.heroAt().add(new THREE.Vector3(rand(-2.5, 2.5), 0, rand(-2.5, 2.5)).multiplyScalar(i === 0 ? 0.15 : 1)));
            const from = this.pos.clone().addScaledVector(this.fwd(), 1.2).setY(2.2 - this.sink);
            const mesh = new THREE.Mesh(UNIT, glowMat(Math.random() < 0.6 ? FIRE : RASP));
            mesh.scale.setScalar(0.5);
            this.markCircle(to, 1.5, 0.9, () => undefined);
            this.lob(mesh, from, to, 0.9, 3.2, EMBER, (p) => {
              if (!this.quiet) sfx.splat();
              fx.burst(p.clone().setY(0.4), [FIRE, EMBER, RASP], 14, { speed: 4, up: 4, size: 0.1, life: 0.6, glow: true, gravity: 6 });
              if (this.inCircle(p, 1.5)) this.hurt(14, p, 5);
              this.hazard(p, 1.2, 3, 10, FIRE);
            });
            if (!this.quiet) sfx.spit();
          }
        }
        return t > 0.4 + n * 0.2 + 0.4;
      }
      case 'drink': {
        // ползёт к кусту → обвивает его кольцом и пьёт 3 с, лечится 6 %/с
        const b = this.bush;
        if (!b || !b.alive) { this.drinkCd = 10; return true; }
        if (!this.hitDone) { this.hitDone = true; b.regrow(); if (!this.quiet) sfx.hiss(); }
        const d = b.pos.clone().sub(this.pos).setY(0), l = d.length();
        if (!this.drinking) {
          if (l > 2.4 && t < 4) {
            this.yaw = Math.atan2(d.x, d.z);
            this.move(d.normalize(), this.speed * 1.5 * this.speedK * dt);
            return false;
          }
          this.drinking = true; this.st = 0; this.orbit = Math.atan2(-d.x, -d.z);
          fx.text(this.pos.clone().setY(this.topY + 0.8), 'пьёт из куста!', 'crit');
          return false;
        }
        // кольцо вокруг куста: голова кружит, горбы ложатся следом
        this.orbit += dt * 1.1;
        const R = 2.2, nx = b.pos.x + Math.sin(this.orbit) * R, nz = b.pos.z + Math.cos(this.orbit) * R;
        this.yaw = Math.atan2(b.pos.x - nx, b.pos.z - nz) + 1.0;
        this.pos.x = THREE.MathUtils.lerp(this.pos.x, nx, Math.min(1, dt * 5));
        this.pos.z = THREE.MathUtils.lerp(this.pos.z, nz, Math.min(1, dt * 5));
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.06 * dt);
        if (Math.random() < 0.7) {
          const mouth = this.pos.clone().addScaledVector(this.fwd(), 1).setY(1.8);
          fx.particle({ pos: b.pos.clone().setY(1).lerp(mouth, Math.random()), vel: mouth.sub(b.pos).setY(0.5).multiplyScalar(0.6), life: 0.4, size: rand(0.08, 0.15), color: Math.random() < 0.6 ? RASP : FIRE, gravity: 0 });
        }
        if (Math.random() < dt * 4 && !this.quiet) sfx.gulp();
        if (t < 3) return false;
        this.drinking = false; this.drinkCd = 10;
        return true;
      }
    }
    return true;
  }

  /** Выныривает под меткой: удар, брызги лавы — лужи; застрял наполовину — оглушён */
  private erupt(): void {
    if (this.state !== 'attack' || this.attack !== 'burrow' || this.dead) return;
    const fx = this.h.fx, at = this.markAt.clone();
    if (!this.quiet) { sfx.dig(); sfx.hiss(); }
    fx.shake = Math.max(fx.shake, 0.9); fx.hitstop = Math.max(fx.hitstop, 0.05);
    fx.burst(at.clone().setY(0.6), [...DIRT, FIRE, RASP], 40, { speed: 7, up: 8, size: 0.16, life: 1, gravity: 12 });
    fx.shock(at.clone().setY(0.08), 3.4, FIRE, 0.45, 0.18);
    if (this.inCircle(at, 3)) this.hurt(22, at, 9);
    // брызги лавы разлетаются и горят лужами
    const n = this.enraged ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3), r = rand(3, 5);
      const to = this.clampIn(at.clone().add(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r)));
      const mesh = new THREE.Mesh(UNIT, glowMat(i % 2 ? RASP : FIRE));
      mesh.scale.setScalar(0.35);
      this.lob(mesh, at.clone().setY(1.5), to, 0.7, 2.5, EMBER, (p) => this.hazard(p, 1.1, 3.5, 10, FIRE));
    }
    const h = this.heroAt();
    this.pos.set(at.x, 0, at.z);
    if (Math.hypot(h.x - at.x, h.z - at.z) > 0.1) this.yaw = Math.atan2(h.x - at.x, h.z - at.z);
    this.straighten();
    this.lastP.copy(this.pos);
    this.sink = 2;
    this.daze(2);
    this.stuck = true;
  }

  /** Путь заново: горбы вытянуты прямо за головой */
  private straighten(): void {
    this.path.length = 0;
    const back = this.fwd().negate();
    for (let i = 0; i < 30; i++) this.path.push(this.pos.clone().setY(0).addScaledVector(back, i * 0.25));
  }

  /** Точка на пути головы в s метрах позади */
  private along(s: number, out: THREE.Vector3): THREE.Vector3 {
    let prev = this.pos.clone().setY(0);
    for (const p of this.path) {
      const l = prev.distanceTo(p);
      if (l >= s && l > 1e-4) return out.copy(prev).lerp(p, s / l);
      s -= l; prev = p;
    }
    return out.copy(prev).addScaledVector(this.fwd().negate(), s);
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, A = this.state === 'attack' ? this.attack : '', fx = this.h.fx;
    if (this.bush) { this.bush.update(dt); if (this.awake && this.state !== 'attack') this.drinkCd -= dt; }
    // путь головы и горящая колея
    const head = this.pos.clone().setY(0), moved = head.distanceTo(this.lastP);
    if (!this.path.length || head.distanceTo(this.path[0]) > 0.2) { this.path.unshift(head.clone()); if (this.path.length > 60) this.path.pop(); }
    if (moved < 2 && !this.under && this.state !== 'dead' && this.state !== 'sleep') {
      this.trail += moved;
      if (this.trail > 1.6) { this.trail = 0; this.hazard(this.segAt[1], 0.85, 4, 10, FIRE); }
    }
    this.lastP.copy(head);
    // ушёл в землю: ныряет, под землёй, застрял наполовину, вынырнул
    let sinkTo = 0;
    if (A === 'burrow') sinkTo = this.under ? 4 : Math.min(1, S / 0.5) * 4;
    else if (this.state === 'daze' && this.stuck) sinkTo = 1.0;
    else if (this.state === 'sleep') sinkTo = 0.4;
    this.sink = THREE.MathUtils.lerp(this.sink, sinkTo, Math.min(1, dt * (A === 'burrow' ? 10 : 5)));
    this.body.position.y = -this.sink;
    this.body.visible = this.sink < 3.6 || this.state === 'dead';
    // холм над змеем под землёй
    this.mound.visible = this.under && this.state !== 'dead';
    if (this.mound.visible) {
      const v = this.mole.clone().sub(head).applyAxisAngle(Y, -this.yaw);
      this.mound.position.set(v.x, Math.abs(Math.sin(t * 9)) * 0.12 - this.flyY, v.z);
      this.mound.rotation.y = t * 2;
    }
    // горбы: на пути головы через равные отрезки, волной вверх-вниз
    const wave = walk || A === 'drink' ? 1 : 0.3;
    this.segs.forEach((g, i) => {
      const p = this.along((i + 1) * GAP, this.segAt[i]), nxt = this.along((i + 1) * GAP - 0.5, new THREE.Vector3());
      const v = p.clone().sub(head).applyAxisAngle(Y, -this.yaw);
      g.position.set(v.x, SEGS[i] * 0.45 + Math.max(0, Math.sin(t * 5 - i * 1.2)) * 0.35 * wave - this.flyY, v.z);
      g.rotation.y = Math.atan2(nxt.x - p.x, nxt.z - p.z) - this.yaw;
    });
    // голова: качается; к укусу откидывается и бросается; плюёт — вскинута; застрял — задрана, повисла
    let hz = 0.2, hy = 1.7 + Math.sin(t * 2.2) * 0.08, hx = 0, jaw = 0.1 + Math.max(0, Math.sin(t * 1.7)) * 0.1;
    if (A === 'lunge') { const k = S < 0.45 ? S / 0.45 : Math.max(0, 1 - (S - 0.45) / 0.4); hz = S < 0.45 ? 0.2 - k * 0.6 : 0.2 + k * 1.2; hx = S < 0.45 ? -0.35 * k : 0.2 * k; jaw = S < 0.45 ? 0.7 * k : 0.7 * k * k; }
    else if (A === 'spit') { hx = -0.4; jaw = 0.6; hy = 2.0; }
    else if (A === 'drink' && this.drinking) { hx = 0.35; jaw = 0.5 + Math.sin(t * 10) * 0.15; }
    else if (A === 'burrow') hx = 0.6;
    else if (this.state === 'daze') { hx = this.stuck ? -0.5 : 0.3; jaw = 0.5; hy = this.stuck ? 2.3 : 1.6; this.head.rotation.z = Math.sin(t * 3) * 0.12; }
    else if (this.state === 'sleep') { hx = 0.4; jaw = 0; hy = 1.2; }
    if (this.state !== 'daze') this.head.rotation.z *= 0.8;
    this.head.position.z = THREE.MathUtils.lerp(this.head.position.z, hz, A === 'lunge' ? 0.5 : 0.2);
    this.head.position.y = THREE.MathUtils.lerp(this.head.position.y, hy, 0.2);
    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, hx, 0.2);
    this.jaw.rotation.x = THREE.MathUtils.lerp(this.jaw.rotation.x, jaw, 0.3);
    // угли с чешуи; застрял — земля сыплется
    if (this.state !== 'dead' && !this.under && Math.random() < 0.35) {
      const p = this.segAt[Math.floor(Math.random() * SEGS.length)];
      fx.particle({ pos: p.clone().setY(rand(0.8, 1.6) - this.sink), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.6, 1.4), rand(-0.3, 0.3)), life: rand(0.4, 0.8), size: rand(0.06, 0.12), color: Math.random() < 0.7 ? FIRE : RASP, gravity: -0.5 });
    }
    if (this.stuck && this.state === 'daze' && Math.random() < 0.3) fx.burst(this.pos.clone().setY(0.3), DIRT, 1, { speed: 2, up: 2, size: 0.1, life: 0.5, gravity: 10 });
    // сердце-ягода: оглушён — бьётся крупно
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.7 : 1));
  }
}
