import * as THREE from 'three';
import { resolveCircle } from '../collision.ts';
import { HERO } from '../tuning.ts';
import type { Target } from '../target.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { Field } from './field.ts';
import { Boss, C, glowMat, rand, RASP, UNIT, wrap, type BossHooks } from './kit.ts';

/**
 * Мини-босс в духе Minecraft Dungeons (wiki/design-bosses.md, раздел 1): тело из нескольких крупных кубов, не больше
 * восьми подвижных частей, двигается целиком (прыжок, наклон, шарканье). Сила боя — на полу: метки атак (круг, линия),
 * снаряды по дуге, опасные зоны, подручные. Здесь — общий мозг (сон → пробуждение → погоня и атаки → оглушение → смерть),
 * ярость на 50 %, метки, снаряды, зоны и подручные; у стража — модель, выбор атаки, ход атаки и поза.
 */

export type MiniState = 'sleep' | 'wake' | 'idle' | 'walk' | 'attack' | 'daze' | 'dead';

// ---------- подручные ----------

/** Подручный стража: два-три куба, идёт к герою и бьёт; цель для меча и заклинаний */
export class Minion implements Target {
  readonly pos = new THREE.Vector3();
  readonly group = new THREE.Group();
  readonly radius: number;
  readonly topY: number;
  hp: number;
  dead = false;
  private cd = 1;
  private flashT = 0;
  private hop = 0;
  private readonly mats: THREE.MeshLambertMaterial[] = [];
  /** Тает (призрак): прозрачность 0..1 */
  ghost = false;

  private readonly h: BossHooks;
  readonly look: { body: string; head: string; eye: THREE.Color; size?: number; hp?: number; dmg?: number; speed?: number; ghost?: boolean };
  constructor(h: BossHooks, at: THREE.Vector3, look: { body: string; head: string; eye: THREE.Color; size?: number; hp?: number; dmg?: number; speed?: number; ghost?: boolean }) { this.h = h; this.look = look;
    const s = look.size ?? 1;
    this.radius = 0.4 * s;
    this.topY = 1.5 * s;
    this.hp = look.hp ?? 30;
    this.ghost = !!look.ghost;
    this.pos.copy(at).setY(0);
    const lam = (c: string) => { const m = new THREE.MeshLambertMaterial({ color: c, transparent: this.ghost, opacity: this.ghost ? 0.55 : 1 }); this.mats.push(m); return m; };
    const body = new THREE.Mesh(UNIT, lam(look.body)); body.scale.set(0.7 * s, 0.8 * s, 0.5 * s); body.position.y = 0.55 * s; body.castShadow = true;
    const head = new THREE.Mesh(UNIT, lam(look.head)); head.scale.set(0.55 * s, 0.5 * s, 0.5 * s); head.position.y = 1.2 * s; head.castShadow = true;
    const eyes = new THREE.Mesh(UNIT, glowMat(look.eye)); eyes.scale.set(0.4 * s, 0.08 * s, 0.05 * s); eyes.position.set(0, 1.25 * s, 0.26 * s);
    for (const x of [-1, 1]) { const leg = new THREE.Mesh(UNIT, lam(look.head)); leg.scale.set(0.22 * s, 0.3 * s, 0.22 * s); leg.position.set(x * 0.17 * s, 0.15 * s, 0); this.group.add(leg); }
    this.group.add(body, head, eyes);
    this.group.position.copy(this.pos);
    h.scene.add(this.group);
    // появление: подпрыгивает из земли
    this.hop = 0.5;
  }

  get alive(): boolean { return !this.dead; }

  hit(dmg: number, dir: THREE.Vector3): void {
    if (this.dead) return;
    this.hp -= dmg;
    this.flashT = 0.1;
    this.pos.addScaledVector(dir, 0.3);
    if (this.hp <= 0) this.kill();
  }

  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.h.fx.burst(this.pos.clone().setY(0.8), [this.look.body, this.look.head, RASP], 14, { speed: 3, up: 3, size: 0.12, life: 0.6, gravity: 8 });
    this.h.scene.remove(this.group);
    for (const m of this.mats) m.dispose();
  }

  update(dt: number): void {
    if (this.dead) return;
    const hero = this.h.hero.pos, dx = hero.x - this.pos.x, dz = hero.z - this.pos.z, d = Math.hypot(dx, dz);
    const sp = (this.look.speed ?? 2.6) * dt;
    if (d > 0.9) { this.pos.x += (dx / d) * sp; this.pos.z += (dz / d) * sp; }
    const p = this.pos.clone();
    resolveCircle(p, this.radius, this.h.obstacles());
    this.pos.x = p.x; this.pos.z = p.z;
    this.cd -= dt;
    if (d < 1.3 && this.cd <= 0) { this.cd = 1.1; this.h.hurtHero(this.look.dmg ?? 6, this.pos, 2); this.hop = 0.25; }
    this.hop = Math.max(0, this.hop - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    for (const m of this.mats) m.emissive.setScalar(this.flashT > 0 ? 0.6 : 0);
    this.group.position.set(this.pos.x, Math.sin(this.hop * 12) * 0.15 + (d > 0.9 ? Math.abs(Math.sin(performance.now() * 0.012)) * 0.06 : 0), this.pos.z);
    this.group.rotation.y = Math.atan2(dx, dz);
  }
}

// ---------- мини-босс ----------

export abstract class MiniBoss extends Boss {
  state: MiniState = 'sleep';
  /** Текущая атака (state === 'attack') */
  attack = '';
  /** Время в состоянии */
  st = 0;
  /** Перезарядка между атаками */
  cd = 1.2;
  enraged = false;
  /** Скорость бега, м/с; разворот, рад/с */
  speed = 3.2;
  turn = 3;
  /** Держит дистанцию: ближний бой ~2,5 м, дальний — 7–9 м */
  keep = 2.5;
  /** Какой гримуар роняет (id предмета) */
  abstract readonly drop: string;
  /** Ступень: мини-босс, босс этажа (выбор из двух гримуаров), финальный */
  readonly tier: 'mini' | 'boss' | 'final' = 'mini';
  /** Ауры — второй гримуар у боссов этажа (выбор: заклинание или аура): [id ауры, шанс %], в сумме 100 */
  readonly auras: readonly (readonly [string, number])[] = [];
  /** Выпавшая аура этой победы: тянется один раз, сброс стража тянет заново */
  private auraPick: string | null = null;
  /** Аура этой победы по шансам */
  get aura(): string | null {
    if (!this.auras.length) return null;
    if (!this.auraPick) {
      let r = Math.random() * this.auras.reduce((a, [, w]) => a + w, 0);
      this.auraPick = this.auras[this.auras.length - 1][0];
      for (const [id, w] of this.auras) if ((r -= w) < 0) { this.auraPick = id; break; }
    }
    return this.auraPick;
  }
  /** Гримуары после победы: один, у боссов — пара на выбор */
  get drops(): string[] { const a = this.aura; return a ? [this.drop, a] : [this.drop]; }
  /** Малина из лопнувшего сердца: чем сильнее страж, тем больше — от здоровья, ступени, уровня и числа игроков */
  get berries(): number { return Math.round(this.baseHp / ({ mini: 20, boss: 10, final: 6 } as const)[this.tier] * this.lootMult); }
  readonly minions: Minion[] = [];
  protected flyY = 0;
  protected hitDone = false;
  protected deathT = 0;
  protected dazeFor = 0;
  /** Тело (всё, что качается и наклоняется); group — только позиция */
  protected readonly body = new THREE.Group();
  /** Метки, снаряды и зоны на полу */
  protected readonly field: Field;
  /** Тело твёрдое: расталкивает героя (под землёй, в тумане — нет) */
  protected get solid(): boolean { return true; }

  readonly arena: Rect;
  constructor(h: BossHooks, hp: number, home: THREE.Vector3, homeYaw: number, arena: Rect) {
    super(h, hp, home, homeYaw); this.arena = arena;
    this.field = new Field(this.h);
    this.setPlayers(1);
    this.group.add(this.body);
  }

  /** Модель в this.body; вызывается из конструктора стража */
  protected abstract build(): void;
  /** Выбор атаки, когда перезарядка вышла (null — идти дальше) */
  protected abstract choose(dist: number, rel: number): string | null;
  /** Ход атаки: t — время с начала; true — атака кончилась */
  protected abstract act(name: string, t: number, dt: number, dist: number): boolean;
  /** Поза частей тела по состоянию (раз в кадр) */
  protected abstract animate(dt: number, walk: boolean): void;
  /** Звук рыка или клича (проснулся, ярость) */
  protected cry(): void { if (!this.quiet) { boom(70, 30, 0.9, 0.5, 0, 0.5); hiss({ dur: 0.9, vol: 0.25, f: 400, f1: 1600, q: 0.6, type: 'lowpass', attack: 0.15, verb: 0.5 }); } }
  /** Ярость (50 %) — страж может добавить своё */
  protected onEnrage(): void { /* у стража */ }

  get quiet(): boolean { return this.h.quiet(); }
  get speedK(): number { return this.enraged ? 1.25 : 1; }
  /** Все цели стража: он сам и подручные */
  targets(): Target[] { return [...(this.alive && this.awake ? [this as Target] : []), ...this.minions.filter((m) => m.alive)]; }

  wake(): void {
    if (this.awake || this.dead) return;
    this.awake = true;
    this.go('wake');
  }

  reset(): void {
    this.hp = this.maxHp;
    this.dead = false; this.awake = false; this.heartOpen = false; this.enraged = false; this.auraPick = null;
    this.pos.copy(this.home); this.yaw = this.homeYaw; this.flyY = 0; this.deathT = 0; this.taken = 0; this.cd = 1.2;
    this.group.visible = true;
    this.body.scale.setScalar(1);
    this.body.rotation.set(0, 0, 0);
    this.clearField();
    this.go('sleep');
    this.place();
  }

  protected go(s: MiniState, attack = ''): void { this.state = s; this.attack = attack; this.st = 0; this.hitDone = false; }
  /** Оглушить: сердце открыто, урон ×2 */
  protected daze(sec: number): void { this.dazeFor = sec; this.go('daze'); }

  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.flyY > 2.2) return;
    super.hit(dmg, dir, point, knock);
  }

  protected override onHurt(): void {
    if (!this.enraged && this.hp > 0 && this.hp < this.maxHp * 0.5) {
      this.enraged = true;
      this.cry();
      this.h.fx.text(this.pos.clone().setY(this.topY + 1), 'ярость!', 'crit');
      this.h.fx.shock(this.pos.clone().setY(0.1), 5, RASP.clone().multiplyScalar(0.5), 0.5, 0.15);
      this.onEnrage();
    }
  }

  protected die(): void {
    this.heartOpen = false;
    this.flyY = 0;
    this.go('dead');
    for (const m of this.minions) m.kill();
    this.clearField();
    if (!this.quiet) { voice({ type: 'sawtooth', f: 110, f1: 40, dur: 1.4, vol: 0.08, detune: 15, lp: 1200, lp1: 200, verb: 0.6 }); boom(80, 25, 1.6, 0.7, 0.4, 0.6); }
    this.h.fx.slowmo = Math.max(this.h.fx.slowmo, 0.5);
  }

  // ---------- мозг ----------
  update(dt: number): void {
    this.st += dt;
    const hero = this.h.hero.pos;
    const dx = hero.x - this.pos.x, dz = hero.z - this.pos.z, dist = Math.hypot(dx, dz);
    const rel = wrap(Math.atan2(dx, dz) - this.yaw);
    let walk = false;
    this.heartOpen = false;
    switch (this.state) {
      case 'sleep': break;
      case 'wake':
        if (this.st > 0.5 && !this.hitDone) { this.hitDone = true; this.cry(); this.h.fx.shake = Math.max(this.h.fx.shake, 0.6); this.h.fx.shock(this.pos.clone().setY(0.1), 5, RASP.clone().multiplyScalar(0.4), 0.5, 0.12); }
        this.face(dt, 1.5);
        if (this.st > 1.6) this.go('idle');
        break;
      case 'idle':
      case 'walk': {
        this.cd -= dt;
        if (this.cd <= 0) {
          const a = this.choose(dist, rel);
          if (a) { this.go('attack', a); break; }
        }
        this.face(dt);
        // держит дистанцию: далеко — к герою, слишком близко (у дальних) — назад
        const sp = this.speed * this.speedK * dt;
        if (Math.abs(rel) < 1.3 && dist > this.keep + 0.4) { this.pos.x += (dx / dist) * sp; this.pos.z += (dz / dist) * sp; walk = true; }
        else if (this.keep > 4 && dist < this.keep - 2) { this.pos.x -= (dx / dist) * sp * 0.7; this.pos.z -= (dz / dist) * sp * 0.7; walk = true; }
        this.state = walk ? 'walk' : 'idle';
        break;
      }
      case 'attack':
        if (this.act(this.attack, this.st, dt, dist)) { if (this.state === 'attack') { this.cd = rand(0.6, 1.2) / this.speedK; this.go('idle'); } }
        break;
      case 'daze':
        this.heartOpen = this.st > 0.1;
        if (Math.random() < 0.25) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(this.time * 6) * 0.8, this.topY + 0.4, Math.sin(this.time * 6) * 0.8)), vel: new THREE.Vector3(0, 0.3, 0), life: 0.4, size: 0.1, color: RASP, gravity: 0 });
        if (this.st > this.dazeFor) { this.cd = 0.6; this.go('idle'); }
        break;
      case 'dead': this.dying(dt); break;
    }
    this.field.update(dt);
    for (let i = this.minions.length - 1; i >= 0; i--) { const m = this.minions[i]; m.update(dt); if (m.dead) this.minions.splice(i, 1); }
    // тело не проходит сквозь стены, героя расталкивает
    if (this.state !== 'dead' && this.flyY < 1) {
      const p = new THREE.Vector3(this.pos.x, 0, this.pos.z);
      resolveCircle(p, this.radius * 0.8, this.h.obstacles());
      const a = this.arena;
      this.pos.x = THREE.MathUtils.clamp(p.x, a.x0 + this.radius, a.x1 - this.radius);
      this.pos.z = THREE.MathUtils.clamp(p.z, a.z0 + this.radius, a.z1 - this.radius);
      if (this.state !== 'sleep' && this.solid) {
        const d = Math.hypot(hero.x - this.pos.x, hero.z - this.pos.z), R = this.radius + HERO.radius;
        if (d < R && d > 1e-3) { const k = (R - d) / d; hero.x += (hero.x - this.pos.x) * k; hero.z += (hero.z - this.pos.z) * k; }
      }
    }
    this.tickLook(dt, this.state === 'dead' ? Math.max(0.1, 1 - this.st) : this.state === 'sleep' ? 0.5 : this.enraged ? 1.35 : 1);
    this.animate(dt, walk);
    this.place();
  }

  protected place(): void {
    this.pos.y = this.flyY;
    this.group.position.set(this.pos.x, this.flyY, this.pos.z);
    this.group.rotation.y = this.yaw;
  }

  protected face(dt: number, k = 1): void {
    const hero = this.h.hero.pos;
    const d = wrap(Math.atan2(hero.x - this.pos.x, hero.z - this.pos.z) - this.yaw), m = this.turn * k * this.speedK * dt;
    this.yaw += Math.max(-m, Math.min(m, d));
  }

  /** Точка внутри арены (с отступом) */
  protected clampIn(p: THREE.Vector3, pad = 1.5): THREE.Vector3 {
    const a = this.arena;
    p.x = THREE.MathUtils.clamp(p.x, a.x0 + pad, a.x1 - pad);
    p.z = THREE.MathUtils.clamp(p.z, a.z0 + pad, a.z1 - pad);
    p.y = 0;
    return p;
  }

  private dying(dt: number): void {
    // заваливается, свет гаснет, на 1,2 с рассыпается малиновыми кубами — сердце лопается
    this.body.rotation.z = Math.min(1, this.st / 0.9) * 0.6;
    if (this.st > 1.2 && this.deathT === 0) {
      this.deathT = 1;
      const c = this.pos.clone().setY(this.topY * 0.5), fx = this.h.fx;
      fx.screenFlash('#ffb0d0', 0.35, 0.3);
      fx.burst(c, [RASP, C(4, 1.7, 2.4), C(4, 3.4, 2)], 40, { speed: 6, up: 5, size: 0.12, life: 1.1, glow: true, gravity: 3 });
      fx.shock(this.pos.clone().setY(0.1), 5, RASP, 0.5, 0.2);
      this.onDeath?.(new THREE.Vector3(this.pos.x, 0, this.pos.z));
    }
    if (this.deathT > 0) {
      this.deathT += dt;
      const k = Math.max(0, 1 - (this.deathT - 1) / 0.5);
      this.body.scale.setScalar(k);
      if (k <= 0) this.group.visible = false;
    }
  }

  // ---------- поле: метки, снаряды, зоны (src/bosses/field.ts) ----------
  /** Круг-метка: наливается dur секунд, потом done (там и бьют) */
  markCircle(at: THREE.Vector3, r: number, dur: number, done: () => void, color?: THREE.Color): void { this.field.markCircle(at, r, dur, done, color); }
  /** Полоса-метка от from вдоль dir */
  markLine(from: THREE.Vector3, dir: THREE.Vector3, len: number, w: number, dur: number, done: () => void, color?: THREE.Color): void { this.field.markLine(from, dir, len, w, dur, done, color); }
  /** Снаряд по дуге из from в to за dur с высотой h; land — на месте падения */
  lob(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, dur: number, h: number, trail: THREE.Color, land: (at: THREE.Vector3) => void): void { this.field.lob(mesh, from, to, dur, h, trail, land); }
  /** Опасная зона: dps урона в секунду, slow — замедление героя внутри */
  hazard(pos: THREE.Vector3, r: number, t: number, dps: number, color: THREE.Color, slow = 0): void { this.field.hazard(pos, r, t, dps, color, slow); }
  /** Замедление героя от зон (0..1) — плейграунд домножает скорость */
  get heroSlow(): number { return this.field.heroSlow; }
  /** Подручный рядом с точкой */
  summon(at: THREE.Vector3, look: ConstructorParameters<typeof Minion>[2]): Minion {
    const m = new Minion(this.h, this.clampIn(at.clone(), 1), look);
    this.minions.push(m);
    this.h.fx.burst(m.pos.clone().setY(0.3), [look.body, RASP], 12, { speed: 2.5, up: 3, size: 0.1, life: 0.5, gravity: 6 });
    return m;
  }

  private clearField(): void {
    this.field.clear();
    for (const m of this.minions.splice(0)) m.kill();
  }
}
