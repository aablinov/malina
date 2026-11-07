import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TowerKind } from '../../src/td/towers.ts';
import { hashEntities } from '../../src/sim/hash.ts';
import { tdWorld } from './sim-helpers.ts';

/** Scenario: towers on every pad that can be afforded, waves one after another — until victory or defeat */
function play(id: string, seed: number, ticks: number, build: TowerKind): { hashes: number[]; w: ReturnType<typeof tdWorld> } {
  const w = tdWorld(id, seed, { mobHp: 20 });
  const hashes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    if (i % 30 === 0) for (const p of w.sim.pads) if (p.free && w.sim.berries(0) >= 100) w.sim.command(0, { t: 'td', a: `build:${build}`, pad: p.index });
    if (i % 60 === 0 && !w.sim.waveRunning) w.sim.command(0, { t: 'td', a: 'wave' });
    w.step();
    if (i % 60 === 0) hashes.push(hashEntities(w.world.entities()));
    if (w.sim.state !== 'play') break;
  }
  return { hashes, w };
}

test('defence: towers are built for raspberries, waves come and are repelled, events and entity records come out', () => {
  const w = tdWorld('td', 5, { mobHp: 20 });
  const s = w.sim;
  assert.equal(s.berries(0), w.td.berries);
  assert.ok(s.command(0, { t: 'td', a: 'build:arrow', pad: 0 }));
  assert.ok(s.pads[0].tower);
  assert.equal(s.berries(0), w.td.berries - 100 > 0 ? w.td.berries - s.pads[0].tower!.def.cost : s.berries(0));
  assert.equal(s.command(0, { t: 'td', a: 'build:arrow', pad: 0 }), false, 'pad is taken');
  const built = w.world.events.find((e) => e.t === 'tower.build');
  assert.ok(built && built.id === 't0');
  assert.ok(s.command(0, { t: 'td', a: 'wave' }));
  assert.equal(s.wave, 1);
  for (let i = 0; i < 60 * 40 && s.waveRunning; i++) w.step();
  assert.ok(s.spawned > 0, 'enemies spawned');
  assert.ok(s.fallen > 0 || s.bush.taken > 0, 'there was a fight');
  const ents = w.world.entities();
  assert.ok(ents.some((e) => e.id === 'td') && ents.some((e) => e.id === 't0') && ents.some((e) => e.id === 'bush') && ents.some((e) => e.id === 'purse0'));
});

test('defence: raspberry piles fly to the hero, pickup goes to the purse', () => {
  const w = tdWorld('td', 1);
  w.hero.pos.set(10, 0, 10);
  w.world.piles.drop(w.hero.pos.clone().add({ x: 2, y: 0, z: 0 } as never), 7);
  const before = w.sim.berries(0);
  for (let i = 0; i < 240; i++) w.step();
  assert.equal(w.world.piles.list.length, 0);
  assert.equal(w.sim.berries(0), before + 7);
});

test('determinism: same seed — same hashes every second, another seed — different', () => {
  const a = play('td', 42, 60 * 90, 'arrow'), b = play('td', 42, 60 * 90, 'arrow'), c = play('td', 43, 60 * 90, 'arrow');
  assert.ok(a.hashes.length > 10);
  assert.deepEqual(a.hashes, b.hashes);
  assert.notDeepEqual(a.hashes, c.hashes);
});

test('all defence maps: waves run to the end with towers on every pad, no hangs', () => {
  for (const id of ['td', 'td2', 'td3']) {
    // stub enemies with 1 hp: any tower kills outright — checks that waves and rules reach victory
    const w = tdWorld(id, 7, { mobHp: 1 });
    const s = w.sim;
    for (const p of s.pads) { s.gain(0, 1000); s.command(0, { t: 'td', a: 'build:arrow', pad: p.index }); }
    let ticks = 0;
    while (s.state === 'play' && ticks < 60 * 60 * 20) {
      if (!s.waveRunning) s.command(0, { t: 'td', a: 'wave' });
      w.step(); ticks++;
    }
    assert.equal(s.state, 'won', `${id}: bush defended`);
    assert.equal(s.wave, s.waves.length, `${id}: all waves spawned`);
    assert.ok(w.world.piles.list.length === 0 || w.world.piles.harvestT > 0, `${id}: harvest`);
  }
});

test('match loot: kills and beaten waves add to it, victory adds half, it is not spent on towers, restart clears it', () => {
  const w = tdWorld('td', 7, { mobHp: 1 });
  const s = w.sim;
  for (const p of s.pads) { s.gain(0, 1000); s.command(0, { t: 'td', a: 'build:arrow', pad: p.index }); }
  assert.equal(s.lootOf(0), 0);
  s.command(0, { t: 'td', a: 'wave' });
  let ticks = 0;
  while (s.state === 'play' && s.wave === 1 && ticks < 60 * 120) { w.step(); ticks++; if (!s.waveRunning && s.next < (s.spec.rest ?? 20) - 1) break; }
  const afterWave = s.lootOf(0);
  // stubs drop base loot 2: the wave gives its kills and a quarter of the bounty
  assert.equal(afterWave, s.fallen * 2 + Math.round(s.waves[0].bounty * 0.25));
  const purse = s.berries(0);
  s.command(0, { t: 'td', a: 'upgrade', pad: 0 });
  assert.ok(s.berries(0) < purse, 'towers are paid from the purse');
  assert.equal(s.lootOf(0), afterWave, 'loot is not spent');
  // waves come by themselves after the rest: every beaten wave is counted
  while (s.state === 'play' && ticks < 60 * 60 * 30) { w.step(); ticks++; }
  assert.equal(s.state, 'won');
  const bounties = s.waves.reduce((n, wv) => n + Math.round(wv.bounty * 0.25), 0);
  assert.equal(s.lootOf(0), Math.round((s.fallen * 2 + bounties) * 1.5));
  assert.ok(w.world.entities().some((e) => e.id === 'loot0' && e.n === s.lootOf(0)));
  s.reset();
  assert.equal(s.lootOf(0), 0);
});
