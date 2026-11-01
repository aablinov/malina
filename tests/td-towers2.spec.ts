import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Дорогие башни по площади (wiki/design-tower-defence.md, раздел 14): звездочёт — метеорит в самую плотную толпу;
 * грозовой шпиль — молния цепью по 6 врагам (больше с уровнем); сердце зимы — вьюга: урон и замедление всем рядом,
 * каждый пятый удар — ледяная волна с оглушением (мини-босса — нет). Меню: клавиши по месту — на лаве 1–8, на замке 1–9 и 0.
 */

const url = (map: string): string => pathToFileURL(resolve('dist/index.html')).href + `?dev=playground&map=${map}`;

async function open(page: Page, map = 'td'): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url(map), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => {
    const m = (window as any).__malina;
    m.script(true);
    await m.ready;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    m.profile.data.berries = 5000;
    m.td.waves.length = 0;
  });
  expect(errors).toEqual([]);
}

test('оборона: звездочёт бьёт в самую толпу — все в ней ранены; грозовой шпиль — цепью по шестерым', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    // вдали от куста: враги стоят
    const pad = td.pads[0], at = (dx: number, dz: number) => new V(pad.pos.x + dx, 0, pad.pos.z + dz);
    const t = td.build(pad, 'meteor');
    const lone = td.spawn('ram', at(-8, 0));
    const crowd = [[6, 0], [7, 1], [6, -1], [7.5, -0.5], [6.5, 1.5]].map(([x, z]) => td.spawn('ram', at(x, z)));
    for (const x of [lone, ...crowd]) x.hp = x.maxHp = 1e5;
    m.step(2.5);
    const meteor = { title: t.title, shots: t.shots, crowdHit: crowd.filter((x: any) => x.hp < 1e5).length, loneHit: lone.hp < 1e5, burning: t.burning };
    td.sell(pad);
    td.pack.clear();
    const line = [4, 6, 8, 10, 12, 14, 16].map((dx) => td.spawn('ram', at(dx, 0)));
    for (const x of line) x.hp = x.maxHp = 1e5;
    m.step(0.6); // вылезли из земли
    const s = td.build(pad, 'storm');
    m.step(1);
    return { meteor, storm: { title: s.title, shots: s.shots, hit: line.filter((x: any) => x.hp < 1e5).length } };
  });
  expect(r.meteor.title).toBe('Звездочёт I');
  expect(r.meteor.shots).toBe(1);
  expect(r.meteor.crowdHit).toBe(5);
  expect(r.meteor.loneHit).toBe(false);
  expect(r.meteor.burning).toBeGreaterThanOrEqual(5);
  expect(r.storm.title).toBe('Грозовой шпиль I');
  expect(r.storm.shots).toBe(1);
  expect(r.storm.hit).toBe(6);
});

test('оборона: сердце зимы — урон и замедление всем рядом, пятый удар оглушает, кроме мини-босса', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    const gp = td.pads[0], w = td.build(gp, 'winter');
    const s1 = td.spawn('gardener', new V(gp.pos.x + 3, 0, gp.pos.z)), s2 = td.spawn('ram', new V(gp.pos.x, 0, gp.pos.z + 3)), ch = td.spawn('chief_brute', new V(gp.pos.x - 3.5, 0, gp.pos.z));
    for (const x of [s1, s2, ch]) x.hp = x.maxHp = 1e5;
    m.step(1.5);
    const first = { hurt: [s1, s2, ch].every((x: any) => x.hp < 1e5), chilled: [s1, s2, ch].every((x: any) => x.chillT > 0) };
    let states: string[] = [];
    for (let i = 0; i < 200 && w.shots < 5; i++) m.step(0.05);
    m.step(0.05);
    states = [s1, s2, ch].map((x: any) => x.state);
    return { title: w.title, first, shots: w.shots, states };
  });
  expect(r.title).toBe('Сердце зимы I');
  expect(r.first).toEqual({ hurt: true, chilled: true });
  expect(r.shots).toBe(5);
  expect(r.states.slice(0, 2)).toEqual(['daze', 'daze']);
  expect(r.states[2]).not.toBe('daze');
});

test('оборона: меню площадки — клавиши по месту: на лаве восемь башен 1–8, на замке десять 1–9 и 0', async ({ page }) => {
  await open(page);
  const lava = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, pad = td.pads[16];
    td.openMenu(pad);
    const keys = [...td.menuEl.querySelectorAll('.td-card kbd')].map((k: any) => k.textContent);
    td.key(new KeyboardEvent('keydown', { code: 'Digit8' }));
    return { keys, built: pad.tower?.kind };
  });
  expect(lava).toEqual({ keys: ['1', '2', '3', '4', '5', '6', '7', '8'], built: 'winter' });
  await open(page, 'td3');
  const castle = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, pad = td.pads.find((p: any) => p.pos.y === 0);
    td.openMenu(pad);
    const keys = [...td.menuEl.querySelectorAll('.td-card kbd')].map((k: any) => k.textContent);
    td.key(new KeyboardEvent('keydown', { code: 'Digit0' }));
    return { keys, built: pad.tower?.kind };
  });
  expect(castle).toEqual({ keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], built: 'oil' });
});
