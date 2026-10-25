import * as THREE from 'three';
import type { FX } from './fx';
import type { AuraStats, OffenseKind } from './items';
import type { Knight } from './knight';
import { spellSfx } from './spell-audio';
import type { Target } from './target';

/**
 * Наступательные ауры (wiki/design-spells.md, раздел 4): сами бьют врагов вокруг героя — жгут, морозят, бьют молнией,
 * зовут луч, слабят, толкают землёй, режут клинками. Урон за раз — сила предмета (value), остальное — здесь, в OFF.
 * Вспышка (R) — ×3: где урон за раз, там урон ×3, где ритм — там чаще. Урон своей ауры копит шкалу вполовину.
 */

export const OFFENSE: readonly OffenseKind[] = ['inferno', 'frost', 'storm', 'halo', 'shade', 'quake', 'blades'];
export const isOffense = (k: string | null): k is OffenseKind => !!k && (OFFENSE as readonly string[]).includes(k);

/** Ритм, радиусы и прочие числа; вспышка — поля flare… */
export const OFF = {
  /** Жжёт всех в reach м каждые every с */
  inferno: { every: 0.5, reach: 2.5, flareReach: 4 },
  /** Холод и замедление slow на slowFor с; вспышка — заморозка freeze с */
  frost: { every: 0.5, reach: 3, slow: 0.3, slowFor: 1, flareReach: 4, flareSlow: 0.6, freeze: 1.2 },
  /** Молния в случайного врага в reach м, перескоки jumps на jumpR м, каждый — jumpK урона */
  storm: { every: 1.2, flareEvery: 0.4, reach: 5, jumps: 2, jumpR: 3, jumpK: 0.6 },
  /** Луч в цель на каждый nth удар героя (во вспышке — на каждый), бьёт и соседей в splash м */
  halo: { nth: 4, splash: 0.9 },
  /** Ослабляет врагов в reach м; вспышка — тянет drain урона каждые every с, heal из него — герою */
  shade: { every: 0.5, reach: 3, flareReach: 4, drain: 4, heal: 0.5 },
  /** Толчок каждые every с: урон и отброс knock в reach м */
  quake: { every: 3, flareEvery: 1, reach: 2.2, flareReach: 3.5, knock: 1.2 },
  /** n клинков на радиусе r, spin рад/с; одну цель режет не чаще hitCd с */
  blades: { n: 3, flareN: 6, r: 1.3, flareR: 1.8, spin: 3, flareSpin: 5, hitCd: 0.4, reach: 0.55 },
} as const;

/** Радиус, на котором аура бьёт (для карточки и тестов) */
export const offenseReach = (k: OffenseKind): number => {
  switch (k) {
    case 'inferno': return OFF.inferno.reach;
    case 'frost': return OFF.frost.reach;
    case 'storm': return OFF.storm.reach;
    case 'halo': return 0;
    case 'shade': return OFF.shade.reach;
    case 'quake': return OFF.quake.reach;
    case 'blades': return OFF.blades.r;
  }
};

const fmt = (v: number): string => String(Math.round(v * 10) / 10).replace('.', ',');

/** Строки карточки ауры (инвентарь, лавка): [иконка, текст]; k — множитель силы предмета */
export function auraLines(a: AuraStats, k: number, icon: string): [string, string][] {
  const v = Math.round(a.value * k);
  const what: Record<string, string> = {
    pact: `${v}% урона возвращается здоровьем`, bastion: `−${v}% получаемого урона`, rage: `+${v}% урона и +10% шанс крита`,
    clarity: `−${v}% перезарядки заклинаний и артефактов, +50% душ`, thorns: `${v}% урона от ближнего удара — обратно врагу`,
    inferno: `Жжёт всех в ${fmt(OFF.inferno.reach)} м: ${v} урона каждые ${fmt(OFF.inferno.every)} с`,
    frost: `${v} урона каждые ${fmt(OFF.frost.every)} с и −${OFF.frost.slow * 100}% скорости врагам в ${OFF.frost.reach} м`,
    storm: `Молния каждые ${fmt(OFF.storm.every)} с: ${v} урона и ${OFF.storm.jumps} перескока`,
    halo: `Каждый ${OFF.halo.nth}-й удар — луч с неба: ${v} урона`,
    shade: `Враги в ${OFF.shade.reach} м получают +${v}% урона`,
    quake: `Толчок каждые ${OFF.quake.every} с: ${v} урона и отброс в ${fmt(OFF.quake.reach)} м`,
    blades: `${OFF.blades.n} клинка кружат и режут: ${v} урона`,
  };
  const flare: Partial<Record<string, string>> = {
    inferno: `радиус ${OFF.inferno.flareReach} м, урон ×3`, frost: `заморозка на ${fmt(OFF.frost.freeze)} с, урон ×3`,
    storm: `молния каждые ${fmt(OFF.storm.flareEvery)} с`, halo: 'луч на каждый удар', shade: 'ослабление ×3, тень пьёт жизнь',
    quake: 'толчок каждую секунду, каменные шипы', blades: `${OFF.blades.flareN} клинков, круг шире`,
  };
  return [
    [icon, what[a.kind]],
    isOffense(a.kind) ? ['e-star', `Вспышка: ${flare[a.kind]}`] : ['e-star', `Союзники в радиусе ${a.radius} м тоже под аурой`],
    ['e-clock', 'Урон копит шкалу ауры; полная — <b>R</b>: вспышка ×3 на 5 с'],
  ];
}

export interface OffenseHooks {
  scene: THREE.Scene;
  fx: FX;
  hero: Knight;
  targets(): Target[];
  damage(t: Target, dmg: number, from: THREE.Vector3, knock: number): void;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const glowMat = (c: THREE.Color, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

export class AuraOffense {
  kind: OffenseKind | null = null;
  /** Урон за раз с учётом силы предмета (у тени — % ослабления) */
  private v = 0;
  /** Множитель силы предмета */
  private pw = 1;
  private a = new THREE.Color();
  private b = new THREE.Color();
  private tick = 0;
  private time = 0;
  /** Удары героя для ореола */
  private strikes = 0;
  private spin = 0;
  private readonly cut = new Map<Target, number>();
  /** Кольцо по краю зоны: видно, докуда бьёт; вспыхивает на каждом пульсе */
  private zone: THREE.Mesh | null = null;
  private zoneMat: THREE.MeshBasicMaterial | null = null;
  private pulse = 0;
  private readonly objs: THREE.Object3D[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  /** Сейчас бьёт сама аура: шкала копится вполовину, ореол не считает удар */
  own = false;
  /** Нанесено аурой и сколько раз (для тестов) */
  dealt = 0;
  procs = 0;

  constructor(private readonly h: OffenseHooks) {}

  set(kind: OffenseKind | null, value: number, pw: number, a: THREE.Color, b: THREE.Color): void {
    this.v = value; this.pw = pw;
    if (kind === this.kind) return;
    this.clear();
    this.kind = kind;
    this.a.copy(a); this.b.copy(b);
    this.tick = 0.3; this.strikes = 0; this.cut.clear();
    if (kind === 'inferno' || kind === 'frost' || kind === 'shade' || kind === 'quake') {
      const geo = new THREE.RingGeometry(0.93, 1, 64);
      this.geos.push(geo);
      this.zoneMat = glowMat(a.clone().multiplyScalar(0.5), 0.35);
      this.mats.push(this.zoneMat);
      this.zone = new THREE.Mesh(geo, this.zoneMat);
      this.zone.rotation.x = -Math.PI / 2;
      this.zone.renderOrder = 2;
      this.objs.push(this.zone); this.h.scene.add(this.zone);
    }
    if (kind === 'blades') {
      // призрачный меч: клинок, гарда, рукоять — лежит по касательной к кругу
      // плоский широкий клинок — сверху камеры читается как меч; цвет без засветки, кромка светится
      const blade = new THREE.BoxGeometry(0.15, 0.03, 0.85), edge = new THREE.BoxGeometry(0.05, 0.035, 0.8);
      const guard = new THREE.BoxGeometry(0.36, 0.05, 0.07), grip = new THREE.BoxGeometry(0.07, 0.05, 0.2);
      this.geos.push(blade, edge, guard, grip);
      const mb = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.62, 0.92), toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false });
      const me = glowMat(a.clone().multiplyScalar(0.5), 0.9), mg = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.82, 0.4), toneMapped: false });
      this.mats.push(mb, me, mg);
      for (let i = 0; i < OFF.blades.flareN; i++) {
        const g = new THREE.Group();
        const m1 = new THREE.Mesh(blade, mb); m1.position.z = 0.26;
        const m0 = new THREE.Mesh(edge, me); m0.position.set(0, 0.01, 0.28);
        const m2 = new THREE.Mesh(guard, mg); m2.position.z = -0.17;
        const m3 = new THREE.Mesh(grip, mg); m3.position.z = -0.3;
        g.add(m1, m0, m2, m3);
        g.renderOrder = 3;
        this.objs.push(g); this.h.scene.add(g);
      }
    }
    if (kind === 'halo') {
      const ring = new THREE.TorusGeometry(0.32, 0.035, 6, 28);
      this.geos.push(ring);
      const m = glowMat(a.clone().multiplyScalar(0.6), 0.9);
      this.mats.push(m);
      const mesh = new THREE.Mesh(ring, m);
      mesh.rotation.x = Math.PI / 2;
      this.objs.push(mesh); this.h.scene.add(mesh);
    }
  }

  clear(): void {
    for (const o of this.objs) this.h.scene.remove(o);
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    this.objs.length = 0; this.mats.length = 0; this.geos.length = 0;
    this.zone = null; this.zoneMat = null;
    this.kind = null;
  }

  /** Живые враги (не бочки и ящики) в r м от c */
  private foes(c: THREE.Vector3, r: number): Target[] {
    return this.h.targets().filter((t) => t.alive && !t.prop && Math.hypot(t.pos.x - c.x, t.pos.z - c.z) - t.radius <= r);
  }

  private hurt(t: Target, dmg: number, knock: number): void {
    const v = Math.max(1, Math.round(dmg));
    this.own = true;
    this.h.damage(t, v, this.h.hero.pos, knock);
    this.own = false;
    this.dealt += v;
  }

  // ---------- события ----------

  /** Герой ударил (не сама аура): ореол считает удары */
  onDealt(at: THREE.Vector3 | undefined, flare: boolean): void {
    if (this.kind !== 'halo' || this.own || !at) return;
    this.strikes++;
    if (!flare && this.strikes % OFF.halo.nth !== 0) return;
    this.beam(at);
  }

  /** R: вспышка началась */
  onFlare(): void {
    const fx = this.h.fx, hero = this.h.hero, c = hero.pos;
    this.tick = 0;
    if (this.kind === 'inferno') {
      fx.fireCubes(c.clone().setY(c.y + 0.3), OFF.inferno.flareReach, 18, [this.a.clone().multiplyScalar(0.45), this.b.clone().multiplyScalar(0.45)], 0.5, false, [0.4, 0.7]);
    }
    if (this.kind === 'frost') {
      // заморозка: всё в круге застывает, лёд трескается
      for (const t of this.foes(c, OFF.frost.flareReach)) {
        t.stun?.(OFF.frost.freeze);
        t.chill?.(OFF.frost.flareSlow, OFF.frost.freeze + 1);
        fx.burst(t.pos.clone().setY(t.pos.y + 0.8), [this.a, this.b, '#ffffff'], 14, { speed: 2.5, up: 2, size: 0.1, life: 0.6, glow: true, gravity: 6 });
      }
      fx.shock(c.clone().setY(c.y + 0.08), OFF.frost.flareReach, this.b, 0.5, 0.18);
      spellSfx.iceImpact(0.5);
    }
  }

  // ---------- кадр ----------

  update(dt: number, flare: boolean): void {
    if (!this.kind) return;
    this.time += dt;
    const hero = this.h.hero;
    this.tick -= dt;
    switch (this.kind) {
      case 'inferno': this.inferno(flare); break;
      case 'frost': this.frost(flare); break;
      case 'storm': this.storm(flare); break;
      case 'halo': this.halo(flare); break;
      case 'shade': this.shade(flare); break;
      case 'quake': this.quake(flare); break;
      case 'blades': this.blades(dt, flare); break;
    }
    if (hero.down) this.tick = Math.max(this.tick, 0.3);
    if (this.zone && this.zoneMat) {
      const k = this.kind, R = k === 'inferno' ? (flare ? OFF.inferno.flareReach : OFF.inferno.reach)
        : k === 'frost' ? (flare ? OFF.frost.flareReach : OFF.frost.reach)
          : k === 'shade' ? (flare ? OFF.shade.flareReach : OFF.shade.reach) : (flare ? OFF.quake.flareReach : OFF.quake.reach);
      this.pulse = Math.max(0, this.pulse - dt * 4);
      // толчок земли: кольцо разбегается от центра; остальные — дышат
      const grow = k === 'quake' ? 1 - this.pulse * 0.6 : 1 + this.pulse * 0.06;
      this.zone.visible = !hero.down;
      this.zone.position.set(hero.pos.x, hero.pos.y + 0.07, hero.pos.z);
      this.zone.scale.setScalar(R * grow);
      this.zoneMat.opacity = (flare ? 0.55 : 0.3) + Math.sin(this.time * 3) * 0.05 + this.pulse * 0.5;
    }
  }

  private inferno(flare: boolean): void {
    const fx = this.h.fx, c = this.h.hero.pos, R = flare ? OFF.inferno.flareReach : OFF.inferno.reach;
    // кольцо углей: языки пламени поднимаются по кругу
    for (let i = 0, n = flare ? 3 : 1 + (Math.random() < 0.5 ? 1 : 0); i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = R * rand(0.55, 1);
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.08, Math.sin(a) * r)), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1, 2.2), rand(-0.2, 0.2)), life: rand(0.3, 0.6), size: rand(0.06, 0.12), color: Math.random() < 0.6 ? this.a : this.b, gravity: -1.5 });
    }
    if (this.tick > 0 || this.h.hero.down) return;
    this.tick += OFF.inferno.every;
    this.pulse = 1;
    const hit = this.foes(c, R);
    for (const t of hit) {
      this.hurt(t, this.v * (flare ? 3 : 1), 0.05);
      fx.burst(t.pos.clone().setY(t.pos.y + rand(0.4, 1)), [this.a, this.b], 5, { speed: 1.2, up: 2.2, size: 0.08, life: 0.45, glow: true, gravity: -1 });
    }
    if (hit.length) { this.procs++; spellSfx.auraBurn(); }
  }

  private frost(flare: boolean): void {
    const fx = this.h.fx, c = this.h.hero.pos, R = flare ? OFF.frost.flareReach : OFF.frost.reach;
    // снежинки кружат и опускаются, иней у ног
    if (Math.random() < (flare ? 0.9 : 0.45)) {
      const a = this.time * 1.5 + Math.random() * Math.PI * 2, r = R * rand(0.3, 1);
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(0.8, 1.8), Math.sin(a) * r)), vel: new THREE.Vector3(-Math.sin(a) * 0.8, -0.6, Math.cos(a) * 0.8), life: rand(0.6, 1), size: rand(0.05, 0.08), color: Math.random() < 0.5 ? this.a : this.b, gravity: 0 });
    }
    if (this.tick > 0 || this.h.hero.down) return;
    this.tick += OFF.frost.every;
    this.pulse = 1;
    const hit = this.foes(c, R);
    for (const t of hit) {
      this.hurt(t, this.v * (flare ? 3 : 1), 0);
      t.chill?.(flare ? OFF.frost.flareSlow : OFF.frost.slow, OFF.frost.slowFor);
      fx.burst(t.pos.clone().setY(t.pos.y + rand(0.3, 1)), [this.b, '#ffffff'], 4, { speed: 1, up: 0.5, size: 0.07, life: 0.4, glow: true, gravity: 2 });
    }
    if (hit.length) { this.procs++; spellSfx.auraChill(); }
  }

  private storm(flare: boolean): void {
    const fx = this.h.fx, hero = this.h.hero, c = hero.pos;
    // искры бегут по доспеху
    if (Math.random() < (flare ? 0.8 : 0.35)) {
      const a = Math.random() * Math.PI * 2;
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * 0.35, rand(0.5, 1.6), Math.sin(a) * 0.35)), vel: new THREE.Vector3(Math.cos(a) * rand(0.5, 1.5), rand(-0.5, 1), Math.sin(a) * rand(0.5, 1.5)), life: rand(0.08, 0.2), size: rand(0.04, 0.07), color: Math.random() < 0.6 ? this.a : this.b, gravity: 0, shrink: false });
    }
    if (this.tick > 0 || hero.down) return;
    const near = this.foes(c, OFF.storm.reach);
    if (!near.length) { this.tick = 0.15; return; }
    this.tick += flare ? OFF.storm.flareEvery : OFF.storm.every;
    // молния с плеча в случайного врага и дальше перескоками
    let from = c.clone().setY(c.y + 1.6), t = near[(Math.random() * near.length) | 0], dmg = this.v;
    const done = new Set<Target>();
    for (let i = 0; i <= OFF.storm.jumps && t; i++) {
      done.add(t);
      const to = t.pos.clone().setY(t.pos.y + 1);
      fx.bolt(from, to, this.a, i ? 0.06 : 0.09, i ? 1 : 2, 0.25);
      fx.flash(to, this.b.clone().multiplyScalar(0.6), 1.6, 0.15);
      this.hurt(t, dmg, 0.3);
      if (i) spellSfx.sparkChain(i - 1);
      from = to; dmg *= OFF.storm.jumpK;
      let best: Target | null = null, bd: number = OFF.storm.jumpR;
      for (const n of this.foes(t.pos, OFF.storm.jumpR)) {
        if (done.has(n)) continue;
        const d = Math.hypot(n.pos.x - t.pos.x, n.pos.z - t.pos.z);
        if (d < bd) { bd = d; best = n; }
      }
      t = best as Target;
    }
    this.procs++;
    spellSfx.auraZap();
  }

  private halo(flare: boolean): void {
    const hero = this.h.hero, ring = this.objs[0];
    if (!ring) return;
    ring.position.set(hero.pos.x, hero.pos.y + 2.15 + Math.sin(this.time * 2) * 0.04, hero.pos.z);
    ring.rotation.z = this.time * (flare ? 2 : 0.7);
    ring.scale.setScalar(flare ? 1.25 : 1);
    if (Math.random() < (flare ? 0.6 : 0.2)) {
      const a = Math.random() * Math.PI * 2;
      this.h.fx.particle({ pos: ring.position.clone().add(new THREE.Vector3(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32)), vel: new THREE.Vector3(0, -0.4, 0), life: 0.4, size: 0.05, color: this.b, gravity: 0 });
    }
  }

  /** Луч с неба в точку at: бьёт всех в splash м */
  private beam(at: THREE.Vector3): void {
    const fx = this.h.fx, p = at.clone().setY(this.h.hero.pos.y);
    const geo = new THREE.CylinderGeometry(0.22, 0.22, 9, 10, 1, true), mat = glowMat(this.a.clone().multiplyScalar(0.7));
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(p).setY(p.y + 4.5);
    this.h.scene.add(m);
    fx.custom(m, 0.35, (k) => { m.scale.set(1 + k * 0.6, 1, 1 + k * 0.6); mat.opacity = (1 - k) ** 1.5; });
    fx.flash(p.clone().setY(p.y + 0.6), this.b.clone().multiplyScalar(0.7), 2.4, 0.2);
    fx.shock(p.clone().setY(p.y + 0.06), 1.2, this.a, 0.3, 0.1);
    fx.burst(p.clone().setY(p.y + 0.2), [this.a, this.b], 10, { speed: 2.5, up: 3, size: 0.07, life: 0.5, glow: true, gravity: 4 });
    for (const t of this.foes(p, OFF.halo.splash)) this.hurt(t, this.v, 0.4);
    this.procs++;
    spellSfx.auraBeam();
  }

  private shade(flare: boolean): void {
    const fx = this.h.fx, hero = this.h.hero, c = hero.pos, R = flare ? OFF.shade.flareReach : OFF.shade.reach;
    // фиолетовая дымка у ног
    if (Math.random() < (flare ? 0.9 : 0.4)) {
      const a = Math.random() * Math.PI * 2, r = R * rand(0.2, 0.9);
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r)), vel: new THREE.Vector3(-Math.cos(a) * 0.3, rand(0.2, 0.6), -Math.sin(a) * 0.3), life: rand(0.6, 1), size: rand(0.08, 0.14), color: Math.random() < 0.7 ? this.a : this.b, gravity: -0.2 });
    }
    if (this.tick > 0 || hero.down) return;
    this.tick += OFF.shade.every;
    this.pulse = flare ? 1 : 0.4;
    const hit = this.foes(c, R);
    for (const t of hit) {
      t.expose?.((this.v / 100) * (flare ? 3 : 1), OFF.shade.every + 0.3);
      if (Math.random() < 0.5) fx.particle({ pos: t.pos.clone().setY(t.pos.y + (t.topY ?? 1.5) + 0.2), vel: new THREE.Vector3(0, 0.4, 0), life: 0.5, size: 0.09, color: this.a, gravity: 0 });
      if (!flare) continue;
      // во вспышке тень пьёт: капли дугой от врага к герою
      const dmg = OFF.shade.drain * this.pw;
      this.hurt(t, dmg, 0);
      if (!hero.down) hero.hp = Math.min(hero.maxHp, hero.hp + dmg * OFF.shade.heal);
      const to = c.clone().setY(c.y + 1);
      for (let i = 0; i < 3; i++) {
        const from = t.pos.clone().setY(t.pos.y + rand(0.6, 1.2)), life = rand(0.35, 0.5), g = -5;
        const v = to.clone().sub(from).divideScalar(life); v.y -= (g * life) / 2;
        fx.particle({ pos: from, vel: v, life, size: rand(0.05, 0.08), color: i % 2 ? this.a : this.b, gravity: g, shrink: false });
      }
    }
    if (hit.length) { this.procs++; if (flare) spellSfx.auraDrain(); }
  }

  private quake(flare: boolean): void {
    const fx = this.h.fx, hero = this.h.hero, c = hero.pos, R = flare ? OFF.quake.flareReach : OFF.quake.reach;
    // камешки подпрыгивают у ног; перед толчком — чаще
    const soon = this.tick < 0.4 ? 3 : 1;
    if (Math.random() < 0.12 * soon * (flare ? 2 : 1)) {
      const a = Math.random() * Math.PI * 2, r = rand(0.3, R * 0.8);
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r)), vel: new THREE.Vector3(0, rand(1, 2), 0), life: 0.4, size: rand(0.06, 0.1), color: Math.random() < 0.6 ? '#a8906a' : this.a, gravity: 9 }, false);
    }
    if (this.tick > 0 || hero.down) return;
    this.tick += flare ? OFF.quake.flareEvery : OFF.quake.every;
    this.pulse = 1;
    const g = c.clone().setY(c.y + 0.06);
    fx.shock(g, R, this.a, 0.4, 0.2);
    fx.burst(g, ['#a8906a', '#7a6a58', this.a], 16, { speed: 3, up: 3, size: 0.12, life: 0.55, gravity: 10 });
    fx.shake = Math.max(fx.shake, flare ? 0.3 : 0.18);
    if (flare) this.spikes(c, R);
    const hit = this.foes(c, R);
    for (const t of hit) this.hurt(t, this.v, OFF.quake.knock);
    this.procs++;
    spellSfx.auraStomp(flare);
  }

  /** Во вспышке толчок выпускает из земли кольцо каменных шипов */
  private spikes(c: THREE.Vector3, R: number): void {
    const geo = new THREE.ConeGeometry(0.16, 0.7, 4), mat = new THREE.MeshLambertMaterial({ color: '#8a7a64' });
    const g = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rand(-0.1, 0.1), r = R * rand(0.6, 0.95);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * r, 0.35, Math.sin(a) * r);
      m.rotation.set(rand(-0.25, 0.25), rand(0, 3), rand(-0.25, 0.25));
      m.castShadow = true;
      g.add(m);
    }
    g.position.set(c.x, c.y, c.z);
    this.h.scene.add(g);
    this.h.fx.custom(g, 0.7, (k) => { const s = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1; g.scale.set(1, Math.max(0.01, s), 1); });
  }

  private blades(dt: number, flare: boolean): void {
    const hero = this.h.hero, fx = this.h.fx, B = OFF.blades;
    const n = flare ? B.flareN : B.n, r = flare ? B.flareR : B.r;
    this.spin += dt * (flare ? B.flareSpin : B.spin);
    for (const [t, cd] of this.cut) { if (cd - dt <= 0) this.cut.delete(t); else this.cut.set(t, cd - dt); }
    const foes = hero.down ? [] : this.foes(hero.pos, r + B.reach + 0.5);
    let cutNow = false;
    this.objs.forEach((g, i) => {
      g.visible = i < n && !hero.down;
      if (!g.visible) return;
      const a = this.spin + (i / n) * Math.PI * 2;
      g.position.set(hero.pos.x + Math.cos(a) * r, hero.pos.y + 0.9 + Math.sin(this.time * 3 + i) * 0.08, hero.pos.z + Math.sin(a) * r);
      // остриём по ходу вращения
      g.rotation.set(0, -a, 0);
      if (Math.random() < (flare ? 0.5 : 0.25)) fx.particle({ pos: g.position.clone(), vel: new THREE.Vector3(0, 0.1, 0), life: 0.25, size: 0.06, color: i % 2 ? this.a : this.b, gravity: 0 });
      for (const t of foes) {
        if (this.cut.has(t) || Math.hypot(t.pos.x - g.position.x, t.pos.z - g.position.z) - t.radius > B.reach) continue;
        this.cut.set(t, B.hitCd);
        this.hurt(t, this.v, 0.25);
        fx.burst(t.pos.clone().setY(t.pos.y + 0.9), [this.a, this.b, '#ffffff'], 6, { speed: 2.5, up: 1.5, size: 0.06, life: 0.3, glow: true, gravity: 4 });
        cutNow = true;
      }
    });
    if (cutNow) { this.procs++; spellSfx.bladeCut(); }
  }
}
