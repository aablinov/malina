import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bedCost, bedsOf, missionResult, orderOf, plantBed, unlockedDifficulty } from '../../src/expedition/camp.ts';
import { dailyOrder } from '../../src/expedition/mission.ts';
import { Profile } from '../../src/items.ts';

test('camp: beds are planted with seeds up to their limit; the order of the day counts deeds and pays once; a won top mission opens the next difficulty', () => {
  const d = Profile.starter();
  assert.equal(unlockedDifficulty(d), 1);
  assert.deepEqual(bedsOf(d), { totem: 0, stash: 0, haste: 0 });
  assert.equal(plantBed(d, 'stash'), false, 'no seeds');
  d.seeds = { common: 30, rare: 6, golden: 1 };
  assert.ok(plantBed(d, 'stash') && plantBed(d, 'stash') && plantBed(d, 'stash'));
  assert.equal(plantBed(d, 'stash'), false, 'at its limit');
  assert.deepEqual(bedsOf(d), { totem: 0, stash: 3, haste: 0 });
  assert.deepEqual(d.seeds, { common: 30 - 4 - 8 - 12, rare: 6 - 2 - 4, golden: 0 });
  assert.deepEqual(bedCost(3), { common: 12, rare: 4, golden: 1 });
  // the ladder
  const stats = { lairs: 0, beacons: 0, seeds: 0, missions: 1 };
  const day = 20000, order = dailyOrder(day);
  missionResult(d, { won: false, difficulty: 1, stats, day });
  assert.equal(unlockedDifficulty(d), 1);
  missionResult(d, { won: true, difficulty: 1, stats, day });
  assert.equal(unlockedDifficulty(d), 2);
  missionResult(d, { won: true, difficulty: 1, stats, day });
  assert.equal(unlockedDifficulty(d), 2, 'an old difficulty opens nothing');
  // the order of the day
  const e = Profile.starter(), berries = e.berries, big = { lairs: 99, beacons: 99, seeds: 99, missions: 99 }, one = { lairs: 1, beacons: 1, seeds: 1, missions: 1 };
  assert.equal(missionResult(e, { won: true, difficulty: 1, stats: one, day }), null);
  assert.deepEqual(orderOf(e, day), { n: 1, done: false });
  assert.deepEqual(missionResult(e, { won: true, difficulty: 1, stats: big, day }), { berries: order.berries, rare: order.rare });
  assert.equal(e.berries, berries + order.berries);
  assert.equal(e.seeds!.rare, order.rare);
  assert.equal(missionResult(e, { won: true, difficulty: 1, stats: big, day }), null, 'paid once');
  assert.deepEqual(orderOf(e, day + 1), { n: 0, done: false }, 'a new day — a new order');
});
