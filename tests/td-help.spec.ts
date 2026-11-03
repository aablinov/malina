import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Подсказки обороны для детей (wiki/td-playability-kids.md, топ-3): малину тянет издалека, а волна отбита — вся малина
 * на земле летит к герою; карточка следующей волны с охотниками и мини-боссом; сигнал «башня в беде» в HUD и на карте.
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

test('оборона: магнит малины в 6 м и сбор урожая после волны', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    // кучки малины обороны — в мире симуляции (src/sim/pile.ts), не в складе props
    const m = (window as any).__malina, td = m.td, piles = m.world.piles, V = m.hero.pos.constructor;
    m.hero.place(0, 10, 0); m.hero.god = true;
    const reach = piles.reach;
    const b0 = m.berries;
    piles.drop(new V(4.5, 0, 10), 5);
    m.step(3);
    const near = m.berries - b0;
    // далёкая малина лежит, пока волна идёт; волна отбита — летит к герою
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

test('оборона: карточка следующей волны — охотники и мини-босс; башня в беде — строка с направлением и метка на карте', async ({ page }) => {
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
  expect(r.preview.text).toContain('Садовники');
  expect(r.preview.chief).toContain('Малиновый великан');
  expect(r.preview.hunter).toContain('Бобёр-грызун ×2');
  expect(r.hurt.text).toContain('Башню грызут');
  expect(r.hurt.text).toMatch(/\d+ м/);
  expect(r.hurt.markers).toBe(1);
  expect(r.frozen).toContain('Башню заморозили');
  expect(r.gone).toEqual({ el: false, markers: 0 });
});
