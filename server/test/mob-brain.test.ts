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

/** Mob with a botlib brain: thinks once per THINK_S, moves every tick; stuck at a wall — asks the `route` hook for a path */
function setup(route: MobHooks['route']) {
  const scene = new THREE.Scene(), fx = nullFx(), T = makeTextures();
  const hero = new Knight(scene, T);
  hero.place(0, 6, Math.PI);
  // a wall across between the mob (0,0) and the hero (0,6)
  const wall: Obstacle = { x: 0, z: 3, hx: 3, hz: 0.25, rot: 0, h: 2 };
  const hooks: MobHooks = {
    scene, fx, hero, terrain: { floorAt: () => 0, resolve: () => false, blocked: () => false, wallHit: () => null },
    obstacles: () => [wall], hurtHero: () => {}, quiet: () => true, allies: () => [], spawn: () => null, route,
  };
  const m = new BerryRunner(hooks, new THREE.Vector3(0, 0, 0));
  m.notice();
  return { m, hero };
}

test('mob brain: without a path it runs into the wall, with a path it goes around and reaches the hero; asks for a path no more often than it gets stuck', () => {
  const done = useRng(rng(3));
  try {
    const a = setup(undefined);
    for (let i = 0; i < 60 * 6; i++) a.m.update(1 / 60);
    assert.ok(a.m.pos.z < 3, `without navigation stands before the wall: z=${a.m.pos.z.toFixed(2)}`);
    let asked = 0;
    const b = setup((from, to) => { asked++; return [new THREE.Vector3(-4, 0, from.z), new THREE.Vector3(-4, 0, to.z), to.clone()]; });
    for (let i = 0; i < 60 * 8; i++) b.m.update(1 / 60);
    assert.ok(b.m.pos.z > 4.5, `with a path went around the wall: z=${b.m.pos.z.toFixed(2)}`);
    assert.ok(asked >= 1 && asked <= 3, `paths requested: ${asked}`);
    assert.ok(b.m.intent.move.length() <= 1.0001);
  } finally { done(); }
});

test('mob brain thinks once per THINK_S but moves every tick: there are steps between thoughts', () => {
  const done = useRng(rng(4));
  try {
    const { m, hero } = setup(undefined);
    hero.place(0, 4, Math.PI);
    (m as unknown as { h: { obstacles: () => Obstacle[] } }).h.obstacles = () => [];
    // emerged from the ground (0.45 s) and thought at least once — from then on it moves every tick between thoughts
    for (let i = 0; i < 36; i++) m.update(1 / 60);
    let moved = 0;
    for (let i = 0; i < Math.round(THINK_S * 60) - 1; i++) { const z = m.pos.z; m.update(1 / 60); if (Math.abs(m.pos.z - z) > 1e-4) moved++; }
    assert.ok(moved >= 4, `steps between thoughts: ${moved}`);
  } finally { done(); }
});
