import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { PROTOCOL, validName, type AuthReply, type FriendInfo } from '../src/net/protocol.ts';
import type { Auth } from './auth.ts';
import type { Friends } from './repo/friends.ts';
import { nameKey, type PlayerRow, type Players } from './repo/players.ts';
import type { Matches } from './repo/matches.ts';
import type { Profiles } from './repo/profiles.ts';
import type { MapCatalog } from './maps.ts';
import type { RoomManager } from './rooms.ts';
import { checkProfile } from './validate.ts';

/**
 * REST сервера (wiki/design-multiplayer.md). Токен — заголовок `Authorization: Bearer …`, cookie нет,
 * поэтому CORS открыт всем: игра открывается и с file://, и с localhost:5173
 */
export interface HttpDeps {
  auth: Auth; players: Players; profiles: Profiles; matches: Matches; rooms: RoomManager; maps: MapCatalog; friends: Friends;
  /** Игрок на связи (WebSocket открыт) */
  online: (playerId: string) => boolean;
  /** Каталог собранной игры (dist) — отдавать на `/`; не задан — только API */
  staticDir?: string;
  now?: () => number;
}

const MAX_BODY = 512 * 1024;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) { super(String(status)); this.status = status; this.body = body; }
}

export function httpHandler(d: HttpDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const now = d.now ?? Date.now;

  const me = (req: IncomingMessage): PlayerRow => {
    const h = req.headers.authorization ?? '';
    const p = h.startsWith('Bearer ') ? d.auth.check(h.slice(7)) : null;
    if (!p) throw new HttpError(401, { error: 'Нужен вход' });
    return p;
  };

  const routes: Record<string, (req: IncomingMessage, url: URL) => Promise<[number, unknown]> | [number, unknown]> = {
    'GET /api/health': () => [200, { ok: true, protocol: PROTOCOL, maps: d.maps.ids() }],

    'POST /api/auth': async (req) => {
      const body = (await readJson(req)) as { name?: unknown };
      if (!validName(body.name)) return [400, { error: 'Имя — от 2 до 16 букв и цифр' }];
      // своё же имя с действующим токеном — просто подтвердить вход
      const h = req.headers.authorization ?? '';
      const p = h.startsWith('Bearer ') ? d.auth.check(h.slice(7)) : null;
      if (p && nameKey(p.name) === nameKey(body.name)) return [200, { playerId: p.id, name: p.name, token: h.slice(7) } satisfies AuthReply];
      const r = d.auth.register(body.name, now());
      return r ? [201, r] : [409, { error: 'Имя занято' }];
    },

    'POST /api/auth/rename': async (req) => {
      const p = me(req);
      const body = (await readJson(req)) as { name?: unknown };
      if (!validName(body.name)) return [400, { error: 'Имя — от 2 до 16 букв и цифр' }];
      const other = d.players.byName(body.name);
      if (other && other.id !== p.id) return [409, { error: 'Имя занято' }];
      d.players.rename(p.id, body.name);
      return [200, { playerId: p.id, name: body.name }];
    },

    'GET /api/me': (req) => { const p = me(req); return [200, { playerId: p.id, name: p.name }]; },

    'GET /api/profile': (req) => {
      const r = d.profiles.get(me(req).id);
      return r ? [200, r] : [404, { error: 'Профиля ещё нет' }];
    },

    'PUT /api/profile': async (req) => {
      const p = me(req);
      const body = (await readJson(req)) as { version?: unknown; data?: unknown };
      if (!Number.isInteger(body.version) || (body.version as number) < 0) return [400, { error: 'version' }];
      const chk = checkProfile(body.data);
      if (!chk.ok) return [400, { error: chk.error }];
      const v = d.profiles.put(p.id, body.version as number, chk.data, now());
      if (v === null) return [409, d.profiles.get(p.id)];
      return [200, { version: v, data: chk.data }];
    },

    'GET /api/rooms': () => [200, d.rooms.list()],

    'GET /api/matches': (req, url) => {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 20));
      return [200, d.matches.forPlayer(me(req).id, limit)];
    },

    // друзья: добавить по имени, список (на связи ли, в какой комнате — войти по коду), убрать
    'GET /api/friends': (req) => {
      const list: FriendInfo[] = d.friends.list(me(req).id).map((f) => ({ ...f, online: d.online(f.playerId), room: d.rooms.roomOfPlayer(f.playerId) }));
      return [200, list];
    },

    'POST /api/friends': async (req) => {
      const p = me(req);
      const body = (await readJson(req)) as { name?: unknown };
      const other = typeof body.name === 'string' ? d.players.byName(body.name.trim()) : null;
      if (!other) return [404, { error: 'Нет героя с таким именем' }];
      if (other.id === p.id) return [400, { error: 'Это ты сам' }];
      d.friends.add(p.id, other.id, now());
      return [201, { playerId: other.id, name: other.name }];
    },

    'DELETE /api/friends': (req, url) => {
      const id = url.searchParams.get('id') ?? '';
      return d.friends.remove(me(req).id, id) ? [200, { ok: true }] : [404, { error: 'Нет такого друга' }];
    },

    'GET /api/records': (_req, url) => {
      const map = url.searchParams.get('map') ?? '';
      if (!d.maps.has(map)) return [400, { error: 'Нет такой карты' }];
      return [200, d.matches.record(map)];
    },
  };

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) {
      if (req.method === 'GET' && d.staticDir && !url.pathname.startsWith('/api/')) { void serveStatic(d.staticDir, url.pathname, res); return; }
      send(res, 404, { error: 'Нет такого адреса' });
      return;
    }
    Promise.resolve()
      .then(() => route(req, url))
      .then(([status, body]) => send(res, status, body))
      .catch((e: unknown) => {
        if (e instanceof HttpError) send(res, e.status, e.body);
        else { console.error(e); send(res, 500, { error: 'Ошибка сервера' }); }
      });
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new HttpError(413, { error: 'Слишком большой запрос' });
    chunks.push(c as Buffer);
  }
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (typeof v !== 'object' || v === null) throw new Error();
    return v;
  } catch { throw new HttpError(400, { error: 'Нужен JSON' }); }
}

async function serveStatic(dir: string, path: string, res: ServerResponse): Promise<void> {
  const rel = normalize(decodeURIComponent(path === '/' ? '/index.html' : path)).replace(/^([/\\]|\.\.)+/, '');
  try {
    const body = await readFile(join(dir, rel));
    res.writeHead(200, { 'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}
