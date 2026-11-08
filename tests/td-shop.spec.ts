import { expect, test } from '@playwright/test';
import { signIn, startGameServer, storedProfile, type GameServer } from './game-server.ts';

/**
 * The Bush Defence sutler (wiki/design-tower-defence.md, section 12): on every map at the hero's spawn point; sells
 * weapons, bows, armour and artifacts for the battle's raspberries at prices by rarity; a purchase serves only in this battle — in the camp
 * the hero's gear is as before the battle, and the raspberries are their own.
 */

let S: GameServer;
let URL = '';
test.beforeAll(async () => { S = await startGameServer(); URL = S.url; });
test.afterAll(() => { S?.stop(); });

test('defence: the sutler on every map, prices by rarity, buying with the battle\'s raspberries, in the camp the gear is as before the battle', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // a hero on the server (and the language — otherwise "To camp" lands on the language picker instead of the lobby)
  const { token } = await signIn(page, S);
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
  // the hero's gear in the camp — the stored profile is not touched by battles (Profile.enterBattle)
  const kitOf = (g: any): { items: number; melee: string; arrows: number } => ({ items: g.items?.length, melee: g.equip?.melee, arrows: g.arrows });
  const camp0 = kitOf(await storedProfile(S, token));
  expect(camp0.items).toBeGreaterThan(6);
  // battle from the menu: buy an axe, equip it, return to the camp
  await page.goto(`${URL}?map=td&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground', null, { timeout: 60_000 });
  const r = await page.evaluate(async () => {
    const m = (window as any).__malina, D = m.profile.data;
    await m.ready;
    const def = (uid: string | null): string => D.items.find((i: any) => i.uid === uid)?.def ?? '';
    const kit = { items: D.items.length, melee: D.equip.melee };
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
    // restart: the sutler's goods are gone, the battle copy is taken anew from the stored profile
    m.td.reset();
    const restarted = { items: m.profile.data.items.length, melee: m.profile.data.equip.melee, axe: m.profile.data.items.some((i: any) => i.uid === axe.uid), berries: m.berries };
    m.td.state = 'won';
    return { restarted, open, title, prices, arrows, bought, paid, before, inBattle, axe: axe.uid, kit, spells, auras, auraBought };
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
  // into battle — the hero's own gear, as in the camp
  expect(r.kit).toEqual({ items: camp0.items, melee: camp0.melee });
  expect(r.restarted).toEqual({ items: camp0.items, melee: camp0.melee, axe: false, berries: 300 });
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
  await page.waitForFunction(() => (window as any).__menu?.screen === 'lobby', null, { timeout: 60_000 });
  expect(kitOf(await page.evaluate(() => (window as any).__menu.profile.data))).toEqual(camp0);
  expect(kitOf(await storedProfile(S, token))).toEqual(camp0);
  expect(errors).toEqual([]);
});
