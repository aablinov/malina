import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Room voice chat (src/net/voice.ts, wiki/design-multiplayer.md "Voice"): a real server and two browsers with a fake microphone.
 * In the camp: T at the host — the mic flag is in the guest's seats, the guest's WebRTC connection is up and gets a live track;
 * the room goes to battle — the mic turns on again by itself on the battle page; T in battle — off, the mic track is stopped
 */
const PORT = 8793;
const SERVER = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

test.use({
  launchOptions: {
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    executablePath: process.env.PW_CHROMIUM || undefined,
  },
});

test.beforeAll(async () => {
  server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: ':memory:', STATIC: 'dist', RTC_ICE_SERVERS: '[]' }, stdio: 'pipe' });
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('the server did not start')), 10_000);
    server.stdout?.on('data', (b: Buffer) => { if (String(b).includes('server at')) { clearTimeout(timer); ok(); } });
    server.stderr?.on('data', (b: Buffer) => process.stderr.write(b));
  });
});
test.afterAll(() => { server?.kill(); });

async function lobby(page: Page, errors: string[], name: string): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('malina.lang', 'en'); } catch { /* storage unavailable */ } });
  await page.goto(`${SERVER}/`, { waitUntil: 'domcontentloaded' });
  // first entry: the hero name card (src/menu/boot.ts); under parallel runs the cold start is long
  const field = page.locator('.mm-boot [data-field="name"]');
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(name);
  await field.press('Enter');
  // timer polling: rAF polling stalls while the earlier battle pages load the software WebGL
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start', null, { timeout: 60_000, polling: 500 });
  await page.getByRole('button', { name: /Online game/ }).click();
  await expect(page.locator('.mm-online')).toContainText(name);
}

type Dbg = { on: boolean; peers: { seat: number; state: string; remote: boolean; muted: boolean | null }[] };
const voice = (p: Page, hook: '__menu' | '__malina'): Promise<Dbg> => p.evaluate((h) => (window as any)[h].voice.debug(), hook);

test('voice: T turns the mic on in the camp, the peer hears it, it carries into battle, T turns it off', async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  // Playwright denies permissions in a fresh context — grant the (fake) microphone, as the player does in the browser dialog
  const host = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  const guest = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  await lobby(host, errors, 'Singer');
  await lobby(guest, errors, 'Listener');
  await host.locator('.mm-online [data-act="host"]').click();
  const code = (await host.locator('.mm-code').textContent())?.trim() ?? '';
  await guest.locator('.mm-online [data-field="code"]').fill(code);
  await guest.locator('.mm-online [data-field="code"]').press('Enter');
  await expect(guest.locator('.mm-seat')).toHaveCount(2 + 2);

  // the connection is made before anyone speaks: receiving needs no microphone
  await guest.waitForFunction(() => (window as any).__menu.voice.debug().peers.some((p: any) => p.state === 'connected'), null, { timeout: 30_000 });
  // the receiver track exists from the start, but stays muted: no audio comes while the host's mic is off
  expect((await voice(guest, '__menu')).peers[0].muted).toBe(true);

  // T at the host: the mic — on, the flag in the guest's seats, the guest gets a live track
  await host.locator('body').press('t');
  await host.waitForFunction(() => (window as any).__menu.voice.on, null, { timeout: 15_000 });
  await expect(guest.locator('.mm-seat .mm-mic')).toHaveCount(1);
  await guest.waitForFunction(() => (window as any).__menu.voice.debug().peers.some((p: any) => p.remote && p.muted === false), null, { timeout: 30_000 });
  await expect(host.locator('.mm-online')).toContainText('Microphone on');

  // into battle: the page reloads — the mic is on again by itself, the connection is made again
  await guest.locator('[data-act="start"]').click();
  await expect(host.locator('.mm-seats')).toContainText('ready');
  await host.locator('[data-act="start"]').click();
  for (const p of [host, guest]) await p.waitForFunction(() => (window as any).__malina?.mode === 'playground', null, { timeout: 120_000 });
  await host.waitForFunction(() => (window as any).__malina.voice.on, null, { timeout: 60_000 });
  await guest.waitForFunction(() => (window as any).__malina.voice.debug().peers.some((p: any) => p.state === 'connected' && p.remote && p.muted === false), null, { timeout: 60_000 });
  await guest.waitForFunction(() => (window as any).__malina.net?.joined, null, { timeout: 60_000 });
  await expect(guest.locator('.net-row em', { hasText: '🎤' })).toHaveCount(1, { timeout: 15_000 });

  // T in battle — off: the flag is gone at the guest, the host's mic track is stopped
  await host.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', bubbles: true })));
  await host.waitForFunction(() => !(window as any).__malina.voice.on, null, { timeout: 15_000 });
  await expect(guest.locator('.net-row em', { hasText: '🎤' })).toHaveCount(0, { timeout: 15_000 });
  expect(errors).toEqual([]);
});
