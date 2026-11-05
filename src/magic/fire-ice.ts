import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { duck } from '../audio.ts';
import type { BossSpellKind } from '../items.ts';
import { additiveSprite, glowTex } from '../loot-look.ts';
import { bell, boom, deg, hiss, pluck, semi, voice } from '../spell-audio.ts';
import type { Spells } from '../spells.ts';
import type { Target } from '../target.ts';
import { C, rand, type Spell } from './kit.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Fire and ice (wiki/design-spells.md, section 3): sky hammer, flame serpent, ash crown,
 * ice tomb, frost ridge, absolute zero. Each — windup, hit (impact + pomp), aftertaste.
 */

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const SPIKE = new THREE.ConeGeometry(0.28, 1.3, 4);
SPIKE.translate(0, 0.65, 0); // base on the ground

const FIRE_A = C(4, 1.5, 0.35), FIRE_B = C(4, 3, 1);
const ICE_A = C(1.4, 2.8, 4), ICE_B = C(2.8, 3.6, 4);

const glowMat = (c: THREE.Color, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
/** Translucent ice: normal blending so what is inside is visible */
const iceMat = (opacity = 0.55): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: C(0.42, 0.72, 0.98), toneMapped: false, transparent: true, opacity, depthWrite: false });

/** Ember flame in place: for n seconds flame tongues rise little by little */
function burnSpots(kit: Spells, spots: THREE.Vector3[], dur: number, rate = 0.35): void {
  const fx = kit.h.fx;
  let left = dur;
  kit.proc((dt) => {
    left -= dt;
    const fade = Math.min(1, left);
    for (const p of spots) if (rnd() < rate * fade) {
      fx.particle({ pos: p.clone().add(new THREE.Vector3(rand(-0.2, 0.2), 0.05, rand(-0.2, 0.2))), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1, 2.2), rand(-0.2, 0.2)), life: rand(0.3, 0.6), size: rand(0.06, 0.12), color: rnd() < 0.6 ? FIRE_A : FIRE_B, gravity: -1.5 });
    }
    return left > 0;
  });
}

/** Fire cubes fly out from the centre, swell and go out */
function fireCubes(kit: Spells, mid: THREE.Vector3, R: number, n: number): void {
  kit.h.fx.fireCubes(mid, R, n, [FIRE_A.clone().multiplyScalar(0.45), FIRE_B.clone().multiplyScalar(0.45)], 0.25 + R * 0.16, false, [0.35, 0.65]);
}

/** Ice shard cubes fan out from the centre: fly, tumble, melt */
function iceShards(kit: Spells, c: THREE.Vector3, R: number, n: number): void {
  const mat = iceMat(0.8);
  const g = new THREE.Group();
  const parts = Array.from({ length: n }, () => {
    const m = new THREE.Mesh(UNIT, mat);
    const s = rand(0.12, 0.3);
    m.scale.set(s, s * rand(1, 2.2), s);
    m.position.copy(c);
    g.add(m);
    const a = rnd() * Math.PI * 2;
    return { m, v: new THREE.Vector3(Math.cos(a), rand(0.2, 0.9), Math.sin(a)).multiplyScalar(R * rand(1.2, 2.2)), spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)) };
  });
  const dur = 0.9;
  kit.h.fx.custom(g, dur, (t) => {
    const tt = t * dur;
    for (const p of parts) {
      p.m.position.set(c.x + p.v.x * tt, Math.max(c.y + 0.05, c.y + p.v.y * tt - 6 * tt * tt), c.z + p.v.z * tt);
      p.m.rotation.set(p.spin.x * tt, p.spin.y * tt, p.spin.z * tt);
    }
    mat.opacity = 0.8 * (1 - t * t);
  }, () => mat.dispose());
}

// ---------- group sounds: pentatonic, warm voices, low end via boom ----------
const sfx = {
  /** Howl of a falling meteor: whistle downward and a growing rumble */
  meteorFall(dur: number) {
    voice({ type: 'sine', f: 1900, f1: 260, dur, vol: 0.06, attack: 0.2, verb: 0.4 });
    voice({ type: 'triangle', f: 950, f1: 130, dur, vol: 0.03, attack: 0.3, verb: 0.4 });
    hiss({ dur, vol: 0.22, f: 300, f1: 2400, q: 0.6, type: 'lowpass', attack: dur * 0.9, verb: 0.3 });
  },
  /** Landing: heavy hit, crunch of stone, roar, brass chord, clatter of debris */
  meteorHit(k: number) {
    boom(100 - k * 30, 24, 1.4, 0.85, 0, 0.5);
    hiss({ dur: 0.18, vol: 0.45, f: 1200, q: 0.5, verb: 0.3 });
    hiss({ dur: 1.6, vol: 0.3, f: 1400, f1: 120, q: 0.4, type: 'lowpass', verb: 0.5 });
    [0, 7, 12, 19].forEach((s, i) => voice({ type: 'sawtooth', f: semi(98, s), dur: 1.2, vol: 0.05, detune: 10, lp: 2800, lp1: 220, delay: i * 0.02, verb: 0.55 }));
    for (let i = 0; i < 10; i++) voice({ type: 'triangle', f: rand(180, 420), dur: 0.08, vol: 0.05, delay: 0.25 + rnd() * 1, verb: 0.2 });
  },
  /** The serpent woke: growl and hiss */
  serpentWake() {
    voice({ type: 'sawtooth', f: 82, f1: 123, dur: 0.8, vol: 0.08, detune: 14, lp: 600, lp1: 1800, verb: 0.4 });
    hiss({ dur: 0.9, vol: 0.25, f: 400, f1: 2400, q: 0.6, type: 'lowpass', attack: 0.15, verb: 0.4 });
    boom(130, 45, 0.6, 0.5);
  },
  /** The serpent crawls: hum of flame (in pieces while alive) */
  serpentCrawl() { hiss({ dur: 0.45, vol: 0.09, f: 700, q: 0.5, type: 'lowpass', attack: 0.15, verb: 0.2 }); },
  /** Bite and tail strike */
  serpentBite(i: number) {
    pluck(deg(220, 4 + (i % 5)), 0.07);
    hiss({ dur: 0.2, vol: 0.22, f: 1800, f1: 500, q: 0.8, verb: 0.2 });
    boom(150, 60, 0.25, 0.25);
  },
  serpentEnd() {
    boom(110, 35, 0.8, 0.45);
    [12, 7, 0].forEach((s, i) => voice({ type: 'triangle', f: semi(220, s), dur: 0.7, vol: 0.05, delay: i * 0.07, verb: 0.5 }));
  },
  /** Crown: inhale, a pop of fire, roar of the wave */
  crown(k: number) {
    boom(120 - k * 30, 32, 0.9, 0.65, 0, 0.35);
    hiss({ dur: 0.7, vol: 0.32, f: 300, f1: 3500, q: 0.5, type: 'lowpass', attack: 0.04, verb: 0.4 });
    [0, 4, 7, 12].forEach((s, i) => voice({ type: 'triangle', f: semi(293.66, s), dur: 0.8, vol: 0.05, delay: 0.05 + i * 0.04, verb: 0.55 }));
  },
  /** The ice set: glassy crunch and a high chord */
  freeze() {
    hiss({ dur: 0.3, vol: 0.25, f: 6000, type: 'highpass', verb: 0.4 });
    for (let i = 0; i < 7; i++) voice({ type: 'triangle', f: deg(1567.98, (rnd() * 7) | 0), dur: 0.2, vol: 0.04, delay: i * 0.025, verb: 0.4 });
    [0, 4, 7].forEach((s) => bell(semi(783.99, s), 1.4, 0.05, 0.05, 0.7));
    boom(140, 50, 0.5, 0.4);
  },
  /** The ice cracks: a click (more often toward the end) */
  creak(i: number) {
    voice({ type: 'triangle', f: deg(1046.5, 2 + (i % 6)), dur: 0.06, vol: 0.04, verb: 0.3 });
    hiss({ dur: 0.04, vol: 0.08, f: 5000, q: 2, verb: 0.1 });
  },
  /** The crystal shattered: hit, ringing of shards, bells */
  shatter(k: number) {
    boom(120 - k * 30, 30, 0.9, 0.7, 0, 0.45);
    hiss({ dur: 0.5, vol: 0.35, f: 4500, type: 'highpass', verb: 0.45 });
    for (let i = 0; i < 16; i++) voice({ type: 'triangle', f: deg(2093, (rnd() * 9) | 0), dur: 0.15, vol: 0.035, delay: rnd() * 0.35, verb: 0.4 });
    [0, 4, 7, 12, 16].forEach((s, i) => bell(semi(523.25, s), 1.8, 0.05, 0.04 + i * 0.03, 0.7));
  },
  /** A ridge spike grew: a note up the scale and a crunch */
  spike(i: number) {
    voice({ type: 'triangle', f: deg(523.25, i), dur: 0.22, vol: 0.05, verb: 0.35 });
    hiss({ dur: 0.07, vol: 0.12, f: 3500, q: 1.2, verb: 0.15 });
  },
  ridge(k: number) {
    boom(130 - k * 30, 40, 0.6, 0.5);
    hiss({ dur: 0.5, vol: 0.2, f: 2500, f1: 7000, q: 0.7, attack: 0.05, verb: 0.4 });
  },
  /** Heartbeat — two beats */
  heart(vol = 0.35) { boom(70, 40, 0.18, vol, 0, 0.2); boom(66, 38, 0.2, vol * 0.75, 0.2, 0.2); },
  /** The dome rose: dull thud, a long icy chord */
  dome(k: number) {
    boom(90 - k * 25, 26, 1.6, 0.8, 0, 0.6);
    [0, 7, 12, 16, 19].forEach((s, i) => voice({ type: 'sine', f: semi(261.63, s), dur: 4, vol: 0.035, attack: 0.6, delay: i * 0.05, verb: 0.8 }));
    hiss({ dur: 2, vol: 0.08, f: 6000, f1: 9000, q: 0.8, attack: 0.8, verb: 0.6 });
  },
};

// ---------- 1. Sky hammer ----------

const meteor: Spell = {
  school: 'fireball', tier: 'rare', title: t('Sky hammer'),
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, c = kit.ground(at, 14), R = (a.radius ?? 3.5) + k * 1.5, fall = 0.95;
    kit.face(c);
    kit.windup('fireball', k);
    sfx.meteorFall(fall);
    // windup: a circle on the ground and a red shadow that grows and deepens
    kit.groundSigil('fireball', c, R, fall, 0.2, 0.25);
    const shadowMat = glowMat(C(1.6, 0.25, 0.08), 0);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 40), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.copy(c).setY(c.y + 0.06);
    fx.custom(shadow, fall, (t) => { shadow.scale.setScalar(R * (0.2 + 0.8 * t)); shadowMat.opacity = 0.15 + t * 0.55 + Math.sin(t * 40) * 0.05; });
    // meteor: white core in a blazing shell, halo and light fly along
    const size = 0.9 + k * 0.6;
    const g = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({ color: C(4, 3.4, 1.6), toneMapped: false });
    const shellMat = glowMat(C(3, 0.9, 0.2), 0.55);
    const rockMat = new THREE.MeshLambertMaterial({ color: '#5a4636', emissive: '#ff5a1a', emissiveIntensity: 0.6 });
    const core = new THREE.Mesh(UNIT, coreMat), shell = new THREE.Mesh(UNIT, shellMat), rock = new THREE.Mesh(UNIT, rockMat);
    rock.scale.setScalar(size * 0.85); core.scale.setScalar(size * 0.6); shell.scale.setScalar(size * 1.5);
    const halo = new THREE.Sprite(additiveSprite(glowTex(), FIRE_A.clone().multiplyScalar(0.35)));
    halo.scale.setScalar(size * 5);
    g.add(rock, core, shell, halo);
    const from = c.clone().add(new THREE.Vector3(-5, 18, 4));
    g.position.copy(from);
    const light = fx.light(from, '#ffa040', 8, 9, fall + 0.1);
    fx.custom(g, fall, (t) => {
      const e = t * t;
      g.position.copy(from).lerp(c, e);
      g.rotation.set(t * 9, t * 6, t * 4);
      shell.scale.setScalar(size * (1.4 + Math.sin(t * 60) * 0.12));
      light.position.copy(g.position); light.intensity = 8 + t * 10;
      for (let i = 0; i < 4; i++) fx.particle({ pos: g.position.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(size * 0.5)), vel: new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1)), life: rand(0.3, 0.6), size: size * rand(0.15, 0.3), color: rnd() < 0.5 ? FIRE_A : FIRE_B, gravity: -2 });
      if (rnd() < 0.4) fx.flash(g.position.clone(), FIRE_A.clone().multiplyScalar(0.5), size * 3, 0.15);
    }, () => { coreMat.dispose(); shellMat.dispose(); rockMat.dispose(); halo.material.dispose(); });
    kit.later(fall, () => {
      // hit: crater, stones, fire cubes, rings
      const mid = c.clone().setY(c.y + 0.8);
      kit.impact('fireball', c, k, 18, 0.7);
      kit.pomp('rare', c, 'fireball');
      sfx.meteorHit(k);
      fx.flash(mid, FIRE_B.clone().multiplyScalar(0.4), Math.min(6, R * 1.3), 0.35);
      for (let i = 0; i < 3; i++) fx.flash(mid.clone().add(new THREE.Vector3(rand(-R, R) * 0.5, rand(0, R * 0.4), rand(-R, R) * 0.5)), (i % 2 ? FIRE_A : FIRE_B).clone().multiplyScalar(0.35), R * rand(0.5, 0.7), rand(0.3, 0.5));
      fireCubes(kit, mid, R, 10 + Math.round(k * 6));
      fx.burst(mid, [FIRE_A, FIRE_B, C(4, 3.6, 2.4)], 28 + Math.round(k * 16), { speed: R * 3, up: R * 1.8, size: 0.08, life: 0.8, glow: true, gravity: 5 });
      fx.burst(c.clone().setY(c.y + 0.3), ['#6b5040', '#8a6a50', '#5a5a5a', '#4a3a30'], 18 + Math.round(k * 10), { speed: R * 1.8, up: 7, size: 0.22, life: 1.4, gravity: 14 });
      fx.shock(c, R * 1.2, FIRE_A, 0.45, 0.25);
      fx.shock(c, R * 0.75, FIRE_B, 0.35, 0.18);
      kit.h.aoe(c, R, Math.round(power), 2.5 + k, true);
      // crater: a ring of stones bulges out of the ground and slowly sinks back
      const stoneMat = new THREE.MeshLambertMaterial({ color: '#6b5a4a' });
      const hotMat = new THREE.MeshLambertMaterial({ color: '#4a3a30', emissive: '#ff4a10', emissiveIntensity: 0.8 });
      const crater = new THREE.Group();
      const n = 12;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + rand(-0.1, 0.1), r = R * rand(0.45, 0.6);
        const m = new THREE.Mesh(UNIT, i % 3 ? stoneMat : hotMat);
        const s = rand(0.35, 0.6);
        m.scale.set(s, s * rand(0.8, 1.4), s);
        m.position.set(c.x + Math.cos(ang) * r, c.y - s, c.z + Math.sin(ang) * r);
        m.rotation.set(rand(-0.6, 0.6), ang, rand(-0.6, 0.6));
        m.userData.h = s * 0.4;
        crater.add(m);
      }
      const life = 6;
      fx.custom(crater, life, (t) => {
        const tt = t * life;
        const up = tt < 0.15 ? tt / 0.15 : tt > life - 1.2 ? Math.max(0, (life - tt) / 1.2) : 1;
        crater.children.forEach((m) => { const mm = m as THREE.Mesh; mm.position.y = c.y - mm.scale.y * 0.5 + (mm.userData.h + mm.scale.y * 0.5) * up; });
        hotMat.emissiveIntensity = 0.8 * Math.max(0, 1 - tt / 4);
      }, () => { stoneMat.dispose(); hotMat.dispose(); });
      // aftertaste: a scorched spot, smouldering light, fire on the floor
      fx.decal(c, kit.tex.scorch(), '#ffffff', R * 2.6, 6, false, 0.75);
      fx.decal(c, kit.tex.glow(), FIRE_A.clone().multiplyScalar(0.35), R * 2, 2.5, true);
      const spots = Array.from({ length: 6 + Math.round(k * 5) }, () => { const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R * 0.9; return c.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0.05, Math.sin(ang) * r)); });
      burnSpots(kit, spots, 3.5 + k, 0.4);
    });
  },
};

// ---------- 2. Flame serpent ----------

const flameserpent: Spell = {
  school: 'fireball', tier: 'legendary', title: t('Flame serpent'),
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, hero = kit.h.hero;
    const dur = (a.duration ?? 3.5) + k * 1.5, reach = a.radius ?? 1.6;
    kit.face(at);
    kit.windup('fireball', k);
    const fwd = new THREE.Vector3(at.x - hero.pos.x, 0, at.z - hero.pos.z);
    if (fwd.lengthSq() < 0.01) fwd.set(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
    fwd.normalize();
    const start = hero.pos.clone().addScaledVector(fwd, 1.2);
    kit.later(0.2, () => {
      // hit: the serpent bursts out of the ground — flash, ring, the legendary slow-down
      kit.impact('fireball', start, k, 12, 0.5);
      kit.pomp('legendary', start, 'fireball');
      sfx.serpentWake();
      fx.burst(start.clone().setY(start.y + 0.4), [FIRE_A, FIRE_B], 30, { speed: 4, up: 5, size: 0.08, life: 0.6, glow: true, gravity: 5 });
      fx.burst(start.clone().setY(start.y + 0.1), ['#6b5040', '#8a6a50'], 10, { speed: 3, up: 5, size: 0.16, life: 0.9, gravity: 14 });
      const N = 14, gap = 0.32;
      const segMat = new THREE.MeshBasicMaterial({ color: C(2.2, 0.7, 0.12), toneMapped: false });
      const segMat2 = new THREE.MeshBasicMaterial({ color: C(2.4, 1.4, 0.3), toneMapped: false });
      const shellMat = glowMat(C(0.9, 0.25, 0.04), 0.35);
      const eyeMat = new THREE.MeshBasicMaterial({ color: C(2.5, 2.5, 2), toneMapped: false });
      const g = new THREE.Group();
      const segs: THREE.Object3D[] = [];
      for (let i = 0; i < N; i++) {
        const seg = new THREE.Group();
        const s = (i === 0 ? 0.62 : 0.5) * (1 - (i / N) * 0.6) * (1 + k * 0.25);
        const body = new THREE.Mesh(UNIT, i % 2 ? segMat2 : segMat); body.scale.setScalar(s);
        const shell = new THREE.Mesh(UNIT, shellMat); shell.scale.setScalar(s * 1.5);
        seg.add(body, shell);
        if (i === 0) for (const side of [-1, 1]) { const e = new THREE.Mesh(UNIT, eyeMat); e.scale.setScalar(s * 0.2); e.position.set(side * s * 0.3, s * 0.25, s * 0.45); seg.add(e); }
        seg.position.copy(start);
        g.add(seg); segs.push(seg);
      }
      kit.h.scene.add(g);
      const light = fx.light(start, '#ff8a30', 6, 7, dur + 0.5);
      // the head follows its own trail; the tail repeats the path
      const path: THREE.Vector3[] = [start.clone()];
      const head = start.clone(), dir = fwd.clone();
      const bitten = new Map<Target, number>();
      let t = 0, lashT = 0.8, crawlT = 0, dropT = 0, bites = 0;
      const rut: THREE.Vector3[] = [];
      kit.proc((dt) => {
        t += dt;
        // target: the nearest enemy near the head, otherwise the cursor; turning is limited, a wave on top (it weaves)
        const prey = kit.nearest(head, 9);
        const goal = prey ? prey.pos : kit.aim;
        const want = new THREE.Vector3(goal.x - head.x, 0, goal.z - head.z);
        if (want.lengthSq() > 0.04) {
          const da = Math.atan2(want.x, want.z) - Math.atan2(dir.x, dir.z);
          const turn = Math.atan2(Math.sin(da), Math.cos(da));
          const wig = Math.sin(t * 7) * 2.2;
          const ang = Math.atan2(dir.x, dir.z) + THREE.MathUtils.clamp(turn * 3 + wig, -4.5, 4.5) * dt;
          dir.set(Math.sin(ang), 0, Math.cos(ang));
        }
        head.addScaledVector(dir, (6 + k * 2) * dt);
        const fy = kit.h.terrain.floorAt(head.x, head.z, head.y + 1.5);
        head.y = Number.isFinite(fy) ? fy : head.y;
        const last = path[path.length - 1];
        if (last.distanceTo(head) > 0.08) path.push(head.clone());
        if (path.length > 400) path.splice(0, path.length - 400);
        // segments along the path: each gap metres behind the previous one
        let need = 0, idx = path.length - 1, acc = 0;
        for (let i = 0; i < N; i++) {
          while (idx > 0 && acc < need) { acc += path[idx].distanceTo(path[idx - 1]); idx--; }
          const p = path[Math.max(0, idx)];
          const seg = segs[i];
          const bob = Math.sin(t * 9 - i * 0.7) * 0.18;
          seg.position.set(p.x, p.y + 0.45 + bob + (i === 0 ? 0.1 : 0), p.z);
          const nxt = path[Math.max(0, idx - 3)];
          seg.lookAt(nxt.x === p.x && nxt.z === p.z ? p.x + dir.x : 2 * p.x - nxt.x, seg.position.y, nxt.x === p.x && nxt.z === p.z ? p.z + dir.z : 2 * p.z - nxt.z);
          seg.rotation.z += Math.sin(t * 12 + i) * 0.2;
          need += gap;
        }
        light.position.copy(segs[0].position); light.intensity = 6 + Math.sin(t * 20) * 1.5;
        // flame off the body
        for (let i = 0; i < N; i += 3) if (rnd() < 0.4) fx.particle({ pos: segs[i].position.clone(), vel: new THREE.Vector3(rand(-0.4, 0.4), rand(1, 2.2), rand(-0.4, 0.4)), life: rand(0.25, 0.5), size: rand(0.06, 0.12), color: rnd() < 0.5 ? FIRE_A : FIRE_B, gravity: -1.5 });
        // burning track
        dropT -= dt;
        if (dropT <= 0) { dropT = 0.18; const p = segs[N - 1].position.clone().setY(head.y + 0.03); rut.push(p); fx.decal(p, kit.tex.scorch(), '#ffffff', 0.9, 3.5, false, 0.55); }
        // bite: the head touches an enemy
        for (const tg of kit.h.targets()) {
          if (!tg.alive) continue;
          if (Math.hypot(tg.pos.x - head.x, tg.pos.z - head.z) > tg.radius + 0.7) continue;
          if (t - (bitten.get(tg) ?? -9) < 0.5) continue;
          bitten.set(tg, t);
          kit.h.damage(tg, Math.round(power), head, 1.2);
          fx.flash(tg.pos.clone().setY(tg.pos.y + 1), FIRE_B.clone().multiplyScalar(0.6), 2, 0.2);
          fx.burst(tg.pos.clone().setY(tg.pos.y + 1), [FIRE_A, FIRE_B], 14, { speed: 4, up: 3, size: 0.07, life: 0.4, glow: true, gravity: 6 });
          sfx.serpentBite(bites++);
        }
        // tail strike: an arc of fire and damage around the tip
        lashT -= dt;
        if (lashT <= 0) {
          lashT = 1.1;
          const tail = segs[N - 1].position;
          fx.arc(tail.clone(), Math.atan2(dir.x, dir.z) + Math.PI, FIRE_A.clone().multiplyScalar(0.7), reach * 1.4, 1.6, tail.y);
          fx.shock(tail.clone().setY(head.y + 0.05), reach * 1.3, FIRE_B, 0.3, 0.15);
          kit.h.aoe(tail.clone().setY(head.y), reach, Math.round(power * 0.6), 1.6, true);
          sfx.serpentBite(bites++);
        }
        crawlT -= dt;
        if (crawlT <= 0) { crawlT = 0.4; sfx.serpentCrawl(); }
        if (t < dur) return true;
        // end: the serpent crumbles into embers
        for (const seg of segs) {
          fx.flash(seg.position.clone(), FIRE_A.clone().multiplyScalar(0.5), 1.4, 0.3);
          fx.burst(seg.position.clone(), [FIRE_A, FIRE_B], 8, { speed: 3, up: 3, size: 0.07, life: 0.6, glow: true, gravity: 4 });
        }
        kit.h.aoe(head.clone(), reach * 1.4, Math.round(power * 0.8), 1.5, true);
        sfx.serpentEnd();
        light.intensity = 0;
        kit.h.scene.remove(g);
        segMat.dispose(); segMat2.dispose(); shellMat.dispose(); eyeMat.dispose();
        burnSpots(kit, rut.filter((_, i) => i % 2 === 0), 2, 0.25);
        return false;
      });
    });
  },
};

// ---------- 3. Ash crown ----------

const ashcrown: Spell = {
  school: 'fireball', tier: 'common', title: t('Ash crown'),
  cast(kit, a, power, _at, k) {
    const fx = kit.h.fx, hero = kit.h.hero, R = (a.radius ?? 5) + k * 2;
    kit.windup('fireball', k);
    // windup: fire gathers in a ring at the feet
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2, r = 1.8, life = 0.18;
      const from = hero.pos.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0.2, Math.sin(ang) * r));
      fx.particle({ pos: from, vel: hero.pos.clone().setY(hero.pos.y + 0.2).sub(from).divideScalar(life), life, size: 0.08, color: i % 2 ? FIRE_A : FIRE_B, gravity: 0, shrink: false });
    }
    kit.later(0.18, () => {
      const c = hero.pos.clone();
      kit.impact('fireball', c, k, 14, 0.5);
      kit.pomp('common', c, 'fireball');
      sfx.crown(k);
      fx.flash(c.clone().setY(c.y + 0.8), FIRE_B.clone().multiplyScalar(0.6), 3, 0.3);
      // wave: a fire ring grows to R, flame tongues along the front; hits everyone it has passed
      const ringMat = glowMat(FIRE_A.clone().multiplyScalar(0.5), 1);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 64), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(c).setY(c.y + 0.12);
      const wallMat = glowMat(FIRE_B.clone().multiplyScalar(0.15), 0.8);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.9, 48, 1, true), wallMat);
      wall.position.copy(c).setY(c.y + 0.45);
      const dur = 0.55;
      const hit = new Set<Target>();
      const g = new THREE.Group(); g.add(ring, wall);
      fx.custom(g, dur, (t) => {
        const r = 0.4 + (R - 0.4) * (1 - (1 - t) ** 2);
        ring.scale.setScalar(r); wall.scale.set(r, 1 - t * 0.6, r);
        ringMat.opacity = 1 - t * 0.7; wallMat.opacity = 0.8 * (1 - t);
        for (let i = 0; i < 10; i++) {
          const ang = rnd() * Math.PI * 2;
          fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0.15, Math.sin(ang) * r)), vel: new THREE.Vector3(Math.cos(ang) * 2, rand(1.5, 3), Math.sin(ang) * 2), life: rand(0.25, 0.45), size: rand(0.07, 0.13), color: rnd() < 0.5 ? FIRE_A : FIRE_B, gravity: -1 });
        }
        for (const tg of kit.within(c, r)) {
          if (hit.has(tg)) continue;
          hit.add(tg);
          kit.h.damage(tg, Math.round(power), c, 2.5 + k * 1.5);
          fx.burst(tg.pos.clone().setY(tg.pos.y + 1), [FIRE_A, FIRE_B], 10, { speed: 3, up: 2, size: 0.07, life: 0.4, glow: true, gravity: 6 });
        }
      });
      fx.shock(c, R, FIRE_B, 0.6, 0.08);
      // aftertaste: an ash ring and embers around the circle
      fx.decal(c, kit.tex.scorch(), '#ffffff', R * 1.6, 3.5, false, 0.45);
      const spots = Array.from({ length: 10 }, (_, i) => { const ang = (i / 10) * Math.PI * 2; return c.clone().add(new THREE.Vector3(Math.cos(ang) * R * 0.85, 0.05, Math.sin(ang) * R * 0.85)); });
      burnSpots(kit, spots, 1.8 + k, 0.3);
    });
  },
};

// ---------- 4. Ice tomb ----------

/** Ice crystal around a point: a tall block and protruding cubes; grows in 0.2 s */
function crystal(kit: Spells, p: THREE.Vector3, h: number, w: number): { g: THREE.Group; mat: THREE.MeshBasicMaterial; edge: THREE.MeshBasicMaterial } {
  const mat = iceMat(0.42), edge = glowMat(ICE_A.clone().multiplyScalar(0.07), 0.9);
  const g = new THREE.Group();
  const main = new THREE.Mesh(UNIT, mat); main.scale.set(w, h, w); main.position.y = h / 2;
  const glow = new THREE.Mesh(UNIT, edge); glow.scale.set(w * 1.04, h * 1.02, w * 1.04); glow.position.y = h / 2;
  g.add(main, glow);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(UNIT, mat);
    const s = w * rand(0.35, 0.6);
    m.scale.set(s, s * rand(1.2, 2), s);
    const ang = (i / 6) * Math.PI * 2 + rand(-0.3, 0.3);
    m.position.set(Math.cos(ang) * w * 0.55, rand(0.2, h * 0.8), Math.sin(ang) * w * 0.55);
    m.rotation.set(rand(-0.7, 0.7), ang, rand(-0.7, 0.7));
    g.add(m);
  }
  g.position.copy(p);
  g.rotation.y = rnd() * Math.PI;
  kit.h.scene.add(g);
  return { g, mat, edge };
}

const icetomb: Spell = {
  school: 'icerain', tier: 'rare', title: t('Ice tomb'),
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, hold = a.duration ?? 2, R = (a.radius ?? 3.5) + k * 1.5;
    const victim = kit.nearest(at, 4);
    const c = victim ? victim.pos.clone() : kit.ground(at, 12);
    kit.face(c);
    kit.windup('icerain', k);
    // windup: frost spirals in toward the target
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 4, r = 2.4 - i * 0.06, life = 0.25;
      const from = c.clone().add(new THREE.Vector3(Math.cos(ang) * r, rand(0.2, 2), Math.sin(ang) * r));
      fx.particle({ pos: from, vel: c.clone().setY(c.y + 1).sub(from).divideScalar(life), life, size: 0.07, color: i % 2 ? ICE_A : ICE_B, gravity: 0, shrink: false });
    }
    kit.later(0.25, () => {
      kit.impact('icerain', c, k, 12, 0.4);
      kit.pomp('rare', c, 'icerain');
      sfx.freeze();
      const h = victim ? Math.max(1.6, (victim.topY ?? 1.8) + 0.4) : 1.6, w = victim ? victim.radius * 2 + 0.5 : 1;
      const cr = crystal(kit, c, h * (1 + k * 0.15), w * (1 + k * 0.15));
      fx.flash(c.clone().setY(c.y + h / 2), ICE_B.clone().multiplyScalar(0.45), 2.4, 0.3);
      fx.burst(c.clone().setY(c.y + h / 2), [ICE_A, ICE_B], 24, { speed: 3, up: 3, size: 0.07, life: 0.5, glow: true, gravity: 4 });
      fx.decal(c, kit.tex.frost(), ICE_A.clone().multiplyScalar(0.22), 3.5, hold + 3, true, 0.8);
      if (victim) kit.h.damage(victim, Math.round(power * 0.3), kit.h.hero.pos, 0);
      let t = 0, creakT = 0.3, n = 0;
      kit.proc((dt) => {
        t += dt;
        const grow = Math.min(1, t / 0.2);
        cr.g.scale.set(1, 1 - (1 - grow) ** 3, 1);
        cr.edge.opacity = 0.7 + Math.sin(t * 8) * 0.25;
        if (rnd() < 0.3) fx.particle({ pos: c.clone().add(new THREE.Vector3(rand(-w, w) * 0.6, rand(0.2, h), rand(-w, w) * 0.6)), vel: new THREE.Vector3(0, rand(0.2, 0.6), 0), life: 0.6, size: 0.05, color: ICE_B, gravity: -0.2 });
        // cracks more and more often, trembles toward the end
        creakT -= dt;
        if (creakT <= 0) { creakT = Math.max(0.06, 0.35 * (1 - t / hold)); sfx.creak(n++); }
        if (t > hold - 0.4) cr.g.position.set(c.x + rand(-0.04, 0.04), c.y, c.z + rand(-0.04, 0.04));
        if (t < hold) return true;
        // shattered: shards fan out, damage around the circle
        kit.h.scene.remove(cr.g);
        cr.mat.dispose(); cr.edge.dispose();
        const mid = c.clone().setY(c.y + h * 0.5);
        kit.impact('icerain', c, k, 14, 0.6);
        sfx.shatter(k);
        iceShards(kit, mid, R, 26 + Math.round(k * 14));
        fx.burst(mid, [ICE_A, ICE_B, C(3.6, 3.8, 4)], 40, { speed: R * 3, up: 3, size: 0.07, life: 0.6, glow: true, gravity: 6 });
        fx.flash(mid, ICE_B.clone().multiplyScalar(0.45), R, 0.3);
        fx.shock(c, R, ICE_A, 0.4, 0.2);
        kit.h.aoe(c, R, Math.round(power), 2, false);
        fx.decal(c, kit.tex.frost(), ICE_A.clone().multiplyScalar(0.25), R * 2.4, 4, true, 0.8);
        return false;
      });
    });
  },
};

// ---------- 5. Frost ridge ----------

const frostridge: Spell = {
  school: 'icerain', tier: 'common', title: t('Frost ridge'),
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, hero = kit.h.hero, L = (a.radius ?? 7) + k * 3;
    kit.face(at);
    kit.windup('icerain', k);
    const base = Math.atan2(at.x - hero.pos.x, at.z - hero.pos.z);
    const lines = 3 + Math.round(k * 2), spread = 0.42;
    const from = hero.pos.clone();
    kit.later(0.15, () => {
      kit.impact('icerain', from, k, 10, 0.35);
      kit.pomp('common', from, 'icerain');
      sfx.ridge(k);
      const mat = iceMat(0.7), glow = glowMat(ICE_A.clone().multiplyScalar(0.06), 0.8);
      const hit = new Set<Target>();
      const step = 0.8, speed = 14;
      let note = 0;
      for (let li = 0; li < lines; li++) {
        const ang = base + (lines === 1 ? 0 : (li / (lines - 1) - 0.5) * 2 * spread);
        const d = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
        for (let s = 1, dist = 0.9; dist <= L; s++, dist += step) {
          const p = from.clone().addScaledVector(d, dist);
          const fy = kit.h.terrain.floorAt(p.x, p.z, from.y + 1.5);
          p.y = Number.isFinite(fy) ? fy : from.y;
          kit.later(dist / speed, () => {
            // the spike grows with overshoot, holds and sinks into the ground
            const g = new THREE.Group();
            const sp = new THREE.Mesh(SPIKE, mat), gl = new THREE.Mesh(SPIKE, glow);
            gl.scale.setScalar(1.1);
            g.add(sp, gl);
            const sc = rand(0.7, 1.2) * (1 + k * 0.3) * (1 - dist / L * 0.3);
            g.position.copy(p);
            g.rotation.set(rand(-0.25, 0.25), rand(0, Math.PI), rand(-0.25, 0.25));
            const life = 1.4;
            fx.custom(g, life, (t) => {
              const tt = t * life;
              const up = tt < 0.12 ? (tt / 0.12) * 1.15 : tt < 0.22 ? 1.15 - ((tt - 0.12) / 0.1) * 0.15 : tt > life - 0.35 ? Math.max(0, (life - tt) / 0.35) : 1;
              g.scale.set(sc, sc * up, sc);
            }, () => { /* shared shape and material */ });
            fx.burst(p.clone().setY(p.y + 0.2), [ICE_A, ICE_B], 3, { speed: 2, up: 3, size: 0.05, life: 0.35, glow: true, gravity: 10 });
            if (li === 0 || li === lines - 1) sfx.spike(note++ % 10);
            for (const tg of kit.within(p, 0.7)) {
              if (hit.has(tg)) continue;
              hit.add(tg);
              kit.h.damage(tg, Math.round(power), from, 1.6 + k);
              fx.burst(tg.pos.clone().setY(tg.pos.y + 1), [ICE_A, ICE_B], 12, { speed: 3, up: 4, size: 0.06, life: 0.4, glow: true, gravity: 8 });
            }
            if (s % 3 === 0) fx.decal(p, kit.tex.frost(), ICE_A.clone().multiplyScalar(0.18), 1.4, 2.5, true, 0.7);
          });
        }
      }
      // aftertaste: cold fog along the fan; dispose the shared materials once everything has melted
      let left = L / speed + 1.8;
      kit.proc((dt) => {
        left -= dt;
        if (rnd() < 0.6) {
          const ang = base + rand(-spread, spread), dist = rand(1, L);
          fx.particle({ pos: from.clone().add(new THREE.Vector3(Math.sin(ang) * dist, 0.15, Math.cos(ang) * dist)), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.1, 0.4), rand(-0.3, 0.3)), life: 1, size: rand(0.1, 0.16), color: ICE_B.clone().multiplyScalar(0.5), gravity: -0.1, drag: 1 });
        }
        if (left > 0) return true;
        mat.dispose(); glow.dispose();
        return false;
      });
    });
  },
};

// ---------- 6. Absolute zero ----------

const absolutezero: Spell = {
  school: 'icerain', tier: 'mythic', title: t('Absolute zero'),
  cast(kit, a, power, at, k) {
    const fx = kit.h.fx, R = (a.radius ?? 8) + k * 2, hold = (a.duration ?? 4) + k, unfold = 0.8;
    const c = kit.ground(at, 8);
    kit.face(c, 1);
    kit.windup('icerain', k);
    // windup: the world darkens and fades, sound is muffled, the heart is audible; a huge circle opens on the ground
    kit.pomp('mythic', c, 'icerain', t('Absolute zero'), unfold + hold + 0.3);
    duck(0.1, unfold + hold, 1.2);
    kit.groundSigil('icerain', c, R, unfold, hold, 0.2);
    sfx.heart(0.3);
    let beat = 0.75, beatLeft = unfold + hold;
    kit.proc((dt) => { beatLeft -= dt; beat -= dt; if (beat <= 0) { beat = 0.75; sfx.heart(0.32); } return beatLeft > 0; });
    // snow gathers toward the centre
    let pre = unfold;
    kit.proc((dt) => {
      pre -= dt;
      for (let i = 0; i < 4; i++) {
        const ang = rnd() * Math.PI * 2, r = R * rand(0.8, 1.1), life = 0.5;
        const from = c.clone().add(new THREE.Vector3(Math.cos(ang) * r, rand(0.3, 3), Math.sin(ang) * r));
        fx.particle({ pos: from, vel: c.clone().setY(c.y + 1).sub(from).divideScalar(life * 1.6), life, size: 0.08, color: i % 2 ? ICE_A : ICE_B, gravity: 0 });
      }
      return pre > 0;
    });
    kit.later(unfold, () => {
      kit.impact('icerain', c, k, 16, 0.8);
      sfx.dome(k);
      fx.flash(c.clone().setY(c.y + 1.5), ICE_B.clone().multiplyScalar(0.4), R * 0.7, 0.4);
      // dome: a translucent hemisphere and a grid of edges, grows in 0.4 s
      const domeMat = glowMat(C(0.05, 0.12, 0.24), 0.25);
      const wireMat = glowMat(ICE_A.clone().multiplyScalar(0.06), 0.6);
      wireMat.wireframe = true;
      const geo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      const dome = new THREE.Group();
      dome.add(new THREE.Mesh(geo, domeMat), new THREE.Mesh(geo, wireMat));
      dome.position.copy(c);
      kit.h.scene.add(dome);
      // every target in the dome freezes into its own crystal
      const frozen = kit.within(c, R).map((tg) => {
        const cr = crystal(kit, tg.pos.clone(), Math.max(1.6, (tg.topY ?? 1.8) + 0.3), tg.radius * 2 + 0.4);
        kit.h.damage(tg, Math.round(power * 0.5), c, 0);
        return { tg, cr };
      });
      // snow in the dome almost hangs — time stands still
      const flakes: { p: THREE.Vector3; v: THREE.Vector3 }[] = Array.from({ length: 60 }, () => {
        const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R * 0.9;
        return { p: c.clone().add(new THREE.Vector3(Math.cos(ang) * r, rand(0.3, R * 0.6), Math.sin(ang) * r)), v: new THREE.Vector3(rand(-0.05, 0.05), -rand(0.02, 0.08), rand(-0.05, 0.05)) };
      });
      fx.decal(c, kit.tex.frost(), ICE_A.clone().multiplyScalar(0.08), R * 2.3, hold + 3, true, 0.85);
      let t = 0, tick = 1;
      kit.proc((dt) => {
        t += dt;
        const e = Math.min(1, t / 0.4);
        dome.scale.setScalar(R * (1 - (1 - e) ** 3));
        domeMat.opacity = 0.22 + Math.sin(t * 3) * 0.04;
        for (const f of flakes) { f.p.addScaledVector(f.v, dt); if (rnd() < 0.12) fx.particle({ pos: f.p.clone(), vel: f.v.clone(), life: 0.25, size: 0.06, color: ICE_B, gravity: 0, shrink: false }); }
        for (const { cr } of frozen) { cr.g.scale.set(1, Math.min(1, t / 0.25), 1); cr.edge.opacity = 0.6 + Math.sin(t * 6) * 0.2; }
        tick -= dt;
        if (tick <= 0) {
          tick = 1;
          for (const { tg } of frozen) if (tg.alive) kit.h.damage(tg, Math.round(power * 0.4), c, 0);
          fx.shock(c, R * 0.9, ICE_A, 0.5, 0.06);
        }
        if (t < hold) return true;
        // end: the dome and crystals burst, damage across the whole dome
        kit.h.scene.remove(dome);
        geo.dispose(); domeMat.dispose(); wireMat.dispose();
        for (const { cr, tg } of frozen) {
          kit.h.scene.remove(cr.g); cr.mat.dispose(); cr.edge.dispose();
          iceShards(kit, tg.pos.clone().setY(tg.pos.y + 1), 2, 14);
        }
        kit.impact('icerain', c, 1, 16, 0.9);
        sfx.shatter(1);
        iceShards(kit, c.clone().setY(c.y + R * 0.4), R * 0.6, 40);
        fx.burst(c.clone().setY(c.y + 1), [ICE_A, ICE_B, C(3.6, 3.8, 4)], 60, { speed: R * 2, up: 4, size: 0.08, life: 0.7, glow: true, gravity: 5 });
        fx.shock(c, R * 1.1, ICE_B, 0.5, 0.15);
        kit.h.aoe(c, R, Math.round(power * 1.5), 2, false);
        return false;
      });
    });
  },
};

export const FIRE_ICE = { meteor, flameserpent, ashcrown, icetomb, frostridge, absolutezero } satisfies Partial<Record<BossSpellKind, Spell>>;
