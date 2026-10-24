import * as THREE from 'three';
import type { BossSpellKind } from '../items';
import { bell, boom, deg, hiss, pluck, voice } from '../spell-audio';
import type { Spells } from '../spells';
import type { Target } from '../target';
import { C, rand, type BossSpell } from './kit';

/** Земля и природа: разлом, малиновый куст, облик титана (wiki/design-spells.md, раздел 3) */

// ---------- общие формы и материалы (не освобождаются: их мало и они переиспользуются) ----------
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const STONE = ['#8a7a68', '#9a8a74', '#7a6a58', '#a89880'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const LEAF = ['#3f8a32', '#4fa83a', '#2f6a2a', '#5aba44'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const BERRY = new THREE.MeshLambertMaterial({ color: '#e0285a', emissive: '#5a0a1a' });
const BERRY_HI = new THREE.MeshBasicMaterial({ color: C(3.2, 1.2, 1.8), toneMapped: false });
const THORN = new THREE.MeshLambertMaterial({ color: '#d8e8a8' });
const AMBER = C(3.6, 2.2, 0.7), MOSS = C(1.4, 3.2, 0.8), PINK = C(3.8, 1, 1.8);
const DUST = ['#c8b898', '#b8a888', '#d8ccb0'];
const noDispose = (): void => { /* общие формы и материалы */ };

const box = (mat: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = new THREE.Mesh(UNIT, mat);
  m.scale.set(w, h, d); m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

// ---------- звуки: низ через насыщение, камень, листва, ягоды по пентатонике ----------
const sound = {
  rumble(dur = 0.6, vol = 0.2) {
    hiss({ dur, vol, f: 220, f1: 60, q: 0.5, type: 'lowpass', attack: dur * 0.4, verb: 0.3 });
    boom(70, 34, dur, vol * 1.4, 0, 0.3);
  },
  crack() {
    hiss({ dur: 0.07, vol: 0.22, f: 1400, q: 1.2, verb: 0.2 });
    boom(95, 40, 0.22, 0.22, 0, 0.2);
  },
  spike(i: number) {
    boom(120 - i * 3, 45, 0.25, 0.28, 0, 0.25);
    hiss({ dur: 0.12, vol: 0.12, f: 900 + i * 60, q: 0.9, verb: 0.2 });
    if (i % 2 === 0) pluck(deg(98 * 2, i), 0.05);
  },
  grow() {
    hiss({ dur: 0.4, vol: 0.1, f: 2500, f1: 6000, q: 0.6, type: 'highpass', attack: 0.2, verb: 0.3 });
    [0, 2, 4].forEach((d, i) => pluck(deg(392, d), 0.07, i * 0.06));
    boom(140, 60, 0.3, 0.25);
  },
  prick(i: number) {
    pluck(deg(523.25, (i * 2) % 7), 0.05);
    hiss({ dur: 0.06, vol: 0.06, f: 4000, type: 'highpass', verb: 0.15 });
  },
  pop() {
    boom(150, 55, 0.35, 0.35);
    hiss({ dur: 0.1, vol: 0.2, f: 700, q: 1.5, verb: 0.2 });
    [0, 2, 4, 5, 7, 9].forEach((d, i) => { pluck(deg(523.25, d), 0.07, 0.03 + i * 0.045); voice({ type: 'sine', f: 240 + i * 40, f1: 600 + i * 80, dur: 0.09, vol: 0.06, delay: i * 0.05, verb: 0.2 }); });
    [0, 4, 7].forEach((s, i) => bell(deg(1046.5, s), 1, 0.04, 0.3 + i * 0.05, 0.6));
  },
  titanRise() {
    hiss({ dur: 1.0, vol: 0.18, f: 300, f1: 1800, q: 0.6, attack: 0.7, verb: 0.4 });
    for (let i = 0; i < 5; i++) boom(80 + i * 10, 40, 0.3, 0.12 + i * 0.03, i * 0.12, 0.2);
  },
  titanSlam() {
    boom(90, 26, 1.6, 0.8, 0, 0.5);
    hiss({ dur: 0.9, vol: 0.3, f: 1600, f1: 140, q: 0.5, type: 'lowpass', verb: 0.5 });
    [0, 7, 12, 16].forEach((s, i) => voice({ type: 'triangle', f: 98 * Math.pow(2, s / 12), dur: 1.8, vol: 0.06, detune: 10, lp: 2000, lp1: 400, delay: i * 0.04, verb: 0.6 }));
    for (let i = 0; i < 10; i++) hiss({ dur: 0.05, vol: 0.08, f: rand(1200, 3000), q: 2, delay: 0.2 + Math.random() * 1.2, verb: 0.2 });
  },
  step() { boom(75, 35, 0.3, 0.3, 0, 0.15); hiss({ dur: 0.1, vol: 0.06, f: 400, q: 0.8, verb: 0.1 }); },
  crumble() {
    for (let i = 0; i < 12; i++) hiss({ dur: 0.06, vol: 0.09, f: rand(700, 2400), q: 1.5, delay: i * 0.05 + Math.random() * 0.05, verb: 0.2 });
    boom(110, 45, 0.5, 0.3);
    [12, 7, 0].forEach((s, i) => bell(98 * 2 * Math.pow(2, s / 12), 0.9, 0.04, i * 0.08, 0.6));
  },
};

/** Камни и пыль из точки: обломки (непрозрачные кубики) и светлая пыль, без тёмного дыма */
function debris(kit: Spells, at: THREE.Vector3, n: number, speed: number, up = 4): void {
  const fx = kit.h.fx;
  fx.burst(at, ['#8a7a68', '#a89880', '#6a5a48'], n, { speed, up, size: 0.14, life: 0.9, gravity: 14 });
  fx.burst(at, DUST, Math.round(n * 0.7), { speed: speed * 0.5, up: 1.2, size: 0.22, life: 1, gravity: -0.6, drag: 2.5 });
}

// ---------- 17. Разлом ----------

const rift: BossSpell = {
  school: 'earth', tier: 'rare', title: 'Разлом',
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('earth');
    const from = hero.pos.clone();
    const end = kit.ground(at, a.radius ?? 10);
    const dir = new THREE.Vector3(end.x - from.x, 0, end.z - from.z);
    const L = Math.max(3, dir.length());
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    kit.face(end);
    // замах: герой бьёт ладонью в землю — пыль у ног, гул, земля дрожит
    kit.windup('earth', k);
    sound.rumble(0.5, 0.15);
    debris(kit, from.clone().setY(from.y + 0.1), 8, 2, 2);
    fx.shake = Math.max(fx.shake, 0.2);
    kit.later(0.22, () => {
      kit.impact('earth', from, k, 12, 0.45);
      kit.pomp('rare', from, 'earth');
      sound.crack();
      fx.shock(from.clone().setY(from.y + 0.06), 2, s.a, 0.3, 0.15);
      const hit = new Set<Target>();
      const step = 0.55, speed = 16 + k * 6, width = 1.1 + k * 0.5;
      let front = 0, placed = 0;
      kit.proc((dt) => {
        front = Math.min(L, front + speed * dt);
        while (placed * step <= front) {
          const d = placed * step;
          const p = from.clone().addScaledVector(dir, d).addScaledVector(side, rand(-0.25, 0.25));
          const y = kit.h.terrain.floorAt(p.x, p.z, from.y + 2);
          p.y = Number.isFinite(y) ? y : from.y;
          // трещина: тёмно-коричневое пятно и янтарный отсвет из глубины
          fx.decal(p, kit.tex.scorch(), '#ffffff', 1.1 + Math.random() * 0.4, 3.5, false, 0.8);
          fx.decal(p, kit.tex.glow(), AMBER.clone().multiplyScalar(0.25), 0.9, 1.2, true);
          // каменные шипы: 1–2 бруска вырастают и наклоняются от оси
          for (let j = 0; j < (placed % 2 ? 1 : 2); j++) spike(kit, p.clone().addScaledVector(side, rand(-0.5, 0.5)), (0.8 + k * 0.7) * rand(0.7, 1.2), side.clone().multiplyScalar(rand(-0.4, 0.4)));
          debris(kit, p.clone().setY(p.y + 0.2), 4, 2.5, 4);
          if (placed % 2 === 0) sound.spike(placed);
          if (Math.random() < 0.5) fx.particle({ pos: p.clone().setY(p.y + 0.1), vel: new THREE.Vector3(0, rand(1.5, 3), 0), life: 0.5, size: 0.06, color: AMBER, gravity: 2 });
          placed++;
        }
        // удар по всем, кого догнал фронт трещины, — вверх и в стороны
        const tip = from.clone().addScaledVector(dir, front);
        for (const t of kit.h.targets()) {
          if (!t.alive || hit.has(t)) continue;
          if (segDist(from.x, from.z, tip.x, tip.z, t.pos.x, t.pos.z) > width + t.radius) continue;
          hit.add(t);
          kit.h.damage(t, Math.round(power), from, 2.2 + k);
          fx.burst(t.pos.clone().setY(t.pos.y + 0.6), [s.a, s.b], 12, { speed: 3, up: 5, size: 0.07, life: 0.5, glow: true, gravity: 10 });
          fx.flash(t.pos.clone().setY(t.pos.y + 0.8), s.a.clone().multiplyScalar(0.6), 2, 0.2);
        }
        fx.shake = Math.max(fx.shake, 0.25);
        if (front < L) return true;
        // конец разлома: камни разлетаются, последний большой шип
        const last = from.clone().addScaledVector(dir, L);
        last.y = end.y;
        spike(kit, last, 1.6 + k, new THREE.Vector3());
        debris(kit, last.clone().setY(last.y + 0.3), 16, 4, 5);
        fx.shock(last.clone().setY(last.y + 0.06), 2.2, s.a, 0.35, 0.15);
        sound.crack(); sound.rumble(1.2, 0.12);
        return false;
      });
    });
  },
};

/** Каменный шип: вырастает из земли за 0,12 с, держится, медленно уходит обратно */
function spike(kit: Spells, p: THREE.Vector3, h: number, tilt: THREE.Vector3): void {
  const g = new THREE.Group();
  const mat = STONE[(Math.random() * STONE.length) | 0];
  const w = 0.32 + Math.random() * 0.15;
  g.add(box(mat, w, h, w, 0, h / 2, 0), box(STONE[(Math.random() * STONE.length) | 0], w * 0.6, h * 0.35, w * 0.6, 0, h + h * 0.15, 0));
  g.position.copy(p);
  g.rotation.set(tilt.z * 0.8 + rand(-0.15, 0.15), Math.random() * Math.PI, -tilt.x * 0.8 + rand(-0.15, 0.15));
  const life = 1.6 + Math.random() * 0.4;
  kit.h.fx.custom(g, life, (t) => {
    const tt = t * life;
    const up = tt < 0.12 ? 1 - (1 - tt / 0.12) ** 3 : 1;
    const down = tt > life - 0.5 ? (life - tt) / 0.5 : 1;
    g.scale.set(1, Math.max(0.01, up * down), 1);
    g.position.y = p.y - (1 - down) * 0.2;
  }, noDispose);
}

function segDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

// ---------- 18. Малиновый куст ----------

/** Воксельный куст: холм листвы, колючки и ягоды; ягоды отдельно — им лопаться */
function makeBush(R: number): { g: THREE.Group; berries: THREE.Object3D[] } {
  const g = new THREE.Group(), berries: THREE.Object3D[] = [];
  const S = 0.6 + R * 0.12;
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * S * 0.9;
    const y = (1 - r / S) * S * 0.9 + rand(0, 0.25);
    const sz = rand(0.38, 0.62) * S;
    const m = box(LEAF[(Math.random() * LEAF.length) | 0], sz, sz, sz, Math.cos(a) * r, y, Math.sin(a) * r);
    m.rotation.set(rand(-0.3, 0.3), Math.random() * Math.PI, rand(-0.3, 0.3));
    g.add(m);
  }
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2, e = rand(0.1, 1.2), r = S * 0.85;
    const th = box(THORN, 0.05, 0.05, 0.3, Math.cos(a) * Math.cos(e) * r, S * 0.5 + Math.sin(e) * r * 0.8, Math.sin(a) * Math.cos(e) * r);
    th.lookAt(th.position.clone().multiplyScalar(2));
    g.add(th);
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, e = rand(0.2, 1.1), r = S * 0.92;
    const b = new THREE.Group();
    b.add(box(BERRY, 0.17, 0.17, 0.17), box(BERRY_HI, 0.06, 0.06, 0.06, -0.05, 0.06, 0.07));
    b.position.set(Math.cos(a) * Math.cos(e) * r, S * 0.45 + Math.sin(e) * r * 0.85, Math.sin(a) * Math.cos(e) * r);
    b.rotation.set(rand(0, 1), rand(0, 1), 0);
    g.add(b); berries.push(b);
  }
  return { g, berries };
}

const raspberrybush: BossSpell = {
  school: 'earth', tier: 'common', title: 'Малиновый куст',
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, hero = kit.h.hero;
    const c = kit.ground(at, 12), R = (a.radius ?? 3) + k * 1.2, dur = a.duration ?? 4;
    kit.face(c);
    // замах: из земли у цели бьют зелёные искры и лепестки, круг природы раскрывается
    kit.windup('earth', k);
    kit.groundSigil('earth', c, R, 0.35, dur, 0.22);
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2, r = Math.random() * R;
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0.1, Math.sin(ang) * r)), vel: new THREE.Vector3(0, rand(1, 2.5), 0), life: 0.4, size: 0.07, color: i % 3 ? MOSS : PINK, gravity: 2 });
    }
    kit.later(0.3, () => {
      const { g, berries } = makeBush(R);
      g.position.copy(c);
      kit.h.scene.add(g);
      kit.impact('earth', c, k, 12, 0.3);
      kit.pomp('common', c, 'earth');
      sound.grow();
      fx.shock(c.clone().setY(c.y + 0.06), R, MOSS, 0.4, 0.15);
      fx.burst(c.clone().setY(c.y + 0.3), ['#4fa83a', '#3f8a32', '#6aca4a'], 14, { speed: 3, up: 4, size: 0.1, life: 0.7, gravity: 10 });
      fx.decal(c, kit.tex.glow(), MOSS.clone().multiplyScalar(0.18), R * 2, dur + 1.5, true);
      let t = 0, tick = 0.15, n = 0, popped = false;
      const tickDmg = Math.max(1, Math.round(power * 0.35));
      kit.proc((dt) => {
        t += dt;
        // вырастает с перелётом, потом «дышит»; на каждом уколе вздрагивает
        const grow = t < 0.35 ? 1 + Math.sin((t / 0.35) * Math.PI * 1.5) * 0.25 * (1 - t / 0.35) : 1;
        const e = Math.min(1, t / 0.2);
        const br = Math.sin(t * 5) * 0.03, bump = Math.max(0, tick - 0.35) * 0.5;
        g.scale.set(e * grow * (1 + br + bump), e * grow * (1 - br + bump), e * grow * (1 + br + bump));
        for (const b of berries) b.rotation.y += dt * 2;
        if (popped) return false;
        tick -= dt;
        if (tick <= 0 && t < dur) {
          tick = 0.5;
          // колючие лозы хватают всех в круге и колют
          for (const tg of kit.within(c, R)) {
            kit.bolt(c.clone().setY(c.y + 0.5), tg.pos.clone().setY(tg.pos.y + rand(0.3, 0.9)), MOSS.clone().multiplyScalar(0.7), 0.035, 1, 0.35);
            fx.burst(tg.pos.clone().setY(tg.pos.y + 0.7), [MOSS, PINK], 5, { speed: 2, up: 2, size: 0.05, life: 0.3, glow: true, gravity: 8 });
          }
          if (kit.h.aoe(c, R, tickDmg, 0, false) > 0) sound.prick(n);
          n++;
        }
        if (t < dur) return true;
        // конец: куст лопается ягодами
        popped = true;
        kit.h.scene.remove(g);
        sound.pop();
        kit.impact('earth', c, k, 10, 0.35);
        fx.flash(c.clone().setY(c.y + 0.8), PINK.clone().multiplyScalar(0.4), R * 0.8, 0.3);
        fx.shock(c.clone().setY(c.y + 0.06), R * 1.2, PINK, 0.4, 0.2);
        fx.burst(c.clone().setY(c.y + 0.7), ['#e0285a', '#ff5a8a', '#b01a40'], 30, { speed: 5, up: 6, size: 0.12, life: 1, gravity: 12 });
        fx.burst(c.clone().setY(c.y + 0.7), [PINK, C(4, 2, 2.4)], 24, { speed: 4, up: 4, size: 0.07, life: 0.7, glow: true, gravity: 6 });
        fx.burst(c.clone().setY(c.y + 0.5), ['#4fa83a', '#3f8a32'], 18, { speed: 3, up: 4, size: 0.1, life: 1.3, gravity: 3, drag: 1.5 });
        fx.decal(c, kit.tex.glow(), PINK.clone().multiplyScalar(0.25), R * 1.6, 1.5, true);
        kit.h.aoe(c, R, Math.round(power), 1.2, false);
        // ягоды лечат героя, если он рядом: летят к нему дугой
        const near = Math.hypot(hero.pos.x - c.x, hero.pos.z - c.z) <= R + 3;
        if (near && !hero.down) {
          const heal = Math.round(power * 1.5);
          const before = hero.hp;
          const to = hero.pos.clone().setY(hero.pos.y + 1);
          for (let i = 0; i < 12; i++) {
            const from = c.clone().setY(c.y + rand(0.5, 1.1)), life = rand(0.4, 0.6), gr = -8;
            const v = to.clone().sub(from).divideScalar(life); v.y -= (gr * life) / 2;
            fx.particle({ pos: from, vel: v, life, size: rand(0.08, 0.12), color: i % 2 ? PINK : C(4, 1.6, 2), gravity: gr, shrink: false });
          }
          kit.later(0.5, () => {
            hero.hp = Math.min(hero.maxHp, hero.hp + heal);
            fx.text(hero.pos.clone().setY(hero.pos.y + 0.8), `+${Math.round(hero.hp - before)}`, 'healbig');
            fx.burst(hero.pos.clone().setY(hero.pos.y + 1), [PINK, MOSS], 14, { speed: 1.5, up: 3, size: 0.07, life: 0.8, glow: true, gravity: 1 });
            bell(deg(1046.5, 4), 0.9, 0.05, 0, 0.6);
          });
        }
        return false;
      });
    });
  },
};

// ---------- 19. Облик титана ----------

const titanform: BossSpell = {
  school: 'earth', tier: 'mythic', title: 'Облик титана',
  cast(kit, a, power, _at, k) {
    const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('earth');
    const dur = a.duration ?? 10;
    // замах: мир темнеет, к герою со всех сторон стягиваются камни, гул растёт
    kit.windup('earth', k);
    kit.pomp('mythic', hero.pos, 'earth', 'Облик титана', 0.9);
    sound.titanRise();
    let rise = 0.6;
    kit.proc((dt) => {
      rise -= dt;
      for (let i = 0; i < 4; i++) {
        const ang = Math.random() * Math.PI * 2, r = rand(1.5, 3);
        const from = hero.pos.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0.1, Math.sin(ang) * r));
        const to = hero.pos.clone().setY(hero.pos.y + rand(0.5, 1.6)), life = 0.35;
        fx.particle({ pos: from, vel: to.sub(from).divideScalar(life), life, size: rand(0.1, 0.16), color: Math.random() < 0.5 ? '#8a7a68' : '#a89880', gravity: 0, shrink: false }, false);
      }
      if (Math.random() < 0.5) fx.particle({ pos: hero.pos.clone().setY(hero.pos.y + 0.1), vel: new THREE.Vector3(rand(-1, 1), rand(2, 4), rand(-1, 1)), life: 0.5, size: 0.06, color: AMBER, gravity: 3 });
      fx.shake = Math.max(fx.shake, 0.15);
      return rise > 0;
    });
    kit.later(0.6, () => {
      kit.buff({ id: 'titan', melee: 1 + power / 100, taken: 0.5, scale: 1.8, speed: 0.85 }, dur);
      const c = hero.pos.clone();
      kit.impact('earth', c, k, 20, 0.8);
      sound.titanSlam();
      fx.shock(c.clone().setY(c.y + 0.06), 6, s.a, 0.5, 0.25);
      fx.shock(c.clone().setY(c.y + 0.06), 4, s.b, 0.4, 0.15);
      debris(kit, c.clone().setY(c.y + 0.5), 30, 6, 7);
      fx.decal(c, kit.tex.scorch(), '#ffffff', 5, 4, false, 0.8);
      kit.h.aoe(c, 4, Math.round(power * 0.6), 3, true);
      // каменная кожа: пластины на теле героя растут вместе с ним, между ними светятся янтарные трещины
      const skin = new THREE.Group();
      const plates: THREE.Mesh[] = [];
      const spots: [number, number, number, number][] = [
        [0, 1.15, 0.3, 0.5], [0, 1.1, -0.3, 0.5], [0.46, 1.45, 0, 0.36], [-0.46, 1.45, 0, 0.36],
        [0.2, 0.45, 0.24, 0.26], [-0.2, 0.45, 0.24, 0.26], [0.42, 2.0, 0, 0.26], [-0.42, 2.0, 0, 0.26], [0.36, 0.95, 0.22, 0.2], [-0.36, 0.95, 0.22, 0.2],
      ];
      for (const [x, y, z, sz] of spots) {
        const m = box(STONE[(Math.random() * STONE.length) | 0], sz, sz * rand(0.6, 0.9), sz * 0.6, x, y, z);
        m.rotation.set(rand(-0.2, 0.2), rand(-0.3, 0.3), rand(-0.2, 0.2));
        skin.add(m); plates.push(m);
      }
      const glow = new THREE.Mesh(UNIT, new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(0.6), toneMapped: false }));
      glow.scale.set(0.08, 0.42, 0.08); glow.position.set(0.02, 1.15, 0.47);
      skin.add(glow);
      hero.object.add(skin);
      let t = 0, stepT = 0, ended = false;
      const lastPos = hero.pos.clone();
      kit.proc((dt) => {
        t += dt;
        if (ended) return false;
        // пульс трещин и редкие янтарные искры
        glow.scale.y = 0.5 + Math.sin(t * 6) * 0.08;
        if (Math.random() < 0.25) fx.particle({ pos: hero.pos.clone().setY(hero.pos.y + rand(0.8, 2.6)), vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0.6, 1.4), rand(-0.4, 0.4)), life: 0.6, size: 0.06, color: AMBER, gravity: -0.5 });
        // тяжёлые шаги: пыль и тряска, когда великан идёт
        const moved = Math.hypot(hero.pos.x - lastPos.x, hero.pos.z - lastPos.z);
        lastPos.copy(hero.pos);
        stepT -= moved;
        if (stepT <= 0 && moved > 0) {
          stepT = 1.6;
          fx.burst(hero.pos.clone().setY(hero.pos.y + 0.1), DUST, 10, { speed: 2, up: 1, size: 0.2, life: 0.8, gravity: -0.4, drag: 2.5 });
          fx.shock(hero.pos.clone().setY(hero.pos.y + 0.05), 1.6, s.a, 0.3, 0.1);
          fx.shake = Math.max(fx.shake, 0.22);
          sound.step();
        }
        if (t < dur) return true;
        // конец: оболочка осыпается камнями
        ended = true;
        crumble(kit, skin, plates);
        (glow.material as THREE.Material).dispose();
        return false;
      });
    });
  },
};

/** Каменная кожа слезает с героя: пластины падают в мире и тают */
function crumble(kit: Spells, skin: THREE.Group, plates: THREE.Mesh[]): void {
  const fx = kit.h.fx;
  skin.updateMatrixWorld(true);
  for (const p of plates) {
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    p.matrixWorld.decompose(pos, q, sc);
    const m = new THREE.Mesh(UNIT, p.material);
    m.position.copy(pos); m.quaternion.copy(q); m.scale.copy(sc);
    const v = new THREE.Vector3(rand(-2, 2), rand(1, 3), rand(-2, 2)), spin = new THREE.Vector3(rand(-5, 5), rand(-5, 5), rand(-5, 5));
    const floor = kit.h.hero.pos.y;
    fx.custom(m, 1.2, (t) => {
      const dt = 1 / 60;
      v.y -= 14 * dt;
      m.position.addScaledVector(v, dt);
      if (m.position.y < floor + 0.05) { m.position.y = floor + 0.05; v.multiplyScalar(0.4); v.y = Math.abs(v.y) * 0.3; }
      m.rotation.x += spin.x * dt; m.rotation.y += spin.y * dt;
      if (t > 0.7) m.scale.multiplyScalar(0.94);
    }, noDispose);
  }
  skin.parent?.remove(skin);
  debris(kit, kit.h.hero.pos.clone().setY(kit.h.hero.pos.y + 1), 20, 3, 3);
  fx.flash(kit.h.hero.pos.clone().setY(kit.h.hero.pos.y + 1.2), AMBER.clone().multiplyScalar(0.5), 2.5, 0.3);
  sound.crumble();
}

export const EARTH: Partial<Record<BossSpellKind, BossSpell>> = { rift, raspberrybush, titanform };
