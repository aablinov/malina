import type { RoomState } from '../../src/net/protocol.ts';
import type { Db } from '../db.ts';

export interface RoomRow {
  id: string; code: string; host_id: string; map: string; max: number; private: number;
  state: RoomState; seed: number; created_at: number; updated_at: number;
  /** Password `salt:hash` (server/auth.ts); null — open room */
  pass_hash: string | null;
  creator: string;
}
export interface MemberRow { room_id: string; player_id: string; seat: number; ready: number; joined_at: number; gone_at: number | null }

/** Rooms and their seats — a copy of what the manager (server/rooms.ts) keeps in memory, to survive a restart */
export class Rooms {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  insert(r: RoomRow): void {
    this.db.prepare('INSERT INTO rooms (id, code, host_id, map, max, private, state, seed, created_at, updated_at, pass_hash, creator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, r.code, r.host_id, r.map, r.max, r.private, r.state, r.seed, r.created_at, r.updated_at, r.pass_hash, r.creator);
  }

  update(r: RoomRow): void {
    this.db.prepare('UPDATE rooms SET host_id = ?, map = ?, max = ?, private = ?, state = ?, seed = ?, updated_at = ? WHERE id = ?')
      .run(r.host_id, r.map, r.max, r.private, r.state, r.seed, r.updated_at, r.id);
  }

  codeTaken(code: string): boolean { return !!this.db.prepare("SELECT 1 FROM rooms WHERE code = ? AND state != 'closed'").get(code); }

  /** Release a closed room's code: codes are short and get reused */
  releaseCode(id: string): void { this.db.prepare("UPDATE rooms SET code = 'x' || id WHERE id = ? AND state = 'closed'").run(id); }

  live(): RoomRow[] { return this.db.prepare("SELECT * FROM rooms WHERE state != 'closed'").all() as unknown as RoomRow[]; }

  members(roomId: string): MemberRow[] { return this.db.prepare('SELECT * FROM room_members WHERE room_id = ? ORDER BY seat').all(roomId) as unknown as MemberRow[]; }

  putMember(m: MemberRow): void {
    this.db.prepare(`INSERT INTO room_members (room_id, player_id, seat, ready, joined_at, gone_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (room_id, player_id) DO UPDATE SET seat = excluded.seat, ready = excluded.ready, gone_at = excluded.gone_at`)
      .run(m.room_id, m.player_id, m.seat, m.ready, m.joined_at, m.gone_at);
  }

  removeMember(roomId: string, playerId: string): void { this.db.prepare('DELETE FROM room_members WHERE room_id = ? AND player_id = ?').run(roomId, playerId); }

  /** Delete closed rooms older than `before` */
  purge(before: number): number { return Number(this.db.prepare("DELETE FROM rooms WHERE state = 'closed' AND updated_at < ?").run(before).changes); }
}
