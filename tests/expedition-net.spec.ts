import { expect, test, type Page } from '@playwright/test';
import { signIn, startGameServer, type GameServer } from './game-server.ts';

/**
 * Expeditions from the camp (wiki/design-expeditions.md, section 2): the "Expeditions" tab — the day's board, the difficulty,
 * the mission card with the map sketch and the landing choice; a solo start; a room for two where the server runs the mission
 * (src/game/match.ts) and both pages follow it from snapshots
 */
let S: GameServer;
let URL = '';
test.beforeAll(async () => { S = await startGameServer(); URL = S.url; });
test.afterAll(() => { S?.stop(); });

test('expeditions: the board in the camp — the ladder, a camp bed, an operation, a landing on the sketch; solo start lands the hero there', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, S);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start', null, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Solo game' }).click();
  await page.waitForFunction(() => (window as any).__menu.screen === 'lobby');
  // parcels under the gear: three slots, a click puts the next kind in, the choice is stored with the hero
  await expect(page.locator('.mm-parcels [data-parcel]')).toHaveCount(3);
  await expect(page.locator('.mm-parcels [data-parcel="0"]')).toContainText('Archer tower');
  await page.locator('.mm-parcels [data-parcel="0"]').click();
  await expect(page.locator('.mm-parcels [data-parcel="0"]')).toContainText('Frost spire');
  expect(await page.evaluate(() => (window as any).__menu.profile.data.parcels)).toEqual(['tower:frost', 'volley', 'heal']);
  await page.locator('[data-pane="missions"]').click();
  await expect(page.locator('.mm-exp-diff [data-diff]')).toHaveCount(8);
  await expect(page.locator('.mm-maps .mm-map')).toHaveCount(3);
  // the ladder: difficulty 2 is locked until a mission of difficulty 1 is won
  await page.locator('.mm-exp-diff [data-diff="2"]').click();
  await expect(page.locator('.mm-hint')).toContainText('difficulty 1 first');
  // seeds in the bag: a camp bed is planted with them; the order of the day is on the board
  await page.evaluate(() => { const m = (window as any).__menu; m.profile.data.expLevel = 2; m.profile.data.seeds = { common: 5, rare: 0, golden: 0 }; m.profile.save(); m.lobby.render(); });
  await expect(page.locator('.mm-exp-order')).toContainText('reward');
  await page.locator('[data-bed="stash"]').click();
  expect(await page.evaluate(() => { const d = (window as any).__menu.profile.data; return [d.beds.stash, d.seeds.common]; })).toEqual([1, 1]);
  await page.locator('[data-bed="totem"]').click();
  await expect(page.locator('.mm-hint')).toContainText('Not enough seeds');
  await page.locator('.mm-exp-diff [data-diff="2"]').click();
  // an operation: its first mission, the chain and the modifiers on the card
  const tile = page.locator('.mm-maps .mm-map').first();
  const id = await tile.getAttribute('data-map');
  expect(id).toMatch(/^exp:\d+:2:(lairs|beacons|bush):0:\d+\.0$/);
  await tile.click();
  await expect(tile).toHaveClass(/sel/);
  await expect(page.locator('.mm-card.map')).toContainText('difficulty 2');
  await expect(page.locator('.mm-exp-chain')).toContainText('Mission 1 of');
  await expect(page.locator('.mm-exp-map .land')).toHaveCount(3);
  // the third landing on the sketch: the mission stays, its id gets the landing
  await page.locator('.mm-exp-map [data-landing="2"]').click();
  await expect(page.locator('.mm-exp-map .land.on text')).toHaveText('3');
  await expect(tile).toHaveClass(/sel/);
  expect(await tile.getAttribute('data-map')).toBe(id!.replace(/:0:(\d+\.0)$/, ':2:$1'));
  await page.locator('[data-act="start"]').click();
  await page.waitForURL(/map=exp/);
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground' && (window as any).__malina.exp, null, { timeout: 60_000 });
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, s = m.exp.sim, l = s.spec.landings[2];
    return { purse: s.berries(0), mods: s.spec.mods.length, parcels: s.parcels.loadout(0), landing: s.spec.landing, d: s.spec.difficulty, near: Math.hypot(m.hero.pos.x - l.x, m.hero.pos.z - l.z) < 2, title: document.title };
  });
  // the stash bed gave the starting raspberries; the operation's modifiers reached the mission
  expect(r).toEqual({ purse: 25, mods: expect.any(Number), parcels: ['tower:frost', 'volley', 'heal'], landing: 2, d: 2, near: true, title: expect.stringContaining('Expedition') });
  expect(errors).toEqual([]);
});

async function lobby(page: Page, errors: string[], name: string): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('malina.lang', 'en'); } catch { /* storage unavailable */ } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const field = page.locator('.mm-boot [data-field="name"]');
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(name);
  await field.press('Enter');
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start', null, { timeout: 120_000, polling: 500 });
  await page.getByRole('button', { name: /Online game/ }).click();
  await expect(page.locator('.mm-online')).toContainText(name);
}

test('expeditions: a room for two — the host picks a mission, the server runs it, both pages mirror the same mission', async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await lobby(host, errors, 'Leader');
  await lobby(guest, errors, 'Scout');
  await host.locator('.mm-online [data-act="host"]').click();
  const code = (await host.locator('.mm-code').textContent())?.trim() ?? '';
  // the host picks the first operation of difficulty 1 on the board
  await host.locator('[data-pane="missions"]').click();
  await host.locator('.mm-exp-diff [data-diff="1"]').click();
  await host.locator('.mm-maps .mm-map').first().click();
  await guest.locator('[data-act="refresh"]').first().click();
  const row = guest.locator(`.mm-browser tr[data-room="${code}"]`);
  await expect(row).toContainText('Expedition');
  await row.locator('[data-act="join-room"]').click();
  await expect(guest.locator('.mm-seat')).toHaveCount(2 + 2);
  await guest.locator('[data-act="start"]').click();
  await expect(host.locator('.mm-seats')).toContainText('ready');
  await host.locator('[data-act="start"]').click();
  for (const p of [host, guest]) {
    await p.waitForURL(/map=exp/);
    await p.waitForFunction(() => (window as any).__malina?.mode === 'playground' && (window as any).__malina.exp);
    await p.waitForFunction(() => (window as any).__malina.net?.joined && (window as any).__malina.net.snaps > 5, null, { timeout: 60_000 });
    await p.waitForFunction(() => (window as any).__malina.net.othersInfo.length === 1, null, { timeout: 30_000 });
  }
  // the mission came with the snapshots: lairs and beacons on both pages, nothing posted locally
  for (const p of [host, guest]) {
    await p.waitForFunction(() => (window as any).__malina.exp.sim.nests.every((n: any) => n.maxHp > 0) && (window as any).__malina.exp.sim.totems > 0, null, { timeout: 30_000 });
  }
  // both pages show the same mission: the same lairs with the server's health, the pad idle, an empty purse
  const seen = await Promise.all([host, guest].map((p) => p.evaluate(() => {
    const s = (window as any).__malina.exp.sim;
    return { lairs: s.nests.map((n: any) => [n.pos.x, n.pos.z, n.hp]), beacons: s.beacons.map((b: any) => b.state), pad: s.extraction.state, primary: s.primary, state: s.state };
  })));
  expect(seen[0]).toEqual(seen[1]);
  expect(seen[0].pad).toBe('idle');
  // the guest's "use" goes to the server (the page only mirrors the rules); on the landing there is nothing to use, so nothing changes
  expect(await guest.evaluate(() => { const m = (window as any).__malina; return [m.exp.sim.usable(m.exp.seat), m.exp.use()]; })).toEqual([null, true]);
  await guest.waitForTimeout(500);
  expect(await host.evaluate(() => (window as any).__malina.exp.sim.extraction.state)).toBe('idle');
  expect(errors).toEqual([]);
});
