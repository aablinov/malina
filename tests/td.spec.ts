import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Оборона куста (wiki/design-tower-defence.md, src/td/): карта с meta.td даёт площадки и казну; башня строится за малину,
 * сама бьёт врага в радиусе, улучшается и продаётся; меню площадки открывается клавишами и кликом.
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

test('оборона: площадки из карты, башня за малину бьёт врага, улучшение и продажа', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    const pad = td.pads[16];
    const b0 = m.berries;
    const none = td.build(pad, 'nope');
    const t = td.build(pad, 'arrow');
    const b1 = m.berries;
    const again = td.build(pad, 'arrow');
    const mob = td.spawn('berryling', new V(pad.pos.x + 4, 0, pad.pos.z));
    m.step(4);
    const dmg1 = t.dmg, range1 = t.range;
    const up = td.upgrade(pad);
    const b2 = m.berries;
    const back = td.sell(pad);
    return {
      pads: td.pads.length, lanes: td.spec.lanes.length, bushHp: td.spec.bush.hp,
      none, built: !!t, again, cost: b0 - b1, shots: t.shots, dealt: t.dealt, mobDead: mob.dead,
      up, upCost: b1 - b2, dmg: [dmg1, t.dmg], range: [range1, t.range], level: t.level,
      back, berries: m.berries, towers: td.towers.length, free: pad.free, solids: m.solids.length,
    };
  });
  expect(r.pads).toBe(17);
  expect(r.lanes).toBe(3);
  expect(r.bushHp).toBeGreaterThan(0);
  expect(r.none).toBeNull();
  expect(r.built).toBe(true);
  expect(r.again).toBeNull();
  expect(r.cost).toBe(60);
  expect(r.shots).toBeGreaterThan(2);
  expect(r.dealt).toBeGreaterThan(10);
  expect(r.mobDead).toBe(true);
  expect(r.up).toBe(true);
  expect(r.upCost).toBe(42);
  expect(r.dmg[1]).toBeGreaterThan(r.dmg[0]);
  expect(r.range[1]).toBeGreaterThan(r.range[0]);
  expect(r.level).toBe(2);
  expect(r.back).toBe(Math.round(102 * 0.7));
  expect(r.berries).toBe(300 - 60 - 42 + r.back);
  expect(r.towers).toBe(0);
  expect(r.free).toBe(true);
});

test('оборона: нет малины — нет башни; меню площадки по F и по клику, цифра строит', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td;
    m.profile.data.berries = 10;
    const poor = td.build(td.pads[0], 'arrow');
    m.profile.data.berries = 500;
    // F рядом с площадкой — меню; цифра 1 — стрелковая вышка; меню закрылось
    const pad = td.pads[15];
    m.hero.place(pad.pos.x + 1.7, pad.pos.z, Math.PI);
    m.interact(); m.step(0.1);
    const open1 = td.menuOpen;
    const key = td.key(new KeyboardEvent('keydown', { code: 'Digit1' }));
    const built = pad.tower?.kind ?? null;
    const closed = !td.menuOpen;
    // клик по площадке издалека: герой идёт к ней и открывает меню
    const far = td.pads[14];
    m.hero.place(far.pos.x + 7, far.pos.z, Math.PI);
    m.click(far.pos.x, far.pos.z);
    m.step(0.1);
    m.release();
    let opened = false;
    for (let i = 0; i < 80 && !opened; i++) { m.step(0.1); opened = td.menuOpen && td.menuPad === far; }
    const dist = Math.hypot(m.hero.pos.x - far.pos.x, m.hero.pos.z - far.pos.z);
    // Esc закрывает
    td.key(new KeyboardEvent('keydown', { code: 'Escape' }));
    return { poor, open1, key, built, closed, opened, dist, esc: !td.menuOpen, hud: document.querySelector('.td-hud')?.textContent ?? '' };
  });
  expect(r.poor).toBeNull();
  expect(r.open1).toBe(true);
  expect(r.key).toBe(true);
  expect(r.built).toBe('arrow');
  expect(r.closed).toBe(true);
  expect(r.opened).toBe(true);
  expect(r.dist).toBeLessThan(2.4);
  expect(r.esc).toBe(true);
  expect(r.hud).toContain('башен');
});
