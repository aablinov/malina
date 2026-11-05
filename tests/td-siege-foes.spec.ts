import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Tower hunters (wiki/design-tower-defence.md, section 10): the gnawer beaver turns off the road to a tower, gnaws it
 * down to ruins and returns to the road; ruins are repaired for raspberries keeping the old level; ordinary enemies leave towers alone.
 * The ice warlock freezes a tower — it does not fire, two hits on the ice break it; the frost spire does not freeze.
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=td';

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => {
    const m = (window as any).__malina;
    m.script(true);
    await m.ready;
    // the pad by the west road: the one closest to the road's points
    const td = m.td, lane = td.lane('west');
    const near = (p: any): number => Math.min(...lane.points.slice(1, -1).map(([x, z]: number[]) => Math.hypot(p.pos.x - x, p.pos.z - z)));
    (window as any).__pad = [...td.pads].sort((a: any, b: any) => near(a) - near(b))[0];
  });
  expect(errors).toEqual([]);
}

test('defence: the gnawer gnaws a tower down to ruins and leaves for the road; ruins are repaired; a courier does not turn off at the tower', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, pad = (window as any).__pad;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    m.profile.data.berries = 1000;
    const t = td.build(pad, 'arrow');
    td.upgrade(pad);
    const lvl = t.level, maxHp = t.maxHp;
    // an ordinary enemy walks past
    const run = td.spawnOn('runner', 'west');
    run.hp = 1e5;
    for (let i = 0; i < 150; i++) m.step(0.1);
    const runnerHp = t.hp, runnerProgress = run.progress;
    td.pack.clear();
    // the gnawer: immortal, so that it manages to finish gnawing
    const g = td.spawnOn('gnawer', 'west');
    g.hp = 1e5;
    let ruinedAt = -1, wasAlerted = false;
    for (let i = 0; i < 900 && ruinedAt < 0; i++) { m.step(0.1); wasAlerted ||= g.alerted; if (t.ruined) ruinedAt = i; }
    const p0 = g.progress, shots0 = t.shots, prompt = td.prompt(pad);
    for (let i = 0; i < 60; i++) m.step(0.1);
    const after = { alerted: g.alerted, progress: g.progress, shots: t.shots - shots0 };
    td.pack.clear();
    // repair
    td.openMenu(pad);
    const menu = td.menuEl.textContent;
    const b0 = m.berries, cost = t.repairCost;
    const up = td.upgrade(pad);
    const ok = td.repairTower(pad);
    td.closeMenu();
    return { lvl, maxHp, runnerHp, runnerProgress, ruinedAt, wasAlerted, bites: g.bites, p0, prompt, after, menu, up, ok, paid: b0 - m.berries, cost, hp: t.hp, level: t.level, ruined: t.ruined };
  });
  expect(r.maxHp).toBe(156);
  expect(r.runnerHp).toBe(r.maxHp);
  expect(r.runnerProgress).toBeGreaterThan(0.5);
  expect(r.wasAlerted).toBe(true);
  expect(r.ruinedAt).toBeGreaterThan(0);
  expect(r.bites).toBeGreaterThanOrEqual(10);
  expect(r.prompt).toContain('Ruins');
  expect(r.after.alerted).toBe(false);
  expect(r.after.progress).toBeGreaterThan(r.p0);
  expect(r.after.shots).toBe(0);
  expect(r.menu).toContain('Repair');
  expect(r.up).toBe(false);
  expect(r.ok).toBe(true);
  expect(r.paid).toBe(r.cost);
  expect(r.hp).toBe(r.maxHp);
  expect([r.level, r.ruined]).toEqual([r.lvl, false]);
});

test('defence: the warlock freezes a tower — it does not fire; two hits on the ice break it; the spire does not freeze', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, pad = (window as any).__pad;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    m.profile.data.berries = 1000;
    const t = td.build(pad, 'arrow');
    const f = td.spawnOn('frostling', 'west');
    f.hp = 1e5;
    let frozeAt = -1;
    for (let i = 0; i < 600 && frozeAt < 0; i++) { m.step(0.1); if (t.frozen > 0) frozeAt = i; }
    const s0 = t.shots;
    m.step(1);
    const silent = t.shots === s0;
    const iceTarget = td.targets().includes(t.ice);
    t.ice.hit(5, new m.hero.pos.constructor(0, 0, 1), t.pos.clone(), 0);
    const still = t.frozen > 0;
    t.ice.hit(5, new m.hero.pos.constructor(0, 0, 1), t.pos.clone(), 0);
    const broken = t.frozen <= 0 && !td.targets().includes(t.ice);
    // it also melts by itself
    t.freeze(1);
    m.step(1.2);
    const melted = t.frozen <= 0;
    const spire = td.build(td.pads.find((p: any) => p !== pad && !p.tower), 'frost');
    return { frozeAt, froze: f.froze, silent, iceTarget, still, broken, melted, spire: spire.freeze(3), alive: t.alive };
  });
  expect(r.frozeAt).toBeGreaterThan(0);
  expect(r.froze).toBeGreaterThanOrEqual(1);
  expect(r.silent).toBe(true);
  expect(r.iceTarget).toBe(true);
  expect(r.still).toBe(true);
  expect(r.broken).toBe(true);
  expect(r.melted).toBe(true);
  expect(r.spire).toBe(false);
  expect(r.alive).toBe(true);
});

test('defence: mini-bosses every third wave; the giant stomps towers, the queen drops slimes onto the road, the shaman freezes towers', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, pad = (window as any).__pad;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    m.profile.data.berries = 5000;
    const chiefs = td.waves.map((w: any, i: number) => w.groups.filter((g: any) => g.kind.startsWith('chief_')).map(() => i + 1)).flat();
    const hunters = td.waves.slice(2).every((w: any) => w.groups.some((g: any) => g.kind === 'gnawer' || g.kind === 'frostling'));
    // the giant
    const t = td.build(pad, 'splash');
    const b = td.spawnOn('chief_brute', 'west');
    b.hp = b.maxHp = 1e5;
    const banner = document.body.textContent?.includes('mini-boss');
    for (let i = 0; i < 400 && !b.casts; i++) m.step(0.1);
    m.step(1);
    const brute = { casts: b.casts, towerHp: t.hp, max: t.maxHp, bar: b.group.children.some((c: any) => c.children?.some((s: any) => s.isSprite)) };
    td.pack.clear();
    t.repair();
    // the queen
    const q = td.spawnOn('chief_slime', 'north');
    for (let i = 0; i < 100; i++) m.step(0.1);
    const kids = td.pack.mobs.filter((x: any) => x.kind === 'slime_mid' && !x.dead);
    const kidsOnLane = kids.length > 0 && kids.every((x: any) => x.laneId === 'north' && x.march);
    q.hit(1e6, new m.hero.pos.constructor(0, 0, 0), q.pos.clone(), 0);
    m.step(0.5);
    const after = td.pack.mobs.filter((x: any) => x.kind === 'slime_mid' && !x.dead).length;
    td.pack.clear();
    // the shaman
    const s = td.spawnOn('chief_frost', 'west');
    s.hp = s.maxHp = 1e5;
    let frozen = false;
    for (let i = 0; i < 400 && !frozen; i++) { m.step(0.1); frozen = t.frozen > 0; }
    return { chiefs, hunters, banner, brute, queen: { casts: q.casts, kids: kids.length, kidsOnLane, after: after - kids.length }, shaman: { casts: s.casts, frozen } };
  });
  expect(r.chiefs).toEqual([3, 6, 9]);
  expect(r.hunters).toBe(true);
  expect(r.banner).toBe(true);
  expect(r.brute.casts).toBeGreaterThanOrEqual(1);
  expect(r.brute.towerHp).toBeLessThan(r.brute.max);
  expect(r.brute.bar).toBe(true);
  expect(r.queen.casts).toBeGreaterThanOrEqual(1);
  expect(r.queen.kidsOnLane).toBe(true);
  expect(r.queen.after).toBe(3);
  expect(r.shaman.casts).toBeGreaterThanOrEqual(1);
  expect(r.shaman.frozen).toBe(true);
});
