import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.ts';

/**
 * База сервера — встроенный `node:sqlite`, без нативных зависимостей. Один процесс, синхронные запросы:
 * сервер однопоточный, а WAL даёт читать файл снаружи (sqlite3 malina.db) во время работы.
 */
export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Транзакция: всё или ничего; вложенные вызовы идут внутри внешней */
export function tx<T>(db: Db, f: () => T): T {
  if (db.isTransaction) return f();
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = f();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
