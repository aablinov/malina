import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import type { TowerKind } from '../../src/td/towers.ts';
import { hashEntities } from '../../src/sim/hash.ts';
import { tdWorld, type StubMob } from './sim-helpers.ts';
import { itemDef, MOB_DROPS, Profile } from '../../src/items.ts';
import { spellOf } from '../../src/magic/registry.ts';
import { getWeapon } from '../../src/weapons.ts';

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
  for (const id of ['td', 'td2', 'td3', 'td4']) {
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
  assert.equal(afterWave, Math.floor(s.fallen * 2 + s.waves[0].bounty * 0.25));
  const purse = s.berries(0);
  s.command(0, { t: 'td', a: 'upgrade', pad: 0 });
  assert.ok(s.berries(0) < purse, 'towers are paid from the purse');
  assert.equal(s.lootOf(0), afterWave, 'loot is not spent');
  // waves come by themselves after the rest: every beaten wave is counted
  while (s.state === 'play' && ticks < 60 * 60 * 30) { w.step(); ticks++; }
  assert.equal(s.state, 'won');
  const bounties = s.waves.reduce((n, wv) => n + wv.bounty * 0.25, 0);
  assert.equal(s.lootOf(0), Math.round((s.fallen * 2 + bounties) * 1.5));
  assert.ok(w.world.entities().some((e) => e.id === 'loot0' && e.n === s.lootOf(0)));
  s.reset();
  assert.equal(s.lootOf(0), 0);
});

test('heroes\' strength: rating raises the pack level of every wave and the loot', () => {
  const a = tdWorld('td', 7, { mobHp: 1 }), b = tdWorld('td', 7, { mobHp: 1 });
  b.sim.setRating(4);
  assert.equal(b.sim.base, a.sim.base + 3);
  a.sim.killed(a.hero.pos.clone(), 1, 10);
  b.sim.killed(b.hero.pos.clone(), 1, 10);
  assert.equal(a.sim.lootOf(0), 10);
  assert.equal(b.sim.lootOf(0), Math.floor(10 * 1.24));
  b.sim.setRating(999);
  assert.equal(b.sim.rating, 40, 'rating is capped');
});

test('misty clearing (td5): waves never run out, mobs come out of the mist from several sides, the loot is kept when the bush falls', () => {
  const w = tdWorld('td5', 11, { mobHp: 1 });
  const s = w.sim;
  assert.ok(s.endless && s.fog, 'endless map with mist');
  for (const p of s.pads) { s.gain(0, 1000); s.command(0, { t: 'td', a: 'build:arrow', pad: p.index }); }
  const lanes = new Set<string>();
  let ticks = 0;
  // waves go by the rest timer: a beaten wave pays its bounty into the loot
  while (s.wave < 14 && ticks < 60 * 60 * 30) {
    for (const e of w.events()) if (e.t === 'lair.burst') lanes.add(String(e.id));
    w.step(); ticks++;
  }
  assert.equal(s.state, 'play', 'no victory after the map\'s own ten waves');
  assert.ok(s.wave >= 14, `generated waves run: ${s.wave}`);
  assert.ok(lanes.size >= 5, `from many sides: ${lanes.size}`);
  assert.ok(s.waves.slice(0, 14).some((wv) => wv.groups.some((g) => g.kind.startsWith('chief_'))), 'chiefs every fifth wave');
  assert.ok(s.waves.slice(0, 14).some((wv) => wv.mod), 'some waves carry a modifier');
  // the bush falls — the run is over, the loot stays
  const loot = s.lootOf(0);
  assert.ok(loot > 0);
  s.bush.hurt(1e9, s.bush.pos);
  w.step();
  assert.equal(s.state, 'lost');
  assert.ok(s.paid, 'endless run pays out on defeat');
});

test('misty clearing: the same wave from its number on every machine; lanterns light up and enemies put them out; wisps pay the catcher', async () => {
  const { fogWave } = await import('../../src/td/waves-fog.ts');
  const ids = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
  assert.deepEqual(fogWave(23, ids), fogWave(23, ids));
  assert.notDeepEqual(fogWave(23, ids), fogWave(24, ids));
  const w = tdWorld('td5', 3, { mobHp: 1e6 });
  const s = w.sim, fog = s.fog!, l = fog.lanterns[0];
  assert.equal(l.lit, false);
  assert.ok(s.command(0, { t: 'td', a: 'lantern', pad: 0 }));
  assert.ok(l.lit && l.flame > 0);
  assert.ok(w.world.entities().some((e) => e.id === 'lantern0' && e.lit === 1));
  // an enemy stands at the lantern — the flame drains and it goes out
  const m = s.spawn('runner', new THREE.Vector3(l.x + 0.5, 0, l.z));
  assert.ok(m);
  for (let i = 0; i < 60 * 20 && l.lit; i++) { (m as unknown as { pos: THREE.Vector3 }).pos.set(l.x + 0.5, 0, l.z); w.step(); }
  assert.equal(l.lit, false, 'put out');
  // a wisp next to the hero is caught
  const { SimWisp } = await import('../../src/sim/fog.ts');
  const wisp = new SimWisp(99, 0, 0, 0, 25);
  fog.wisps.push(wisp);
  const before = s.berries(0);
  w.hero.pos.set(0, 0, 0);
  w.step();
  assert.equal(s.berries(0), before + 25);
  assert.equal(fog.wisps.length, 0);
});

test('loot from enemies: a mini-boss always leaves a relic, the hero picks items up; the rank and file leave items by chance', () => {
  const w = tdWorld('td', 11), { world, sim } = w;
  const picked: { seat: number; def: string; relic: boolean }[] = [];
  world.drops.onPick = (seat, def, relic) => picked.push({ seat, def, relic });
  sim.killed(w.hero.pos.clone().add(new THREE.Vector3(1.5, 0, 0)), 1, 1, 'chief_test');
  assert.equal(world.drops.list.length, 1, 'a mini-boss always leaves an item');
  assert.ok(world.drops.list[0].relic && itemDef(world.drops.list[0].def).mob, 'and it is a relic');
  assert.ok(world.entities().some((e) => /^d\d+$/.test(e.id) && e.relic === 1), 'the item is in the snapshot records');
  for (let i = 0; i < 180 && !picked.length; i++) world.step(1 / 60);
  assert.equal(picked.length, 1, 'the item flew to the hero nearby and was picked up');
  assert.ok(picked[0].relic && picked[0].seat === 0);
  assert.ok(world.takeEvents().some((e) => e.t === 'drop.pick' && e.def === picked[0].def));
  for (let i = 0; i < 400; i++) sim.killed(new THREE.Vector3(w.hero.pos.x + 60, 0, w.hero.pos.z + 60), 1, 1, 'grunt');
  const n = world.drops.list.length;
  assert.ok(n > 0 && n <= 24, `the rank and file leave items too, no more than 24 lie on the ground: ${n}`);
  assert.equal(MOB_DROPS().length, 20, 'twenty relics');
  for (const d of MOB_DROPS()) {
    assert.equal(d.rarity, 'unique');
    if (d.slot === 'melee') assert.ok(d.relic && getWeapon(d.weapon ?? ''), `${d.id}: a weapon with a model and an effect`);
    else assert.ok(spellOf(d.artifact!.kind), `${d.id}: a spell from the registry`);
  }
  const p = new Profile(Profile.starter());
  assert.ok(!p.data.items.some((i) => itemDef(i.def).mob), 'no relics in the starter kit');
  for (let i = 0; i < 300; i++) assert.ok(!itemDef(p.rollLoot().def).mob, 'nor in chests');
});

test('frost spire and arcane obelisk hold rays: the slow and the drain grow while the ray stays on the target', () => {
  for (const kind of ['frost', 'magic'] as const) {
    const w = tdWorld('td', 5, { mobHp: 100000 }), { world, sim } = w;
    sim.gain(0, 5000);
    assert.ok(sim.command(0, { t: 'td', a: `build:${kind}`, pad: 0 }));
    const at = sim.pads[0].pos.clone().add(new THREE.Vector3(3, 0, 0));
    const m = world.h.spawnMob('grunt', at) as unknown as StubMob;
    const hp: number[] = [], chill = new Set<number>();
    const fires: import('../../src/sim/events.ts').SimEvent[] = [];
    for (let i = 0; i < 60 * 5; i++) {
      const was = m.hp;
      world.step(1 / 60);
      if (m.hp < was) { hp.push(was - m.hp); chill.add(Math.round(m.chillK * 100)); }
      fires.push(...world.takeEvents().filter((e) => e.t === 'tower.fire'));
    }
    assert.ok(fires.length > 8 && fires.every((e) => Array.isArray(e.pts) && (e.pts as number[]).length === 6), `${kind}: every tick is an event with the ray's two ends (${fires.length})`);
    assert.equal(fires[fires.length - 1].ramp, 1, `${kind}: the ramp is full after a few seconds`);
    if (kind === 'frost') { assert.ok(Math.min(...chill) < 40, 'the frost ray starts near −30 %'); assert.equal(Math.max(...chill), 60, 'and reaches −60 %'); }
    else assert.ok(hp[hp.length - 1] >= hp[0] * 2, `the tether drains harder with time: ${hp[0]} → ${hp[hp.length - 1]}`);
  }
});
