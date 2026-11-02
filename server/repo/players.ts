import type { Db } from '../db.ts';

export interface PlayerRow { id: string; name: string; created_at: number; last_seen: number }

/** Ключ имени: «Малинка» и «малинка» — одно имя */
export const nameKey = (name: string): string => name.toLocaleLowerCase('ru');

/** Игроки: имя и хеш токена (сам токен знает только браузер) */
export class Players {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  create(id: string, name: string, tokenHash: string, now: number): PlayerRow {
    this.db.prepare('INSERT INTO players (id, name, name_key, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, nameKey(name), tokenHash, now, now);
    return { id, name, created_at: now, last_seen: now };
  }

  byToken(tokenHash: string): PlayerRow | null {
    return (this.db.prepare('SELECT id, name, created_at, last_seen FROM players WHERE token_hash = ?').get(tokenHash) as PlayerRow | undefined) ?? null;
  }

  byId(id: string): PlayerRow | null {
    return (this.db.prepare('SELECT id, name, created_at, last_seen FROM players WHERE id = ?').get(id) as PlayerRow | undefined) ?? null;
  }

  byName(name: string): PlayerRow | null {
    return (this.db.prepare('SELECT id, name, created_at, last_seen FROM players WHERE name_key = ?').get(nameKey(name)) as PlayerRow | undefined) ?? null;
  }

  rename(id: string, name: string): void { this.db.prepare('UPDATE players SET name = ?, name_key = ? WHERE id = ?').run(name, nameKey(name), id); }

  touch(id: string, now: number): void { this.db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, id); }
}
