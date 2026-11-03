import * as THREE from 'three';
import { rnd } from './rng.ts';
import { makeCanvas } from './headless.ts';
import { AuraOffense, isOffense } from './aura-offense.ts';
import type { FX } from './fx.ts';
import { itemDef, powerMult, type AuraKind, type Item } from './items.ts';
import type { Knight } from './knight.ts';
import { additive, additiveSprite, glowTex } from './loot-look.ts';
import { Sigil } from './sigils.ts';
import { spellSfx } from './spell-audio.ts';
import type { Target } from './target.ts';

/**
 * Ауры (wiki/design-spells.md, раздел 4): четвёртое гнездо. Действуют всегда и видны вокруг героя — тусклый круг под ногами
 * и свой знак (щиты, огоньки, угли, нити). Урон героя копит шкалу; полная — R: вспышка ×3 на 5 с — большой круг раскрывается
 * весь, удар, аккорд. Эффекты читает снаряжение (src/gear.ts): множители урона, перезарядки, душ, получаемого урона.
 * Наступательные ауры (жжение, стужа, гроза…) сами бьют врагов — src/aura-offense.ts.
 */

export const AURA_METER = 250;
export const FLARE_DUR = 5;

export interface AuraHooks {
  scene: THREE.Scene;
  fx: FX;
  hero: Knight;
  targets(): Target[];
  /** Урон цели от ауры (шипы) */
  damage(t: Target, dmg: number, from: THREE.Vector3, knock: number): void;
  /** Множители поменялись (вспышка началась или кончилась, надели другую) */
  changed(): void;
  banner(html: string): void;
}

const C = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
const LOOK: Record<AuraKind, { a: THREE.Color; b: THREE.Color; css: string; name: string }> = {
  pact: { a: C(4, 0.5, 0.8), b: C(3, 0.3, 0.4), css: '#ff6a80', name: 'Кровавый пакт' },
  bastion: { a: C(1.2, 2, 4), b: C(4, 3, 1), css: '#9ac4ff', name: 'Бастион' },
  rage: { a: C(4, 1.2, 0.3), b: C(4, 0.45, 0.2), css: '#ff8a40', name: 'Ярость' },
  clarity: { a: C(0.8, 2.6, 4), b: C(2.4, 3.4, 4), css: '#8ad8ff', name: 'Ясность' },
  thorns: { a: C(1, 3, 0.8), b: C(3.6, 1, 1.6), css: '#a8ff8a', name: 'Терновый венец' },
  inferno: { a: C(4, 1, 0.2), b: C(4, 2.2, 0.4), css: '#ff7a2a', name: 'Горнило' },
  frost: { a: C(1.2, 2.6, 4), b: C(3, 3.6, 4), css: '#9ae0ff', name: 'Стужа' },
  storm: { a: C(2.4, 2.4, 4), b: C(3.6, 3.4, 1.6), css: '#c8c0ff', name: 'Грозовой венец' },
  halo: { a: C(4, 3.2, 1.2), b: C(4, 4, 3), css: '#ffe08a', name: 'Карающий ореол' },
  shade: { a: C(2, 0.6, 3.6), b: C(0.6, 3, 2.8), css: '#b07aff', name: 'Голодная тень' },
  quake: { a: C(3.6, 2.2, 0.6), b: C(1.4, 3, 0.8), css: '#e0b060', name: 'Каменная поступь' },
  blades: { a: C(3.6, 1, 3.4), b: C(4, 2, 3), css: '#ff8ae0', name: 'Вихрь клинков' },
};
export const AURA_COLOR: Record<AuraKind, string> = {
  pact: '#c8203a', bastion: '#3a6ad8', rage: '#e0602a', clarity: '#2a9ae0', thorns: '#4a9a3a',
  inferno: '#e04a1a', frost: '#3aa8d8', storm: '#6a6ae0', halo: '#d8a82a', shade: '#6a3ab0', quake: '#9a6a2a', blades: '#c83aa8',
};

const rand = (a: number, b: number): number => a + rnd() * (b - a);

let shieldT: THREE.Texture | null = null;
/** Щит-руна для «Бастиона»: контур щита и знак внутри */
export const shieldTex = (): THREE.Texture => {
  if (shieldT) return shieldT;
  const cv = makeCanvas(128, 128);
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.strokeStyle = g.fillStyle = '#fff'; g.lineJoin = 'round';
  const shape = (k: number): void => {
    g.beginPath(); g.moveTo(64, 10 + (1 - k) * 50);
    g.lineTo(64 + 46 * k, 22 + (1 - k) * 40); g.lineTo(64 + 42 * k, 70); g.quadraticCurveTo(64 + 30 * k, 104, 64, 118 - (1 - k) * 50);
    g.quadraticCurveTo(64 - 30 * k, 104, 64 - 42 * k, 70); g.lineTo(64 - 46 * k, 22 + (1 - k) * 40); g.closePath();
  };
  g.globalAlpha = 0.25; shape(1); g.fill();
  g.globalAlpha = 1; g.lineWidth = 6; shape(1); g.stroke();
  g.lineWidth = 3; shape(0.75); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.moveTo(64, 36); g.lineTo(64, 92); g.moveTo(44, 56); g.lineTo(84, 56); g.stroke();
  shieldT = new THREE.CanvasTexture(cv);
  shieldT.colorSpace = THREE.SRGBColorSpace;
  return shieldT;
};

export class Auras {
  kind: AuraKind | null = null;
  /** Сила эффекта, доля (0,2 = 20 %) с учётом силы предмета */
  private value = 0;
  radius = 8;
  /** Шкала 0..AURA_METER */
  meter = 0;
  /** Осталось вспышки, с */
  flareT = 0;
  /** Вспышки (для тестов) */
  flares = 0;
  private uid: string | null = null;
  private sigil: Sigil | null = null;
  private flareSigil: Sigil | null = null;
  private flareK = 0;
  private readonly extras: THREE.Object3D[] = [];
  private readonly mats: THREE.Material[] = [];
  private time = 0;
  private shieldFlash = 0;
  private readyRung = false;
  /** Наступательная часть: жжёт, морозит, бьёт молнией… */
  readonly offense: AuraOffense;

  private readonly h: AuraHooks;
  constructor(h: AuraHooks) { this.h = h; this.offense = new AuraOffense(h); }

  /** Множитель вспышки */
  private get m(): number { return this.flareT > 0 ? 3 : 1; }
  private on(k: AuraKind): number { return this.kind === k ? this.value * this.m : 0; }

  // ---------- эффекты (читает снаряжение) ----------
  /** Доля урона, которая возвращается здоровьем */
  get leech(): number { return this.on('pact'); }
  /** Множитель получаемого урона */
  get damageTaken(): number { return Math.max(0.2, 1 - this.on('bastion')); }
  /** Множитель всего урона героя */
  get dmgMult(): number { return 1 + this.on('rage'); }
  get critBonus(): number { return this.kind === 'rage' ? 0.1 * this.m : 0; }
  /** Множитель перезарядки заклинаний и артефактов */
  get cdMult(): number { return Math.max(0.25, 1 - this.on('clarity')); }
  get soulsMult(): number { return this.kind === 'clarity' ? 1 + 0.5 * this.m : 1; }
  /** Доля ближнего урона, которая возвращается обидчику */
  get thorns(): number { return this.on('thorns'); }
  get ready(): boolean { return !!this.kind && this.flareT <= 0 && this.meter >= AURA_METER; }

  /** Надетая аура: перестроить вид, если поменялась */
  set(it: Item | null): void {
    const uid = it?.uid ?? null;
    const a = it ? itemDef(it.def).aura : undefined;
    const pw = it ? powerMult(it.power) : 1;
    const off = a && isOffense(a.kind) ? a.kind : null;
    if (uid === this.uid) {
      if (a) this.value = (a.value / 100) * pw;
      if (off && a) this.offense.set(off, a.value * pw, pw, LOOK[off].a, LOOK[off].b);
      return;
    }
    this.uid = uid;
    this.clear();
    this.kind = a?.kind ?? null;
    this.value = a ? (a.value / 100) * pw : 0;
    this.radius = a?.radius ?? 8;
    this.meter = 0; this.flareT = 0; this.readyRung = false;
    if (!this.kind) return;
    const L = LOOK[this.kind];
    if (off && a) this.offense.set(off, a.value * pw, pw, L.a, L.b);
    this.sigil = new Sigil(this.kind, 1.4, L.a, L.b, 0.17);
    this.h.scene.add(this.sigil.group);
    if (this.kind === 'bastion') {
      const mat = additive(shieldTex(), L.a.clone().multiplyScalar(0.35), 0.8);
      this.mats.push(mat);
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), mat);
        m.renderOrder = 3;
        this.extras.push(m); this.h.scene.add(m);
      }
    }
    if (this.kind === 'clarity') {
      for (let i = 0; i < 3; i++) {
        const mat = additiveSprite(glowTex(), L.b.clone().multiplyScalar(0.55));
        this.mats.push(mat);
        const s = new THREE.Sprite(mat);
        s.scale.setScalar(0.32);
        this.extras.push(s); this.h.scene.add(s);
      }
    }
    spellSfx.auraOn(this.kind);
  }

  private clear(): void {
    this.offense.clear();
    this.sigil?.dispose(); this.sigil = null;
    this.flareSigil?.dispose(); this.flareSigil = null;
    for (const o of this.extras) { this.h.scene.remove(o); if (o instanceof THREE.Mesh) o.geometry.dispose(); }
    for (const m of this.mats) m.dispose();
    this.extras.length = 0; this.mats.length = 0;
  }

  // ---------- события ----------

  /** Герой нанёс урон (at — где цель): шкала, нити пакта */
  onDealt(dmg: number, at?: THREE.Vector3): number {
    if (!this.kind) return 0;
    // урон самой ауры копит шкалу вполовину — иначе вспышка заряжается от стояния в толпе
    if (this.flareT <= 0) this.meter = Math.min(AURA_METER, this.meter + dmg * (this.offense.own ? 0.5 : 1));
    this.offense.onDealt(at, this.flareT > 0);
    if (this.kind !== 'pact') return 0;
    const heal = dmg * this.leech;
    const hero = this.h.hero;
    if (heal > 0 && !hero.down && at) {
      // красные нити: капли летят дугой от раны к герою
      const fx = this.h.fx, L = LOOK.pact, to = hero.pos.clone().setY(hero.pos.y + 1);
      for (let i = 0; i < 6 + (this.flareT > 0 ? 6 : 0); i++) {
        const from = at.clone().setY(at.y + rand(0.6, 1.3)).add(new THREE.Vector3(rand(-0.2, 0.2), 0, rand(-0.2, 0.2)));
        const life = rand(0.35, 0.55), g = -6;
        const v = to.clone().sub(from).divideScalar(life); v.y -= (g * life) / 2;
        fx.particle({ pos: from, vel: v, life, size: rand(0.05, 0.09), color: i % 2 ? L.a : L.b, gravity: g, shrink: false });
      }
      spellSfx.pactDrink();
    }
    return heal;
  }

  /** Героя ударили на dmg (уже после «Бастиона») */
  onHurt(dmg: number): void {
    if (!this.kind) return;
    const fx = this.h.fx, hero = this.h.hero, L = LOOK[this.kind];
    if (this.kind === 'bastion') {
      this.shieldFlash = 1;
      fx.flash(hero.pos.clone().setY(hero.pos.y + 1), L.a.clone().multiplyScalar(0.8), 2.6, 0.25);
      fx.shock(hero.pos.clone().setY(hero.pos.y + 0.1), 1.6, L.b, 0.3, 0.12);
      spellSfx.bastionBlock();
    }
    if (this.kind === 'thorns') {
      // хлестнуть ближайшего врага рядом: шипы летят к нему
      let best: Target | null = null, bd = 3;
      for (const t of this.h.targets()) {
        if (!t.alive) continue;
        const d = Math.hypot(t.pos.x - hero.pos.x, t.pos.z - hero.pos.z) - t.radius;
        if (d < bd) { bd = d; best = t; }
      }
      // без обидчика рядом — всё равно видно, что лозы огрызнулись
      const at = best ? best.pos.clone() : hero.pos.clone().add(new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw)).multiplyScalar(1.5));
      const from = hero.pos.clone().setY(hero.pos.y + 0.4);
      for (let i = 0; i < 10; i++) {
        const life = rand(0.15, 0.25), to = at.clone().setY(at.y + rand(0.3, 1.2));
        fx.particle({ pos: from.clone(), vel: to.sub(from).divideScalar(life), life, size: rand(0.06, 0.1), color: i % 3 ? L.a : L.b, gravity: 0, shrink: false });
      }
      fx.burst(at.clone().setY(at.y + 0.8), [L.a, L.b], 12, { speed: 3, up: 2, size: 0.07, life: 0.4, glow: true, gravity: 6 });
      if (best) this.h.damage(best, Math.max(1, Math.round(dmg * this.thorns)), hero.pos, 0.6);
      spellSfx.thornsLash();
    }
  }

  /** R: вспышка ауры, если шкала полна */
  flare(): boolean {
    if (!this.kind || !this.ready || this.h.hero.down) return false;
    const fx = this.h.fx, hero = this.h.hero, L = LOOK[this.kind];
    this.flareT = FLARE_DUR; this.meter = 0; this.flares++; this.readyRung = false;
    this.flareK = 0;
    this.flareSigil = new Sigil(this.kind, this.radius * 0.5, L.a, L.b, 0.32);
    this.flareSigil.group.position.copy(hero.pos);
    this.h.scene.add(this.flareSigil.group);
    const c = hero.pos.clone();
    fx.shock(c.clone().setY(c.y + 0.08), this.radius * 0.6, L.a, 0.5, 0.2);
    fx.shock(c.clone().setY(c.y + 0.08), this.radius * 0.4, L.b, 0.4, 0.12);
    fx.flash(c.clone().setY(c.y + 1.2), L.a.clone().multiplyScalar(0.7), 4, 0.35);
    fx.screenFlash(L.css, 0.22, 0.3);
    fx.light(c.clone().setY(c.y + 1.6), L.css, 22, 14, 0.9);
    fx.shake = Math.max(fx.shake, 0.55);
    fx.hitstop = Math.max(fx.hitstop, 0.08);
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, r = rand(0.3, 1.2);
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.2, Math.sin(a) * r)), vel: new THREE.Vector3(Math.cos(a) * 1.5, rand(4, 8), Math.sin(a) * 1.5), life: rand(0.6, 1), size: rand(0.06, 0.1), color: i % 2 ? L.a : L.b, gravity: 2 });
    }
    this.offense.onFlare();
    spellSfx.auraFlare(this.kind);
    this.h.banner(`${L.name}<small>Вспышка ауры ×3 на ${FLARE_DUR} с</small>`);
    this.h.changed();
    return true;
  }

  // ---------- кадр ----------

  update(dt: number): void {
    if (!this.kind) return;
    this.time += dt;
    const hero = this.h.hero, fx = this.h.fx, L = LOOK[this.kind], flare = this.flareT > 0;
    if (this.sigil) {
      this.sigil.group.position.copy(hero.pos);
      this.sigil.update(dt, flare ? 0.55 : 0.3, flare);
    }
    if (this.ready && !this.readyRung) { this.readyRung = true; spellSfx.auraReady(); fx.shock(hero.pos.clone().setY(hero.pos.y + 0.08), 1.8, L.b, 0.35, 0.1); }
    if (flare) {
      this.flareT -= dt;
      this.flareK = Math.min(1, this.flareK + dt / 0.5);
      if (this.flareSigil) {
        this.flareSigil.group.position.copy(hero.pos);
        this.flareSigil.update(dt, this.flareK, this.flareK >= 1);
      }
      if (this.flareT <= 0) {
        this.flareSigil?.burst(fx, 0.6); this.flareSigil = null;
        spellSfx.auraFade(this.kind);
        this.h.changed();
      }
    }
    this.offense.update(dt, this.flareT > 0);
    const busy = flare ? 2.5 : 1;
    // знак ауры
    if (this.kind === 'bastion') {
      this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
      const mat = this.mats[0] as THREE.MeshBasicMaterial;
      mat.opacity = 0.55 + this.shieldFlash * 0.45 + (flare ? 0.3 : 0);
      this.extras.forEach((m, i) => {
        const a = this.time * (flare ? 2.4 : 1.1) + (i / 3) * Math.PI * 2, r = flare ? 1.3 : 1.05;
        m.position.set(hero.pos.x + Math.cos(a) * r, hero.pos.y + 0.95 + Math.sin(this.time * 2 + i) * 0.06, hero.pos.z + Math.sin(a) * r);
        m.rotation.set(0, -a + Math.PI / 2, 0);
        m.scale.setScalar((flare ? 1.3 : 1) * (1 + this.shieldFlash * 0.3));
      });
    }
    if (this.kind === 'clarity') {
      this.extras.forEach((s, i) => {
        const a = this.time * (flare ? 4 : 2) + (i / 3) * Math.PI * 2;
        s.position.set(hero.pos.x + Math.cos(a) * 0.6, hero.pos.y + 1.9 + Math.sin(this.time * 3 + i * 2) * 0.12, hero.pos.z + Math.sin(a) * 0.6);
        if (rnd() < 0.4 * busy) fx.particle({ pos: s.position.clone(), vel: new THREE.Vector3(0, -0.2, 0), life: 0.35, size: 0.05, color: L.a, gravity: 0 });
      });
    }
    if (this.kind === 'rage' && rnd() < 0.45 * busy) {
      const hand = hero.pos.clone().add(new THREE.Vector3(Math.sin(hero.yaw + 0.8) * 0.45, 1, Math.cos(hero.yaw + 0.8) * 0.45));
      fx.particle({ pos: hand.add(new THREE.Vector3(rand(-0.2, 0.2), rand(-0.3, 0.4), rand(-0.2, 0.2))), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.8, 1.8), rand(-0.3, 0.3)), life: rand(0.3, 0.6), size: rand(0.04, 0.08), color: rnd() < 0.5 ? L.a : L.b, gravity: -1 });
    }
    if (this.kind === 'pact' && rnd() < 0.15 * busy) {
      const a = rnd() * Math.PI * 2;
      fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.3, 0.1, Math.sin(a) * 1.3)), vel: new THREE.Vector3(0, rand(0.5, 1.2), 0), life: 0.7, size: 0.05, color: L.b, gravity: -0.3 });
    }
    if (this.kind === 'thorns' && flare && rnd() < 0.4) {
      const a = rnd() * Math.PI * 2;
      fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.4, 0.1, Math.sin(a) * 1.4)), vel: new THREE.Vector3(Math.cos(a), rand(1, 2), Math.sin(a)), life: 0.5, size: 0.06, color: rnd() < 0.5 ? L.a : L.b, gravity: 3 });
    }
    // во время вспышки по краю большого круга поднимаются огоньки
    if (flare && rnd() < 0.8) {
      const a = rnd() * Math.PI * 2, r = this.radius * 0.5;
      fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r)), vel: new THREE.Vector3(0, rand(1.5, 3), 0), life: 0.7, size: 0.06, color: rnd() < 0.5 ? L.a : L.b, gravity: -0.5 });
    }
  }
}
