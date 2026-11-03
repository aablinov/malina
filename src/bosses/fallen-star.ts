import * as THREE from 'three';
import { pixelTex } from '../textures.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';

/**
 * Павшая Звезда — финальный страж (wiki/design-bosses.md, разделы 1–5; схематичное «Сердце Края» / Астель): та самая
 * звезда, в кратере которой выросла первая малина. Реликвия: кристальное ядро из четырёх граней и двух шпилей парит
 * в полутора метрах над полом, вокруг — три кольца кубиков, каждое крутится по своей оси; между гранями светится
 * ягода-сердце, в оглушении грани раскрываются и сердце бьётся крупно. Дрейфует медленно, сыплет звёздной пылью.
 * Фаза 1: луч (заряд → полоса → огромный луч медленно ведёт ±35°, после — перегрев и оглушение), метеоритный дождь
 * у героя (горящие воронки), кольцо из 12 осколков наружу, вблизи — пульс.
 * Превращение на 50 %: «Звезда пробуждается» — тьма, камера назад, кольца раскрываются в нимб, ядро поднимается,
 * пол трескается лучами от центра. Фаза 2: луч ведёт на 180°, метеориты по всей арене, раз в ~14 с «сверхновая» —
 * три кристальных столба-укрытия, ядро сжимается и тянет героя, круг r 10 → взрыв (за столбом — цел), оглушение.
 * Роняет «Луч павшей звезды». Подвижных частей: сердце, четыре грани, три кольца.
 */

const STAR = C(3.6, 3.6, 4), GOLD = C(4, 3.6, 2.4), PINK = C(4, 1.7, 2.4), EMBER = C(4, 1.6, 0.5);
/** Центр ядра над корнем тела, м */
const CORE_Y = 1.2;
/** Луч: длина, ширина, урон за тик 0,2 с */
const BEAM_LEN = 30, BEAM_W = 2.2, BEAM_DMG = 8;
/** Сверхновая: радиус, урон, перезарядка */
const NOVA_R = 10, NOVA_DMG = 30, NOVA_CD = 14;
/** Столбы-укрытия: высота, полуширина (для толчка героя) */
const PILLAR_H = 3.2, PILLAR_R = 0.75;

const sfx = {
  /** Заряд луча: восходящий хор и звон */
  charge() { voice({ type: 'sine', f: 392, f1: 1568, dur: 1.6, vol: 0.05, attack: 0.4, verb: 0.8 }); bell(1568, 1.2, 0.03, 0.6, 0.8); },
  /** Луч: низкий гул и шипение света */
  beam(dur: number) { voice({ type: 'sawtooth', f: 98, f1: 92, dur, vol: 0.06, detune: 12, lp: 1400, verb: 0.6 }); hiss({ dur, vol: 0.14, f: 3000, q: 0.5, type: 'bandpass', attack: 0.05, verb: 0.5 }); boom(90, 30, 0.8, 0.6, 0, 0.6); },
  /** Метеорит: свист и удар */
  impact() { boom(110, 40, 0.35, 0.35); hiss({ dur: 0.3, vol: 0.1, f: 3000, f1: 700, q: 0.8, type: 'bandpass' }); },
  /** Осколки: стеклянный перезвон */
  shards() { for (const [f, d] of [[1760, 0], [2349, 0.04], [2637, 0.08]] as const) bell(f, 0.5, 0.035, d, 0.6); },
  /** Пульс и взрывы: удар снизу */
  thump(k = 1) { boom(70, 25, 0.6 * k, 0.5 * k, 0, 0.5); },
  /** Пробуждение: колокол и низкий хор */
  awaken() { bell(196, 3, 0.09, 0, 0.9); voice({ type: 'triangle', f: 98, f1: 196, dur: 2.6, vol: 0.06, lp: 800, lp1: 3000, verb: 0.9 }); },
};

export class FallenStar extends MiniBoss {
  readonly radius = 1.4;
  readonly title = 'Павшая Звезда';
  override readonly subtitle = 'сердце упавшей звезды';
  override readonly topY = 4.6;
  readonly drop = 'starbeam';
  override readonly tier = 'final' as const;
  private readonly heart = new THREE.Group();
  private readonly facets: THREE.Group[] = [];
  private readonly rings: THREE.Group[] = [];
  private readonly ringSpin = [0, 0, 0];
  private readonly pillars: THREE.Group[] = [];
  /** Столб: поднят ли (анимация выезда из пола) */
  private readonly pillarUp = [false, false, false];
  /** Отложенные действия (метеорит падает чуть раньше, чем вспыхнет метка) */
  private readonly later: { t: number; fn: () => void }[] = [];
  private beam: { g: THREE.Group; mats: THREE.Material[] } | null = null;
  private readonly aim = new THREE.Vector3();
  private beamTick = 0;
  private beamSide = 1;
  /** Луч второй фазы (180°) — запоминается на старте, ярость посреди луча его не ломает */
  private beamWide = false;
  private beamCd = 3;
  private novaCd = 99;
  /** Ярость наступила — превращение ждёт своей очереди (не обрывает текущую атаку) */
  private wakeUp = false;
  /** Нимб: 0 — кольца, 1 — раскрытый нимб второй фазы */
  private haloK = 0;
  /** Обороты колец (заряд луча — быстро) */
  private spinK = 1;

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 3400, home, yaw, arena);
    this.speed = 1.6;
    this.keep = 4;
    this.turn = 1.6;
    this.build();
    this.reset();
  }

  protected build(): void {
    const crystal = this.lam('#f4e6c0', pixelTex('#f4e6c0', 10, 977));
    const edgeM = this.shimmer(GOLD, RASP, 0, 1.4);
    const heartM = this.shimmer(RASP, PINK, 0, 3);
    const starM = this.shimmer(STAR, GOLD, 1, 2);
    const B = this.box.bind(this);
    // шпили сверху и снизу — ромбы, неподвижны относительно тела
    B(this.body, crystal, 0.62, 0.62, 0.62, 0, CORE_Y + 1.0, 0, Math.PI / 4, 0, Math.PI / 4);
    B(this.body, starM, 0.3, 0.3, 0.3, 0, CORE_Y + 1.5, 0, Math.PI / 4, 0, Math.PI / 4);
    B(this.body, crystal, 0.5, 0.5, 0.5, 0, CORE_Y - 0.95, 0, Math.PI / 4, 0, Math.PI / 4);
    // ягода-сердце в центре: видна в щелях между гранями
    this.heart.position.y = CORE_Y;
    this.body.add(this.heart);
    for (const [x, y, z, k] of [[0, 0, 0, 0.5], [0.22, 0.12, 0, 0.26], [-0.22, 0.12, 0, 0.26], [0, 0.12, 0.22, 0.26], [0, 0.12, -0.22, 0.26], [0, 0.34, 0, 0.2]] as const) B(this.heart, heartM, k, k, k, x, y, z);
    // четыре грани: кристальная плита и светящаяся кромка; углы между ними открыты
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.rotation.order = 'YXZ';
      this.body.add(g);
      B(g, crystal, 0.62, 1.5, 0.3, 0, 0, 0);
      B(g, edgeM, 0.08, 1.3, 0.34, 0.3, 0, 0.02);
      this.facets.push(g);
    }
    // три кольца кубиков, у каждого свой наклон и радиус
    const ringMats = [starM, edgeM, this.shimmer(GOLD, STAR, 2, 1.1)];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.y = CORE_Y;
      this.body.add(g);
      const r = 1.35 + i * 0.4, n = 9 + i * 2;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, s = k % 3 === 0 ? 0.26 : 0.17;
        B(g, k % 3 === 0 ? heartM : ringMats[i], s, s, s, Math.cos(a) * r, 0, Math.sin(a) * r, a, a, 0);
      }
      this.rings.push(g);
    }
    // столбы-укрытия для сверхновой: стоят под полом, пока не нужны
    const pm = new THREE.MeshLambertMaterial({ map: pixelTex('#e8dcc0', 10, 981) });
    const pg = glowMat(GOLD);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      B(g, pm, 1.1, PILLAR_H, 1.1, 0, PILLAR_H / 2, 0, 0, Math.PI / 4, 0);
      B(g, pg, 0.5, 0.5, 0.5, 0, PILLAR_H + 0.25, 0, Math.PI / 4, 0, Math.PI / 4);
      g.visible = false;
      this.h.scene.add(g);
      this.pillars.push(g);
    }
  }

  override reset(): void {
    super.reset();
    this.cleanup();
    this.wakeUp = false; this.haloK = 0; this.spinK = 1;
    this.beamCd = 3; this.novaCd = 99;
    this.body.position.y = 1.5;
  }

  protected override die(): void {
    super.die();
    this.cleanup();
  }

  /** Убрать своё: луч, таймеры, столбы */
  private cleanup(): void {
    this.later.length = 0;
    this.endBeam();
    for (let i = 0; i < 3; i++) { this.pillarUp[i] = false; this.pillars[i].visible = false; this.pillars[i].position.y = -PILLAR_H; }
  }

  protected override onEnrage(): void { this.wakeUp = true; }

  protected choose(dist: number): string | null {
    if (this.wakeUp) return 'awaken';
    if (this.enraged && this.novaCd <= 0) return 'nova';
    if (dist < 5 && Math.random() < 0.45) return 'pulse';
    if (this.beamCd <= 0 && Math.random() < 0.55) return 'beam';
    return Math.random() < 0.5 ? 'meteors' : 'shards';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx, crossed = (at: number) => t >= at && t - dt < at;
    switch (name) {
      case 'beam': {
        // заряд 1 с (кольца раскручиваются, свет стягивается) → полоса 0,8 с → луч ведёт ±35° (на ярости — 180°)
        if (!this.hitDone) { this.beamWide = this.enraged; }
        const sweep = this.beamWide ? 3 : 2, fire = 1.8;
        if (!this.hitDone) { this.hitDone = true; this.beamCd = 9; this.beamSide = Math.random() < 0.5 ? -1 : 1; if (!this.quiet) sfx.charge(); }
        if (t < 1) {
          this.face(dt, 2);
          this.spinK = 1 + t * 5;
          const c = this.core(), a = rand(0, Math.PI * 2), r = rand(1.5, 3);
          fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(-1, 1), Math.sin(a) * r)), vel: new THREE.Vector3(-Math.cos(a) * r * 2, 0, -Math.sin(a) * r * 2), life: 0.45, size: 0.1, color: Math.random() < 0.7 ? GOLD : RASP, gravity: 0 });
        }
        if (crossed(1)) {
          this.aim.copy(this.heroAt()).sub(this.pos).setY(0);
          if (this.aim.lengthSq() < 1e-4) this.aim.copy(this.fwd());
          this.aim.normalize();
          this.yaw = Math.atan2(this.aim.x, this.aim.z);
          this.markLine(this.pos.clone().setY(0), this.aim, BEAM_LEN, BEAM_W, fire - 1, () => undefined, GOLD);
        }
        if (crossed(fire)) {
          this.fireBeam();
          fx.screenFlash('#fff0c0', 0.35, 0.3);
          fx.flash(this.core(), STAR, 4, 0.3);
          fx.light(this.core(), GOLD, 10, 18, sweep);
          fx.shake = Math.max(fx.shake, 0.5);
          if (!this.quiet) sfx.beam(sweep);
        }
        if (t >= fire && t < fire + sweep && this.beam) {
          const u = (t - fire) / sweep;
          const ang = this.beamWide ?this.beamSide * Math.PI * (u * u * (3 - 2 * u)) : this.beamSide * THREE.MathUtils.degToRad(35) * Math.sin(u * Math.PI * 1.5);
          const dir = this.aim.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
          this.yaw = Math.atan2(dir.x, dir.z);
          this.aimBeam(dir, Math.min(1, (t - fire) * 6, (fire + sweep - t) * 5));
          this.beamTick -= dt;
          const from = this.pos.clone().setY(0);
          if (this.beamTick <= 0 && this.inLine(from, dir, BEAM_LEN, BEAM_W)) { this.beamTick = 0.2; this.hurt(BEAM_DMG, from, 3); }
          // по полу — искры вдоль луча
          const p = from.addScaledVector(dir, rand(2, BEAM_LEN * 0.6)).setY(0.2);
          fx.particle({ pos: p, vel: new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1)), life: 0.4, size: 0.12, color: Math.random() < 0.6 ? GOLD : RASP, gravity: 6 });
        }
        if (t < fire + sweep) return false;
        // перегрев: грани раскрываются, сердце наружу
        this.endBeam();
        this.spinK = 1;
        fx.burst(this.core(), [EMBER, GOLD, RASP], 20, { speed: 4, up: 2, size: 0.12, life: 0.7, glow: true, gravity: 3 });
        fx.text(this.core().setY(this.topY + 0.8), 'перегрев', 'crit');
        this.daze(this.enraged ? 2 : 2.5);
        return true;
      }
      case 'meteors': {
        // осколки звезды с неба: у героя (на ярости — по всей арене), каждая воронка горит
        if (!this.hitDone) {
          this.hitDone = true;
          const n = this.enraged ? 22 : 8, a = this.arena;
          for (let i = 0; i < n; i++) {
            let at: THREE.Vector3;
            if (i < 3 || !this.enraged) { const an = rand(0, Math.PI * 2), r = i === 0 ? 0 : rand(1.5, 5.5); at = this.heroAt().add(new THREE.Vector3(Math.cos(an) * r, 0, Math.sin(an) * r)); }
            else at = new THREE.Vector3(rand(a.x0, a.x1), 0, rand(a.z0, a.z1));
            this.meteor(this.clampIn(at, 1), 1.0 + i * (this.enraged ? 0.09 : 0.15), i);
          }
        }
        return t > (this.enraged ? 2.4 : 1.6);
      }
      case 'shards': {
        // 12 осколков из ядра наружу по лучам; на ярости — вторая волна со сдвигом
        if (!this.hitDone) { this.hitDone = true; this.shardRing(0); }
        if (this.enraged && crossed(0.6)) this.shardRing(Math.PI / 12);
        return t > (this.enraged ? 1.9 : 1.3);
      }
      case 'pulse': {
        // ядро сжимается и выталкивает кольцо света
        if (!this.hitDone) {
          this.hitDone = true;
          const at = this.pos.clone().setY(0);
          this.markCircle(at, 4.5, 0.65, () => {
            fx.shock(at.clone().setY(0.15), 4.5, GOLD, 0.4, 0.3);
            fx.burst(this.core(), [STAR, GOLD, RASP], 16, { speed: 6, up: 1, size: 0.12, life: 0.5, glow: true, gravity: 2 });
            fx.shake = Math.max(fx.shake, 0.35);
            if (!this.quiet) sfx.thump();
            if (this.inCircle(at, 4.5)) this.hurt(14, at, 10);
          }, GOLD);
        }
        return t > 1;
      }
      case 'awaken': {
        // превращение: тьма, камера назад, кольца — в нимб, ядро поднимается, пол трескается лучами
        if (!this.hitDone) {
          this.hitDone = true;
          this.wakeUp = false;
          fx.title('Звезда пробуждается', '#ffd27a');
          fx.darken(2.2);
          fx.zoom = Math.max(fx.zoom, 0.4);
          fx.screenFlash('#ffe0a0', 0.4, 0.5);
          fx.shake = Math.max(fx.shake, 0.6);
          if (!this.quiet) sfx.awaken();
        }
        this.spinK = 3;
        if (crossed(0.9)) {
          const from = this.pos.clone().setY(0), base = rand(0, Math.PI * 2);
          for (let i = 0; i < 6; i++) {
            const a = base + (i / 6) * Math.PI * 2, dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
            this.markLine(from, dir, 13, 1.2, 0.9, () => this.crack(from, dir), EMBER);
          }
        }
        if (t < 2.6) return false;
        this.spinK = 1;
        this.novaCd = 6;
        return true;
      }
      case 'nova': {
        // сверхновая: столбы из пола → ядро сжимается и тянет героя → круг r 10 → взрыв → оглушение
        const at = this.pos.clone().setY(0);
        if (!this.hitDone) { this.hitDone = true; this.novaCd = NOVA_CD; this.raisePillars(); if (!this.quiet) bell(147, 2.5, 0.08, 0, 0.9); }
        if (crossed(0.6)) this.markCircle(at, NOVA_R, 2.4, () => this.novaBoom(at), RASP);
        if (t > 0.6 && t < 2.1) {
          const hero = this.h.hero.pos, dx = this.pos.x - hero.x, dz = this.pos.z - hero.z, d = Math.hypot(dx, dz);
          if (d > 2) { hero.x += (dx / d) * 1.8 * dt; hero.z += (dz / d) * 1.8 * dt; }
          const c = this.core(), a = rand(0, Math.PI * 2), r = rand(3, 6);
          fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(-1.5, 1.5), Math.sin(a) * r)), vel: new THREE.Vector3(-Math.cos(a) * r * 1.5, 0, -Math.sin(a) * r * 1.5), life: 0.6, size: 0.12, color: Math.random() < 0.5 ? RASP : GOLD, gravity: 0 });
        }
        if (t < 3.3) return false;
        this.later.push({ t: 3.5, fn: () => this.lowerPillars() });
        this.daze(3);
        return true;
      }
    }
    return true;
  }

  /** Центр ядра в мире */
  private core(): THREE.Vector3 { return this.pos.clone().setY(this.body.position.y + CORE_Y); }

  /** Луч: белая сердцевина, золотое и малиновое сияние; длина вдоль локальной +Z */
  private fireBeam(): void {
    this.endBeam();
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    const mats = [glowMat(STAR), glowMat(GOLD.clone().multiplyScalar(0.5), 0.6, true), glowMat(RASP.clone().multiplyScalar(0.25), 0.4, true)];
    this.box(g, mats[0], 0.7, 0.7, BEAM_LEN, 0, 0, BEAM_LEN / 2);
    this.box(g, mats[1], 1.5, 1.5, BEAM_LEN, 0, 0, BEAM_LEN / 2);
    this.box(g, mats[2], BEAM_W + 0.3, BEAM_W + 0.3, BEAM_LEN, 0, 0, BEAM_LEN / 2);
    this.h.scene.add(g);
    this.beam = { g, mats };
    this.beamTick = 0;
  }

  /** Повернуть луч: из ядра чуть вниз, к полу на дальнем конце; k — толщина (вспыхивает и гаснет) */
  private aimBeam(dir: THREE.Vector3, k: number): void {
    if (!this.beam) return;
    const g = this.beam.g, c = this.core();
    g.position.copy(c);
    g.rotation.set(Math.atan2(c.y - 0.4, BEAM_LEN), Math.atan2(dir.x, dir.z), 0);
    const w = Math.max(0.05, k) * (1 + Math.sin(this.time * 30) * 0.06);
    g.scale.set(w, w, 1);
  }

  private endBeam(): void {
    if (!this.beam) return;
    this.h.scene.remove(this.beam.g);
    for (const m of this.beam.mats) m.dispose();
    this.beam = null;
  }

  /** Метка и осколок звезды, падающий в неё: урон 16, воронка горит 4 с */
  private meteor(at: THREE.Vector3, dur: number, i: number): void {
    this.markCircle(at, 1.6, dur, () => {
      const fx = this.h.fx;
      fx.burst(at.clone().setY(0.3), [STAR, GOLD, EMBER], 10, { speed: 3.5, up: 4, size: 0.12, life: 0.6, glow: true, gravity: 8 });
      fx.shock(at.clone().setY(0.08), 1.6, EMBER.clone().multiplyScalar(0.6), 0.3, 0.12);
      if (!this.quiet && i % 3 === 0) sfx.impact();
      if (this.inCircle(at, 1.6)) this.hurt(16, at, 4);
      this.hazard(at, 1.1, 4, 8, EMBER);
    }, GOLD);
    this.later.push({ t: dur - 0.35, fn: () => {
      const m = new THREE.Mesh(UNIT, glowMat(i % 3 === 1 ? RASP : STAR));
      m.scale.setScalar(0.55);
      this.lob(m, at.clone().add(new THREE.Vector3(rand(-2, 2), 15, rand(-2, 2))), at, 0.35, 0, GOLD, () => undefined);
    } });
  }

  /** 12 полос от ядра; по ним разлетаются кристальные осколки: урон 12 */
  private shardRing(off: number): void {
    const from = this.pos.clone().setY(0), len = 10, dirs: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) { const a = off + (i / 12) * Math.PI * 2; dirs.push(new THREE.Vector3(Math.sin(a), 0, Math.cos(a))); }
    for (const d of dirs) this.markLine(from, d, len, 1, 0.8, () => undefined, GOLD);
    this.later.push({ t: 0.8, fn: () => {
      const fx = this.h.fx, mat = glowMat(STAR), g = new THREE.Group();
      for (const d of dirs) this.box(g, mat, 0.25, 0.25, 0.9, 0, 0, 0, 0, Math.atan2(d.x, d.z), 0);
      g.position.copy(from).setY(1.2);
      fx.custom(g, 0.45, (k) => g.children.forEach((m, i) => m.position.copy(dirs[i]).multiplyScalar(1 + (len - 1) * k)), () => mat.dispose());
      fx.flash(this.core(), GOLD, 2.5, 0.2);
      if (!this.quiet) sfx.shards();
      if (dirs.some((d) => this.inLine(from, d, len, 1))) this.hurt(12, from, 5);
    } });
  }

  /** Трещина пола от центра: урон 10 сразу, потом горит 10 с */
  private crack(from: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.inLine(from, dir, 13, 1.2)) this.hurt(10, from, 4);
    for (let d = 2; d <= 13; d += 1.6) {
      const p = this.clampIn(from.clone().addScaledVector(dir, d), 0.8);
      this.hazard(p, 0.75, 10, 6, EMBER);
      this.h.fx.burst(p.clone().setY(0.2), [EMBER, GOLD], 4, { speed: 2, up: 3, size: 0.1, life: 0.5, glow: true, gravity: 6 });
    }
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.3);
  }

  /** Три столба вокруг ядра через 120° */
  private raisePillars(): void {
    const base = rand(0, Math.PI * 2);
    for (let i = 0; i < 3; i++) {
      const a = base + (i / 3) * Math.PI * 2, p = this.clampIn(this.pos.clone().add(new THREE.Vector3(Math.sin(a) * 6.5, 0, Math.cos(a) * 6.5)), 2);
      const g = this.pillars[i];
      g.position.set(p.x, -PILLAR_H, p.z);
      g.visible = true;
      this.pillarUp[i] = true;
      this.h.fx.burst(p.clone().setY(0.3), ['#e8dcc0', GOLD], 12, { speed: 3, up: 4, size: 0.14, life: 0.6, gravity: 10 });
    }
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.3);
  }

  private lowerPillars(): void { for (let i = 0; i < 3; i++) this.pillarUp[i] = false; }

  /** Герой за столбом (дальше столба от ядра, вплотную, не сбоку) */
  private sheltered(c: THREE.Vector3): boolean {
    const hero = this.h.hero.pos;
    return this.pillars.some((g, i) => {
      if (!this.pillarUp[i] || g.position.y < -0.5) return false;
      const vx = g.position.x - c.x, vz = g.position.z - c.z, vl = Math.hypot(vx, vz) || 1;
      const ux = hero.x - g.position.x, uz = hero.z - g.position.z;
      const along = (ux * vx + uz * vz) / vl, side = Math.abs(ux * vz - uz * vx) / vl;
      return along > 0 && along < PILLAR_R + 1.2 && side < 0.9;
    });
  }

  /** Взрыв сверхновой: урон 30 всем в круге, кроме укрывшихся */
  private novaBoom(at: THREE.Vector3): void {
    const fx = this.h.fx, c = this.core();
    fx.screenFlash('#ffd8f0', 0.55, 0.5);
    fx.flash(c, STAR, 8, 0.4);
    fx.light(c, PINK, 14, 24, 0.8);
    fx.shock(at.clone().setY(0.15), NOVA_R, RASP, 0.6, 0.4);
    fx.shock(at.clone().setY(0.3), NOVA_R * 0.7, GOLD, 0.5, 0.3);
    fx.burst(c, [STAR, GOLD, RASP, PINK], 50, { speed: 10, up: 3, size: 0.16, life: 1, glow: true, gravity: 2 });
    fx.shake = Math.max(fx.shake, 0.9);
    fx.hitstop = Math.max(fx.hitstop, 0.08);
    if (!this.quiet) { sfx.thump(1.6); hiss({ dur: 1.2, vol: 0.25, f: 2500, f1: 300, q: 0.5, type: 'lowpass', verb: 0.7 }); }
    if (this.inCircle(at, NOVA_R) && !this.sheltered(at)) this.hurt(NOVA_DMG, at, 12);
  }

  override update(dt: number): void {
    super.update(dt);
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      l.t -= dt;
      if (l.t <= 0) { this.later.splice(i, 1); l.fn(); }
    }
    if (this.beam && !(this.state === 'attack' && this.attack === 'beam')) this.endBeam();
    if (this.awake && !this.dead) { this.beamCd -= dt; if (this.enraged && this.attack !== 'nova') this.novaCd -= dt; }
    // столбы выезжают из пола и уходят обратно; герой сквозь них не проходит
    const hero = this.h.hero.pos;
    this.pillars.forEach((g, i) => {
      if (!g.visible) return;
      g.position.y = THREE.MathUtils.lerp(g.position.y, this.pillarUp[i] ? 0 : -PILLAR_H - 0.2, Math.min(1, dt * 6));
      if (!this.pillarUp[i] && g.position.y < -PILLAR_H) { g.visible = false; return; }
      const dx = hero.x - g.position.x, dz = hero.z - g.position.z, d = Math.hypot(dx, dz);
      if (g.position.y > -1 && d < PILLAR_R + 0.35 && d > 1e-3) { const k = (PILLAR_R + 0.35 - d) / d; hero.x += dx * k; hero.z += dz * k; }
    });
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, dead = this.state === 'dead', daze = this.state === 'daze', sleep = this.state === 'sleep';
    const atk = this.state === 'attack' ? this.attack : '';
    // нимб второй фазы: кольца раскрываются за ядром, ядро поднимается
    const halo = this.enraged && (atk !== 'awaken' || this.st > 0.4);
    this.haloK = THREE.MathUtils.lerp(this.haloK, halo ? 1 : 0, Math.min(1, dt * 1.5));
    if (atk !== 'beam' && atk !== 'awaken') this.spinK = THREE.MathUtils.lerp(this.spinK, 1, Math.min(1, dt * 2));
    // парит: во сне низко, в оглушении оседает, на второй фазе выше
    if (!dead) {
      const y = sleep ? 0.9 : daze ? 0.7 : 1.5 + this.haloK * 0.9;
      this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, y + Math.sin(t * 1.1) * 0.15, Math.min(1, dt * 3));
      this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, walk ? 0.08 : 0, 0.1);
    }
    // сверхновая: ядро сжимается до взрыва
    const nova = atk === 'nova' ? (this.st < 0.6 ? 0 : this.st < 3 ? Math.min(1, (this.st - 0.6) / 1.2) : 0) : 0;
    // грани: открываются в оглушении, сжимаются в сверхновой, дрожат при заряде луча
    const open = this.heartOpen ? 1 : 0;
    const shake = atk === 'beam' && this.st < 1.8 ? Math.sin(t * 50) * 0.03 * this.st : 0;
    this.facets.forEach((g, i) => {
      const a = (i / 4) * Math.PI * 2, r = 0.46 + open * 0.55 - nova * 0.14 + shake;
      g.position.set(Math.sin(a) * r, CORE_Y, Math.cos(a) * r);
      g.rotation.set(THREE.MathUtils.lerp(g.rotation.x, open * 0.6, 0.15), a, 0);
    });
    // кольца: каждое по своей оси; в нимбе — встают вертикально за ядром и растут
    const rate = sleep ? 0.2 : this.spinK * (1 - nova * 0.5) + nova * 4;
    this.rings.forEach((g, i) => {
      this.ringSpin[i] += dt * rate * (0.7 + i * 0.35) * (i % 2 ? -1 : 1);
      const tilt = [0.35, -0.9, 1.3][i], roll = [0, 0.5, -0.4][i];
      g.rotation.set(THREE.MathUtils.lerp(tilt, Math.PI / 2, this.haloK), this.ringSpin[i], THREE.MathUtils.lerp(roll, 0, this.haloK));
      g.position.set(0, CORE_Y + this.haloK * 0.2, -this.haloK * (0.5 + i * 0.25));
      g.scale.setScalar((1 + this.haloK * (0.4 + i * 0.35)) * (1 - nova * 0.45));
    });
    // сердце: тихо бьётся; оглушена — крупно, сверхновая — раскаляется
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 4)) * 0.1;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.9 : 1) * (1 + nova * 0.4));
    this.heart.rotation.y += dt * 0.8;
    // звёздная пыль
    if (!dead && !sleep && Math.random() < 0.5) {
      const a = rand(0, Math.PI * 2), r = rand(1, 2.4) * (1 + this.haloK * 0.6);
      this.h.fx.particle({ pos: this.core().add(new THREE.Vector3(Math.cos(a) * r, rand(-1.4, 1.4), Math.sin(a) * r)), vel: new THREE.Vector3(0, rand(-0.3, 0.2), 0), life: rand(0.6, 1.2), size: rand(0.05, 0.1), color: Math.random() < 0.55 ? STAR : Math.random() < 0.5 ? GOLD : RASP, gravity: 0 });
    }
  }
}
