import * as THREE from 'three';
import { pixelTex } from '../textures.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';

/**
 * Хозяйка Вечной Зимы — финальная стража (wiki/design-bosses.md, разделы 1–5; схематичный Арх-Иллагер / снежная
 * королева): высокая ледяная волшебница Ордена в ступенчатом платье цвета инея с серебряной каймой, без ног — парит;
 * на голове высокая корона из ледяных шипов и замёрзших ягод, два рукава, ледяной посох; вокруг кружат шесть осколков
 * льда. На груди — замёрзшая ягода-сердце в прозрачном ледяном кубе. Иней светится, переливаясь в малину.
 * Фаза 1: сосульки по меткам у героя (оставляют скользкий лёд), осколки летят по очереди по коротким полосам,
 * стена метели через всю арену (после неё обессилена 2 с), два ледяных голема.
 * Превращение на 50 %: «Вечная зима» — мир меркнет, камера отъезжает, она поднимается выше, на арене метель,
 * осколки вырастают в большие кристаллы. Фаза 2: сосулек вдвое больше, осколки самонаводятся; «Абсолютный ноль»
 * (раз в ~15 с) — огромный купол r 9 вокруг неё растёт 2 с, кто остался внутри — время стоит: вмёрз на 2 с и −25;
 * потом сама опустошена — оглушение 3 с, главное окно урона второй фазы.
 * Роняет мифический «Абсолютный ноль». Подвижных частей: голова (с короной), два рукава, посох, кольцо осколков,
 * сердце; платье — одно тело.
 */

const ICE = C(1.4, 2.8, 4), FROST = C(3, 3.6, 4), PALE = C(0.8, 1.6, 2.6);
const ICE_CSS = '#bfe4ff';
/** «Абсолютный ноль»: радиус купола, рост, время во льду, пауза между */
const ZERO_R = 9, ZERO_GROW = 2, ZERO_FREEZE = 2, ZERO_CD = 15;
/** Высота парения: первая фаза, вторая, в оглушении */
const HOVER = 0.6, HOVER2 = 1.4, HOVER_DAZE = 0.2;

const sfx = {
  /** Сосулька родилась: тонкий звон */
  tink(i: number) { bell(1760 + (i % 3) * 440, 0.4, 0.025, 0, 0.6); },
  /** Сосулька вонзилась: хруст */
  crack() { hiss({ dur: 0.18, vol: 0.12, f: 5000, f1: 1500, q: 0.9, type: 'bandpass' }); boom(140, 70, 0.2, 0.2); },
  /** Осколок сорвался: свист */
  whiz() { hiss({ dur: 0.3, vol: 0.1, f: 6000, f1: 2500, q: 1.2, type: 'bandpass' }); },
  /** Метель: долгий вой ветра */
  gale() { hiss({ dur: 1.2, vol: 0.25, f: 500, f1: 2400, q: 0.5, type: 'bandpass', attack: 0.2, verb: 0.6 }); },
  /** Големы: глухой треск льда */
  golems() { boom(70, 35, 0.6, 0.5); hiss({ dur: 0.5, vol: 0.15, f: 3000, f1: 800, q: 0.7, type: 'bandpass' }); },
  /** Превращение: хор и низкий колокол */
  winter() { bell(98, 3, 0.09, 0, 0.9); for (const [f, d] of [[440, 0], [523, 0.15], [659, 0.3], [880, 0.45]] as const) voice({ type: 'triangle', f, dur: 2, vol: 0.04, delay: d, verb: 0.9 }); },
  /** Купол растёт: гул снизу вверх */
  dome() { voice({ type: 'sawtooth', f: 55, f1: 110, dur: 2, vol: 0.05, lp: 400, lp1: 2400, verb: 0.8 }); hiss({ dur: 2, vol: 0.15, f: 800, f1: 6000, q: 0.6, type: 'bandpass', attack: 1.5, verb: 0.7 }); },
  /** Время встало: звон и сердцебиение */
  zero() {
    for (const [f, d] of [[2637, 0], [3136, 0.04], [3951, 0.08]] as const) bell(f, 1.6, 0.04, d, 0.9);
    for (const d of [0.3, 0.6, 1.3, 1.6, 2.3, 2.6]) boom(58, 38, 0.22, 0.6, d, 0.3);
  },
};

export class WinterMistress extends MiniBoss {
  readonly radius = 1.2;
  readonly title = 'Хозяйка Вечной Зимы';
  override readonly subtitle = 'финальная стража малины';
  override readonly topY = 5;
  readonly drop = 'absolutezero';
  override readonly tier = 'final' as const;
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly staff = new THREE.Group();
  private readonly ring = new THREE.Group();
  private readonly shards: THREE.Mesh[] = [];
  /** Рост осколка 0..1: сорвался — 0, потом отрастает */
  private readonly shardK = [1, 1, 1, 1, 1, 1];
  private readonly heart = new THREE.Group();
  private readonly iceBlock: THREE.Mesh;
  /** Отложенные действия (сосулька падает чуть позже метки) */
  private readonly later: { t: number; fn: () => void }[] = [];
  /** Поколение боя: снаряды прошлого боя после сброса не бьют */
  private gen = 0;
  private pendingWinter = false;
  private ringK = 1;
  private zeroCd = 99;
  private wallCd = 6;
  private guardsCd = 10;
  private freezeT = 0;
  private readonly freezeAt = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 3200, home, yaw, arena);
    this.speed = 2.4;
    this.keep = 7;
    this.turn = 2.4;
    this.iceBlock = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 1.3), glowMat(ICE.clone().multiplyScalar(0.5), 0.4));
    this.iceBlock.visible = false;
    h.scene.add(this.iceBlock);
    this.build();
    this.reset();
  }

  protected build(): void {
    const gown = this.lam('#cfe6f4', pixelTex('#cfe6f4', 8, 913));
    const deep = this.lam('#7fa8c8', pixelTex('#7fa8c8', 10, 914));
    const silver = this.lam('#dfe6ee');
    const skin = this.lam('#e4eef6');
    const frost = this.shimmer(ICE, RASP, 0, 1.4);
    const spike = this.shimmer(FROST, ICE, 1, 2);
    const heartM = this.shimmer(RASP, C(4, 1.7, 2.4), 0, 3);
    const clear = glowMat(PALE.clone().multiplyScalar(0.5), 0.35, true);
    const B = this.box.bind(this);
    // платье: пять ступеней, уже кверху; внизу — тёмный иней, по краю каждой — серебро
    const tiers = [[2.0, 0.5, 0.25], [1.7, 0.5, 0.75], [1.4, 0.55, 1.27], [1.12, 0.55, 1.8], [0.9, 0.55, 2.32]] as const;
    tiers.forEach(([w, hh, y], i) => {
      B(this.body, i < 2 ? deep : gown, w, hh, w * 0.85, 0, y, 0);
      B(this.body, silver, w + 0.04, 0.07, w * 0.85 + 0.04, 0, y - hh / 2 + 0.04, 0);
    });
    // светящиеся узоры инея по подолу
    for (const s of [-1, 1]) B(this.body, frost, 0.08, 1.4, 0.06, s * 0.45, 0.9, 0.82);
    B(this.body, silver, 1.0, 0.12, 0.85, 0, 2.62, 0);
    // сердце: замёрзшая ягода в прозрачном ледяном кубе
    this.heart.position.set(0, 2.2, 0.45);
    this.body.add(this.heart);
    for (const [x, y, z, k] of [[0, 0, 0, 0.22], [0.12, 0.06, 0, 0.14], [-0.12, 0.06, 0, 0.14], [0, 0.06, 0.11, 0.14], [0, -0.09, 0.04, 0.14]] as const) B(this.heart, heartM, k, k, k, x, y, z);
    B(this.heart, clear, 0.46, 0.46, 0.4, 0, 0.02, 0);
    // голова, высокий ворот и корона: ледяные шипы через один с замёрзшими ягодами
    this.head.position.set(0, 2.7, 0);
    this.body.add(this.head);
    B(this.head, deep, 0.85, 0.5, 0.25, 0, 0.35, -0.3);
    B(this.head, skin, 0.5, 0.52, 0.48, 0, 0.32, 0);
    B(this.head, glowMat(ICE), 0.32, 0.06, 0.04, 0, 0.36, 0.25);
    B(this.head, silver, 0.56, 0.08, 0.54, 0, 0.62, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, big = i % 2 === 0, tall = i === 0 || i === 4 || i === 6;
      if (big) B(this.head, spike, 0.1, tall ? 0.75 : 0.45, 0.1, Math.sin(a) * 0.28, tall ? 1.02 : 0.86, Math.cos(a) * 0.28);
      else B(this.head, heartM, 0.12, 0.12, 0.12, Math.sin(a) * 0.3, 0.72, Math.cos(a) * 0.3);
    }
    // рукава-колокола; манжеты — серебро с инеем
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.62, 2.5, 0);
      this.body.add(g);
      B(g, gown, 0.32, 0.9, 0.34, 0, -0.42, 0);
      B(g, deep, 0.46, 0.32, 0.48, 0, -0.86, 0);
      B(g, frost, 0.48, 0.06, 0.5, 0, -1.02, 0);
      this.arms.push(g);
    }
    // ледяной посох: древко-сосулька, наверху — кристалл
    this.staff.position.set(-0.78, 1.5, 0.3);
    this.body.add(this.staff);
    B(this.staff, silver, 0.1, 2.8, 0.1, 0, 0.3, 0);
    B(this.staff, spike, 0.3, 0.55, 0.3, 0, 1.95, 0, 0, Math.PI / 4, 0);
    B(this.staff, frost, 0.16, 0.16, 0.16, 0, 2.35, 0);
    // кольцо из шести осколков: одна группа, кружит вокруг
    this.ring.position.y = 1.8;
    this.body.add(this.ring);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const m = B(this.ring, i % 2 ? spike : frost, 0.22, 0.6, 0.22, Math.sin(a) * 1.7, 0, Math.cos(a) * 1.7, 0, 0, 0.3);
      this.shards.push(m);
    }
  }

  override reset(): void {
    super.reset();
    this.gen++;
    this.later.length = 0;
    this.unfreeze(false);
    this.pendingWinter = false;
    this.ringK = 1; this.zeroCd = 99; this.wallCd = 6; this.guardsCd = 10;
    this.shardK.fill(1);
    this.body.position.y = HOVER;
  }

  protected override die(): void {
    super.die();
    this.gen++;
    this.later.length = 0;
    this.pendingWinter = false;
    this.unfreeze(true);
  }

  /** Превращение: сразу, если не оглушена; иначе — первым делом после оглушения */
  protected override onEnrage(): void {
    this.zeroCd = 3;
    if (this.state === 'daze' || this.state === 'dead') this.pendingWinter = true;
    else this.go('attack', 'winter');
  }

  protected choose(): string | null {
    if (this.pendingWinter) { this.pendingWinter = false; return 'winter'; }
    if (this.enraged && this.zeroCd <= 0) return 'zero';
    if (this.guardsCd <= 0 && this.minions.length === 0) return 'guards';
    if (this.wallCd <= 0) return 'wall';
    return Math.random() < 0.5 ? 'icicles' : 'shards';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    const once = !this.hitDone;
    this.hitDone = true;
    switch (name) {
      case 'icicles': {
        // посох вверх — метки у героя (первая — под ним), сосульки падают одна за другой
        if (once) {
          const n = this.enraged ? 12 : 6;
          for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2), r = i === 0 ? 0 : rand(1.4, this.enraged ? 6 : 4.5);
            this.icicle(this.clampIn(this.heroAt().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), 1), 1.0 + i * 0.1, 1.3, i);
          }
        }
        return t > 1.3 + (this.enraged ? 1.2 : 0.6);
      }
      case 'shards': {
        // осколки срываются с кольца по одному; на второй фазе — самонаводятся
        if (once) this.face(1, 9);
        for (let i = 0; i < 6; i++) {
          const at = 0.3 + i * 0.28;
          if (t >= at && t - dt < at) this.launch(i);
        }
        return t > 2.6;
      }
      case 'wall': {
        // стена метели: полоса через всю арену сквозь героя, потом снег несётся по ней; после — обессилена
        if (once) {
          this.wallCd = rand(9, 12);
          this.aim.copy(this.heroAt()).sub(this.pos).setY(0);
          if (this.aim.lengthSq() < 1e-4) this.aim.copy(this.fwd());
          this.aim.normalize();
          this.yaw = Math.atan2(this.aim.x, this.aim.z);
          const from = this.pos.clone().setY(0).addScaledVector(this.aim, -2), dir = this.aim.clone(), g = this.gen;
          this.markLine(from, dir, 30, 3, 1.1, () => { if (g === this.gen) this.blizzard(from, dir); }, ICE);
        }
        if (t < 1.9) return false;
        this.daze(2);
        return true;
      }
      case 'guards': {
        // два ледяных голема встают изо льда по бокам
        if (once) { this.guardsCd = 20; if (!this.quiet) sfx.golems(); }
        for (let i = 0; i < 2; i++) {
          const at = 0.5 + i * 0.3;
          if (t >= at && t - dt < at) {
            const a = this.yaw + (i ? 1 : -1) * 1.2;
            this.summon(this.pos.clone().add(new THREE.Vector3(Math.sin(a) * 2.8, 0, Math.cos(a) * 2.8)), { body: '#bcd8ec', head: '#7fa8c8', eye: ICE, size: 1.3, hp: 60, dmg: 10, speed: 1.6 });
          }
        }
        return t > 1.3;
      }
      case 'winter': {
        // превращение: название, мир меркнет, камера отъезжает; она поднимается, осколки растут в кристаллы
        if (once) {
          fx.title('Вечная зима', ICE_CSS);
          fx.darken(1.8);
          fx.zoom = Math.max(fx.zoom, 0.35);
          fx.shake = Math.max(fx.shake, 0.8);
          fx.screenFlash(ICE_CSS, 0.4, 0.5);
          fx.shock(this.pos.clone().setY(0.1), 8, ICE, 0.8, 0.25);
          if (!this.quiet) sfx.winter();
        }
        this.ringK = Math.min(1.8, this.ringK + dt * 0.6);
        if (Math.random() < 0.8) fx.burst(this.pos.clone().setY(this.body.position.y + 2.5), [FROST, ICE, RASP], 3, { speed: 4, up: 2, size: 0.1, life: 0.8, glow: true, gravity: 0 });
        return t > 2;
      }
      case 'zero': {
        // абсолютный ноль: купол растёт 2 с — уйти из-под него; внутри время встаёт; потом она опустошена
        if (once) {
          this.zeroCd = ZERO_CD;
          const c = this.pos.clone().setY(0), g = this.gen;
          this.markCircle(c, ZERO_R, ZERO_GROW, () => { if (g === this.gen) this.zero(c); }, ICE);
          this.dome(c);
          if (!this.quiet) sfx.dome();
        }
        if (t < ZERO_GROW + 0.5) return false;
        this.daze(3);
        return true;
      }
    }
    return true;
  }

  /** Метка, а под конец — сосулька сверху: урон 16, на месте — скользкий лёд (замедляет) */
  private icicle(at: THREE.Vector3, dur: number, r: number, i: number): void {
    const g = this.gen;
    this.markCircle(at, r, dur, () => {
      if (g !== this.gen) return;
      const fx = this.h.fx;
      fx.burst(at.clone().setY(0.4), [FROST, ICE, RASP], 10, { speed: 3, up: 3, size: 0.1, life: 0.5, glow: true, gravity: 8 });
      fx.shock(at.clone().setY(0.08), r, ICE.clone().multiplyScalar(0.6), 0.3, 0.12);
      if (!this.quiet && i % 3 === 0) sfx.crack();
      if (this.inCircle(at, r)) this.hurt(16, at, 3);
      this.hazard(at, r, 4, 0, PALE, 0.4);
    }, ICE);
    this.later.push({ t: dur - 0.3, fn: () => {
      const m = new THREE.Mesh(UNIT, glowMat(i % 4 === 3 ? RASP : FROST));
      m.scale.set(0.3, 1.1, 0.3);
      this.lob(m, at.clone().add(new THREE.Vector3(0, 12, 0)), at, 0.3, 0, ICE, () => undefined);
      if (!this.quiet && i % 3 === 0) sfx.tink(i);
    } });
  }

  /** Осколок i срывается с кольца: по полосе (фаза 1) или вдогонку (фаза 2); урон 12 */
  private launch(i: number): void {
    if (this.shardK[i] < 0.5) return;
    this.shardK[i] = 0;
    const from = this.shards[i].getWorldPosition(new THREE.Vector3());
    if (!this.quiet) sfx.whiz();
    const g = this.gen, fx = this.h.fx, size = this.enraged ? 0.4 : 0.26;
    const mat = glowMat(i % 2 ? FROST : ICE), grp = new THREE.Group();
    this.box(grp, mat, size, size * 2.6, size, 0, 0, 0, Math.PI / 2, 0, 0);
    if (!this.enraged) {
      // полоса от неё к герою; осколок летит по полосе
      const ground = from.clone().setY(0), dir = this.heroAt().sub(ground);
      if (dir.lengthSq() < 1e-4) dir.copy(this.fwd());
      dir.normalize();
      this.markLine(ground, dir, 10, 1, 0.5, () => {
        if (g !== this.gen) { mat.dispose(); return; }
        grp.rotation.y = Math.atan2(dir.x, dir.z);
        fx.custom(grp, 0.35, (k) => {
          grp.position.copy(ground).addScaledVector(dir, 10 * k).setY(1);
          if (Math.random() < 0.6) fx.particle({ pos: grp.position.clone(), vel: new THREE.Vector3(0, rand(0, 0.5), 0), life: 0.3, size: 0.08, color: ICE, gravity: 0 });
        }, () => mat.dispose());
        if (this.inLine(ground, dir, 10, 1)) this.hurt(12, ground, 3);
      }, ICE);
      return;
    }
    // самонаводящийся кристалл: летит к герою, сворачивает за ним, бьёт при касании
    const p = from.clone(), v = new THREE.Vector3(0, 3, 0), dur = 2.2;
    let last = 0, done = false;
    fx.custom(grp, dur, (k) => {
      const dt = (k - last) * dur;
      last = k;
      if (done || g !== this.gen) { grp.visible = false; return; }
      const hero = this.h.hero.pos, want = new THREE.Vector3(hero.x, 1, hero.z).sub(p);
      const d = want.length();
      if (d < 0.8) {
        done = true; grp.visible = false;
        this.hurt(12, p, 3);
        fx.burst(p.clone(), [FROST, ICE], 8, { speed: 3, up: 2, size: 0.1, life: 0.4, glow: true, gravity: 6 });
        return;
      }
      v.lerp(want.multiplyScalar(9 / Math.max(d, 1e-3)), Math.min(1, dt * 2.5));
      p.addScaledVector(v, dt);
      grp.position.copy(p);
      grp.lookAt(p.clone().add(v));
      if (Math.random() < 0.6) fx.particle({ pos: p.clone(), vel: new THREE.Vector3(0, 0.3, 0), life: 0.3, size: 0.09, color: Math.random() < 0.7 ? ICE : RASP, gravity: 0 });
    }, () => mat.dispose());
  }

  /** Стена метели несётся по полосе: урон 18, отброс 8 */
  private blizzard(from: THREE.Vector3, dir: THREE.Vector3): void {
    const fx = this.h.fx;
    if (!this.quiet) sfx.gale();
    const mat = glowMat(FROST.clone().multiplyScalar(0.5), 0.55, true), core = glowMat(ICE.clone().multiplyScalar(0.4), 0.5, true), g = new THREE.Group();
    this.box(g, mat, 3.2, 2.6, 0.9, 0, 1.3, 0);
    this.box(g, core, 2.4, 1.6, 1.4, 0, 0.8, 0);
    g.rotation.y = Math.atan2(dir.x, dir.z);
    fx.custom(g, 0.8, (k) => {
      g.position.copy(from).addScaledVector(dir, 30 * k);
      for (let j = 0; j < 3; j++) fx.particle({ pos: g.position.clone().add(new THREE.Vector3(rand(-1.5, 1.5), rand(0.2, 2.6), rand(-1.5, 1.5))), vel: dir.clone().multiplyScalar(rand(4, 8)).setY(rand(-0.5, 0.5)), life: 0.5, size: rand(0.06, 0.14), color: Math.random() < 0.8 ? FROST : ICE, gravity: 0 });
    }, () => { mat.dispose(); core.dispose(); });
    fx.shake = Math.max(fx.shake, 0.4);
    if (this.inLine(from, dir, 30, 3)) this.hurt(18, from, 8);
  }

  /** Купол над меткой: прозрачная полусфера растёт за время налива */
  private dome(c: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(ZERO_R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = glowMat(ICE.clone().multiplyScalar(0.25), 0.2, true);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(c);
    this.h.fx.custom(m, ZERO_GROW, (k) => {
      m.scale.set(0.2 + 0.8 * k, (0.2 + 0.8 * k) * 0.6, 0.2 + 0.8 * k);
      mat.opacity = 0.12 + k * 0.2 + (k > 0.7 ? Math.sin(k * 80) * 0.05 : 0);
    }, () => { geo.dispose(); mat.dispose(); });
  }

  /** Время встало: мир выцветает; кто под куполом — вмёрз на 2 с и −25 */
  private zero(c: THREE.Vector3): void {
    const fx = this.h.fx;
    fx.darken(ZERO_FREEZE + 0.4);
    fx.screenFlash('#dff2ff', 0.5, 0.6);
    fx.shock(c.clone().setY(0.1), ZERO_R, FROST, 0.6, 0.3);
    fx.burst(c.clone().setY(1), [FROST, ICE, RASP], 40, { speed: 9, up: 3, size: 0.14, life: 1, glow: true, gravity: 2 });
    fx.shake = Math.max(fx.shake, 0.7);
    if (!this.quiet) sfx.zero();
    if (this.inCircle(c, ZERO_R)) { this.hurt(25, c, 0); this.freeze(ZERO_FREEZE); }
  }

  private freeze(sec: number): void {
    this.freezeT = sec;
    this.freezeAt.copy(this.h.hero.pos);
    this.iceBlock.visible = true;
    this.h.fx.text(this.freezeAt.clone().setY(2.6), 'время встало', 'crit');
  }

  private unfreeze(shatter: boolean): void {
    if (shatter && this.freezeT > 0) {
      this.h.fx.burst(this.freezeAt.clone().setY(1), [FROST, ICE, PALE], 20, { speed: 4, up: 4, size: 0.14, life: 0.8, gravity: 12 });
      if (!this.quiet) bell(2093, 0.6, 0.04, 0, 0.6);
    }
    this.freezeT = 0;
    this.iceBlock.visible = false;
  }

  override update(dt: number): void {
    super.update(dt);
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      l.t -= dt;
      if (l.t <= 0) { this.later.splice(i, 1); l.fn(); }
    }
    // метель второй фазы: снег по всей арене
    if (this.enraged && this.awake && !this.dead) {
      const a = this.arena;
      for (let j = 0; j < 3; j++) this.h.fx.particle({ pos: new THREE.Vector3(rand(a.x0, a.x1), rand(3, 7), rand(a.z0, a.z1)), vel: new THREE.Vector3(rand(1.5, 3), rand(-2.5, -1.2), rand(-0.6, 0.6)), life: rand(1.5, 2.5), size: rand(0.05, 0.1), color: Math.random() < 0.85 ? FROST : ICE, gravity: 0 });
    }
    if (this.freezeT <= 0) return;
    // вмёрзший герой стоит, где застал ноль
    this.freezeT -= dt;
    const hero = this.h.hero;
    hero.pos.copy(this.freezeAt);
    hero.vel.set(0, 0, 0);
    this.iceBlock.position.set(this.freezeAt.x, this.freezeAt.y + 1, this.freezeAt.z);
    this.iceBlock.rotation.y = 0.3;
    if (this.freezeT <= 0) this.unfreeze(true);
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, dead = this.state === 'dead', daze = this.state === 'daze';
    if (this.awake && this.state !== 'attack') { this.zeroCd -= dt; this.wallCd -= dt; this.guardsCd -= dt; }
    const atk = this.state === 'attack' ? this.attack : '';
    // парит; во второй фазе выше, в оглушении оседает к полу
    if (!dead) {
      const y = daze ? HOVER_DAZE : this.enraged ? HOVER2 : HOVER;
      this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, y + Math.sin(t * 1.2) * 0.15, atk === 'winter' ? 0.03 : 0.08);
      this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, daze ? 0.25 : walk ? 0.08 : atk === 'zero' ? -0.15 : 0, 0.1);
    }
    // голова: поникла во сне и в оглушении, на куполе и превращении — запрокинута
    this.head.rotation.x = this.state === 'sleep' || daze ? 0.4 : atk === 'zero' || atk === 'winter' ? -0.4 : Math.sin(t * 0.8) * 0.05;
    // рукава: сосульки и превращение — воздеты, купол — разведены, метель — правый вперёд, големы — вниз
    const up = atk === 'icicles' || atk === 'winter';
    this.arms.forEach((g, i) => {
      const s = i ? 1 : -1, right = i === 0;
      const rx = up ? -2.6 + Math.sin(S * 6 + i) * 0.15 : atk === 'zero' ? -1.4 : atk === 'wall' && right ? (S < 0.8 ? -0.5 : -1.5) : atk === 'shards' ? -1.2 : atk === 'guards' ? -0.6 : daze ? 0.15 : -0.2;
      g.rotation.set(rx, 0, s * (atk === 'zero' ? 1.0 : atk === 'guards' ? 0.6 : 0.12));
    });
    // посох: на стене — выпад вперёд, на сосульках — вскинут, в оглушении — опущен
    const srx = atk === 'wall' ? (S < 0.8 ? -0.3 : 1.2) : up || atk === 'zero' ? -0.2 : daze ? 0.6 : 0.08;
    this.staff.rotation.x = THREE.MathUtils.lerp(this.staff.rotation.x, srx, 0.2);
    this.staff.position.y = THREE.MathUtils.lerp(this.staff.position.y, up || atk === 'zero' ? 2.1 : 1.5, 0.15);
    // кольцо осколков: кружит, на куполе — быстро; сорванные отрастают, во второй фазе — большие кристаллы
    this.ring.rotation.y += dt * (atk === 'zero' ? 4 : daze ? 0.3 : 1.1);
    if (atk !== 'winter') this.ringK = THREE.MathUtils.lerp(this.ringK, this.enraged ? 1.8 : 1, 0.05);
    this.ring.scale.set(1 + (this.ringK - 1) * 0.35, 1, 1 + (this.ringK - 1) * 0.35);
    this.shards.forEach((m, i) => {
      if (atk !== 'shards') this.shardK[i] = Math.min(1, this.shardK[i] + dt * 0.6);
      m.visible = this.shardK[i] > 0.05 && !dead;
      const k = this.shardK[i] * this.ringK;
      m.scale.set(0.22 * k, 0.6 * k, 0.22 * k);
      m.position.y = Math.sin(t * 2 + i) * 0.15;
    });
    // сердце: тихо бьётся, опустошена — крупно
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 4)) * 0.1;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.9 : 1));
    // снежинки вокруг
    if (!dead && this.state !== 'sleep' && Math.random() < 0.45) {
      const a = rand(0, Math.PI * 2), r = rand(0.8, 2.2);
      this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(0.8, 4) + this.body.position.y, Math.sin(a) * r)), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(-0.4, -0.1), rand(-0.2, 0.2)), life: rand(0.6, 1.2), size: rand(0.05, 0.1), color: Math.random() < 0.7 ? FROST : Math.random() < 0.6 ? ICE : RASP, gravity: 0 });
    }
  }
}
