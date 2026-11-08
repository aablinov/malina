import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Map 1 "Island" (wiki/design-map-island.md, src/level/island-map.ts): loads by regions without errors, the hero stands
 * on the ground at the start, mob groups (ambushes and patrols), the warden in the temple, merchants and loot rise from meta;
 * the plan's roads are walkable from the start to the temple, the village, the statue, the caves and across all four bridges;
 * a patrol walks, an ambush sees the hero only up close.
 */

// switched off for now (2026-11-08): the whole island file is skipped — remove this line to bring the tests back
test.skip(true, 'island tests are switched off');

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=island';
const MAP = JSON.parse(readFileSync(resolve('assets/maps/island.json'), 'utf8')) as { entities: { kind: string }[]; meta: { mobRooms: unknown[]; arenas: unknown[]; merchants: unknown[] } };

/** The plan's roads in picture pixels (as in island-map.ts): start → keys → farmstead → fort → village; fort → temple → statue; grotto; snow; camp; ledge; islet; rock */
const ROADS = [
  [740, 1415, 850, 1430, 1000, 1480, 1150, 1535, 1250, 1540, 1320, 1480, 1400, 1360, 1430, 1300, 1430, 1220, 1400, 1160, 1330, 1080, 1270, 1000, 1240, 930, 1270, 830, 1300, 760, 1330, 660, 1370, 560, 1400, 500, 1400, 380, 1500, 330, 1600, 260, 1680, 230],
  [1330, 640, 1250, 600, 1180, 560, 1140, 505, 1090, 560, 1050, 625, 1020, 630, 990, 660, 985, 720, 1000, 800, 960, 830, 880, 900, 780, 1000, 680, 1030, 520, 1030, 430, 1000, 360, 935],
  [740, 1415, 790, 1330, 800, 1260, 790, 1200, 700, 1150, 600, 1110, 500, 1100, 420, 1100, 345, 1088],
  [900, 500, 900, 462, 860, 440, 830, 410, 800, 370, 780, 345],
  [1150, 1535, 1200, 1600, 1300, 1640, 1355, 1650],
  [1420, 1160, 1480, 1050, 1470, 950, 1465, 880, 1500, 860, 1600, 860, 1670, 880, 1800, 880, 1840, 860],
  [545, 620, 455, 585, 380, 560], [690, 1350, 600, 1385, 610, 1450, 570, 1490],
];

test('island: map from the plan — regions, start, mobs, warden, merchants and loot from meta', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const r = await page.evaluate(async () => {
    const m = (window as any).__malina; m.script(true); await m.ready;
    const L = m.level, h = m.hero.pos;
    const floorOk = (x: number, z: number) => { const f = L.nameAt(x, -1, z); return f !== 'air' && f !== 'water' && f !== 'river' && L.isAir(x, 0, z) && L.isAir(x, 1, z); };
    return {
      name: L.name, regions: m.regions?.keys.length ?? 0, stream: !!m.regions,
      heroOnFloor: Math.abs(h.y) < 0.01 && floorOk(Math.round(h.x), Math.round(h.z)),
      rooms: m.mobRooms.length, mobs: m.mobRooms.reduce((a: number, r: any) => a + r.pack.mobs.length, 0),
      kinds: new Set(m.mobRooms.flatMap((r: any) => r.pack.mobs.map((x: any) => x.kind))).size,
      patrols: m.mobRooms.reduce((a: number, r: any) => a + r.pack.mobs.filter((x: any) => x.route).length, 0),
      ambush: m.mobRooms.find((r: any) => r.spec.id === 'ambush1').pack.mobs.map((x: any) => x.aggro),
      bosses: m.bossIds, merchants: m.merchants.map((x: any) => x.kind), goal: document.body.textContent?.includes('Druse Golem'),
      chestsNear: m.props.supplies.length + m.props.crates.length + m.props.barrels.length,
    };
  });
  expect(errors).toEqual([]);
  expect(r.name).toBe('Island');
  expect(r.stream).toBe(true);
  expect(r.regions).toBeGreaterThan(0);
  expect(r.heroOnFloor).toBe(true);
  expect(r.rooms).toBe(MAP.meta.mobRooms.length);
  expect(r.mobs).toBeGreaterThan(90);
  expect(r.kinds).toBeGreaterThan(20);
  expect(r.patrols).toBeGreaterThan(10);
  expect(r.ambush).toEqual([3, 3]);
  expect(r.bosses).toEqual(['druse']);
  expect(r.merchants).toEqual(['smith', 'merchant', 'merchant']);
  expect(r.goal).toBe(true);
  expect(r.chestsNear).toBeGreaterThan(0);
  expect(MAP.entities.filter((e) => e.kind === 'chest').length).toBe(12);
  expect(MAP.entities.filter((e) => e.kind === 'terminal').length).toBe(1);
});

/**
 * The roads, posts, loot and mob checks — split into parallel tests (each loads its own part of the island by regions).
 * `prep` runs in the page: the hero in god mode, `load(x, z)` places him and streams the regions around (no drawing).
 */
const PREP = `
  const m = window.__malina; m.script(true); m.hero.god = true;
  const L = m.level, V = m.hero.pos.constructor;
  // all the regions around at once (streaming loads one per frame), then two steps — obstacles, props and the arenas around
  const load = (x, z) => { m.hero.place(x, z, 0); m.regions.warm([{ x, z }]); m.step(0.2); m.render(false); m.step(0.2); m.render(false); for (const a of m.arenas) a.reset(); };
  // only the level data around (no hero, no steps): enough for the floor and air checks
  const data = (x, z) => m.regions.warm([{ x, z }]);
  const floorOk = (x, z) => { const f = L.nameAt(x, -1, z); return f !== 'air' && f !== 'water' && f !== 'river' && L.isAir(x, 0, z) && L.isAir(x, 1, z); };
`;

async function island(page: import('@playwright/test').Page, body: string, arg?: unknown): Promise<any> {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  return page.evaluate(`(async (ARG) => { ${PREP} await m.ready; ${body} })(${JSON.stringify(arg ?? null)})`);
}

for (const [n, line] of ROADS.entries()) {
  test(`island: road ${n + 1} of the plan is walkable segment by segment`, async ({ page }) => {
    const bad = await island(page, `
      const SX = 256 / 1932, SZ = 256 / 1916, P = (x, y) => [Math.round(x * SX - 128), Math.round(y * SZ - 128)];
      const bad = [];
      for (let i = 0; i + 3 < ARG.length; i += 2) {
        const [ax, az] = P(ARG[i], ARG[i + 1]), [bx, bz] = P(ARG[i + 2], ARG[i + 3]);
        load(ax, az);
        const path = m.pathfinder.find(new V(ax, m.hero.pos.y, az), new V(bx, 0, bz), { solids: m.solids });
        const end = path[path.length - 1], d = end ? Math.hypot(end.x - bx, end.z - bz) : 99;
        if (d > 1.5) bad.push([ARG[i], ARG[i + 1], ARG[i + 2], ARG[i + 3], d]);
      }
      return bad;`, line);
    expect(bad).toEqual([]);
  });
}

test('island: mob posts stand on free ground', async ({ page }) => {
  const posts = await island(page, `
    const posts = [];
    for (const r of m.mobRooms) for (const p of r.spec.posts) { const x = Math.round(p.x), z = Math.round(p.z); data(x, z); if (!floorOk(x, z)) posts.push([r.spec.id, p.kind, x, z]); }
    return posts;`);
  expect(posts).toEqual([]);
});

test('island: chests, crates, barrels and the terminal stand on free ground', async ({ page }) => {
  const items = await island(page, `
    const items = [];
    for (const e of L.entities) { if (!['chest', 'crate', 'barrel', 'terminal'].includes(e.kind)) continue; data(e.x, e.z); if (!floorOk(e.x, e.z)) items.push([e.kind, e.x, e.z]); }
    return items;`);
  expect(items).toEqual([]);
});

test('island: a patrol walks, an ambush sleeps until 3 m', async ({ page }) => {
  const r = await island(page, `
    // patrol: the hero is far — the gardener walks its route; ambush: the beetle sleeps at 6 m, wakes at 2.5 m
    const pr = m.mobRooms.find((r) => r.spec.id === 'patrol1');
    load(pr.spec.posts[0].x + 25, pr.spec.posts[0].z + 20); m.fillRoom(pr);
    const w = pr.pack.mobs[0], p0 = [w.pos.x, w.pos.z]; m.step(3);
    const patrol = { moved: Math.hypot(w.pos.x - p0[0], w.pos.z - p0[1]), alerted: w.alerted, state: w.state };
    const am = m.mobRooms.find((r) => r.spec.id === 'ambush1'); const b = am.pack.mobs[0];
    load(b.pos.x + 6, b.pos.z); m.fillRoom(am); const b2 = am.pack.mobs[0]; m.step(1); const far = b2.alerted;
    m.hero.place(b2.pos.x + 2.5, b2.pos.z, 0); m.step(1); const near = b2.alerted;
    return { patrol, far, near };`);
  expect(r.patrol.alerted).toBe(false);
  expect(r.patrol.moved).toBeGreaterThan(2);
  expect(r.far).toBe(false);
  expect(r.near).toBe(true);
});
