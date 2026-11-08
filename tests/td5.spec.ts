import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Misty Clearing — Bush Defence 5 (wiki/design-tower-defence.md, section 18): the map `td5` with no roads and endless waves —
 * eight directions out of the mist ring, four pads by the bush, lanterns the hero lights with F (src/sim/fog.ts),
 * the mist view with the beacon's beam (src/td/fog-fx.ts).
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=td5';

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => { const m = (window as any).__malina; m.script(true); await m.ready; });
  expect(errors).toEqual([]);
}

test('misty clearing: map td5 — eight directions out of the mist, four pads, eight lanterns, endless waves, the mist view', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, s = m.sim, spec = s.spec;
    return {
      name: m.level.name, pads: s.pads.length, lanes: spec.lanes.length, endless: s.endless, lanterns: s.fog.lanterns.length,
      puffs: m.fogFx.count, weather: m.level.meta.world.weather.kind, sutler: m.level.meta.merchants?.[0]?.kind,
    };
  });
  expect(r).toEqual({ name: 'Misty Clearing', pads: 4, lanes: 8, endless: true, lanterns: 8, puffs: expect.any(Number), weather: 'fireflies', sutler: 'sutler' });
  expect(r.puffs).toBeGreaterThan(150);
});

test('misty clearing: F lights a lantern and clears the mist around it; waves go past the map\'s ten without a victory', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, s = m.sim, l = s.fog.lanterns[2];
    m.hero.place(l.x + 1, l.z, 0);
    const before = m.fogFx.clear(l.x + 3, l.z);
    m.interact();
    m.step(1.5);
    const lit = l.lit, after = m.fogFx.clear(l.x + 3, l.z);
    // jump to wave 11: the generator continues, the HUD shows no "of"
    s.wave = 10;
    const ok = s.command(0, { t: 'td', a: 'wave' });
    m.step(0.5);
    return { before, lit, after, ok, wave: s.wave, state: s.state, hud: document.querySelector('.td-hud .td-wave')?.textContent ?? '' };
  });
  expect(r.lit).toBe(true);
  expect(r.after).toBeGreaterThan(r.before);
  expect(r.ok).toBe(true);
  expect(r.wave).toBe(11);
  expect(r.state).toBe('play');
  expect(r.hud).not.toMatch(/ of | из /);
});
