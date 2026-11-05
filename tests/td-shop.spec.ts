import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * The Bush Defence sutler (wiki/design-tower-defence.md, section 12): on every map at the hero's spawn point; sells
 * weapons, bows, armour and artifacts for the battle's raspberries at prices by rarity; a purchase serves only in this battle — in the camp
 * the hero's gear is as before the battle, and the raspberries are their own.
 */

const URL = pathToFileURL(resolve('dist/index.html')).href;

test('defence: the sutler on every map, prices by rarity, buying with the battle\'s raspberries, in the camp the gear is as before the battle', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // the language is chosen up front, otherwise "To camp" lands on the language picker instead of the lobby
  await page.addInitScript(() => { try { localStorage.setItem('malina.lang', 'en'); } catch { /* storage unavailable */ } });
  // on every map the sutler exists and can be reached
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
  // the hero's gear before the battles — stashed at the first battle (in battle the hero has the defence kit)
  const camp0 = await page.evaluate(() => { const g = JSON.parse(sessionStorage.getItem('malina.stash.gear') ?? '{}'); return { items: g.items?.length, melee: g.equip?.melee, arrows: g.arrows }; });
  expect(camp0.items).toBeGreaterThan(6);
  // battle from the menu: buy an axe, equip it, return to the camp
  await page.goto(`${URL}?map=td&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const r = await page.evaluate(async () => {
    const m = (window as any).__malina, D = m.profile.data;
    await m.ready;
    const def = (uid: string | null): string => D.items.find((i: any) => i.uid === uid)?.def ?? '';
    const kit = { items: D.items.length, melee: def(D.equip.melee), armor: def(D.equip.armor), ranged: def(D.equip.ranged), arts: D.equip.artifacts.map(def), aura: D.equip.aura, power: Math.max(...D.items.map((i: any) => i.power)) };
    const before = { items: D.items.length, melee: D.equip.melee };
    m.profile.data.berries = 3000;
    const open = m.trade('sutler');
    const title = document.querySelector('.trade-head h1')?.textContent;
    m.shop.setTab('melee');
    const prices = Object.fromEntries(m.shop.list.map((w: any) => [w.key, w.price]));
    m.shop.setTab('ranged');
    const arrows = m.shop.list.find((w: any) => w.key === 'arrows')?.price;
    m.shop.setTab('spell');
    const spells = Object.fromEntries(m.shop.list.map((w: any) => [w.key, w.price]));
    m.shop.setTab('aura');
    const auras = Object.fromEntries(m.shop.list.map((w: any) => [w.key, w.price]));
    const auraBought = m.shop.buy('rage') && D.items.some((i: any) => i.def === 'rage');
    m.shop.setTab('melee');
    const b0 = m.berries;
    const bought = m.shop.buy('axe');
    const paid = b0 - m.berries;
    const axe = D.items[D.items.length - 1];
    m.profile.equip(axe.uid);
    const inBattle = { items: D.items.length, melee: D.equip.melee };
    m.shop.hide();
    m.td.state = 'won';
    return { open, title, prices, arrows, bought, paid, before, inBattle, axe: axe.uid, kit, spells, auras, auraBought };
  });
  expect(r.open).toBe(true);
  expect(r.title).toBe('Sutler');
  expect(r.prices.axe).toBe(240);
  expect(r.prices.claymore).toBe(480);
  expect(r.prices.scythe).toBe(780);
  expect(r.arrows).toBe(45);
  expect(r.bought).toBe(true);
  expect(r.paid).toBe(240);
  expect(r.inBattle).toEqual({ items: r.before.items + 2, melee: r.axe });
  // into battle — a new hero's kit of power 1
  expect(r.kit).toEqual({ items: 6, melee: 'sword', armor: 'tunic', ranged: 'bow', arts: ['fireball', 'spark', 'heal'], aura: null, power: 1 });
  // all spells and auras — for raspberries by rarity
  expect(r.spells.fireball).toBe(240);
  expect(r.spells.meteor).toBe(480);
  expect(r.spells.starfall).toBe(780);
  expect(r.spells.firewall).toBe(240);
  expect(Object.keys(r.auras).length).toBe(12);
  expect(r.auras.rage).toBe(780);
  expect(r.auraBought).toBe(true);
  await expect(page.locator('.pz.open.won')).toBeVisible();
  await page.getByRole('button', { name: 'To camp' }).click();
  await page.waitForFunction(() => (window as any).__menu?.screen === 'lobby');
  const camp = await page.evaluate((key) => { const d = JSON.parse(localStorage.getItem(key) ?? '{}'); return { items: d.items?.length, melee: d.equip?.melee, arrows: d.arrows }; }, 'malina.profile');
  expect(camp).toEqual(camp0);
  expect(errors).toEqual([]);
});
