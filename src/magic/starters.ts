import * as THREE from 'three';
import { rnd } from '../rng.ts';
import type { ArtifactStats, StarterSpellKind } from '../items.ts';
import { additiveSprite, glowTex, lightBeam } from '../loot-look.ts';
import { spellSfx } from '../spell-audio.ts';
import type { Spells } from '../spells.ts';
import type { Target } from '../target.ts';
import { C, rand, type Spell } from './kit.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Starter spells (wiki/design-spells.md, section 2): spark, fireball, ice rain, heal — every hero has them from the start.
 * Each school is named after its spell; the charge has its own picture (sparks in the hand, a growing ball), heal targets self.
 * Cast anatomy as everywhere — windup, hit (impact), aftertaste.
 */

const PINK = C(3.8, 1, 1.8);
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const ICICLE = new THREE.ConeGeometry(0.13, 1.1, 4);
ICICLE.rotateX(Math.PI); // point down
const icicleMat = new THREE.MeshBasicMaterial({ color: C(1.5, 2.6, 3.4), transparent: true, opacity: 0.92, toneMapped: false });
const _v = new THREE.Vector3();

// ---------- spark ----------

function spark(kit: Spells, a: ArtifactStats, dmg: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('spark');
  const p = kit.ground(at, a.radius ?? 12);
  const first = kit.nearest(p, 2.5);
  const hitAt = first ? first.pos.clone() : p;
  kit.face(hitAt);
  // windup: sparks in the hand, light gathers in the sky above the target and sparkles pour down
  kit.windup('spark', k);
  spellSfx.sparkGather();
  const sky = hitAt.clone().setY(hitAt.y + 11);
  for (let i = 0; i < 10; i++) fx.particle({ pos: hitAt.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(4, 7), rand(-0.6, 0.6))), vel: new THREE.Vector3(0, -30, 0), life: rand(0.12, 0.2), size: 0.06, color: s.b, gravity: 0, shrink: false });
  fx.flash(sky.clone().setY(sky.y - 4), s.a, 3, 0.2);
  kit.later(0.14, () => {
    // hit: lightning from the sky, flare, thunderclap
    const top = hitAt.clone().setY(hitAt.y + (first ? 1 : 0.05));
    kit.bolt(sky, top, s.a, 0.13 + k * 0.08, 3 + Math.round(k * 3), 0.35 + k * 0.1);
    kit.bolt(sky.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0.5))), top, s.a, 0.04, 1, 0.25);
    kit.impact('spark', hitAt, k, 14, 0.45);
    fx.flash(top, s.b.clone().multiplyScalar(0.8), 2.2 + k, 0.22);
    fx.shock(hitAt.clone().setY(hitAt.y + 0.05), 2.2 + k * 1.8, s.a, 0.35, 0.18);
    fx.burst(top, [s.a, s.b], 22 + Math.round(k * 20), { speed: 6 + k * 4, up: 4, size: 0.06, life: 0.45, glow: true, gravity: 8 });
    spellSfx.sparkStrike(k);
    fx.decal(hitAt, kit.tex.scorch(), '#ffffff', 1.8 + k, 3, false, 0.7);
    fx.decal(hitAt, glowTex(), s.a.clone().multiplyScalar(0.3), 2.2 + k, 0.9, true);
    if (first) kit.h.damage(first, Math.round(dmg), kit.h.hero.pos, 0.8 + k);
    // chain jumps: each next one a bit later, weaker and higher in pitch
    const hit = new Set<Target>(first ? [first] : []);
    let prev = first, n = 0;
    const jumps = first ? 2 + Math.round(k * 3) : 0;
    const chain = (): void => {
      if (!prev || n >= jumps) return;
      const next = kit.nearest(prev.pos, 5.5, hit);
      if (!next) return;
      const from = prev.pos.clone().setY(prev.pos.y + 1), to = next.pos.clone().setY(next.pos.y + 1);
      kit.bolt(from, to, s.a, 0.05 + k * 0.03, 1, 0.28);
      fx.flash(to, s.b.clone().multiplyScalar(1.5), 2, 0.2);
      fx.burst(to, [s.a, s.b], 10, { speed: 4, up: 2, size: 0.05, life: 0.35, glow: true, gravity: 6 });
      spellSfx.sparkChain(n);
      hit.add(next);
      kit.h.damage(next, Math.round(dmg * Math.pow(0.8, n + 1)), prev.pos, 0.5);
      prev = next; n++;
      kit.later(0.08, chain);
    };
    kit.later(0.08, chain);
    // aftertaste: sparks crawl over the target for another second
    let left = 1 + k * 0.6;
    kit.proc((dt) => {
      left -= dt;
      if (rnd() < 0.5) {
        const c = (first?.alive ? first.pos : hitAt).clone().setY(hitAt.y + rand(0.1, 1.6));
        const e = c.clone().add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.4, 0.4), rand(-0.5, 0.5)));
        if (rnd() < 0.3) kit.bolt(c, e, s.a, 0.02, 0, 0.08);
        fx.particle({ pos: c, vel: new THREE.Vector3(rand(-2, 2), rand(1, 3), rand(-2, 2)), life: 0.25, size: 0.04, color: s.b, gravity: 6 });
      }
      return left > 0;
    });
  });
}

// ---------- fireball ----------

function fireball(kit: Spells, a: ArtifactStats, dmg: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('fireball'), hero = kit.h.hero;
  const size = 0.32 + k * 0.45, R = (a.radius ?? 2.2) + k * 1.8;
  kit.face(at);
  kit.windup('fireball', k);
  spellSfx.fireLaunch(k);
  // voxel ball: white core inside an orange shell, halo and light fly along
  const g = new THREE.Group();
  const core = new THREE.Mesh(UNIT, new THREE.MeshBasicMaterial({ color: C(4, 3.4, 1.6), toneMapped: false }));
  const shell = new THREE.Mesh(UNIT, new THREE.MeshBasicMaterial({ color: C(3, 1, 0.2), toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  core.scale.setScalar(size); shell.scale.setScalar(size * 1.6);
  const halo = new THREE.Sprite(additiveSprite(glowTex(), s.a.clone().multiplyScalar(0.3)));
  halo.scale.setScalar(size * 4);
  g.add(core, shell, halo);
  const start = kit.hand();
  g.position.copy(start);
  kit.h.scene.add(g);
  const light = fx.light(start, s.css, 5 + k * 4, 6, 3);
  const flat = new THREE.Vector3(at.x - hero.pos.x, 0, at.z - hero.pos.z);
  const dist = Math.max(2, Math.min(16, flat.length()));
  const dir = flat.lengthSq() > 0.01 ? flat.normalize() : new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
  const speed = 15 - k * 3;
  let traveled = 0, done = false;
  const explode = (p: THREE.Vector3): void => {
    done = true;
    kit.h.scene.remove(g);
    core.material.dispose(); shell.material.dispose(); halo.material.dispose();
    light.intensity = 0;
    const y = kit.h.terrain.floorAt(p.x, p.z, p.y + 0.5);
    const c = p.clone().setY(Number.isFinite(y) ? y : hero.pos.y);
    fireBoom(kit, c, R, dmg, k);
  };
  kit.proc((dt) => {
    if (done) return false;
    const prev = g.position.clone();
    const step = speed * dt;
    traveled += step;
    g.position.addScaledVector(dir, step);
    core.rotation.x += dt * 9; core.rotation.y += dt * 7;
    shell.rotation.x -= dt * 5; shell.rotation.z += dt * 6;
    shell.scale.setScalar(size * (1.5 + Math.sin(kit.time * 40) * 0.15));
    light.position.copy(g.position); light.intensity = 5 + k * 4;
    // tail: embers and sparks
    for (let i = 0; i < 3 + k * 3; i++) fx.particle({ pos: g.position.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(size * 0.6)), vel: dir.clone().multiplyScalar(-rand(1, 3)).add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.4, 1.6), rand(-0.6, 0.6))), life: rand(0.25, 0.5), size: size * rand(0.25, 0.45), color: rnd() < 0.5 ? s.a : s.b, gravity: -2 });
    if (rnd() < 0.3) fx.flash(prev, s.a, size * 4, 0.15);
    // hit a target, ran into a wall or reached the end
    for (const t of kit.h.targets()) if (t.alive && Math.hypot(t.pos.x - g.position.x, t.pos.z - g.position.z) < t.radius + size) { explode(g.position); return false; }
    const wall = kit.h.terrain.wallHit(prev.x, prev.z, g.position.x, g.position.z, g.position.y - 0.4);
    if (wall) { explode(new THREE.Vector3(wall.x, g.position.y, wall.z)); return false; }
    if (traveled >= dist) { explode(g.position); return false; }
    return true;
  });
}

function fireBoom(kit: Spells, c: THREE.Vector3, R: number, dmg: number, k: number): void {
  const fx = kit.h.fx, s = kit.color('fireball');
  const mid = c.clone().setY(c.y + 0.8);
  kit.impact('fireball', c, k, 18, 0.6);
  spellSfx.fireBoom(k);
  fx.flash(mid, s.b.clone().multiplyScalar(0.5), Math.min(6, R * 1.5), 0.3);
  for (let i = 0; i < 5; i++) fx.flash(mid.clone().add(new THREE.Vector3(rand(-R, R) * 0.5, rand(0, R * 0.5), rand(-R, R) * 0.5)), (i % 2 ? s.a : s.b).clone().multiplyScalar(0.5), R * rand(0.5, 0.8), rand(0.3, 0.45));
  // fire cubes fly out from the centre, swell and go out
  fx.fireCubes(mid, R, 10 + Math.round(k * 10), [s.a.clone().multiplyScalar(0.8), s.b.clone().multiplyScalar(0.8)], 0.25 + R * 0.18);
  fx.burst(mid, [s.a, s.b, C(4, 3.6, 2.4)], 30 + Math.round(k * 30), { speed: R * 3, up: R * 1.6, size: 0.08, life: 0.7, glow: true, gravity: 5 });
  fx.shock(c, R * 1.1, s.a, 0.4, 0.25);
  fx.shock(c, R * 0.7, s.b, 0.3, 0.18);
  kit.h.aoe(c, R, dmg, 1.8 + k * 1.8, true);
  // aftertaste: a scorched spot, smouldering light, islands of fire and embers for a couple more seconds
  fx.decal(c, kit.tex.scorch(), '#ffffff', R * 2.3, 4.5, false, 0.75);
  fx.decal(c, glowTex(), s.a.clone().multiplyScalar(0.3), R * 1.8, 2, true);
  const spots = Array.from({ length: 3 + Math.round(k * 4) }, () => c.clone().add(new THREE.Vector3(rand(-R, R) * 0.6, 0.05, rand(-R, R) * 0.6)));
  let left = 2.2 + k;
  kit.proc((dt) => {
    left -= dt;
    for (const p of spots) if (rnd() < 0.35 * Math.min(1, left)) fx.particle({ pos: p.clone().add(new THREE.Vector3(rand(-0.2, 0.2), 0, rand(-0.2, 0.2))), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1, 2.2), rand(-0.2, 0.2)), life: rand(0.3, 0.6), size: rand(0.06, 0.12), color: rnd() < 0.6 ? s.a : s.b, gravity: -1.5 });
    return left > 0;
  });
}

// ---------- ice rain ----------

function icerain(kit: Spells, a: ArtifactStats, dmg: number, at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('icerain');
  const c = kit.ground(at, 12);
  const R = (a.radius ?? 3) + k * 2, dur = a.duration ?? 2, count = 14 + Math.round(k * 20), tele = 0.45;
  kit.face(c);
  kit.windup('icerain', k);
  spellSfx.iceCall();
  // windup: a frosty rune circle opens at the impact point during the windup, holds through the rain and spreads at the end;
  // mist rises upward, frost swirls high above
  kit.groundSigil('icerain', c, R, tele, dur, 0.3);
  let tele0 = tele;
  kit.proc((dt) => {
    tele0 -= dt;
    for (let i = 0; i < 3; i++) {
      const a2 = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a2) * r, 0.1, Math.sin(a2) * r)), vel: new THREE.Vector3(0, rand(0.6, 1.4), 0), life: 0.6, size: 0.07, color: s.b, gravity: -0.5 });
      const a3 = kit.time * 4 + rnd() * Math.PI * 2;
      fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a3) * R * 0.8, 7.5, Math.sin(a3) * R * 0.8)), vel: new THREE.Vector3(-Math.sin(a3) * 5, 0, Math.cos(a3) * 5), life: 0.4, size: 0.1, color: s.a, gravity: 0 });
    }
    return tele0 > 0;
  });
  kit.later(tele, () => {
    // hit: the first wave of icicles all at once, a crystal chord
    kit.impact('icerain', c, k, 10, 0.4);
    spellSfx.iceImpact(k);
    fx.shock(c, R * 1.15, s.a, 0.45, 0.2);
    fx.flash(c.clone().setY(c.y + 1), s.b.clone().multiplyScalar(0.5), R * 1.2, 0.3);
    for (let i = 0; i < 6; i++) icicle(kit, c, R, 0);
    for (let i = 0; i < count; i++) icicle(kit, c, R, rand(0.05, dur));
    // damage in waves
    const ticks = Math.max(1, Math.round(dur / 0.4));
    for (let i = 0; i < ticks; i++) kit.later(0.25 + i * 0.4, () => kit.h.aoe(c, R, Math.round(dmg), 0.25, false));
    // aftertaste: frost on the ground and creeping cold fog
    fx.decal(c, kit.tex.frost(), s.a.clone().multiplyScalar(0.2), R * 2.4, dur + 3, true, 0.8);
    let left = dur + 1.5;
    kit.proc((dt) => {
      left -= dt;
      if (rnd() < 0.7) {
        const a2 = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
        fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a2) * r, 0.15, Math.sin(a2) * r)), vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0.1, 0.4), rand(-0.4, 0.4)), life: 1.1, size: rand(0.1, 0.18), color: s.b.clone().multiplyScalar(0.5), gravity: -0.1, drag: 1 });
      }
      return left > 0;
    });
  });
}

/** An icicle falls from the sky onto a random point of the circle and shatters */
function icicle(kit: Spells, c: THREE.Vector3, R: number, delay: number): void {
  kit.later(delay, () => {
    const fx = kit.h.fx, s = kit.color('icerain');
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
    const p = c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    const m = new THREE.Mesh(ICICLE, icicleMat);
    const sc = rand(0.8, 1.5);
    m.scale.setScalar(sc);
    m.rotation.y = rnd() * Math.PI;
    const fall = 0.28, top = 9;
    let landed = false;
    fx.custom(m, fall + 0.6, (t) => {
      const tt = t * (fall + 0.6);
      if (tt < fall) { m.position.set(p.x, p.y + 0.5 * sc + top * (1 - tt / fall) ** 1.6, p.z); return; }
      if (!landed) {
        landed = true;
        fx.burst(p.clone().setY(p.y + 0.15), [s.a, s.b], 6, { speed: 3, up: 3, size: 0.06, life: 0.4, glow: true, gravity: 12 });
        fx.burst(p.clone().setY(p.y + 0.15), ['#e8f8ff', '#bfe6ff'], 3, { speed: 2.5, up: 3, size: 0.08, life: 0.6 });
        fx.flash(p.clone().setY(p.y + 0.3), s.b, 0.9, 0.15);
        spellSfx.iceShard();
      }
      // stuck in and sinks into the ground
      const e = (tt - fall) / 0.6;
      m.position.set(p.x, p.y + 0.5 * sc - e * 0.9 * sc, p.z);
    }, () => { /* shared shape and material */ });
  });
}

// ---------- heal ----------

function heal(kit: Spells, amount: number, k: number): void {
  const fx = kit.h.fx, s = kit.color('heal'), hero = kit.h.hero;
  // windup: raspberry leaves and petals spiral in toward the hero
  kit.windup('heal', k);
  const at = (): THREE.Vector3 => hero.pos.clone();
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, r = 2.2, life = 0.22;
    const from = at().add(new THREE.Vector3(Math.cos(a) * r, rand(0.2, 1.6), Math.sin(a) * r));
    const to = at().setY(hero.pos.y + 1);
    const v = to.sub(from).divideScalar(life).add(new THREE.Vector3(-Math.sin(a) * 4, 0, Math.cos(a) * 4));
    fx.particle({ pos: from, vel: v, life, size: 0.08, color: i % 3 === 0 ? PINK : s.a, gravity: 0, shrink: false });
  }
  kit.later(0.22, () => {
    const c = at();
    kit.impact('heal', c, k, 8, 0.15);
    spellSfx.healCast(k);
    const before = hero.hp;
    hero.hp = Math.min(hero.maxHp, hero.hp + amount);
    fx.text(c.clone().setY(c.y + 0.8), `+${Math.round(hero.hp - before)}`, 'healbig');
    // pillar of light, rings and petals upward
    const beam = lightBeam(s.a.clone().lerp(s.b, 0.3).multiplyScalar(0.55), 7, 1.6 + k * 1.2);
    beam.group.position.copy(c);
    fx.custom(beam.group, 1.3 + k * 0.4, (t) => {
      beam.group.position.copy(hero.pos);
      beam.group.scale.set(1 - t * 0.6, Math.min(1, t * 8), 1 - t * 0.6);
      beam.mats.forEach((m) => { m.opacity = (1 - t) ** 1.5; });
    }, () => beam.mats.forEach((m) => m.dispose()));
    fx.shock(c.clone().setY(c.y + 0.05), 3 + k * 1.5, s.a, 0.5, 0.15);
    fx.shock(c.clone().setY(c.y + 0.05), 2 + k, s.b, 0.4, 0.1);
    fx.flash(c.clone().setY(c.y + 1), s.a.clone().multiplyScalar(0.6), 2.4 + k, 0.35);
    fx.burst(c.clone().setY(c.y + 0.4), [s.a, s.b, PINK], 26 + Math.round(k * 20), { speed: 2.5, up: 5, size: 0.08, life: 1, glow: true, gravity: 2 });
    fx.decal(c, glowTex(), s.a.clone().multiplyScalar(0.35), 3.5 + k * 2, 2.2, true);
    // aftertaste: petals slowly swirl and fall around the hero
    let left = 2 + k;
    kit.proc((dt) => {
      left -= dt;
      if (rnd() < 0.6 * Math.min(1, left)) {
        const a = rnd() * Math.PI * 2, r = rand(0.3, 1.6);
        _v.set(hero.pos.x + Math.cos(a) * r, hero.pos.y + rand(2, 3), hero.pos.z + Math.sin(a) * r);
        fx.particle({ pos: _v, vel: new THREE.Vector3(rand(-0.5, 0.5), -0.3, rand(-0.5, 0.5)), life: 1.6, size: rand(0.05, 0.08), color: rnd() < 0.5 ? PINK : s.a, gravity: 0.8, drag: 1.5, spin: 4 });
      }
      return left > 0;
    });
  });
}


export const STARTERS: Record<StarterSpellKind, Spell> = {
  spark: {
    school: 'spark', tier: 'common', title: t('Spark'),
    // while charging, lightning runs across the palm
    charging(kit, hand, k) {
      if (rnd() < 0.15 + k * 0.4) kit.bolt(hand, hand.clone().add(new THREE.Vector3(rand(-0.7, 0.7), rand(-0.5, 0.6), rand(-0.7, 0.7))), kit.color('spark').a, 0.025, 0, 0.1);
    },
    cast: spark,
  },
  fireball: {
    school: 'fireball', tier: 'common', title: t('Fireball'),
    // the ball grows right in the palm, embers fly upward
    orb: (k) => 0.5 + k * 1.3,
    charging(kit, hand, k) {
      const s = kit.color('fireball');
      if (rnd() < 0.6) kit.h.fx.particle({ pos: hand.clone(), vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0.8, 1.8), rand(-0.4, 0.4)), life: 0.35, size: 0.07 + k * 0.05, color: rnd() < 0.5 ? s.a : s.b, gravity: -1 });
    },
    cast: fireball,
  },
  icerain: { school: 'icerain', tier: 'common', title: t('Ice rain'), cast: icerain },
  heal: { school: 'heal', tier: 'common', title: t('Minor heal'), self: true, cast: (kit, _a, power, _at, k) => heal(kit, power, k) },
};
