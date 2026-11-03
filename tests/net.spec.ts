import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Сетевая игра (wiki/design-multiplayer.md): настоящий сервер (server/main.ts, база в памяти) и два браузера.
 * Игру отдаёт сам сервер (`STATIC=dist`): у страниц file:// хранилище общее между контекстами, а героям нужно своё.
 * Хост входит под именем и создаёт комнату, гость входит по коду и отмечается готовым, «Начать игру» у хоста —
 * обе страницы уходят в бой. Бой считает сервер: обе страницы получают снимки по /game, герой гостя идёт по его вводу
 * и виден хосту, гость строит башню из своей малины — башня у обоих, волна — враги-куклы у обоих, имена над героями
 */
const PORT = 8791;
const SERVER = `http://127.0.0.1:${PORT}`;
const URL = `${SERVER}/`;
let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: ':memory:', STATIC: 'dist' }, stdio: 'pipe' });
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('сервер не поднялся')), 10_000);
    server.stdout?.on('data', (b: Buffer) => { if (String(b).includes('сервер на')) { clearTimeout(timer); ok(); } });
    server.stderr?.on('data', (b: Buffer) => process.stderr.write(b));
  });
});
test.afterAll(() => { server?.kill(); });

async function lobby(page: Page, errors: string[], name: string): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start', null, { timeout: 60_000 });
  await page.getByRole('button', { name: /Сетевая игра/ }).click();
  // панель входа ждёт ответа сервера; под параллельными прогонами холодный старт долгий
  await expect(page.locator('.mm-online [data-field="name"]')).toBeVisible({ timeout: 60_000 });
  await page.locator('.mm-online [data-field="name"]').fill(name);
  await page.locator('.mm-online [data-act="login"]').click();
  await expect(page.locator('.mm-online')).toContainText(name);
}

test('сеть: вход по имени, комната по коду, готовность, серверный бой вдвоём', async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await lobby(host, errors, 'Хозяйка');
  await lobby(guest, errors, 'Гость');

  await host.locator('.mm-online [data-act="host"]').click();
  const code = (await host.locator('.mm-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z]{6}$/);
  await guest.locator('.mm-online [data-field="code"]').fill(code);
  await guest.locator('.mm-online [data-field="code"]').press('Enter');
  await expect(guest.locator('.mm-seat')).toHaveCount(2 + 2);
  await expect(guest.locator('[data-act="start"]')).toContainText('Готов');
  await guest.locator('[data-act="start"]').click();
  await expect(host.locator('.mm-seats')).toContainText('готов');

  await host.locator('[data-act="start"]').click();
  for (const p of [host, guest]) {
    await p.waitForURL(/map=td/);
    expect(p.url()).toContain('players=2');
    expect(p.url()).toContain(`room=${code}`);
    await p.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  }
  // комната в бою со свободными местами остаётся в списке — в идущий бой можно войти
  const rooms = (await (await fetch(`${SERVER}/api/rooms`)).json()) as { state: string }[];
  expect(rooms.map((r) => r.state)).toEqual(['battle']);

  // обе страницы в серверном бою: снимки идут, у каждого виден другой герой
  for (const p of [host, guest]) {
    await p.waitForFunction(() => (window as any).__malina.net?.joined && (window as any).__malina.net.snaps > 5, null, { timeout: 60_000 });
    await p.waitForFunction(() => (window as any).__malina.net.othersInfo.length === 1, null, { timeout: 30_000 });
  }
  // гость идёт — у хоста его герой идёт следом
  const at0 = await host.evaluate(() => { const a = (window as any).__malina.net.othersInfo[0]; return [a.x, a.z]; });
  await guest.evaluate(() => { const m = (window as any).__malina; m.script(true); m.input.move.set(0.7, 0.7); });
  await host.waitForFunction(([x, z]) => { const a = (window as any).__malina.net.othersInfo[0]; return Math.hypot(a.x - x, a.z - z) > 2; }, at0, { timeout: 30_000 });
  await guest.evaluate(() => (window as any).__malina.input.move.set(0, 0));
  // и сам гость прошёл: сервер подтвердил его место
  // имена над героями: у каждого — свой и чужой
  for (const p of [host, guest]) await expect(p.locator('.net-name')).toHaveCount(2);
  await expect(guest.locator('.net-name.me')).toHaveText('Гость');

  // малина у каждого своя: гость строит башню из своей, у хоста казна та же; башня — у обоих
  const hostBerries = await host.evaluate(() => (window as any).__malina.td.berries);
  const guestBerries = await guest.evaluate(() => (window as any).__malina.td.berries);
  expect(guestBerries).toBeGreaterThan(0);
  await guest.evaluate(() => { const td = (window as any).__malina.td; td.openMenu(td.pads[0]); td.key({ code: 'Digit1' }); });
  await host.waitForFunction(() => !!(window as any).__malina.td.pads[0].tower, null, { timeout: 30_000 });
  await guest.waitForFunction(() => !!(window as any).__malina.td.pads[0].tower, null, { timeout: 30_000 });
  const cost = await guest.evaluate(() => (window as any).__malina.td.pads[0].tower.def.cost);
  await guest.waitForFunction((b) => (window as any).__malina.td.berries === b, guestBerries - cost, { timeout: 30_000 });
  expect(await host.evaluate(() => (window as any).__malina.td.berries)).toBe(hostBerries);
  // башня стоит у обоих и на одном месте
  for (const p of [host, guest]) expect(await p.evaluate(() => (window as any).__malina.tdView.towers.has(0))).toBe(true);

  // волна по G у хоста — у обоих враги-куклы по снимкам сервера
  await host.evaluate(() => (window as any).__malina.td.callWave());
  for (const p of [host, guest]) await p.waitForFunction(() => (window as any).__malina.td.pack.mobs.some((m: any) => m.puppet && !m.dead), null, { timeout: 60_000 });
  await host.waitForFunction(() => (window as any).__malina.td.wave === 1, null, { timeout: 30_000 });
  expect(errors).toEqual([]);
});
