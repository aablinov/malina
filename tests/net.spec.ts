import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Сетевая игра (wiki/design-multiplayer.md): настоящий сервер (server/main.ts, база в памяти) и два браузера.
 * Игру отдаёт сам сервер (`STATIC=dist`): у страниц file:// хранилище общее между контекстами, а героям нужно своё.
 * Хост входит под именем и создаёт комнату, гость входит по коду и отмечается готовым, «Начать игру» у хоста —
 * обе страницы уходят в бой с числом игроков комнаты. Общий бой: герой гостя у хоста идёт по его вводу, с его снаряжением
 * и действиями; имена над героями; гость строит башню из своей малины, кучку малины у хоста подбирает гость — малина ему, враги волны хоста у гостя — куклы по снимкам;
 * после боя каждый сдаёт серверу непотраченную малину
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
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start');
  await page.getByRole('button', { name: /Сетевая игра/ }).click();
  await expect(page.locator('.mm-online [data-field="name"]')).toBeVisible();
  await page.locator('.mm-online [data-field="name"]').fill(name);
  await page.locator('.mm-online [data-act="login"]').click();
  await expect(page.locator('.mm-online')).toContainText(name);
}

test('сеть: вход по имени, комната по коду, готовность, общий бой вдвоём', async ({ browser }) => {
  const errors: string[] = [];
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await lobby(host, errors, 'Хозяйка');
  await lobby(guest, errors, 'Гость');

  await host.locator('.mm-online [data-act="host"]').click();
  const code = (await host.locator('.mm-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z]{6}$/);
  // старт, пока гость не готов, сервер не даст — но и одному хосту начать можно; ждём гостя
  await guest.locator('.mm-online [data-field="code"]').fill(code);
  await guest.locator('.mm-online [data-field="code"]').press('Enter');
  await expect(guest.locator('.mm-seat')).toHaveCount(2 + 2); // двое и два свободных места
  await expect(host.locator('.mm-seat.off')).toHaveCount(0);
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
  // страница боя вошла на сервер заново — место за героем
  const rooms = await (await fetch(`${SERVER}/api/rooms`)).json();
  expect(rooms).toEqual([]); // комната в бою — в списке её нет

  // общий бой: у хоста — герой гостя, у гостя — снимки хоста
  await host.waitForFunction(() => (window as any).__malina.coop?.alliesInfo?.length === 1, null, { timeout: 30_000 });
  await guest.waitForFunction(() => (window as any).__malina.coop?.snaps > 5, null, { timeout: 30_000 });
  // гость идёт — у хоста его герой идёт следом
  const at0 = await host.evaluate(() => { const a = (window as any).__malina.coop.alliesInfo[0]; return [a.x, a.z]; });
  await guest.evaluate(() => { const m = (window as any).__malina; m.script(true); m.input.move.set(0.7, 0.7); });
  await host.waitForFunction(([x, z]) => { const a = (window as any).__malina.coop.alliesInfo[0]; return Math.hypot(a.x - x, a.z - z) > 2; }, at0, { timeout: 30_000 });
  await guest.evaluate(() => (window as any).__malina.input.move.set(0, 0));

  // снаряжение гостя у хоста: набор пришёл — у его героя то же оружие и то же здоровье брони
  const guestMax = await guest.evaluate(() => (window as any).__malina.hero.maxHp);
  await host.waitForFunction((mx) => { const a = (window as any).__malina.coop.alliesInfo[0]; return a.melee !== null && a.maxHp === mx; }, guestMax, { timeout: 30_000 });
  // действие гостя повторяет его снаряжение у хоста: артефакт гнезда 1 ушёл на перезарядку
  await guest.evaluate(() => { const m = (window as any).__malina; m.artifact(0, m.hero.pos.x + 3, m.hero.pos.z); });
  await host.waitForFunction(() => { const r = (window as any).__malina.coop.heroes.get(1); return r.gear.artT[0][0] > 0; }, null, { timeout: 30_000 });
  // имена над героями: у каждого — свой и чужой
  for (const p of [host, guest]) await expect(p.locator('.net-name')).toHaveCount(2);
  await expect(guest.locator('.net-name.me')).toHaveText('Гость');

  // малина у каждого своя: гость строит башню из своей, у хоста казна та же
  const hostBerries = await host.evaluate(() => (window as any).__malina.td.berries);
  const guestBerries = await guest.evaluate(() => (window as any).__malina.td.berries);
  await guest.evaluate(() => { const td = (window as any).__malina.td; td.openMenu(td.pads[0]); td.key({ code: 'Digit1' }); });
  await host.waitForFunction(() => !!(window as any).__malina.td.pads[0].tower, null, { timeout: 30_000 });
  await guest.waitForFunction(() => !!(window as any).__malina.td.pads[0].tower, null, { timeout: 30_000 });
  const cost = await guest.evaluate(() => (window as any).__malina.td.pads[0].tower.def.cost);
  expect(await guest.evaluate(() => (window as any).__malina.td.berries)).toBe(guestBerries - cost);
  expect(await host.evaluate(() => (window as any).__malina.td.berries)).toBe(hostBerries);

  // малина с врагов общая: кучка у хоста рядом с героем гостя — гость её видит, подбирает, малина ему, хосту — нет
  const g0 = await guest.evaluate(() => (window as any).__malina.td.berries);
  const h0 = await host.evaluate(() => (window as any).__malina.td.berries);
  await host.evaluate(() => { const m = (window as any).__malina, a = m.coop.alliesInfo[0]; m.props.berries(m.hero.pos.clone().set(a.x, 0, a.z), 7); });
  await guest.waitForFunction((b) => (window as any).__malina.td.berries === b + 7, g0, { timeout: 30_000 });
  expect(await host.evaluate(() => (window as any).__malina.td.berries)).toBe(h0);

  // волна у хоста — у гостя враги-куклы
  await host.evaluate(() => (window as any).__malina.td.callWave());
  await guest.waitForFunction(() => (window as any).__malina.td.pack.mobs.some((m: any) => m.puppet), null, { timeout: 60_000 });

  // конец боя: каждый сам сдаёт серверу свою непотраченную малину — она в истории боёв и в профиле
  await host.evaluate(() => { (window as any).__malina.td.state = 'won'; });
  const token = await guest.evaluate(() => JSON.parse(localStorage.getItem('malina.net') ?? '{}').token as string);
  const left = await guest.evaluate(() => (window as any).__malina.td.berries);
  await expect.poll(async () => {
    const r = await fetch(`${SERVER}/api/matches`, { headers: { Authorization: `Bearer ${token}` } });
    return ((await r.json()) as { berries: number }[])[0]?.berries ?? -1;
  }, { timeout: 30_000 }).toBeGreaterThanOrEqual(left);
  expect(errors).toEqual([]);
});
