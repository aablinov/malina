import * as THREE from 'three';
import { rnd } from '../rng.ts';
import type { ArtifactStats, RelicSpellKind } from '../items.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import type { Spells } from '../spells.ts';
import type { Target } from '../target.ts';
import { rand, type Spell } from './kit.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Relic spells (wiki/design-spells.md, section "Relics"): ten very strong spells that drop from enemies only (src/sim/drops.ts).
 * All of legendary or mythic pomp: light shafts from the sky (`fx.pillar`), stars of rays on every hit (`fx.shafts`), wide rings
 */

const up = (p: THREE.Vector3, dy: number): THREE.Vector3 => p.clone().setY(p.y + dy);
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const foes = (kit: Spells, c: THREE.Vector3, r: number): Target[] => kit.within(c, r).filter((o) => !o.prop);
const heal = (kit: Spells, v: number): void => { const h = kit.h.hero; if (!h.down) h.hp = Math.min(h.maxHp, h.hp + v); };

/** A roaring cone of fire from the hand for `duration` seconds: eight ticks of damage to everyone in the cone */
function dragonbreath(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('fireball'), R = a.radius ?? 10, dur = a.duration ?? 1.6, half = 0.5;
  const yaw = Math.atan2(at.x - hero.pos.x, at.z - hero.pos.z), dir = V(Math.sin(yaw), 0, Math.cos(yaw));
  kit.face(at, dur);
  kit.windup('fireball', k);
  kit.pomp('legendary', hero.pos, 'fireball');
  boom(70, 30, dur, 0.5);
  let time = 0, tick = 0;
  kit.proc((dt) => {
    time += dt; tick -= dt;
    const from = kit.hand();
    fx.spray(from, dir.clone().setY(0.04), [s.a, s.b, '#ffd060'], 9, { speed: R * 1.7, size: 0.2, life: 0.55, gravity: -1.5, spread: half });
    if (rnd() < 0.6) fx.fireCubes(from.clone().addScaledVector(dir, R * rand(0.25, 0.9)), 1.3, 3, [s.a, s.b], 0.3);
    if (tick > 0) return time < dur;
    tick = dur / 8;
    fx.light(from.clone().addScaledVector(dir, R * 0.4), s.css, 9, 12, 0.3);
    hiss({ dur: 0.3, vol: 0.14, f: 700, f1: 300, q: 0.6, type: 'lowpass' });
    for (const o of kit.within(hero.pos, R)) {
      const dx = o.pos.x - hero.pos.x, dz = o.pos.z - hero.pos.z, d = Math.hypot(dx, dz);
      const off = Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw));
      if (d > 0.8 && Math.abs(off) > half + Math.atan(o.radius / Math.max(d, 0.5))) continue;
      kit.h.damage(o, Math.round(power), hero.pos, 0.3);
      fx.shafts(up(o.pos, 1), s.a, 2, 1.4, 0.07);
    }
    return time < dur;
  });
}

/** A glacier bursts out of the ground at the cursor: heavy damage, everyone inside is frozen solid */
function glacier(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('icerain'), R = a.radius ?? 5.5, c = kit.ground(at, 14), sec = a.duration ?? 2.5;
  kit.face(c);
  kit.windup('icerain', k);
  kit.groundSigil('icerain', c, R, 0.3, 0.2, 0.4);
  hiss({ dur: 0.4, vol: 0.1, f: 2000, f1: 7000, q: 0.8 });
  kit.later(0.35, () => {
    kit.impact('icerain', c, k, 18, 0.7);
    kit.pomp('legendary', c, 'icerain');
    boom(80, 35, 0.8, 0.6);
    hiss({ dur: 0.7, vol: 0.2, f: 6500, f1: 1500, q: 1 });
    fx.decal(c, kit.tex.frost(), s.a.clone().multiplyScalar(0.4), R * 2.2, 5, true);
    fx.ring(up(c, 0.08), R, s.a, 0.5, 0.2, 1.6);
    // ice spires: columns of light and shards thrown up, thicker towards the centre
    for (let i = 0; i < 12; i++) {
      const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R * 0.9, p = c.clone().add(V(Math.cos(ang) * r, 0, Math.sin(ang) * r));
      kit.later(i * 0.025, () => {
        fx.pillar(p, i % 2 ? s.a : s.b, rand(3, 6) * (1 - r / R * 0.5), 0.5);
        fx.burst(up(p, 0.3), [s.a, s.b, '#ffffff'], 8, { speed: 3, up: 7, size: 0.16, life: 0.8, glow: true, gravity: 12 });
      });
    }
    fx.shafts(up(c, 1), s.b, 10, R, 0.14);
    kit.h.aoe(c, R, Math.round(power), 1, true);
    for (const o of foes(kit, c, R)) { o.stun?.(sec); o.chill?.(0.6, sec + 3); }
  });
}

/** The sky splits: fourteen bolts, one after another, each onto a random enemy around the hero */
function worldstorm(kit: Spells, a: ArtifactStats, power: number, _at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('spark'), R = a.radius ?? 11, dur = a.duration ?? 2.4, N = 14;
  kit.windup('spark', k);
  kit.pomp('mythic', hero.pos, 'spark', t('Wrath of the Storm'), dur * 0.6);
  let time = 0, n = 0;
  kit.proc((dt) => {
    time += dt;
    while (n < N && time >= (n / N) * dur) {
      n++;
      const list = foes(kit, hero.pos, R), o = list.length ? list[Math.floor(rnd() * list.length)] : null;
      const ang = rnd() * Math.PI * 2, r = rnd() * R;
      const p = o ? o.pos.clone() : kit.ground(hero.pos.clone().add(V(Math.cos(ang) * r, 0, Math.sin(ang) * r)), R);
      fx.bolt(p.clone().add(V(rand(-2, 2), 16, rand(-2, 2))), up(p, 0.6), s.a, 0.14, 3, 0.25);
      fx.pillar(p, s.b, 14, 0.7);
      fx.shafts(up(p, 0.8), s.a, 5, 2.6, 0.1);
      fx.shock(up(p, 0.08), 2.4, s.a, 0.3, 0.2);
      fx.light(up(p, 1.5), s.css, 12, 12, 0.25);
      fx.shake = Math.max(fx.shake, 0.5);
      boom(rand(90, 150), 40, 0.35, 0.45);
      hiss({ dur: 0.25, vol: 0.16, f: 6000, f1: 900, q: 0.7 });
      if (o) { kit.h.damage(o, Math.round(power), up(p, 6), 0.5); o.stun?.(0.4); }
      kit.h.aoe(p, 2.2, Math.round(power * 0.4), 0.5, true);
    }
    return n < N;
  });
}

/** A star is born at the cursor, swells for a second and explodes */
function supernova(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('star'), R = a.radius ?? 7.5, c = kit.ground(at, 14), core = up(c, 1.6), grow = 0.9;
  kit.face(c);
  kit.windup('star', k);
  kit.pomp('mythic', c, 'star', t('Supernova'), grow + 0.4);
  voice({ type: 'sine', f: 220, f1: 1760, dur: grow, vol: 0.08, attack: grow * 0.8 });
  let time = 0;
  kit.proc((dt) => {
    time += dt;
    const e = Math.min(1, time / grow);
    fx.flash(core, s.b.clone().multiplyScalar(0.5 + e), 0.6 + e * 2.4, 0.08);
    for (let i = 0; i < 3; i++) {
      const d = V(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, R)), life = rand(0.2, 0.35);
      fx.particle({ pos: core.clone().add(d), vel: d.clone().multiplyScalar(-1 / life), life, size: 0.08, color: i % 2 ? s.a : s.b, gravity: 0, shrink: false });
    }
    return time < grow;
  });
  kit.later(grow, () => {
    kit.impact('star', c, 1, 30, 1.2);
    boom(45, 18, 1.4, 0.9);
    hiss({ dur: 1, vol: 0.2, f: 5000, f1: 300, q: 0.6 });
    fx.explosion(core, R, s.b);
    for (let i = 0; i < 3; i++) kit.later(i * 0.09, () => fx.ring(up(c, 0.08), R * (0.6 + i * 0.25), i % 2 ? s.a : s.b, 0.6, 0.18, 2));
    fx.shafts(core, s.b, 16, R * 1.3, 0.2, 0.9);
    fx.pillar(c, s.a, 18, 1.4);
    fx.decal(c, kit.tex.scorch(), '#1a1208', R * 1.6, 8);
    kit.h.aoe(c, R, Math.round(power), 5, true);
  });
}

/** Sixteen souls burst from the hand, arc over the field and each finds an enemy of its own */
function soulstorm(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('void'), R = a.radius ?? 16, N = 16;
  kit.face(at);
  kit.windup('void', k);
  kit.pomp('legendary', hero.pos, 'void');
  const list = foes(kit, hero.pos, R).sort((x, y) => Math.hypot(x.pos.x - at.x, x.pos.z - at.z) - Math.hypot(y.pos.x - at.x, y.pos.z - at.z));
  for (let i = 0; i < N; i++) kit.later(i * 0.05, () => {
    const o = list.length ? list[i % list.length] : null, from = kit.hand();
    const end = o ? up(o.pos, 1) : up(kit.ground(at.clone().add(V(rand(-2, 2), 0, rand(-2, 2))), R), 0.8);
    const side = V(rand(-4, 4), rand(3, 6), rand(-4, 4)), mid = from.clone().lerp(end, 0.4).add(side);
    voice({ type: 'sine', f: rand(500, 900), f1: 200, dur: 0.3, vol: 0.03 });
    fx.streak({
      path: (q, out) => { if (o?.alive) end.copy(o.pos).setY(o.pos.y + 1); const u = 1 - q; return out.set(0, 0, 0).addScaledVector(from, u * u).addScaledVector(mid, 2 * u * q).addScaledVector(end, q * q); },
      dur: rand(0.45, 0.65), color: s.a, color2: s.b, width: 0.16, tail: 0.3, halo: 3, core: 0.7,
      onEnd: (p) => {
        fx.shafts(p, s.a, 4, 1.8, 0.08);
        fx.flash(p, s.a, 1.6, 0.16);
        if (o?.alive) kit.h.damage(o, Math.round(power), hero.pos, 0.4); else kit.h.aoe(p, 1.5, Math.round(power * 0.6), 0.4, false);
      },
    });
  });
}

/** Three waves of broken ground roll out from the hero, each wider than the last */
function earthshatter(kit: Spells, a: ArtifactStats, power: number, _at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('earth'), R = a.radius ?? 10;
  kit.windup('earth', k);
  [0.4, 0.7, 1].forEach((f, i) => kit.later(0.15 + i * 0.3, () => {
    const c = hero.pos.clone(), r = R * f;
    kit.impact('earth', c, k, 10, 0.8 + i * 0.3);
    if (i === 2) kit.pomp('legendary', c, 'earth');
    boom(70 - i * 12, 25, 0.7, 0.6);
    fx.ring(up(c, 0.08), r, i % 2 ? s.b : s.a, 0.5, 0.25, 1.4);
    for (let j = 0; j < 10 + i * 6; j++) {
      const ang = (j / (10 + i * 6)) * Math.PI * 2 + rnd(), p = c.clone().add(V(Math.cos(ang) * r * 0.9, 0.2, Math.sin(ang) * r * 0.9));
      fx.burst(p, ['#8a6a50', '#5e4a3a', '#a89a80'], 5, { speed: 2.5, up: 6, size: 0.2, life: 0.8, gravity: 13 });
      if (j % 3 === 0) fx.pillar(p, s.a, 3, 0.3);
    }
    kit.h.aoe(c, r, Math.round(power), 3.5, true);
    for (const o of foes(kit, c, r)) o.stun?.(0.5);
  }));
}

/** A crimson moon over the cursor: every half second its light burns the enemies below and heals the hero */
function bloodmoon(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('blood'), R = a.radius ?? 6.5, dur = a.duration ?? 6, c = kit.ground(at, 14), moon = up(c, 9);
  kit.face(c);
  kit.windup('blood', k);
  kit.pomp('mythic', c, 'blood', t('Raspberry Moon'), 1);
  kit.groundSigil('blood', c, R, 0.4, dur, 0.35);
  voice({ type: 'sine', f: 110, f1: 82, dur, vol: 0.06, attack: 0.5 });
  let time = 0, tick = 0;
  kit.proc((dt) => {
    time += dt; tick -= dt;
    fx.flash(moon, s.a.clone().multiplyScalar(1.4), 4.5, 0.1);
    if (rnd() < 0.7) { const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R; fx.particle({ pos: moon.clone().add(V(Math.cos(ang) * r * 0.3, 0, Math.sin(ang) * r * 0.3)), vel: V(Math.cos(ang) * r * 0.5, -7, Math.sin(ang) * r * 0.5), life: 1.2, size: 0.07, color: rnd() < 0.5 ? s.a : s.b, gravity: 0 }); }
    if (tick > 0) return time < dur;
    tick = 0.5;
    const hit = foes(kit, c, R);
    for (const o of hit) { fx.pillar(o.pos.clone(), s.a, 8.5, 0.35); kit.h.damage(o, Math.round(power), up(c, 6), 0); }
    if (hit.length) { heal(kit, hero.maxHp * Math.min(0.06, 0.015 * hit.length)); hiss({ dur: 0.2, vol: 0.06, f: 900, f1: 400, q: 1 }); }
    return time < dur;
  });
}

/** Time stands still for every enemy around the hero; while it does, they take half as much damage again */
function timestop(kit: Spells, a: ArtifactStats, power: number, _at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('arcane'), R = a.radius ?? 10, dur = a.duration ?? 4, c = hero.pos.clone();
  kit.windup('arcane', k);
  kit.impact('arcane', c, 1, 16, 0.5);
  kit.pomp('mythic', c, 'arcane', t('Stopped Hour'), dur * 0.5);
  voice({ type: 'triangle', f: 1320, f1: 110, dur: 0.9, vol: 0.08 });
  for (let i = 0; i < 3; i++) kit.later(i * 0.1, () => fx.ring(up(c, 0.08), R * (1 - i * 0.25), i % 2 ? s.b : s.a, 0.7, 0.1, 2));
  const held = foes(kit, c, R);
  for (const o of held) { o.stun?.(dur); o.expose?.(0.5, dur); kit.h.damage(o, Math.round(power), c, 0); fx.shafts(up(o.pos, 1), s.a, 4, 1.6, 0.07); }
  // frozen clock hands: a slow ring of sparks above everyone held
  let time = 0;
  kit.proc((dt) => {
    time += dt;
    for (const o of held) {
      if (!o.alive || rnd() > 0.5) continue;
      const ang = time * 1.2 + rnd() * 0.4, top = o.pos.y + Math.min(2.6, o.topY ?? 1.8) + 0.3;
      fx.particle({ pos: V(o.pos.x + Math.cos(ang) * 0.6, top, o.pos.z + Math.sin(ang) * 0.6), vel: V(0, 0.05, 0), life: 0.35, size: 0.09, color: rnd() < 0.5 ? s.a : s.b, gravity: 0 });
    }
    return time < dur;
  });
}

/** A firebird flies from the hero through the ranks to the cursor and explodes there; its warmth heals the hero */
function phoenix(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('fireball'), R = a.radius ?? 18;
  const from = up(hero.pos, 1.2), end = up(kit.ground(at, R), 1), seen = new Set<Target>();
  kit.face(at);
  kit.windup('fireball', k);
  kit.pomp('legendary', hero.pos, 'fireball');
  heal(kit, hero.maxHp * 0.25);
  fx.pillar(hero.pos.clone(), s.b, 7, 0.8);
  voice({ type: 'sawtooth', f: 660, f1: 1320, dur: 0.5, vol: 0.05, lp: 3000 });
  const wing = (side: number): void => fx.streak({ path: (q, out) => out.lerpVectors(from, end, q).add(V(0, Math.sin(q * Math.PI * 5) * 0.9 * side + 0.6, 0)), dur: 0.55, color: s.b, color2: s.a, width: 0.3, tail: 0.35, halo: 3, core: 0.5 });
  wing(1); wing(-1);
  fx.streak({
    path: (q, out) => out.lerpVectors(from, end, q), dur: 0.55, color: s.a, color2: s.b, width: 0.7, tail: 0.4, halo: 3.4, core: 0.9,
    onHead: (p) => {
      fx.burst(p, [s.a, s.b, '#ffd060'], 3, { speed: 2, up: 1, size: 0.14, life: 0.5, glow: true, gravity: -1 });
      for (const o of kit.within(p, 2)) { if (seen.has(o)) continue; seen.add(o); kit.h.damage(o, Math.round(power), hero.pos, 1.5); fx.shafts(up(o.pos, 1), s.b, 3, 1.8, 0.08); }
    },
    onEnd: (p) => {
      kit.impact('fireball', p, k, 20, 0.9);
      boom(60, 25, 0.9, 0.7);
      fx.explosion(p, 4.5, s.a);
      fx.shafts(p, s.b, 12, 5, 0.16);
      fx.pillar(p.clone().setY(p.y - 1), s.b, 12, 1);
      kit.h.aoe(p, 4.5, Math.round(power * 0.8), 3, true);
    },
  });
}

/** For `duration` seconds the air around the hero is nothing but blades: a cut every 0.2 s to everyone within reach */
function bladestorm(kit: Spells, a: ArtifactStats, power: number, _at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color('arcane'), R = a.radius ?? 5, dur = a.duration ?? 4;
  kit.windup('arcane', k);
  kit.pomp('legendary', hero.pos, 'arcane');
  let time = 0, tick = 0;
  kit.proc((dt) => {
    time += dt; tick -= dt;
    if (tick > 0) return time < dur;
    tick = 0.2;
    const c = hero.pos.clone();
    hiss({ dur: 0.12, vol: 0.09, f: 5200, f1: 2200, q: 2 });
    fx.arc(c, time * 9, s.a.clone().multiplyScalar(0.3), R, 1.4, c.y + rand(0.6, 1.4), 0.86);
    for (let i = 0; i < 4; i++) {
      const ang = rnd() * Math.PI * 2, r = rand(0.5, R * 0.8), p = c.clone().add(V(Math.cos(ang) * r, rand(0.6, 1.6), Math.sin(ang) * r));
      fx.cut(p, V(Math.cos(ang + rand(1, 2.1)), rand(-0.5, 0.5), Math.sin(ang + rand(1, 2.1))).normalize(), rand(2.5, 4.5), i % 2 ? s.a : s.b, 0.1);
    }
    for (const o of kit.within(c, R)) { kit.h.damage(o, Math.round(power), c, 0.2); fx.cut(up(o.pos, 1), V(rand(-1, 1), rand(-0.6, 0.6), rand(-1, 1)).normalize(), 2.4, s.b, 0.09); }
    return time < dur;
  });
}

export const RELICS = {
  dragonbreath: { school: 'fireball', tier: 'legendary', title: t('Dragon Breath'), cast: dragonbreath },
  glacier: { school: 'icerain', tier: 'legendary', title: t('Glacier'), cast: glacier },
  worldstorm: { school: 'spark', tier: 'mythic', title: t('Wrath of the Storm'), self: true, cast: worldstorm },
  supernova: { school: 'star', tier: 'mythic', title: t('Supernova'), cast: supernova },
  soulstorm: { school: 'void', tier: 'legendary', title: t('Storm of Souls'), cast: soulstorm },
  earthshatter: { school: 'earth', tier: 'legendary', title: t('Earthshatter'), self: true, cast: earthshatter },
  bloodmoon: { school: 'blood', tier: 'mythic', title: t('Raspberry Moon'), cast: bloodmoon },
  timestop: { school: 'arcane', tier: 'mythic', title: t('Stopped Hour'), self: true, cast: timestop },
  phoenix: { school: 'fireball', tier: 'legendary', title: t('Phoenix'), cast: phoenix },
  bladestorm: { school: 'arcane', tier: 'legendary', title: t('Thousand Cuts'), self: true, cast: bladestorm },
} satisfies Record<RelicSpellKind, Spell>;
