import { createServer, type Server } from 'node:http';
import { Auth } from './auth.ts';
import { openDb, type Db } from './db.ts';
import { httpHandler } from './http.ts';
import { Hub } from './hub.ts';
import { MapCatalog } from './maps.ts';
import { Matches } from './repo/matches.ts';
import { Players } from './repo/players.ts';
import { Friends } from './repo/friends.ts';
import { Profiles } from './repo/profiles.ts';
import { Rooms } from './repo/rooms.ts';
import { RoomManager } from './rooms.ts';
import type { IceServer } from '../src/net/protocol.ts';
import { GameHub } from './game/game-hub.ts';
import { MatchRunner } from './game/runner.ts';

/**
 * Server assembly: SQLite, room manager, REST and WebSocket on one port (`/ws`).
 * main.ts runs it from env, tests with a `:memory:` database and port 0
 */
export interface AppConfig {
  dbPath: string;
  mapsDir: string;
  staticDir?: string;
  /** ICE servers for voice (env RTC_ICE_SERVERS) */
  ice?: IceServer[];
  now?: () => number;
}

export interface App {
  http: Server;
  db: Db;
  rooms: RoomManager;
  hub: Hub;
  /** Running matches (server-side battle) */
  games: MatchRunner;
  /** Listen on a port (0 — any free one), return the port */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createApp(cfg: AppConfig): App {
  const db = openDb(cfg.dbPath);
  const players = new Players(db), profiles = new Profiles(db), matches = new Matches(db), roomRepo = new Rooms(db);
  const maps = new MapCatalog(cfg.mapsDir);
  const auth = new Auth(players);
  const games = new MatchRunner(cfg.now);
  const rooms = new RoomManager({ db, rooms: roomRepo, matches, profiles, maps, games, nameOf: (id) => players.byId(id)?.name ?? '?', now: cfg.now });
  const hub = new Hub({ auth, players, rooms, now: cfg.now });
  const gameHub = new GameHub({ auth, runner: games, seatOf: (m, p) => rooms.seatOf(m, p), now: cfg.now });
  const friends = new Friends(db);
  const http = createServer(httpHandler({ auth, players, profiles, matches, rooms, maps, friends, online: (id) => hub.isOnline(id), staticDir: cfg.staticDir, ice: cfg.ice, now: cfg.now }));
  http.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/ws') hub.wss.handleUpgrade(req, socket, head, (ws) => hub.wss.emit('connection', ws, req));
    else if (path === '/game') gameHub.upgrade(req, socket, head);
    else socket.destroy();
  });
  const sweep = setInterval(() => rooms.sweep(), 1000);
  sweep.unref();
  games.start();

  return {
    http, db, rooms, hub, games,
    listen: (port, host) => new Promise((ok) => {
      http.listen(port, host, () => {
        const a = http.address();
        ok(typeof a === 'object' && a ? a.port : port);
      });
    }),
    close: () => new Promise((ok) => {
      clearInterval(sweep);
      games.stop();
      gameHub.close();
      hub.close();
      http.close(() => { db.close(); ok(); });
      http.closeAllConnections();
    }),
  };
}
