import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Маркитант обороны куста (wiki/design-tower-defence.md, раздел 12): на каждой карте у точки появления героя; продаёт
 * оружие, луки, броню и артефакты за малину боя по ценам по редкости; купленное служит только в этом бою — в лагере
 * снаряжение героя как до боя, а малина своя.
 */

const URL = pathToFileURL(resolve('dist/index.html')).href;

test('оборона: маркитант на всех картах, цены по редкости, покупка за малину боя, в лагере снаряжение как до боя', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // на каждой карте маркитант есть и до него можно дойти
  for (const map of ['td2', 'td3']) {
    await page.goto(`${URL}?dev=playground&map=${map}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
    const ok = await page.evaluate(async () => {
      const m = (window as any).__malina;
      m.script(true);
      await m.ready;
      const s = m.merchants.find((x: any) => x.kind === 'sutler');
      const p = m.pathfinder.find(m.hero.pos, s.front, { solids: m.solids });
      const end = p[p.length - 1];
      return !!s && Math.hypot(end.x - s.front.x, end.z - s.front.z) < 1.2 && m.trade('sutler');
    });
    expect(ok, map).toBe(true);
  }
  // бой из меню: купить топор, надеть, вернуться в лагерь
  await page.goto(`${URL}?map=td&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const r = await page.evaluate(async () => {
    const m = (window as any).__malina, D = m.profile.data;
    await m.ready;
    const before = { items: D.items.length, melee: D.equip.melee, arrows: D.arrows };
    const open = m.trade('sutler');
    const title = document.querySelector('.trade-head h1')?.textContent;
    m.shop.setTab('melee');
    const prices = Object.fromEntries(m.shop.list.map((w: any) => [w.key, w.price]));
    m.shop.setTab('ranged');
    const arrows = m.shop.list.find((w: any) => w.key === 'arrows')?.price;
    m.shop.setTab('melee');
    const b0 = m.berries;
    const bought = m.shop.buy('axe');
    const paid = b0 - m.berries;
    const axe = D.items[D.items.length - 1];
    m.profile.equip(axe.uid);
    const inBattle = { items: D.items.length, melee: D.equip.melee };
    m.shop.hide();
    m.td.state = 'won';
    return { open, title, prices, arrows, bought, paid, before, inBattle, axe: axe.uid };
  });
  expect(r.open).toBe(true);
  expect(r.title).toBe('Маркитант');
  expect(r.prices.axe).toBe(80);
  expect(r.prices.claymore).toBe(160);
  expect(r.prices.scythe).toBe(260);
  expect(r.arrows).toBe(15);
  expect(r.bought).toBe(true);
  expect(r.paid).toBe(80);
  expect(r.inBattle).toEqual({ items: r.before.items + 1, melee: r.axe });
  await expect(page.locator('.pz.open.won')).toBeVisible();
  await page.getByRole('button', { name: 'В лагерь' }).click();
  await page.waitForFunction(() => (window as any).__menu?.screen === 'lobby');
  const camp = await page.evaluate((key) => { const d = JSON.parse(localStorage.getItem(key) ?? '{}'); return { items: d.items?.length, melee: d.equip?.melee, arrows: d.arrows }; }, 'malina.profile');
  expect(camp).toEqual(r.before);
  expect(errors).toEqual([]);
});
