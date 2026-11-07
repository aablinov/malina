import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Online game (wiki/design-multiplayer.md): a real server (server/main.ts, in-memory database) and two browsers.
 * The server itself serves the game (`STATIC=dist`): file:// pages share storage between contexts, and the heroes need their own.
 * The host logs in by name and creates a room, the guest logs in by code and marks itself ready, "Start game" at the host —
 * both pages go into battle. The server runs the battle: both pages receive snapshots over /game, the guest's hero moves by its input
 * and is seen by the host, the guest builds a tower from its own raspberries — the tower is at both, a wave — enemy puppets at both, names above the heroes
 */
const PORT = 8791;
const SERVER = `http://127.0.0.1:${PORT}`;
const URL = `${SERVER}/`;
let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: ':memory:', STATIC: 'dist' }, stdio: 'pipe' });
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('the server did not start')), 10_000);
    server.stdout?.on('data', (b: Buffer) => { if (String(b).includes('server at')) { clearTimeout(timer); ok(); } });
    server.stderr?.on('data', (b: Buffer) => process.stderr.write(b));
  });
});
test.afterAll(() => { server?.kill(); });

async function lobby(page: Page, errors: string[], name: string): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  // the language is chosen up front, otherwise the start screen shows the language picker
  await page.addInitScript(() => { try { localStorage.setItem('malina.lang', 'en'); } catch { /* storage unavailable */ } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start', null, { timeout: 60_000 });
  await page.getByRole('button', { name: /Online game/ }).click();
  // the login panel waits for the server's reply; under parallel runs the cold start is long
  await expect(page.locator('.mm-online [data-field="name"]')).toBeVisible({ timeout: 60_000 });
  await page.locator('.mm-online [data-field="name"]').fill(name);
  await page.locator('.mm-online [data-act="login"]').click();
  await expect(page.locator('.mm-online')).toContainText(name);
}

test('net: login by name, room by code, readiness, server battle for two', async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await lobby(host, errors, 'Hostess');
  await lobby(guest, errors, 'Guest');

  await host.locator('.mm-online [data-act="host"]').click();
  const code = (await host.locator('.mm-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[1-9]\d{4}$/);
  await guest.locator('.mm-online [data-field="code"]').fill(code);
  await guest.locator('.mm-online [data-field="code"]').press('Enter');
  await expect(guest.locator('.mm-seat')).toHaveCount(2 + 2);
  await expect(guest.locator('[data-act="start"]')).toContainText('Ready');
  await guest.locator('[data-act="start"]').click();
  await expect(host.locator('.mm-seats')).toContainText('ready');

  await host.locator('[data-act="start"]').click();
  for (const p of [host, guest]) {
    await p.waitForURL(/map=td/);
    expect(p.url()).toContain('players=2');
    expect(p.url()).toContain(`room=${code}`);
    await p.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  }
  // a room in battle with free seats stays in the list — a running battle can be joined
  const rooms = (await (await fetch(`${SERVER}/api/rooms`)).json()) as { state: string }[];
  expect(rooms.map((r) => r.state)).toEqual(['battle']);

  // both pages are in the server battle: snapshots flow, each sees the other hero
  for (const p of [host, guest]) {
    await p.waitForFunction(() => (window as any).__malina.net?.joined && (window as any).__malina.net.snaps > 5, null, { timeout: 60_000 });
    await p.waitForFunction(() => (window as any).__malina.net.othersInfo.length === 1, null, { timeout: 30_000 });
  }
  // the guest walks — at the host its hero follows
  const at0 = await host.evaluate(() => { const a = (window as any).__malina.net.othersInfo[0]; return [a.x, a.z]; });
  await guest.evaluate(() => { const m = (window as any).__malina; m.script(true); m.input.move.set(0.7, 0.7); });
  await host.waitForFunction(([x, z]) => { const a = (window as any).__malina.net.othersInfo[0]; return Math.hypot(a.x - x, a.z - z) > 2; }, at0, { timeout: 30_000 });
  await guest.evaluate(() => (window as any).__malina.input.move.set(0, 0));
  // and the guest itself moved: the server confirmed its position
  // names above the heroes: each sees its own and the other's
  for (const p of [host, guest]) await expect(p.locator('.net-name')).toHaveCount(2);
  await expect(guest.locator('.net-name.me')).toHaveText('Guest');

  // each has its own raspberries: the guest builds a tower from its own, the host's treasury is unchanged; the tower — at both
  const hostBerries = await host.evaluate(() => (window as any).__malina.td.berries);
  const guestBerries = await guest.evaluate(() => (window as any).__malina.td.berries);
  expect(guestBerries).toBeGreaterThan(0);
  await guest.evaluate(() => { const td = (window as any).__malina.td; td.openMenu(td.pads[0]); td.key({ code: 'Digit1' }); });
  await host.waitForFunction(() => !!(window as any).__malina.td.pads[0].tower, null, { timeout: 30_000 });
  await guest.waitForFunction(() => !!(window as any).__malina.td.pads[0].tower, null, { timeout: 30_000 });
  const cost = await guest.evaluate(() => (window as any).__malina.td.pads[0].tower.def.cost);
  await guest.waitForFunction((b) => (window as any).__malina.td.berries === b, guestBerries - cost, { timeout: 30_000 });
  expect(await host.evaluate(() => (window as any).__malina.td.berries)).toBe(hostBerries);
  // the tower stands at both and in the same place
  for (const p of [host, guest]) expect(await p.evaluate(() => (window as any).__malina.tdView.towers.has(0))).toBe(true);

  // a wave by G at the host — enemy puppets from the server snapshots at both
  await host.evaluate(() => (window as any).__malina.td.callWave());
  for (const p of [host, guest]) await p.waitForFunction(() => (window as any).__malina.td.pack.mobs.some((m: any) => m.puppet && !m.dead), null, { timeout: 60_000 });
  await host.waitForFunction(() => (window as any).__malina.td.wave === 1, null, { timeout: 30_000 });
  expect(errors).toEqual([]);
});
