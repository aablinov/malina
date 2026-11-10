import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import * as THREE from 'three';
import type { ObjectiveKind } from '../../src/expedition/types.ts';
import type { Mob } from '../../src/mobs/mob.ts';
import { Match, type MatchEnd } from '../../src/game/match.ts';
import { Profile } from '../../src/items.ts';
import { expeditionMap } from '../../src/level/expedition-map.ts';
import { BUSH_WAVES, DOWN_WAIT, DUSK_AT, HORN_BLOW, RAISE_HOLD, TOTEMS } from '../../src/sim/expedition.ts';
import { BEACON_HOLD, BOARD_WAIT, EXTRACT_WAIT } from '../../src/sim/objective.ts';
import { loadPrefabs } from '../prefabs.ts';

const LIB = loadPrefabs(join(import.meta.dirname, '..', '..', 'assets', 'prefabs'));
const USE = { t: 'exp', a: 'use' } as const;
const UP = new THREE.Vector3(0, 0, 1);

function start(objective: ObjectiveKind, difficulty = 5, seed = 9) {
  const match = new Match({ id: `x-${objective}`, map: expeditionMap({ seed, difficulty, objective }, LIB), seed, players: [{ seat: 0, playerId: 'p0', name: 'A', profile: Profile.starter() }] });
  let end: MatchEnd | null = null;
  match.onEnd = (e) => { end = e; };
  const b = match.battle, exp = b.world.expedition!, hero = b.heroes.get(0)!.knight;
  const events: string[] = [];
  const posted = exp.garrisons.alive;
  /** n seconds of the battle; the hero does not fall unless the test wants it */
  let held: { x: number; z: number; dx: number } | null = null;
  const run = (sec: number, o: { mortal?: boolean; each?: () => void } = {}): void => {
    for (let i = 0; i < Math.round(sec * 60); i++) {
      if (!o.mortal) hero.hp = hero.maxHp;
      // guards shove the hero around: the test keeps him where it put him
      if (held && !hero.down) hero.place(held.x + held.dx, held.z, 0, b.world.floor(held.x + held.dx, held.z, 2));
      o.each?.();
      b.step(1 / 60);
      for (const e of b.world.takeEvents()) events.push(e.t);
    }
  };
  const go = (p: { x: number; z: number }, dx = 0): void => { held = { x: p.x, z: p.z, dx }; hero.place(p.x + dx, p.z, 0, b.world.floor(p.x + dx, p.z, 2)); };
  /** Everyone marching on a raid falls */
  const slay = (): void => { for (const m of b.pack.mobs) if (m.net > posted && !m.dead) m.hit(99999, UP, m.pos, 0); };
  /** A garrison falls to the last guard */
  const rout = (id: string): void => { for (let i = 0; i < 20 && !exp.garrisons.cleared(id); i++) { for (const m of exp.garrisons.room(id)!.mobs as unknown as Mob[]) if (!m.dead) m.hit(99999, UP, m.pos, 0); run(0.25); } };
  return { match, b, exp, hero, run, go, slay, rout, events, end: () => end };
}

test('expedition, lairs: burnt lairs complete the objective; the balloon comes only after it; seeds reach the camp with those aboard', () => {
  const s = start('lairs'), { exp } = s;
  assert.equal(exp.goal, exp.nests.length);
  // the pad before the objective is done: no balloon
  s.go(exp.extraction.pos);
  s.run(0.1);
  assert.equal(exp.usable(0), 'wait');
  assert.equal(exp.command(0, USE), false);
  // a point of interest with a seed: raspberries into the purse, the seed into the bag
  const poi = exp.spec.pois.find((q) => q.seed)!;
  s.go(poi);
  s.run(0.2);
  assert.equal(exp.berries(0), poi.berries);
  assert.equal(exp.carriedOf(0)[poi.seed!], 1);
  assert.ok(!s.match.entities().some((e) => e.id === poi.id), 'the taken point leaves the snapshot');
  // the hero falls: the seed lies on the ground; back on his feet he picks it up
  s.hero.hurt(99999);
  s.run(0.1, { mortal: true });
  assert.equal(exp.carriedOf(0)[poi.seed!], 0);
  assert.equal(exp.seeds.length, 1);
  s.run(4);
  assert.equal(s.hero.down, false);
  s.go(exp.seeds[0] ?? poi);
  s.run(0.5);
  assert.equal(exp.seeds.length, 0);
  assert.equal(exp.carriedOf(0)[poi.seed!], 1);
  // lairs are targets of the hero's weapons and block the way
  assert.equal(s.b.targets().filter((x) => exp.nests.includes(x as never)).length, exp.nests.length);
  assert.ok(exp.solids.length >= exp.nests.length);
  for (const n of exp.nests) { assert.equal(exp.primary, false); n.hit(99999); }
  assert.equal(exp.primary, true);
  assert.equal(exp.progress, exp.goal);
  assert.ok(s.b.world.takeEvents().some((e) => e.t === 'exp.primary'));
  assert.ok(exp.lootOf(0) > 0);
  // the balloon: called, raids come while it flies, then boarding
  s.go(exp.extraction.pos);
  s.run(0.1);
  assert.equal(exp.usable(0), 'extract');
  assert.ok(exp.command(0, USE));
  assert.equal(exp.extraction.state, 'called');
  const loot = exp.lootOf(0);
  s.run(EXTRACT_WAIT + 0.5, { each: s.slay });
  assert.ok(s.events.includes('exp.raid'));
  assert.ok(s.events.includes('extract.ready'));
  s.run(1);
  assert.equal(exp.state, 'won');
  assert.equal(exp.bankedOf(0)[poi.seed!], 1);
  assert.ok(exp.lootOf(0) > loot, 'boarding adds its share');
  // the match ends and pays the loot
  for (let i = 0; i < 120 && !s.end(); i++) s.match.frame(0.05);
  assert.equal(s.end()!.result, 'won');
  assert.equal(s.end()!.wave, exp.goal);
  assert.equal(s.end()!.rewards.get(0)!.berries, exp.lootOf(0));
});

test('expedition, beacons: a beacon is lit with F and held; nobody near — the charge drains; all lit — the objective is done', () => {
  const s = start('beacons'), { exp } = s;
  const [first, ...rest] = exp.beacons;
  s.go(first.pos, 1);
  s.run(0.1);
  assert.equal(exp.usable(0), 'beacon');
  assert.ok(exp.command(0, USE));
  assert.equal(first.state, 'lighting');
  s.run(5, { each: s.slay });
  const charged = first.charge;
  assert.ok(charged > 4.5);
  // the hero walks away: the charge drains
  s.go(exp.spec.landings[0]);
  s.run(4, { each: s.slay });
  assert.ok(first.charge < charged);
  assert.equal(first.state, 'lighting');
  s.go(first.pos, 1);
  s.run(BEACON_HOLD + 1, { each: s.slay });
  assert.equal(first.state, 'lit');
  assert.equal(exp.done, 1);
  assert.equal(exp.primary, false);
  for (const b of rest) { s.go(b.pos, 1); s.run(0.1); assert.ok(exp.command(0, USE)); s.run(BEACON_HOLD + 0.5, { each: s.slay }); }
  assert.equal(exp.primary, true);
  // nobody boards: the mission still counts, the seeds carried are lost
  exp.carriedOf(0).common = 2;
  s.go(exp.extraction.pos);
  s.run(0.1);
  assert.ok(exp.command(0, USE));
  s.go(exp.spec.landings[0]);
  s.run(EXTRACT_WAIT + BOARD_WAIT + 1, { each: s.slay });
  assert.equal(exp.state, 'won');
  assert.equal(exp.bankedOf(0).common, 0);
});

test('expedition, bush: planted on the plot, three waves march on it; beaten — the objective is done; a withered bush loses the mission', () => {
  const s = start('bush'), { exp } = s;
  const plot = exp.spec.objective.sites[0];
  assert.equal(exp.goal, BUSH_WAVES);
  s.go(plot, 2);
  s.run(0.1);
  // the plot's guards first: with them around nothing is planted
  assert.equal(exp.usable(0), 'guarded');
  assert.equal(exp.command(0, USE), false);
  s.rout('g:plot');
  assert.equal(exp.usable(0), 'plot');
  assert.ok(exp.command(0, USE));
  assert.ok(exp.bush);
  assert.ok(s.match.entities().some((e) => e.id === 'bush'));
  // the first wave comes out and walks to the bush
  s.run(5);
  const raiders = s.b.pack.mobs.filter((m) => m.march && !m.dead);
  assert.ok(raiders.length >= 4);
  const d0 = Math.min(...raiders.map((m) => Math.hypot(m.pos.x - plot.x, m.pos.z - plot.z)));
  s.run(3);
  assert.ok(Math.min(...raiders.map((m) => Math.hypot(m.pos.x - plot.x, m.pos.z - plot.z))) < d0 - 3, 'the raid marches at the bush');
  s.run(40, { each: s.slay });
  assert.equal(exp.bushWave, BUSH_WAVES);
  assert.equal(exp.primary, true);
  assert.equal(exp.state, 'play');

  const l = start('bush', 2, 4);
  l.go(l.exp.spec.objective.sites[0], 2);
  l.run(0.1);
  l.rout('g:plot');
  assert.ok(l.exp.command(0, USE));
  l.exp.bush!.hurt(99999, UP);
  assert.equal(l.exp.state, 'lost');
  for (let i = 0; i < 120 && !l.end(); i++) l.match.frame(0.05);
  assert.equal(l.end()!.result, 'lost');
  assert.equal(l.end()!.rewards.get(0)!.berries, 0);
});

test('expedition: secondary objectives — a chest and an altar are used, the horn-blowers nest is burnt; the same seed and commands give the same mission', () => {
  const s = start('lairs', 8, 21), { exp } = s;
  for (const side of exp.sides) {
    const loot = exp.lootOf(0);
    if (side.nest) side.nest.hit(99999);
    else { s.go(side.spec, 1); s.run(0.1); assert.equal(exp.usable(0), side.spec.kind); assert.ok(exp.command(0, USE)); }
    assert.equal(side.done, true);
    assert.ok(exp.lootOf(0) > loot);
  }
  const play = (): string => {
    const m = start('beacons', 4, 33);
    m.go(m.exp.beacons[0].pos, 1);
    m.run(0.1);
    m.exp.command(0, USE);
    m.run(12);
    return JSON.stringify(m.match.entities());
  };
  assert.ok(play() === play(), 'two runs of one seed differ');
});

function party(objective: ObjectiveKind, n: number, seed = 9) {
  const match = new Match({ id: `p-${objective}`, map: expeditionMap({ seed, difficulty: 2, objective }, LIB), seed, players: Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `p${i}`, name: `P${i}`, profile: Profile.starter() })) });
  const b = match.battle, exp = b.world.expedition!, knights = Array.from({ length: n }, (_, i) => b.heroes.get(i)!.knight);
  const events: string[] = [];
  const step = (sec: number, each?: () => void): void => { for (let i = 0; i < Math.round(sec * 60); i++) { each?.(); b.step(1 / 60); for (const e of b.world.takeEvents()) events.push(e.t); } };
  return { match, b, exp, knights, events, step };
}

test('expedition, downed: a teammate next to the fallen lifts him in three seconds; alone he waits for a totem; no totems and everyone down — the mission fails with half the loot', () => {
  const p = party('lairs', 2), { exp, knights: [a, c] } = p;
  const land = exp.spec.landings[0], put = (k: typeof a, dx: number): void => k.place(land.x + dx, land.z, 0, 0);
  assert.equal(exp.totems, TOTEMS);
  // a teammate next to the fallen
  put(a, 0); put(c, 1.5);
  a.hurt(99999);
  p.step(1);
  assert.equal(a.down, true, 'he does not get up by himself any more');
  assert.ok(exp.downOf(0)!.k > 0.2);
  p.step(RAISE_HOLD);
  assert.equal(a.down, false);
  assert.ok(p.events.includes('hero.raised'));
  assert.equal(exp.totems, TOTEMS, 'a teammate costs no totem');
  // the teammate is far: the fallen waits out his time, then a totem puts him next to the teammate
  put(c, 30);
  a.hurt(99999);
  p.step(DOWN_WAIT - 1, () => { c.hp = c.maxHp; });
  assert.equal(a.down, true);
  p.step(2, () => { c.hp = c.maxHp; });
  assert.equal(a.down, false);
  assert.equal(exp.totems, TOTEMS - 1);
  assert.ok(Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) < 3, 'he rises next to the teammate');
  // both down: a totem lifts at once, one hero per totem; when they run out the mission is lost
  exp.addLoot(100);
  const loot = exp.lootOf(0);
  exp.totems = 1;
  a.hurt(99999); c.hurt(99999);
  p.step(4);
  assert.equal(exp.totems, 0);
  assert.equal(exp.state, 'play');
  a.hurt(99999); c.hurt(99999);
  p.step(1);
  assert.equal(exp.state, 'lost');
  assert.ok(Math.abs(exp.lootOf(0) - loot / 2) <= 1, 'half the loot is kept');
  assert.equal(exp.paid, true);
});

test('expedition, alarm: it grows with time and with a horn call; a horn-blower killed in time calls nobody; dusk doubles the growth', () => {
  const p = party('lairs', 1), { exp, knights: [a] } = p;
  const base = exp.base;
  const keep = (): void => { a.hp = a.maxHp; };
  // the horn: the first of a patrol blows for three seconds once it sees the hero
  const patrol = exp.garrisons.rooms.find((r) => r.spec.id.startsWith('patrol'))!, horn = patrol.mobs[0] as unknown as Mob;
  a.place(horn.pos.x + 3, horn.pos.z, 0, 0);
  p.step(1, keep);
  assert.ok(p.events.includes('horn.start'));
  horn.hit(99999, UP, horn.pos, 0);
  p.step(HORN_BLOW + 1, keep);
  assert.ok(p.events.includes('horn.cut'));
  assert.ok(!p.events.includes('horn.call'));
  assert.ok(exp.alarm < 10, 'only time has passed');
  // another patrol's horn-blower is left alone: the call goes out, the alarm jumps, a raid comes
  const other = exp.garrisons.rooms.filter((r) => r.spec.id.startsWith('patrol'))[1].mobs[0] as unknown as Mob;
  a.place(other.pos.x + 3, other.pos.z, 0, 0);
  p.step(HORN_BLOW + 2, () => { keep(); a.place(other.pos.x + 3, other.pos.z, 0, 0); });
  assert.ok(p.events.includes('horn.call'));
  assert.ok(p.events.includes('exp.raid'));
  assert.ok(exp.alarm >= 50);
  // time: a level every four minutes, the pack gets tougher with it
  const far = exp.spec.landings[0];
  exp.alarm = 99.9;
  p.step(1, () => { keep(); a.place(far.x, far.z, 0, 0); });
  assert.equal(exp.alarmLevel, 1);
  assert.equal(exp.base, base + 1);
  assert.ok(p.events.includes('exp.alarm'));
  // dusk
  const rate = (): number => { const a0 = exp.alarm; p.step(2, () => { keep(); a.place(far.x, far.z, 0, 0); }); return exp.alarm - a0; };
  const day = rate();
  exp.time = DUSK_AT - 0.5;
  p.step(1, keep);
  assert.equal(exp.dusk, true);
  assert.ok(p.events.includes('exp.dusk'));
  assert.ok(rate() > day * 1.8);
});
