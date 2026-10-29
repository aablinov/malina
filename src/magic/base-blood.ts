import * as THREE from 'three';
import type { ArtifactStats, BossSpellKind } from '../items';
import { bell, boom, deg, hiss, pluck, voice } from '../spell-audio';
import type { Spells } from '../spells';
import { bleed, payHp } from './blood-core';
import { rand, type Spell } from './kit';

/**
 * Базовые заклинания (wiki/design-spells.md, раздел «Базовые заклинания»). Малиновая кровь — как магия крови Elden Ring:
 * каст стоит здоровья (payHp), удары копят кровотечение (bleed) — src/magic/blood-core.ts.
 * Когти — три клинка пламени из земли перед героем; рой малинок — поток мушек конусом; малиновый клинок — сок на оружии.
 */

/** Корень малиновой крови: ре малой октавы, минорные ноты */
const ROOT = 146.83;
const UNIT = new THREE.BoxGeometry(1, 1, 1);

/** Светящийся малиновый материал (не тёмный — без квадратов AO) */
const glow = (c: THREE.Color, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true, opacity, depthWrite: opacity >= 1 });

/** Направление от героя к точке на земле (без высоты); у самых ног — куда смотрит герой */
function dirTo(kit: Spells, at: THREE.Vector3): THREE.Vector3 {
  const hero = kit.h.hero, d = new THREE.Vector3(at.x - hero.pos.x, 0, at.z - hero.pos.z);
  return d.lengthSq() > 0.04 ? d.normalize() : new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
}

// ---------- малиновые когти ----------

/** Коготь: изогнутый клинок из брусков — вверх и загибается вперёд */
function claw(mat: THREE.Material, edge: THREE.Material, h: number): THREE.Group {
  const g = new THREE.Group();
  let y = 0, z = 0, tilt = 0;
  for (let i = 0; i < 6; i++) {
    const w = 0.42 * (1 - i / 8), seg = h / 6;
    const b = new THREE.Mesh(UNIT, i === 5 ? edge : mat);
    b.scale.set(w * 0.6, seg * 1.15, w);
    b.position.set(0, y + seg / 2, z);
    b.rotation.x = tilt;
    g.add(b);
    y += Math.cos(tilt) * seg; z += Math.sin(tilt) * seg;
    tilt += 0.22;
  }
  return g;
}

function bloodclaws(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('blood'), hero = kit.h.hero;
  payHp(kit, 0.06);
  const dir = dirTo(kit, at), side = new THREE.Vector3(dir.z, 0, -dir.x);
  const dist = Math.max(1.2, Math.min(3, Math.hypot(at.x - hero.pos.x, at.z - hero.pos.z)));
  const c = kit.ground(hero.pos.clone().addScaledVector(dir, dist), 99);
  kit.face(c);
  kit.windup('blood', k);
  // замах: под ногами врага земля краснеет, из трещин сочится сок
  fx.decal(c, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), 2.4 + k, 0.9, true);
  for (let i = 0; i < 16; i++) fx.particle({ pos: c.clone().add(new THREE.Vector3(rand(-1, 1), 0.08, rand(-1, 1))), vel: new THREE.Vector3(0, rand(0.6, 1.6), 0), life: 0.35, size: 0.06, color: s.a, gravity: -0.5 });
  voice({ type: 'triangle', f: ROOT, f1: ROOT * 2, dur: 0.32, vol: 0.06, lp: 900, lp1: 2400, detune: 10, verb: 0.3 });
  hiss({ dur: 0.3, vol: 0.08, f: 400, f1: 1600, q: 0.8, attack: 0.2, verb: 0.2 });
  kit.later(0.35, () => {
    const R = a.radius ?? 3;
    kit.impact('blood', c, k, 12, 0.4);
    kit.pomp('common', c, 'blood');
    boom(110 - k * 20, 38, 0.6, 0.5);
    hiss({ dur: 0.18, vol: 0.3, f: 1400, f1: 500, q: 0.7, verb: 0.3 });
    [0, 3, 7].forEach((st, i) => pluck(ROOT * 2 * Math.pow(2, st / 12), 0.08, 0.04 * i));
    // три когтя: середина впереди, крайние — веером
    const mats: THREE.Material[] = [];
    const body = glow(s.a.clone().multiplyScalar(0.65)), edge = glow(s.b.clone().multiplyScalar(0.9));
    mats.push(body, edge);
    const h = 1.7 + k * 0.8;
    [-1, 0, 1].forEach((o, i) => {
      const p = kit.ground(c.clone().addScaledVector(side, o * 0.75).addScaledVector(dir, o === 0 ? 0.35 : -0.1), 99);
      const g = claw(body, edge, h);
      g.position.copy(p);
      g.rotation.y = Math.atan2(dir.x, dir.z) + o * 0.35;
      g.scale.setScalar(0.01);
      kit.h.scene.add(g);
      const T = 0.95 + i * 0.04;
      fx.custom(g, T, (t) => {
        const tt = t * T;
        // вырывается с перелётом, держится, уходит в землю
        const up = tt < 0.14 ? (tt / 0.14) * 1.15 : tt < 0.24 ? 1.15 - ((tt - 0.14) / 0.1) * 0.15 : tt < 0.65 ? 1 : Math.max(0.01, 1 - (tt - 0.65) / (T - 0.65));
        g.scale.set(1, up, 1);
        if (Math.random() < 0.6) fx.particle({ pos: p.clone().add(new THREE.Vector3(rand(-0.25, 0.25), rand(0.2, h * up), rand(-0.25, 0.25))), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1, 2.4), rand(-0.3, 0.3)), life: rand(0.25, 0.45), size: rand(0.05, 0.09), color: Math.random() < 0.6 ? s.a : s.b, gravity: -1.5 });
      }, () => { /* общие материалы освобождаются ниже */ });
      fx.burst(p.clone().setY(p.y + 0.2), [s.a, s.b, '#ffb0c8'], 10, { speed: 2.5, up: 4, size: 0.07, life: 0.6, glow: true, gravity: 9 });
    });
    kit.later(1.1, () => mats.forEach((m) => m.dispose()));
    fx.shock(c.clone().setY(c.y + 0.06), R * 0.8, s.a, 0.35, 0.18);
    fx.flash(c.clone().setY(c.y + 1), s.b.clone().multiplyScalar(0.55), 2.4 + k, 0.25);
    // урон: всё в круге перед героем, каждой цели — кровотечение
    for (const t of kit.within(c, Math.min(R, 1.6 + k * 0.6))) {
      kit.h.damage(t, Math.round(power), hero.pos, 1.2);
      bleed(kit, t, 50);
    }
    // послевкусие: малиновое пятно и капли
    fx.decal(c, kit.tex.scorch(), '#ffffff', 2.2 + k, 3, false, 0.5);
    fx.decal(c, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), 2.6 + k, 1.6, true);
    let left = 1.4;
    kit.proc((dt) => {
      left -= dt;
      if (Math.random() < 0.5) fx.particle({ pos: c.clone().add(new THREE.Vector3(rand(-1, 1), 0.08, rand(-1, 1))), vel: new THREE.Vector3(0, rand(0.4, 1), 0), life: 0.5, size: 0.05, color: s.a, gravity: -0.3 });
      return left > 0;
    });
  });
}

// ---------- рой малинок ----------

function bloodswarm(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('blood'), hero = kit.h.hero;
  payHp(kit, 0.08);
  const R = a.radius ?? 5, dur = (a.duration ?? 1.5) + k * 0.5, half = 0.31;
  let dir = dirTo(kit, at);
  // конус ведётся за курсором, только если курсор сдвинулся после каста (в тестах прицел стоит)
  const aim0 = kit.aim.clone();
  kit.face(hero.pos.clone().add(dir));
  kit.windup('blood', k);
  kit.impact('blood', hero.pos.clone().addScaledVector(dir, 1.5), k, 10, 0.2);
  kit.pomp('common', hero.pos, 'blood');
  boom(130, 60, 0.35, 0.3);
  hiss({ dur: 0.4, vol: 0.12, f: 2200, f1: 4500, q: 1.2, attack: 0.1, verb: 0.2 });
  let t = 0, tick = 0, n = 0;
  kit.proc((dt) => {
    t += dt;
    if (kit.aim.distanceTo(aim0) > 0.3) dir = dirTo(kit, kit.aim);
    kit.face(hero.pos.clone().add(dir), 0.2);
    const hand = kit.hand();
    // мушки: кружат и летят конусом; на излёте разворачиваются обратно — живой рой
    const live = t < dur;
    for (let i = 0; i < (live ? 9 : 0); i++) {
      const ang = Math.atan2(dir.x, dir.z) + rand(-half, half), sp = rand(5, 8), life = (R / sp) * rand(0.6, 1);
      const v = new THREE.Vector3(Math.sin(ang) * sp, rand(-0.6, 0.8), Math.cos(ang) * sp);
      fx.particle({ pos: hand.clone().add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.15, 0.15), rand(-0.15, 0.15))), vel: v, life, size: rand(0.035, 0.06), color: Math.random() < 0.7 ? s.a : s.b, gravity: rand(-1, 1), spin: 20, drag: 0.4, shrink: false });
    }
    if (live && Math.random() < 0.5) {
      const p = hand.clone().addScaledVector(dir, rand(1, R)).add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.3, 0.5), rand(-0.6, 0.6)));
      fx.particle({ pos: p, vel: new THREE.Vector3(rand(-2, 2), rand(-1, 1), rand(-2, 2)), life: 0.4, size: 0.04, color: s.b, gravity: 0, spin: 25 });
    }
    tick -= dt;
    if (live && tick <= 0) {
      tick = 0.15; n++;
      // тёплое жужжание: три расстроенные короткие ноты с лёгким «вибрато» вверх-вниз
      const f = ROOT * 2 * (n % 2 ? 1 : 1.03);
      voice({ type: 'triangle', f, f1: f * 1.04, dur: 0.17, vol: 0.022, detune: 18, lp: 1800, verb: 0.15 });
      voice({ type: 'sine', f: f * 1.5, f1: f * 1.46, dur: 0.15, vol: 0.012, verb: 0.15 });
      if (n % 3 === 0) pluck(deg(ROOT * 4, (n / 3) % 5), 0.025);
      for (const tg of kit.h.targets()) {
        if (!tg.alive) continue;
        const dx = tg.pos.x - hero.pos.x, dz = tg.pos.z - hero.pos.z, d = Math.hypot(dx, dz);
        if (d - tg.radius > R || d < 0.05) continue;
        const da = Math.atan2(Math.sin(Math.atan2(dx, dz) - Math.atan2(dir.x, dir.z)), Math.cos(Math.atan2(dx, dz) - Math.atan2(dir.x, dir.z)));
        if (Math.abs(da) > half + tg.radius / Math.max(1, d)) continue;
        kit.h.damage(tg, Math.max(1, Math.round(power)), hero.pos, 0.1);
        bleed(kit, tg, 15);
        fx.burst(tg.pos.clone().setY(tg.pos.y + 1.1), [s.a, s.b], 4, { speed: 1.5, up: 1, size: 0.04, life: 0.3, glow: true, gravity: 4 });
      }
    }
    // послевкусие: рой рассыпается каплями, на земле малиновый след конусом
    if (!live) {
      for (let i = 0; i < 4; i++) fx.decal(kit.ground(hero.pos.clone().addScaledVector(dir, 1 + i * (R / 4)), 99), kit.tex.glow(), s.a.clone().multiplyScalar(0.22), 1.2 + i * 0.5, 1.8, true);
      fx.burst(hand.clone().addScaledVector(dir, R * 0.5), [s.a, s.b], 18, { speed: 2, up: 1.5, size: 0.05, life: 0.6, glow: true, gravity: 8 });
      bell(deg(ROOT * 4, 2), 0.6, 0.04, 0, 0.5);
      return false;
    }
    return true;
  });
}

// ---------- малиновый клинок ----------

function bloodblade(kit: Spells, a: ArtifactStats, power: number, _at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('blood'), hero = kit.h.hero;
  payHp(kit, 0.1);
  const dur = a.duration ?? 15;
  // сок ложится на клинок сразу — первый же удар копит кровотечение; замах и вспышка — оформление
  kit.buff({ id: 'bloodblade', melee: 1 + power / 100, onMelee: (t) => { bleed(kit, t, 25); } }, dur);
  kit.windup('blood', k);
  // замах: сок стекает от груди к ладони и по клинку
  const hand0 = kit.hand();
  for (let i = 0; i < 18; i++) {
    const from = hero.pos.clone().setY(hero.pos.y + rand(1.2, 1.7)).add(new THREE.Vector3(rand(-0.4, 0.4), 0, rand(-0.4, 0.4))), life = 0.28;
    fx.particle({ pos: from, vel: hand0.clone().sub(from).divideScalar(life), life, size: 0.06, color: i % 2 ? s.a : s.b, gravity: 0, shrink: false });
  }
  voice({ type: 'sawtooth', f: ROOT, f1: ROOT * 1.5, dur: 0.3, vol: 0.04, lp: 700, lp1: 2000, detune: 12, verb: 0.3 });
  kit.later(0.28, () => {
    kit.impact('blood', hero.pos, k, 12, 0.3);
    kit.pomp('common', hero.pos, 'blood');
    const c = hero.pos.clone();
    fx.shock(c.clone().setY(c.y + 0.06), 2.4, s.a, 0.4, 0.15);
    fx.shock(c.clone().setY(c.y + 0.06), 1.5, s.b, 0.3, 0.1);
    fx.flash(kit.hand(), s.b.clone().multiplyScalar(0.7), 1.8 + k, 0.3);
    fx.burst(kit.hand(), [s.a, s.b, '#ffb0c8'], 26, { speed: 3, up: 3.5, size: 0.07, life: 0.7, glow: true, gravity: 9 });
    fx.decal(c, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), 2.6, 1.6, true);
    boom(120, 45, 0.5, 0.45);
    [0, 3, 7, 10].forEach((st, i) => bell(ROOT * 4 * Math.pow(2, st / 12), 0.9, 0.045, i * 0.05, 0.5));
    hiss({ dur: 0.35, vol: 0.14, f: 900, f1: 2600, q: 0.8, attack: 0.05, verb: 0.3 });
    // пока идёт: с руки капает сок, по клинку пробегает отблеск
    let t = 0;
    kit.proc((dt) => {
      t += dt;
      const on = kit.buffs.some((b) => b.id === 'bloodblade');
      const hand = kit.hand();
      if (on && t < dur) {
        for (let i = 0; i < 2; i++) if (Math.random() < 0.7) fx.particle({ pos: hand.clone().add(new THREE.Vector3(rand(-0.25, 0.25), rand(-0.1, 0.7), rand(-0.25, 0.25))), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(-0.6, 0.2), rand(-0.2, 0.2)), life: rand(0.4, 0.7), size: rand(0.06, 0.1), color: Math.random() < 0.7 ? s.a : s.b, gravity: 9 });
        if (Math.random() < 0.15) fx.flash(hand.clone().setY(hand.y + rand(0, 0.6)), s.a.clone().multiplyScalar(0.5), 0.7, 0.2);
        return true;
      }
      // высыхание: сок темнеет до розовой пыли и осыпается
      fx.burst(hand, ['#ff8aa8', '#e0a0b0', s.a], 12, { speed: 1, up: 0.6, size: 0.05, life: 0.6, glow: true, gravity: 3 });
      hiss({ dur: 0.3, vol: 0.06, f: 2500, f1: 1200, q: 0.8, verb: 0.2 });
      bell(deg(ROOT * 4, 0), 0.5, 0.03, 0, 0.4);
      return false;
    });
  });
}

export const BASE_BLOOD = {
  bloodclaws: { school: 'blood', tier: 'common', title: 'Малиновые когти', cast: bloodclaws },
  bloodswarm: { school: 'blood', tier: 'common', title: 'Рой малинок', cast: bloodswarm },
  bloodblade: { school: 'blood', tier: 'common', title: 'Малиновый клинок', cast: bloodblade },
} satisfies Partial<Record<BossSpellKind, Spell>>;
