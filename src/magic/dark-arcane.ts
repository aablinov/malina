import * as THREE from 'three';
import { rnd } from '../rng.ts';
import type { ArtifactStats, BossSpellKind } from '../items.ts';
import { additiveSprite, glowTex } from '../loot-look.ts';
import { bell, boom, deg, hiss, pluck, semi, voice } from '../spell-audio.ts';
import type { Spells } from '../spells.ts';
import type { Target } from '../target.ts';
import { C, rand, type Spell } from './kit.ts';

/**
 * Тьма, души и аркана (wiki/design-spells.md, раздел 3): хор мёртвых, гравитационный колодец, коса-череп, павшие стражи,
 * фаланга клинков. Призрачные фигуры — воксели из общего куба с аддитивным материалом (без тёмных непрозрачных кубов:
 * затенение AO рисует вокруг них квадраты). Звуки — тут же, из нот пентатоники и минора тьмы.
 */

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const VOID_ROOT = 130.81;

/** Призрачный материал: светится и просвечивает */
const ghost = (c: THREE.Color, opacity = 0.85): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color: c, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

/** Брусок из общего куба: w × h × d в точке (x, y, z) */
const box = (m: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh => {
  const o = new THREE.Mesh(UNIT, m);
  o.scale.set(w, h, d);
  o.position.set(x, y, z);
  return o;
};

/** Убрать группу из сцены и освободить её материалы (форма общая) */
const drop = (g: THREE.Object3D, mats: THREE.Material[]): void => { g.parent?.remove(g); for (const m of mats) m.dispose(); };

// ---------- звуки ----------

/** Шёпот: короткие шумы на частотах гласных, тихо и в зале */
function whisper(dur = 1.2, vol = 0.05): void {
  const vowels = [700, 1100, 1800, 2600];
  for (let i = 0; i < 7; i++) hiss({ dur: rand(0.15, 0.35), vol: vol * rand(0.5, 1), f: vowels[(rnd() * 4) | 0], q: 7, attack: 0.06, delay: rand(0, dur), verb: 0.7 });
}
/** Минорный аккорд тьмы */
const voidChord = (vol: number, dur: number, delay = 0): void => [0, 3, 7, 12].forEach((s, i) => voice({ type: 'triangle', f: semi(VOID_ROOT, s), dur, vol, detune: 10, lp: 1800, lp1: 500, delay: delay + i * 0.03, verb: 0.6 }));

// ---------- 13. хор мёртвых ----------

/** Воксельная призрачная рука: предплечье, ладонь, четыре пальца (в шарнирах — чтобы сжимались) и большой палец */
function hand(mat: THREE.Material): { g: THREE.Group; fingers: THREE.Group[] } {
  const g = new THREE.Group();
  g.add(box(mat, 0.2, 1, 0.2, 0, 0.5, 0), box(mat, 0.34, 0.3, 0.14, 0, 1.12, 0));
  const fingers: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set(-0.12 + i * 0.08, 1.26, 0);
    f.add(box(mat, 0.06, 0.26, 0.08, 0, 0.13, 0));
    g.add(f); fingers.push(f);
  }
  const th = new THREE.Group();
  th.position.set(0.18, 1.05, 0); th.rotation.z = -0.7;
  th.add(box(mat, 0.06, 0.2, 0.08, 0, 0.1, 0));
  g.add(th); fingers.push(th);
  return { g, fingers };
}

function deadchoir(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('void');
  const c = kit.ground(at, 12), R = (a.radius ?? 4) + k, dur = a.duration ?? 3, tele = 0.4;
  kit.face(c);
  kit.windup('void', k);
  kit.groundSigil('void', c, R, tele, dur, 0.3);
  whisper(0.8, 0.05);
  voice({ type: 'sine', f: VOID_ROOT / 2, dur: dur + 0.6, vol: 0.06, attack: 0.4, verb: 0.5 });
  // замах: из земли сочится зеленоватая дымка душ
  let t0 = 0;
  kit.proc((dt) => {
    t0 += dt;
    for (let i = 0; i < 3; i++) {
      const an = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(an) * r, 0.1, Math.sin(an) * r)), vel: new THREE.Vector3(0, rand(0.4, 1.2), 0), life: 0.6, size: 0.07, color: s.b, gravity: -0.3 });
    }
    return t0 < tele;
  });
  kit.later(tele, () => {
    kit.impact('void', c, k, 12, 0.4);
    kit.pomp('rare', c, 'void');
    boom(90, 30, 0.9, 0.55, 0, 0.5);
    voidChord(0.05, 1.6);
    whisper(dur, 0.06);
    fx.shock(c, R * 1.1, s.a, 0.45, 0.2);
    fx.flash(c.clone().setY(c.y + 0.6), s.b.clone().multiplyScalar(0.5), R * 1.2, 0.3);
    // руки: по одной под каждой целью в круге, остальные — где придётся
    const spots: { p: THREE.Vector3; t: Target | null }[] = kit.within(c, R).map((t) => ({ p: t.pos.clone().setY(c.y), t }));
    const n = Math.max(spots.length, 7 + Math.round(k * 5));
    while (spots.length < n) {
      const an = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R * 0.9;
      spots.push({ p: c.clone().add(new THREE.Vector3(Math.cos(an) * r, 0, Math.sin(an) * r)), t: null });
    }
    spots.forEach(({ p, t }, i) => {
      const mat = ghost((i % 2 ? s.b : s.a).clone().multiplyScalar(0.3), 0.8);
      const { g, fingers } = hand(mat);
      const life = dur + 0.3, ph = rnd() * 6, delay = Math.min(0.3, i * 0.04);
      g.rotation.y = rnd() * Math.PI * 2;
      g.scale.setScalar(t ? 1.8 : rand(1.2, 1.6));
      g.position.copy(p).setY(p.y - 1.4);
      g.visible = false;
      fx.custom(g, life + delay, (kk) => {
        const tt = kk * (life + delay) - delay;
        if (tt < 0) return;
        g.visible = true;
        const rise = Math.min(1, tt / 0.25), sink = Math.max(0, (tt - (life - 0.5)) / 0.5);
        const pos = t?.alive ? t.pos : p;
        g.position.set(pos.x, p.y - 2.2 * (1 - rise) ** 3 - sink * 2.6 - 0.2, pos.z);
        g.rotation.z = Math.sin(kit.time * 3 + ph) * 0.12;
        const curl = Math.min(1, Math.max(0, (tt - 0.2) / 0.4)) * 1.3;
        fingers.forEach((f, j) => { f.rotation.x = j < 4 ? curl : 0; });
        mat.opacity = 0.8 * (1 - sink) * (0.85 + Math.sin(kit.time * 20 + ph) * 0.15);
        // держит цель: души сочатся вниз
        if (t && rnd() < 0.3) fx.particle({ pos: t.pos.clone().setY(p.y + rand(0.3, 1.4)), vel: new THREE.Vector3(0, -rand(1, 2), 0), life: 0.5, size: 0.06, color: s.b, gravity: 0 });
      }, () => mat.dispose());
    });
    // урон волнами, каждая — глухой удар и шёпот
    const ticks = Math.max(1, Math.round(dur / 0.5));
    for (let i = 0; i < ticks; i++) kit.later(0.15 + i * 0.5, () => {
      kit.h.aoe(c, R, Math.round(power), 0.15, false);
      boom(70, 35, 0.3, 0.16, 0, 0.3);
      if (i % 2 === 0) pluck(deg(VOID_ROOT * 2, i % 5), 0.04);
    });
    // послевкусие: тёмный след и души, поднимающиеся после ухода рук
    fx.decal(c, kit.tex.scorch(), '#ffffff', R * 2.1, dur + 2.5, false, 0.6);
    fx.decal(c, kit.tex.glow(), s.a.clone().multiplyScalar(0.25), R * 2, dur + 1, true);
    kit.later(dur, () => {
      let left = 1.6;
      kit.proc((dt) => {
        left -= dt;
        if (rnd() < 0.6) {
          const an = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
          fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(an) * r, 0.2, Math.sin(an) * r)), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3)), life: 0.9, size: rand(0.06, 0.1), color: rnd() < 0.5 ? s.a : s.b, gravity: -0.5 });
        }
        return left > 0;
      });
    });
  });
}

// ---------- 14. гравитационный колодец ----------

function gravitywell(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('void');
  const c = kit.ground(at, 12), R = (a.radius ?? 6) + k, dur = a.duration ?? 2, tele = 0.3;
  const mid = c.clone().setY(c.y + 1.4);
  kit.face(c);
  kit.windup('void', k);
  kit.groundSigil('void', c, R * 0.6, tele, dur + 0.2, 0.3);
  // гул втягивания: низкий тон ползёт вниз, шипение нарастает
  voice({ type: 'triangle', f: 220, f1: 55, dur: tele + dur, vol: 0.07, detune: 15, lp: 1200, lp1: 200, attack: 0.3, verb: 0.5 });
  hiss({ dur: tele + dur, vol: 0.14, f: 4000, f1: 300, q: 0.7, attack: tele + dur - 0.1, verb: 0.4 });
  // сфера: тёмно-фиолетовое ядро (не чёрное), светящаяся оболочка, диск и ореол
  const g = new THREE.Group();
  const coreM = new THREE.MeshBasicMaterial({ color: C(0.22, 0.06, 0.36) });
  const shellM = ghost(s.a.clone().multiplyScalar(0.35), 0.6);
  const diskM = new THREE.MeshBasicMaterial({ color: s.b.clone().multiplyScalar(0.35), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const haloM = additiveSprite(glowTex(), s.a.clone().multiplyScalar(0.3));
  const core = box(coreM, 1, 1, 1), shell = box(shellM, 1.5, 1.5, 1.5);
  const diskGeo = new THREE.RingGeometry(0.9, 1.7, 48);
  const disk = new THREE.Mesh(diskGeo, diskM);
  const tilt = new THREE.Group(); tilt.rotation.x = -Math.PI / 2 + 0.35; tilt.add(disk);
  const halo = new THREE.Sprite(haloM); halo.scale.setScalar(4);
  g.add(core, shell, tilt, halo);
  g.position.copy(mid);
  g.scale.setScalar(0.01);
  kit.h.scene.add(g);
  const mats = [coreM, shellM, diskM, haloM];
  let t = 0, pullT = 0, done = false;
  kit.proc((dt) => {
    if (done) return false;
    t += dt;
    const e = Math.min(1, t / (tele + dur));
    g.scale.setScalar(0.3 + e * 0.7 * (1 + k * 0.3));
    core.rotation.x += dt * 2; core.rotation.y += dt * 3;
    shell.rotation.y -= dt * 4; shell.rotation.z += dt * 2.5;
    disk.rotation.z += dt * (3 + e * 6);
    halo.scale.setScalar((3.5 + Math.sin(kit.time * 12) * 0.3) * (0.6 + e * 0.6));
    // втягивание: частицы со всего круга летят в ядро
    for (let i = 0; i < 4 + k * 3; i++) {
      const an = rnd() * Math.PI * 2, r = rand(R * 0.5, R);
      const from = c.clone().add(new THREE.Vector3(Math.cos(an) * r, rand(0.1, 2.6), Math.sin(an) * r));
      const life = from.distanceTo(mid) / (6 + k * 4);
      fx.particle({ pos: from, vel: mid.clone().sub(from).divideScalar(life), life, size: rand(0.05, 0.09), color: rnd() < 0.5 ? s.a : s.b, gravity: 0, shrink: false });
    }
    // и враги: каждые 0,35 с подтягивает к центру (без урона)
    if (t > tele) {
      pullT -= dt;
      if (pullT <= 0) {
        pullT = 0.35;
        for (const tg of kit.within(c, R)) {
          const dir = new THREE.Vector3(c.x - tg.pos.x, 0, c.z - tg.pos.z);
          if (dir.lengthSq() > 0.25) tg.hit(0, dir.normalize(), tg.pos.clone().setY(1), 0.5);
        }
      }
    }
    if (t < tele + dur) return true;
    // схлопывание и выброс
    done = true;
    let tc = 0;
    kit.proc((dt2) => {
      tc += dt2;
      g.scale.setScalar(Math.max(0.02, (1 - tc / 0.15)) * (1 + k * 0.3));
      if (tc < 0.15) return true;
      drop(g, mats); diskGeo.dispose();
      wellBlast(kit, c, R, power, k);
      return false;
    });
    return false;
  });
}

function wellBlast(kit: Spells, c: THREE.Vector3, R: number, power: number, k: number): void {
  const fx = kit.h.fx, s = kit.color('void'), mid = c.clone().setY(c.y + 1.4);
  kit.impact('void', c, k, 18, 0.7);
  kit.pomp('legendary', c, 'void', 'Гравитационный колодец');
  boom(110, 26, 1.3, 0.75, 0, 0.5);
  hiss({ dur: 0.9, vol: 0.32, f: 300, f1: 3000, q: 0.5, attack: 0.01, verb: 0.5 });
  [12, 7, 3, 0].forEach((st, i) => bell(semi(VOID_ROOT * 2, st), 1.4, 0.05, 0.05 + i * 0.05, 0.7));
  fx.flash(mid, s.b.clone().multiplyScalar(0.6), Math.min(7, R * 1.2), 0.35);
  fx.flash(mid, s.a.clone().multiplyScalar(0.5), R * 0.8, 0.5);
  fx.shock(c, R * 1.15, s.a, 0.45, 0.25);
  fx.shock(c, R * 0.75, s.b, 0.35, 0.15);
  // осколки тьмы разлетаются кольцом
  for (let i = 0; i < 50 + k * 30; i++) {
    const an = rnd() * Math.PI * 2, sp = rand(6, 12) + k * 4;
    fx.particle({ pos: mid.clone(), vel: new THREE.Vector3(Math.cos(an) * sp, rand(-1, 3), Math.sin(an) * sp), life: rand(0.3, 0.6), size: rand(0.06, 0.12), color: rnd() < 0.5 ? s.a : s.b, gravity: 4, drag: 2 });
  }
  kit.h.aoe(c, R, Math.round(power), 2.5 + k * 1.5, true);
  // послевкусие: выжженный круг и медленный вихрь остатков
  fx.decal(c, kit.tex.scorch(), '#ffffff', R * 1.6, 4, false, 0.7);
  fx.decal(c, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), R * 1.4, 1.8, true);
  let left = 1.4, an0 = 0;
  kit.proc((dt) => {
    left -= dt; an0 += dt * 4;
    for (let i = 0; i < 2; i++) {
      const an = an0 + i * Math.PI + rnd() * 0.4, r = rand(0.4, 1.6);
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(an) * r, 0.2, Math.sin(an) * r)), vel: new THREE.Vector3(-Math.sin(an) * 2, rand(1, 2), Math.cos(an) * 2), life: 0.6, size: 0.06, color: s.b, gravity: -0.5 });
    }
    return left > 0;
  });
}

// ---------- 15. коса-череп ----------

function skullscythe(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('void'), hero = kit.h.hero;
  kit.face(at);
  kit.windup('void', k);
  hiss({ dur: 0.4, vol: 0.18, f: 600, f1: 2400, q: 0.8, attack: 0.05, verb: 0.3 });
  voice({ type: 'triangle', f: semi(VOID_ROOT * 4, 7), f1: semi(VOID_ROOT * 2, 3), dur: 0.35, vol: 0.05, verb: 0.5 });
  // воксельный череп: костяной (светлый, светится), глазницы и нос — фиолетовые огоньки, вокруг — лезвие косы
  const size = 0.42 + k * 0.18;
  const bone = ghost(C(1.5, 1.7, 1.9), 0.95), eyes = ghost(s.a.clone().multiplyScalar(0.9), 1), blade = ghost(s.b.clone().multiplyScalar(0.6), 0.9);
  const skull = new THREE.Group();
  skull.add(box(bone, 1, 0.85, 1, 0, 0.1, 0), box(bone, 0.7, 0.25, 0.8, 0, -0.42, 0.05));
  skull.add(box(eyes, 0.24, 0.2, 0.05, -0.22, 0.12, 0.51), box(eyes, 0.24, 0.2, 0.05, 0.22, 0.12, 0.51), box(eyes, 0.1, 0.12, 0.05, 0, -0.1, 0.51));
  skull.scale.setScalar(size);
  const scythe = new THREE.Group();
  for (let i = 0; i < 6; i++) { const an = (i / 6) * 2.2; scythe.add(box(blade, 0.12, 0.05, 0.3, Math.cos(an) * 0.75, 0, Math.sin(an) * 0.75)).children[i].rotation.y = -an; }
  scythe.scale.setScalar(size * 1.5);
  const g = new THREE.Group(); g.add(skull, scythe);
  const start = kit.hand();
  g.position.copy(start);
  kit.h.scene.add(g);
  const mats = [bone, eyes, blade];
  const flat = new THREE.Vector3(at.x - hero.pos.x, 0, at.z - hero.pos.z);
  const dist = Math.max(2, Math.min(a.radius ?? 14, flat.length() + 1.5));
  const dir = flat.lengthSq() > 0.01 ? flat.normalize() : new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
  skull.lookAt(skull.position.clone().add(dir));
  let gone = 0, done = false;
  const finish = (p: THREE.Vector3, tg: Target | null): void => {
    done = true;
    drop(g, mats);
    kit.impact('void', p, k, 12, 0.35);
    kit.pomp('common', p, 'void');
    boom(120, 40, 0.5, 0.45);
    voidChord(0.045, 0.9);
    fx.flash(p.clone().setY(p.y + 1), s.a.clone().multiplyScalar(0.6), 2.2 + k, 0.3);
    fx.burst(p.clone().setY(p.y + 1), [s.a, s.b, C(1.5, 1.7, 1.9)], 24 + Math.round(k * 16), { speed: 4, up: 3, size: 0.07, life: 0.5, glow: true, gravity: 5 });
    fx.shock(p.clone().setY(p.y + 0.05), 1.8 + k, s.a, 0.3, 0.15);
    fx.decal(p.clone().setY(kit.ground(p, 99).y), kit.tex.glow(), s.a.clone().multiplyScalar(0.3), 1.8, 1.2, true);
    if (!tg) return;
    kit.h.damage(tg, Math.round(power), hero.pos, 1 + k);
    // жизнь возвращается к герою нитью душ
    const heal = Math.round(power * 0.25);
    const from = tg.pos.clone().setY(tg.pos.y + 1);
    for (let i = 0; i < 10; i++) {
      const life = rand(0.35, 0.55), to = hero.pos.clone().setY(hero.pos.y + 1), gr = -5;
      const v = to.sub(from).divideScalar(life); v.y -= (gr * life) / 2;
      fx.particle({ pos: from.clone(), vel: v, life, size: 0.07, color: s.b, gravity: gr, shrink: false });
    }
    kit.later(0.45, () => {
      if (hero.down) return;
      const b = hero.hp;
      hero.hp = Math.min(hero.maxHp, hero.hp + heal);
      if (hero.hp > b) fx.text(hero.pos.clone().setY(hero.pos.y + 0.6), `+${Math.round(hero.hp - b)}`, 'heal');
      bell(deg(VOID_ROOT * 4, 4), 0.6, 0.04);
    });
  };
  kit.proc((dt) => {
    if (done) return false;
    const prev = g.position.clone(), step = (14 + k * 4) * dt;
    g.position.addScaledVector(dir, step);
    gone += step;
    scythe.rotation.y += dt * 18;
    skull.position.y = Math.sin(kit.time * 20) * 0.04;
    if (rnd() < 0.8) fx.particle({ pos: g.position.clone().add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.15, 0.15), rand(-0.15, 0.15))), vel: dir.clone().multiplyScalar(-1.5).add(new THREE.Vector3(0, 0.6, 0)), life: 0.4, size: rand(0.05, 0.09), color: rnd() < 0.5 ? s.a : s.b, gravity: -1 });
    for (const t of kit.h.targets()) if (t.alive && Math.hypot(t.pos.x - g.position.x, t.pos.z - g.position.z) < t.radius + size) { finish(g.position.clone(), t); return false; }
    const wall = kit.h.terrain.wallHit(prev.x, prev.z, g.position.x, g.position.z, g.position.y - 0.4);
    if (wall) { finish(new THREE.Vector3(wall.x, g.position.y, wall.z), null); return false; }
    if (gone >= dist) { finish(g.position.clone(), null); return false; }
    return true;
  });
}

// ---------- 16. павшие стражи ----------

interface Guard { g: THREE.Group; sword: THREE.Group; mats: THREE.MeshBasicMaterial[]; t: number; cd: number; swing: number; hitDone: boolean; target: Target | null; i: number }

/** Призрачный рыцарь: ноги, тело, шлем с прорезью, щит и меч в шарнире у плеча */
function knight(body: THREE.MeshBasicMaterial, bright: THREE.MeshBasicMaterial): { g: THREE.Group; sword: THREE.Group } {
  const g = new THREE.Group();
  g.add(box(body, 0.18, 0.5, 0.2, -0.12, 0.25, 0), box(body, 0.18, 0.5, 0.2, 0.12, 0.25, 0));
  g.add(box(body, 0.52, 0.62, 0.32, 0, 0.82, 0), box(body, 0.4, 0.4, 0.4, 0, 1.33, 0), box(bright, 0.28, 0.06, 0.03, 0, 1.35, 0.21));
  g.add(box(body, 0.1, 0.18, 0.1, 0, 1.6, 0)); // гребень шлема
  g.add(box(body, 0.08, 0.5, 0.38, -0.36, 0.85, 0.05)); // щит
  const sword = new THREE.Group();
  sword.position.set(0.34, 1.0, 0);
  sword.add(box(body, 0.14, 0.4, 0.14, 0, -0.15, 0), box(bright, 0.06, 0.06, 0.95, 0, -0.3, 0.5), box(bright, 0.28, 0.05, 0.05, 0, -0.3, 0.04));
  g.add(sword);
  return { g, sword };
}

function fallenguards(kit: Spells, a: ArtifactStats, power: number, _at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('void'), hero = kit.h.hero;
  const dur = a.duration ?? 15, fwd = new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw)), right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  kit.windup('void', k);
  whisper(0.6, 0.04);
  const spots = [fwd.clone().multiplyScalar(0.8).addScaledVector(right, -1.4), fwd.clone().multiplyScalar(0.8).addScaledVector(right, 1.4), fwd.clone().multiplyScalar(-1.3)]
    .map((o) => kit.ground(hero.pos.clone().add(o), 99));
  // порталы: маленькие круги тьмы раскрываются, из них бьёт свет
  spots.forEach((p, i) => kit.later(i * 0.08, () => { kit.groundSigil('void', p, 0.95, 0.25, 0.9, 0.35); fx.flash(p.clone().setY(p.y + 0.4), s.b.clone().multiplyScalar(0.6), 1.6, 0.3); bell(deg(VOID_ROOT * 4, i * 2), 0.8, 0.05); }));
  kit.later(0.3, () => {
    kit.impact('void', hero.pos, k, 12, 0.3);
    kit.pomp('rare', hero.pos, 'void');
    boom(100, 35, 0.8, 0.5, 0, 0.4);
    voidChord(0.05, 1.4);
    const guards: Guard[] = spots.map((p, i) => {
      const body = ghost(s.b.clone().multiplyScalar(0.22), 0.85), bright = ghost(s.a.clone().multiplyScalar(0.45), 1);
      const { g, sword } = knight(body, bright);
      g.position.copy(p).setY(p.y - 1.7);
      g.rotation.y = hero.yaw;
      kit.h.scene.add(g);
      for (let j = 0; j < 12; j++) fx.particle({ pos: p.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0.1, rand(-0.4, 0.4))), vel: new THREE.Vector3(0, rand(2, 4), 0), life: 0.6, size: 0.07, color: s.b, gravity: -0.5 });
      return { g, sword, mats: [body, bright], t: 0, cd: 0.1 + i * 0.15, swing: 0, hitDone: true, target: null, i };
    });
    kit.proc((dt) => {
      let alive = 0;
      for (const gd of guards) {
        if (gd.t < 0) continue;
        gd.t += dt;
        const g = gd.g;
        // растворение в конце
        if (gd.t > dur) {
          const e = (gd.t - dur) / 0.6;
          g.scale.set(1, Math.max(0.01, 1 - e), 1);
          for (const m of gd.mats) m.opacity = Math.max(0, 1 - e) * 0.85;
          if (rnd() < 0.6) fx.particle({ pos: g.position.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.2, 1.4), rand(-0.3, 0.3))), vel: new THREE.Vector3(0, rand(1, 2.5), 0), life: 0.6, size: 0.07, color: s.b, gravity: -0.5 });
          if (e >= 1) { drop(g, gd.mats); gd.t = -1; continue; }
          alive++; continue;
        }
        alive++;
        const floor = kit.h.terrain.floorAt(g.position.x, g.position.z, g.position.y + 2);
        const fy = Number.isFinite(floor) ? floor : hero.pos.y;
        if (gd.t < 0.5) { g.position.y = fy - 1.7 * (1 - gd.t / 0.5) ** 2; continue; }
        g.position.y = fy + Math.sin(kit.time * 3 + gd.i) * 0.04;
        // цель: ближайшая живая в 12 м, иначе держаться у героя
        if (!gd.target?.alive) gd.target = kit.nearest(g.position, 12);
        const tg = gd.target;
        const goal = tg ? tg.pos : hero.pos.clone().add(new THREE.Vector3(Math.cos(gd.i * 2.1) * 1.6, 0, Math.sin(gd.i * 2.1) * 1.6));
        const d = new THREE.Vector3(goal.x - g.position.x, 0, goal.z - g.position.z);
        const reach = tg ? tg.radius + 0.85 : 0.3;
        const len = d.length();
        if (len > 0.05) g.rotation.y = Math.atan2(d.x, d.z);
        if (len > reach) {
          g.position.addScaledVector(d.normalize(), Math.min(len - reach, 4.2 * dt));
          // шаг: покачивание
          g.rotation.z = Math.sin(kit.time * 14 + gd.i) * 0.06;
        } else g.rotation.z = 0;
        gd.cd -= dt;
        if (tg && len <= reach + 0.3 && gd.cd <= 0 && gd.swing <= 0) { gd.swing = 0.32; gd.hitDone = false; gd.cd = 0.9; }
        if (gd.swing > 0) {
          gd.swing -= dt;
          const e = 1 - gd.swing / 0.32;
          gd.sword.rotation.x = -1.3 + e * 2.6;
          if (!gd.hitDone && e > 0.5) {
            gd.hitDone = true;
            if (tg?.alive) {
              kit.h.damage(tg, Math.round(power), g.position, 0.6);
              const hp = tg.pos.clone().setY(tg.pos.y + 1);
              fx.flash(hp, s.a.clone().multiplyScalar(0.5), 1.4, 0.18);
              fx.burst(hp, [s.a, s.b], 8, { speed: 3, up: 2, size: 0.06, life: 0.3, glow: true, gravity: 6 });
              fx.arc(g.position.clone(), g.rotation.y, s.b.clone().multiplyScalar(0.6), 1.3, 0.9, g.position.y + 0.9);
              voice({ type: 'triangle', f: deg(VOID_ROOT * 4, 2 + gd.i), dur: 0.3, vol: 0.05, verb: 0.4 });
              hiss({ dur: 0.08, vol: 0.12, f: 3000, q: 1.2, verb: 0.2 });
            }
          }
        } else gd.sword.rotation.x += (-0.4 - gd.sword.rotation.x) * Math.min(1, dt * 8);
        if (rnd() < 0.08) fx.particle({ pos: g.position.clone().add(new THREE.Vector3(rand(-0.25, 0.25), rand(0.2, 1.5), rand(-0.25, 0.25))), vel: new THREE.Vector3(0, rand(0.3, 0.8), 0), life: 0.6, size: 0.05, color: s.b, gravity: -0.2 });
      }
      return alive > 0;
    });
  });
}

// ---------- 20. фаланга клинков ----------

function bladephalanx(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('arcane'), hero = kit.h.hero;
  const N = 7, R = a.radius ?? 14, gap = 0.06, unfold = N * gap + 0.25;
  kit.face(at);
  kit.windup('arcane', k);
  // цели: живые у курсора, ближние первыми
  const aimP = kit.ground(at, R);
  const list = kit.h.targets().filter((t) => t.alive && Math.hypot(t.pos.x - hero.pos.x, t.pos.z - hero.pos.z) < R && Math.hypot(t.pos.x - aimP.x, t.pos.z - aimP.z) < 4.5)
    .sort((x, y) => x.pos.distanceToSquared(aimP) - y.pos.distanceToSquared(aimP)).slice(0, 4);
  let firstHit = true;
  for (let i = 0; i < N; i++) {
    const bladeM = ghost((i % 2 ? s.b : s.a).clone().multiplyScalar(0.45), 0.95), hiltM = ghost(C(3.6, 3, 1.4).multiplyScalar(0.5), 1);
    const g = new THREE.Group();
    g.add(box(bladeM, 0.08, 0.03, 0.9, 0, 0, 0.5), box(hiltM, 0.3, 0.05, 0.07, 0, 0, 0.04), box(hiltM, 0.05, 0.05, 0.22, 0, 0, -0.12));
    g.scale.setScalar(0.01);
    kit.h.scene.add(g);
    const mats = [bladeM, hiltM];
    const phi = -1 + (i / (N - 1)) * 2;
    const target = list.length ? list[i % list.length] : null;
    const spread = new THREE.Vector3(rand(-0.8, 0.8), 0, rand(-0.8, 0.8));
    const fireAt = unfold + i * 0.11;
    let t = 0, mode: 'hover' | 'fly' = 'hover', unfolded = false;
    const pos = new THREE.Vector3();
    kit.proc((dt) => {
      t += dt;
      if (mode === 'hover') {
        // веер над головой: позиция по дуге за спиной, остриём наружу
        const fwd = new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw)), right = new THREE.Vector3(fwd.z, 0, -fwd.x);
        pos.copy(hero.pos).addScaledVector(right, Math.sin(phi) * 1.4).addScaledVector(fwd, -0.4).setY(hero.pos.y + 2 + Math.cos(phi) * 0.7 + Math.sin(kit.time * 4 + i) * 0.05);
        g.position.copy(pos);
        const out = pos.clone().add(right.clone().multiplyScalar(Math.sin(phi)).setY(Math.cos(phi)));
        const e = Math.min(1, Math.max(0, (t - i * gap) / 0.18));
        if (e > 0 && !unfolded) {
          unfolded = true;
          bell(deg(523.25, i), 1.1, 0.045, 0, 0.6);
          fx.flash(pos, s.b.clone().multiplyScalar(0.5), 0.9, 0.18);
        }
        g.scale.setScalar(Math.max(0.01, e * (1 + k * 0.25)));
        // перед выстрелом разворачивается к цели
        const dest = target?.alive ? target.pos.clone().setY(target.pos.y + 1) : aimP.clone().add(spread).setY(aimP.y + 0.3);
        g.lookAt(t > fireAt - 0.12 ? dest : out);
        if (t >= fireAt) {
          mode = 'fly';
          hiss({ dur: 0.18, vol: 0.12, f: 5000, f1: 2000, q: 1.5, verb: 0.2 });
          voice({ type: 'triangle', f: deg(1046.5, i), dur: 0.15, vol: 0.03, verb: 0.3 });
        }
        return true;
      }
      const dest = target?.alive ? target.pos.clone().setY(target.pos.y + 1) : aimP.clone().add(spread).setY(aimP.y + 0.3);
      const d = dest.clone().sub(g.position), len = d.length(), step = 24 * dt;
      g.lookAt(dest);
      if (rnd() < 0.9) fx.particle({ pos: g.position.clone(), vel: d.clone().normalize().multiplyScalar(-1.5), life: 0.25, size: 0.05, color: i % 2 ? s.b : s.a, gravity: 0 });
      if (len > step) { g.position.addScaledVector(d.normalize(), step); return t < fireAt + 2; }
      // попал: урон, вспышка, нота — по очереди складывается аккорд
      drop(g, mats);
      const p = dest;
      if (firstHit) { firstHit = false; kit.impact('arcane', p, k, 12, 0.3); kit.pomp('rare', p, 'arcane'); boom(140, 50, 0.4, 0.35); }
      pluck(deg(523.25, i + 5), 0.08);
      hiss({ dur: 0.1, vol: 0.14, f: 4200, q: 1, verb: 0.3 });
      fx.flash(p, s.a.clone().multiplyScalar(0.6), 1.5 + k * 0.6, 0.22);
      fx.burst(p, [s.a, s.b, C(3.6, 3, 1.4)], 12, { speed: 4, up: 2.5, size: 0.06, life: 0.4, glow: true, gravity: 6 });
      const gp = kit.ground(p, 99);
      fx.decal(gp, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), 1.2, 1.2, true);
      if (target?.alive) kit.h.damage(target, Math.round(power), hero.pos, 0.5);
      else { fx.decal(gp, kit.tex.scorch(), '#ffffff', 0.9, 2.5, false, 0.5); kit.h.aoe(gp, 0.8, Math.round(power * 0.6), 0.4, false); }
      return false;
    });
  }
}

// ---------- Разрыв (с Кота-могильщика) ----------

/**
 * Рывок-телепорт к курсору (до radius м, не сквозь стены): там, где герой исчез, и там, где появился, — взрыв арканы;
 * между точками — след из гаснущих силуэтов-кубов. Заряд — дальше рывок и шире взрывы.
 */
function blink(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('arcane'), hero = kit.h.hero, terr = kit.h.terrain;
  const from = hero.pos.clone();
  const R = (a.radius ?? 8) * (1 + k * 0.3), r = 2.2 + k * 0.8;
  const dir = new THREE.Vector3(at.x - from.x, 0, at.z - from.z);
  const want = Math.min(R, dir.length());
  if (dir.lengthSq() < 0.01) dir.set(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
  dir.normalize();
  // шагаем по 0,4 м, пока нет стены и пол рядом по высоте
  let d = 0;
  for (let t = 0.4; t <= want; t += 0.4) {
    const x = from.x + dir.x * t, z = from.z + dir.z * t, y = terr.floorAt(x, z, from.y + 1);
    if (terr.blocked(from.x + dir.x * d, from.z + dir.z * d, x, z, from.y + 0.5) || !Number.isFinite(y) || Math.abs(y - from.y) > 1.1) break;
    d = t;
  }
  const to = from.clone().addScaledVector(dir, d);
  to.y = terr.floorAt(to.x, to.z, from.y + 1);
  if (!Number.isFinite(to.y)) to.y = from.y;
  const burst = (p: THREE.Vector3, first: boolean) => {
    const c = p.clone().setY(p.y + 0.8);
    fx.flash(c, s.a.clone().multiplyScalar(0.6), r * 1.3, 0.25);
    fx.shock(p.clone().setY(p.y + 0.06), r, s.a, 0.35, 0.2);
    fx.burst(c, [s.a, s.b, C(4, 3.4, 4)], 22, { speed: r * 2.4, up: 3, size: 0.08, life: 0.5, glow: true, gravity: 4 });
    if (first) { kit.impact('arcane', p, k, 10, 0.3); kit.pomp('rare', p, 'arcane'); }
    boom(first ? 160 : 120, 50, 0.4, 0.4);
    hiss({ dur: 0.25, vol: 0.2, f: 5000, f1: 1200, q: 0.8, verb: 0.4 });
    voice({ type: 'triangle', f: semi(349.23, first ? 0 : 7), f1: semi(349.23, first ? 12 : 19), dur: 0.3, vol: 0.04, verb: 0.5 });
    kit.h.aoe(p, r, Math.round(power), 1.4 + k, false);
  };
  burst(from, true);
  // след: гаснущие кубы-силуэты вдоль пути
  for (let t = 0.6; t < d; t += 0.8) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.4), ghost(s.b.clone().multiplyScalar(0.35), 0.7));
    m.position.copy(from).addScaledVector(dir, t).setY(from.y + 0.8);
    m.rotation.y = hero.yaw;
    fx.custom(m, 0.45, (kk) => { (m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - kk); m.scale.set(1 - kk * 0.5, 1 + kk * 0.4, 1 - kk * 0.5); });
  }
  hero.place(to.x, to.z, Math.atan2(dir.x, dir.z), to.y);
  kit.later(0.08, () => burst(to, false));
}

/** Тьма, души и аркана: хор мёртвых, гравитационный колодец, коса-череп, павшие стражи, фаланга клинков, разрыв */
export const DARK_ARCANE = {
  deadchoir: { school: 'void', tier: 'rare', title: 'Хор мёртвых', cast: deadchoir },
  gravitywell: { school: 'void', tier: 'legendary', title: 'Гравитационный колодец', cast: gravitywell },
  skullscythe: { school: 'void', tier: 'common', title: 'Коса-череп', cast: skullscythe },
  fallenguards: { school: 'void', tier: 'rare', title: 'Павшие стражи', cast: fallenguards },
  bladephalanx: { school: 'arcane', tier: 'rare', title: 'Фаланга клинков', cast: bladephalanx },
  blink: { school: 'arcane', tier: 'rare', title: 'Разрыв', cast: blink },
} satisfies Partial<Record<BossSpellKind, Spell>>;
