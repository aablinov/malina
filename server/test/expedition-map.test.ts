import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { OBJECTIVES, type ExpeditionSpec } from '../../src/expedition/types.ts';
import { HeadlessBattle } from '../../src/game/battle.ts';
import { Match } from '../../src/game/match.ts';
import { Profile } from '../../src/items.ts';
import { buildExpedition, EXP_HALF, expeditionMap, levelHash } from '../../src/level/expedition-map.ts';
import { MOBS } from '../../src/mobs/roster.ts';
import { WAKE_R } from '../../src/sim/garrison.ts';
import { loadPrefabs } from '../prefabs.ts';

const LIB = loadPrefabs(join(import.meta.dirname, '..', '..', 'assets', 'prefabs'));
const specOf = (seed: number, difficulty = 3, objective = OBJECTIVES[seed % 3]): ExpeditionSpec => buildExpedition({ seed, difficulty, objective }, LIB).meta.expedition as ExpeditionSpec;

test('expedition map: the same parameters give the same level, another seed — another one', () => {
  const p = { seed: 11, difficulty: 4, objective: 'beacons' as const };
  assert.equal(levelHash(buildExpedition(p, LIB)), levelHash(buildExpedition(p, LIB)));
  assert.notEqual(levelHash(buildExpedition(p, LIB)), levelHash(buildExpedition({ ...p, seed: 12 }, LIB)));
  assert.notEqual(levelHash(buildExpedition(p, LIB)), levelHash(buildExpedition({ ...p, objective: 'bush' }, LIB)));
});

test('expedition map: fifty seeds — every objective is reachable, sites keep their distance, guards are from the roster', () => {
  for (let seed = 1; seed <= 50; seed++) {
    // the generator throws when a landing cannot reach an objective site or the extraction pad
    const s = specOf(seed, 1 + (seed % 8));
    assert.equal(s.landings.length, 3);
    assert.ok(s.lairs.length >= 3 && s.lairs.length <= 5);
    assert.equal(s.lairs.filter((l) => l.size === 3).length, 1, 'one large lair');
    assert.ok(s.pois.length >= 6 && s.pois.length <= 10);
    assert.ok(s.objective.sites.length >= 1);
    const all = [...s.landings, s.extraction, ...s.lairs, ...s.secondary, ...s.pois, ...(s.objective.kind === 'lairs' ? [] : s.objective.sites)];
    for (const a of all) assert.ok(Math.max(Math.abs(a.x), Math.abs(a.z)) <= EXP_HALF - 12, `${a.id} inside the rim`);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z) >= 8, `seed ${seed}: ${all[i].id} and ${all[j].id} overlap`);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(s.landings[i].x - s.landings[j].x, s.landings[i].z - s.landings[j].z) >= 38);
    for (const g of s.garrisons) for (const p of g.posts) assert.ok(MOBS[p.kind], `unknown guard ${p.kind}`);
  }
});

test('expedition map: difficulty adds lairs, guards and rarer seeds', () => {
  const guards = (s: ExpeditionSpec): number => s.garrisons.reduce((n, g) => n + g.posts.length, 0);
  const easy = specOf(7, 1, 'lairs'), hard = specOf(7, 8, 'lairs');
  assert.ok(hard.lairs.length > easy.lairs.length);
  assert.ok(guards(hard) > guards(easy));
  assert.ok(!easy.pois.some((p) => p.seed === 'rare' || p.seed === 'golden'));
  assert.equal(hard.pois.filter((p) => p.seed === 'golden').length, 1);
  assert.ok(hard.pois.some((p) => p.seed === 'rare'));
});

test('garrisons: far from the heroes they sleep and stay out of the snapshot; a hero nearby wakes them, a patrol walks its route', () => {
  const map = expeditionMap({ seed: 5, difficulty: 3, objective: 'lairs' }, LIB);
  const match = new Match({ id: 'e1', map, seed: 5, players: [{ seat: 0, playerId: 'p0', name: 'A', profile: Profile.starter() }] });
  const b: HeadlessBattle = match.battle, exp = b.world.expedition!, hero = b.heroes.get(0)!.knight;
  assert.equal(b.world.rules, exp);
  assert.equal(b.world.td, null);
  const land = exp.spec.landings[0];
  assert.ok(Math.hypot(hero.pos.x - land.x, hero.pos.z - land.z) < 2, 'the hero stands on the first landing');
  const total = exp.garrisons.alive;
  assert.equal(total, exp.spec.garrisons.reduce((n, g) => n + g.posts.length, 0));
  for (let i = 0; i < 30; i++) b.step(1 / 60);
  // the landing is on the outer ring: at least the lairs across the map are asleep
  const far = exp.garrisons.rooms.filter((r) => Math.min(Math.abs(r.spec.x0 - hero.pos.x), Math.abs(r.spec.x1 - hero.pos.x)) > WAKE_R + 20 || Math.min(Math.abs(r.spec.z0 - hero.pos.z), Math.abs(r.spec.z1 - hero.pos.z)) > WAKE_R + 20);
  assert.ok(far.length > 0);
  const outside = far.filter((r) => hero.pos.x < r.spec.x0 - WAKE_R || hero.pos.x > r.spec.x1 + WAKE_R || hero.pos.z < r.spec.z0 - WAKE_R || hero.pos.z > r.spec.z1 + WAKE_R);
  assert.ok(outside.length > 0);
  for (const r of outside) { assert.equal(r.awake, false); assert.ok(r.mobs.every((m) => m.asleep)); }
  const sent = match.entities().filter((e) => e.id.startsWith('m')).length;
  assert.ok(sent < total, `only the woken guards are sent (${sent} of ${total})`);
  assert.ok(match.entities().some((e) => e.id === 'exp'));
  // a sleeping patrol stands still; with the hero next to it — it walks
  const patrol = exp.garrisons.rooms.find((r) => r.spec.id.startsWith('patrol') && !r.awake)!;
  const m0 = patrol.mobs[0], at0 = m0.pos.clone();
  for (let i = 0; i < 60; i++) b.step(1 / 60);
  assert.ok(m0.pos.distanceTo(at0) < 0.01);
  const post = patrol.spec.posts[0];
  hero.place(post.x + 16, post.z + 16, 0, 0);
  for (let i = 0; i < 180; i++) b.step(1 / 60);
  assert.equal(patrol.awake, true);
  assert.ok(patrol.mobs.every((m) => !m.asleep));
  assert.ok(m0.pos.distanceTo(at0) > 1 || m0.alerted, 'the patrol moved');
  assert.equal(match.rules.state, 'play');
});
