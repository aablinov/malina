import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Bush Defence: the hero reaches every pad by click and opens its menu — with empty pads
 * and when towers already stand on all the neighbours; a pad on the ground can be approached with the keys (WASD) from almost any side —
 * rocks and walls do not surround it (wiki/design-tower-defence.md, section 2).
 */

const url = (map: string): string => pathToFileURL(resolve('dist/index.html')).href + `?dev=playground&map=${map}`;

async function open(page: Page, map: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url(map), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => { const m = (window as any).__malina; m.script(true); await m.ready; });
  expect(errors).toEqual([]);
}

/** Indices of the pads the hero did not reach by click within 25 s; full — build on all pads first */
async function unreachable(page: Page, full: boolean): Promise<number[]> {
  return page.evaluate((full) => {
    const m = (window as any).__malina, td = m.td;
    m.hero.god = true;
    td.waves.length = 0;
    m.profile.data.berries = 99999;
    if (full) for (const p of td.pads) td.build(p, 'arrow');
    const start = m.hero.pos.clone(), bad: number[] = [];
    for (const p of td.pads) {
      td.closeMenu();
      m.hero.place(start.x, start.z, 0, start.y);
      m.step(0.1);
      m.click(p.pos.x, p.pos.z, false, p.pos.y);
      m.step(0.05);
      m.release();
      let ok = false;
      for (let i = 0; i < 250 && !ok; i++) { m.step(0.1); ok = td.menuPad === p; }
      if (!ok) bad.push(p.index);
    }
    return bad;
  }, full);
}

/** Pads on the ground that cannot be approached straight with the keys from 6 m on more than one of the eight sides */
async function boxedIn(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, bad: string[] = [];
    m.hero.god = true;
    td.waves.length = 0;
    for (const p of td.pads) {
      if (p.pos.y > 0) continue; // on the castle walls — only by the stairs
      const shut: number[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4, sx = p.pos.x + Math.cos(a) * 6, sz = p.pos.z + Math.sin(a) * 6;
        m.hero.place(sx, sz, 0, m.terrain.floorAt(sx, sz, 4));
        m.step(0.05);
        let near = false;
        for (let i = 0; i < 60 && !near; i++) { m.input.move.set(-Math.cos(a), -Math.sin(a)); m.step(0.1); near = Math.hypot(m.hero.pos.x - p.pos.x, m.hero.pos.z - p.pos.z) < 2.2; }
        m.input.move.set(0, 0);
        if (!near) shut.push(k);
      }
      if (shut.length > 1) bad.push(`${p.index}: ${shut.join('')}`);
    }
    return bad;
  });
}

for (const map of ['td', 'td2', 'td3', 'td4', 'td5']) {
  test(`defence ${map}: every pad can be reached and its menu opened`, async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, map);
    expect(await boxedIn(page)).toEqual([]);
    expect(await unreachable(page, false)).toEqual([]);
    expect(await unreachable(page, true)).toEqual([]);
  });
}
