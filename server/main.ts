/**
 * Malina multiplayer server (wiki/design-multiplayer.md). Node ≥ 22.18 runs TypeScript directly:
 *
 *   npm run server                     — http://localhost:8787, database ./data/malina.db
 *   PORT=9000 DB_PATH=/var/malina.db STATIC=dist npm run server
 *
 * PORT — port, HOST — address (default: all), DB_PATH — SQLite file, STATIC — directory of the built game
 * (served at `/`, so the game and the server share one address), MAPS — maps directory (assets/maps),
 * RTC_ICE_SERVERS — STUN/TURN for voice chat as JSON (`[{"urls":"turn:host:3478","username":"u","credential":"p"}]`)
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import type { IceServer } from '../src/net/protocol.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const app = createApp({
  dbPath: env.DB_PATH ?? join(root, 'data', 'malina.db'),
  mapsDir: env.MAPS ?? join(root, 'assets', 'maps'),
  staticDir: env.STATIC ? join(process.cwd(), env.STATIC) : undefined,
  ice: env.RTC_ICE_SERVERS ? (JSON.parse(env.RTC_ICE_SERVERS) as IceServer[]) : undefined,
});
const port = await app.listen(Number(env.PORT) || 8787, env.HOST);
console.log(`Malina: server at http://localhost:${port} (ws — /ws)`);

const stop = (): void => {
  console.log('Malina: server shutting down');
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
