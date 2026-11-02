import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Profile } from '../../src/items.ts';
import { PROTOCOL, type AuthReply, type ClientMsg, type ServerMsg } from '../../src/net/protocol.ts';
import { createApp, type App } from '../app.ts';

/** Сервер на свободном порту и игроки-клиенты на глобальном WebSocket Node */
export const MAPS = join(import.meta.dirname, '..', '..', 'assets', 'maps');

export interface TestServer { app: App; base: string; ws: string; clock: { t: number }; dir: string; stop(): Promise<void> }

export async function startServer(dbPath?: string): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'malina-'));
  const clock = { t: 1_000_000 };
  const app = createApp({ dbPath: dbPath ?? ':memory:', mapsDir: MAPS, now: () => clock.t });
  const port = await app.listen(0, '127.0.0.1');
  return {
    app, clock, dir, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws`,
    stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

export async function api(s: TestServer, method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  const r = await fetch(s.base + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export async function register(s: TestServer, name: string): Promise<AuthReply> {
  const r = await api(s, 'POST', '/api/auth', { name });
  if (r.status !== 201) throw new Error(`auth ${r.status}`);
  return r.body as AuthReply;
}

/** Стартовый профиль, как у нового героя в браузере */
export const starter = (): unknown => JSON.parse(JSON.stringify(Profile.starter()));

export class Player {
  readonly ws: WebSocket;
  readonly inbox: ServerMsg[] = [];
  closed: { code: number } | null = null;
  private waiters: { f: (m: ServerMsg) => boolean; ok: (m: ServerMsg) => void }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ServerMsg;
      this.inbox.push(m);
      this.waiters = this.waiters.filter((w) => (w.f(m) ? (w.ok(m), false) : true));
    };
    this.ws.onclose = (e) => { this.closed = { code: e.code }; };
  }

  static async connect(s: TestServer, token: string): Promise<Player> {
    const p = new Player(s.ws);
    await new Promise((ok, fail) => { p.ws.onopen = ok; p.ws.onerror = fail; });
    p.send({ t: 'hello', token, protocol: PROTOCOL });
    await p.next('welcome');
    return p;
  }

  send(m: ClientMsg | Record<string, unknown>): void { this.ws.send(JSON.stringify(m)); }

  /** Ждать сообщение типа t (уже пришедшее раньше — тоже), с условием */
  next<T extends ServerMsg['t']>(t: T, f: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 2000): Promise<Extract<ServerMsg, { t: T }>> {
    const match = (m: ServerMsg): boolean => m.t === t && f(m as Extract<ServerMsg, { t: T }>);
    const i = this.inbox.findIndex(match);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>);
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`нет ${t} за ${ms} мс; пришло: ${this.inbox.map((x) => x.t).join(', ')}`)), ms);
      this.waiters.push({ f: match, ok: (m) => { clearTimeout(timer); const j = this.inbox.indexOf(m); if (j >= 0) this.inbox.splice(j, 1); ok(m as Extract<ServerMsg, { t: T }>); } });
    });
  }

  /** Последний room.state, пришедший к этому моменту (и дождаться хотя бы одного) */
  async state(f: (m: Extract<ServerMsg, { t: 'room.state' }>) => boolean = () => true): Promise<Extract<ServerMsg, { t: 'room.state' }>> {
    return this.next('room.state', f);
  }

  waitClose(ms = 2000): Promise<{ code: number }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error('не закрылось')), ms);
      this.ws.addEventListener('close', (e) => { clearTimeout(timer); ok({ code: e.code }); });
    });
  }

  close(): void { this.ws.close(); }
}

export const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
