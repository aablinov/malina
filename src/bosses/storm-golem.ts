import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';

/**
 * Грозовой голем — мини-босс (wiki/design-bosses.md, раздел 2): глыба камня в позеленевшей меди, голова утоплена между
 * плеч, длинные руки кончаются медными кулаками-громоотводами. На голове — корона из кубиков-костянок, в груди —
 * сердце-ягода за медной решёткой. Шаркает к герою. Атаки: копьё молнии по линии (после него может перегреться —
 * оглушён, сердце открыто), удар двумя кулаками в землю, громоотводы вокруг героя — в каждый бьёт молния с неба.
 * Роняет «Копьё громовержца». Подвижных частей: торс, голова, две руки, две ноги.
 */

const SPARK = C(2.4, 3.4, 4), WHITE = C(3.6, 3.8, 4), PINK = C(4, 1.7, 2.4);
const STONE = '#8a8a90', DARK = '#4a4a52', PATINA = '#5fa08a';
const DUST = ['#8a8a90', '#6a6a70', '#5fa08a'];

const sfx = {
  /** Треск заряда: короткие пилообразные щелчки */
  crackle() { for (let i = 0; i < 3; i++) hiss({ dur: 0.05, vol: 0.06, f: rand(2500, 6000), q: 3, delay: i * rand(0.03, 0.07) }); },
  /** Гул набора заряда: нарастающий писк */
  charge() { voice({ type: 'sawtooth', f: 110, f1: 880, dur: 0.9, vol: 0.04, lp: 900, lp1: 4000, verb: 0.4 }); },
  /** Удар молнии: хлопок, шипение и раскат */
  thunder() {
    hiss({ dur: 0.25, vol: 0.35, f: 5000, f1: 800, q: 0.5, type: 'highpass' });
    boom(90, 25, 1.4, 0.8, 0.05, 0.7);
    hiss({ dur: 1.2, vol: 0.18, f: 600, f1: 120, q: 0.6, type: 'lowpass', delay: 0.1, verb: 0.7 });
  },
  /** Медь звенит: громоотвод воткнулся */
  ping() { bell(rand(700, 900), 0.6, 0.05); },
  /** Каменный удар об пол */
  slam() { boom(60, 22, 1.1, 0.9, 0, 0.5); hiss({ dur: 0.6, vol: 0.2, f: 900, f1: 150, q: 0.5, type: 'lowpass' }); },
  /** Перегрев: пар и треск */
  overheat() { hiss({ dur: 1.4, vol: 0.2, f: 3000, f1: 600, q: 0.4, type: 'highpass', attack: 0.05, verb: 0.4 }); bell(330, 1.2, 0.04); },
};

export class StormGolem extends MiniBoss {
  readonly radius = 1.3;
  readonly title = 'Грозовой голем';
  override readonly topY = 3.2;
  readonly drop = 'thunderspear';
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly legs: THREE.Group[] = [];
  /** Кончики громоотводов (для искр и начала молнии) */
  private readonly tips: THREE.Mesh[] = [];
  private readonly heart = new THREE.Group();
  private stepT = 0;
  /** Перегрев копьями: третье копьё без отдыха — оглушение наверняка */
  private heat = 0;
  private readonly aim = new THREE.Vector3();
  private readonly slamAt = new THREE.Vector3();

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 900, home, yaw, arena);
    this.speed = 2.2;
    this.keep = 3.5;
    this.build();
    this.reset();
  }

  protected build(): void {
    const stone = this.lam(STONE, pixelTex(STONE, 10, 611));
    const dark = this.lam(DARK, pixelTex(DARK, 8, 612));
    const copper = this.lam(PATINA, pixelTex(PATINA, 12, 613));
    const glow = this.shimmer(SPARK, RASP, 0, 2.2);
    const heartMat = this.shimmer(RASP, PINK, 0, 3);
    const B = this.box.bind(this);
    // ноги: короткие блоки, шаркают
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.55, 0.75, 0);
      this.body.add(g);
      B(g, dark, 0.7, 0.75, 0.8, 0, -0.38, 0);
      B(g, copper, 0.8, 0.14, 0.9, 0, -0.68, 0.05);
      this.legs.push(g);
    }
    // торс: большая глыба, медный пояс и плечи, решётка на груди — за ней сердце-ягода
    this.torso.position.y = 0.75;
    this.body.add(this.torso);
    B(this.torso, stone, 2.0, 1.7, 1.3, 0, 0.9, 0);
    B(this.torso, copper, 2.1, 0.2, 1.4, 0, 0.15, 0);
    B(this.torso, copper, 2.3, 0.35, 1.2, 0, 1.75, 0);
    B(this.torso, dark, 0.9, 0.8, 0.12, 0, 1.0, 0.64);
    this.heart.position.set(0, 1.0, 0.68);
    this.torso.add(this.heart);
    for (const [x, y, k] of [[0, 0, 0.32], [0.2, 0.18, 0.2], [-0.2, 0.18, 0.2], [0.2, -0.18, 0.2], [-0.2, -0.18, 0.2], [0, 0.34, 0.16], [0, -0.34, 0.16]] as const) B(this.heart, heartMat, k, k, 0.1, x, y, 0);
    for (const x of [-0.25, 0.25]) B(this.torso, copper, 0.07, 0.8, 0.08, x, 1.0, 0.74);
    // голова: утоплена между плеч, щель глаз светится, сверху — корона из костянок
    this.head.position.set(0, 2.55, 0.15);
    this.body.add(this.head);
    B(this.head, stone, 0.8, 0.6, 0.75, 0, 0.2, 0);
    B(this.head, glow, 0.55, 0.1, 0.06, 0, 0.25, 0.39);
    for (const [x, z] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28], [0, 0]] as const) B(this.head, heartMat, 0.16, 0.16, 0.16, x, 0.58 + (x === 0 ? 0.08 : 0), z);
    // руки: длинные, кулак из меди, из кулака торчит светящийся громоотвод
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 1.3, 2.35, 0);
      this.body.add(g);
      B(g, stone, 0.55, 1.4, 0.55, 0, -0.65, 0);
      B(g, copper, 0.75, 0.7, 0.75, 0, -1.6, 0);
      this.tips.push(B(g, glow, 0.12, 0.6, 0.12, 0, -2.15, 0));
      this.arms.push(g);
    }
  }

  protected choose(dist: number): string | null {
    if (dist < 4) return rnd() < 0.8 ? 'slam' : 'spear';
    if (dist > 5 && rnd() < 0.38) return 'rods';
    return 'spear';
  }

  /** Ломаная молния из a в b: тонкие светящиеся бруски с ореолом, гаснут за dur */
  private bolt(a: THREE.Vector3, b: THREE.Vector3, segs: number, jag: number, w: number, dur = 0.28): void {
    const g = new THREE.Group();
    const core = glowMat(WHITE, 1, true), halo = glowMat(SPARK.clone().lerp(RASP, rnd() * 0.4), 0.4, true);
    let prev = a.clone();
    for (let i = 1; i <= segs; i++) {
      const p = i === segs ? b.clone() : a.clone().lerp(b, i / segs).add(new THREE.Vector3(rand(-jag, jag), rand(-jag, jag) * 0.5, rand(-jag, jag)));
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
    this.h.fx.custom(g, dur, (k) => { const f = (1 - k) * (0.6 + rnd() * 0.4); core.opacity = f; halo.opacity = f * 0.4; }, () => { core.dispose(); halo.dispose(); });
  }

  /** Мировая позиция кончика громоотвода */
  private tip(i: number): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.tips[i].getWorldPosition(new THREE.Vector3());
  }

  /** Искры собираются к кончику громоотвода */
  private sparkle(i: number, n = 1): void {
    const p = this.tip(i);
    for (let j = 0; j < n; j++) {
      const o = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.8);
      this.h.fx.particle({ pos: p.clone().add(o), vel: o.multiplyScalar(-2.5), life: 0.3, size: rand(0.05, 0.1), color: rnd() < 0.7 ? SPARK : RASP, gravity: 0 });
    }
  }

  /** Молния с неба в точку: удар, кольцо, свет */
  private strike(at: THREE.Vector3, r: number, dmg: number): void {
    const fx = this.h.fx, top = at.clone().setY(13);
    this.bolt(top, at.clone().setY(0.05), 7, 0.7, 0.12);
    this.bolt(top.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1))), at.clone().setY(0.05), 5, 0.9, 0.06, 0.18);
    fx.flash(at.clone().setY(0.6), WHITE, 3.5, 0.25);
    fx.light(at.clone().setY(2), SPARK, 6, 12, 0.3);
    fx.shock(at.clone().setY(0.08), r + 0.3, SPARK, 0.35, 0.14);
    fx.burst(at.clone().setY(0.3), [SPARK, WHITE, RASP], 14, { speed: 5, up: 4, size: 0.08, life: 0.5, glow: true, gravity: 8 });
    fx.shake = Math.max(fx.shake, 0.35);
    if (!this.quiet) sfx.thunder();
    if (this.inCircle(at, r)) this.hurt(dmg, at, 4);
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'spear': {
        // поднял правую руку, искры сбегаются к громоотводу; полоса на полу — и молния по ней
        const AIM = 0.3, FIRE = 0.9;
        if (t < AIM) { this.face(dt, 1.5); }
        if (!this.hitDone && t >= AIM) {
          this.hitDone = true;
          this.aim.copy(this.fwd());
          const from = this.pos.clone().setY(0);
          this.markLine(from, this.aim, 16, 1.4, FIRE - AIM, () => {
            const a = this.tip(1), b = from.clone().addScaledVector(this.aim, 16).setY(1);
            this.bolt(a, b, 8, 0.6, 0.14);
            this.bolt(a, b, 6, 0.9, 0.06, 0.2);
            fx.flash(a, WHITE, 2.5, 0.2);
            fx.light(from.clone().addScaledVector(this.aim, 6).setY(1.5), SPARK, 6, 14, 0.35);
            fx.screenFlash('#cfe8ff', 0.2, 0.15);
            for (let i = 0; i < 6; i++) fx.burst(from.clone().addScaledVector(this.aim, 2 + i * 2.4).setY(0.3), [SPARK, WHITE], 3, { speed: 3, up: 2, size: 0.07, life: 0.35, glow: true, gravity: 6 });
            if (!this.quiet) sfx.thunder();
            if (this.inLine(from, this.aim, 16, 1.4)) this.hurt(22, from, 6);
          }, SPARK.clone().lerp(RASP, 0.3));
          if (!this.quiet) sfx.charge();
        }
        if (t < FIRE) { this.sparkle(1, 2); if (rnd() < 0.15 && !this.quiet) sfx.crackle(); return false; }
        if (t < FIRE + 0.5) return false;
        // перегрев: 30 % (в ярости 50 %), третье копьё подряд — наверняка
        this.heat++;
        if (rnd() < (this.enraged ? 0.5 : 0.3) || this.heat >= 3) {
          this.heat = 0;
          if (!this.quiet) sfx.overheat();
          fx.text(this.pos.clone().setY(this.topY + 0.8), 'перегрев!', 'crit');
          fx.burst(this.pos.clone().setY(2.6), ['#6a6a70', '#9a9aa0', '#4a4a52'], 18, { speed: 1.5, up: 3, size: 0.25, life: 1.4, gravity: -1 });
          this.daze(1.8);
        }
        return true;
      }
      case 'slam': {
        // оба кулака вверх — и вниз, круг перед грудью
        if (!this.hitDone) {
          this.hitDone = true;
          this.slamAt.copy(this.pos).setY(0).addScaledVector(this.fwd(), 1.4);
          this.markCircle(this.slamAt, 3.2, 0.7, () => {
            if (!this.quiet) sfx.slam();
            fx.shake = Math.max(fx.shake, 0.8);
            fx.hitstop = Math.max(fx.hitstop, 0.05);
            fx.shock(this.slamAt.clone().setY(0.08), 3.6, SPARK, 0.4, 0.22);
            fx.burst(this.slamAt.clone().setY(0.3), DUST, 20, { speed: 5, up: 4, size: 0.16, life: 0.9, gravity: 12 });
            fx.burst(this.slamAt.clone().setY(0.5), [SPARK, RASP], 12, { speed: 4, up: 3, size: 0.08, life: 0.5, glow: true, gravity: 6 });
            if (this.inCircle(this.slamAt, 3.2)) this.hurt(18, this.slamAt, 8);
          });
        }
        return t > 1.2;
      }
      case 'rods': {
        // бросает громоотводы к герою; воткнулись, звенят — и в каждый бьёт молния с неба
        const n = this.enraged ? 5 : 3, WAIT = 1.25, FLY = 0.55;
        for (let i = 0; i < n; i++) {
          const at = 0.35 + i * 0.16;
          if (t >= at && t - dt < at) {
            const to = this.clampIn(this.heroAt().add(new THREE.Vector3(rand(-2.5, 2.5), 0, rand(-2.5, 2.5)).multiplyScalar(i === 0 ? 0 : 1)));
            this.markCircle(to, 1.8, WAIT, () => this.strike(to, 1.8, 14), SPARK.clone().lerp(RASP, 0.3));
            const rod = new THREE.Group();
            rod.add(new THREE.Mesh(UNIT, new THREE.MeshLambertMaterial({ color: PATINA })));
            rod.children[0].scale.set(0.14, 1.1, 0.14);
            this.lob(rod, this.tip(i % 2), to, FLY, 3, SPARK, (p) => {
              if (!this.quiet) sfx.ping();
              const planted = new THREE.Group(), cm = new THREE.MeshLambertMaterial({ color: PATINA }), gm = glowMat(SPARK);
              const pole = new THREE.Mesh(UNIT, cm); pole.scale.set(0.14, 1.2, 0.14); pole.position.y = 0.6;
              const cap = new THREE.Mesh(UNIT, gm); cap.scale.setScalar(0.22); cap.position.y = 1.25;
              planted.add(pole, cap);
              planted.position.copy(p).setY(0);
              fx.custom(planted, WAIT - FLY, (k) => {
                gm.color.copy(SPARK).lerp(RASP, rnd() * k).multiplyScalar(0.6 + rnd() * k);
                if (rnd() < 0.3) fx.particle({ pos: p.clone().setY(1.3), vel: new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1, 1)), life: 0.2, size: 0.06, color: SPARK, gravity: 0 });
              }, () => { cm.dispose(); gm.dispose(); });
            });
          }
        }
        if (t < 0.35 + n * 0.16) { this.sparkle(0); this.sparkle(1); }
        return t > 0.35 + n * 0.16 + WAIT;
      }
    }
    return true;
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, st = this.state, atk = st === 'attack' ? this.attack : '';
    if (st === 'dead') return;
    // ходьба — шарканье: ноги по очереди, тело перекатывается с боку на бок; на шаге — гул и пыль
    let lean = 0;
    if (walk) {
      const was = this.stepT % 1;
      this.stepT += dt * 1.6 * this.speedK;
      const k = this.stepT % 1, ph = this.stepT * Math.PI * 2;
      this.legs.forEach((g, i) => { g.rotation.x = Math.sin(ph + i * Math.PI) * 0.35; });
      this.body.rotation.z = Math.sin(ph) * 0.06;
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.12;
      lean = 0.1;
      if ((was < 0.5 && k >= 0.5) || k < was) {
        if (!this.quiet) boom(55, 25, 0.3, 0.3);
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.12);
        this.h.fx.burst(this.pos.clone().setY(0.1), DUST, 5, { speed: 1.4, up: 0.8, size: 0.1, life: 0.5, gravity: 6 });
      }
    } else {
      this.legs.forEach((g) => { g.rotation.x *= 0.8; });
      this.body.rotation.z *= 0.85;
      this.body.position.y *= 0.8;
    }
    // руки: качаются; копьё — правая вверх; удар — обе вверх, потом вниз; громоотводы — бросок по очереди
    let ax = [Math.sin(t * 1.5) * 0.12, -Math.sin(t * 1.5) * 0.12];
    let sq = 1;
    if (walk) ax = [-Math.sin(this.stepT * Math.PI * 2) * 0.3, Math.sin(this.stepT * Math.PI * 2) * 0.3];
    if (st === 'sleep') { ax = [0.15, 0.15]; lean = 0.3; }
    if (atk === 'spear') { ax = [0.2, -Math.min(1, S / 0.4) * 2.9]; lean = -0.12; }
    if (atk === 'slam') {
      const up = Math.min(1, S / 0.45), down = THREE.MathUtils.clamp((S - 0.55) / 0.15, 0, 1);
      const a = -2.9 * up + 2.4 * down;
      ax = [a, a];
      lean = -0.2 * up + 0.55 * down;
      if (down > 0 && S < 1) sq = 0.9;
    }
    if (atk === 'rods') { ax = [-1.8 - Math.sin(S * 12) * 0.8, -1.8 + Math.sin(S * 12) * 0.8]; lean = -0.05; }
    if (st === 'daze') { ax = [0.5, 0.5]; lean = 0.35; }
    this.arms.forEach((g, i) => { g.rotation.x += (ax[i] - g.rotation.x) * Math.min(1, dt * 14); g.rotation.z = (i ? 1 : -1) * 0.08; });
    this.body.rotation.x += (lean - this.body.rotation.x) * Math.min(1, dt * 8);
    this.body.scale.set(1 + (1 - sq), sq, 1 + (1 - sq));
    // голова: во сне опущена, в бою следит; в оглушении мотается
    this.head.rotation.set(st === 'sleep' ? 0.4 : 0, st === 'daze' ? Math.sin(t * 5) * 0.3 : 0, 0);
    // громоотводы потрескивают, перегрев — дым и искры из плеч
    if (st !== 'sleep' && rnd() < 0.06) this.sparkle(rnd() < 0.5 ? 0 : 1);
    if (st === 'daze' && rnd() < 0.4) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-1, 1), 3 + rand(0, 0.3), rand(-0.5, 0.5))), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1, 2), rand(-0.3, 0.3)), life: rand(0.6, 1.1), size: rand(0.15, 0.3), color: rnd() < 0.8 ? '#7a7a80' : SPARK, gravity: -0.5 }, rnd() < 0.2);
    // сердце-ягода: в оглушении бьётся крупно
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.4 : 1));
  }
}
