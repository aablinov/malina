import * as THREE from 'three';
import { rnd } from '../rng.ts';
import type { ArtifactStats, BossSpellKind } from '../items.ts';
import { additiveSprite, glowTex } from '../loot-look.ts';
import { bell, boom, deg, hiss, pluck, semi, voice } from '../spell-audio.ts';
import type { Spells } from '../spells.ts';
import type { Target } from '../target.ts';
import { C, rand, type Spell } from './kit.ts';
import { summon, type Minion } from './minions.ts';

/**
 * Базовые заклинания (wiki/design-spells.md, раздел «Базовые заклинания»). Призыв: стая волков, малый элементаль,
 * каменный голем. Общий ход призванных (портал, подъём, бег к врагу, удар, приманка для мобов, растворение) — src/magic/minions.ts;
 * здесь — модели из кубиков, анимация, удары и звуки.
 */

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const ROOT = 293.66;

/** Кубик-деталь: материал, размер, место, родитель */
function box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const o = new THREE.Mesh(UNIT, m);
  o.scale.set(w, h, d);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}
/** Шарнир: группа-точка поворота */
function pivot(x: number, y: number, z: number, parent: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
const lambert = (color: string, emissive = '#000000'): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(emissive), transparent: true });
const glow = (c: THREE.Color, opacity = 1, add = false): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color: c, toneMapped: false, transparent: true, opacity, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !add,
});

/** Каст призыва: разворот, замах, через 0,25 с — миг появления */
function cast(kit: Spells, at: THREE.Vector3, k: number, spawn: () => void): void {
  kit.face(at);
  kit.windup('summon', k);
  kit.later(0.25, () => {
    kit.impact('summon', at, k, 12, 0.3);
    spawn();
  });
}

/** Когда призванный уходит (срок или здоровье) — один раз fn: послевкусие */
function onEnd(kit: Spells, m: Minion, life: number, fn: () => void): void {
  kit.proc(() => {
    if (m.t < life && m.hp > 0) return true;
    fn();
    return false;
  });
}

/** Растворение: светлый круг на земле и мягкий аккорд вниз */
function farewell(kit: Spells, m: Minion, size: number): void {
  const s = kit.color('summon');
  kit.h.fx.decal(m.pos, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), size, 1.6, true);
  kit.h.fx.flash(m.pos.clone().setY(m.pos.y + size * 0.4), s.b.clone().multiplyScalar(0.5), size, 0.3);
  [12, 7, 0].forEach((n, i) => bell(semi(ROOT, n), 0.7, 0.035, i * 0.07, 0.5));
}

// ---------- стая волков ----------

interface WolfParts { body: THREE.Group; head: THREE.Group; legs: THREE.Group[]; tail: THREE.Group }

function wolfModel(): { g: THREE.Group; mats: THREE.Material[]; parts: WolfParts } {
  const s = { a: C(0.5, 3.4, 2.6), b: C(1.6, 4, 1.8) };
  // призрачный волк-дух: бирюзово-серая шерсть с лёгким свечением, светящаяся грива и глаза
  const fur = lambert('#7fb2aa', '#0c3632'), dark = lambert('#4f7672', '#072a26');
  const mane = glow(s.a.clone().multiplyScalar(0.28), 0.9), eye = glow(C(3, 4, 3.6));
  const g = new THREE.Group(), body = pivot(0, 0, 0, g);
  box(fur, 0.42, 0.38, 0.85, 0, 0.58, 0, body);
  box(mane, 0.5, 0.46, 0.3, 0, 0.66, 0.28, body);
  const head = pivot(0, 0.74, 0.5, body);
  box(fur, 0.34, 0.3, 0.32, 0, 0, 0.06, head);
  box(dark, 0.2, 0.15, 0.24, 0, -0.06, 0.3, head);
  box(dark, 0.08, 0.13, 0.06, -0.1, 0.2, -0.02, head);
  box(dark, 0.08, 0.13, 0.06, 0.1, 0.2, -0.02, head);
  box(eye, 0.07, 0.05, 0.02, -0.09, 0.05, 0.23, head);
  box(eye, 0.07, 0.05, 0.02, 0.09, 0.05, 0.23, head);
  const legs = [[-0.14, 0.3], [0.14, 0.3], [-0.14, -0.3], [0.14, -0.3]].map(([x, z]) => {
    const p = pivot(x, 0.44, z, body);
    box(dark, 0.11, 0.44, 0.11, 0, -0.22, 0, p);
    return p;
  });
  const tail = pivot(0, 0.68, -0.42, body);
  box(mane, 0.11, 0.11, 0.38, 0, 0, -0.19, tail);
  tail.rotation.x = -0.5;
  return { g, mats: [fur, dark, mane, eye], parts: { body, head, legs, tail } };
}

/** Вой: два голоса — вверх и вниз, с квинтой */
function howl(delay = 0): void {
  voice({ type: 'triangle', f: 330, f1: 620, dur: 0.6, vol: 0.06, attack: 0.18, delay, lp: 1800, verb: 0.6 });
  voice({ type: 'triangle', f: 620, f1: 410, dur: 0.9, vol: 0.05, attack: 0.05, delay: delay + 0.55, lp: 1600, verb: 0.7 });
  voice({ type: 'sine', f: 495, f1: 930, dur: 0.6, vol: 0.025, attack: 0.18, delay, verb: 0.6 });
}

function wolves(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const hero = kit.h.hero, fx = kit.h.fx, s = kit.color('summon');
  const n = k >= 0.7 ? 3 : 2, life = a.duration ?? 12;
  const fwd = new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw)), right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const spots = [right.clone().multiplyScalar(-1.3), right.clone().multiplyScalar(1.3), fwd.clone().multiplyScalar(-1.2)].slice(0, n);
  cast(kit, at, k, () => {
    howl();
    if (n > 2) howl(0.2);
    spots.forEach((off, i) => {
      const m = summon(kit, {
        school: 'summon', at: hero.pos.clone().add(off), i, life, hp: 40, speed: 6, reach: 0.55, cd: 0.9, swing: 0.35, height: 0.9,
        build: () => {
          const w = wolfModel();
          w.g.userData.parts = w.parts;
          return w;
        },
        strike(mn: Minion, t: Target) {
          kit.h.damage(t, Math.round(power), mn.pos, 0.4);
          t.chill?.(0.3, 1);
          const hp = t.pos.clone().setY(t.pos.y + 0.8);
          fx.burst(hp, [s.a, s.b], 8, { speed: 2.5, up: 2, size: 0.06, life: 0.35, glow: true, gravity: 6 });
          fx.flash(hp, s.a.clone().multiplyScalar(0.5), 1.1, 0.15);
          hiss({ dur: 0.07, vol: 0.14, f: 2400, q: 1.4, verb: 0.15 });
          pluck(deg(ROOT * 2, 2 + mn.i * 2), 0.06);
        },
        animate(mn, dt, walking, swing) {
          const P = mn.g.userData.parts as WolfParts, t = kit.time * 16 + mn.i;
          const run = walking ? 1 : 0;
          P.legs.forEach((l, j) => { l.rotation.x = Math.sin(t + (j % 2 ? Math.PI : 0) + (j > 1 ? 0.6 : 0)) * 0.75 * run; });
          P.body.position.y = run * Math.abs(Math.sin(t)) * 0.08;
          P.body.position.z = 0;
          P.head.rotation.x = 0;
          P.tail.rotation.y = Math.sin(kit.time * (walking ? 14 : 5)) * 0.4;
          // прыжок-укус: рывок вперёд и вверх, голова вниз
          if (swing >= 0) {
            const e = Math.sin(swing * Math.PI);
            P.body.position.z = e * 0.45;
            P.body.position.y = e * 0.25;
            P.head.rotation.x = e * 0.5;
            P.legs.forEach((l, j) => { l.rotation.x = (j < 2 ? -1 : 1) * e * 0.9; });
          }
          if (walking && rnd() < 0.25) fx.particle({ pos: mn.pos.clone().add(new THREE.Vector3(rand(-0.2, 0.2), rand(0.3, 0.8), rand(-0.2, 0.2))), vel: new THREE.Vector3(0, rand(0.3, 0.8), 0), life: 0.4, size: 0.05, color: s.a, gravity: 0 });
          void dt;
        },
      });
      onEnd(kit, m, life, () => farewell(kit, m, 1.4));
    });
  });
}

// ---------- малый элементаль ----------

type Elem = 'fire' | 'ice' | 'storm';
const ELEMS: Elem[] = ['fire', 'ice', 'storm'];
const ELEM_LOOK: Record<Elem, { a: THREE.Color; b: THREE.Color }> = {
  fire: { a: C(4, 1.4, 0.3), b: C(4, 3, 1) },
  ice: { a: C(1.4, 2.8, 4), b: C(2.8, 3.6, 4) },
  storm: { a: C(1, 2, 4), b: C(3, 3.4, 4) },
};
/** Очередь стихий: каждый каст — следующая */
let elemTurn = 0;

interface ElemParts { float: THREE.Group; core: THREE.Mesh; shell: THREE.Mesh; orbit: THREE.Mesh[] }

function elemShot(kit: Spells, from: THREE.Vector3, t: Target, power: number, el: Elem): void {
  const fx = kit.h.fx, L = ELEM_LOOK[el];
  const mat = glow(L.b.clone().multiplyScalar(0.7));
  const shot = new THREE.Mesh(UNIT, mat);
  shot.scale.setScalar(0.18);
  shot.position.copy(from);
  kit.h.scene.add(shot);
  const start = from.clone(), dur = 0.3;
  let tt = 0;
  // выстрел
  if (el === 'fire') hiss({ dur: 0.25, vol: 0.12, f: 400, f1: 1600, q: 0.6, type: 'lowpass', verb: 0.2 });
  else if (el === 'ice') voice({ type: 'triangle', f: deg(1046.5, 3 + ((rnd() * 4) | 0)), dur: 0.2, vol: 0.05, verb: 0.4 });
  else hiss({ dur: 0.08, vol: 0.14, f: 5000, type: 'highpass', verb: 0.2 });
  kit.proc((dt) => {
    tt += dt;
    const e = Math.min(1, tt / dur), end = t.pos.clone().setY(t.pos.y + 0.9);
    shot.position.copy(start).lerp(end, e);
    shot.position.y += Math.sin(e * Math.PI) * 0.6;
    shot.rotation.x += dt * 12; shot.rotation.y += dt * 9;
    fx.particle({ pos: shot.position.clone(), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.6), rand(-0.3, 0.3)), life: 0.25, size: 0.06, color: rnd() < 0.5 ? L.a : L.b, gravity: el === 'fire' ? -1 : 0 });
    if (e < 1) return true;
    kit.h.scene.remove(shot); mat.dispose();
    if (!t.alive) return false;
    kit.h.damage(t, Math.round(power), from, 0.3);
    fx.burst(end, [L.a, L.b], 10, { speed: 2.5, up: 2, size: 0.06, life: 0.4, glow: true, gravity: el === 'fire' ? -1 : 6 });
    fx.flash(end, L.a.clone().multiplyScalar(0.5), 1.2, 0.18);
    if (el === 'fire') {
      // жжёт: два слабых тика и угли
      for (const d of [0.5, 1]) kit.later(d, () => { if (t.alive && !t.prop) { kit.h.damage(t, Math.max(1, Math.round(power * 0.2)), from, 0); fx.burst(t.pos.clone().setY(t.pos.y + 0.8), [L.a, L.b], 5, { speed: 1, up: 1.5, size: 0.05, life: 0.4, glow: true, gravity: -1 }); } });
      boom(110, 50, 0.25, 0.18);
    } else if (el === 'ice') {
      t.chill?.(0.4, 1.5);
      voice({ type: 'triangle', f: 2093, dur: 0.15, vol: 0.04, verb: 0.4 });
      kit.h.fx.decal(t.pos, kit.tex.frost(), L.a.clone().multiplyScalar(0.2), 1.4, 1.5, true, 0.7);
    } else {
      t.stun?.(0.3);
      kit.bolt(end.clone().setY(end.y + 5), end, L.a, 0.05, 1, 0.22);
      hiss({ dur: 0.12, vol: 0.18, f: 3000, f1: 800, q: 0.8, verb: 0.3 });
    }
    return false;
  });
}

function elemental(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const hero = kit.h.hero, fx = kit.h.fx;
  const el = ELEMS[elemTurn++ % 3], L = ELEM_LOOK[el], life = a.duration ?? 15;
  const fwd = new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw)), right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  cast(kit, at, k, () => {
    [0, 2, 4, 7].forEach((n, i) => bell(deg(ROOT * 2, n), 0.8, 0.05, i * 0.06, 0.6));
    const m = summon(kit, {
      school: 'summon', at: hero.pos.clone().addScaledVector(right, 1.2).addScaledVector(fwd, -0.4), i: 0, life, hp: 30,
      speed: 3.5, reach: Math.max(2, (a.radius ?? 6) - 0.5), cd: 1.2, swing: 0.4, height: 1.4,
      build: () => {
        const g = new THREE.Group(), float = pivot(0, 1.1, 0, g);
        const coreM = glow(L.b.clone().multiplyScalar(0.6)), shellM = glow(L.a.clone().multiplyScalar(0.35), 0.6, true), orbM = glow(L.a.clone().multiplyScalar(0.5));
        const halo = additiveSprite(glowTex(), L.a.clone().multiplyScalar(0.25));
        const core = box(coreM, 0.3, 0.3, 0.3, 0, 0, 0, float), shell = box(shellM, 0.55, 0.55, 0.55, 0, 0, 0, float);
        const orbit = [0, 1, 2, 3].map(() => box(orbM, 0.12, 0.12, 0.12, 0, 0, 0, float));
        const sp = new THREE.Sprite(halo); sp.scale.setScalar(1.4); float.add(sp);
        g.userData.parts = { float, core, shell, orbit } satisfies ElemParts;
        return { g, mats: [coreM, shellM, orbM, halo] };
      },
      strike(mn, t) {
        const P = mn.g.userData.parts as ElemParts;
        elemShot(kit, P.float.getWorldPosition(new THREE.Vector3()), t, power, el);
      },
      animate(mn, dt, _walking, swing) {
        const P = mn.g.userData.parts as ElemParts, t = kit.time;
        P.float.position.y = 1.1 + Math.sin(t * 2.5) * 0.12;
        P.core.rotation.x += dt * 2; P.core.rotation.y += dt * 3;
        P.shell.rotation.y -= dt * 1.5; P.shell.rotation.z += dt;
        const pulse = swing >= 0 ? 1 + Math.sin(swing * Math.PI) * 0.4 : 1;
        P.core.scale.setScalar(0.3 * pulse);
        P.orbit.forEach((o, i) => {
          const ang = t * 3 + (i / 4) * Math.PI * 2;
          o.position.set(Math.cos(ang) * 0.45, Math.sin(t * 4 + i) * 0.15, Math.sin(ang) * 0.45);
          o.rotation.x += dt * 5;
        });
        if (rnd() < 0.35) fx.particle({ pos: P.float.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(rand(-0.2, 0.2), rand(-0.2, 0.2), rand(-0.2, 0.2))), vel: new THREE.Vector3(0, el === 'fire' ? rand(0.6, 1.2) : rand(-0.4, 0.2), 0), life: 0.4, size: 0.05, color: rnd() < 0.5 ? L.a : L.b, gravity: 0 });
      },
    });
    onEnd(kit, m, life, () => farewell(kit, m, 1.2));
  });
}

// ---------- каменный голем ----------

interface GolemParts { body: THREE.Group; legs: THREE.Group[]; arms: THREE.Group[]; rune: THREE.MeshBasicMaterial }
let lastCrumb = 0;

function golem(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const hero = kit.h.hero, fx = kit.h.fx, s = kit.color('summon');
  const R = a.radius ?? 2;
  // заряд продлевает жизнь голема: тап — 80 % срока, полный — весь
  const life = a.duration ?? 18;
  // встаёт между героем и курсором: не дальше 5 м и чуть не доходя до точки
  const dir = new THREE.Vector3(at.x - hero.pos.x, 0, at.z - hero.pos.z);
  const len = dir.length();
  const dist = Math.min(5, Math.max(1.2, len - 1.2));
  const spot = len > 0.01 ? hero.pos.clone().addScaledVector(dir.normalize(), dist) : hero.pos.clone().add(new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw)).multiplyScalar(1.5));
  cast(kit, spot, k, () => {
    // грохот: камень поднимается из земли
    boom(70, 30, 1.2, 0.5, 0, 0.4);
    hiss({ dur: 1, vol: 0.14, f: 500, f1: 200, q: 0.5, type: 'lowpass', attack: 0.1, verb: 0.3 });
    fx.shake = Math.max(fx.shake, 0.3);
    fx.burst(spot.clone().setY(spot.y + 0.2), ['#b8ab92', '#9a8f78', '#d8cfb8'], 18, { speed: 3, up: 4, size: 0.12, life: 0.8, gravity: 10 });
    const m = summon(kit, {
      school: 'summon', at: spot, i: 0, life, hp: 120, speed: 1.6, reach: 0.9, cd: 2, swing: 0.9, taunt: 8, height: 2.3,
      build: () => {
        const stone = lambert('#9a9284'), dark = lambert('#6f695e'), moss = lambert('#5f8a3a');
        const rune = glow(s.a.clone().multiplyScalar(0.45)), eye = glow(C(2, 4, 3.4));
        const g = new THREE.Group(), body = pivot(0, 0, 0, g);
        const legs = [-0.3, 0.3].map((x) => { const p = pivot(x, 0.8, 0, body); box(dark, 0.42, 0.8, 0.42, 0, -0.4, 0, p); return p; });
        box(stone, 1.1, 0.95, 0.7, 0, 1.28, 0, body);
        box(rune, 0.3, 0.3, 0.04, 0, 1.35, 0.36, body);
        box(moss, 1.15, 0.12, 0.5, 0, 1.8, -0.05, body);
        box(stone, 0.5, 0.42, 0.48, 0, 1.95, 0.1, body);
        box(eye, 0.1, 0.06, 0.02, -0.11, 2.0, 0.35, body);
        box(eye, 0.1, 0.06, 0.02, 0.11, 2.0, 0.35, body);
        const arms = [-0.74, 0.74].map((x) => {
          const p = pivot(x, 1.65, 0, body);
          box(stone, 0.38, 0.95, 0.38, 0, -0.45, 0, p);
          box(dark, 0.5, 0.42, 0.5, 0, -1.0, 0.02, p);
          return p;
        });
        g.userData.parts = { body, legs, arms, rune } satisfies GolemParts;
        return { g, mats: [stone, dark, moss, rune, eye] };
      },
      strike(mn) {
        // кулаки уже опускаются — удар чуть позже
        kit.later(0.04, () => {
          if (mn.hp <= 0) return;
          const f = new THREE.Vector3(Math.sin(mn.g.rotation.y), 0, Math.cos(mn.g.rotation.y));
          const pt = mn.pos.clone().addScaledVector(f, 1.2);
          kit.h.aoe(pt, R, Math.round(power), 1.2, false);
          for (const t of kit.within(pt, R)) if (!t.prop) t.stun?.(0.5);
          fx.shock(pt.clone().setY(pt.y + 0.06), R * 1.3, s.a, 0.4, 0.2);
          fx.flash(pt.clone().setY(pt.y + 0.4), s.b.clone().multiplyScalar(0.5), R * 1.2, 0.2);
          fx.burst(pt.clone().setY(pt.y + 0.1), ['#c8bba0', '#a89c82', '#e0d8c4'], 16, { speed: 3.5, up: 3, size: 0.1, life: 0.7, gravity: 10 });
          fx.decal(pt, kit.tex.scorch(), '#ffffff', R * 1.6, 2.5, false, 0.45);
          fx.shake = Math.max(fx.shake, 0.35);
          boom(90, 28, 0.6, 0.45, 0, 0.3);
          hiss({ dur: 0.3, vol: 0.16, f: 700, f1: 250, q: 0.6, type: 'lowpass', verb: 0.2 });
        });
      },
      animate(mn, dt, walking, swing) {
        const P = mn.g.userData.parts as GolemParts, t = kit.time * 5;
        const w = walking ? 1 : 0;
        P.legs.forEach((l, j) => { l.rotation.x = Math.sin(t + j * Math.PI) * 0.4 * w; });
        P.body.rotation.z = Math.sin(t) * 0.05 * w;
        P.body.position.y = w * Math.abs(Math.sin(t)) * 0.05;
        // тяжёлые шаги — пыль
        if (walking && Math.abs(Math.sin(t)) < 0.08 && rnd() < 0.5) fx.burst(mn.pos.clone().setY(mn.pos.y + 0.1), ['#c8bba0', '#a89c82'], 3, { speed: 1, up: 1, size: 0.08, life: 0.5, gravity: 8 });
        let arm = Math.sin(t + Math.PI) * 0.3 * w;
        // удар: кулаки над головой — и в землю
        if (swing >= 0) arm = swing < 0.45 ? -2.8 * (swing / 0.45) : swing < 0.55 ? -2.8 + 2.3 * ((swing - 0.45) / 0.1) : -0.5 * (1 - (swing - 0.55) / 0.45);
        P.arms.forEach((a2, j) => { a2.rotation.x = swing >= 0 ? arm : arm * (j ? 1 : -1); });
        // руна мерцает: зов на себя
        P.rune.opacity = 0.75 + Math.sin(kit.time * 4) * 0.25;
        mn.data.ring = ((mn.data.ring as number | undefined) ?? 0) - dt;
        if ((mn.data.ring as number) <= 0) { mn.data.ring = 2.5; fx.shock(mn.pos.clone().setY(mn.pos.y + 0.05), 2.4, s.a, 0.6, 0.06); }
      },
      onHurt(mn) {
        fx.burst(mn.pos.clone().setY(mn.pos.y + 1.3), ['#9a9284', '#6f695e', '#c8bba0'], 6, { speed: 2, up: 2, size: 0.08, life: 0.5, gravity: 10 });
        const now = performance.now();
        if (now - lastCrumb > 120) { lastCrumb = now; hiss({ dur: 0.06, vol: 0.12, f: 1400, q: 1.5, verb: 0.1 }); }
      },
    });
    onEnd(kit, m, life, () => {
      // голем осыпается: камни разлетаются
      fx.burst(m.pos.clone().setY(m.pos.y + 1.2), ['#9a9284', '#6f695e', '#5f8a3a'], 24, { speed: 3, up: 3, size: 0.14, life: 0.9, gravity: 10 });
      boom(80, 30, 0.6, 0.3);
      farewell(kit, m, 2.4);
    });
  });
}

export const BASE_SUMMON = {
  wolves: { school: 'summon', tier: 'common', title: 'Стая волков', cast: wolves },
  elemental: { school: 'summon', tier: 'common', title: 'Малый элементаль', cast: elemental },
  golem: { school: 'summon', tier: 'common', title: 'Каменный голем', cast: golem },
} satisfies Partial<Record<BossSpellKind, Spell>>;
