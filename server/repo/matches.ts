import type { MapRecord, MatchResult, MatchSummary } from '../../src/net/protocol.ts';
import type { Db } from '../db.ts';

/** История боёв: матч и строки героев с наградами */
export class Matches {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  start(id: string, roomId: string, map: string, seed: number, seats: { playerId: string; seat: number }[], now: number): void {
    this.db.prepare('INSERT INTO matches (id, room_id, map, players, seed, started_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, roomId, map, seats.length, seed, now);
    const ins = this.db.prepare('INSERT INTO match_players (match_id, player_id, seat) VALUES (?, ?, ?)');
    for (const s of seats) ins.run(id, s.playerId, s.seat);
  }

  /** Закрыть матч; false — уже закрыт (повторный итог не засчитывается) */
  finish(id: string, result: MatchResult, wave: number, now: number): boolean {
    return !!this.db.prepare('UPDATE matches SET result = ?, wave = ?, ended_at = ? WHERE id = ? AND ended_at IS NULL').run(result, wave, now, id).changes;
  }

  reward(id: string, playerId: string, berries: number, xp: number): void {
    this.db.prepare('UPDATE match_players SET berries = ?, xp = ? WHERE match_id = ? AND player_id = ?').run(berries, xp, id, playerId);
  }

  /** Бои, прерванные перезапуском сервера */
  abandonOpen(now: number): number {
    return Number(this.db.prepare("UPDATE matches SET result = 'abandoned', ended_at = ? WHERE ended_at IS NULL").run(now).changes);
  }

  forPlayer(playerId: string, limit: number): MatchSummary[] {
    const rows = this.db.prepare(`SELECT m.id, m.map, m.players, m.started_at, m.ended_at, m.result, m.wave, p.berries, p.xp
      FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.player_id = ? ORDER BY m.started_at DESC LIMIT ?`).all(playerId, limit) as {
      id: string; map: string; players: number; started_at: number; ended_at: number | null; result: MatchResult | null; wave: number; berries: number; xp: number;
    }[];
    return rows.map((r) => ({ id: r.id, map: r.map, players: r.players, startedAt: r.started_at, endedAt: r.ended_at, result: r.result, wave: r.wave, berries: r.berries, xp: r.xp }));
  }

  /** Рекорды карты: лучшая волна, победы, быстрейшая победа */
  record(map: string): MapRecord {
    const r = this.db.prepare(`SELECT MAX(wave) AS best, SUM(result = 'won') AS wins,
      MIN(CASE WHEN result = 'won' THEN ended_at - started_at END) AS fastest FROM matches WHERE map = ? AND ended_at IS NOT NULL`).get(map) as
      { best: number | null; wins: number | null; fastest: number | null };
    return { map, bestWave: r.best ?? 0, wins: r.wins ?? 0, fastestWinMs: r.fastest };
  }
}
