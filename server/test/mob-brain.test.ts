import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import type { Obstacle } from '../../src/collision.ts';
import { nullFx } from '../../src/headless.ts';
import { Knight } from '../../src/knight.ts';
import { THINK_S, type MobHooks } from '../../src/mobs/mob.ts';
import { BerryRunner } from '../../src/mobs/td-foes.ts';
import { makeTextures } from '../../src/textures.ts';
import { rng, useRng } from '../../src/rng.ts';

/** Моб с мозгом botlib: думает раз в THINK_S, движется каждый такт; упёрся в стену — просит путь у крючка `route` */
function setup(route: MobHooks['route']) {
  const scene = new THREE.Scene(), fx = nullFx(), T = makeTextures();
  const hero = new Knight(scene, T);
  hero.place(0, 6, Math.PI);
  // стена поперёк между мобом (0,0) и героем (0,6)
  const wall: Obstacle = { x: 0, z: 3, hx: 3, hz: 0.25, rot: 0, h: 2 };
  const hooks: MobHooks = {
    scene, fx, hero, terrain: { floorAt: () => 0, resolve: () => false, blocked: () => false, wallHit: () => null },
    obstacles: () => [wall], hurtHero: () => {}, quiet: () => true, allies: () => [], spawn: () => null, route,
  };
  const m = new BerryRunner(hooks, new THREE.Vector3(0, 0, 0));
  m.notice();
  return { m, hero };
}

test('мозг моба: без пути упирается в стену, с путём обходит её и доходит до героя; путь просит не чаще, чем застревает', () => {
  const done = useRng(rng(3));
  try {
    const a = setup(undefined);
    for (let i = 0; i < 60 * 6; i++) a.m.update(1 / 60);
    assert.ok(a.m.pos.z < 3, `без навигации стоит перед стеной: z=${a.m.pos.z.toFixed(2)}`);
    let asked = 0;
    const b = setup((from, to) => { asked++; return [new THREE.Vector3(-4, 0, from.z), new THREE.Vector3(-4, 0, to.z), to.clone()]; });
    for (let i = 0; i < 60 * 8; i++) b.m.update(1 / 60);
    assert.ok(b.m.pos.z > 4.5, `с путём обошёл стену: z=${b.m.pos.z.toFixed(2)}`);
    assert.ok(asked >= 1 && asked <= 3, `путей спрошено: ${asked}`);
    assert.ok(b.m.intent.move.length() <= 1.0001);
  } finally { done(); }
});

test('мозг моба думает раз в THINK_S, а движется каждый такт: шаги между мыслями есть', () => {
  const done = useRng(rng(4));
  try {
    const { m, hero } = setup(undefined);
    hero.place(0, 4, Math.PI);
    (m as unknown as { h: { obstacles: () => Obstacle[] } }).h.obstacles = () => [];
    // вылез из земли (0,45 с) и подумал хотя бы раз — дальше между мыслями идёт каждый такт
    for (let i = 0; i < 36; i++) m.update(1 / 60);
    let moved = 0;
    for (let i = 0; i < Math.round(THINK_S * 60) - 1; i++) { const z = m.pos.z; m.update(1 / 60); if (Math.abs(m.pos.z - z) > 1e-4) moved++; }
    assert.ok(moved >= 4, `шагов между мыслями: ${moved}`);
  } finally { done(); }
});
