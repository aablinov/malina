import type { Db } from '../db.ts';

export interface ProfileRow { version: number; data: unknown }

/**
 * Hero profiles: `ProfileData` (src/items.ts) whole as JSON. version grows on every write —
 * optimistic locking: whoever writes against an old version gets a conflict and the fresh profile
 */
export class Profiles {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  get(playerId: string): ProfileRow | null {
    const r = this.db.prepare('SELECT version, data FROM profiles WHERE player_id = ?').get(playerId) as { version: number; data: string } | undefined;
    return r ? { version: r.version, data: JSON.parse(r.data) } : null;
  }

  /** Write if the version matches (0 — no profile yet). Returns the new version or null on conflict */
  put(playerId: string, expected: number, data: unknown, now: number): number | null {
    const json = JSON.stringify(data);
    if (expected === 0) {
      const r = this.db.prepare('INSERT INTO profiles (player_id, version, data, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT DO NOTHING').run(playerId, json, now);
      return r.changes ? 1 : null;
    }
    const r = this.db.prepare('UPDATE profiles SET version = version + 1, data = ?, updated_at = ? WHERE player_id = ? AND version = ?').run(json, now, playerId, expected);
    return r.changes ? expected + 1 : null;
  }
}
