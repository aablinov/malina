import type { Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * The game always goes through the server (wiki/design-multiplayer.md, section 5): specs that open the camp or a battle "from the menu"
 * start their own server (server/main.ts, in-memory database, `STATIC=dist`) on a free port (`PORT=0`): tests run fully in parallel,
 * every worker has its own; never 8787, where `make dev` may live.
 * Pages opened directly (`?dev=playground`, `?map=…`) need no server: a starter hero in memory.
 */
export interface GameServer { base: string; url: string; stop(): void }

export async function startGameServer(env: Record<string, string> = {}): Promise<GameServer> {
  const server: ChildProcess = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DB_PATH: ':memory:', STATIC: 'dist', ...env }, stdio: 'pipe' });
  const port = await new Promise<number>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('the server did not start')), 5_000);
    server.stdout?.on('data', (b: Buffer) => { const m = /server at http:\/\/[^:]+:(\d+)/.exec(String(b)); if (m) { clearTimeout(timer); ok(Number(m[1])); } });
    server.stderr?.on('data', (b: Buffer) => process.stderr.write(b));
  });
  const base = `http://127.0.0.1:${port}`;
  return { base, url: `${base}/`, stop: () => { server.kill(); } };
}

let heroes = 0;

/** A new hero on the server, its token in the page before the scripts run (and the language — otherwise the language picker) */
export async function signIn(page: Page, s: GameServer, name = `Hero${process.pid % 1000}x${++heroes}`): Promise<{ token: string; name: string }> {
  const r = await fetch(`${s.base}/api/auth`, { method: 'POST', body: JSON.stringify({ name }) });
  if (r.status !== 201) throw new Error(`auth ${r.status}`);
  const auth = (await r.json()) as { playerId: string; name: string; token: string };
  await page.addInitScript((a) => {
    try { localStorage.setItem('malina.lang', 'en'); localStorage.setItem('malina.net', JSON.stringify(a)); } catch { /* storage unavailable */ }
  }, auth);
  return { token: auth.token, name: auth.name };
}

/** The stored profile on the server */
export async function storedProfile(s: GameServer, token: string): Promise<any> {
  const r = await fetch(`${s.base}/api/profile`, { headers: { Authorization: `Bearer ${token}` } });
  return ((await r.json()) as { data: unknown }).data;
}
