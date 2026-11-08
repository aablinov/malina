import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Raspberry Spiral — Bush Defence 4 (wiki/design-tower-defence.md, section 17): the map `td4` with a real climb — mobs walk the terrain
 * (src/mobs/mob.ts, `ground`) up the spiral to the bush on the plateau (+2 m); hits, piles and the bush at floor height;
 * the final boss — the Golden Warden on the march (`chief_warden`, src/mobs/td-chiefs.ts).
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=td4';

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => { const m = (window as any).__malina; m.script(true); await m.ready; });
  expect(errors).toEqual([]);
}

test('spiral: map td4 — one road and a shortcut, 24 pads on three heights, twelve waves from level 4, the Golden Warden last', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, L = m.level, T = m.terrain;
    const spec = td.spec;
    const names = new Set<string>();
    L.forEach((_x: number, _y: number, _z: number, id: number) => names.add(L.palette[id]));
    const heights = [...new Set(td.pads.map((p: any) => p.pos.y))].sort();
    // the road climbs: the floor at the first lane point and at the last one
    const lane = spec.lanes[0], [sx, sz] = lane.points[2], [ex, ez] = lane.points[lane.points.length - 1];
    const last = td.waves[td.waves.length - 1];
    return {
      name: L.name, pads: td.pads.length, lanes: spec.lanes.map((l: any) => l.id), waves: td.waves.length, level: spec.level, bush: spec.bush,
      bushFloor: T.floorAt(0, 0, 10), roadStart: T.floorAt(sx, sz, 1), roadEnd: T.floorAt(ex, ez, 3), heights,
      lastHasWarden: last.groups.some((g: any) => g.kind === 'chief_warden'), westFrom: td.waves.findIndex((w: any) => w.groups.some((g: any) => g.lane === 'west')),
      blocks: ['portal_blue', 'cliff_violet', 'cliff_violet_grass', 'grass_slab', 'path_slab', 'berry_bush'].map((n) => names.has(n)),
      sutler: L.meta.merchants?.[0], weather: L.meta.world.weather.kind,
    };
  });
  expect(r.name).toBe('Raspberry Spiral');
  expect(r.pads).toBe(24);
  expect(r.lanes).toEqual(['north', 'west']);
  expect(r.waves).toBe(12);
  expect(r.level).toBe(4);
  expect(r.bush).toEqual({ x: 0, y: 2, z: 0, hp: 500 });
  expect(r.bushFloor).toBe(2);
  expect(r.roadStart).toBe(0);
  expect(r.roadEnd).toBe(2);
  expect(r.heights).toContain(0);
  expect(r.heights).toContain(2);
  expect(r.heights.some((h: number) => h % 1 === 0.5)).toBe(true);
  expect(r.lastHasWarden).toBe(true);
  expect(r.westFrom).toBe(4);
  expect(r.blocks).toEqual([true, true, true, true, true, true]);
  expect(r.sutler).toMatchObject({ kind: 'sutler', y: 2 });
  expect(r.weather).toBe('fireflies');
});

test('spiral: mobs climb the road to the plateau and hit the bush; the moth flies over the slope; the catapult and piles land on the plateau', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, w = m.world, T = m.terrain;
    m.hero.place(0, 40, 0, 0); m.hero.god = true;
    td.waves.length = 0;
    // a runner up each road: at the end it stands on the plateau and the bush takes hits
    const climbs: { lane: string; maxY: number; endY: number; hurt: boolean }[] = [];
    for (const lane of ['north', 'west']) {
      const b0 = td.bush.taken, mob = td.spawnOn('runner', lane);
      let maxY = 0;
      for (let i = 0; i < 1500 && td.bush.taken === b0; i++) { m.step(0.1); maxY = Math.max(maxY, mob.pos.y); }
      climbs.push({ lane, maxY, endY: mob.ground, hurt: td.bush.taken > b0 });
      mob.vanish();
    }
    // a moth: always 1.3 ± 0.2 above the floor under it, also on the climb
    const moth = td.spawnOn('moth', 'west');
    let over = Infinity, under = -Infinity, high = 0;
    for (let i = 0; i < 400; i++) {
      m.step(0.1);
      if (moth.state !== 'walk') continue;
      const dy = moth.pos.y - moth.ground;
      over = Math.min(over, dy); under = Math.max(under, dy); high = Math.max(high, moth.ground);
    }
    moth.vanish();
    // the catapult on a mound pad: the rock lands on the floor under the target, the raspberries of the fallen — on the plateau
    const seen: any[] = [], emit = w.emit.bind(w);
    w.emit = (e: any) => { seen.push(e); emit(e); };
    const pad = td.pads.filter((p: any) => p.pos.y === 2).sort((a: any, b: any) => Math.hypot(a.pos.x, a.pos.z) - Math.hypot(b.pos.x, b.pos.z))[0];
    m.profile.data.berries = 99999;
    td.build(pad, 'splash');
    for (let k = 0; k < 6; k++) { const x = td.spawnOn('berryling', 'west'); x.hp = x.maxHp = 400; }
    for (let i = 0; i < 900 && !seen.some((e) => e.t === 'hit.splash' && e.y > 1); i++) m.step(0.1);
    const splash = seen.filter((e) => e.t === 'hit.splash').map((e) => ({ y: e.y, floor: T.floorAt(e.x, e.z, e.y + 0.5) }));
    for (const x of td.pack.mobs) if (x.alive && x.ground >= 2) x.hit(9999, new (m.hero.pos.constructor)(1, 0, 0), x.pos.clone(), 0);
    for (let i = 0; i < 30; i++) m.step(0.1);
    const piles = w.piles.list.map((p: any) => ({ y: p.pos.y, floor: T.floorAt(p.pos.x, p.pos.z, p.pos.y) }));
    w.emit = emit;
    m.resetTargets();
    return { climbs, over, under, high, splash, piles };
  });
  for (const c of r.climbs) {
    expect(c.hurt, `${c.lane}: the bush is hit`).toBe(true);
    expect(c.maxY, `${c.lane}: climbed`).toBeGreaterThanOrEqual(2);
    expect(c.endY, `${c.lane}: on the plateau`).toBe(2);
  }
  expect(r.high).toBeGreaterThanOrEqual(1);
  expect(r.over).toBeGreaterThan(1.05);
  expect(r.under).toBeLessThan(1.55);
  expect(r.splash.length).toBeGreaterThan(0);
  for (const s of r.splash) expect(s.y).toBeCloseTo(s.floor, 1);
  expect(r.splash.some((s: any) => s.y > 1)).toBe(true);
  expect(r.piles.length).toBeGreaterThan(0);
  for (const p of r.piles) expect(p.y - p.floor).toBeCloseTo(0.14, 1);
});

test('spiral: the Golden Warden marches up to the plateau, takes front hits on the shield, sweeps and drops swords on towers', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    m.hero.place(0, 40, 0, 0); m.hero.god = true;
    td.waves.length = 0;
    m.profile.data.berries = 99999;
    const boss = td.spawnOn('chief_warden', 'west');
    m.step(0.6);
    // shield: a hit from the front ×0.3, from behind — full
    const fwd = new V(Math.sin(boss.yaw), 0, Math.cos(boss.yaw));
    const t0 = boss.taken;
    boss.hit(100, fwd.clone().negate(), boss.pos.clone(), 0);
    const front = boss.taken - t0;
    boss.hit(100, fwd.clone(), boss.pos.clone(), 0);
    const back = boss.taken - t0 - front;
    // towers along the road: near ones get the sweep, far ones — the swords
    for (const p of td.pads) td.build(p, 'arrow');
    const hp0 = td.towers.reduce((a: number, t: any) => a + t.hp, 0);
    let maxY = 0;
    for (let i = 0; i < 2400 && td.bush.taken === 0; i++) { m.step(0.1); boss.hp = boss.maxHp; maxY = Math.max(maxY, boss.pos.y); }
    const hp1 = td.towers.reduce((a: number, t: any) => a + t.hp, 0);
    const out = { title: boss.title, front, back, casts: boss.casts, blades: boss.blades, towerDamage: hp0 - hp1, maxY, bush: td.bush.taken, ground: boss.ground };
    m.resetTargets();
    return out;
  });
  expect(r.title).toBe('Golden Warden');
  expect(r.front).toBeCloseTo(r.back * 0.3, 0);
  expect(r.back).toBeGreaterThan(0);
  expect(r.casts).toBeGreaterThanOrEqual(2);
  expect(r.blades).toBeGreaterThan(0);
  expect(r.towerDamage).toBeGreaterThan(0);
  expect(r.maxY).toBeGreaterThanOrEqual(2);
  expect(r.ground).toBe(2);
  expect(r.bush).toBeGreaterThan(0);
});
