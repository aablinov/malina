/**
 * Malina multiplayer server (wiki/design-multiplayer.md). Node ≥ 22.18 runs TypeScript directly:
 *
 *   npm run server                     — http://localhost:8787, database ./data/malina.db
 *   PORT=9000 DB_PATH=/var/malina.db STATIC=dist npm run server
 *
 * PORT — port, HOST — address (default: all), DB_PATH — SQLite file, STATIC — directory of the built game
 * (served at `/`, so the game and the server share one address), MAPS — maps directory (assets/maps)
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const app = createApp({
  dbPath: env.DB_PATH ?? join(root, 'data', 'malina.db'),
  mapsDir: env.MAPS ?? join(root, 'assets', 'maps'),
  staticDir: env.STATIC ? join(process.cwd(), env.STATIC) : undefined,
});
const port = await app.listen(Number(env.PORT) || 8787, env.HOST);
console.log(`Malina: server at http://localhost:${port} (ws — /ws)`);

const stop = (): void => {
  console.log('Malina: server shutting down');
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
