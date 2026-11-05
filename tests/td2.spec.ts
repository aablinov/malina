import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Crystal Glade — Bush Defence 2 (wiki/design-tower-defence.md, section 8): the second map `td2` with portal lairs,
 * twelve waves and a pack from level 7; new enemies — shellback, sporeling, hopper (src/mobs/td-foes.ts).
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=td2';

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => { const m = (window as any).__malina; m.script(true); await m.ready; });
  expect(errors).toEqual([]);
}

test('glade: the shell absorbs six hits, the sporeling heals neighbours and bursts into a cloud, the hopper hops along the road', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    // shellback: six hits into the shell — no damage, the seventh — full
    const sb = td.spawnOn('shellback', 'west');
    m.step(0.6);
    for (let i = 0; i < 6; i++) sb.hit(10, new V(1, 0, 0), sb.pos.clone(), 0);
    const shielded = { taken: sb.taken, shell: sb.shell, hp: sb.hp };
    sb.hit(10, new V(1, 0, 0), sb.pos.clone(), 0);
    const cracked = { taken: sb.taken, shell: sb.shell };
    sb.vanish();
    // a sporeling next to a wounded berryling: heals bit by bit, burst — by 30 %
    const sp = td.spawnOn('sporeling', 'north'), bl = td.spawnOn('berryling', 'north');
    m.step(0.6);
    bl.hp = Math.round(bl.maxHp * 0.3);
    const hp0 = bl.hp;
    m.step(1.5);
    const near = Math.hypot(sp.pos.x - bl.pos.x, sp.pos.z - bl.pos.z);
    const trickle = bl.hp - hp0, given1 = sp.given;
    sp.vanish();
    const burst = bl.hp - hp0 - trickle;
    const given2 = sp.given;
    bl.vanish();
    // hopper: with no hero nearby it hops every 3 s 5 m forward along the road
    const hp = td.spawnOn('hopper', 'east');
    const x0 = hp.pos.x;
    m.step(0.6);
    const chillHop = (() => { hp.chill(0.9, 10); m.step(3.5); return hp.hops; })();
    m.step(3);
    const hops = hp.hops, moved = x0 - hp.pos.x, progress = hp.progress;
    const titles = [sb.title, sp.title, hp.title];
    m.resetTargets();
    return { shielded, cracked, near, trickle, given1, burst, given2, chillHop, hops, moved, progress, titles, blMax: bl.maxHp };
  });
  expect(r.shielded).toEqual({ taken: 0, shell: 0, hp: expect.any(Number) });
  expect(r.cracked.taken).toBe(10);
  expect(r.cracked.shell).toBe(0);
  expect(r.near).toBeLessThan(3);
  expect(r.trickle).toBeGreaterThan(2);
  expect(r.given1).toBeGreaterThan(2);
  expect(r.burst).toBeGreaterThanOrEqual(Math.floor(r.blMax * 0.3) - 1);
  expect(r.given2).toBeGreaterThan(r.given1);
  expect(r.chillHop).toBeGreaterThanOrEqual(1);
  expect(r.hops).toBeGreaterThanOrEqual(2);
  expect(r.moved).toBeGreaterThan(10);
  expect(r.progress).toBeGreaterThan(0.1);
  expect(r.titles).toEqual(['Crystal Shellback', 'Sporeling', 'Rainbow Hopper']);
});

test('glade: map td2 — three portals, twelve waves with a pack from level 7, the roads are walkable and walled, the mushrooms glow', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, L = m.level;
    const spec = td.spec;
    const names = new Set<string>();
    L.forEach((_x: number, _y: number, _z: number, id: number) => names.add(L.palette[id]));
    // road: every point is a walkable floor with air above it; walls on the sides
    const floor = new Set(['path', 'tiles', 'tiles_broken', 'cobble', 'portal_floor']);
    let bad = 0, walls = 0, portals = 0;
    for (const l of spec.lanes) {
      for (const [x, z] of l.points) if (!floor.has(L.nameAt(x, -1, z)) || L.nameAt(x, 0, z) !== 'air') bad++;
      const [x, z] = l.points[1];
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (/wall_stone|bricks_mossy/.test(L.nameAt(x + dx, 0, z + dz) ?? '')) walls++;
      const [px, pz] = l.points[0];
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (L.nameAt(px + dx, 1, pz + dz) === 'portal_blue') portals++;
    }
    // the first wave: pack level 7
    td.callWave();
    for (let i = 0; i < 20; i++) m.step(0.1);
    const levels = td.pack.mobs.map((x: any) => x.scale.level);
    const lairs = td.lairs.map((l: any) => l.spawned);
    const world = L.meta.world;
    m.resetTargets();
    return {
      name: L.name, pads: td.pads.length, lanes: spec.lanes.length, waves: td.waves.length, level: spec.level, bush: spec.bush, berries: spec.berries,
      blocks: ['portal_blue', 'shroom_cap_pink', 'shroom_cap_blue', 'shroom_stem', 'wall_stone_wall', 'crystal'].map((n) => names.has(n)),
      bad, walls, portals, levels, lairs, weather: world.weather.kind, lairCount: td.lairs.length,
    };
  });
  expect(r.name).toBe('Crystal Glade');
  expect(r.pads).toBe(17);
  expect(r.lanes).toBe(3);
  expect(r.waves).toBe(12);
  expect(r.level).toBe(7);
  expect(r.bush).toEqual({ x: 0, z: 0, hp: 500 });
  expect(r.berries).toBe(350);
  expect(r.blocks).toEqual([true, true, true, true, true, true]);
  expect(r.bad).toBe(0);
  expect(r.walls).toBeGreaterThanOrEqual(3);
  expect(r.portals).toBeGreaterThanOrEqual(9);
  expect(r.levels.length).toBeGreaterThan(0);
  expect(r.levels.every((l: number) => l === 7)).toBe(true);
  expect(r.lairCount).toBe(3);
  expect(r.lairs.some((n: number) => n > 0)).toBe(true);
  expect(r.weather).toBe('fireflies');
});
