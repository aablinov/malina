import * as THREE from 'three';
import { pixelTex } from '../textures.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';

/**
 * Громовой Зверь — легендарный босс этажа (wiki/design-bosses.md, разделы 1–4; по мотивам Тёмного зверя Паарла): тощий
 * костяной зверь на четырёх ногах-столбах. Туловище — клетка рёбер (кость поверх тёмной плоти), внутри неё светится
 * сердце-ягода; длинный череп с челюстью, на шее и спине — трескучие клочья шерсти «молния ↔ малина», на загривке —
 * малиновый венец из кубиков-костянок, хвост-хлыст. С шерсти всё время сыплются искры. Быстрый (5 м/с).
 * Атаки: прыжок — метка у героя, дуга, удар при приземлении и шесть цепных молний лучами во все стороны; два-три прыжка
 * подряд, потом задыхается (оглушён, сердце открыто — главное окно урона); двойной удар когтями перед собой; гроза —
 * встаёт на дыбы и воет, по арене одна за другой бьют молнии в метки. Ярость (50 %): перегрузка — тело горит ярче,
 * под ним кольцом тлеют молнии (опасная зона следует за ним), быстрее. Роняет «Громовой прыжок», аура — «Ярость».
 * Подвижных частей: туловище, голова, челюсть, четыре ноги, хвост.
 */

const SPARK = C(2.4, 3.4, 4), WHITE = C(3.6, 3.8, 4), PINK = C(4, 1.7, 2.4);
const BONE = '#d8ccb0', FLESH = '#2a2430', CLAW = '#16121a';
const DUST = ['#d8ccb0', '#5a5060', '#2a2430'];
/** Прыжок: присед, полёт, высота, радиус метки; лучи цепной молнии */
const CROUCH = 0.4, AIR = 0.7, PEAK = 4, LEAP_R = 3, RAYS = 6, RAY_LEN = 7, RAY_W = 1.1;

const sfx = {
  /** Треск шерсти */
  crackle() { for (let i = 0; i < 3; i++) hiss({ dur: 0.05, vol: 0.05, f: rand(2500, 6000), q: 3, delay: i * rand(0.03, 0.07) }); },
  /** Рык перед прыжком */
  snarl() { voice({ type: 'sawtooth', f: 140, f1: 60, dur: 0.45, vol: 0.07, detune: 25, lp: 1600, lp1: 400, verb: 0.3 }); },
  /** Приземление: удар лап и треск разряда */
  land() { boom(70, 25, 0.9, 0.8, 0, 0.4); hiss({ dur: 0.3, vol: 0.3, f: 5000, f1: 900, q: 0.5, type: 'highpass' }); },
  /** Цепная молния по полу */
  chain() { hiss({ dur: 0.35, vol: 0.22, f: 6000, f1: 1500, q: 0.6, type: 'highpass' }); bell(rand(1800, 2400), 0.3, 0.02); },
  /** Удар молнии с неба */
  thunder() {
    hiss({ dur: 0.25, vol: 0.3, f: 5000, f1: 800, q: 0.5, type: 'highpass' });
    boom(90, 25, 1.3, 0.7, 0.05, 0.7);
    hiss({ dur: 1.1, vol: 0.15, f: 600, f1: 120, q: 0.6, type: 'lowpass', delay: 0.1, verb: 0.7 });
  },
  /** Свист когтей */
  claw() { hiss({ dur: 0.2, vol: 0.18, f: 700, f1: 2600, q: 0.8 }); },
  /** Вой на дыбах */
  howl() { voice({ type: 'sawtooth', f: 220, f1: 520, dur: 1.1, vol: 0.07, detune: 30, lp: 2200, lp1: 900, verb: 0.7 }); },
  /** Хрип: задыхается после прыжков */
  pant() { for (let i = 0; i < 4; i++) hiss({ dur: 0.18, vol: 0.1, f: 900, f1: 500, q: 0.8, delay: i * 0.45 }); },
};

export class ThunderBeast extends MiniBoss {
  readonly radius = 1.5;
  readonly title = 'Громовой Зверь';
  override readonly subtitle = 'легендарный страж малины';
  override readonly topY = 3.4;
  readonly drop = 'thunderleap';
  override readonly tier = 'boss' as const;
  /** Ауры на выбор после победы, шанс % — молния или ярость зверя */
  override readonly auras = [['storm', 50], ['rage', 50]] as const;
  private readonly trunk = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly tail = new THREE.Group();
  private readonly heart = new THREE.Group();
  /** Свечение внутри рёбер: в перегрузке разгорается */
  private readonly core: THREE.Mesh;
  private readonly coreMat = glowMat(SPARK.clone().multiplyScalar(0.25), 0.55, true);
  private runT = 0;
  // прыжки
  private leapsLeft = 0;
  private leapPhase: 'crouch' | 'air' | 'rest' = 'crouch';
  private leapT = 0;
  private readonly jumpFrom = new THREE.Vector3();
  private readonly jumpAt = new THREE.Vector3();
  // перегрузка
  private ringT = 0;

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 1800, home, yaw, arena);
    this.speed = 5;
    this.turn = 4;
    this.keep = 2.4;
    this.core = new THREE.Mesh(UNIT, this.coreMat);
    this.build();
    this.reset();
  }

  protected build(): void {
    const bone = this.lam(BONE, pixelTex(BONE, 8, 731));
    const flesh = this.lam(FLESH, pixelTex(FLESH, 6, 732));
    const claw = this.lam(CLAW);
    const eye = glowMat(SPARK);
    const heartMat = this.shimmer(RASP, PINK, 0, 3);
    const B = this.box.bind(this);
    this.body.add(this.trunk);
    // туловище: хребет, таз и плечи — тёмная плоть, поверх — четыре пары костяных рёбер; между ними видно сердце
    B(this.trunk, flesh, 0.55, 0.4, 2.9, 0, 2.55, 0);
    B(this.trunk, flesh, 1.0, 0.7, 0.7, 0, 2.15, -1.15);
    B(this.trunk, flesh, 1.1, 0.8, 0.6, 0, 2.15, 1.15);
    B(this.trunk, bone, 0.25, 0.18, 2.6, 0, 2.8, 0);
    for (const z of [-0.6, -0.15, 0.3, 0.75]) {
      for (const s of [-1, 1]) B(this.trunk, bone, 0.14, 0.95, 0.2, s * 0.6, 2.0, z, 0, 0, s * 0.12);
      B(this.trunk, bone, 1.1, 0.14, 0.2, 0, 1.5, z);
    }
    this.core.scale.set(0.9, 0.8, 1.6);
    this.core.position.set(0, 2.0, 0.05);
    this.trunk.add(this.core);
    // сердце-ягода в клетке рёбер
    this.heart.position.set(0, 2.0, 0.35);
    this.trunk.add(this.heart);
    for (const [x, y, z, k] of [[0, 0, 0, 0.36], [0.2, 0.17, 0, 0.22], [-0.2, 0.17, 0, 0.22], [0.2, -0.17, 0, 0.22], [-0.2, -0.17, 0, 0.22], [0, 0, 0.2, 0.22], [0, 0, -0.2, 0.22]] as const) {
      B(this.heart, heartMat, k, k, k, x, y, z);
    }
    // трескучая шерсть на шее и спине — клочья «молния ↔ малина», свет бежит от загривка к хвосту
    for (const [z, hgt, rx] of [[1.15, 0.7, 0.5], [0.7, 0.6, 0.35], [0.2, 0.5, 0.2], [-0.35, 0.45, 0], [-0.85, 0.4, -0.25]] as const) {
      for (const s of [-1, 1]) B(this.trunk, this.shimmer(SPARK, RASP, z * 3 + s, 4), 0.18, hgt, 0.22, s * 0.16, 2.85 + hgt / 2 - 0.1, z, rx, 0, s * 0.35);
    }
    // малиновый венец на загривке
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, k = i % 2 ? 0.15 : 0.2;
      B(this.trunk, this.shimmer(RASP, PINK, i, 2.4), k, k, k, Math.sin(a) * 0.3, 3.05 + (i % 2 ? 0.04 : 0.1), 1.45 + Math.cos(a) * 0.25);
    }
    // голова: шея, длинный череп, глазницы-искры, рога-обломки; челюсть — отдельно, на шарнире
    this.head.position.set(0, 2.45, 1.45);
    this.trunk.add(this.head);
    B(this.head, flesh, 0.5, 0.5, 0.7, 0, 0, 0.25, -0.3, 0, 0);
    B(this.head, bone, 0.7, 0.55, 1.4, 0, 0.1, 1.05);
    B(this.head, bone, 0.5, 0.35, 0.5, 0, 0.0, 1.9);
    for (const s of [-1, 1]) {
      B(this.head, eye, 0.14, 0.1, 0.05, s * 0.3, 0.2, 1.5, 0, s * 0.5, 0);
      B(this.head, flesh, 0.14, 0.4, 0.14, s * 0.25, 0.5, 0.6, -0.6, 0, s * -0.3);
    }
    this.jaw.position.set(0, -0.2, 0.6);
    this.head.add(this.jaw);
    B(this.jaw, bone, 0.5, 0.16, 1.4, 0, 0, 0.75);
    B(this.jaw, glowMat(SPARK.clone().multiplyScalar(0.7)), 0.36, 0.08, 1.0, 0, 0.1, 0.8);
    // ноги: тощие столбы с тёмными когтистыми лапами, шарнир у плеч и таза
    for (const [x, z] of [[-0.45, 1.15], [0.45, 1.15], [-0.4, -1.15], [0.4, -1.15]]) {
      const g = new THREE.Group();
      g.position.set(x, 1.9, z);
      this.body.add(g);
      B(g, bone, 0.3, 1.6, 0.3, 0, -0.8, 0);
      B(g, claw, 0.42, 0.2, 0.6, 0, -1.8, 0.1);
      this.legs.push(g);
    }
    // хвост-хлыст: три куба, сужаются
    this.tail.position.set(0, 2.5, -1.45);
    this.trunk.add(this.tail);
    B(this.tail, flesh, 0.22, 0.22, 0.8, 0, 0, -0.4, 0.3, 0, 0);
    B(this.tail, bone, 0.14, 0.14, 0.8, 0, -0.3, -1.1, 0.5, 0, 0);
    B(this.tail, this.shimmer(SPARK, RASP, 2, 4), 0.2, 0.2, 0.3, 0, -0.55, -1.55);
  }

  override reset(): void {
    super.reset();
    this.trunk.rotation.set(0, 0, 0);
    this.coreMat.color.copy(SPARK).multiplyScalar(0.25);
    this.ringT = 0;
  }

  /** Перегрузка: свет внутри рёбер разгорается, быстрее, под телом — кольцо молний */
  protected override onEnrage(): void {
    this.speed = 6;
    this.coreMat.color.copy(SPARK).lerp(RASP, 0.3).multiplyScalar(0.7);
    const fx = this.h.fx;
    fx.screenFlash('#c0e0ff', 0.3, 0.25);
    fx.shake = Math.max(fx.shake, 0.8);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; this.bolt(this.pos.clone().setY(3.2), this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 4, 0.1, Math.sin(a) * 4)), 6, 0.5, 0.1); }
    if (!this.quiet) sfx.thunder();
  }

  protected choose(dist: number): string | null {
    if (dist < 3.5) return Math.random() < 0.75 ? 'claws' : 'leap';
    if (dist > 6 && Math.random() < 0.35) return 'storm';
    return Math.random() < 0.7 ? 'leap' : 'storm';
  }

  /** Ломаная молния из a в b: тонкие светящиеся бруски с ореолом, гаснут за dur */
  private bolt(a: THREE.Vector3, b: THREE.Vector3, segs: number, jag: number, w: number, dur = 0.28): void {
    const g = new THREE.Group();
    const core = glowMat(WHITE, 1, true), halo = glowMat(SPARK.clone().lerp(RASP, Math.random() * 0.5), 0.4, true);
    let prev = a.clone();
    for (let i = 1; i <= segs; i++) {
      const p = i === segs ? b.clone() : a.clone().lerp(b, i / segs).add(new THREE.Vector3(rand(-jag, jag), rand(-jag, jag) * 0.4, rand(-jag, jag)));
      p.y = Math.max(0.08, p.y);
      const len = prev.distanceTo(p);
      for (const [m, k] of [[core, 1], [halo, 3]] as const) {
        const s = new THREE.Mesh(UNIT, m);
        s.position.copy(prev).lerp(p, 0.5);
        s.lookAt(p);
        s.scale.set(w * k, w * k, len);
        g.add(s);
      }
      prev = p;
    }
    // геометрия общая (UNIT) — освобождаем только материалы
    this.h.fx.custom(g, dur, (k) => { const f = (1 - k) * (0.6 + Math.random() * 0.4); core.opacity = f; halo.opacity = f * 0.4; }, () => { core.dispose(); halo.dispose(); });
  }

  /** Молния с неба в метку */
  private strike(at: THREE.Vector3, r: number): void {
    if (this.dead) return;
    const fx = this.h.fx, top = at.clone().setY(13);
    this.bolt(top, at.clone().setY(0.05), 7, 0.7, 0.12);
    this.bolt(top.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1))), at.clone().setY(0.05), 5, 0.9, 0.06, 0.18);
    fx.flash(at.clone().setY(0.6), WHITE, 3.5, 0.25);
    fx.light(at.clone().setY(2), SPARK, 6, 12, 0.3);
    fx.shock(at.clone().setY(0.08), r + 0.3, SPARK, 0.35, 0.14);
    fx.burst(at.clone().setY(0.3), [SPARK, WHITE, RASP], 12, { speed: 5, up: 4, size: 0.08, life: 0.5, glow: true, gravity: 8 });
    fx.shake = Math.max(fx.shake, 0.3);
    if (!this.quiet) sfx.thunder();
    if (this.inCircle(at, r)) this.hurt(16, at, 4);
  }

  /** Следующий прыжок цепи: присед, метка у героя */
  private startLeap(): void {
    this.leapPhase = 'crouch'; this.leapT = 0;
    this.jumpFrom.copy(this.pos).setY(0);
    this.jumpAt.copy(this.clampIn(this.heroAt(), 2));
    this.markCircle(this.jumpAt, LEAP_R, CROUCH + this.air(), () => undefined, SPARK.clone().lerp(RASP, 0.4));
    if (!this.quiet) sfx.snarl();
  }

  private air(): number { return this.enraged ? AIR * 0.8 : AIR; }

  /** Приземлился: удар по кругу, шесть лучей цепной молнии — метка мигает и сразу бьёт */
  private landing(): void {
    const fx = this.h.fx, at = this.jumpAt;
    if (!this.quiet) sfx.land();
    fx.shake = Math.max(fx.shake, 0.8);
    fx.hitstop = Math.max(fx.hitstop, 0.05);
    fx.shock(at.clone().setY(0.08), LEAP_R + 0.3, SPARK, 0.4, 0.2);
    fx.flash(at.clone().setY(0.8), WHITE, 3, 0.2);
    fx.burst(at.clone().setY(0.3), DUST, 16, { speed: 5, up: 4, size: 0.14, life: 0.8, gravity: 12 });
    const smashed = this.inCircle(at, LEAP_R);
    if (smashed) this.hurt(20, at, 8);
    let chained = smashed;
    const a0 = rand(0, Math.PI * 2);
    for (let i = 0; i < RAYS; i++) {
      const a = a0 + (i / RAYS) * Math.PI * 2, dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      this.markLine(at.clone(), dir, RAY_LEN, RAY_W, 0.22, () => {
        if (this.dead) return;
        const end = at.clone().addScaledVector(dir, RAY_LEN).setY(0.25);
        this.bolt(at.clone().setY(0.3), end, 7, 0.45, 0.1, 0.3);
        this.bolt(at.clone().setY(0.3), end, 5, 0.7, 0.05, 0.2);
        fx.burst(end, [SPARK, RASP], 5, { speed: 3, up: 2, size: 0.07, life: 0.35, glow: true, gravity: 6 });
        if (i === 0 && !this.quiet) sfx.chain();
        // кого уже ударило приземлением, тот лучом второй раз не получает
        if (!chained && this.inLine(at, dir, RAY_LEN, RAY_W)) { chained = true; this.hurt(12, at, 3); }
      }, SPARK);
    }
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'leap': {
        if (!this.hitDone) { this.hitDone = true; this.leapsLeft = this.enraged ? 3 : 2; this.startLeap(); }
        this.leapT += dt;
        if (this.leapPhase === 'crouch') {
          this.face(dt, 2.5);
          if (this.leapT >= CROUCH) { this.leapPhase = 'air'; this.leapT = 0; }
          return false;
        }
        if (this.leapPhase === 'air') {
          const k = Math.min(1, this.leapT / this.air());
          this.pos.x = THREE.MathUtils.lerp(this.jumpFrom.x, this.jumpAt.x, k);
          this.pos.z = THREE.MathUtils.lerp(this.jumpFrom.z, this.jumpAt.z, k);
          this.flyY = Math.sin(Math.PI * k) * PEAK;
          if (Math.random() < 0.6) fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.5, 0.5), this.flyY + 2.6, rand(-1, 1))), vel: new THREE.Vector3(0, rand(-0.5, 0.5), 0), life: 0.35, size: rand(0.06, 0.12), color: Math.random() < 0.7 ? SPARK : RASP, gravity: 0 });
          if (k < 1) return false;
          this.flyY = 0;
          this.landing();
          this.leapPhase = 'rest'; this.leapT = 0;
          return false;
        }
        // короткая передышка между прыжками; после цепи — задыхается
        if (this.leapT < 0.35) return false;
        if (--this.leapsLeft > 0) { this.startLeap(); return false; }
        fx.text(this.pos.clone().setY(this.topY + 0.8), 'задыхается!', 'crit');
        if (!this.quiet) sfx.pant();
        this.daze(2.2);
        return true;
      }
      case 'claws': {
        // два взмаха передними лапами, на каждом — рывок вперёд
        if (t < 0.3) this.face(dt, 2.5);
        for (const at of [0.35, 0.72]) {
          if (t >= at && t - dt < at) {
            if (!this.quiet) sfx.claw();
            this.move(this.fwd(), 0.5);
            const c = this.pos.clone().addScaledVector(this.fwd(), 1.8).setY(1.2);
            fx.arc(this.pos.clone(), this.yaw, SPARK, 3.2, 0.95, 1.1);
            fx.burst(c, [SPARK, WHITE, RASP], 8, { speed: 4, up: 1, size: 0.07, life: 0.3, glow: true, gravity: 2 });
            if (this.inCone(this.pos, this.yaw, 3.4, 0.95)) this.hurt(14, this.pos.clone(), 4);
          }
        }
        if (t > 0.5 && t < 0.62) this.face(dt, 3);
        return t > 1.1;
      }
      case 'storm': {
        // на дыбы, вой — метки по арене, первая у героя; молнии бьют по очереди
        const n = this.enraged ? 10 : 6, STEP = 0.22;
        if (t < 0.7) { if (t - dt <= 0 && !this.quiet) sfx.howl(); return false; }
        if (!this.hitDone) {
          this.hitDone = true;
          fx.shock(this.pos.clone().setY(0.1), 4, SPARK, 0.4, 0.2);
          const a = this.arena;
          for (let i = 0; i < n; i++) {
            const p = i === 0 ? this.clampIn(this.heroAt()) : i % 3 === 1 ? this.clampIn(this.heroAt().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3)))) : this.clampIn(new THREE.Vector3(rand(a.x0, a.x1), 0, rand(a.z0, a.z1)));
            this.markCircle(p, 1.6, 0.9 + i * STEP, () => this.strike(p, 1.6), SPARK);
          }
        }
        if (Math.random() < 0.5) this.bolt(this.pos.clone().setY(3.2), this.pos.clone().add(new THREE.Vector3(rand(-2, 2), 6, rand(-2, 2))), 4, 0.5, 0.05, 0.12);
        return t > 0.7 + 0.9 + n * STEP + 0.3;
      }
    }
    return true;
  }

  override update(dt: number): void {
    super.update(dt);
    if (!this.enraged || this.dead || this.state === 'sleep' || this.flyY > 1) return;
    // перегрузка: под зверем кольцом тлеют разряды
    this.ringT -= dt;
    if (this.ringT > 0) return;
    this.ringT = 0.35;
    for (let i = 0; i < 2; i++) {
      const a = rand(0, Math.PI * 2), r = this.radius + 0.4;
      const p = this.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      this.hazard(p, 0.9, 1.4, 8, SPARK.clone().lerp(RASP, 0.3));
    }
    if (Math.random() < 0.4) this.bolt(this.pos.clone().setY(2.2), this.pos.clone().add(new THREE.Vector3(rand(-2.5, 2.5), 0.1, rand(-2.5, 2.5))), 4, 0.4, 0.05, 0.15);
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, atk = this.state === 'attack' ? this.attack : '';
    const air = atk === 'leap' && this.leapPhase === 'air', crouch = atk === 'leap' && this.leapPhase === 'crouch';
    // галоп: передняя пара и задняя пара вразнобой
    let swing = 0;
    if (walk) { this.runT += dt * this.speed * this.speedK * 2.2; swing = Math.sin(this.runT) * 0.7; }
    this.legs.forEach((g, i) => { g.rotation.x = (i < 2 ? 1 : -1) * swing; });
    let lean = 0, lift = walk ? Math.abs(Math.sin(this.runT)) * 0.12 : 0, sx = 1, sy = 1;
    let headX = Math.sin(t * 2) * 0.05, jawX = 0.05 + Math.max(0, Math.sin(t * 3)) * 0.05;
    if (this.state === 'sleep') { lean = 0.1; headX = 0.45; sy = 0.92 + Math.sin(t * 1.4) * 0.03; jawX = 0; }
    if (crouch) { sy = 0.82; sx = 1.08; lean = 0.12; headX = 0.25; jawX = 0.35; }
    if (air) {
      // вытянулся в прыжке: передние вперёд, задние назад
      lean = -0.1; headX = -0.15; jawX = 0.5;
      this.legs.forEach((g, i) => { g.rotation.x = i < 2 ? -0.9 : 0.8; });
    }
    if (atk === 'leap' && this.leapPhase === 'rest') { const k = Math.min(1, this.leapT / 0.2); sy = 0.85 + 0.15 * k; sx = 1.1 - 0.1 * k; headX = 0.2; }
    if (atk === 'claws') {
      // встаёт на задние и бьёт передними лапами крест-накрест
      const k = S < 0.35 ? S / 0.35 : S < 0.72 ? 1 - (S - 0.35) / 0.37 * 0.6 : Math.max(0, 0.4 - (S - 0.72) * 1.2);
      lean = -0.25 * k; lift = 0.3 * k; jawX = 0.6 * k;
      const swipe = (at: number) => { const q = (S - at) / 0.15; return q > 0 && q < 1 ? Math.sin(q * Math.PI) : 0; };
      this.legs[0].rotation.x = -1.1 * k + swipe(0.35) * 1.6;
      this.legs[1].rotation.x = -1.1 * k + swipe(0.72) * 1.6;
    }
    if (atk === 'storm') {
      // на дыбах, морда к небу, пасть раскрыта — вой
      const k = Math.min(1, S / 0.5);
      lean = -0.55 * k; lift = 0.6 * k; headX = -0.7 * k; jawX = 0.8 * k;
      this.legs[0].rotation.x = this.legs[1].rotation.x = -1.0 * k + Math.sin(t * 10) * 0.15 * k;
    }
    if (this.state === 'daze') {
      // задыхается: голова висит, пасть хлопает, бока ходят ходуном
      lean = 0.15; headX = 0.6; jawX = 0.3 + Math.abs(Math.sin(t * 9)) * 0.35; sy = 0.92 + Math.sin(t * 9) * 0.04;
      this.trunk.rotation.z = Math.sin(t * 4) * 0.08;
    } else this.trunk.rotation.z *= 0.85;
    if (this.state !== 'dead') {
      this.body.rotation.x += (lean - this.body.rotation.x) * Math.min(1, dt * 14);
      this.body.position.y = lift;
      this.body.scale.lerp(new THREE.Vector3(sx, sy, sx), 0.3);
    }
    this.head.rotation.x += (headX - this.head.rotation.x) * Math.min(1, dt * 16);
    this.jaw.rotation.x += (jawX - this.jaw.rotation.x) * Math.min(1, dt * 20);
    this.tail.rotation.y = Math.sin(t * (walk ? 12 : 5)) * 0.5;
    this.tail.rotation.x = Math.sin(t * 3.3) * 0.15 + (air ? 0.4 : 0);
    // постоянные искры с шерсти; в перегрузке — гуще, и свет в рёбрах дрожит
    const live = this.state !== 'dead' && this.state !== 'sleep';
    if (live && Math.random() < (this.enraged ? 0.6 : 0.3)) {
      this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.5, 0.5), this.flyY + lift + rand(2.6, 3.4), rand(-1.2, 1.4))), vel: new THREE.Vector3(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)), life: rand(0.15, 0.35), size: rand(0.05, 0.1), color: Math.random() < 0.7 ? SPARK : RASP, gravity: 0 });
      if (Math.random() < 0.06 && !this.quiet) sfx.crackle();
    }
    this.coreMat.opacity = this.enraged ? 0.6 + Math.random() * 0.35 : 0.45 + Math.sin(t * 4) * 0.1;
    this.core.scale.set(0.9, 0.8, 1.6).multiplyScalar(this.enraged ? 1.08 : 1);
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 6)) * 0.1;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.6 : 1));
  }
}
