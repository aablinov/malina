import { createServer, type Server } from 'node:http';
import { Auth } from './auth.ts';
import { openDb, type Db } from './db.ts';
import { httpHandler } from './http.ts';
import { Hub } from './hub.ts';
import { MapCatalog } from './maps.ts';
import { Matches } from './repo/matches.ts';
import { Players } from './repo/players.ts';
import { Profiles } from './repo/profiles.ts';
import { Rooms } from './repo/rooms.ts';
import { RoomManager } from './rooms.ts';

/**
 * Сборка сервера: SQLite, менеджер комнат, REST и WebSocket на одном порту (`/ws`).
 * main.ts запускает её из env, тесты — с базой `:memory:` и портом 0
 */
export interface AppConfig {
  dbPath: string;
  mapsDir: string;
  staticDir?: string;
  now?: () => number;
}

export interface App {
  http: Server;
  db: Db;
  rooms: RoomManager;
  hub: Hub;
  /** Запустить на порту (0 — любой свободный), вернуть порт */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createApp(cfg: AppConfig): App {
  const db = openDb(cfg.dbPath);
  const players = new Players(db), profiles = new Profiles(db), matches = new Matches(db), roomRepo = new Rooms(db);
  const maps = new MapCatalog(cfg.mapsDir);
  const auth = new Auth(players);
  const rooms = new RoomManager({ db, rooms: roomRepo, matches, profiles, maps, nameOf: (id) => players.byId(id)?.name ?? '?', now: cfg.now });
  const hub = new Hub({ auth, players, rooms, now: cfg.now });
  const http = createServer(httpHandler({ auth, players, profiles, matches, rooms, maps, staticDir: cfg.staticDir, now: cfg.now }));
  http.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') { socket.destroy(); return; }
    hub.wss.handleUpgrade(req, socket, head, (ws) => hub.wss.emit('connection', ws, req));
  });
  const sweep = setInterval(() => rooms.sweep(), 1000);
  sweep.unref();

  return {
    http, db, rooms, hub,
    listen: (port, host) => new Promise((ok) => {
      http.listen(port, host, () => {
        const a = http.address();
        ok(typeof a === 'object' && a ? a.port : port);
      });
    }),
    close: () => new Promise((ok) => {
      clearInterval(sweep);
      hub.close();
      http.close(() => { db.close(); ok(); });
      http.closeAllConnections();
    }),
  };
}
