import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Охотники на башни (wiki/design-tower-defence.md, раздел 10): бобёр-грызун сворачивает с дороги к башне, грызёт её
 * до руин и возвращается на дорогу; руины чинятся за малину с прежним уровнем; обычные враги башни не трогают.
 * Ледяной колдунчик замораживает башню — она не стреляет, два удара по льду его разбивают; морозный шпиль не мёрзнет.
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
    // площадка у западной дороги: ближайшая к точкам дороги
    const td = m.td, lane = td.lane('west');
    const near = (p: any): number => Math.min(...lane.points.slice(1, -1).map(([x, z]: number[]) => Math.hypot(p.pos.x - x, p.pos.z - z)));
    (window as any).__pad = [...td.pads].sort((a: any, b: any) => near(a) - near(b))[0];
  });
  expect(errors).toEqual([]);
}

test('оборона: грызун грызёт башню до руин и уходит на дорогу; руины чинятся; гонец мимо башни не сворачивает', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, pad = (window as any).__pad;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    m.profile.data.berries = 1000;
    const t = td.build(pad, 'arrow');
    td.upgrade(pad);
    const lvl = t.level, maxHp = t.maxHp;
    // обычный враг идёт мимо
    const run = td.spawnOn('runner', 'west');
    run.hp = 1e5;
    for (let i = 0; i < 150; i++) m.step(0.1);
    const runnerHp = t.hp, runnerProgress = run.progress;
    td.pack.clear();
    // грызун: бессмертный, чтобы успел догрызть
    const g = td.spawnOn('gnawer', 'west');
    g.hp = 1e5;
    let ruinedAt = -1, wasAlerted = false;
    for (let i = 0; i < 900 && ruinedAt < 0; i++) { m.step(0.1); wasAlerted ||= g.alerted; if (t.ruined) ruinedAt = i; }
    const p0 = g.progress, shots0 = t.shots, prompt = td.prompt(pad);
    for (let i = 0; i < 60; i++) m.step(0.1);
    const after = { alerted: g.alerted, progress: g.progress, shots: t.shots - shots0 };
    td.pack.clear();
    // починка
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
  expect(r.prompt).toContain('Руины');
  expect(r.after.alerted).toBe(false);
  expect(r.after.progress).toBeGreaterThan(r.p0);
  expect(r.after.shots).toBe(0);
  expect(r.menu).toContain('Починить');
  expect(r.up).toBe(false);
  expect(r.ok).toBe(true);
  expect(r.paid).toBe(r.cost);
  expect(r.hp).toBe(r.maxHp);
  expect([r.level, r.ruined]).toEqual([r.lvl, false]);
});

test('оборона: колдунчик замораживает башню — не стреляет; два удара по льду его разбивают; шпиль не мёрзнет', async ({ page }) => {
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
    // тает и сам
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
