import * as THREE from 'three';
import type { ArtifactStats, BossSpellKind } from '../items';
import { lightBeam } from '../loot-look';
import { bell, boom, deg, hiss, pluck, semi, voice } from '../spell-audio';
import type { Spells } from '../spells';
import type { Target } from '../target';
import { C, rand, type BossSpell } from './kit';

/**
 * Молния и свет (wiki/design-spells.md, раздел 3, 7–12): копьё громовержца, громовой прыжок, грозовая туча,
 * звездопад, луч павшей звезды, небесный суд. Каждое — замах, удар (impact + pomp по ступени), послевкусие.
 */

const WHITE = C(3.6, 3.8, 4);
const GOLD = C(4, 3.2, 1.2);

/** Расстояние от точки (px, pz) до отрезка a–b на плоскости */
function segDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** Светящийся брусок (ядро не тонируется — светится через bloom) */
const glowBox = (color: THREE.Color, opacity = 1, additive = false): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> => new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive }),
);

const disposeTree = (o: THREE.Object3D): void => {
  o.parent?.remove(o);
  o.traverse((x) => { if (x instanceof THREE.Mesh) { x.geometry.dispose(); (x.material as THREE.Material).dispose(); } });
};

/**
 * Куда сейчас целится игрок: точка каста, а если курсор с тех пор сдвинулся — сам курсор (kit.aim).
 * В тестах и при клике по слоту курсор может стоять в другом месте — тогда держимся точки каста
 */
function aimer(kit: Spells, at: THREE.Vector3): () => THREE.Vector3 {
  const aim0 = kit.aim.clone();
  let moved = false;
  return () => {
    if (!moved && kit.aim.distanceToSquared(aim0) > 0.01) moved = true;
    return moved ? kit.aim : at;
  };
}

/** Направление на плоскости от героя к точке (если совпали — куда смотрит герой) */
function flatDir(kit: Spells, at: THREE.Vector3): THREE.Vector3 {
  const hero = kit.h.hero;
  const d = new THREE.Vector3(at.x - hero.pos.x, 0, at.z - hero.pos.z);
  return d.lengthSq() > 0.01 ? d.normalize() : new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
}

// ---------- звуки группы: пентатоника, низ через boom, реверберация ----------
const sfx = {
  /** Копьё растёт в руке: треск и подъём */
  spearGrow() {
    for (let i = 0; i < 6; i++) hiss({ dur: 0.03, vol: 0.07, f: rand(4000, 8000), q: 2, delay: i * 0.035, verb: 0.15 });
    voice({ type: 'triangle', f: 440, f1: 1760, dur: 0.28, vol: 0.05, lp: 4000, verb: 0.3 });
  },
  /** Бросок: свист разряда */
  spearThrow(k: number) {
    hiss({ dur: 0.3, vol: 0.25 + k * 0.1, f: 6000, f1: 1200, q: 0.8, verb: 0.3 });
    boom(150, 60, 0.3, 0.3);
    voice({ type: 'triangle', f: 1318.5, f1: 659.25, dur: 0.3, vol: 0.05, verb: 0.4 });
  },
  /** Копьё прошило цель: щипок выше и выше */
  spearPierce(i: number) {
    pluck(deg(659.25, 2 + i * 2), 0.08);
    hiss({ dur: 0.08, vol: 0.14, f: 4500, q: 1, verb: 0.2 });
  },
  /** Гром: щелчок, низ, яркий аккорд и раскат */
  thunder(k: number) {
    hiss({ dur: 0.05, vol: 0.45, f: 3000, type: 'highpass', verb: 0.2 });
    boom(100 - k * 30, 30, 0.9 + k * 0.3, 0.6 + k * 0.15, 0, 0.4);
    [0, 7, 12, 16].forEach((s, i) => voice({ type: 'triangle', f: semi(659.25, s), dur: 0.9, vol: 0.045, delay: 0.02 + i * 0.03, verb: 0.6 }));
    hiss({ dur: 1.8 + k, vol: 0.18 + k * 0.08, f: 240, f1: 60, q: 0.5, type: 'lowpass', attack: 0.3, delay: 0.1, verb: 0.5 });
  },
  /** Прыжок: «вжух» вверх */
  leapUp() {
    hiss({ dur: 0.35, vol: 0.2, f: 600, f1: 4000, q: 0.6, attack: 0.05, verb: 0.3 });
    voice({ type: 'triangle', f: 330, f1: 990, dur: 0.3, vol: 0.05, verb: 0.3 });
  },
  /** Туча собралась: мягкий рокот */
  rumble(v = 0.1) {
    hiss({ dur: 1.2, vol: v, f: 200, f1: 70, q: 0.5, type: 'lowpass', attack: 0.3, verb: 0.5 });
    boom(70, 35, 0.8, v * 1.5, 0.1, 0.4);
  },
  /** Молния из тучи */
  cloudStrike(i: number) {
    hiss({ dur: 0.04, vol: 0.32, f: 3000, type: 'highpass', verb: 0.2 });
    hiss({ dur: 0.25, vol: 0.2, f: 3200, f1: 500, q: 0.9, verb: 0.3 });
    boom(90, 32, 0.5, 0.35, 0, 0.35);
    pluck(deg(659.25, (i * 2) % 9), 0.05, 0.02);
  },
  /** Звезда падает: высокий свист вниз */
  starWhistle() { voice({ type: 'sine', f: 2637, f1: 880, dur: 0.32, vol: 0.03, verb: 0.4 }); },
  /** Звезда упала: колокольчик пентатоники и мягкий удар */
  starLand(i: number) {
    bell(deg(783.99, (i * 3) % 10), 0.7, 0.05, 0, 0.6);
    boom(130, 50, 0.25, 0.18);
    hiss({ dur: 0.1, vol: 0.08, f: 6000, type: 'highpass', verb: 0.2 });
  },
  /** Луч: долгий аккорд и гул; dur — сколько держится */
  beamHold(dur: number) {
    [0, 4, 7, 12, 16].forEach((s) => voice({ type: 'triangle', f: semi(196, s), dur: dur + 0.4, vol: 0.045, attack: 0.25, detune: 10, lp: 3000, verb: 0.6 }));
    voice({ type: 'sine', f: 783.99, dur: dur + 0.4, vol: 0.04, attack: 0.2, verb: 0.7 });
    hiss({ dur: dur + 0.3, vol: 0.14, f: 1800, q: 0.6, attack: 0.15, verb: 0.4 });
    for (let t = 0; t < dur; t += 0.45) boom(80, 40, 0.4, 0.25, t, 0.3);
  },
  /** Свет собирается в руке: подъём */
  gather(dur: number) {
    voice({ type: 'sine', f: 392, f1: 1568, dur, vol: 0.06, attack: dur * 0.8, verb: 0.6 });
    hiss({ dur, vol: 0.12, f: 800, f1: 7000, q: 0.6, attack: dur * 0.9, verb: 0.5 });
  },
  /** Небесный суд опускается: хор с медленной атакой */
  choir(dur: number) {
    [0, 4, 7, 12].forEach((s, i) => voice({ type: 'triangle', f: semi(261.63, s), dur: dur + 0.6, vol: 0.04, attack: dur * 0.8, detune: 12, lp: 2600, delay: i * 0.03, verb: 0.8 }));
  },
  /** Удар суда: колокол, аккорд и низ */
  judgement(k: number) {
    boom(110 - k * 30, 30, 1.2, 0.7, 0, 0.5);
    bell(semi(523.25, 0), 2.4, 0.1, 0, 0.8); bell(semi(523.25, 7), 2, 0.07, 0.04, 0.8); bell(semi(523.25, 12), 1.8, 0.06, 0.08, 0.8);
    [0, 4, 7, 11, 14].forEach((s, i) => pluck(semi(261.63, s + 12), 0.05, 0.15 + i * 0.05, 1.2));
    hiss({ dur: 0.8, vol: 0.12, f: 5000, type: 'highpass', attack: 0.05, verb: 0.5 });
  },
};

// ---------- 7. Копьё громовержца ----------

function thunderspear(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('spark');
  const dir = flatDir(kit, at);
  const L = a.radius ?? 18;
  kit.face(hero.pos.clone().add(dir));
  kit.windup('spark', k);
  sfx.spearGrow();
  // замах: копьё молнии вырастает в руке, вокруг треск
  const spear = new THREE.Group();
  const core = glowBox(WHITE), halo = glowBox(s.a.clone().multiplyScalar(0.55), 0.55, true);
  spear.add(core, halo);
  const width = 0.09 + k * 0.05, len = 1.6 + k * 0.8;
  kit.h.scene.add(spear);
  const place = (p: THREE.Vector3, grow: number): void => {
    spear.position.copy(p);
    spear.lookAt(p.clone().add(dir));
    core.scale.set(width, width, len * grow);
    halo.scale.set(width * 4, width * 4, len * grow * 1.05);
  };
  const grow = 0.25;
  let t = 0, thrown = false, travel = 0, done = false;
  const hit = new Set<Target>();
  const start = new THREE.Vector3();
  let end = new THREE.Vector3();
  const finish = (p: THREE.Vector3): void => {
    done = true;
    disposeTree(spear);
    // удар на выходе: гром с неба в конец линии
    const g = p.clone();
    const y = kit.h.terrain.floorAt(g.x, g.z, hero.pos.y + 2);
    g.y = Number.isFinite(y) ? y : hero.pos.y;
    kit.impact('spark', g, k, 14, 0.5);
    kit.pomp('rare', g, 'spark');
    sfx.thunder(k);
    kit.bolt(g.clone().setY(g.y + 11), g.clone().setY(g.y + 0.05), s.a, 0.13 + k * 0.06, 4, 0.4);
    fx.flash(g.clone().setY(g.y + 1), s.b.clone().multiplyScalar(0.7), 3 + k, 0.25);
    fx.shock(g.clone().setY(g.y + 0.05), 3 + k * 1.5, s.a, 0.4, 0.2);
    fx.burst(g.clone().setY(g.y + 0.6), [s.a, s.b], 26, { speed: 6, up: 4, size: 0.06, life: 0.5, glow: true, gravity: 8 });
    kit.h.aoe(g, 2 + k, Math.round(power * 0.5), 1.4, false);
    fx.decal(g, kit.tex.scorch(), '#ffffff', 2 + k, 3, false, 0.7);
    fx.decal(g, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), 2.4 + k, 1, true);
    // послевкусие: светящаяся борозда вдоль пути копья
    const trail = glowBox(s.a.clone().multiplyScalar(0.45), 0.8, true);
    const tl = start.distanceTo(g.clone().setY(start.y));
    trail.position.copy(start).lerp(g.clone().setY(start.y), 0.5).setY(hero.pos.y + 0.06);
    trail.lookAt(g.clone().setY(hero.pos.y + 0.06));
    trail.scale.set(0.25 + k * 0.15, 0.02, tl);
    fx.custom(trail, 1.4, (q) => { trail.material.opacity = 0.8 * (1 - q) ** 2; trail.scale.x = (0.25 + k * 0.15) * (1 - q * 0.6); });
  };
  kit.proc((dt) => {
    if (done) return false;
    t += dt;
    if (!thrown) {
      const q = Math.min(1, t / grow);
      place(kit.hand().add(new THREE.Vector3(0, 0.25, 0)), 0.2 + 0.8 * q);
      if (Math.random() < 0.6) kit.bolt(spear.position.clone(), spear.position.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.4, 0.5), rand(-0.6, 0.6))), s.a, 0.025, 0, 0.08);
      if (t >= grow) {
        thrown = true;
        start.copy(spear.position);
        end = start.clone().addScaledVector(dir, L);
        // упрётся в стену раньше — там и гром
        const wall = kit.h.terrain.wallHit(start.x, start.z, end.x, end.z, hero.pos.y + 0.5);
        if (wall) end.set(wall.x, start.y, wall.z);
        sfx.spearThrow(k);
        fx.flash(start, s.b.clone().multiplyScalar(0.7), 1.6, 0.18);
      }
      return true;
    }
    const total = start.distanceTo(end);
    const prev = travel;
    travel = Math.min(total, travel + 42 * dt);
    const p = start.clone().addScaledVector(dir, travel);
    place(p, 1);
    // хвост искр
    for (let i = 0; i < 4; i++) fx.particle({ pos: p.clone().addScaledVector(dir, -rand(0, len)), vel: new THREE.Vector3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)), life: 0.25, size: 0.05, color: Math.random() < 0.5 ? s.a : s.b, gravity: 2 });
    // пронзает всех на отрезке, пройденном за кадр
    const a0 = start.clone().addScaledVector(dir, prev);
    for (const tg of kit.h.targets()) {
      if (!tg.alive || hit.has(tg)) continue;
      if (segDist(a0.x, a0.z, p.x, p.z, tg.pos.x, tg.pos.z) > tg.radius + 0.4) continue;
      hit.add(tg);
      kit.h.damage(tg, Math.round(power), hero.pos, 1.2 + k);
      const tp = tg.pos.clone().setY(tg.pos.y + 1);
      fx.flash(tp, s.b.clone().multiplyScalar(0.6), 1.8, 0.2);
      fx.burst(tp, [s.a, s.b], 12, { speed: 4, up: 2, size: 0.05, life: 0.35, glow: true, gravity: 6 });
      kit.bolt(tp, tp.clone().add(new THREE.Vector3(rand(-1.2, 1.2), rand(-0.8, 0.4), rand(-1.2, 1.2))), s.a, 0.04, 1, 0.2);
      sfx.spearPierce(hit.size - 1);
    }
    if (travel >= total) finish(p);
    return !done;
  });
}

// ---------- 8. Громовой прыжок ----------

function thunderleap(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('spark');
  const R = (a.radius ?? 4.5) + k * 1.5;
  // куда приземлиться: к курсору, но не дальше 3 м и не сквозь стену
  const dir = flatDir(kit, at);
  const far = Math.min(3, Math.hypot(at.x - hero.pos.x, at.z - hero.pos.z));
  let land = hero.pos.clone().addScaledVector(dir, far);
  if (kit.h.terrain.blocked(hero.pos.x, hero.pos.z, land.x, land.z, hero.pos.y + 0.5)) land = hero.pos.clone();
  kit.face(land.clone().add(dir));
  kit.windup('spark', k);
  // замах: присел — по ногам бегут искры, круг на месте приземления
  kit.groundSigil('spark', land, R * 0.7, 0.4, 0.5, 0.22);
  for (let i = 0; i < 16; i++) {
    const an = Math.random() * Math.PI * 2;
    fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(an) * 0.6, 0.1, Math.sin(an) * 0.6)), vel: new THREE.Vector3(0, rand(2, 4), 0), life: 0.3, size: 0.05, color: s.b, gravity: 0 });
  }
  kit.later(0.15, () => {
    if (hero.down) return;
    const from = hero.pos.clone();
    hero.grounded = false;
    hero.vy = 11;
    sfx.leapUp();
    fx.shock(from.clone().setY(from.y + 0.05), 1.8, s.a, 0.3, 0.15);
    fx.burst(from.clone().setY(from.y + 0.1), ['#d8cfa8', '#b9ad88'], 10, { speed: 2.5, up: 1.5, size: 0.1, life: 0.4, gravity: 6 });
    let t = 0, landed = false;
    const airT = (2 * 11) / 30;
    kit.proc((dt) => {
      if (landed) return false;
      t += dt;
      // в полёте тянемся к точке приземления; за героем тянется хвост искр
      const q = Math.min(1, t / airT);
      const want = from.clone().lerp(land, q);
      hero.pos.x = want.x; hero.pos.z = want.z;
      for (let i = 0; i < 3; i++) fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.2, 1.6), rand(-0.3, 0.3))), vel: new THREE.Vector3(rand(-0.5, 0.5), rand(-1, 0.5), rand(-0.5, 0.5)), life: 0.3, size: 0.05, color: Math.random() < 0.5 ? s.a : s.b, gravity: 0 });
      if (Math.random() < 0.3) kit.bolt(hero.pos.clone().setY(hero.pos.y + 1), hero.pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(0, 2), rand(-1, 1))), s.a, 0.025, 0, 0.08);
      if ((hero.grounded && t > 0.12) || t > 1.4 || hero.down) {
        landed = true;
        slam(kit, hero.pos.clone(), R, power, k);
      }
      return !landed;
    });
  });
}

function slam(kit: Spells, c: THREE.Vector3, R: number, power: number, k: number): void {
  const fx = kit.h.fx, s = kit.color('spark');
  kit.impact('spark', c, k, 16, 0.7);
  kit.pomp('legendary', c, 'spark');
  sfx.thunder(k);
  kit.bolt(c.clone().setY(c.y + 11), c.clone().setY(c.y + 0.5), s.a, 0.16 + k * 0.06, 4, 0.4);
  fx.flash(c.clone().setY(c.y + 0.8), s.b.clone().multiplyScalar(0.5), 3 + k, 0.3);
  fx.shock(c.clone().setY(c.y + 0.05), R, s.a, 0.45, 0.22);
  fx.shock(c.clone().setY(c.y + 0.05), R * 0.6, s.b, 0.35, 0.15);
  fx.burst(c.clone().setY(c.y + 0.2), ['#d8cfa8', '#b9ad88', '#9a8f70'], 18, { speed: 4, up: 3, size: 0.12, life: 0.6, gravity: 8 });
  fx.burst(c.clone().setY(c.y + 0.4), [s.a, s.b], 40, { speed: 8, up: 3, size: 0.06, life: 0.5, glow: true, gravity: 6 });
  kit.h.aoe(c, R, Math.round(power), 2.5, false);
  // цепные молнии во все стороны: по земле лучами и в цели вокруг
  const n = 8 + Math.round(k * 4);
  for (let i = 0; i < n; i++) {
    const an = (i / n) * Math.PI * 2 + rand(-0.2, 0.2), r = R * rand(0.8, 1.15);
    kit.later(i * 0.02, () => kit.bolt(c.clone().setY(c.y + 0.3), c.clone().add(new THREE.Vector3(Math.cos(an) * r, 0.1, Math.sin(an) * r)), s.a, 0.05, 1, 0.3));
  }
  const near = kit.h.targets().filter((t) => t.alive && Math.hypot(t.pos.x - c.x, t.pos.z - c.z) - t.radius < R * 2)
    .sort((x, y) => x.pos.distanceToSquared(c) - y.pos.distanceToSquared(c)).slice(0, 5);
  near.forEach((t, i) => kit.later(0.08 + i * 0.07, () => {
    if (!t.alive) return;
    kit.bolt(c.clone().setY(c.y + 0.8), t.pos.clone().setY(t.pos.y + 1), s.a, 0.06, 1, 0.3);
    fx.flash(t.pos.clone().setY(t.pos.y + 1), s.b.clone().multiplyScalar(0.6), 1.8, 0.2);
    kit.h.damage(t, Math.round(power * 0.4), c, 0.6);
    sfx.spearPierce(i);
  }));
  fx.decal(c, kit.tex.scorch(), '#ffffff', R * 1.6, 4, false, 0.7);
  fx.decal(c, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), R * 1.6, 1.2, true);
  // послевкусие: по кругу ещё секунду ползут искры
  let left = 1.2;
  kit.proc((dt) => {
    left -= dt;
    if (Math.random() < 0.6) {
      const an = Math.random() * Math.PI * 2, r = rand(0.5, R);
      const p = c.clone().add(new THREE.Vector3(Math.cos(an) * r, 0.1, Math.sin(an) * r));
      if (Math.random() < 0.35) kit.bolt(p, p.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.1, 0.5), rand(-0.6, 0.6))), s.a, 0.02, 0, 0.08);
      fx.particle({ pos: p, vel: new THREE.Vector3(0, rand(1, 2.5), 0), life: 0.3, size: 0.04, color: s.b, gravity: 4 });
    }
    return left > 0;
  });
}

// ---------- 9. Грозовая туча ----------

function stormcloud(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('spark');
  const focus = aimer(kit, at);
  const R = (a.radius ?? 7) + k * 2, dur = (a.duration ?? 8) + k * 2;
  kit.face(hero.pos.clone().add(new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw))));
  kit.windup('spark', k);
  sfx.rumble(0.12);
  // воксельная туча: серо-синие кубы, внутри мерцает свет
  const cloud = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#5a6280', transparent: true, opacity: 0.88, emissive: new THREE.Color('#0a1020') });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Mesh(geo, mat);
    const sz = rand(0.5, 1.05);
    m.scale.set(sz * rand(1, 1.5), sz * 0.75, sz);
    // кубы плотнее к середине и выше в центре — «шапка» тучи
    const an = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 1.6;
    m.position.set(Math.cos(an) * r * 1.2, rand(-0.25, 0.25) + (1.6 - r) * 0.25, Math.sin(an) * r * 0.8);
    cloud.add(m);
  }
  const height = 4.6;
  cloud.position.copy(hero.pos).setY(hero.pos.y + height);
  cloud.scale.setScalar(0.01);
  kit.h.scene.add(cloud);
  let t = 0, next = 0.45, strikes = 0, flick = 0;
  const every = 0.75 - k * 0.25;
  kit.proc((dt) => {
    t += dt;
    // туча плывёт за героем, появляется и тает
    const want = hero.pos.clone().setY(hero.pos.y + height + Math.sin(t * 1.5) * 0.15);
    cloud.position.lerp(want, Math.min(1, dt * 3));
    cloud.rotation.y += dt * 0.15;
    const appear = Math.min(1, t / 0.4), vanish = Math.min(1, Math.max(0, (dur + 0.5 - t) / 0.5));
    cloud.scale.setScalar((0.6 + 0.4 * appear) * vanish * (1 + k * 0.25));
    mat.opacity = 0.9 * vanish;
    flick = Math.max(0, flick - dt * 4);
    mat.emissive.setRGB(0.04 + flick * 0.5, 0.06 + flick * 0.7, 0.12 + flick * 1);
    // капли дождя
    if (Math.random() < 0.7 * vanish) fx.particle({ pos: cloud.position.clone().add(new THREE.Vector3(rand(-1.5, 1.5), -0.5, rand(-1.2, 1.2))), vel: new THREE.Vector3(0, -9, 0), life: 0.4, size: 0.04, color: s.b.clone().multiplyScalar(0.5), gravity: 0, shrink: false });
    if (t >= next && t < dur) {
      next = t + every;
      // бьёт ближайшего к прицелу, если он под тучей (в радиусе от героя), иначе — ближайшего к герою
      const f = kit.nearest(focus(), 2.5);
      const tg = f && Math.hypot(f.pos.x - hero.pos.x, f.pos.z - hero.pos.z) - f.radius <= R ? f : kit.nearest(hero.pos, R);
      const bottom = cloud.position.clone().add(new THREE.Vector3(rand(-1, 1), -0.4, rand(-0.8, 0.8)));
      flick = 1;
      if (tg) {
        const tp = tg.pos.clone().setY(tg.pos.y + 1);
        kit.bolt(bottom, tp, s.a, 0.08 + k * 0.04, 2, 0.3);
        if (strikes === 0) { kit.impact('spark', tg.pos, k, 12, 0.35); kit.pomp('common', tg.pos, 'spark'); }
        else { fx.light(tp, s.css, 8, 8, 0.3); fx.shake = Math.max(fx.shake, 0.15); }
        fx.flash(tp, s.b.clone().multiplyScalar(0.6), 2, 0.2);
        fx.burst(tp, [s.a, s.b], 14, { speed: 4, up: 2, size: 0.05, life: 0.35, glow: true, gravity: 6 });
        fx.decal(tg.pos.clone(), kit.tex.scorch(), '#ffffff', 1.2, 2.2, false, 0.6);
        kit.h.damage(tg, Math.round(power), cloud.position, 0.5);
        sfx.cloudStrike(strikes);
        strikes++;
      } else if (Math.random() < 0.4) {
        // целей нет — молния бьёт внутри тучи, глухой рокот
        kit.bolt(bottom.clone().setY(bottom.y + 0.6), bottom.clone().add(new THREE.Vector3(rand(-1.5, 1.5), rand(-0.2, 0.3), rand(-1, 1))), s.a, 0.03, 0, 0.12);
        sfx.rumble(0.05);
      }
    }
    if (t < dur + 0.5) return true;
    cloud.parent?.remove(cloud);
    geo.dispose(); mat.dispose();
    return false;
  });
}

// ---------- 10. Звездопад ----------

function starfall(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('star');
  const c = kit.ground(at, 12);
  const R = (a.radius ?? 6) + k * 1.5, dur = a.duration ?? 5, tele = 0.4;
  kit.face(c);
  kit.windup('star', k);
  sfx.gather(tele);
  kit.groundSigil('star', c, R, tele, dur, 0.14);
  // герой парит в столбе света
  const beam = lightBeam(GOLD.clone().multiplyScalar(0.4), 8, 1.4);
  kit.h.scene.add(beam.group);
  let bt = 0;
  kit.proc((dt) => {
    bt += dt;
    beam.group.position.copy(hero.pos);
    const q = Math.min(1, bt / 0.3) * Math.min(1, Math.max(0, (dur + tele - bt) / 0.5));
    beam.mats.forEach((m) => { m.opacity = q * (0.8 + Math.sin(bt * 6) * 0.15); });
    if (Math.random() < 0.5) {
      const an = Math.random() * Math.PI * 2;
      fx.particle({ pos: hero.pos.clone().add(new THREE.Vector3(Math.cos(an) * 0.7, 0.1, Math.sin(an) * 0.7)), vel: new THREE.Vector3(0, rand(1.5, 3), 0), life: 0.8, size: 0.05, color: Math.random() < 0.5 ? s.a : s.b, gravity: -0.3 });
    }
    if (bt < dur + tele) return true;
    beam.group.parent?.remove(beam.group);
    beam.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    beam.mats.forEach((m) => m.dispose());
    return false;
  });
  // звёзды: каждая четвёртая метит в цель внутри круга, остальные — куда придётся
  const gap = 0.16 - k * 0.04;
  let i = 0;
  for (let t = tele; t < tele + dur; t += gap, i++) {
    const n = i;
    kit.later(t, () => {
      let p: THREE.Vector3;
      const tg = n % 4 === 0 ? kit.nearest(c, R) : null;
      if (tg) p = tg.pos.clone();
      else { const an = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R; p = c.clone().add(new THREE.Vector3(Math.cos(an) * r, 0, Math.sin(an) * r)); }
      fallingStar(kit, p, power, n, k);
    });
  }
}

function fallingStar(kit: Spells, p: THREE.Vector3, power: number, n: number, k: number): void {
  const fx = kit.h.fx, s = kit.color('star');
  const from = p.clone().add(new THREE.Vector3(rand(-3, -1.5), 12, rand(-2, 2)));
  const star = new THREE.Group();
  const core = glowBox(WHITE), shell = glowBox(GOLD.clone().multiplyScalar(0.6), 0.6, true);
  core.scale.setScalar(0.22); shell.scale.setScalar(0.45);
  star.add(core, shell);
  star.position.copy(from);
  kit.h.scene.add(star);
  sfx.starWhistle();
  const fall = 0.35;
  fx.custom(star, fall, (q) => {
    star.position.copy(from).lerp(p.clone().setY(p.y + 0.2), q * q);
    star.rotation.x += 0.3; star.rotation.y += 0.2;
    for (let j = 0; j < 2; j++) fx.particle({ pos: star.position.clone(), vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0, 0.6), rand(-0.4, 0.4)), life: 0.3, size: rand(0.05, 0.09), color: Math.random() < 0.5 ? s.a : s.b, gravity: 0 });
  }, () => { core.geometry.dispose(); core.material.dispose(); shell.geometry.dispose(); shell.material.dispose(); });
  kit.later(fall, () => {
    if (n === 0) { kit.impact('star', p, k, 14, 0.45); kit.pomp('legendary', p, 'star'); }
    else fx.shake = Math.max(fx.shake, 0.12);
    fx.flash(p.clone().setY(p.y + 0.5), s.a.clone().multiplyScalar(0.6), 1.8, 0.22);
    fx.shock(p.clone().setY(p.y + 0.05), 1.8, s.a, 0.3, 0.15);
    fx.burst(p.clone().setY(p.y + 0.3), [s.a, s.b], 12, { speed: 4, up: 3, size: 0.06, life: 0.45, glow: true, gravity: 6 });
    fx.decal(p, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), 1.6, 1, true);
    kit.h.aoe(p, 1.6, Math.round(power), 0.6, false);
    sfx.starLand(n);
  });
}

// ---------- 11. Луч павшей звезды ----------

function starbeam(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('star');
  const L = a.radius ?? 16, dur = (a.duration ?? 3) + k, tele = 0.6;
  const focus = aimer(kit, at);
  const width = 0.5 + k * 0.35;
  // мифическое: мир темнеет на весь замах, крупное название, хор
  kit.pomp('mythic', hero.pos.clone(), 'star', 'Луч павшей звезды', tele + 0.4);
  kit.windup('star', k);
  sfx.gather(tele);
  // замах: свет стягивается к руке, в ладони растёт звезда
  const orb = new THREE.Group();
  const oc = glowBox(WHITE), os = glowBox(GOLD.clone().multiplyScalar(0.6), 0.6, true);
  orb.add(oc, os);
  kit.h.scene.add(orb);
  let yaw = Math.atan2(at.x - hero.pos.x, at.z - hero.pos.z);
  let t = 0, firing = false, tick = 0, decalT = 0, done = false;
  const beam = new THREE.Group();
  const core = glowBox(C(4, 3.7, 2.6)), halo = glowBox(s.a.clone().multiplyScalar(0.5), 0.6, true), outer = glowBox(s.a.clone().multiplyScalar(0.12), 0.3, true);
  beam.add(core, halo, outer);
  const rings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(width * 1.3, 0.04, 6, 24), new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(0.7), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    rings.push(r); beam.add(r);
  }
  let light: THREE.PointLight | null = null;
  kit.proc((dt) => {
    if (done) return false;
    t += dt;
    const hand = kit.hand();
    if (!firing) {
      const q = Math.min(1, t / tele);
      orb.position.copy(hand);
      orb.rotation.x += dt * 6; orb.rotation.y += dt * 4;
      oc.scale.setScalar(0.1 + q * 0.35); os.scale.setScalar(0.2 + q * 0.7);
      for (let i = 0; i < 4; i++) {
        const an = Math.random() * Math.PI * 2, e = rand(-0.5, 0.8), r = rand(1.5, 2.6);
        const from = hand.clone().add(new THREE.Vector3(Math.cos(an) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(an) * Math.cos(e) * r));
        const life = 0.25;
        fx.particle({ pos: from, vel: hand.clone().sub(from).divideScalar(life), life, size: 0.07, color: Math.random() < 0.5 ? s.a : s.b, gravity: 0, shrink: false });
      }
      kit.face(focus(), 0.2);
      fx.zoom = Math.max(fx.zoom, 0.3 * q);
      if (t >= tele) {
        firing = true;
        disposeTree(orb);
        kit.h.scene.add(beam);
        const f0 = focus();
        yaw = Math.atan2(f0.x - hero.pos.x, f0.z - hero.pos.z);
        kit.impact('star', hero.pos.clone(), k, 18, 0.7);
        light = fx.light(hand, s.css, 16 + k * 8, 12, dur + 0.5);
        sfx.beamHold(dur);
      }
      return true;
    }
    // ведём луч за курсором, медленно — он тяжёлый
    const fa = focus();
    const want = Math.atan2(fa.x - hero.pos.x, fa.z - hero.pos.z);
    let dy = want - yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    yaw += Math.sign(dy) * Math.min(Math.abs(dy), dt * 1.8);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    hero.shootPose(yaw, 0.2);
    const from = hand.clone();
    let end = from.clone().addScaledVector(dir, L);
    const wall = kit.h.terrain.wallHit(from.x, from.z, end.x, end.z, hero.pos.y + 0.6);
    if (wall) end = new THREE.Vector3(wall.x, from.y, wall.z);
    const len = from.distanceTo(end);
    const ft = t - tele, fade = Math.min(1, ft / 0.12) * Math.min(1, Math.max(0, (dur - ft) / 0.25));
    beam.position.copy(from).lerp(end, 0.5);
    beam.lookAt(end);
    const wob = 1 + Math.sin(t * 40) * 0.08;
    core.scale.set(width * 0.45 * fade * wob, width * 0.45 * fade * wob, len);
    halo.scale.set(width * 0.95 * fade, width * 0.95 * fade, len);
    outer.scale.set(width * 1.7 * fade, width * 1.7 * fade, len);
    rings.forEach((r, i) => {
      const z = ((t * 6 + i / rings.length) % 1 - 0.5) * len;
      r.position.set(0, 0, z);
      r.scale.setScalar(fade * (1 + ((t * 6 + i / rings.length) % 1) * 0.6));
      r.material.opacity = fade * 0.8;
    });
    fx.zoom = Math.max(fx.zoom, 0.3);
    fx.shake = Math.max(fx.shake, 0.18);
    if (light) { light.position.copy(end).setY(end.y + 0.5); light.intensity = (16 + k * 8) * fade; }
    // конец луча: искры, выжженная полоса
    const g = end.clone();
    const fy = kit.h.terrain.floorAt(g.x, g.z, hero.pos.y + 2);
    g.y = Number.isFinite(fy) ? fy : hero.pos.y;
    for (let i = 0; i < 4; i++) fx.particle({ pos: g.clone().setY(g.y + 0.3), vel: new THREE.Vector3(rand(-3, 3), rand(2, 5), rand(-3, 3)), life: 0.4, size: 0.06, color: Math.random() < 0.5 ? s.a : s.b, gravity: 8 });
    decalT -= dt;
    if (decalT <= 0) {
      decalT = 0.06;
      // полоса вдоль всего луча: следы по линии через равные промежутки
      for (let d = 1.5; d < len; d += 2.2) {
        const q = from.clone().addScaledVector(dir, d);
        const y = kit.h.terrain.floorAt(q.x, q.z, hero.pos.y + 2);
        q.y = Number.isFinite(y) ? y : hero.pos.y;
        if (Math.random() < 0.3) fx.decal(q, kit.tex.scorch(), '#ffffff', 1.2 + width, 3.5, false, 0.45);
      }
      fx.decal(g, kit.tex.glow(), s.a.clone().multiplyScalar(0.25), 1.6, 0.8, true);
    }
    // урон тиками по линии луча
    tick -= dt;
    if (tick <= 0) {
      tick = 0.2;
      for (const tg of kit.h.targets()) {
        if (!tg.alive) continue;
        if (segDist(from.x, from.z, end.x, end.z, tg.pos.x, tg.pos.z) > tg.radius + width) continue;
        kit.h.damage(tg, Math.round(power), hero.pos, 0.6);
        fx.flash(tg.pos.clone().setY(tg.pos.y + 1), s.b.clone().multiplyScalar(0.5), 1.4, 0.15);
      }
    }
    if (ft < dur) return true;
    done = true;
    if (light) light.intensity = 0;
    fx.flash(from, s.b.clone().multiplyScalar(0.6), 2.5, 0.3);
    bell(semi(392, 12), 1.4, 0.06, 0, 0.7);
    disposeTree(beam);
    return false;
  });
}

// ---------- 12. Небесный суд ----------

function judgement(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('star');
  const c = kit.ground(at, 12);
  const R = (a.radius ?? 4) + k * 1.2, tele = 0.55;
  kit.face(c);
  kit.windup('star', k);
  sfx.choir(tele);
  kit.groundSigil('star', c, R, tele, 0.9, 0.3);
  // замах: тонкий луч с неба опускается и густеет, перья света сыплются сверху
  const pre = lightBeam(GOLD.clone().multiplyScalar(0.35), 14, 0.5);
  pre.group.position.copy(c);
  fx.custom(pre.group, tele, (q) => {
    pre.group.scale.set(0.4 + q * 0.6, q, 0.4 + q * 0.6);
    pre.mats.forEach((m) => { m.opacity = q; });
    if (Math.random() < 0.6) fx.particle({ pos: c.clone().add(new THREE.Vector3(rand(-R, R) * 0.6, rand(5, 9), rand(-R, R) * 0.6)), vel: new THREE.Vector3(0, -6, 0), life: 0.6, size: 0.06, color: s.b, gravity: 0 });
  }, () => { pre.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); pre.mats.forEach((m) => m.dispose()); });
  kit.later(tele, () => {
    kit.impact('star', c, k, 18, 0.6);
    kit.pomp('legendary', c, 'star');
    sfx.judgement(k);
    // столп света: широкий, тает за секунду с лишним
    const pillar = lightBeam(GOLD.clone().lerp(WHITE, 0.3).multiplyScalar(0.4), 16, R * 0.55);
    pillar.group.position.copy(c);
    fx.custom(pillar.group, 1.4 + k * 0.3, (q) => {
      pillar.group.scale.set(1 + q * 0.3, 1, 1 + q * 0.3);
      pillar.mats.forEach((m) => { m.opacity = (1 - q) ** 1.5; });
    }, () => { pillar.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); pillar.mats.forEach((m) => m.dispose()); });
    fx.flash(c.clone().setY(c.y + 1.2), s.a.clone().multiplyScalar(0.5), R * 1.2, 0.35);
    fx.shock(c.clone().setY(c.y + 0.05), R * 1.2, s.a, 0.5, 0.2);
    fx.shock(c.clone().setY(c.y + 0.05), R * 0.7, s.b, 0.4, 0.12);
    fx.burst(c.clone().setY(c.y + 0.3), [s.a, s.b], 40 + Math.round(k * 20), { speed: 3, up: 7, size: 0.07, life: 1, glow: true, gravity: 3 });
    kit.h.aoe(c, R, Math.round(power), 1.2, false);
    // герой в столпе — лечится; позже здесь же поднимается павший союзник (кооп)
    if (!hero.down && Math.hypot(hero.pos.x - c.x, hero.pos.z - c.z) <= R) {
      const before = hero.hp;
      hero.hp = Math.min(hero.maxHp, hero.hp + power * 0.5);
      if (hero.hp > before) fx.text(hero.pos.clone().setY(hero.pos.y + 0.8), `+${Math.round(hero.hp - before)}`, 'healbig');
    }
    fx.decal(c, kit.tex.glow(), s.a.clone().multiplyScalar(0.16), R * 2, 2.5, true);
    // послевкусие: перья-искры медленно поднимаются из круга
    let left = 2;
    kit.proc((dt) => {
      left -= dt;
      if (Math.random() < 0.7 * Math.min(1, left)) {
        const an = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
        fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(an) * r, 0.1, Math.sin(an) * r)), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1, 2.2), rand(-0.2, 0.2)), life: 1.2, size: rand(0.05, 0.08), color: Math.random() < 0.5 ? s.a : s.b, gravity: -0.2, drag: 0.5 });
      }
      return left > 0;
    });
  });
}

/** Молния и свет: копьё громовержца, громовой прыжок, грозовая туча, звездопад, луч павшей звезды, небесный суд */
export const STORM_LIGHT: Partial<Record<BossSpellKind, BossSpell>> = {
  thunderspear: { school: 'spark', tier: 'rare', title: 'Копьё громовержца', cast: thunderspear },
  thunderleap: { school: 'spark', tier: 'legendary', title: 'Громовой прыжок', cast: thunderleap },
  stormcloud: { school: 'spark', tier: 'common', title: 'Грозовая туча', cast: stormcloud },
  starfall: { school: 'star', tier: 'legendary', title: 'Звездопад', cast: starfall },
  starbeam: { school: 'star', tier: 'mythic', title: 'Луч павшей звезды', cast: starbeam },
  judgement: { school: 'star', tier: 'legendary', title: 'Небесный суд', cast: judgement },
};
