import * as THREE from 'three';
import type { BossSpellKind } from '../items';
import { boom, deg, hiss, pluck, voice } from '../spell-audio';
import type { Spells } from '../spells';
import type { Target } from '../target';
import { C, rand, type BossSpell } from './kit';

/**
 * Базовые заклинания огня (wiki/design-spells.md, «Базовые заклинания»): огненная стена, огненный ураган, малый армагеддон.
 * Не слишком сильные, у торговца; анатомия каста как у всех — замах, удар (impact), послевкусие (следы, угли).
 */

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const FIRE_A = C(4, 1.5, 0.35), FIRE_B = C(4, 3, 1), WHITE = C(4, 3.6, 2.4);
const FIRE_ROOT = 220;

const glowMat = (c: THREE.Color, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

/** Живые цели в полосе вдоль отрезка a–b шириной ±w */
function inStrip(kit: Spells, a: THREE.Vector3, b: THREE.Vector3, w: number): Target[] {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  return kit.h.targets().filter((t) => {
    if (!t.alive) return false;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((t.pos.x - a.x) * dx + (t.pos.z - a.z) * dz) / l2)) : 0;
    return Math.hypot(a.x + dx * k - t.pos.x, a.z + dz * k - t.pos.z) - t.radius <= w;
  });
}

/** Языки пламени над точкой: поднимаются и тают */
function flames(kit: Spells, p: THREE.Vector3, n: number, h = 1): void {
  for (let i = 0; i < n; i++) kit.h.fx.particle({
    pos: p.clone().add(new THREE.Vector3(rand(-0.25, 0.25), rand(0, 0.3), rand(-0.25, 0.25))),
    vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.4, 2.6) * h, rand(-0.3, 0.3)), life: rand(0.3, 0.55), size: rand(0.08, 0.15),
    color: Math.random() < 0.55 ? FIRE_A : FIRE_B, gravity: -1.5,
  });
}

const sfx = {
  /** Стена встаёт: рёв снизу вверх, удар и аккорд */
  wallUp(k: number) {
    boom(120 - k * 30, 40, 0.7, 0.45);
    hiss({ dur: 0.7 + k * 0.3, vol: 0.28, f: 250, f1: 2200, q: 0.5, type: 'lowpass', attack: 0.06, verb: 0.35 });
    [0, 7, 12].forEach((s, i) => voice({ type: 'sawtooth', f: FIRE_ROOT * Math.pow(2, s / 12), dur: 0.8, vol: 0.04, detune: 10, lp: 2400, lp1: 300, delay: i * 0.03, verb: 0.4 }));
  },
  /** Ровный треск горения — короткий, повторяется тиками */
  crackle() {
    for (let i = 0; i < 3; i++) hiss({ dur: 0.025, vol: 0.05, f: rand(2500, 5500), q: 3, delay: Math.random() * 0.4, verb: 0.1 });
    hiss({ dur: 0.45, vol: 0.05, f: 400, q: 0.6, type: 'lowpass', verb: 0.2 });
  },
  /** Смерч закрутился: свист вверх, гул */
  stormUp(k: number) {
    boom(110, 45, 0.6, 0.4);
    hiss({ dur: 1, vol: 0.22 + k * 0.08, f: 300, f1: 1800, q: 1.2, attack: 0.3, verb: 0.4 });
    voice({ type: 'triangle', f: deg(FIRE_ROOT * 2, 0), f1: deg(FIRE_ROOT * 2, 5), dur: 0.6, vol: 0.05, verb: 0.4 });
  },
  /** Вой вихря — волна шума, повторяется */
  whirl() { hiss({ dur: 0.65, vol: 0.09, f: 500, f1: 900, q: 2, attack: 0.25, verb: 0.3 }); },
  /** Шар летит: свист вниз */
  fall() { hiss({ dur: 0.35, vol: 0.06, f: 3000, f1: 700, q: 1.5, verb: 0.2 }); },
  /** Шар упал: удар, треск и нота пентатоники */
  ballBoom(i: number) {
    boom(130, 40, 0.35, 0.3);
    hiss({ dur: 0.3, vol: 0.18, f: 1400, f1: 220, q: 0.5, type: 'lowpass', verb: 0.3 });
    pluck(deg(FIRE_ROOT * 2, (i * 2) % 8), 0.05);
  },
};

// ---------- огненная стена ----------

const firewall: BossSpell = {
  school: 'fireball', tier: 'common', title: 'Огненная стена',
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, hero = kit.h.hero;
    const c = kit.ground(at, 8);
    const dir = new THREE.Vector3(c.x - hero.pos.x, 0, c.z - hero.pos.z);
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
    dir.normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const L = (a.radius ?? 5) + k * 3, dur = a.duration ?? 4, half = L / 2;
    const A = c.clone().addScaledVector(side, -half), B = c.clone().addScaledVector(side, half);
    kit.face(c);
    kit.windup('fireball', k);
    // замах: по линии будущей стены бежит тлеющая черта
    const n = Math.max(6, Math.round(L * 1.6));
    for (let i = 0; i <= n; i++) kit.later((i / n) * 0.28, () => {
      const p = A.clone().lerp(B, i / n);
      fx.particle({ pos: p.clone().setY(p.y + 0.05), vel: new THREE.Vector3(0, 0.6, 0), life: 0.5, size: 0.1, color: FIRE_A, gravity: -0.5 });
    });
    kit.later(0.3, () => {
      kit.impact('fireball', c, k, 14, 0.35);
      kit.pomp('common', c, 'fireball');
      sfx.wallUp(k);
      fx.flash(c.clone().setY(c.y + 1), FIRE_B.clone().multiplyScalar(0.6), L * 0.6, 0.3);
      // воксельные столбы пламени: ядро и полупрозрачная оболочка, колышутся
      const g = new THREE.Group();
      const mats = [glowMat(FIRE_B.clone().multiplyScalar(0.3), 0.75), glowMat(FIRE_A.clone().multiplyScalar(0.22), 0.45)];
      const cols: { m: THREE.Mesh; base: number; ph: number }[] = [];
      const cn = Math.round(L * 1.6);
      for (let i = 0; i < cn; i++) {
        const p = A.clone().lerp(B, (i + 0.5) / cn);
        for (let j = 0; j < 2; j++) {
          const m = new THREE.Mesh(UNIT, mats[j]);
          const base = (j ? 1.5 : 1) * (0.55 + Math.random() * 0.7) * (1 + k * 0.25);
          m.position.set(p.x, p.y, p.z);
          m.scale.set(j ? 0.42 : 0.24, 0.01, j ? 0.42 : 0.24);
          m.rotation.y = Math.random() * Math.PI;
          g.add(m); cols.push({ m, base, ph: Math.random() * 6 });
        }
      }
      kit.h.scene.add(g);
      let t = 0, tick = 0;
      const hit = (): void => {
        for (const tg of inStrip(kit, A, B, 0.7)) {
          kit.h.damage(tg, Math.round(power), c, 0.15);
          flames(kit, tg.pos.clone().setY(tg.pos.y + 0.3), 4);
        }
      };
      hit();
      kit.proc((dt) => {
        t += dt; tick += dt;
        const rise = Math.min(1, t / 0.25), fall = Math.max(0, Math.min(1, (dur - t) / 0.5));
        for (const col of cols) {
          const h = col.base * rise * fall * (0.85 + Math.sin(kit.time * 9 + col.ph) * 0.15);
          col.m.scale.y = Math.max(0.01, h);
          col.m.position.y = c.y + h / 2;
          col.m.rotation.y += dt * 1.5;
        }
        // языки пламени и марево
        for (let i = 0; i < 3 + k * 2; i++) {
          const p = A.clone().lerp(B, Math.random());
          if (fall > 0.2) flames(kit, p, 1, 1.2);
        }
        if (Math.random() < 0.25) fx.particle({ pos: A.clone().lerp(B, Math.random()).setY(c.y + rand(1.2, 2)), vel: new THREE.Vector3(0, rand(0.6, 1.2), 0), life: 0.8, size: 0.06, color: WHITE.clone().multiplyScalar(0.3), gravity: -0.3 });
        if (tick >= 0.5 && t < dur) { tick -= 0.5; hit(); sfx.crackle(); }
        if (t < dur) return true;
        kit.h.scene.remove(g);
        for (const m of mats) m.dispose();
        return false;
      });
      // послевкусие: выжженная полоса и угли
      for (let i = 0; i < Math.ceil(L / 1.5); i++) {
        const p = A.clone().lerp(B, (i + 0.5) / Math.ceil(L / 1.5));
        fx.decal(p, kit.tex.scorch(), '#ffffff', 2, dur + 3, false, 0.6);
      }
      fx.decal(c, kit.tex.glow(), FIRE_A.clone().multiplyScalar(0.25), L, dur + 0.8, true);
    });
  },
};

// ---------- огненный ураган ----------

const firestorm: BossSpell = {
  school: 'fireball', tier: 'common', title: 'Огненный ураган',
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, hero = kit.h.hero;
    const R = (a.radius ?? 1.8) + k * 0.6, dur = a.duration ?? 4;
    const end = kit.ground(at, 14);
    const start = hero.pos.clone().add(new THREE.Vector3(end.x - hero.pos.x, 0, end.z - hero.pos.z).normalize().multiplyScalar(1.2));
    if (!Number.isFinite(start.x)) start.copy(hero.pos);
    kit.face(end);
    kit.windup('fireball', k);
    // замах: угли закручиваются спиралью там, где родится смерч
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 4, r = R * (1 - i / 24), life = 0.3;
      const from = start.clone().add(new THREE.Vector3(Math.cos(ang) * r * 1.5, 0.1, Math.sin(ang) * r * 1.5));
      fx.particle({ pos: from, vel: start.clone().setY(start.y + 0.8).sub(from).divideScalar(life), life, size: 0.08, color: i % 2 ? FIRE_A : FIRE_B, gravity: 0, shrink: false });
    }
    kit.later(0.3, () => {
      kit.impact('fireball', start, k, 14, 0.35);
      kit.pomp('common', start, 'fireball');
      sfx.stormUp(k);
      // смерч: стопка вращающихся колец-лент огня, шире кверху
      const g = new THREE.Group();
      const mats: THREE.MeshBasicMaterial[] = [];
      const rings: { m: THREE.Mesh; y: number; r: number; sp: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const y = 0.2 + i * 0.42, r = R * (0.35 + i * 0.12);
        const mat = glowMat((i % 2 ? FIRE_A : FIRE_B).clone().multiplyScalar(0.45), 0.75);
        mats.push(mat);
        const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07 + i * 0.01, 4, 20, Math.PI * 1.4), mat);
        m.rotation.x = -Math.PI / 2;
        m.position.y = y;
        g.add(m); rings.push({ m, y, r, sp: (i % 2 ? 1 : -1) * (5 + i) });
      }
      g.position.copy(start);
      kit.h.scene.add(g);
      const pos = start.clone();
      const step = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
      const len = step.length();
      if (len > 0.01) step.divideScalar(len);
      let t = 0, tick = 0, howl = 0, trail = 0;
      kit.proc((dt) => {
        t += dt; tick += dt; howl -= dt; trail -= dt;
        // катится к курсору ≈2,5 м/с, у цели кружит на месте
        const travelled = pos.distanceTo(start);
        if (travelled < len) pos.addScaledVector(step, Math.min(2.5 * dt, len - travelled));
        const fy = kit.h.terrain.floorAt(pos.x, pos.z, pos.y + 2);
        if (Number.isFinite(fy)) pos.y = fy;
        const wob = Math.sin(t * 5) * 0.15;
        g.position.set(pos.x + wob, pos.y, pos.z + Math.cos(t * 4) * 0.15);
        const grow = Math.min(1, t / 0.3), fade = Math.max(0, Math.min(1, (dur - t) / 0.4));
        g.scale.setScalar(Math.max(0.01, grow * fade));
        for (const rg of rings) rg.m.rotation.z += dt * rg.sp;
        // затягивает частицы с земли и выбрасывает угли сверху
        for (let i = 0; i < 3; i++) {
          const ang = Math.random() * Math.PI * 2, r = R * rand(1.2, 2);
          const from = pos.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0.1, Math.sin(ang) * r)), life = 0.45;
          const v = pos.clone().setY(pos.y + rand(0.3, 1.5)).sub(from).divideScalar(life).add(new THREE.Vector3(-Math.sin(ang) * 3, 0, Math.cos(ang) * 3));
          fx.particle({ pos: from, vel: v, life, size: rand(0.05, 0.09), color: Math.random() < 0.5 ? FIRE_A : FIRE_B, gravity: 0 });
        }
        if (Math.random() < 0.5) fx.particle({ pos: pos.clone().setY(pos.y + 3), vel: new THREE.Vector3(rand(-2, 2), rand(1, 3), rand(-2, 2)), life: 0.7, size: 0.08, color: FIRE_B, gravity: 4 });
        // колея: редкие следы, чтобы не копилось тёмное пятно
        if (trail <= 0 && pos.distanceTo(start) < len) { trail = 0.45; fx.decal(pos, kit.tex.scorch(), '#ffffff', R * 1.2, 3, false, 0.3); }
        if (tick >= 0.3 && t < dur) {
          tick -= 0.3;
          for (const tg of kit.within(pos, R)) {
            kit.h.damage(tg, Math.round(power), pos, 0.1);
            tg.chill?.(0.3, 0.6);
          }
        }
        if (howl <= 0) { howl = 0.55; sfx.whirl(); }
        if (t < dur) return true;
        // конец: рассыпается кольцом углей
        fx.burst(pos.clone().setY(pos.y + 1), [FIRE_A, FIRE_B], 24, { speed: 4, up: 3, size: 0.08, life: 0.6, glow: true, gravity: 5 });
        fx.shock(pos, R * 1.5, FIRE_A, 0.4, 0.15);
        kit.h.scene.remove(g);
        g.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
        for (const m of mats) m.dispose();
        return false;
      });
    });
  },
};

// ---------- малый армагеддон ----------

const armageddon: BossSpell = {
  school: 'fireball', tier: 'common', title: 'Малый армагеддон',
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, hero = kit.h.hero;
    const R = (a.radius ?? 5) + k, dur = a.duration ?? 3, count = 8 + Math.round(k * 6);
    kit.windup('fireball', k);
    // замах: круг на земле вокруг героя, в небе собираются огоньки
    kit.groundSigil('fireball', hero.pos.clone(), R, 0.4, dur + 0.2, 0.22);
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(ang) * R * 0.7, 7, Math.sin(ang) * R * 0.7)), vel: new THREE.Vector3(0, 0.5, 0), life: 0.5, size: 0.12, color: FIRE_B, gravity: 0 });
    }
    voice({ type: 'triangle', f: deg(FIRE_ROOT, 0), f1: deg(FIRE_ROOT, 7), dur: 0.5, vol: 0.05, verb: 0.4 });
    let first = true;
    for (let i = 0; i < count; i++) {
      kit.later(0.35 + (i / count) * dur, () => {
        // каждый 3-й — во врага в круге, ближайшего к курсору (по очереди из двух ближайших), остальные — куда попало
        const near = i % 3 === 2 ? kit.within(hero.pos, R).filter((t) => !t.prop)
          .sort((u, v) => Math.hypot(u.pos.x - at.x, u.pos.z - at.z) - Math.hypot(v.pos.x - at.x, v.pos.z - at.z)) : [];
        let p: THREE.Vector3;
        if (near.length) p = near[Math.floor(i / 3) % Math.min(2, near.length)].pos.clone();
        else { const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R; p = hero.pos.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r)); }
        const fy = kit.h.terrain.floorAt(p.x, p.z, p.y + 3);
        p.y = Number.isFinite(fy) ? fy : hero.pos.y;
        ball(kit, p, power, k, i, first);
        first = false;
      });
    }
  },
};

/** Огненный шар падает на метку и взрывается маленьким кругом ~1,5 м */
function ball(kit: Spells, p: THREE.Vector3, power: number, k: number, i: number, first: boolean): void {
  const fx = kit.h.fx, fall = 0.55, r = 1.5;
  // тень-метка
  const markMat = glowMat(FIRE_A.clone().multiplyScalar(0.35), 0);
  const mark = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 24), markMat);
  mark.rotation.x = -Math.PI / 2;
  mark.position.copy(p).setY(p.y + 0.05);
  fx.custom(mark, fall, (t) => { markMat.opacity = t * 0.9; mark.scale.setScalar(1.6 - t * 0.6); }, () => { mark.geometry.dispose(); markMat.dispose(); });
  // сам шар: белое ядро в оранжевой оболочке, хвост искр
  const coreMat = glowMat(WHITE.clone().multiplyScalar(0.8)), shellMat = glowMat(FIRE_A.clone().multiplyScalar(0.55), 0.6);
  const g = new THREE.Group();
  const core = new THREE.Mesh(UNIT, coreMat), shell = new THREE.Mesh(UNIT, shellMat);
  core.scale.setScalar(0.3); shell.scale.setScalar(0.5);
  g.add(core, shell);
  const from = p.clone().add(new THREE.Vector3(rand(-2, 2), 8, rand(-2, 2)));
  g.position.copy(from);
  sfx.fall();
  fx.custom(g, fall, (t) => {
    g.position.lerpVectors(from, p.clone().setY(p.y + 0.25), t * t);
    core.rotation.x += 0.3; shell.rotation.y -= 0.25;
    fx.particle({ pos: g.position.clone(), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.5, 1.2), rand(-0.3, 0.3)), life: 0.35, size: 0.08, color: Math.random() < 0.5 ? FIRE_A : FIRE_B, gravity: -1 });
  }, () => { coreMat.dispose(); shellMat.dispose(); });
  kit.later(fall, () => {
    if (first) kit.impact('fireball', p, k, 12, 0.3);
    else fx.shake = Math.max(fx.shake, 0.18);
    sfx.ballBoom(i);
    fx.flash(p.clone().setY(p.y + 0.6), FIRE_B.clone().multiplyScalar(0.55), 2.2, 0.25);
    fx.burst(p.clone().setY(p.y + 0.4), [FIRE_A, FIRE_B, WHITE], 16, { speed: 3.5, up: 3, size: 0.07, life: 0.5, glow: true, gravity: 6 });
    fx.shock(p, r, FIRE_A, 0.3, 0.2);
    kit.h.aoe(p, r, Math.round(power), 0.8, true);
    fx.decal(p, kit.tex.scorch(), '#ffffff', 1.8, 3.5, false, 0.6);
    // угли на месте ещё секунду
    let left = 1.2;
    kit.proc((dt) => { left -= dt; if (Math.random() < 0.4) flames(kit, p, 1, 0.8); return left > 0; });
  });
}

export const BASE_FIRE: Partial<Record<BossSpellKind, BossSpell>> = { firewall, firestorm, armageddon };
