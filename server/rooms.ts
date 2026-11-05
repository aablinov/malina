import { randomInt } from 'node:crypto';
import { Profile, type ProfileData } from '../src/items.ts';
import { MAX_PLAYERS, NET_LIMITS, type ErrorCode, type RoomInfo, type SeatInfo, type ServerMsg } from '../src/net/protocol.ts';
import { Match, type MatchEnd } from '../src/game/match.ts';
import { newId } from './auth.ts';
import { tx, type Db } from './db.ts';
import { MAX_XP_PER_MATCH, type MapCatalog } from './maps.ts';
import type { Matches } from './repo/matches.ts';
import type { Profiles } from './repo/profiles.ts';
import type { Rooms as RoomRepo, RoomRow } from './repo/rooms.ts';
import type { MatchRunner } from './game/runner.ts';

/**
 * Multiplayer rooms (wiki/design-multiplayer.md): live in memory, every change is written to SQLite
 * so lobbies survive a restart. The connection (`Conn`) comes from server/hub.ts — the manager knows nothing about WebSocket.
 *
 * A dropped connection does not kick out of the room at once: the seat is held for NET_LIMITS.graceMs. This is also needed for "To battle" —
 * browsers reload the page at the battle address and sign in again. After a server restart seats are held for RESTORE_MS.
 * The server runs the battle (`Match`, src/game/match.ts): start creates a match in the runner, a running battle can be joined while there is a seat,
 * the host leaving does not interrupt the battle (the host is only the crown and lobby rights); everyone gone — the match is abandoned.
 */

export interface Conn {
  readonly playerId: string;
  readonly name: string;
  send(msg: ServerMsg): void;
}

interface Member {
  playerId: string;
  name: string;
  seat: number;
  ready: boolean;
  joinedAt: number;
  conn: Conn | null;
  /** Disconnected: when to free the seat */
  deadline: number | null;
}

interface Room {
  row: RoomRow;
  members: Member[];
  /** Running battle */
  matchId: string | null;
}

export interface RoomDeps {
  db: Db;
  rooms: RoomRepo;
  matches: Matches;
  profiles: Profiles;
  maps: MapCatalog;
  /** Running matches */
  games: MatchRunner;
  /** Player name by id — to restore seats after a restart */
  nameOf: (playerId: string) => string;
  now?: () => number;
}

/** Seats are held longer after a server restart: players do not know they need to sign in again */
export const RESTORE_MS = 10 * 60_000;
/** Closed rooms are deleted after a day (battle history stays in matches) */
export const PURGE_MS = 24 * 3600_000;
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export class RoomError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, text: string) { super(text); this.code = code; }
}

export class RoomManager {
  private readonly d: RoomDeps;
  private readonly now: () => number;
  private readonly byId = new Map<string, Room>();
  private readonly byPlayer = new Map<string, Room>();

  constructor(deps: RoomDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.restore();
  }

  // ---------- Entering a room ----------

  /** New player connection: if they sit in a room (reloaded the page, switched tabs) — return them to their seat */
  attach(c: Conn): void {
    const room = this.byPlayer.get(c.playerId);
    if (!room) return;
    const m = this.member(room, c.playerId);
    m.conn = c;
    m.deadline = null;
    this.saveMember(room, m);
    this.broadcast(room);
  }

  /** Connection closed: the seat is held until the deadline */
  detach(c: Conn): void {
    const room = this.byPlayer.get(c.playerId);
    if (!room) return;
    const m = this.member(room, c.playerId);
    if (m.conn !== c) return; // already signed in from another tab
    m.conn = null;
    m.deadline = this.now() + NET_LIMITS.graceMs;
    this.saveMember(room, m);
    this.broadcast(room);
  }

  create(c: Conn, map: string, max: number, priv: boolean): void {
    if (!this.d.maps.has(map)) throw new RoomError('bad-map', 'No such map');
    this.leave(c, 'leave');
    const now = this.now();
    const row: RoomRow = {
      id: newId(), code: this.freeCode(), host_id: c.playerId, map, max: Math.max(1, Math.min(MAX_PLAYERS, max)),
      private: priv ? 1 : 0, state: 'lobby', seed: 0, created_at: now, updated_at: now,
    };
    const room: Room = { row, members: [], matchId: null };
    tx(this.d.db, () => {
      this.d.rooms.insert(row);
      this.addMember(room, c);
    });
    this.byId.set(row.id, room);
    this.broadcast(room);
  }

  join(c: Conn, code: string): void {
    const room = [...this.byId.values()].find((r) => r.row.code === code.trim().toUpperCase());
    if (!room || room.row.state === 'closed') throw new RoomError('no-room', 'No room with that code');
    if (this.byPlayer.get(c.playerId) === room) { this.attach(c); return; }
    if (room.members.length >= room.row.max) throw new RoomError('room-full', 'Room is full');
    this.leave(c, 'leave');
    const matchId = room.matchId;
    let seat = 0;
    tx(this.d.db, () => {
      const m = this.addMember(room, c);
      seat = m.seat;
      // into a running battle: a row in the match (for the reward) — and straight to the battle page
      if (matchId) this.d.matches.addPlayer(matchId, m.playerId, m.seat);
    });
    if (matchId) this.d.games.get(matchId)?.join({ seat, playerId: c.playerId, name: c.name, profile: this.profileOf(c.playerId) });
    this.broadcast(room);
    if (room.row.state === 'battle' && matchId) c.send(this.startMsg(room, matchId));
  }

  /** Room chat: to everyone in it, with name and seat */
  chat(c: Conn, text: string): void {
    const room = this.roomOf(c), m = this.member(room, c.playerId);
    const t = text.replace(/\s+/g, ' ').trim().slice(0, NET_LIMITS.chatMax);
    if (!t) return;
    this.each(room, (x) => x.conn?.send({ t: 'chat', seat: m.seat, name: m.name, text: t }));
  }

  /** Leave on one's own (reason 'leave') or by the host's kick */
  leave(c: Conn | string, reason: 'leave' | 'kick'): void {
    const playerId = typeof c === 'string' ? c : c.playerId;
    const room = this.byPlayer.get(playerId);
    if (!room) return;
    const m = this.member(room, playerId);
    m.conn?.send({ t: 'room.left', reason });
    this.removeMember(room, m);
  }

  // ---------- Lobby ----------

  ready(c: Conn, ready: boolean): void {
    const room = this.roomOf(c);
    if (room.row.state !== 'lobby') return;
    const m = this.member(room, c.playerId);
    m.ready = ready;
    this.saveMember(room, m);
    this.broadcast(room);
  }

  setMap(c: Conn, map: string): void {
    const room = this.hostRoom(c);
    if (!this.d.maps.has(map)) throw new RoomError('bad-map', 'No such map');
    if (room.row.state !== 'lobby') return;
    room.row.map = map;
    // map changed — readiness is reset
    for (const m of room.members) m.ready = false;
    this.saveRoom(room, true);
    this.broadcast(room);
  }

  kick(c: Conn, playerId: string): void {
    const room = this.hostRoom(c);
    if (playerId === c.playerId || !room.members.some((m) => m.playerId === playerId)) return;
    this.leave(playerId, 'kick');
  }

  /** "To battle": host, all guests ready and online; again — "Once more" after a battle: same party, no readiness */
  start(c: Conn, again = false): void {
    const room = this.hostRoom(c);
    if (room.row.state !== 'lobby') throw new RoomError('not-ready', 'Battle already in progress');
    if (!again && room.members.some((m) => m.playerId !== room.row.host_id && (!m.ready || !m.conn))) throw new RoomError('not-ready', 'Not everyone is ready');
    const now = this.now();
    room.row.state = 'battle';
    room.row.seed = randomInt(1, 2 ** 31 - 1);
    room.matchId = newId();
    const matchId = room.matchId;
    tx(this.d.db, () => {
      this.saveRoom(room, false);
      this.d.matches.start(matchId, room.row.id, room.row.map, room.row.seed, room.members.map((m) => ({ playerId: m.playerId, seat: m.seat })), now);
    });
    // server-side battle: a world with the party's heroes built from their profiles
    const map = this.d.maps.load(room.row.map);
    if (!map) throw new RoomError('bad-map', 'No such map');
    const match = new Match({ id: matchId, map, seed: room.row.seed, players: room.members.map((m) => ({ seat: m.seat, playerId: m.playerId, name: m.name, profile: this.profileOf(m.playerId) })) });
    match.onEnd = (e) => this.finishMatch(room, matchId, e);
    this.d.games.add(match);
    const msg = this.startMsg(room, matchId);
    this.each(room, (m) => m.conn?.send(msg));
    this.broadcast(room);
  }

  private startMsg(room: Room, matchId: string): ServerMsg {
    const host = this.member(room, room.row.host_id);
    return { t: 'battle.start', matchId, map: room.row.map, players: room.members.length, seed: room.row.seed, hostSeat: host.seat, seats: this.seats(room) };
  }

  // ---------- Battle ----------

  /** Player's seat in the match (entry at `/game`); null — not in this battle */
  seatOf(matchId: string, playerId: string): number | null {
    const room = [...this.byId.values()].find((r) => r.matchId === matchId);
    const m = room?.members.find((x) => x.playerId === playerId);
    return m ? m.seat : null;
  }

  /** Hero profile for the server-side battle: from the database, else the starter one */
  private profileOf(playerId: string): ProfileData {
    const p = this.d.profiles.get(playerId);
    return p ? (p.data as ProfileData) : Profile.starter();
  }

  /**
   * Match ended (bush defended, withered, or everyone left): match goes to history, rewards capped per map go into the party heroes' profiles,
   * the room becomes a lobby again
   */
  private finishMatch(room: Room, matchId: string, e: MatchEnd): void {
    this.d.games.remove(matchId);
    if (room.matchId !== matchId) return;
    const now = this.now();
    const maxBerries = this.d.maps.maxBerries(room.row.map, room.members.length);
    const updated: { m: Member; version: number; data: ProfileData }[] = [];
    tx(this.d.db, () => {
      if (!this.d.matches.finish(matchId, e.result, Math.min(e.wave, this.d.maps.waves(room.row.map)), now)) return;
      for (const m of room.members) {
        const r = e.rewards.get(m.seat);
        if (!r) continue;
        const berries = Math.min(r.berries, maxBerries), xp = Math.min(r.xp, MAX_XP_PER_MATCH);
        this.d.matches.reward(matchId, m.playerId, berries, xp);
        const prof = this.d.profiles.get(m.playerId);
        if (!prof) continue;
        const p = new Profile(prof.data as ProfileData, false);
        p.addBerries(berries);
        p.addXp(xp);
        const version = this.d.profiles.put(m.playerId, prof.version, p.data, now);
        if (version !== null) updated.push({ m, version, data: p.data });
      }
      this.toLobby(room);
    });
    for (const u of updated) u.m.conn?.send({ t: 'profile.updated', version: u.version, data: u.data });
    this.each(room, (m) => m.conn?.send({ t: 'battle.over', matchId, result: e.result, wave: e.wave }));
    this.broadcast(room);
  }

  // ---------- Maintenance ----------

  /** Once a second: free seats past their deadline, delete old closed rooms */
  sweep(): void {
    const now = this.now();
    for (const room of [...this.byId.values()]) {
      for (const m of [...room.members]) if (m.deadline !== null && m.deadline <= now) this.removeMember(room, m);
    }
    this.d.rooms.purge(now - PURGE_MS);
  }

  /** Public rooms with free seats — for the list in the camp (a running battle can be joined too) */
  list(): RoomInfo[] {
    return [...this.byId.values()].filter((r) => r.row.state !== 'closed' && !r.row.private && r.members.length < r.row.max).map((r) => this.info(r));
  }

  /** Player's room — for tests and debugging */
  roomOfPlayer(playerId: string): RoomInfo | null {
    const r = this.byPlayer.get(playerId);
    return r ? this.info(r) : null;
  }

  // ---------- Internals ----------

  /** After a restart: battles are abandoned, lobbies remain, all players are disconnected */
  private restore(): void {
    const now = this.now();
    tx(this.d.db, () => {
      this.d.matches.abandonOpen(now);
      for (const row of this.d.rooms.live()) {
        const room: Room = { row, members: [], matchId: null };
        if (row.state === 'battle') { row.state = 'lobby'; row.updated_at = now; this.d.rooms.update(row); }
        for (const mr of this.d.rooms.members(row.id)) {
          const m: Member = { playerId: mr.player_id, name: this.d.nameOf(mr.player_id), seat: mr.seat, ready: false, joinedAt: mr.joined_at, conn: null, deadline: now + RESTORE_MS };
          room.members.push(m);
          this.byPlayer.set(m.playerId, room);
          this.saveMember(room, m);
        }
        if (!room.members.length) { this.close(room); continue; }
        this.byId.set(row.id, room);
      }
    });
  }

  private addMember(room: Room, c: Conn): Member {
    const taken = new Set(room.members.map((m) => m.seat));
    let seat = 0;
    while (taken.has(seat)) seat++;
    const m: Member = { playerId: c.playerId, name: c.name, seat, ready: false, joinedAt: this.now(), conn: c, deadline: null };
    room.members.push(m);
    this.byPlayer.set(c.playerId, room);
    this.saveMember(room, m);
    return m;
  }

  /**
   * Seat freed: the hero leaves the match; if the host left, the next one becomes host (in battle — only the crown).
   * Nobody left — the room is closed, the match abandoned
   */
  private removeMember(room: Room, m: Member): void {
    room.members = room.members.filter((x) => x !== m);
    if (this.byPlayer.get(m.playerId) === room) this.byPlayer.delete(m.playerId);
    if (room.matchId) this.d.games.get(room.matchId)?.leave(m.seat);
    tx(this.d.db, () => {
      this.d.rooms.removeMember(room.row.id, m.playerId);
      if (!room.members.length) { this.close(room); return; }
      if (m.playerId === room.row.host_id) {
        const next = [...room.members].sort((a, b) => Number(!a.conn) - Number(!b.conn) || a.seat - b.seat)[0];
        room.row.host_id = next.playerId;
      }
      this.saveRoom(room, false);
    });
    if (room.members.length) this.broadcast(room);
  }

  private close(room: Room): void {
    room.row.state = 'closed';
    if (room.matchId) {
      const match = this.d.games.get(room.matchId);
      this.d.games.remove(room.matchId);
      this.d.matches.finish(room.matchId, 'abandoned', match ? Math.max(0, match.td.wave - 1) : 0, this.now());
    }
    room.matchId = null;
    this.saveRoom(room, false);
    this.d.rooms.releaseCode(room.row.id);
    this.byId.delete(room.row.id);
  }

  /** Battle over: the room is a lobby again, readiness reset */
  private toLobby(room: Room): void {
    room.row.state = 'lobby';
    room.matchId = null;
    for (const m of room.members) { m.ready = false; this.saveMember(room, m); }
    this.saveRoom(room, false);
  }

  private freeCode(): string {
    for (;;) {
      let s = '';
      for (let i = 0; i < 6; i++) s += CODE_ABC[randomInt(CODE_ABC.length)];
      if (!this.d.rooms.codeTaken(s)) return s;
    }
  }

  private roomOf(c: Conn): Room {
    const r = this.byPlayer.get(c.playerId);
    if (!r) throw new RoomError('no-room', 'You are not in a room');
    return r;
  }

  private hostRoom(c: Conn): Room {
    const r = this.roomOf(c);
    if (r.row.host_id !== c.playerId) throw new RoomError('not-host', 'Only the host can do that');
    return r;
  }

  private member(room: Room, playerId: string): Member {
    const m = room.members.find((x) => x.playerId === playerId);
    if (!m) throw new Error(`No ${playerId} in room ${room.row.id}`);
    return m;
  }

  private saveRoom(room: Room, members: boolean): void {
    room.row.updated_at = this.now();
    this.d.rooms.update(room.row);
    if (members) for (const m of room.members) this.saveMember(room, m);
  }

  private saveMember(room: Room, m: Member): void {
    this.d.rooms.putMember({ room_id: room.row.id, player_id: m.playerId, seat: m.seat, ready: m.ready ? 1 : 0, joined_at: m.joinedAt, gone_at: m.deadline === null ? null : this.now() });
  }

  private info(r: Room): RoomInfo {
    const host = r.members.find((m) => m.playerId === r.row.host_id);
    return { id: r.row.id, code: r.row.code, host: host?.name ?? '', hostId: r.row.host_id, map: r.row.map, players: r.members.length, max: r.row.max, private: !!r.row.private, state: r.row.state };
  }

  private seats(r: Room): SeatInfo[] {
    return r.members.map((m) => ({ seat: m.seat, playerId: m.playerId, name: m.name, ready: m.ready, online: !!m.conn, host: m.playerId === r.row.host_id })).sort((a, b) => a.seat - b.seat);
  }

  private each(room: Room, f: (m: Member) => void): void { for (const m of room.members) f(m); }

  private broadcast(room: Room): void {
    const info = this.info(room), seats = this.seats(room);
    this.each(room, (m) => m.conn?.send({ t: 'room.state', room: info, seats, you: m.seat }));
  }
}
