import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Сетевая игра втроём (wiki/design-multiplayer.md): настоящий сервер (база в файле — для перезапуска) и три браузера.
 * Опоздавший входит в идущий бой, у всех — три героя, список игроков и имена; чат в бою; атака врага у гостя-куклы;
 * гость перезагрузил страницу — снова в бою; «Ещё раз» у хоста — новый бой всем; хост ушёл — бой ведёт следующий;
 * сервер перезапустился — бой честно прерван, все снова на связи
 */
// Общий бой по снимкам сервера переписывается (wiki/design-multiplayer.md, фаза 5): прежний хост-гость снесён, проверки ждут
test.describe.skip('сеть — до серверного боя (фаза 5)', () => {
  const PORT = 8792;
  const SERVER = `http://127.0.0.1:${PORT}`;
  const dir = mkdtempSync(join(tmpdir(), 'malina-party-'));
  let server: ChildProcess | null = null;

  async function startServer(): Promise<void> {
    server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: join(dir, 'malina.db'), STATIC: 'dist' }, stdio: 'pipe' });
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error('сервер не поднялся')), 10_000);
      server!.stdout?.on('data', (b: Buffer) => { if (String(b).includes('сервер на')) { clearTimeout(timer); ok(); } });
      server!.stderr?.on('data', (b: Buffer) => process.stderr.write(b));
    });
  }
  async function stopServer(): Promise<void> {
    const s = server;
    server = null;
    if (!s) return;
    await new Promise<void>((ok) => { s.once('exit', () => ok()); s.kill('SIGINT'); });
  }

  test.beforeAll(startServer);
  test.afterAll(async () => { await stopServer(); rmSync(dir, { recursive: true, force: true }); });

  const M = (p: Page, f: string): Promise<unknown> => p.evaluate(f);
  const battleId = (p: Page): Promise<string> => p.evaluate(() => JSON.parse(sessionStorage.getItem('malina.net.battle') ?? '{}').matchId as string);

  async function login(page: Page, errors: string[], name: string): Promise<void> {
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(`${SERVER}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__menu?.screen === 'start');
    await page.getByRole('button', { name: /Сетевая игра/ }).click();
    await page.locator('.mm-online [data-field="name"]').fill(name);
    await page.locator('.mm-online [data-act="login"]').click();
    await expect(page.locator('.mm-online')).toContainText(name);
  }

  let pageErrors: string[] = [];
  const inBattle = async (p: Page): Promise<void> => {
    await p.waitForURL(/room=/, { timeout: 30_000, waitUntil: 'commit' });
    try { await p.waitForFunction(() => (window as any).__malina?.coop, null, { timeout: 180_000 }); }
    catch (e) {
      const st = await p.evaluate(() => ({ malina: !!(window as any).__malina, mode: (window as any).__malina?.mode, battle: sessionStorage.getItem('malina.net.battle'), td: !!(window as any).__malina?.td, coop: String((window as any).__malina?.coop), q: location.search, from: document.referrer }));
      throw new Error(`нет общего боя на ${p.url()}; ${JSON.stringify(st)}; ошибки страниц: ${pageErrors.join(' | ')}; ${String(e)}`);
    }
  };

  test('сеть втроём: опоздавший, чат, атаки кукол, перезагрузка, «Ещё раз», уход хоста, перезапуск сервера', async ({ browser }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    pageErrors = errors;
    const [host, g1, g2] = await Promise.all([0, 1, 2].map(async () => (await browser.newContext()).newPage()));
    await login(host, errors, 'Хозяйка');
    await login(g1, errors, 'Первый');
    await host.locator('.mm-online [data-act="host"]').click();
    const code = (await host.locator('.mm-code').textContent())?.trim() ?? '';
    await g1.locator('.mm-online [data-field="code"]').fill(code);
    await g1.locator('.mm-online [data-field="code"]').press('Enter');
    await g1.locator('[data-act="start"]').click();
    await expect(host.locator('.mm-seats')).toContainText('готов');
    await host.locator('[data-act="start"]').click();
    await Promise.all([inBattle(host), inBattle(g1)]);

    // опоздавший: входит по коду в идущий бой — сразу на страницу боя
    await login(g2, errors, 'Второй');
    await g2.locator('.mm-online [data-field="code"]').fill(code);
    await g2.locator('.mm-online [data-field="code"]').press('Enter');
    await inBattle(g2);
    await host.waitForFunction(() => (window as any).__malina.coop.alliesInfo.length === 2, null, { timeout: 60_000 });
    for (const p of [g1, g2]) await p.waitForFunction(() => (window as any).__malina.coop.othersInfo.length === 2, null, { timeout: 60_000 });
    for (const p of [host, g1, g2]) {
      await expect(p.locator('.net-roster .net-row')).toHaveCount(3, { timeout: 30_000 });
      await expect(p.locator('.net-name')).toHaveCount(3, { timeout: 30_000 });
    }
    await expect(host.locator('.net-roster')).toContainText('Второй');

    // чат в бою: Enter — написать, Enter — отправить; видят все
    await g1.keyboard.press('Enter');
    await g1.keyboard.type('держим мост');
    await g1.keyboard.press('Enter');
    for (const p of [host, g1, g2]) await expect(p.locator('.net-chat-row').filter({ hasText: 'держим мост' })).toHaveCount(1, { timeout: 15_000 });

    // атака врага: у хоста враг бьёт героя гостя — у гостя кукла играет ту же атаку
    await M(host, `(() => { const m = window.__malina, a = m.coop.alliesInfo.find((x) => x.seat === 1);
      const kind = m.td.waves[0].groups[0].kind; m.td.spawn(kind, m.hero.pos.clone().set(a.x + 1.2, 0, a.z)); })()`);
    await g1.waitForFunction(() => (window as any).__malina.td.pack.mobs.some((m: any) => m.puppet && m.state === 'attack'), null, { timeout: 60_000 });

    // гость перезагрузил страницу — снова в бою на своём месте, снимки идут
    await g1.reload({ waitUntil: 'domcontentloaded' });
    await g1.waitForFunction(() => (window as any).__malina?.coop?.snaps > 3, null, { timeout: 60_000 });
    expect(await host.evaluate(() => (window as any).__malina.coop.alliesInfo.length)).toBe(2);

    // «Ещё раз»: бой кончился, хост жмёт Enter на итоге — новый бой всей комнате
    const first = await battleId(g2);
    await M(host, 'window.__malina.td.state = "won"');
    await expect(host.locator('.pz.open.won')).toBeVisible({ timeout: 30_000 });
    await host.keyboard.press('Enter');
    for (const p of [host, g1, g2]) await p.waitForFunction((id) => { const b = JSON.parse(sessionStorage.getItem('malina.net.battle') ?? '{}'); return b.matchId && b.matchId !== id && (window as any).__malina?.coop; }, first, { timeout: 90_000 });

    // хост ушёл посреди боя — бой ведёт следующий на связи (место 1), враги у него снова живые
    await g1.waitForFunction(() => (window as any).__malina.coop.snaps > 3, null, { timeout: 60_000 });
    await host.close();
    await g1.waitForFunction(() => (window as any).__malina.coop.host === true, null, { timeout: 30_000 });
    expect(await g1.evaluate(() => (window as any).__malina.td.remote)).toBeNull();
    await g2.waitForFunction(() => (window as any).__malina.coop.snaps > 0 && (window as any).__malina.coop.othersInfo.length === 1, null, { timeout: 30_000 });
    await expect(g2.locator('.net-chat-row').filter({ hasText: 'бой ведёт Первый' })).toHaveCount(1);

    // сервер перезапустился посреди боя: бой прерван, оба снова на связи, комната — лобби
    await stopServer();
    await startServer();
    for (const p of [g1, g2]) {
      await p.waitForFunction(() => { const n = (window as any).__malina.coop.h.net; return n.online && n.room?.room.state === 'lobby'; }, null, { timeout: 60_000 });
      await p.waitForFunction(() => (window as any).__malina.td.state !== 'play', null, { timeout: 10_000 });
    }
    expect(errors).toEqual([]);
  });
});
