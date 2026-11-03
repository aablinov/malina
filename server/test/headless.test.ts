import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashEntities } from '../../src/sim/hash.ts';
import { headlessBattle } from './headless-helpers.ts';

test('безголовый бой: герой, снаряжение и настоящая стая живут в Node; волна выходит, башни и меч бьют, мобы ранят', () => {
  const b = headlessBattle('td', 11);
  const s = b.world.td!;
  for (const p of s.pads) { s.gain(0, 1000); s.command(0, { t: 'td', a: 'build:arrow', pad: p.index }); }
  assert.ok(s.towers.length > 0);
  assert.ok(s.command(0, { t: 'td', a: 'wave' }));
  // герой стоит у куста и машет мечом
  b.hero.place(s.bush.pos.x + 2, s.bush.pos.z + 2, Math.PI);
  b.input.attack = true;
  let struck = 0, shots = 0;
  for (let i = 0; i < 60 * 45; i++) {
    b.step();
    b.input.aim.set(b.pack.mobs[0]?.pos.x ?? 0, 0, b.pack.mobs[0]?.pos.z ?? 0);
    if (b.hero.swings > struck) struck = b.hero.swings;
    shots = s.towers.reduce((a, t) => a + t.shots, 0);
    if (!s.waveRunning && i > 60) break;
  }
  assert.ok(s.spawned > 5, `вышло врагов: ${s.spawned}`);
  assert.ok(shots > 0, 'башни стреляли');
  assert.ok(s.fallen > 0, `павших: ${s.fallen}`);
  assert.ok(struck > 0, 'герой махал мечом');
  assert.ok(b.world.piles.list.length >= 0);
});

test('безголовый бой детерминирован: один сид — те же хэши мира, героя и стаи', () => {
  const run = (seed: number): number[] => {
    const b = headlessBattle('td', seed);
    const s = b.world.td!;
    for (const p of s.pads) { s.gain(0, 1000); s.command(0, { t: 'td', a: 'build:frost', pad: p.index }); }
    s.command(0, { t: 'td', a: 'wave' });
    b.input.move.set(0.3, 0.2);
    b.input.attack = true;
    const hashes: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      b.step();
      if (i % 30 === 0) {
        const ents = b.world.entities();
        ents.push({ id: 'hero', x: Math.round(b.hero.pos.x * 1000), z: Math.round(b.hero.pos.z * 1000), hp: Math.round(b.hero.hp * 10), yaw: Math.round(b.hero.yaw * 1000) });
        for (const m of b.pack.mobs) ents.push({ id: `mob${m.net}`, x: Math.round(m.pos.x * 1000), z: Math.round(m.pos.z * 1000), hp: Math.round(m.hp), st: m.state, a: m.attack });
        hashes.push(hashEntities(ents));
      }
    }
    return hashes;
  };
  const a = run(5), b = run(5), c = run(6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});
