import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TowerKind } from '../../src/td/towers.ts';
import { hashEntities } from '../../src/sim/hash.ts';
import { tdWorld } from './sim-helpers.ts';

/** Сценарий: башни на всех площадках, какие по карману, волны одна за другой — до победы или поражения */
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

test('оборона: башни строятся за малину, волны идут и отбиваются, события и записи сущностей выходят', () => {
  const w = tdWorld('td', 5, { mobHp: 20 });
  const s = w.sim;
  assert.equal(s.berries(0), w.td.berries);
  assert.ok(s.command(0, { t: 'td', a: 'build:arrow', pad: 0 }));
  assert.ok(s.pads[0].tower);
  assert.equal(s.berries(0), w.td.berries - 100 > 0 ? w.td.berries - s.pads[0].tower!.def.cost : s.berries(0));
  assert.equal(s.command(0, { t: 'td', a: 'build:arrow', pad: 0 }), false, 'площадка занята');
  const built = w.world.events.find((e) => e.t === 'tower.build');
  assert.ok(built && built.id === 't0');
  assert.ok(s.command(0, { t: 'td', a: 'wave' }));
  assert.equal(s.wave, 1);
  for (let i = 0; i < 60 * 40 && s.waveRunning; i++) w.step();
  assert.ok(s.spawned > 0, 'враги вышли');
  assert.ok(s.fallen > 0 || s.bush.taken > 0, 'бой был');
  const ents = w.world.entities();
  assert.ok(ents.some((e) => e.id === 'td') && ents.some((e) => e.id === 't0') && ents.some((e) => e.id === 'bush') && ents.some((e) => e.id === 'purse0'));
});

test('оборона: кучки малины летят к герою, подбор — в кошелёк', () => {
  const w = tdWorld('td', 1);
  w.hero.pos.set(10, 0, 10);
  w.world.piles.drop(w.hero.pos.clone().add({ x: 2, y: 0, z: 0 } as never), 7);
  const before = w.sim.berries(0);
  for (let i = 0; i < 240; i++) w.step();
  assert.equal(w.world.piles.list.length, 0);
  assert.equal(w.sim.berries(0), before + 7);
});

test('детерминизм: один сид — одни хэши на каждой секунде, другой сид — другие', () => {
  const a = play('td', 42, 60 * 90, 'arrow'), b = play('td', 42, 60 * 90, 'arrow'), c = play('td', 43, 60 * 90, 'arrow');
  assert.ok(a.hashes.length > 10);
  assert.deepEqual(a.hashes, b.hashes);
  assert.notDeepEqual(a.hashes, c.hashes);
});

test('все карты обороны: волны доходят до конца с башнями на всех площадках, без зависаний', () => {
  for (const id of ['td', 'td2', 'td3']) {
    // враги-заглушки с 1 здоровья: любая башня бьёт наповал — проверяем, что волны и правила доходят до победы
    const w = tdWorld(id, 7, { mobHp: 1 });
    const s = w.sim;
    for (const p of s.pads) { s.gain(0, 1000); s.command(0, { t: 'td', a: 'build:arrow', pad: p.index }); }
    let ticks = 0;
    while (s.state === 'play' && ticks < 60 * 60 * 20) {
      if (!s.waveRunning) s.command(0, { t: 'td', a: 'wave' });
      w.step(); ticks++;
    }
    assert.equal(s.state, 'won', `${id}: куст отбит`);
    assert.equal(s.wave, s.waves.length, `${id}: все волны вышли`);
    assert.ok(w.world.piles.list.length === 0 || w.world.piles.harvestT > 0, `${id}: сбор урожая`);
  }
});
