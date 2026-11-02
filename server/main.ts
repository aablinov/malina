/**
 * Сервер сетевой игры «Малины» (wiki/design-multiplayer.md). Node ≥ 22.18 выполняет TypeScript сам:
 *
 *   npm run server                     — http://localhost:8787, база ./data/malina.db
 *   PORT=9000 DB_PATH=/var/malina.db STATIC=dist npm run server
 *
 * PORT — порт, HOST — адрес (по умолчанию все), DB_PATH — файл SQLite, STATIC — каталог собранной игры
 * (отдаётся на `/`, тогда игра и сервер на одном адресе), MAPS — каталог карт (assets/maps)
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
console.log(`Малина: сервер на http://localhost:${port} (ws — /ws)`);

const stop = (): void => {
  console.log('Малина: сервер останавливается');
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
