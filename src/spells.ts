import * as THREE from 'three';
import { duck } from './audio';
import { Sigil } from './sigils';
import { ChargeSound, spellSfx } from './spell-audio';
import type { FX } from './fx';
import type { ArtifactKind, ArtifactStats } from './items';
import type { Knight } from './knight';
import type { Terrain } from './level/collide.ts';
import { additiveSprite, glowTex, lightBeam } from './loot-look';
import type { Target } from './target';

/**
 * Заклинания (wiki/design-spells.md): заряд как в Elden Ring и каст в три фазы — замах, удар, послевкусие.
 * Каждая фаза собирается из общих деталей FX (вспышки, засветка экрана, свет, следы на полу, стоп-кадр) и слоистых звуков.
 * Числа (урон, перезарядка) — в src/items.ts, слоты и души — в src/gear.ts.
 */

export type SpellKind = Extract<ArtifactKind, 'spark' | 'fireball' | 'icerain' | 'heal'>;
export const isSpell = (k: ArtifactKind): k is SpellKind => k === 'spark' || k === 'fireball' || k === 'icerain' || k === 'heal';

export interface SpellHooks {
  scene: THREE.Scene;
  fx: FX;
  hero: Knight;
  terrain: Terrain;
  targets(): Target[];
  /** Урон одной цели (надпись, души, опыт — на стороне снаряжения) */
  damage(t: Target, dmg: number, from: THREE.Vector3, knock: number): void;
  /** Урон по площади; blast — поджечь бочки, разбить ящики */
  aoe(c: THREE.Vector3, r: number, dmg: number, knock: number, blast: boolean): number;
}

/** Множитель заряда: тап — ×1, полный — ×2,5 */
export const chargeMult = (k: number): number => 1 + 1.5 * k;

const C = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
/** Цвета стихий: яркость больше 1 светится через bloom */
const SCHOOL: Record<SpellKind, { a: THREE.Color; b: THREE.Color; css: string }> = {
  spark: { a: C(1, 2, 4), b: C(2.2, 3, 4), css: '#b8dcff' },
  fireball: { a: C(4, 1.5, 0.35), b: C(4, 3, 1), css: '#ffb060' },
  icerain: { a: C(1.4, 2.8, 4), b: C(2.8, 3.6, 4), css: '#c8f0ff' },
  heal: { a: C(0.9, 3.6, 1.1), b: C(3.8, 3.2, 1.2), css: '#d0ffb0' },
};
const PINK = C(3.8, 1, 1.8);

// ---------- текстуры, рисуются кодом один раз ----------

const canvasTex = (size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d') as CanvasRenderingContext2D, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

let scorchT: THREE.Texture | null = null, frostT: THREE.Texture | null = null;

/** Выжженное пятно: тёмный неровный круг с рваным краем */
const scorchTex = (): THREE.Texture => scorchT ??= canvasTex(128, (g, s) => {
  const c = s / 2;
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * c * 0.45, r = c * (0.25 + Math.random() * 0.35);
    const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(48,30,18,0.22)'); gr.addColorStop(1, 'rgba(48,30,18,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
});

/** Иней: белые лучи-кристаллы от центра */
const frostTex = (): THREE.Texture => frostT ??= canvasTex(256, (g, s) => {
  const c = s / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineCap = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number): void => {
    if (len < 6) return;
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
    for (const t of [0.4, 0.7]) {
      const bx = x + (x1 - x) * t, by = y + (y1 - y) * t;
      branch(bx, by, a + 0.7, len * 0.32, w * 0.6); branch(bx, by, a - 0.7, len * 0.32, w * 0.6);
    }
  };
  for (let i = 0; i < 9; i++) branch(c, c, (i / 9) * Math.PI * 2 + Math.random() * 0.3, c * (0.6 + Math.random() * 0.35), 3);
});

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const ICICLE = new THREE.ConeGeometry(0.13, 1.1, 4);
ICICLE.rotateX(Math.PI); // остриём вниз
const icicleMat = new THREE.MeshBasicMaterial({ color: C(1.5, 2.6, 3.4), transparent: true, opacity: 0.92, toneMapped: false });

const _v = new THREE.Vector3();
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

interface Charging { slot: number; kind: SpellKind; max: number; t: number; full: boolean; sound: ChargeSound; sigil: Sigil; orb: THREE.Sprite }
interface Job { t: number; fn: () => void }

export class Spells {
  private charge: Charging | null = null;
  private readonly jobs: Job[] = [];
  /** Покадровые процессы (полёт шара, дождь, угли): false — закончился */
  private readonly procs: ((dt: number) => boolean)[] = [];
  private time = 0;
  /** Удары заклинаний (для тестов): сколько раз сработала фаза удара */
  impacts = 0;

  constructor(private readonly h: SpellHooks) {}

  /** Какой слот сейчас заряжается и насколько (0..1) */
  get charging(): { slot: number; k: number } | null { return this.charge ? { slot: this.charge.slot, k: this.k(this.charge) } : null; }

  private k(c: Charging): number { return Math.min(1, c.t / c.max); }

  /** Рука героя: чуть впереди и на уровне плеча */
  private hand(): THREE.Vector3 {
    const hero = this.h.hero;
    return new THREE.Vector3(hero.pos.x + Math.sin(hero.yaw) * 0.5, hero.pos.y + 1.15, hero.pos.z + Math.cos(hero.yaw) * 0.5);
  }

  /** Развернуть героя к точке и вытянуть руку */
  private face(at: THREE.Vector3, sec = 0.35): void {
    const hero = this.h.hero;
    const dx = at.x - hero.pos.x, dz = at.z - hero.pos.z;
    hero.shootPose(dx * dx + dz * dz > 0.01 ? Math.atan2(dx, dz) : hero.yaw, sec);
  }

  private later(t: number, fn: () => void): void { this.jobs.push({ t: this.time + t, fn }); }

  // ---------- заряд ----------

  /** Начать заряжать (клавиша зажата) */
  start(slot: number, kind: SpellKind, a: ArtifactStats): void {
    this.cancel();
    const s = SCHOOL[kind];
    // круг каста под ногами: слои раскрываются ступенями по заряду (src/sigils.ts)
    const sigil = new Sigil(kind, 2.2, s.a, s.b, 0.32);
    sigil.group.position.copy(this.h.hero.pos);
    this.h.scene.add(sigil.group);
    const orb = new THREE.Sprite(additiveSprite(glowTex(), s.b.clone().multiplyScalar(0.6)));
    orb.scale.setScalar(0.3);
    this.h.scene.add(orb);
    this.charge = { slot, kind, max: a.charge ?? 1, t: 0, full: false, sound: new ChargeSound(kind), sigil, orb };
  }

  /** Отпустить клавишу: заряд 0..1 и слот; визуал заряда убирается */
  release(): { slot: number; k: number } | null {
    const c = this.charge;
    if (!c) return null;
    const k = this.k(c);
    this.drop(c, true);
    return { slot: c.slot, k };
  }

  cancel(): void { if (this.charge) this.drop(this.charge, false); }

  /** cast — круг вспыхивает и расходится; отмена — просто гаснет */
  private drop(c: Charging, cast: boolean): void {
    c.sound.stop(cast ? 0.06 : 0.25);
    if (cast) c.sigil.burst(this.h.fx); else c.sigil.dispose();
    this.h.scene.remove(c.orb);
    c.orb.material.dispose();
    this.charge = null;
  }

  private updateCharge(dt: number, aim: THREE.Vector3): void {
    const c = this.charge;
    if (!c) return;
    const hero = this.h.hero, fx = this.h.fx, s = SCHOOL[c.kind];
    c.t += dt;
    const k = this.k(c);
    c.sound.set(k);
    this.face(c.kind === 'heal' ? hero.pos.clone().add(new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw))) : aim, 0.2);
    // круг каста идёт за героем и раскрывается ступенями; каждая ступень — «щелчок» со звоном, кольцом и искрами вверх
    c.sigil.group.position.set(hero.pos.x, hero.pos.y, hero.pos.z);
    c.sigil.group.scale.setScalar(2.2 * (0.85 + k * 0.3));
    const opened = c.sigil.update(dt, k, c.full);
    if (opened >= 0) {
      c.sound.stage(opened);
      if (opened > 0) {
        const R = 2.2 * (0.85 + k * 0.3);
        fx.shock(hero.pos.clone().setY(hero.pos.y + 0.08), R * (0.6 + opened * 0.15), opened % 2 ? s.b : s.a, 0.3, 0.1);
        for (let i = 0; i < 10 + opened * 4; i++) {
          const a = Math.random() * Math.PI * 2;
          fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(a) * R * 0.95, 0.1, Math.sin(a) * R * 0.95)), vel: new THREE.Vector3(0, rand(2, 4.5), 0), life: rand(0.4, 0.7), size: rand(0.05, 0.09), color: Math.random() < 0.5 ? s.a : s.b, gravity: -1, shrink: true });
        }
        fx.shake = Math.max(fx.shake, 0.08 + opened * 0.05);
      }
    }
    // с третьей ступени по краю круга поднимаются огоньки
    if (c.sigil.stage >= 2 && Math.random() < 0.5 + k * 0.4) {
      const a = Math.random() * Math.PI * 2, R = 2.2 * (0.85 + k * 0.3);
      fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(a) * R, 0.1, Math.sin(a) * R)), vel: new THREE.Vector3(0, rand(1.5, 3), 0), life: 0.6, size: 0.05, color: s.b, gravity: -0.5 });
    }
    // сгусток в руке; огненный шар растёт прямо в ладони
    const hand = this.hand();
    c.orb.position.copy(hand);
    c.orb.scale.setScalar((c.kind === 'fireball' ? 0.5 + k * 1.3 : 0.35 + k * 0.7) * (1 + Math.sin(this.time * 30) * 0.08));
    // частицы стягиваются к руке: чем сильнее заряд, тем гуще и быстрее
    const n = 1 + Math.round(k * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = rand(-0.6, 0.9), r = rand(1.2, 2.2);
      const from = hand.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r));
      const life = rand(0.22, 0.35) / (1 + k);
      fx.particle({ pos: from, vel: hand.clone().sub(from).divideScalar(life), life, size: rand(0.05, 0.09), color: Math.random() < 0.5 ? s.a : s.b, gravity: 0, shrink: false });
    }
    if (c.kind === 'fireball' && Math.random() < 0.6) fx.particle({ pos: hand.clone(), vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0.8, 1.8), rand(-0.4, 0.4)), life: 0.35, size: 0.07 + k * 0.05, color: Math.random() < 0.5 ? s.a : s.b, gravity: -1 });
    if (c.kind === 'spark' && Math.random() < 0.15 + k * 0.4) this.bolt(hand, hand.clone().add(new THREE.Vector3(rand(-0.7, 0.7), rand(-0.5, 0.6), rand(-0.7, 0.7))), s.a, 0.025, 0, 0.1);
    // полный заряд: звонкая вспышка и кольцо — «готово»
    if (k >= 1 && !c.full) {
      c.full = true;
      fx.flash(hand, s.b.clone(), 1.8, 0.3);
      fx.shock(hero.pos.clone().setY(hero.pos.y + 0.1), 2.6, s.a, 0.35, 0.12);
      fx.light(hand, s.css, 6, 6, 0.35);
      c.sound.full();
    }
  }

  // ---------- каст ----------

  /** Сотворить заклинание к точке at; k — заряд 0..1; power — урон или лечение с учётом силы предмета */
  cast(kind: SpellKind, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
    const p = power * chargeMult(k);
    switch (kind) {
      case 'spark': this.spark(a, p, at, k); break;
      case 'fireball': this.fireball(a, p, at, k); break;
      case 'icerain': this.icerain(a, p, at, k); break;
      case 'heal': this.heal(p, k); break;
    }
  }

  /** Общий миг удара: тишина перед ним, засветка, свет, тряска, стоп-кадр на полном заряде */
  private impact(kind: SpellKind, at: THREE.Vector3, k: number, light: number, shake: number): void {
    const fx = this.h.fx, s = SCHOOL[kind];
    duck(0.18, 0.25 + k * 0.2, 0.6);
    fx.screenFlash(s.css, 0.1 + k * 0.18, 0.14 + k * 0.1);
    fx.light(at.clone().setY(at.y + 1.6), s.css, light * (1 + k), 10 + k * 6, 0.45 + k * 0.25);
    fx.shake = Math.max(fx.shake, shake * (1 + k * 0.9));
    if (k > 0.6) fx.hitstop = Math.max(fx.hitstop, 0.05 + k * 0.04);
    this.impacts++;
  }

  /** Короткий замах для каста без зарядки (тап, клик по слоту): вспышка в руке и свист */
  private windup(kind: SpellKind, k: number): void {
    const s = SCHOOL[kind], hand = this.hand();
    this.h.fx.flash(hand, s.b.clone().multiplyScalar(0.8), 1 + k * 0.6, 0.2);
    this.h.fx.burst(hand, [s.a, s.b], 8, { speed: 1.5, up: 1, size: 0.06, life: 0.3, glow: true, gravity: 0 });
    spellSfx.release(kind, k);
  }

  /** Ближайшая живая цель к точке в радиусе r (кроме уже задетых) */
  private nearest(p: THREE.Vector3, r: number, skip: Set<Target> = new Set()): Target | null {
    let best: Target | null = null, bd = Infinity;
    for (const t of this.h.targets()) {
      if (!t.alive || skip.has(t)) continue;
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z) - t.radius;
      if (d < r && d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /** Точка на земле не дальше max от героя */
  private ground(at: THREE.Vector3, max: number): THREE.Vector3 {
    const hero = this.h.hero;
    const d = new THREE.Vector3(at.x - hero.pos.x, 0, at.z - hero.pos.z);
    if (d.length() > max) d.setLength(max);
    const p = hero.pos.clone().add(d);
    const y = this.h.terrain.floorAt(p.x, p.z, hero.pos.y + 3);
    p.y = Number.isFinite(y) ? y : hero.pos.y;
    return p;
  }

  // ---------- искра ----------

  /** Ломаная молния из светящихся брусков: ядро и мягкий ореол, мерцает и тает; branches — отростки */
  private bolt(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, width: number, branches: number, dur = 0.32): void {
    const g = new THREE.Group();
    const core = new THREE.MeshBasicMaterial({ color: C(3.6, 3.8, 4).lerp(color, 0.25), toneMapped: false, transparent: true });
    const halo = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.5), toneMapped: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const seg = (a: THREE.Vector3, b: THREE.Vector3, w: number): void => {
      const len = a.distanceTo(b);
      if (len < 1e-3) return;
      for (const [m, k] of [[core, 1], [halo, 3.5]] as const) {
        const o = new THREE.Mesh(UNIT, m);
        o.position.copy(a).lerp(b, 0.5);
        o.lookAt(b);
        o.scale.set(w * k, w * k, len);
        g.add(o);
      }
    };
    const path = (a: THREE.Vector3, b: THREE.Vector3, n: number, jag: number, w: number): THREE.Vector3[] => {
      const pts = [a.clone()];
      for (let i = 1; i < n; i++) pts.push(a.clone().lerp(b, i / n).add(new THREE.Vector3(rand(-jag, jag), rand(-jag, jag) * 0.5, rand(-jag, jag))));
      pts.push(b.clone());
      for (let i = 0; i < pts.length - 1; i++) seg(pts[i], pts[i + 1], w);
      return pts;
    };
    const len = from.distanceTo(to);
    const pts = path(from, to, Math.max(3, Math.round(len * 1.2)), Math.min(0.9, len * 0.07), width);
    for (let i = 0; i < branches; i++) {
      const p = pts[1 + Math.floor(Math.random() * (pts.length - 2))];
      path(p, p.clone().add(new THREE.Vector3(rand(-1.6, 1.6), rand(-1.8, -0.4), rand(-1.6, 1.6))), 3, 0.3, width * 0.55);
    }
    this.h.fx.custom(g, dur, (k) => {
      g.visible = k > 0.5 || Math.random() > 0.25; // мерцание
      core.opacity = 1 - k * k; halo.opacity = 0.5 * (1 - k);
      g.children.forEach((o) => { o.scale.x *= 0.97; o.scale.y *= 0.97; });
    }, () => { core.dispose(); halo.dispose(); });
  }

  private spark(a: ArtifactStats, dmg: number, at: THREE.Vector3, k: number): void {
    const fx = this.h.fx, s = SCHOOL.spark;
    const p = this.ground(at, a.radius ?? 12);
    const first = this.nearest(p, 2.5);
    const hitAt = first ? first.pos.clone() : p;
    this.face(hitAt);
    // замах: искры в руке, в небе над целью собирается свет и сыплются искорки
    this.windup('spark', k);
    spellSfx.sparkGather();
    const sky = hitAt.clone().setY(hitAt.y + 11);
    for (let i = 0; i < 10; i++) fx.particle({ pos: hitAt.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(4, 7), rand(-0.6, 0.6))), vel: new THREE.Vector3(0, -30, 0), life: rand(0.12, 0.2), size: 0.06, color: s.b, gravity: 0, shrink: false });
    fx.flash(sky.clone().setY(sky.y - 4), s.a, 3, 0.2);
    this.later(0.14, () => {
      // удар: молния с неба, засветка, раскат
      const top = hitAt.clone().setY(hitAt.y + (first ? 1 : 0.05));
      this.bolt(sky, top, s.a, 0.13 + k * 0.08, 3 + Math.round(k * 3), 0.35 + k * 0.1);
      this.bolt(sky.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0.5))), top, s.a, 0.04, 1, 0.25);
      this.impact('spark', hitAt, k, 14, 0.45);
      fx.flash(top, s.b.clone().multiplyScalar(0.8), 2.2 + k, 0.22);
      fx.shock(hitAt.clone().setY(hitAt.y + 0.05), 2.2 + k * 1.8, s.a, 0.35, 0.18);
      fx.burst(top, [s.a, s.b], 22 + Math.round(k * 20), { speed: 6 + k * 4, up: 4, size: 0.06, life: 0.45, glow: true, gravity: 8 });
      spellSfx.sparkStrike(k);
      fx.decal(hitAt, scorchTex(), '#ffffff', 1.8 + k, 3, false, 0.7);
      fx.decal(hitAt, glowTex(), s.a.clone().multiplyScalar(0.3), 2.2 + k, 0.9, true);
      if (first) this.h.damage(first, Math.round(dmg), this.h.hero.pos, 0.8 + k);
      // перескоки: каждый следующий чуть позже, слабее и выше по звуку
      const hit = new Set<Target>(first ? [first] : []);
      let prev = first, n = 0;
      const jumps = first ? 2 + Math.round(k * 3) : 0;
      const chain = (): void => {
        if (!prev || n >= jumps) return;
        const next = this.nearest(prev.pos, 5.5, hit);
        if (!next) return;
        const from = prev.pos.clone().setY(prev.pos.y + 1), to = next.pos.clone().setY(next.pos.y + 1);
        this.bolt(from, to, s.a, 0.05 + k * 0.03, 1, 0.28);
        fx.flash(to, s.b.clone().multiplyScalar(1.5), 2, 0.2);
        fx.burst(to, [s.a, s.b], 10, { speed: 4, up: 2, size: 0.05, life: 0.35, glow: true, gravity: 6 });
        spellSfx.sparkChain(n);
        hit.add(next);
        this.h.damage(next, Math.round(dmg * Math.pow(0.8, n + 1)), prev.pos, 0.5);
        prev = next; n++;
        this.later(0.08, chain);
      };
      this.later(0.08, chain);
      // послевкусие: по цели ещё секунду ползут искры
      let left = 1 + k * 0.6;
      this.procs.push((dt) => {
        left -= dt;
        if (Math.random() < 0.5) {
          const c = (first?.alive ? first.pos : hitAt).clone().setY(hitAt.y + rand(0.1, 1.6));
          const e = c.clone().add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.4, 0.4), rand(-0.5, 0.5)));
          if (Math.random() < 0.3) this.bolt(c, e, s.a, 0.02, 0, 0.08);
          fx.particle({ pos: c, vel: new THREE.Vector3(rand(-2, 2), rand(1, 3), rand(-2, 2)), life: 0.25, size: 0.04, color: s.b, gravity: 6 });
        }
        return left > 0;
      });
    });
  }

  // ---------- огненный шар ----------

  private fireball(a: ArtifactStats, dmg: number, at: THREE.Vector3, k: number): void {
    const fx = this.h.fx, s = SCHOOL.fireball, hero = this.h.hero;
    const size = 0.32 + k * 0.45, R = (a.radius ?? 2.2) + k * 1.8;
    this.face(at);
    this.windup('fireball', k);
    spellSfx.fireLaunch(k);
    // воксельный шар: белое ядро внутри оранжевой оболочки, ореол и свет летят вместе
    const g = new THREE.Group();
    const core = new THREE.Mesh(UNIT, new THREE.MeshBasicMaterial({ color: C(4, 3.4, 1.6), toneMapped: false }));
    const shell = new THREE.Mesh(UNIT, new THREE.MeshBasicMaterial({ color: C(3, 1, 0.2), toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.setScalar(size); shell.scale.setScalar(size * 1.6);
    const halo = new THREE.Sprite(additiveSprite(glowTex(), s.a.clone().multiplyScalar(0.3)));
    halo.scale.setScalar(size * 4);
    g.add(core, shell, halo);
    const start = this.hand();
    g.position.copy(start);
    this.h.scene.add(g);
    const light = fx.light(start, s.css, 5 + k * 4, 6, 3);
    const flat = new THREE.Vector3(at.x - hero.pos.x, 0, at.z - hero.pos.z);
    const dist = Math.max(2, Math.min(16, flat.length()));
    const dir = flat.lengthSq() > 0.01 ? flat.normalize() : new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
    const speed = 15 - k * 3;
    let traveled = 0, done = false;
    const explode = (p: THREE.Vector3): void => {
      done = true;
      this.h.scene.remove(g);
      core.material.dispose(); shell.material.dispose(); halo.material.dispose();
      light.intensity = 0;
      const y = this.h.terrain.floorAt(p.x, p.z, p.y + 0.5);
      const c = p.clone().setY(Number.isFinite(y) ? y : hero.pos.y);
      this.fireBoom(c, R, dmg, k);
    };
    this.procs.push((dt) => {
      if (done) return false;
      const prev = g.position.clone();
      const step = speed * dt;
      traveled += step;
      g.position.addScaledVector(dir, step);
      core.rotation.x += dt * 9; core.rotation.y += dt * 7;
      shell.rotation.x -= dt * 5; shell.rotation.z += dt * 6;
      shell.scale.setScalar(size * (1.5 + Math.sin(this.time * 40) * 0.15));
      light.position.copy(g.position); light.intensity = 5 + k * 4;
      // хвост: угли и искры
      for (let i = 0; i < 3 + k * 3; i++) fx.particle({ pos: g.position.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(size * 0.6)), vel: dir.clone().multiplyScalar(-rand(1, 3)).add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.4, 1.6), rand(-0.6, 0.6))), life: rand(0.25, 0.5), size: size * rand(0.25, 0.45), color: Math.random() < 0.5 ? s.a : s.b, gravity: -2 });
      if (Math.random() < 0.3) fx.flash(prev, s.a, size * 4, 0.15);
      // задел цель, упёрся в стену или долетел
      for (const t of this.h.targets()) if (t.alive && Math.hypot(t.pos.x - g.position.x, t.pos.z - g.position.z) < t.radius + size) { explode(g.position); return false; }
      const wall = this.h.terrain.wallHit(prev.x, prev.z, g.position.x, g.position.z, g.position.y - 0.4);
      if (wall) { explode(new THREE.Vector3(wall.x, g.position.y, wall.z)); return false; }
      if (traveled >= dist) { explode(g.position); return false; }
      return true;
    });
  }

  private fireBoom(c: THREE.Vector3, R: number, dmg: number, k: number): void {
    const fx = this.h.fx, s = SCHOOL.fireball;
    const mid = c.clone().setY(c.y + 0.8);
    this.impact('fireball', c, k, 18, 0.6);
    spellSfx.fireBoom(k);
    fx.flash(mid, s.b.clone().multiplyScalar(0.5), Math.min(6, R * 1.5), 0.3);
    for (let i = 0; i < 5; i++) fx.flash(mid.clone().add(new THREE.Vector3(rand(-R, R) * 0.5, rand(0, R * 0.5), rand(-R, R) * 0.5)), (i % 2 ? s.a : s.b).clone().multiplyScalar(0.5), R * rand(0.5, 0.8), rand(0.3, 0.45));
    // огненные кубы разлетаются от центра, раздуваются и гаснут
    const n = 10 + Math.round(k * 10);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(UNIT, new THREE.MeshBasicMaterial({ color: (Math.random() < 0.5 ? s.a : s.b).clone().multiplyScalar(0.8), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.1), rand(-1, 1)).normalize().multiplyScalar(R * rand(0.5, 1));
      const spin = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6));
      m.position.copy(mid);
      fx.custom(m, rand(0.35, 0.6), (t) => {
        const e = 1 - (1 - t) ** 3;
        m.position.copy(mid).addScaledVector(v, e);
        m.rotation.set(spin.x * t, spin.y * t, spin.z * t);
        m.scale.setScalar((0.25 + R * 0.18) * (0.6 + t * 1.2) * (1 - t * 0.6));
        (m.material as THREE.MeshBasicMaterial).opacity = 1 - t * t;
      }, () => (m.material as THREE.Material).dispose());
    }
    fx.burst(mid, [s.a, s.b, C(4, 3.6, 2.4)], 30 + Math.round(k * 30), { speed: R * 3, up: R * 1.6, size: 0.08, life: 0.7, glow: true, gravity: 5 });
    fx.shock(c, R * 1.1, s.a, 0.4, 0.25);
    fx.shock(c, R * 0.7, s.b, 0.3, 0.18);
    this.h.aoe(c, R, dmg, 1.8 + k * 1.8, true);
    // послевкусие: выжженное пятно, тлеющий свет, островки огня и угли ещё пару секунд
    fx.decal(c, scorchTex(), '#ffffff', R * 2.3, 4.5, false, 0.75);
    fx.decal(c, glowTex(), s.a.clone().multiplyScalar(0.3), R * 1.8, 2, true);
    const spots = Array.from({ length: 3 + Math.round(k * 4) }, () => c.clone().add(new THREE.Vector3(rand(-R, R) * 0.6, 0.05, rand(-R, R) * 0.6)));
    let left = 2.2 + k;
    this.procs.push((dt) => {
      left -= dt;
      for (const p of spots) if (Math.random() < 0.35 * Math.min(1, left)) fx.particle({ pos: p.clone().add(new THREE.Vector3(rand(-0.2, 0.2), 0, rand(-0.2, 0.2))), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1, 2.2), rand(-0.2, 0.2)), life: rand(0.3, 0.6), size: rand(0.06, 0.12), color: Math.random() < 0.6 ? s.a : s.b, gravity: -1.5 });
      return left > 0;
    });
  }

  // ---------- ледяной дождь ----------

  private icerain(a: ArtifactStats, dmg: number, at: THREE.Vector3, k: number): void {
    const fx = this.h.fx, s = SCHOOL.icerain;
    const c = this.ground(at, 12);
    const R = (a.radius ?? 3) + k * 2, dur = a.duration ?? 2, count = 14 + Math.round(k * 20), tele = 0.45;
    this.face(c);
    this.windup('icerain', k);
    spellSfx.iceCall();
    // замах: морозный круг рун растёт на земле, вверх тянется дымка, высоко кружит иней
    // круг на месте удара раскрывается за время замаха, держится весь дождь и расходится в конце
    const sigil = new Sigil('icerain', R, s.a, s.b, 0.3);
    sigil.group.position.copy(c);
    this.h.scene.add(sigil.group);
    let st = 0;
    this.procs.push((dt) => {
      st += dt;
      sigil.update(dt, Math.min(1, st / tele), st > tele);
      if (st < tele + dur) return true;
      sigil.burst(fx, 0.6);
      return false;
    });
    let tele0 = tele;
    this.procs.push((dt) => {
      tele0 -= dt;
      for (let i = 0; i < 3; i++) {
        const a2 = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
        fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a2) * r, 0.1, Math.sin(a2) * r)), vel: new THREE.Vector3(0, rand(0.6, 1.4), 0), life: 0.6, size: 0.07, color: s.b, gravity: -0.5 });
        const a3 = this.time * 4 + Math.random() * Math.PI * 2;
        fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a3) * R * 0.8, 7.5, Math.sin(a3) * R * 0.8)), vel: new THREE.Vector3(-Math.sin(a3) * 5, 0, Math.cos(a3) * 5), life: 0.4, size: 0.1, color: s.a, gravity: 0 });
      }
      return tele0 > 0;
    });
    this.later(tele, () => {
      // удар: первая волна сосулек разом, хрустальный аккорд
      this.impact('icerain', c, k, 10, 0.4);
      spellSfx.iceImpact(k);
      fx.shock(c, R * 1.15, s.a, 0.45, 0.2);
      fx.flash(c.clone().setY(c.y + 1), s.b.clone().multiplyScalar(0.5), R * 1.2, 0.3);
      for (let i = 0; i < 6; i++) this.icicle(c, R, 0);
      for (let i = 0; i < count; i++) this.icicle(c, R, rand(0.05, dur));
      // урон волнами
      const ticks = Math.max(1, Math.round(dur / 0.4));
      for (let i = 0; i < ticks; i++) this.later(0.25 + i * 0.4, () => this.h.aoe(c, R, Math.round(dmg), 0.25, false));
      // послевкусие: иней на земле и стелющийся холодный туман
      fx.decal(c, frostTex(), s.a.clone().multiplyScalar(0.2), R * 2.4, dur + 3, true, 0.8);
      let left = dur + 1.5;
      this.procs.push((dt) => {
        left -= dt;
        if (Math.random() < 0.7) {
          const a2 = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
          fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a2) * r, 0.15, Math.sin(a2) * r)), vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0.1, 0.4), rand(-0.4, 0.4)), life: 1.1, size: rand(0.1, 0.18), color: s.b.clone().multiplyScalar(0.5), gravity: -0.1, drag: 1 });
        }
        return left > 0;
      });
    });
  }

  /** Сосулька падает с неба в случайную точку круга и разбивается */
  private icicle(c: THREE.Vector3, R: number, delay: number): void {
    this.later(delay, () => {
      const fx = this.h.fx, s = SCHOOL.icerain;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
      const p = c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      const m = new THREE.Mesh(ICICLE, icicleMat);
      const sc = rand(0.8, 1.5);
      m.scale.setScalar(sc);
      m.rotation.y = Math.random() * Math.PI;
      const fall = 0.28, top = 9;
      let landed = false;
      fx.custom(m, fall + 0.6, (t) => {
        const tt = t * (fall + 0.6);
        if (tt < fall) { m.position.set(p.x, p.y + 0.5 * sc + top * (1 - tt / fall) ** 1.6, p.z); return; }
        if (!landed) {
          landed = true;
          fx.burst(p.clone().setY(p.y + 0.15), [s.a, s.b], 6, { speed: 3, up: 3, size: 0.06, life: 0.4, glow: true, gravity: 12 });
          fx.burst(p.clone().setY(p.y + 0.15), ['#e8f8ff', '#bfe6ff'], 3, { speed: 2.5, up: 3, size: 0.08, life: 0.6 });
          fx.flash(p.clone().setY(p.y + 0.3), s.b, 0.9, 0.15);
          spellSfx.iceShard();
        }
        // воткнулась и уходит в землю
        const e = (tt - fall) / 0.6;
        m.position.set(p.x, p.y + 0.5 * sc - e * 0.9 * sc, p.z);
      }, () => { /* общие форма и материал */ });
    });
  }

  // ---------- лечение ----------

  private heal(amount: number, k: number): void {
    const fx = this.h.fx, s = SCHOOL.heal, hero = this.h.hero;
    // замах: листья и лепестки малины по спирали стягиваются к герою
    this.windup('heal', k);
    const at = (): THREE.Vector3 => hero.pos.clone();
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2, r = 2.2, life = 0.22;
      const from = at().add(new THREE.Vector3(Math.cos(a) * r, rand(0.2, 1.6), Math.sin(a) * r));
      const to = at().setY(hero.pos.y + 1);
      const v = to.sub(from).divideScalar(life).add(new THREE.Vector3(-Math.sin(a) * 4, 0, Math.cos(a) * 4));
      fx.particle({ pos: from, vel: v, life, size: 0.08, color: i % 3 === 0 ? PINK : s.a, gravity: 0, shrink: false });
    }
    this.later(0.22, () => {
      const c = at();
      this.impact('heal', c, k, 8, 0.15);
      spellSfx.healCast(k);
      const before = hero.hp;
      hero.hp = Math.min(hero.maxHp, hero.hp + amount);
      fx.text(c.clone().setY(c.y + 0.8), `+${Math.round(hero.hp - before)}`, 'healbig');
      // столп света, кольца и лепестки вверх
      const beam = lightBeam(s.a.clone().lerp(s.b, 0.3).multiplyScalar(0.55), 7, 1.6 + k * 1.2);
      beam.group.position.copy(c);
      fx.custom(beam.group, 1.3 + k * 0.4, (t) => {
        beam.group.position.copy(hero.pos);
        beam.group.scale.set(1 - t * 0.6, Math.min(1, t * 8), 1 - t * 0.6);
        beam.mats.forEach((m) => { m.opacity = (1 - t) ** 1.5; });
      }, () => { beam.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); beam.mats.forEach((m) => m.dispose()); });
      fx.shock(c.clone().setY(c.y + 0.05), 3 + k * 1.5, s.a, 0.5, 0.15);
      fx.shock(c.clone().setY(c.y + 0.05), 2 + k, s.b, 0.4, 0.1);
      fx.flash(c.clone().setY(c.y + 1), s.a.clone().multiplyScalar(0.6), 2.4 + k, 0.35);
      fx.burst(c.clone().setY(c.y + 0.4), [s.a, s.b, PINK], 26 + Math.round(k * 20), { speed: 2.5, up: 5, size: 0.08, life: 1, glow: true, gravity: 2 });
      fx.decal(c, glowTex(), s.a.clone().multiplyScalar(0.35), 3.5 + k * 2, 2.2, true);
      // послевкусие: лепестки медленно кружат и падают вокруг героя
      let left = 2 + k;
      this.procs.push((dt) => {
        left -= dt;
        if (Math.random() < 0.6 * Math.min(1, left)) {
          const a = Math.random() * Math.PI * 2, r = rand(0.3, 1.6);
          _v.set(hero.pos.x + Math.cos(a) * r, hero.pos.y + rand(2, 3), hero.pos.z + Math.sin(a) * r);
          fx.particle({ pos: _v, vel: new THREE.Vector3(rand(-0.5, 0.5), -0.3, rand(-0.5, 0.5)), life: 1.6, size: rand(0.05, 0.08), color: Math.random() < 0.5 ? PINK : s.a, gravity: 0.8, drag: 1.5, spin: 4 });
        }
        return left > 0;
      });
    });
  }

  // ---------- цикл ----------

  update(dt: number, aim: THREE.Vector3): void {
    this.time += dt;
    if (this.charge && this.h.hero.down) this.cancel();
    this.updateCharge(dt, aim);
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].t <= this.time) { const j = this.jobs[i]; this.jobs.splice(i, 1); j.fn(); }
    for (let i = this.procs.length - 1; i >= 0; i--) if (!this.procs[i](dt)) this.procs.splice(i, 1);
  }
}
