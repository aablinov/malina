import * as THREE from 'three';
import { pixelTex } from '../textures';
import { bell, boom, hiss, voice } from '../spell-audio';
import type { Rect } from './arena';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit';
import { MiniBoss } from './mini';

/**
 * Друзовый голем — мини-босс (wiki/design-bosses.md, раздел 2): каменный истукан Ордена, из спины и плеч растёт малиновая
 * друза, в груди сквозь трещину светится сердце-ягода, на голове — венец из костянок (знак Ордена). Тяжело топает к герою.
 * Атаки: «разлом» — бьёт кулаками в пол, по полосе к герою один за другим вырастают кристаллы; кулаки застревают в земле —
 * оглушён, сердце открыто; «топот» — вплотную, кольцо пыли; «осколок» — отрывает кристалл со спины и бросает по дуге,
 * на месте падения — розовая крошка жжёт. Роняет «Разлом». Подвижных частей: тело, голова, две руки, две ноги, друза, сердце.
 */

const PINK = C(4, 1.2, 2.6), PINK2 = C(4, 2.6, 3.4), DUST = ['#9a9284', '#7a7468', '#5e5a52'];

const sfx = {
  /** Шаг: глухой удар камня о камень */
  step() { boom(55, 28, 0.35, 0.4); },
  /** Кулаки в пол: гул и треск породы */
  slam() { boom(60, 22, 1.2, 0.9, 0, 0.5); hiss({ dur: 0.6, vol: 0.25, f: 2200, f1: 300, q: 0.5, type: 'lowpass' }); },
  /** Кристалл вырос: короткий стеклянный звон */
  spike(i: number) { bell(880 + (i % 5) * 140, 0.35, 0.025, 0, 0.4); },
  /** Отломил осколок: хруст */
  crack() { hiss({ dur: 0.18, vol: 0.2, f: 3000, f1: 800, q: 1.2, type: 'bandpass' }); voice({ type: 'square', f: 220, f1: 90, dur: 0.1, vol: 0.03, lp: 1500 }); },
  /** Осколок разбился: звон и россыпь */
  shatter() { boom(120, 50, 0.3, 0.3); for (const [f, d] of [[1320, 0], [1760, 0.03], [2210, 0.06]] as const) bell(f, 0.5, 0.025, d, 0.5); },
};

export class DruseGolem extends MiniBoss {
  readonly radius = 1.5;
  readonly title = 'Друзовый голем';
  override readonly topY = 3.7;
  readonly drop = 'rift';
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly legs: THREE.Group[] = [];
  private readonly druse = new THREE.Group();
  private readonly heart = new THREE.Group();
  private stepT = 0;
  private riftCd = 2;
  /** Кулаки застряли после разлома — оглушение держит их в земле */
  private stuck = false;
  private readonly riftDir = new THREE.Vector3();

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 1000, home, yaw, arena);
    this.speed = 2.4;
    this.keep = 3.5;
    this.build();
    this.reset();
  }

  protected build(): void {
    const stone = this.lam('#7a7468', pixelTex('#7a7468', 10, 511));
    const dark = this.lam('#4e4a44', pixelTex('#4e4a44', 8, 512));
    const moss = this.lam('#5a7a3a', pixelTex('#5a7a3a', 8, 513));
    const gold = this.lam('#e8b84a');
    const B = this.box.bind(this);
    this.body.add(this.torso);
    // туловище: огромная глыба, пояс потемнее, мох на плечах
    B(this.torso, stone, 2.3, 1.7, 1.5, 0, 2.0, 0);
    B(this.torso, dark, 2.0, 0.45, 1.3, 0, 1.0, 0);
    B(this.torso, moss, 0.8, 0.14, 0.9, -0.75, 2.9, 0.1);
    B(this.torso, moss, 0.5, 0.3, 0.12, 0.7, 1.6, 0.76);
    // трещина в груди: тёмная рамка, сквозь неё светится сердце-ягода
    B(this.torso, dark, 0.14, 0.75, 0.1, -0.36, 2.15, 0.76, 0, 0, 0.2);
    B(this.torso, dark, 0.14, 0.75, 0.1, 0.36, 2.15, 0.76, 0, 0, -0.2);
    B(this.torso, dark, 0.5, 0.12, 0.1, 0, 2.55, 0.76);
    this.heart.position.set(0, 2.15, 0.7);
    this.torso.add(this.heart);
    const core = this.shimmer(RASP, PINK2, 0, 3);
    B(this.heart, core, 0.42, 0.5, 0.2, 0, 0, 0, 0, 0, Math.PI / 4);
    B(this.heart, core, 0.22, 0.22, 0.26, 0, 0, 0.04);
    // друза: острые розовые кристаллы из спины и плеч
    this.torso.add(this.druse);
    const cr = [this.shimmer(PINK, PINK2, 0, 1.4), this.shimmer(PINK, PINK2, 2, 1.4), this.shimmer(PINK, PINK2, 4, 1.4)];
    for (const [x, y, z, s, rx, rz] of [
      [0, 2.6, -0.85, 1, -0.5, 0], [-0.55, 2.3, -0.8, 0.8, -0.6, 0.35], [0.6, 2.2, -0.8, 0.85, -0.55, -0.4],
      [0.2, 1.7, -0.8, 0.6, -0.8, -0.2], [-1.0, 2.95, -0.1, 0.6, -0.2, 0.6], [1.0, 3.0, 0, 0.7, -0.15, -0.55],
    ] as const) {
      const m = cr[Math.round(Math.abs(x * 3 + y)) % 3];
      B(this.druse, m, 0.32 * s, 0.9 * s, 0.32 * s, x, y, z, rx, 0.785, rz);
      B(this.druse, m, 0.18 * s, 0.5 * s, 0.18 * s, x + 0.18 * s, y - 0.1, z + 0.05, rx * 0.6, 0.785, rz - 0.5);
    }
    // голова: маленькая, глаза светятся, на макушке — венец из костянок
    this.head.position.set(0, 2.85, 0.25);
    this.torso.add(this.head);
    B(this.head, stone, 0.85, 0.7, 0.8, 0, 0.35, 0);
    B(this.head, moss, 0.86, 0.12, 0.5, 0, 0.72, -0.15);
    B(this.head, glowMat(PINK2), 0.55, 0.1, 0.05, 0, 0.42, 0.41);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; B(this.head, core, 0.16, 0.16, 0.16, Math.cos(a) * 0.24, 0.85, Math.sin(a) * 0.24 - 0.05); }
    B(this.head, gold, 0.1, 0.16, 0.1, 0, 0.98, -0.05);
    // руки: плечо, массивный кулак-глыба; ось — в плече
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 1.5, 2.55, 0);
      this.torso.add(g);
      B(g, stone, 0.7, 0.75, 0.8, 0, -0.1, 0);
      B(g, dark, 0.55, 0.9, 0.55, 0, -0.9, 0);
      B(g, stone, 1.0, 0.85, 1.0, 0, -1.7, 0);
      this.arms.push(g);
    }
    // ноги: короткие столбы, ось — в бедре
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.6, 0.85, 0);
      this.body.add(g);
      B(g, dark, 0.7, 0.85, 0.8, 0, -0.42, 0.05);
      this.legs.push(g);
    }
  }

  protected choose(dist: number): string | null {
    if (dist < 3.8 && (this.riftCd > 0 || Math.random() < 0.7)) return 'stomp';
    if (this.riftCd <= 0 && Math.random() < 0.6) return 'rift';
    return dist > 4.5 ? 'shard' : null;
  }

  /** Кристаллы вырастают по полосе один за другим; ref — общий на весь разлом, чтобы бил один раз */
  private spikes(from: THREE.Vector3, dir: THREE.Vector3, len: number, ref: { hit: boolean }): void {
    const fx = this.h.fx, n = Math.round(len / 1.1);
    for (let i = 0; i < n; i++) {
      const at = from.clone().addScaledVector(dir, 1 + i * 1.1).setY(0);
      const g = new THREE.Group();
      g.position.copy(at);
      g.rotation.y = rand(0, Math.PI);
      const mat = glowMat(i % 2 ? PINK : PINK2);
      const hs = rand(1.1, 1.7);
      for (const [x, z, k, r] of [[0, 0, 1, 0], [0.25, 0.1, 0.6, 0.35], [-0.2, -0.15, 0.55, -0.4]] as const) {
        const m = new THREE.Mesh(UNIT, mat);
        m.scale.set(0.38 * k, hs * k, 0.38 * k);
        m.position.set(x, hs * k * 0.5, z);
        m.rotation.set(0, 0.785, r);
        g.add(m);
      }
      g.scale.set(1, 0, 1);
      const delay = i * 0.055, dur = delay + 0.9;
      let popped = false;
      fx.custom(g, dur, (k) => {
        const q = k * dur - delay;
        if (q < 0) return;
        if (!popped) {
          popped = true;
          if (!this.quiet) sfx.spike(i);
          fx.burst(at.clone().setY(0.2), [PINK, ...DUST], 6, { speed: 2.5, up: 3, size: 0.1, life: 0.5, gravity: 8 });
          if (!ref.hit && !this.dead && this.inCircle(at, 0.8)) { ref.hit = true; this.hurt(18, at, 6); }
        }
        // выстреливает за 0,1 с, стоит, к концу уходит в землю
        g.scale.y = q < 0.1 ? q / 0.1 : q > 0.55 ? Math.max(0, 1 - (q - 0.55) / 0.35) : 1;
      }, () => mat.dispose());
    }
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'rift': {
        // замах над головой → кулаки в пол → полосы → кристаллы; кулаки застряли — оглушён
        const RAISE = 0.5, MARK = 0.8, LEN = 14, W = 1.6;
        if (t < RAISE) { this.face(dt, 1.5); return false; }
        if (!this.hitDone) {
          this.hitDone = true;
          this.riftCd = this.enraged ? 6 : 8;
          if (!this.quiet) sfx.slam();
          fx.shake = Math.max(fx.shake, 0.8);
          fx.hitstop = Math.max(fx.hitstop, 0.05);
          const f = this.fwd();
          const fist = this.pos.clone().addScaledVector(f, 1.6).setY(0.1);
          fx.shock(fist, 2.4, PINK.clone().multiplyScalar(0.5), 0.4, 0.15);
          fx.burst(fist.clone().setY(0.3), DUST, 20, { speed: 4, up: 4, size: 0.16, life: 0.8, gravity: 12 });
          this.riftDir.copy(this.heroAt().sub(this.pos).setY(0));
          if (this.riftDir.lengthSq() < 1e-4) this.riftDir.copy(f);
          this.riftDir.normalize();
          const ref = { hit: false };
          const from = this.pos.clone().setY(0);
          for (const a of this.enraged ? [-0.436, 0, 0.436] : [0]) {
            const d = this.riftDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
            this.markLine(from, d, LEN, W, MARK, () => this.spikes(from, d, LEN, ref));
          }
        }
        if (t < RAISE + MARK) return false;
        this.stuck = true;
        this.daze(1.6);
        return true;
      }
      case 'stomp': {
        // поднял ногу — круг налился — топнул всем весом
        const WIND = 0.6;
        if (!this.hitDone) { this.hitDone = true; this.markCircle(this.pos, 3, WIND, () => undefined); }
        if (t >= WIND && t - dt < WIND) {
          if (!this.quiet) { sfx.slam(); }
          fx.shake = Math.max(fx.shake, 0.7);
          fx.shock(this.pos.clone().setY(0.1), 3.2, C(1.4, 1.2, 1), 0.4, 0.25);
          fx.burst(this.pos.clone().setY(0.3), DUST, 26, { speed: 5, up: 3, size: 0.18, life: 0.9, gravity: 10 });
          if (this.inCircle(this.pos, 3)) this.hurt(16, this.pos, 8);
        }
        return t > WIND + 0.5;
      }
      case 'shard': {
        // тянется за спину, отламывает кристалл — и бросает по дуге
        const n = this.enraged ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const at = 0.55 + i * 0.4;
          if (t >= at && t - dt < at) {
            const to = this.clampIn(this.heroAt().add(i ? new THREE.Vector3(rand(-2.5, 2.5), 0, rand(-2.5, 2.5)) : new THREE.Vector3()));
            const side = i ? -1 : 1;
            const from = this.pos.clone().add(new THREE.Vector3(0, 3.6, 0)).addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), side * 1.2);
            const mesh = new THREE.Mesh(UNIT, glowMat(PINK2));
            mesh.scale.set(0.45, 0.9, 0.45);
            const dur = 0.9;
            this.markCircle(to, 2, dur, () => undefined);
            if (!this.quiet) sfx.crack();
            fx.burst(from.clone(), [PINK, PINK2], 8, { speed: 2, up: 2, size: 0.1, life: 0.4, glow: true, gravity: 6 });
            this.lob(mesh, from, to, dur, 3.2, PINK, (p) => {
              if (!this.quiet) sfx.shatter();
              fx.burst(p.clone().setY(0.4), [PINK, PINK2, RASP], 18, { speed: 4.5, up: 4, size: 0.12, life: 0.6, glow: true, gravity: 8 });
              fx.shock(p.clone().setY(0.06), 2.2, PINK, 0.3, 0.14);
              if (this.inCircle(p, 2)) this.hurt(14, p, 5);
              this.hazard(p, 1.6, 2.5, 8, PINK);
            });
          }
        }
        return t > 0.55 + n * 0.4 + 0.35;
      }
    }
    return true;
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, fx = this.h.fx;
    if (this.awake) this.riftCd -= dt;
    if (this.state !== 'daze') this.stuck = false;
    const atk = this.state === 'attack' ? this.attack : '';
    let legL = 0, legR = 0, armL = Math.sin(t * 1.3) * 0.06, armR = -armL, lean = 0, bodyY = 0, sway = 0, sq = 1;
    // ходьба — тяжёлым шагом: ноги по очереди, туловище переваливается, на каждом шаге — гул и пыль
    if (walk) {
      const was = this.stepT;
      this.stepT += dt * 1.6 * this.speedK;
      const p = this.stepT * Math.PI;
      legL = Math.sin(p) * 0.45; legR = -legL;
      armL = -legL * 0.6; armR = -legR * 0.6;
      sway = Math.sin(p) * 0.08;
      bodyY = Math.abs(Math.sin(p)) * 0.12;
      lean = 0.08;
      if (Math.floor(this.stepT) !== Math.floor(was)) {
        if (!this.quiet) sfx.step();
        fx.shake = Math.max(fx.shake, 0.12);
        const s = Math.floor(this.stepT) % 2 ? 1 : -1;
        fx.burst(this.pos.clone().addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), s * 0.6).setY(0.1), DUST, 5, { speed: 1.4, up: 0.8, size: 0.1, life: 0.5, gravity: 6 });
      }
    }
    if (atk === 'rift') {
      // замах обеими над головой, потом кулаки в землю и наклон вперёд
      if (S < 0.5) { const k = S / 0.5; armL = armR = -2.8 * k; lean = -0.15 * k; bodyY = 0.1 * k; }
      else { armL = armR = -0.75; lean = 0.38; bodyY = -0.25; sq = 0.94; }
    } else if (this.stuck) {
      // кулаки в земле: дёргает, пытается вырвать
      armL = armR = -0.75 + Math.sin(t * 18) * 0.04; lean = 0.38 + Math.sin(t * 9) * 0.02; bodyY = -0.25;
    } else if (atk === 'stomp') {
      // подъём ноги и вес назад — потом удар и присед
      if (S < 0.6) { const k = S / 0.6; legL = -0.9 * k; bodyY = 0.35 * k; lean = -0.12 * k; armL = armR = -0.5 * k; sway = 0.1 * k; }
      else { const k = Math.max(0, 1 - (S - 0.6) / 0.4); bodyY = -0.15 * k; sq = 1 - 0.12 * k; armL = armR = -0.3 * k; }
    } else if (atk === 'shard') {
      // правая рука за спину (отломить), рывок вперёд — бросок; на ярости вторая рука следом
      const hand = (t0: number) => { const q = S - t0; return q < 0 ? 0 : q < 0.45 ? 2.5 * (q / 0.45) : q < 0.6 ? 2.5 - 4.3 * ((q - 0.45) / 0.15) : -1.8 * Math.max(0, 1 - (q - 0.6) / 0.4); };
      armR = hand(0.1);
      if (this.enraged) armL = hand(0.5);
      lean = S > 0.5 && S < 0.8 ? 0.15 : 0;
    }
    if (this.state === 'sleep') { lean = 0.2; armL = armR = -0.1; }
    if (this.state !== 'dead') {
      const k = 1 - Math.pow(0.0005, dt);
      const dr = (g: THREE.Object3D, v: number) => { g.rotation.x += (v - g.rotation.x) * Math.min(1, k * 2.5); };
      dr(this.legs[0], legL); dr(this.legs[1], legR); dr(this.arms[0], armL); dr(this.arms[1], armR);
      this.arms[0].rotation.z = -0.08; this.arms[1].rotation.z = 0.08;
      this.body.position.y += (bodyY - this.body.position.y) * Math.min(1, k * 2.5);
      this.body.rotation.x += (lean - this.body.rotation.x) * Math.min(1, k * 2);
      this.body.rotation.z += (sway - this.body.rotation.z) * Math.min(1, k * 2);
      this.body.scale.set(2 - sq, sq, 2 - sq);
      // голова чуть оглядывается; во сне опущена
      this.head.rotation.x = this.state === 'sleep' ? 0.35 : Math.sin(t * 0.7) * 0.04;
      this.head.rotation.y = Math.sin(t * 0.5) * 0.12;
    }
    // друза: в ярости кристаллы дрожат и сыплют искры
    this.druse.position.x = this.enraged ? Math.sin(t * 40) * 0.015 : 0;
    if (this.state !== 'dead' && this.state !== 'sleep' && Math.random() < (this.enraged ? 0.25 : 0.08)) {
      fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-1, 1), this.body.position.y + rand(2, 3.2), 0)).addScaledVector(this.fwd(), -0.9), vel: new THREE.Vector3(0, rand(0.4, 1), 0), life: 0.5, size: rand(0.05, 0.1), color: Math.random() < 0.5 ? PINK : PINK2, gravity: -0.5 });
    }
    // сердце-ягода: в трещине ровно пульсирует, в оглушении — крупно бьётся
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.5 : 1));
  }
}
