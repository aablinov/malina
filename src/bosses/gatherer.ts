import * as THREE from 'three';
import { pixelTex } from '../textures';
import { bell, boom, hiss, voice } from '../spell-audio';
import type { Rect } from './arena';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit';
import { MiniBoss } from './mini';

/**
 * Скорбная Сборщица — мини-босс (wiki/design-bosses.md, раздел 2): призрачная жница Ордена в пыльной мантии-колоколе,
 * без ног, парит над полом; под глубоким капюшоном — бирюзовые глаза, над ним — тонкий венец из малиновых зёрнышек.
 * В руках — плетёная корзина с увядшими ягодами; живая из них одна — светящаяся ягода-сердце. Держится на расстоянии.
 * Атаки: призрачные руки из пола по меткам (держат героя), блуждающие огоньки, что ищут героя, перенос на дальний край
 * арены, если герой вплотную; призыв призраков; плач — ставит корзину, кольцо скорби, после него обессилена, сердце открыто.
 * Роняет «Хор мёртвых». Подвижных частей: капюшон, два рукава, корзина, ягода-сердце.
 */

const TURQ = C(0.6, 3.4, 3.2), PALE = C(1.6, 3.6, 3.4), PINK = C(4, 1.7, 2.4);
const HOLD = 1.2, WISP_SPEED = 4, WISP_LIFE = 3.2;

const sfx = {
  /** Шёпот: отфильтрованное шипение короткими рваными вздохами */
  whisper() {
    for (let i = 0; i < 9; i++) hiss({ dur: rand(0.05, 0.14), vol: rand(0.04, 0.09), f: rand(1800, 4200), f1: rand(1200, 3000), q: rand(2, 5), type: 'bandpass', attack: rand(0.005, 0.02), delay: i * rand(0.05, 0.11), verb: 0.6 });
  },
  /** Руки вырвались из пола: глухой удар и шелест */
  erupt() { boom(90, 35, 0.4, 0.4, 0, 0.5); hiss({ dur: 0.4, vol: 0.12, f: 600, f1: 2400, q: 0.7, type: 'lowpass', verb: 0.5 }); },
  /** Огонёк родился: тихий колокольчик */
  orb(i: number) { bell(880 + i * 220, 0.6, 0.04, 0, 0.7); },
  /** Огонёк лопнул */
  pop() { bell(1320, 0.3, 0.04); hiss({ dur: 0.15, vol: 0.08, f: 3000, f1: 800, q: 1, type: 'bandpass' }); },
  /** Перенос: стеклянный перезвон вверх */
  blink() { for (const [f, d] of [[660, 0], [990, 0.06], [1480, 0.12]] as const) bell(f, 0.5, 0.035, d, 0.8); hiss({ dur: 0.5, vol: 0.08, f: 4000, f1: 1500, q: 0.8, type: 'highpass', verb: 0.7 }); },
  /** Плач: стонущий голос сверху вниз и вой ветра */
  wail() {
    voice({ type: 'sawtooth', f: 620, f1: 260, dur: 1.4, vol: 0.06, detune: 25, lp: 2400, lp1: 600, verb: 0.8 });
    voice({ type: 'triangle', f: 930, f1: 390, dur: 1.4, vol: 0.04, detune: -18, verb: 0.8 });
    hiss({ dur: 1.4, vol: 0.18, f: 900, f1: 300, q: 1.2, type: 'bandpass', attack: 0.2, verb: 0.7 });
  },
  /** Призыв: низкий погребальный звон */
  summon() { bell(196, 1.4, 0.06, 0, 0.8); bell(233, 1.4, 0.04, 0.15, 0.8); },
};

interface Wisp { mesh: THREE.Mesh; vel: THREE.Vector3; t: number }

export class Gatherer extends MiniBoss {
  readonly radius = 0.9;
  readonly title = 'Скорбная Сборщица';
  override readonly topY = 3.2;
  readonly drop = 'deadchoir';
  private readonly hood = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly basket = new THREE.Group();
  private readonly heart = new THREE.Group();
  private readonly robeMats: THREE.MeshLambertMaterial[] = [];
  private readonly wisps: Wisp[] = [];
  private readonly pinAt = new THREE.Vector3();
  private pinT = 0;
  private fade = 1;
  private summonCd = 7;
  private blinkCd = 0;
  private wailCd = 0;

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 750, home, yaw, arena);
    this.speed = 2.4;
    this.keep = 7;
    this.build();
    this.reset();
  }

  protected build(): void {
    // мантия полупрозрачна — нужна для исчезновения при переносе
    const robeLam = (c: string, tex?: THREE.Texture) => { const m = this.lam(c, tex); m.transparent = true; this.robeMats.push(m); return m; };
    const robe = robeLam('#5a4a66', pixelTex('#5a4a66', 10, 611));
    const hem = robeLam('#3e3248');
    const shadow = robeLam('#140f1a');
    const wicker = robeLam('#8a6a3a', pixelTex('#8a6a3a', 8, 612));
    const withered = robeLam('#4a2a3a');
    const eyes = glowMat(TURQ);
    const berry = this.shimmer(RASP, PINK, 0, 3);
    const crown = this.shimmer(TURQ, RASP, 1, 1.4);
    const cuff = this.shimmer(TURQ, RASP, 2, 1.2);
    const B = this.box.bind(this);
    // мантия-колокол: три ступени шире книзу, подол темнее
    B(this.body, robe, 0.9, 0.7, 0.75, 0, 1.75, 0);
    B(this.body, robe, 1.2, 0.7, 1.0, 0, 1.1, 0);
    B(this.body, hem, 1.6, 0.55, 1.3, 0, 0.5, 0);
    B(this.body, robe, 1.05, 0.22, 0.8, 0, 2.1, 0);
    // капюшон: глубокий, внутри тьма и два бирюзовых глаза; над ним — венец из малиновых зёрнышек (знак Ордена)
    this.hood.position.set(0, 2.2, 0);
    this.body.add(this.hood);
    B(this.hood, robe, 0.82, 0.8, 0.85, 0, 0.38, -0.02);
    B(this.hood, robe, 0.5, 0.25, 0.55, 0, 0.86, -0.12, -0.3);
    B(this.hood, shadow, 0.58, 0.52, 0.1, 0, 0.32, 0.4);
    for (const x of [-0.13, 0.13]) B(this.hood, eyes, 0.11, 0.07, 0.05, x, 0.38, 0.46);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; B(this.hood, crown, 0.09, i % 2 ? 0.1 : 0.16, 0.09, Math.sin(a) * 0.34, 0.95, Math.cos(a) * 0.34 - 0.04); }
    // рукава: висят от плеч и тянутся к корзине; на концах — светящиеся манжеты
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.62, 2.0, 0.05);
      this.body.add(g);
      B(g, robe, 0.32, 0.95, 0.34, 0, -0.42, 0);
      B(g, cuff, 0.26, 0.08, 0.28, 0, -0.92, 0);
      this.arms.push(g);
    }
    // корзина увядших ягод; живая — одна, ягода-сердце
    this.basket.position.set(0, 1.25, 0.78);
    this.body.add(this.basket);
    B(this.basket, wicker, 0.8, 0.4, 0.55, 0, 0, 0);
    B(this.basket, hem, 0.86, 0.08, 0.6, 0, 0.22, 0);
    B(this.basket, wicker, 0.06, 0.45, 0.06, -0.38, 0.45, 0);
    B(this.basket, wicker, 0.06, 0.45, 0.06, 0.38, 0.45, 0);
    B(this.basket, wicker, 0.82, 0.06, 0.06, 0, 0.68, 0);
    for (const [x, z] of [[-0.25, -0.1], [-0.05, 0.12], [0.28, -0.12], [-0.22, 0.14]]) B(this.basket, withered, 0.16, 0.14, 0.16, x, 0.27, z, 0, x * 3, 0);
    this.heart.position.set(0.14, 0.34, 0.06);
    this.basket.add(this.heart);
    for (const [x, y, z, k] of [[0, 0, 0, 0.2], [0.1, 0.06, 0, 0.13], [-0.1, 0.06, 0, 0.13], [0, 0.06, 0.1, 0.13], [0, 0.06, -0.1, 0.13], [0, 0.16, 0, 0.12]] as const) B(this.heart, berry, k, k, k, x, y, z);
  }

  override reset(): void {
    super.reset();
    for (const w of this.wisps.splice(0)) this.dropWisp(w);
    this.pinT = 0; this.fade = 1; this.summonCd = 7; this.blinkCd = 0; this.wailCd = 0;
  }

  protected override die(): void {
    super.die();
    for (const w of this.wisps.splice(0)) this.dropWisp(w);
    this.pinT = 0; this.fade = 1;
  }

  protected choose(dist: number): string | null {
    if (dist < 3 && this.blinkCd <= 0) return 'blink';
    if (dist < 4.5 && this.wailCd <= 0) return 'wail';
    if (this.summonCd <= 0 && this.minions.length < 3) return 'summon';
    return Math.random() < 0.55 ? 'hands' : 'wisps';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'hands': {
        // метки под героем (на ярости — ещё две рядом), через секунду из пола рвутся призрачные руки
        if (!this.hitDone) {
          this.hitDone = true;
          const spots = [this.heroAt()];
          if (this.enraged) for (let i = 0; i < 2; i++) { const a = rand(0, Math.PI * 2); spots.push(this.heroAt().add(new THREE.Vector3(Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4))); }
          for (const p of spots) this.markCircle(this.clampIn(p, 1), 1.2, 1.0, () => this.erupt(p), TURQ);
          if (!this.quiet) sfx.whisper();
        }
        return t > 1.6;
      }
      case 'wisps': {
        // из корзины выплывают три огонька и медленно ищут героя
        for (let i = 0; i < 3; i++) {
          const at = 0.3 + i * 0.25;
          if (t >= at && t - dt < at) {
            const mesh = new THREE.Mesh(UNIT, glowMat(i === 1 ? PALE : TURQ));
            mesh.scale.setScalar(0.28);
            mesh.position.copy(this.basketPos());
            this.h.scene.add(mesh);
            const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar((i - 1) * 2.5);
            this.wisps.push({ mesh, vel: this.fwd().multiplyScalar(1.5).add(side).setY(1), t: 0 });
            fx.burst(mesh.position.clone(), [TURQ, PALE], 6, { speed: 1.5, up: 1, size: 0.08, life: 0.4, glow: true, gravity: 0 });
            if (!this.quiet) sfx.orb(i);
          }
        }
        return t > 1.3;
      }
      case 'blink': {
        // тает → переносится на дальний край арены → проступает снова
        if (!this.hitDone) { this.hitDone = true; this.blinkCd = 7; if (!this.quiet) sfx.blink(); }
        if (t < 0.4) { this.fade = 1 - t / 0.4; return false; }
        if (t - dt < 0.4) {
          fx.burst(this.pos.clone().setY(1.5), [TURQ, PALE, RASP], 18, { speed: 2, up: 2, size: 0.1, life: 0.7, glow: true, gravity: -0.5 });
          const a = this.arena, hero = this.heroAt();
          const to = this.clampIn(new THREE.Vector3(a.x0 + a.x1 - hero.x, 0, a.z0 + a.z1 - hero.z), 2);
          if (to.distanceTo(hero) < 5) { const d = to.clone().sub(hero).setY(0); if (d.lengthSq() < 1e-4) d.set(1, 0, 0); this.clampIn(to.copy(hero).addScaledVector(d.normalize(), 7), 2); }
          this.pos.x = to.x; this.pos.z = to.z;
          this.yaw = Math.atan2(hero.x - to.x, hero.z - to.z);
          fx.burst(to.clone().setY(1.5), [TURQ, PALE], 14, { speed: 2, up: 1, size: 0.1, life: 0.6, glow: true, gravity: 0 });
          fx.shock(to.clone().setY(0.08), 1.8, TURQ.clone().multiplyScalar(0.5), 0.4, 0.1);
        }
        this.fade = Math.min(1, (t - 0.4) / 0.5);
        return t > 1.0;
      }
      case 'summon': {
        // погребальный звон — из пола поднимаются бледные призраки
        if (!this.hitDone) { this.hitDone = true; this.summonCd = 12; if (!this.quiet) sfx.summon(); }
        const n = Math.min(2, 3 - this.minions.length);
        for (let i = 0; i < n; i++) {
          const at = 0.5 + i * 0.3;
          if (t >= at && t - dt < at) {
            const a = rand(0, Math.PI * 2);
            this.summon(this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2)), { body: '#b8a6d0', head: '#8e7aa8', eye: TURQ, hp: 25, dmg: 6, speed: 2.4, ghost: true });
            fx.burst(this.basketPos(), [TURQ, PALE], 10, { speed: 2, up: 3, size: 0.1, life: 0.6, glow: true, gravity: 0 });
          }
        }
        return t > 1.5;
      }
      case 'wail': {
        // ставит корзину, плачет — кольцо скорби; потом обессилена, ягода-сердце открыта
        if (!this.hitDone) { this.hitDone = true; this.wailCd = 9; this.markCircle(this.pos, 4, 0.9, () => undefined, TURQ); }
        if (t < 0.9) { if (t > 0.5 && t - dt <= 0.5 && !this.quiet) sfx.wail(); return false; }
        fx.shock(this.pos.clone().setY(0.1), 4.4, TURQ, 0.6, 0.3);
        fx.shock(this.pos.clone().setY(1.2), 3.2, RASP.clone().multiplyScalar(0.6), 0.5, 0.15);
        fx.burst(this.pos.clone().setY(2.4), [TURQ, PALE, RASP], 30, { speed: 5, up: 2, size: 0.1, life: 0.8, glow: true, gravity: 0 });
        fx.light(this.pos.clone().setY(2), TURQ, 6, 10, 0.5);
        fx.shake = Math.max(fx.shake, 0.4);
        if (this.inCircle(this.pos, 4)) this.hurt(10, this.pos, 6);
        this.daze(2);
        return true;
      }
    }
    return true;
  }

  /** Руки рвутся из пола в точке p: урон и захват */
  private erupt(p: THREE.Vector3): void {
    const fx = this.h.fx;
    if (!this.quiet) { sfx.erupt(); sfx.whisper(); }
    fx.burst(p.clone().setY(0.2), [TURQ, PALE], 12, { speed: 2.5, up: 4, size: 0.09, life: 0.6, glow: true, gravity: 2 });
    for (let n = 0; n < 2; n++) {
      const mat = glowMat(TURQ.clone().multiplyScalar(0.45), 0.8, true), g = new THREE.Group();
      this.box(g, mat, 0.5, 0.35, 0.2, 0, 0.2, 0);
      for (let i = 0; i < 4; i++) this.box(g, mat, 0.1, 0.45, 0.1, -0.18 + i * 0.12, 0.6, 0);
      this.box(g, mat, 0.1, 0.3, 0.1, 0.32, 0.35, 0, 0, 0, -0.6);
      const ox = (n ? 0.35 : -0.35), ph = rand(0, 6);
      g.rotation.y = rand(0, Math.PI * 2);
      fx.custom(g, 1.3, (k) => {
        const rise = Math.min(1, k / 0.2), sink = Math.max(0, (k - 0.7) / 0.3);
        g.position.set(p.x + ox * Math.cos(g.rotation.y), -1.2 * (1 - rise) ** 2 - sink * 1.4, p.z - ox * Math.sin(g.rotation.y));
        g.children.forEach((f, j) => { if (j > 0 && j < 5) f.rotation.x = Math.min(1, k * 3) * 0.9; });
        mat.opacity = 0.8 * (1 - sink) * (0.85 + Math.sin(this.time * 20 + ph) * 0.15);
      }, () => mat.dispose());
    }
    if (this.inCircle(p, 1.2)) { this.hurt(12, p, 0); this.pinT = HOLD; this.pinAt.copy(this.h.hero.pos); }
  }

  private basketPos(): THREE.Vector3 { return this.pos.clone().addScaledVector(this.fwd(), 0.8).setY(1.6); }

  private dropWisp(w: Wisp): void { this.h.scene.remove(w.mesh); (w.mesh.material as THREE.Material).dispose(); }

  override update(dt: number): void {
    super.update(dt);
    const hero = this.h.hero;
    // захват: руки держат героя на месте
    if (this.pinT > 0) {
      this.pinT -= dt;
      hero.pos.copy(this.pinAt);
      hero.vel.set(0, 0, 0);
      if (Math.random() < 0.3) this.h.fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(0.2, 1.2), rand(-0.4, 0.4))), vel: new THREE.Vector3(0, -1, 0), life: 0.4, size: 0.07, color: TURQ, gravity: 0 });
    }
    // огоньки: плывут и медленно доворачивают к герою
    const target = hero.pos.clone().setY(hero.pos.y + 1);
    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const w = this.wisps[i];
      w.t += dt;
      const want = target.clone().sub(w.mesh.position).normalize().multiplyScalar(WISP_SPEED);
      w.vel.lerp(want, Math.min(1, dt * 1.6));
      w.mesh.position.addScaledVector(w.vel, dt);
      w.mesh.rotation.set(w.t * 3, w.t * 4, 0);
      w.mesh.scale.setScalar(0.28 + Math.sin(w.t * 12) * 0.04);
      if (Math.random() < 0.5) this.h.fx.particle({ pos: w.mesh.position.clone(), vel: new THREE.Vector3(0, 0.3, 0), life: 0.35, size: 0.08, color: TURQ, gravity: 0 });
      const hit = w.mesh.position.distanceTo(target) < 0.7;
      if (hit || w.t > WISP_LIFE) {
        if (hit) this.hurt(8, w.mesh.position, 2);
        this.h.fx.burst(w.mesh.position.clone(), [TURQ, PALE], 8, { speed: 2, up: 1, size: 0.08, life: 0.4, glow: true, gravity: 0 });
        if (!this.quiet) sfx.pop();
        this.dropWisp(w);
        this.wisps.splice(i, 1);
      }
    }
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st, dead = this.state === 'dead';
    if (this.awake) { this.summonCd -= dt; this.blinkCd -= dt; this.wailCd -= dt; }
    // парит над полом, плавно качается; в движении — клонится вперёд
    if (!dead) {
      this.body.position.y = 0.3 + Math.sin(t * 1.6) * 0.12;
      this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, this.state === 'daze' ? 0.3 : walk ? 0.12 : 0, 0.1);
    }
    // исчезновение при переносе
    const op = this.state === 'attack' && this.attack === 'blink' ? this.fade : 1;
    for (const m of this.robeMats) m.opacity = op;
    this.body.scale.set(dead ? this.body.scale.x : 1, dead ? this.body.scale.y : 0.6 + 0.4 * op, dead ? this.body.scale.z : 1);
    // капюшон: опущен во сне и в изнеможении, в плаче — запрокинут
    const wail = this.state === 'attack' && this.attack === 'wail';
    this.hood.rotation.x = this.state === 'sleep' || this.state === 'daze' ? 0.45 : wail && S > 0.5 ? -0.5 : Math.sin(t * 0.9) * 0.06;
    // рукава держат корзину; при руках и огоньках — воздеты, в плаче — к лицу
    const cast = this.state === 'attack' && (this.attack === 'hands' || this.attack === 'wisps' || this.attack === 'summon');
    this.arms.forEach((g, i) => {
      const s = i ? 1 : -1;
      const rx = cast ? -2.4 + Math.sin(S * 8 + i) * 0.2 : wail ? (S < 0.5 ? -0.3 : -2.6) : this.state === 'daze' ? 0.1 : -0.75;
      g.rotation.set(rx, 0, s * (cast ? 0.35 : wail && S > 0.5 ? -0.25 : -0.12));
    });
    // корзина: в руках; в плаче и оглушении — стоит на полу
    const down = wail || this.state === 'daze';
    this.basket.position.y = THREE.MathUtils.lerp(this.basket.position.y, down ? 0.2 - this.body.position.y : cast ? 1.0 : 1.25, 0.15);
    this.basket.position.z = THREE.MathUtils.lerp(this.basket.position.z, down ? 1.0 : 0.78, 0.15);
    // ягода-сердце: тихо бьётся, оглушена — крупно
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 4)) * 0.1;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.8 : 1));
    // бирюзовые огоньки-души вокруг
    if (!dead && this.state !== 'sleep' && Math.random() < 0.3 * op) {
      const a = rand(0, Math.PI * 2);
      this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.9, rand(0.4, 2.6), Math.sin(a) * 0.9)), vel: new THREE.Vector3(0, rand(0.2, 0.6), 0), life: rand(0.5, 0.9), size: rand(0.05, 0.1), color: Math.random() < 0.8 ? TURQ : RASP, gravity: 0 });
    }
  }
}
