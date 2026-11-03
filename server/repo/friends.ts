import type { Db } from '../db.ts';

/** Друзья: «добавил по имени» — список в одну сторону, как закладки */
export class Friends {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  add(playerId: string, friendId: string, now: number): boolean {
    return !!this.db.prepare('INSERT INTO friends (player_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(playerId, friendId, now).changes;
  }

  remove(playerId: string, friendId: string): boolean {
    return !!this.db.prepare('DELETE FROM friends WHERE player_id = ? AND friend_id = ?').run(playerId, friendId).changes;
  }

  list(playerId: string): { playerId: string; name: string }[] {
    return this.db.prepare('SELECT p.id AS playerId, p.name AS name FROM friends f JOIN players p ON p.id = f.friend_id WHERE f.player_id = ? ORDER BY p.name_key').all(playerId) as { playerId: string; name: string }[];
  }
}
