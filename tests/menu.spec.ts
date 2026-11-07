import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Main menu (wiki/design-main-menu.md): start screen → camp (gear, map choice) → battle `?map=…&from=menu`
 * → pause → "To camp". Online game without a server: start is closed (with a server — tests/net.spec.ts).
 */

const URL = pathToFileURL(resolve('dist/index.html')).href;

async function openMenu(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  // the language is chosen up front, otherwise the start screen shows the language picker
  await page.addInitScript(() => { try { localStorage.setItem('malina.lang', 'en'); } catch { /* storage unavailable */ } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start');
}

test('menu: solo game — equip an axe in the camp, pick the glade, battle, pause and back to the camp with the raspberries', async ({ page }) => {
  const errors: string[] = [];
  await openMenu(page, errors);
  await expect(page.locator('.mm-nav .mm-btn.big')).toHaveText([/Solo game/, /Online game/, /Settings/]);

  // a new axe and own raspberries in the bag
  const uid = await page.evaluate(() => {
    const p = (window as any).__menu.profile;
    p.data.berries = 777;
    const it = p.add('axe', 5);
    return it.uid as string;
  });

  await page.getByRole('button', { name: 'Solo game' }).click();
  await page.waitForFunction(() => (window as any).__menu.screen === 'lobby');
  await expect(page.locator('.mm-lobby.open')).toBeVisible();
  await expect(page.locator('.mm-slot')).toHaveCount(7);

  // double click on the melee slot — the inventory on that tab, double click on the axe — equip
  await page.locator('.mm-slot[data-slot="melee"]').dblclick();
  await expect(page.locator('.inv.open')).toBeVisible();
  await page.locator(`.inv.open .inv-grid .it[data-uid="${uid}"]`).dblclick();
  await page.keyboard.press('Escape');
  await expect(page.locator('.inv.open')).toHaveCount(0);
  await expect(page.locator('.mm-slot[data-slot="melee"] .it-pw')).toHaveText('5');

  // map — the crystal glade, to battle
  await page.locator('.mm-tabs [data-pane="map"]').click();
  await expect(page.locator('.mm-map')).toHaveCount(3);
  await page.locator('.mm-map[data-map="td2"]').click();
  await expect(page.locator('.mm-card.map h3')).toHaveText('Crystal Glade');
  await page.getByRole('button', { name: /Start game/ }).click();

  await page.waitForURL(/map=td2&from=menu/);
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const battle = await page.evaluate((u) => {
    const m = (window as any).__malina, D = m.profile.data, prof = JSON.parse(localStorage.getItem('malina.profile') ?? '{}');
    const melee = D.items.find((i: any) => i.uid === D.equip.melee);
    return { waves: m.td.waves.length, berries: m.berries, melee: melee?.def, power: melee?.power, stored: prof.berries, title: document.title, uid: u };
  }, uid);
  // into the defence battle — the hero's own gear (the axe), the map's treasury; the stored profile keeps its raspberries (Profile.enterBattle)
  expect(battle).toEqual({ waves: 12, berries: 350, melee: 'axe', power: 5, stored: 777, title: 'Malina — Crystal Glade', uid });

  // Esc — pause, time stands still; "Leave to camp" — back, the hero's raspberries are intact
  await page.keyboard.press('Escape');
  await expect(page.locator('.pz.open')).toBeVisible();
  await page.getByRole('button', { name: 'Leave to camp' }).click();
  await page.waitForURL(/menu=lobby/);
  await page.waitForFunction(() => (window as any).__menu?.screen === 'lobby');
  expect(await page.evaluate(() => (window as any).__menu.profile.data.berries)).toBe(777);
  expect(await page.evaluate(() => (window as any).__menu.profile.data.equip.melee)).toBe(uid);
  expect(errors).toEqual([]);
});

test('menu: online game without a server — start is closed; the defence result marks the map as won', async ({ page }) => {
  const errors: string[] = [];
  await openMenu(page, errors);
  await page.getByRole('button', { name: /Online game/ }).click();
  await page.waitForFunction(() => (window as any).__menu.screen === 'lobby');
  await page.locator('.mm-tabs [data-pane="map"]').click();
  await expect(page.locator('.mm-online')).toBeVisible();
  await expect(page.locator('.mm-online')).toContainText('Server unavailable');
  await page.getByRole('button', { name: /Start game/ }).click();
  await expect(page.locator('.mm-hint.warn')).toContainText('The online game server is unavailable');
  expect(page.url()).not.toContain('map=');

  // battle from the menu: the bush withers — the loot burns, the camp raspberries are as before
  const camp0 = await page.evaluate(() => (window as any).__menu.profile.data.berries as number);
  await page.goto(`${URL}?map=td&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => { const td = (window as any).__malina.td; td.addLoot(90); td.state = 'lost'; });
  await expect(page.locator('.pz.open.lost .pz-loot')).toContainText('Loot lost: 90');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('malina.profile') ?? '{}').berries)).toBe(camp0);
  // the defence is held — the loot goes to the camp, the result and the "won" mark
  await page.goto(`${URL}?map=td&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => { const td = (window as any).__malina.td; td.addLoot(120); td.state = 'won'; });
  await expect(page.locator('.pz.open.won .pz-loot')).toContainText('+120');
  await page.getByRole('button', { name: 'To camp' }).click();
  await page.waitForFunction(() => (window as any).__menu?.screen === 'lobby');
  expect(await page.evaluate(() => (window as any).__menu.profile.data.berries)).toBe(camp0 + 120);
  await page.locator('.mm-tabs [data-pane="map"]').click();
  await expect(page.locator('.mm-map[data-map="td"] .mm-won')).toBeVisible();
  expect(errors).toEqual([]);
});

test('menu: camp shop — buying with the account raspberries, the item stays after a reload and goes into battle', async ({ page }) => {
  const errors: string[] = [];
  await openMenu(page, errors);
  await page.evaluate(() => { const p = (window as any).__menu.profile; p.data.berries = 5000; p.save(); });
  await page.getByRole('button', { name: 'Solo game' }).click();
  await page.waitForFunction(() => (window as any).__menu.screen === 'lobby');
  // the "Gear" tab: the shop button and the defence strength under the gear power
  await expect(page.locator('.mm-power small')).toContainText(/strength \d+/);
  await page.locator('[data-act="shop"]').click();
  await expect(page.locator('.trade.open')).toBeVisible();
  const r = await page.evaluate(() => {
    const { lobby, profile } = (window as any).__menu;
    lobby.shop.setTab('melee');
    const w = lobby.shop.list[0];
    const before = profile.data.berries, n = profile.data.items.length;
    const ok = lobby.shop.buy(w.key);
    const it = profile.data.items[profile.data.items.length - 1];
    return { ok, paid: before - profile.data.berries, price: w.price, added: profile.data.items.length - n, uid: it.uid, def: it.def, key: w.key };
  });
  expect(r.ok).toBe(true);
  expect(r.paid).toBe(r.price);
  expect(r.added).toBe(1);
  expect(r.def).toBe(r.key);
  await page.keyboard.press('Escape');
  await expect(page.locator('.trade.open')).toHaveCount(0);
  // the purchase is permanent: after a reload it is in the stored profile
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__menu);
  expect(await page.evaluate((u) => (window as any).__menu.profile.data.items.some((i: any) => i.uid === u), r.uid)).toBe(true);
  expect(await page.evaluate(() => (window as any).__menu.profile.data.berries)).toBe(5000 - r.price);
  expect(errors).toEqual([]);
});
