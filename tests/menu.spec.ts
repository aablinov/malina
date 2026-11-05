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
    const m = (window as any).__malina, prof = JSON.parse(localStorage.getItem('malina.profile') ?? '{}');
    const melee = prof.items?.find((i: any) => i.uid === prof.equip?.melee);
    return { waves: m.td.waves.length, berries: m.berries, melee: melee?.def, power: melee?.power, axe: prof.items?.some((i: any) => i.uid === u), title: document.title };
  }, uid);
  // in the defence battle — a new hero's kit (src/items.ts, tdKit); the axe waits in the camp
  expect(battle).toEqual({ waves: 12, berries: 350, melee: 'sword', power: 1, axe: false, title: 'Malina — Crystal Glade' });

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

  // battle from the menu: the defence is held — the result and the "won" mark in the camp
  await page.goto(`${URL}?map=td&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => { (window as any).__malina.td.state = 'won'; });
  await expect(page.locator('.pz.open.won')).toBeVisible();
  await page.getByRole('button', { name: 'To camp' }).click();
  await page.waitForFunction(() => (window as any).__menu?.screen === 'lobby');
  await page.locator('.mm-tabs [data-pane="map"]').click();
  await expect(page.locator('.mm-map[data-map="td"] .mm-won')).toBeVisible();
  expect(errors).toEqual([]);
});
