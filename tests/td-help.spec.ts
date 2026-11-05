import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Defence hints for kids (wiki/td-playability-kids.md, top 3): raspberries are pulled from afar, and once a wave is beaten all the raspberries
 * on the ground fly to the hero; the next-wave card with hunters and a mini-boss; the "tower in trouble" signal in the HUD and on the map.
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=td';

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => { const m = (window as any).__malina; m.script(true); await m.ready; });
  expect(errors).toEqual([]);
}

test('defence: raspberry magnet at 6 m and harvest after the wave', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    // the defence's raspberry piles live in the simulation world (src/sim/pile.ts), not in the props storage yard
    const m = (window as any).__malina, td = m.td, piles = m.world.piles, V = m.hero.pos.constructor;
    m.hero.place(0, 10, 0); m.hero.god = true;
    const reach = piles.reach;
    const b0 = m.berries;
    piles.drop(new V(4.5, 0, 10), 5);
    m.step(3);
    const near = m.berries - b0;
    // far raspberries lie while the wave runs; the wave is beaten — they fly to the hero
    piles.drop(new V(-30, 0, -20), 7);
    td.callWave();
    let lying = 0;
    for (let i = 0; i < 600 && td.waveRunning; i++) {
      m.step(0.1);
      if (!td.queue.length) for (const x of td.pack.mobs) if (!x.dead && x.state !== 'spawn') x.vanish();
      lying = Math.max(lying, piles.list.length);
    }
    const b1 = m.berries;
    m.step(4);
    return { reach, near, lying, left: piles.list.length, harvested: m.berries - b1 };
  });
  expect(r.reach).toBe(6);
  expect(r.near).toBe(5);
  expect(r.lying).toBeGreaterThan(0);
  expect(r.left).toBe(0);
  expect(r.harvested).toBeGreaterThanOrEqual(7);
});

test('defence: next-wave card — hunters and a mini-boss; tower in trouble — a line with the direction and a marker on the map', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td;
    m.hero.place(0, 10, 0); m.hero.god = true;
    m.profile.data.berries = 1000;
    td.wave = 2;
    m.step(0.2);
    const card = document.querySelector('.td-preview');
    const preview = { text: card?.textContent ?? '', chief: card?.querySelector('.chief')?.textContent ?? '', hunter: card?.querySelector('.hunter')?.textContent ?? '' };
    const pad = td.pads.find((p: any) => Math.hypot(p.pos.x, p.pos.z - 10) > 15);
    const t = td.build(pad, 'arrow');
    t.hurt(10);
    m.step(0.1);
    const hurt = { text: document.querySelector('.td-alarm')?.textContent ?? '', markers: td.alarmMarkers.length };
    t.freeze(2);
    m.step(0.1);
    const frozen = document.querySelector('.td-alarm.frozen')?.textContent ?? '';
    m.step(3);
    const gone = { el: !!document.querySelector('.td-alarm'), markers: td.alarmMarkers.length };
    return { preview, hurt, frozen, gone };
  });
  expect(r.preview.text).toContain('Gardeners');
  expect(r.preview.chief).toContain('Raspberry Giant');
  expect(r.preview.hunter).toContain('Gnawer Beaver ×2');
  expect(r.hurt.text).toContain('Tower under attack');
  expect(r.hurt.text).toMatch(/\d+ m/);
  expect(r.hurt.markers).toBe(1);
  expect(r.frozen).toContain('Tower frozen');
  expect(r.gone).toEqual({ el: false, markers: 0 });
});
