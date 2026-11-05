import * as THREE from 'three';
import { rnd } from './rng.ts';
import type { Target } from './target.ts';
import { CUBE, glowMat, type ProcCtx, type WeaponArts } from './weapon-arts.ts';

/**
  * Temper synergies (wiki/design-weapon-arts.md, section 3): 28 pairs of the eight melee enchantments, each with its own
  * effect on the finisher and on the weapon art. Names and texts — src/temper.ts (SYNERGIES), primitives — src/weapon-arts.ts.
  * c.dmg — synergy damage (from the finisher, power and the pair's tiers), c.power 0..1 — scale of the effect.
 */

type SynergyFx = (A: WeaponArts, c: ProcCtx) => void;

const _v = new THREE.Vector3();
const mix = (a: THREE.Color, b: THREE.Color, k: number, m = 1): THREE.Color => a.clone().lerp(b, k).multiplyScalar(m);
const at1 = (A: WeaponArts, p: THREE.Vector3, y = 0.9): THREE.Vector3 => p.clone().setY(A.ground + y);
const R = (k = 1): number => (rnd() - 0.5) * k;
const pct = (A: WeaponArts, k: number): number => Math.max(1, Math.round(A.maxHp * k));
const part = (v: number): number => Math.max(1, Math.round(v));

/** Targets along rays from at: length len, half-width w */
function onRays(A: WeaponArts, at: THREE.Vector3, angles: number[], len: number, w: number): Target[] {
  return A.near(at, len).filter((t) => angles.some((a) => {
    const dx = t.pos.x - at.x, dz = t.pos.z - at.z, s = Math.sin(a), co = Math.cos(a);
    const along = dx * s + dz * co;
    return along >= -0.3 && along <= len && Math.abs(dx * co - dz * s) - t.radius <= w;
  }));
}

/** Targets in a cone in front of the hero: radius r, half-angle half */
function inCone(A: WeaponArts, yaw: number, r: number, half: number): Target[] {
  const h = A.hero.pos;
  return A.near(h, r).filter((t) => {
    const a = Math.atan2(t.pos.x - h.x, t.pos.z - h.z) - yaw;
    return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= half + Math.atan(t.radius / Math.max(0.5, Math.hypot(t.pos.x - h.x, t.pos.z - h.z)));
  });
}

/** Damage in ticks: n times with step step, fn — the look of each tick */
function dot(A: WeaponArts, t: Target, n: number, step: number, v: number, fn: (t: Target, i: number) => void): void {
  A.repeat(n, step, (i) => { if (!t.alive) return; A.hurt(t, v, t.pos, 0); fn(t, i); });
}

/** Glowing cube projectile */
function glowCube(c: THREE.Color, s: number, opacity = 1): THREE.Mesh {
  const m = new THREE.Mesh(CUBE(), glowMat(c, opacity));
  m.scale.setScalar(s);
  return m;
}

/** Smokeless blast: flashes, fire cubes, sparks and two rings */
function boom(A: WeaponArts, at: THREE.Vector3, r: number, a: THREE.Color, b: THREE.Color): void {
  const fx = A.fx, c = at1(A, at, 0.7);
  fx.flash(c, a.clone().multiplyScalar(1.3), Math.min(6, r * 1.6), 0.3);
  fx.fireCubes(c, r * 0.8, Math.round(10 + r * 6), [a, b, new THREE.Color(3.4, 3, 2.4)], 0.3);
  fx.burst(c, [a, b], Math.round(12 + r * 6), { speed: r * 2.6, up: r * 1.4, size: 0.08, life: 0.6, glow: true, gravity: 3 });
  fx.ring(at1(A, at, 0.06), r, a, 0.4, 0.22);
  fx.ring(at1(A, at, 0.06), r * 0.6, b, 0.3, 0.16);
  fx.light(at1(A, at, 1.2), a.clone().multiplyScalar(0.35), 5, 10, 0.4);
  fx.shake = Math.max(fx.shake, 0.6);
}

export const SYNERGY_FX: Record<string, SynergyFx> = {
  // ---------- sharpness ----------
  starCross(A, c) {
    // the cross is rotated differently every time, rays of different length fly out as ribbons along a slightly bent curve
    const turn = R(0.9), at = at1(A, c.at), angles = [0, 1, 2, 3].map((i) => c.yaw + Math.PI / 4 + turn + (i * Math.PI) / 2 + R(0.25));
    angles.forEach((a, i) => A.later(i * (0.02 + rnd() * 0.05), () => {
      const L = 3 + rnd() * 1.4;
      A.fx.line(at, a, L, mix(c.a, c.b, i / 3, 0.85), 0.55, 0.32, at.y);
      A.fx.streak({ path: A.curve(at, at.clone().addScaledVector(A.dir(a), L), 0.1, 0.05, 0.03), dur: 0.12, color: mix(c.a, c.b, i / 3, 1.2), width: 0.35, tail: 0.25, halo: 2.6 });
      A.sparks(at.clone().addScaledVector(A.dir(a), L), A.dir(a), c.a, 3, 1);
    }));
    A.fx.flash(at, c.b.clone().multiplyScalar(1.4), 2.6, 0.25);
    for (const t of onRays(A, c.at, angles, 3.5, 0.6)) A.hurt(t, c.dmg, c.at, 0.8);
    A.sound('hit');
  },
  bleed(A, c) {
    const victims = new Set([...c.hits, ...A.near(c.at, 2.5)]);
    for (const t of victims) dot(A, t, 4, 0.3, part(c.dmg * 0.3), (t) => {
      const p = at1(A, t.pos, 1.1);
      A.fx.burst(p, [c.b, new THREE.Color(1.6, 0.1, 0.25)], 5, { speed: 1.6, up: 1.4, size: 0.07, life: 0.5, glow: true, gravity: 9 });
      A.orbs(p, c.b, 1, 0.8);
      A.heal(part(c.dmg * 0.1));
    });
  },
  windBlade(A, c) {
    A.crescent(A.hero.pos.clone().addScaledVector(A.dir(c.yaw), 0.5), c.yaw, 14, 9, 1.4 + c.power * 0.4, c.dmg, 2.4, mix(c.a, c.b, 0.5));
    A.fx.spray(at1(A, A.hero.pos), A.dir(c.yaw), ['#f0ead0', '#d8cfa8'], 14, { speed: 7, glow: false, gravity: 2, size: 0.1, life: 0.5, spread: 0.4 });
    A.sound('dash');
  },
  bladeOrbit(A, c) {
    const g = new THREE.Group(), n = 5, mats: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < n; i++) {
      const piv = new THREE.Group();
      piv.rotation.y = (i / n) * Math.PI * 2;
      const mat = glowMat(mix(c.a, c.b, i / (n - 1), 0.8));
      mats.push(mat);
      const b = new THREE.Mesh(CUBE(), mat);
      b.scale.set(0.9, 0.05, 0.16);
      b.position.x = 1.9;
      b.rotation.y = 0.5;
      piv.add(b);
      g.add(piv);
    }
    const cd = new Map<Target, number>(), dir = rnd() < 0.5 ? -1 : 1, sp = 7 + rnd() * 3, ph = rnd() * 6.28;
    A.body(g, 2, (k, dt) => {
      g.position.copy(at1(A, A.hero.pos, 0.9 + Math.sin(ph + k * 14) * 0.15));
      g.rotation.y += dt * sp * dir;
      // the blades breathe: radius and tilt drift
      g.rotation.x = Math.sin(ph + k * 9) * 0.18; g.rotation.z = Math.cos(ph + k * 7) * 0.18;
      g.scale.setScalar(0.85 + Math.sin(ph + k * 11) * 0.15);
      for (const m of mats) m.opacity = Math.min(1, k * 8, (1 - k) * 6);
      for (const [t, v] of cd) cd.set(t, v - dt);
      for (const t of A.near(A.hero.pos, 2.5)) {
        if ((cd.get(t) ?? 0) > 0 || Math.hypot(t.pos.x - A.hero.pos.x, t.pos.z - A.hero.pos.z) < 1.1) continue;
        cd.set(t, 0.35);
        A.hurt(t, part(c.dmg * 0.35), A.hero.pos, 0.5);
        A.fx.burst(at1(A, t.pos, 1), [c.a, c.b], 5, { speed: 2.5, up: 1.5, size: 0.06, life: 0.3, glow: true, gravity: 4 });
      }
    });
    A.sound('dash');
  },
  fireLine(A, c) {
    // the fire strip snakes: a new curve every time, the fire runs along it from the hero
    const from = at1(A, A.hero.pos, 0.1), L = 5 + rnd() * 2.5;
    const path = A.curve(from, from.clone().addScaledVector(A.dir(c.yaw + R(0.4)), L), 0.3, 0, 0.06);
    const pts = [0, 0.25, 0.5, 0.75, 1].map((k) => path(k, new THREE.Vector3()));
    A.fx.streak({ path, dur: 0.35, color: mix(c.a, c.b, 0.5, 1.1), color2: c.b, width: 0.6, tail: 0.6, halo: 2, core: 0.25 });
    A.ent(2.5, (dt) => {
      if (rnd() < dt * 34) {
        const p = path(rnd(), new THREE.Vector3()).add(_v.set(R(0.5), 0, R(0.5)));
        A.fx.fireCubes(at1(A, p, 0.25), 0.25, 2, [c.b, new THREE.Color(3.4, 2.4, 0.5), c.a], 0.22 + rnd() * 0.12, true, [0.4, 0.8]);
      }
    });
    A.repeat(8, 0.3, () => {
      const hit = new Set<Target>();
      for (let i = 0; i < 4; i++) for (const t of A.onSegment(pts[i], pts[i + 1], 0.8)) hit.add(t);
      for (const t of hit) A.hurt(t, part(c.dmg * 0.25), t.pos, 0);
    });
    A.sound('boom');
  },
  phantomEcho(A, c) {
    const g = A.ghost(c.b, 1.7), hero = A.hero;
    const mat = (g.children[0].children[0] as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined;
    // the echo swings left or right, with a tilt and a different sweep
    const y0 = c.yaw + R(0.4), sw = (1.1 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1), from = y0 - sw, to = y0 + sw, tilt = R(0.7);
    let struck = false;
    A.body(g, 0.6, (k) => {
      g.position.copy(at1(A, hero.pos, 1 + tilt * 0.3));
      const s = THREE.MathUtils.smoothstep(k, 0.25, 0.65);
      g.rotation.set(0, from + (to - from) * s, tilt);
      if (mat) mat.opacity = Math.min(0.9, k * 6, (1 - k) * 4);
      if (!struck && k > 0.45) {
        struck = true;
        A.fx.arc(hero.pos, y0, c.b.clone().multiplyScalar(0.3), 3.2, 1.4, A.ground + 1, 0.7);
        for (const t of inCone(A, y0, 3.3, 1.4)) A.hurt(t, c.dmg, hero.pos, 1.2);
        A.sound('hit');
      }
    });
  },
  skySword(A, c) {
    const [t0] = A.nearest(c.at, 3, 1);
    const p = (t0 ? t0.pos : c.at).clone().setY(A.ground);
    const g = A.ghost(mix(c.a, c.b, 0.5), 3);
    const len = (g.userData.bladeTip as number) ?? 3;
    // falls at its own angle and from its own side every time
    const tilt = R(0.5), side = A.dir(rnd() * 6.28).multiplyScalar(2 + rnd() * 3);
    g.rotation.set(Math.PI / 2 + tilt, rnd() * 6.28, 0, 'YXZ');
    A.fx.ring(at1(A, p, 0.06), 2.6, c.a, 0.4, 0.06, 0);
    let landed = false;
    A.body(g, 0.95, (k) => {
      const f = Math.min(1, k / 0.32), up = 1 - f * f;
      g.position.set(p.x + side.x * up, A.ground + len * 0.85 + up * 10, p.z + side.z * up);
      if (!landed) A.fx.particle({ pos: g.position.clone().add(_v.set(R(0.6), -len * 0.4, R(0.6))), life: 0.3, size: 0.1, color: c.b, gravity: 0 });
      if (!landed && f >= 1) {
        landed = true;
        A.skyBolt(p, c.b, 0.2);
        boom(A, p, 2.8, c.a, c.b);
        A.area(p, 2.8, Math.round(c.dmg * 1.3), 2);
        A.blast(p, 2, c.dmg);
        A.sound('boom');
      }
      const mat = (g.children[0].children[0] as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined;
      if (mat) mat.opacity = Math.min(0.95, (1 - k) * 3);
    });
  },

  // ---------- crit ----------
  heartStar(A, c) {
    A.forcedCrits = 3;
    const at = at1(A, A.hero.pos, 1);
    const n = 8 + Math.floor(rnd() * 5), off = rnd() * 6.28;
    for (let i = 0; i < n; i++) A.fx.line(at, off + (i / n) * Math.PI * 2 + R(0.2), 1.6 + rnd() * 1.4, mix(c.a, c.b, i % 2, 0.7), 0.22, 0.35, at.y + R(0.3));
    A.orbs(at.clone().add(_v.set(R(2), 1, R(2))), c.b, 4, 1.2);
    A.fx.flash(at, c.a.clone().multiplyScalar(1.4), 3, 0.3);
    A.fx.burst(at, [c.b, new THREE.Color(3.4, 1.2, 1.6)], 18, { speed: 1.4, up: 3, size: 0.09, life: 0.9, glow: true, gravity: -1 });
    const v = pct(A, 0.08);
    A.heal(v);
    A.fx.text(at.clone().setY(at.y + 0.5), `+${v}`, 'heal');
  },
  cometKick(A, c) {
    const [t] = c.hits.length ? A.nearest(c.at, 3, 1, new Set(A.near(c.at, 9).filter((x) => !c.hits.includes(x)))) : A.nearest(c.at, 3, 1);
    if (!t) { A.fx.burst(at1(A, c.at), [c.a], 12, { speed: 3, up: 2, size: 0.07, life: 0.5, glow: true }); return; }
    A.hurt(t, part(c.dmg * 0.5), A.hero.pos, 4.5);
    A.fx.streak({ path: (_k, out) => out.copy(t.pos).setY(A.ground + 1), dur: 0.5, color: c.a.clone().multiplyScalar(1.2), color2: c.b, width: 0.5, tail: 0.35, halo: 2.4 });
    A.ent(0.5, () => A.fx.particle({ pos: at1(A, t.pos, 1).add(_v.set(R(0.4), R(0.4), R(0.4))), vel: _v.set(0, 0.5, 0).clone(), life: 0.4, size: 0.12, color: rnd() < 0.5 ? c.a : c.b, gravity: 0 }),
      () => {
        boom(A, t.pos.clone(), 2.2, c.a, new THREE.Color(3.4, 3.2, 2.4));
        for (let i = 0; i < 6; i++) A.fx.line(at1(A, t.pos), (i / 6) * Math.PI * 2, 2, c.a.clone().multiplyScalar(0.7), 0.2, 0.3, A.ground + 0.9);
        A.area(t.pos, 2.2, c.dmg, 1.5);
        A.sound('boom');
      });
  },
  starSpiral(A, c) {
    // the spiral is wound in its own direction and with a different density every time, each star has its own scatter and tail
    const center = c.at.clone(), dir = rnd() < 0.5 ? -1 : 1, twist = 1.6 + rnd() * 1.8;
    for (let i = 0; i < 8; i++) {
      const a0 = c.yaw + (i / 8) * Math.PI * 2 + R(0.3), reach = 4.5 + rnd() * 2;
      const m = glowCube(i % 2 ? c.a : c.b, 0.2);
      let done = false;
      m.position.set(center.x + Math.sin(a0) * 0.6, A.ground + 0.9, center.z + Math.cos(a0) * 0.6);
      A.fx.streak({ path: (_k, out) => out.copy(m.position), dur: 0.9, color: i % 2 ? c.a : c.b, width: 0.16, tail: 0.3 });
      A.body(m, 0.9, (k) => {
        if (done) return;
        const r = 0.6 + k * reach, a = a0 + k * twist * dir;
        m.position.set(center.x + Math.sin(a) * r, A.ground + 0.9 + Math.sin(k * 9 + i) * 0.15, center.z + Math.cos(a) * r);
        m.rotation.set(k * 12, k * 9, 0);
        if (rnd() < 0.6) A.fx.particle({ pos: m.position.clone(), life: 0.25, size: 0.06, color: c.a, gravity: 0 });
        const [t] = A.nearest(m.position, 0.5, 1);
        if (t) { done = true; m.visible = false; A.hurt(t, part(c.dmg * 0.35), center, 0.6); A.fx.flash(m.position.clone(), c.a.clone(), 1.4, 0.15); }
      });
    }
    A.sound('zap');
  },
  supernova(A, c) {
    const at = c.at.clone();
    A.fx.flash(at1(A, at, 1), new THREE.Color(3.4, 3.2, 2.6), 2, 0.12);
    A.later(0.12, () => {
      boom(A, at, 3.2, c.a, c.b);
      A.fx.screenFlash('#ffb84a', 0.22, 0.2);
      A.area(at, 3.2, Math.round(c.dmg * 1.2), 2);
      A.blast(at, 3, c.dmg);
      A.sound('boom');
    });
  },
  starfall(A, c) {
    for (let i = 0; i < 5; i++) A.later(i * 0.12, () => {
      const p = c.at.clone().add(_v.set(R(5), 0, R(5)));
      const m = glowCube(c.a, 0.3), from = A.dir(rnd() * 6.28).multiplyScalar(1.5 + rnd() * 3), hgt = 6 + rnd() * 3;
      m.position.set(p.x + from.x, A.ground + 0.2 + hgt, p.z + from.z);
      A.fx.streak({ path: (_k, out) => out.copy(m.position), dur: 0.3, color: c.a.clone().multiplyScalar(1.3), color2: c.b, width: 0.3, tail: 0.25, halo: 2.8 });
      A.body(m, 0.3, (k) => {
        m.position.set(p.x + from.x * (1 - k), A.ground + 0.2 + (1 - k) * hgt, p.z + from.z * (1 - k));
        m.rotation.set(k * 8, k * 5, 0);
        A.fx.particle({ pos: m.position.clone(), life: 0.3, size: 0.12, color: rnd() < 0.5 ? c.a : c.b, gravity: 0 });
      }, () => {
        A.fx.flash(at1(A, p, 0.4), c.a.clone().multiplyScalar(1.2), 1.8, 0.2);
        A.fx.ring(at1(A, p, 0.06), 1.3, c.a, 0.25, 0.25);
        A.fx.burst(at1(A, p, 0.3), [c.a, c.b], 10, { speed: 2.5, up: 3, size: 0.07, life: 0.5, glow: true, gravity: 5 });
        A.area(p, 1.3, part(c.dmg * 0.4), 0.8);
        A.souls(1);
        A.orbs(at1(A, p, 0.5), c.b, 1);
      });
    });
  },
  wrath(A, c) {
    A.skyBolt(c.at.clone(), c.a, 0.16);
    A.chain(c.at, 5, 5, mix(c.a, c.b, 0.3), part(c.dmg * 0.6));
  },

  // ---------- vampirism ----------
  bloodRam(A, c) {
    const h = A.hero.pos;
    A.fx.arc(h, c.yaw, c.a.clone().multiplyScalar(0.3), 4, 1.2, A.ground + 0.5, 0.65);
    A.later(0.06, () => A.fx.arc(h, c.yaw, c.b.clone().multiplyScalar(0.25), 4.4, 1.2, A.ground + 0.8, 0.7));
    A.fx.spray(at1(A, h, 0.6), A.dir(c.yaw), [c.a, c.b], 20, { speed: 8, spread: 1, life: 0.35 });
    const hit = inCone(A, c.yaw, 4, 1.2);
    for (const t of hit) { A.hurt(t, part(c.dmg * 0.6), h, 3); A.orbs(at1(A, t.pos, 1), c.a, 2); }
    if (hit.length) A.heal(pct(A, 0.03) * hit.length);
    A.sound('horn');
  },
  crimsonVortex(A, c) {
    const at = c.at.clone();
    // blood clots circle and get pulled into the centre along their own spirals
    for (let i = 0; i < 5; i++) {
      const a0 = rnd() * 6.28, r0 = 2.5 + rnd() * 1.2, dir = rnd() < 0.5 ? -1 : 1, sp = 5 + rnd() * 4;
      A.fx.streak({ path: (k, out) => { const r = r0 * (1 - k * 0.85), a = a0 + k * sp * dir; return out.set(at.x + Math.sin(a) * r, A.ground + 0.5 + Math.sin(k * 8 + i) * 0.3, at.z + Math.cos(a) * r); }, dur: 1.4, color: i % 2 ? c.a : c.b, width: 0.18, tail: 0.35 });
    }
    A.ent(1.5, (dt, k) => {
      if (rnd() < dt * 40) A.swirl(at1(A, at, 0.3 + rnd() * 0.8), rnd() < 0.5 ? c.a : c.b, 1 + rnd() * 2.5, 2, true);
      if (rnd() < dt * 4) A.fx.ring(at1(A, at, 0.06), 3.5 * (1 - k * 0.3), c.a, 0.5, 0.08);
    });
    A.repeat(6, 0.25, () => {
      const hit = A.near(at, 3.5);
      for (const t of hit) A.hit(t, part(c.dmg * 0.15), new THREE.Vector3(at.x - t.pos.x, 0, at.z - t.pos.z).normalize(), 1);
      if (hit.length) { A.heal(part(c.dmg * 0.06) * hit.length); for (const t of hit.slice(0, 3)) A.orbs(at1(A, t.pos, 1), c.a, 1, 0.6); }
    });
    A.sound('souls');
  },
  lifeFlame(A, c) {
    const r = 2.6;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 48).rotateX(-Math.PI / 2), glowMat(c.b.clone().multiplyScalar(0.5), 0.8));
    let spin = rnd() * 6.28;
    const dir = rnd() < 0.5 ? -1 : 1, ph = rnd() * 6.28;
    // three tongues of flame run along the ring, the ring breathes
    for (let i = 0; i < 3; i++) A.fx.streak({ path: (k, out) => { const a = spin + (i / 3) * Math.PI * 2, rr = r * (1 + Math.sin(ph + k * 12 + i) * 0.06); return out.set(A.hero.pos.x + Math.sin(a) * rr, A.ground + 0.35 + Math.sin(k * 20 + i * 2) * 0.15, A.hero.pos.z + Math.cos(a) * rr); }, dur: 2.4, color: c.b.clone().multiplyScalar(1.1), color2: c.a, width: 0.35, tail: 0.3, halo: 2.4, core: 0.25 });
    A.body(ring, 2.5, (k, dt) => {
      ring.position.copy(at1(A, A.hero.pos, 0.06));
      ring.scale.setScalar(1 + Math.sin(ph + k * 12) * 0.06);
      (ring.material as THREE.MeshBasicMaterial).opacity = Math.min(0.8, k * 8, (1 - k) * 4);
      spin += dt * 3 * dir;
      // thick tongues of flame all along the ring
      if (rnd() < 0.9) { const a = rnd() * 6.28; A.fx.fireCubes(at1(A, A.hero.pos.clone().add(_v.set(Math.sin(a) * r, 0, Math.cos(a) * r)), 0.3), 0.25, 2, [c.b, new THREE.Color(3.4, 1.6, 0.25), new THREE.Color(3, 0.5, 0.2)], 0.24 + rnd() * 0.12, true, [0.35, 0.6]); }
      for (let i = 0; i < 3; i++) {
        const a = spin + (i / 3) * Math.PI * 2 + rnd() * 0.4;
        const p = A.hero.pos.clone().add(_v.set(Math.sin(a) * r, 0.2, Math.cos(a) * r)).setY(A.ground + 0.2);
        A.fx.particle({ pos: p, vel: new THREE.Vector3(R(0.3), 1.6 + rnd(), R(0.3)), life: 0.5, size: 0.1, color: rnd() < 0.6 ? c.b : c.a, gravity: -1 });
      }
    });
    A.repeat(8, 0.3, () => {
      const hit = A.near(A.hero.pos, r + 0.3);
      for (const t of hit) { A.hurt(t, part(c.dmg * 0.2), A.hero.pos, 0.3); A.fx.fireCubes(at1(A, t.pos, 0.8), 0.3, 3, [c.b, new THREE.Color(3.4, 2.4, 0.5)], 0.18); }
      A.heal(pct(A, 0.015));
      A.fx.burst(at1(A, A.hero.pos, 1.2), [c.a, new THREE.Color(3.4, 1.4, 1.8)], 3, { speed: 0.6, up: 1.6, size: 0.07, life: 0.6, glow: true, gravity: -1 });
    });
    A.sound('boom');
  },
  harvest(A, c) {
    const hit = A.near(c.at, 4);
    A.fx.ring(at1(A, c.at, 0.06), 4, c.a, 0.45, 0.18);
    A.fx.ring(at1(A, c.at, 0.06), 3, c.b, 0.35, 0.14);
    for (const t of hit) {
      A.hurt(t, part(c.dmg * 0.4), c.at, 0.2);
      A.orbs(at1(A, t.pos, 1), c.a, 2);
      A.orbs(at1(A, t.pos, 1.2), c.b, 2);
    }
    if (hit.length) { A.heal(pct(A, 0.02) * hit.length); A.souls(2 * hit.length); }
    A.sound('souls');
  },
  bloodBolt(A, c) {
    const ts = A.nearest(c.at, 5, 3);
    ts.forEach((t, i) => A.later(i * 0.1, () => {
      if (!t.alive) return;
      A.skyBolt(t.pos.clone().setY(A.ground), mix(c.a, c.b, 0.3), 0.14);
      A.hurt(t, part(c.dmg * 0.7), t.pos, 0.6);
      A.orbs(at1(A, t.pos, 1), c.a, 2);
      A.heal(pct(A, 0.03));
    }));
    if (ts.length) A.sound('zap');
  },

  // ---------- knockback ----------
  tornado(A, c) {
    const g = new THREE.Group(), mats: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 5; i++) {
      const r = 0.35 + i * 0.22;
      const mat = glowMat(mix(c.a, c.b, i / 4, 0.4), 0.7);
      mats.push(mat);
      const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.75, r, 20, 1, 0, Math.PI * 1.5).rotateX(-Math.PI / 2), mat);
      m.position.y = i * 0.45;
      g.add(m);
    }
    // the twister wanders on its own: snakes along with its own frequency and drift to the side
    const yaw = c.yaw + R(0.5), fwd = A.dir(yaw), side = new THREE.Vector3(fwd.z, 0, -fwd.x), p0 = A.hero.pos.clone().addScaledVector(fwd, 1);
    const amp = 1 + rnd() * 1.2, fq = 1.5 + rnd() * 2, ph = rnd() * 6.28, far = 7 + rnd() * 4, drift = R(3);
    const cd = new Map<Target, number>();
    A.fx.streak({ path: (k, out) => out.copy(p0).addScaledVector(fwd, k * far).addScaledVector(side, Math.sin(ph + k * fq * 6.28) * amp * Math.min(1, k * 3) + drift * k).setY(A.ground + 0.2), dur: 2.2, color: c.a.clone().multiplyScalar(0.7), width: 1.2, tail: 0.5, halo: 1.6 });
    A.body(g, 2.2, (k, dt) => {
      const p = p0.clone().addScaledVector(fwd, k * far).addScaledVector(side, Math.sin(ph + k * fq * 6.28) * amp * Math.min(1, k * 3) + drift * k);
      g.rotation.z = Math.sin(ph + k * 11) * 0.15;
      g.position.copy(at1(A, p, 0.05));
      g.children.forEach((m, i) => { m.rotation.y += dt * (9 + i * 2); });
      for (const m of mats) m.opacity = Math.min(0.7, k * 8, (1 - k) * 5);
      if (rnd() < 0.7) A.swirl(at1(A, p, rnd() * 2), c.a, 0.8, 1);
      for (const [t, v] of cd) cd.set(t, v - dt);
      for (const t of A.near(p, 1.6)) {
        if ((cd.get(t) ?? 0) > 0) continue;
        cd.set(t, 0.25);
        const tang = new THREE.Vector3(-(t.pos.z - p.z), 0, t.pos.x - p.x).normalize().add(fwd).normalize();
        A.hit(t, part(c.dmg * 0.15), tang, 1.2);
      }
    });
    A.sound('horn');
  },
  flameRam(A, c) {
    const h = A.hero.pos;
    A.fx.spray(at1(A, h, 0.9), A.dir(c.yaw), [c.b, new THREE.Color(3.4, 2.4, 0.5), c.a], 40, { speed: 9 + rnd() * 3, spread: 0.4 + rnd() * 0.3, life: 0.4, size: 0.1, gravity: -1 });
    // tongues of flame: each along its own arc
    for (let i = 0; i < 5; i++) A.fx.streak({ path: A.curve(at1(A, h, 0.9), at1(A, h.clone().addScaledVector(A.dir(c.yaw + R(1)), 3.5 + rnd() * 1.5), 0.6 + rnd() * 0.6), 0.25, 0.2, 0.08), dur: 0.25 + rnd() * 0.1, color: c.b.clone().multiplyScalar(1.2), color2: c.a, width: 0.4, tail: 0.25, halo: 2.2, core: 0.25 });
    for (let i = 1; i <= 4; i++) A.later(i * 0.04, () => A.fx.fireCubes(at1(A, h.clone().addScaledVector(A.dir(c.yaw), i * 1.1), 0.7), 0.3 + i * 0.15, 4, [c.b, new THREE.Color(3.4, 2.4, 0.5)], 0.22));
    for (const t of inCone(A, c.yaw, 4.5, 0.6)) {
      A.hurt(t, part(c.dmg * 0.7), h, 2.5);
      dot(A, t, 3, 0.4, part(c.dmg * 0.12), (t) => A.fx.burst(at1(A, t.pos, 1), [c.b, new THREE.Color(3.4, 2.4, 0.6)], 4, { speed: 1, up: 2, size: 0.07, life: 0.5, glow: true, gravity: -1 }));
    }
    A.sound('boom');
  },
  spiritFist(A, c) {
    const g = new THREE.Group(), col = mix(c.a, c.b, 0.6, 0.7);
    const palm = glowCube(col, 0.55, 0.9);
    g.add(palm);
    for (let i = 0; i < 4; i++) { const f = glowCube(col, 0.16, 0.9); f.position.set(-0.21 + i * 0.14, 0.12, 0.34); g.add(f); }
    const thumb = glowCube(col, 0.16, 0.9); thumb.position.set(0.32, -0.08, 0.15); g.add(thumb);
    const fwd = A.dir(c.yaw), p0 = A.hero.pos.clone().addScaledVector(fwd, 0.8);
    // the fist flies along its own arc — now bending, now going straighter
    const path = A.curve(p0, p0.clone().addScaledVector(fwd, 7), 0.25, 0, 0.04), q = new THREE.Vector3(), q0 = new THREE.Vector3();
    A.fx.streak({ path: (k, out) => path(k, out).setY(A.ground + 1), dur: 0.6, color: col.clone().multiplyScalar(1.3), width: 0.6, tail: 0.3, halo: 2 });
    let done = false;
    A.body(g, 0.6, (k) => {
      if (done) return;
      const p = path(k, q).clone();
      path(Math.max(0, k - 0.03), q0);
      g.rotation.y = Math.atan2(p.x - q0.x, p.z - q0.z) || c.yaw;
      g.position.copy(at1(A, p, 1));
      A.fx.particle({ pos: g.position.clone().add(_v.set(R(0.5), R(0.5), R(0.5))), vel: fwd.clone().multiplyScalar(-3), life: 0.3, size: 0.08, color: c.b, gravity: 0 });
      if (A.near(p, 0.9).length || k > 0.97) {
        done = true; g.visible = false;
        boom(A, p, 2, c.b, c.a);
        const hit = A.area(p, 2, Math.round(c.dmg * 0.9), 4);
        A.souls(hit.length);
        for (const t of hit) A.orbs(at1(A, t.pos, 1), c.b, 1);
        A.sound('boom');
      }
    });
  },
  thunderclap(A, c) {
    A.skyBolt(c.at.clone(), c.b, 0.22);
    A.later(0.05, () => {
      A.fx.ring(at1(A, c.at, 0.06), 3.5, c.a, 0.45, 0.25);
      A.fx.ring(at1(A, c.at, 0.06), 2.4, c.b, 0.35, 0.2);
      A.fx.burst(at1(A, c.at, 0.1), ['#d8cfa8', '#b9ad88'], 16, { speed: 5, up: 2, size: 0.12, life: 0.5, gravity: 6 });
      A.area(c.at, 3.5, Math.round(c.dmg * 0.9), 3.5);
      A.fx.shake = Math.max(A.fx.shake, 0.8);
      A.sound('boom');
    });
    A.sound('zap');
  },

  // ---------- whirlwind ----------
  fireTornado(A, c) {
    let a = rnd() * 6.28;
    const dir = rnd() < 0.5 ? -1 : 1;
    // four streams of fire circle the hero at different heights and radii
    for (let i = 0; i < 4; i++) {
      const r0 = 1.1 + rnd() * 1, h0 = 0.3 + rnd() * 1.1, sp = (6 + rnd() * 3) * dir, ph = rnd() * 6.28;
      A.fx.streak({ path: (k, out) => { const an = ph + k * 2 * sp; return out.set(A.hero.pos.x + Math.sin(an) * r0, A.ground + h0 + Math.sin(k * 15 + i) * 0.25, A.hero.pos.z + Math.cos(an) * r0); }, dur: 2, color: i % 2 ? c.b.clone().multiplyScalar(1.1) : c.a, color2: c.b, width: 0.3, tail: 0.25, halo: 2.4, core: 0.25 });
    }
    A.ent(2, (dt) => {
      a += dt * 7 * dir;
      for (let i = 0; i < 4; i++) {
        const ang = a + (i / 4) * Math.PI * 2, r = 1.2 + (i % 2) * 0.8;
        const p = A.hero.pos.clone().add(_v.set(Math.sin(ang) * r, 0, Math.cos(ang) * r)).setY(A.ground + 0.3 + (i % 2) * 0.6);
        A.fx.particle({ pos: p, vel: new THREE.Vector3(Math.cos(ang) * 3, 1.5, -Math.sin(ang) * 3), life: 0.4, size: 0.12, color: i % 2 ? c.b : c.a, gravity: -1 });
      }
      if (rnd() < dt * 8) A.fx.fireCubes(at1(A, A.hero.pos.clone().add(_v.set(R(3), 0, R(3))), 0.5), 0.3, 2, [c.b, new THREE.Color(3.4, 2.4, 0.5)], 0.2);
    });
    A.repeat(8, 0.25, () => { for (const t of A.near(A.hero.pos, 2.4)) A.hurt(t, part(c.dmg * 0.18), A.hero.pos, 0.4); });
    A.sound('boom');
  },
  soulWheel(A, c) {
    const wisps = [0, 1, 2, 3, 4, 5].map((i) => glowCube(i % 2 ? c.b : c.a, 0.18));
    const taken = new Set<Target>();
    const dir = rnd() < 0.5 ? -1 : 1, rad = 1.3 + rnd() * 0.5;
    wisps.forEach((m, i) => {
      let target: Target | null = null, from: THREE.Vector3 | null = null, fly: ((k: number, out: THREE.Vector3) => THREE.Vector3) | null = null;
      m.position.copy(at1(A, A.hero.pos.clone().add(_v.set(Math.sin((i / 6) * Math.PI * 2) * rad, 0, Math.cos((i / 6) * Math.PI * 2) * rad))));
      A.fx.streak({ path: (_k, out) => out.copy(m.position), dur: 1.6, color: i % 2 ? c.b : c.a, width: 0.14, tail: 0.25 });
      A.body(m, 1.6, (k) => {
        const a = (i / 6) * Math.PI * 2 + k * 9 * dir;
        if (k < 0.6) {
          m.position.copy(at1(A, A.hero.pos.clone().add(_v.set(Math.sin(a) * rad, 0, Math.cos(a) * rad)), 1 + Math.sin(k * 12 + i) * 0.2));
          return;
        }
        if (!from) { from = m.position.clone(); [target] = A.nearest(A.hero.pos, 7, 1, taken); if (target) { taken.add(target); const tg = target; fly = A.curve(from, () => at1(A, tg.pos, 1), 0.5, 0.4, 0.05); } }
        if (!target || !fly) { m.scale.setScalar(0.18 * (1 - (k - 0.6) / 0.4)); return; }
        const q = (k - 0.6) / 0.4;
        fly(Math.min(1, q * 2.5), m.position);
        A.fx.particle({ pos: m.position.clone(), life: 0.25, size: 0.07, color: c.b, gravity: 0 });
        if (q * 2.5 >= 1 && m.visible) {
          m.visible = false;
          if (target.alive) { A.hurt(target, part(c.dmg * 0.4), A.hero.pos, 0.5); A.souls(1); A.fx.flash(m.position.clone(), c.b.clone(), 1.4, 0.15); }
        }
      });
    });
    A.sound('souls');
  },
  stormRing(A, c) {
    const a0 = rnd() * 6.28, dir = rnd() < 0.5 ? -1 : 1, n = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) A.later(i * (0.07 + rnd() * 0.06), () => {
      const a = a0 + dir * (i / n) * Math.PI * 2 + R(0.3), r = 2.1 + rnd() * 1;
      const p = A.hero.pos.clone().add(_v.set(Math.sin(a) * r, 0, Math.cos(a) * r)).setY(A.ground);
      A.skyBolt(p, i % 2 ? c.b : c.a, 0.12);
      A.area(p, 1.3, part(c.dmg * 0.4), 1);
      A.swirl(at1(A, p, 0.3), c.a, 0.6, 5);
    });
    A.sound('zap');
  },

  // ---------- fire ----------
  blueFlame(A, c) {
    const blue = [new THREE.Color(0.4, 1.8, 3.4), new THREE.Color(1.2, 2.8, 3.4), c.b];
    const victims = new Set([...c.hits, ...A.near(c.at, 2)]);
    for (const t of victims) dot(A, t, 5, 0.4, part(c.dmg * 0.25), (t, i) => {
      A.fx.fireCubes(at1(A, t.pos, 0.8), 0.35, 4, blue, 0.2);
      if (i % 2 === 0) { A.souls(1); A.orbs(at1(A, t.pos, 1.2), c.b, 1, 0.8); }
    });
    A.fx.fireCubes(at1(A, c.at, 0.5), 1.5, 14, blue, 0.26);
    A.sound('souls');
  },
  meteor(A, c) {
    const [t0] = A.nearest(c.at, 3, 1);
    const p = (t0 ? t0.pos : c.at).clone().setY(A.ground);
    const m = new THREE.Group();
    m.add(glowCube(c.a, 0.8, 0.95), glowCube(new THREE.Color(3.4, 2.4, 0.6), 0.55));
    // comes from a different side of the sky every time, with a thick fiery tail
    const from = p.clone().add(A.dir(rnd() * 6.28).multiplyScalar(2 + rnd() * 4)).setY(A.ground + 10 + rnd() * 4);
    m.position.copy(from);
    A.fx.streak({ path: (_k, out) => out.copy(m.position), dur: 0.45, color: new THREE.Color(3.4, 2.2, 0.5), color2: c.a, width: 0.9, tail: 0.35, halo: 2.2, core: 0.25 });
    // circle on the ground: where it will land
    A.fx.ring(at1(A, p, 0.06), 3, c.a, 0.45, 0.06);
    A.body(m, 0.45, (k) => {
      m.position.copy(from).lerp(at1(A, p, 0.4), k * k);
      m.rotation.set(k * 7, k * 5, 0);
      for (let i = 0; i < 3; i++) A.fx.particle({ pos: m.position.clone().add(_v.set(R(0.6), R(0.6), R(0.6))), vel: new THREE.Vector3(R(1), 2, R(1)), life: 0.45, size: 0.14, color: rnd() < 0.5 ? c.a : new THREE.Color(3.4, 2.4, 0.6), gravity: -1 });
    }, () => {
      boom(A, p, 3, c.a, c.b);
      A.skyBolt(p, c.b, 0.1);
      A.fx.screenFlash('#ff8a3a', 0.2, 0.2);
      A.fx.burst(at1(A, p, 0.2), ['#5e5148', '#8a8f99', '#3a3430'], 14, { speed: 4, up: 6, size: 0.2, life: 1, gravity: 14 });
      A.area(p, 3, Math.round(c.dmg * 1.4), 2.5);
      A.blast(p, 3, c.dmg);
      A.fx.shake = Math.max(A.fx.shake, 1);
      A.sound('boom');
    });
  },

  // ---------- souls ----------
  spiritChain(A, c) {
    A.chain(c.at, 6, 5, mix(c.a, c.b, 0.4), part(c.dmg * 0.45), (t) => { A.souls(1); A.orbs(at1(A, t.pos, 1), c.a, 1); });
  },
};
