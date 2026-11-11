import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SimWorld, type SimHooks } from '../../src/sim/world.ts';
import { tdWorld } from './sim-helpers.ts';

const bare: SimHooks = { foes: () => [], heroes: () => [], spawnMob: () => null, setScale: () => {} };

test('rules: a world without a mode has no rules and still steps — piles, drops, no obstacles', () => {
  const w = new SimWorld(bare, { seed: 3, level: null });
  assert.equal(w.rules, null);
  assert.equal(w.td, null);
  for (let i = 0; i < 60; i++) w.step(1 / 60);
  assert.equal(w.tick, 60);
  assert.deepEqual(w.solids, []);
  assert.deepEqual(w.entities(), []);
});

test('rules: Bush Defence is the rules of its mode — stage is the running wave, progress the waves repelled, goal their count', () => {
  const w = tdWorld('td', 5, { mobHp: 20 });
  const r = w.world.rules!;
  assert.equal(r, w.sim);
  assert.equal(r.state, 'play');
  assert.equal(r.stage, 0);
  assert.equal(r.progress, 0);
  assert.equal(r.goal, w.td.waves!.length);
  assert.deepEqual(r.muster, [w.td.bush.x, 0, w.td.bush.z + 4]);
  assert.ok(r.command(0, { t: 'td', a: 'wave' }));
  w.step();
  assert.equal(r.stage, 1);
  assert.equal(r.progress, 0, 'the first wave is still running');
  w.sim.state = 'won';
  assert.equal(r.progress, r.goal);
  assert.ok(r.paid);
});

test('rules: an endless map has no goal', () => {
  const w = tdWorld('td5', 5, { mobHp: 20 });
  assert.equal(w.world.rules!.goal, 0);
});
