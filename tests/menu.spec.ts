import { expect, test, type Page } from '@playwright/test';
import { signIn, startGameServer, storedProfile, type GameServer } from './game-server.ts';

/**
 * Main menu (wiki/design-main-menu.md): start screen → camp (gear, map choice) → battle `?map=…&from=menu`
 * → pause → "To camp". The hero lives on the server (own server per file, tests/game-server.ts): first entry — the hero name,
 * no server — "Server unavailable". Rooms — tests/net.spec.ts.
 */

let S: GameServer;
let URL = '';
test.beforeAll(async () => { S = await startGameServer(); URL = S.url; });
test.afterAll(() => { S?.stop(); });

/** A signed-in hero on the start screen; returns its token */
async function openMenu(page: Page, errors: string[]): Promise<string> {
  page.on('pageerror', (e) => errors.push(e.message));
  const { token } = await signIn(page, S);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start', null, { timeout: 60_000 });
  return token;
}

test('menu: first entry asks for the hero name, the old browser save moves to the server; no server — retry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('malina.lang', 'en');
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('malina.profile', JSON.stringify({ version: 1, level: 6, xp: 0, points: 0, berries: 4321, souls: 0, arrows: 40, seq: 0, items: [], equip: { melee: null, ranged: null, armor: null, artifacts: [null, null, null], aura: null } }));
      }
    } catch { /* storage unavailable */ }
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const name = page.locator('.mm-boot [data-field="name"]');
  await expect(name).toBeVisible({ timeout: 60_000 });
  // a bad name — the server's answer under the field
  await page.locator('.mm-boot [data-act="login"]').click();
  await expect(page.locator('.mm-boot-err')).toContainText('2 to 16');
  await name.fill('Newcomer');
  await name.press('Enter');
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start', null, { timeout: 60_000 });
  const me = await page.evaluate(() => ({ level: (window as any).__menu.profile.data.level, berries: (window as any).__menu.profile.data.berries, old: localStorage.getItem('malina.profile'), auth: JSON.parse(localStorage.getItem('malina.net') ?? '{}') }));
  expect({ level: me.level, berries: me.berries, old: me.old }).toEqual({ level: 6, berries: 4321, old: null });
  expect((await storedProfile(S, me.auth.token)).berries).toBe(4321);
  // a reload — the same hero from the server, no name asked
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start', null, { timeout: 60_000 });
  await expect(page.locator('.mm-boot')).toHaveCount(0);

  // no server — the card with "Check again", the camp does not start
  await page.goto(`${URL}?server=http://127.0.0.1:9`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mm-boot')).toContainText('Server unavailable', { timeout: 30_000 });
  expect(await page.evaluate(() => !!(window as any).__menu)).toBe(false);
  await page.evaluate(() => localStorage.removeItem('malina.server'));
  expect(errors).toEqual([]);
});

test('menu: solo game — equip an axe in the camp, pick the glade, battle, pause and back to the camp with the raspberries', async ({ page }) => {
  const errors: string[] = [];
  const token = await openMenu(page, errors);
  await expect(page.locator('.mm-nav .mm-btn.big')).toHaveText([/Solo game/, /Online game/, /Settings/]);

  // a new axe and own raspberries in the bag
  const uid = await page.evaluate(() => {
    const p = (window as any).__menu.profile;
    p.data.berries = 777;
    const it = p.add('axe', 5);
    p.save();
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
  await expect(page.locator('.mm-map')).toHaveCount(5);
  await page.locator('.mm-map[data-map="td2"]').click();
  await expect(page.locator('.mm-card.map h3')).toHaveText('Crystal Glade');
  await page.getByRole('button', { name: /Start game/ }).click();

  await page.waitForURL(/map=td2&from=menu/);
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const prof = await storedProfile(S, token);
  const battle = await page.evaluate(([u, stored]) => {
    const m = (window as any).__malina, D = m.profile.data;
    const melee = D.items.find((i: any) => i.uid === D.equip.melee);
    return { waves: m.td.waves.length, berries: m.berries, melee: melee?.def, power: melee?.power, stored, title: document.title, uid: u };
  }, [uid, prof.berries]);
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

test('menu: the defence result — a lost battle burns the loot, a won one pays it into the stored profile and marks the map', async ({ page }) => {
  const errors: string[] = [];
  const token = await openMenu(page, errors);

  // battle from the menu: the bush withers — the loot burns, the camp raspberries are as before
  const camp0 = await page.evaluate(() => (window as any).__menu.profile.data.berries as number);
  await page.goto(`${URL}?map=td&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => { const td = (window as any).__malina.td; td.addLoot(90); td.state = 'lost'; });
  await expect(page.locator('.pz.open.lost .pz-loot')).toContainText('Loot lost: 90');
  expect((await storedProfile(S, token)).berries).toBe(camp0);
  // the defence is held — the loot goes to the camp, the result and the "won" mark
  await page.goto(`${URL}?map=td&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => { const td = (window as any).__malina.td; td.addLoot(120); td.state = 'won'; });
  await expect(page.locator('.pz.open.won .pz-loot')).toContainText('+120');
  await page.getByRole('button', { name: 'To camp' }).click();
  await page.waitForFunction(() => (window as any).__menu?.screen === 'lobby');
  expect(await page.evaluate(() => (window as any).__menu.profile.data.berries)).toBe(camp0 + 120);
  expect((await storedProfile(S, token)).berries).toBe(camp0 + 120);
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
  // the purchase is permanent: it goes to the server, after a reload it is in the profile
  await page.evaluate(() => (window as any).__menu.flush());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__menu, null, { timeout: 60_000 });
  expect(await page.evaluate((u) => (window as any).__menu.profile.data.items.some((i: any) => i.uid === u), r.uid)).toBe(true);
  expect(await page.evaluate(() => (window as any).__menu.profile.data.berries)).toBe(5000 - r.price);
  expect(errors).toEqual([]);
});
