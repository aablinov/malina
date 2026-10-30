import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Карта 1 «Остров» (wiki/design-map-island.md, src/level/island-map.ts): грузится регионами без ошибок, герой на старте стоит
 * на земле, из meta встают группы мобов (засады и патрули), страж в храме, торговцы и лут; дороги плана проходимы
 * от старта до храма, деревни, статуи, пещер и за все четыре моста; патруль ходит, засада видит героя только вблизи.
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=island';
const MAP = JSON.parse(readFileSync(resolve('assets/maps/island.json'), 'utf8')) as { entities: { kind: string }[]; meta: { mobRooms: unknown[]; arenas: unknown[]; merchants: unknown[] } };

/** Дороги плана в пикселях картинки (как в island-map.ts): старт → ключи → хутор → форт → деревня; форт → храм → статуя; грот; снег; лагерь; уступ; островок; скала */
const ROADS = [
  [740, 1415, 850, 1430, 1000, 1480, 1150, 1535, 1250, 1540, 1320, 1480, 1400, 1360, 1430, 1300, 1430, 1220, 1400, 1160, 1330, 1080, 1270, 1000, 1240, 930, 1270, 830, 1300, 760, 1330, 660, 1370, 560, 1400, 500, 1400, 380, 1500, 330, 1600, 260, 1680, 230],
  [1330, 640, 1250, 600, 1180, 560, 1140, 505, 1090, 560, 1050, 625, 1020, 630, 990, 660, 985, 720, 1000, 800, 960, 830, 880, 900, 780, 1000, 680, 1030, 520, 1030, 430, 1000, 360, 935],
  [740, 1415, 790, 1330, 800, 1260, 790, 1200, 700, 1150, 600, 1110, 500, 1100, 420, 1100, 345, 1088],
  [900, 500, 900, 462, 860, 440, 830, 410, 800, 370, 780, 345],
  [1150, 1535, 1200, 1600, 1300, 1640, 1355, 1650],
  [1420, 1160, 1480, 1050, 1470, 950, 1465, 880, 1500, 860, 1600, 860, 1670, 880, 1800, 880, 1840, 860],
  [545, 620, 455, 585, 380, 560], [690, 1350, 600, 1385, 610, 1450, 570, 1490],
];

test('остров: карта из плана — регионы, старт, мобы, страж, торговцы и лут из meta', async ({ page }) => {
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
      bosses: m.bossIds, merchants: m.merchants.map((x: any) => x.kind), goal: document.body.textContent?.includes('Друзового голема'),
      chestsNear: m.props.supplies.length + m.props.crates.length + m.props.barrels.length,
    };
  });
  expect(errors).toEqual([]);
  expect(r.name).toBe('Остров');
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

test('остров: дороги плана проходимы, посты мобов и лут на свободной земле, патруль ходит, засада спит до 3 м', async ({ page }) => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const r = await page.evaluate(async (ROADS) => {
    const m = (window as any).__malina; m.script(true); await m.ready; m.hero.god = true;
    const L = m.level, V = m.hero.pos.constructor;
    const SX = 256 / 1932, SZ = 256 / 1916, P = (x: number, y: number) => [Math.round(x * SX - 128), Math.round(y * SZ - 128)];
    /** Поставить героя (регионы вокруг подгружаются) и опустить решётки арены, если он случайно её разбудил */
    const load = (x: number, z: number) => { m.hero.place(x, z, 0); m.step(0.2); m.render(); m.step(0.2); m.render(); for (const a of m.arenas) a.reset(); };
    const bad: unknown[] = [];
    for (const line of ROADS) for (let i = 0; i + 3 < line.length; i += 2) {
      const [ax, az] = P(line[i], line[i + 1]), [bx, bz] = P(line[i + 2], line[i + 3]);
      load(ax, az);
      const path = m.pathfinder.find(new V(ax, m.hero.pos.y, az), new V(bx, 0, bz), { solids: m.solids });
      const end = path[path.length - 1], d = end ? Math.hypot(end.x - bx, end.z - bz) : 99;
      if (d > 1.5) bad.push([line[i], line[i + 1], line[i + 2], line[i + 3], d]);
    }
    const floorOk = (x: number, z: number) => { const f = L.nameAt(x, -1, z); return f !== 'air' && f !== 'water' && f !== 'river' && L.isAir(x, 0, z) && L.isAir(x, 1, z); };
    const posts: unknown[] = [];
    for (const r of m.mobRooms) for (const p of r.spec.posts) { const x = Math.round(p.x), z = Math.round(p.z); load(x + 12, z); if (!floorOk(x, z)) posts.push([r.spec.id, p.kind, x, z]); }
    const items: unknown[] = [];
    for (const e of L.entities) { if (!['chest', 'crate', 'barrel', 'terminal'].includes(e.kind)) continue; load(e.x + 12, e.z); if (!floorOk(e.x, e.z)) items.push([e.kind, e.x, e.z]); }
    // патруль: герой далеко — садовник идёт по маршруту; засада: жук в 6 м спит, в 2,5 м просыпается
    const pr = m.mobRooms.find((r: any) => r.spec.id === 'patrol1');
    load(pr.spec.posts[0].x + 25, pr.spec.posts[0].z + 20); m.fillRoom(pr);
    const w = pr.pack.mobs[0], p0 = [w.pos.x, w.pos.z]; m.step(3);
    const patrol = { moved: Math.hypot(w.pos.x - p0[0], w.pos.z - p0[1]), alerted: w.alerted, state: w.state };
    const am = m.mobRooms.find((r: any) => r.spec.id === 'ambush1'); const b = am.pack.mobs[0];
    load(b.pos.x + 6, b.pos.z); m.fillRoom(am); const b2 = am.pack.mobs[0]; m.step(1); const far = b2.alerted;
    m.hero.place(b2.pos.x + 2.5, b2.pos.z, 0); m.step(1); const near = b2.alerted;
    return { bad, posts, items, patrol, far, near };
  }, ROADS);
  expect(r.bad).toEqual([]);
  expect(r.posts).toEqual([]);
  expect(r.items).toEqual([]);
  expect(r.patrol.alerted).toBe(false);
  expect(r.patrol.moved).toBeGreaterThan(2);
  expect(r.far).toBe(false);
  expect(r.near).toBe(true);
});
