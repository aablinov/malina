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
 * Комнаты сетевой игры (wiki/design-multiplayer.md): живут в памяти, каждое изменение пишется в SQLite,
 * чтобы лобби пережили перезапуск. Соединение (`Conn`) даёт server/hub.ts — менеджер о WebSocket не знает.
 *
 * Обрыв связи не выкидывает из комнаты сразу: место держится NET_LIMITS.graceMs. Это нужно и для «В бой» —
 * браузеры перезагружают страницу на адрес боя и входят заново. После перезапуска сервера места держатся RESTORE_MS.
 * Бой считает сервер (`Match`, src/game/match.ts): старт создаёт матч в раннере, в идущий бой можно войти, пока есть место,
 * уход хоста бой не прерывает (хост — только корона и права в лобби); все ушли — матч прерван.
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
  /** Отключён: когда освободить место */
  deadline: number | null;
}

interface Room {
  row: RoomRow;
  members: Member[];
  /** Идущий бой */
  matchId: string | null;
}

export interface RoomDeps {
  db: Db;
  rooms: RoomRepo;
  matches: Matches;
  profiles: Profiles;
  maps: MapCatalog;
  /** Идущие матчи */
  games: MatchRunner;
  /** Имя игрока по id — для восстановления мест после перезапуска */
  nameOf: (playerId: string) => string;
  now?: () => number;
}

/** Места после перезапуска сервера держатся дольше: игроки не знают, что надо войти заново */
export const RESTORE_MS = 10 * 60_000;
/** Закрытые комнаты удаляются через сутки (история боёв остаётся в matches) */
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

  // ---------- Вход в комнату ----------

  /** Новое соединение игрока: если он сидит в комнате (перезагрузил страницу, сменил вкладку) — вернуть на место */
  attach(c: Conn): void {
    const room = this.byPlayer.get(c.playerId);
    if (!room) return;
    const m = this.member(room, c.playerId);
    m.conn = c;
    m.deadline = null;
    this.saveMember(room, m);
    this.broadcast(room);
  }

  /** Соединение закрылось: место держится, пока не выйдет срок */
  detach(c: Conn): void {
    const room = this.byPlayer.get(c.playerId);
    if (!room) return;
    const m = this.member(room, c.playerId);
    if (m.conn !== c) return; // уже вошёл с другой вкладки
    m.conn = null;
    m.deadline = this.now() + NET_LIMITS.graceMs;
    this.saveMember(room, m);
    this.broadcast(room);
  }

  create(c: Conn, map: string, max: number, priv: boolean): void {
    if (!this.d.maps.has(map)) throw new RoomError('bad-map', `Нет карты ${map}`);
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
    if (!room || room.row.state === 'closed') throw new RoomError('no-room', 'Комнаты с таким кодом нет');
    if (this.byPlayer.get(c.playerId) === room) { this.attach(c); return; }
    if (room.members.length >= room.row.max) throw new RoomError('room-full', 'Комната заполнена');
    this.leave(c, 'leave');
    const matchId = room.matchId;
    let seat = 0;
    tx(this.d.db, () => {
      const m = this.addMember(room, c);
      seat = m.seat;
      // в идущий бой: строка в матче (для награды) — и сразу на страницу боя
      if (matchId) this.d.matches.addPlayer(matchId, m.playerId, m.seat);
    });
    if (matchId) this.d.games.get(matchId)?.join({ seat, playerId: c.playerId, name: c.name, profile: this.profileOf(c.playerId) });
    this.broadcast(room);
    if (room.row.state === 'battle' && matchId) c.send(this.startMsg(room, matchId));
  }

  /** Чат комнаты: всем в ней, с именем и местом */
  chat(c: Conn, text: string): void {
    const room = this.roomOf(c), m = this.member(room, c.playerId);
    const t = text.replace(/\s+/g, ' ').trim().slice(0, NET_LIMITS.chatMax);
    if (!t) return;
    this.each(room, (x) => x.conn?.send({ t: 'chat', seat: m.seat, name: m.name, text: t }));
  }

  /** Выйти самому (reason 'leave') или по кику хоста */
  leave(c: Conn | string, reason: 'leave' | 'kick'): void {
    const playerId = typeof c === 'string' ? c : c.playerId;
    const room = this.byPlayer.get(playerId);
    if (!room) return;
    const m = this.member(room, playerId);
    m.conn?.send({ t: 'room.left', reason });
    this.removeMember(room, m);
  }

  // ---------- Лобби ----------

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
    if (!this.d.maps.has(map)) throw new RoomError('bad-map', `Нет карты ${map}`);
    if (room.row.state !== 'lobby') return;
    room.row.map = map;
    // карта сменилась — готовность заново
    for (const m of room.members) m.ready = false;
    this.saveRoom(room, true);
    this.broadcast(room);
  }

  kick(c: Conn, playerId: string): void {
    const room = this.hostRoom(c);
    if (playerId === c.playerId || !room.members.some((m) => m.playerId === playerId)) return;
    this.leave(playerId, 'kick');
  }

  /** «В бой»: хост, все гости готовы и на связи; again — «Ещё раз» после боя: тем же составом, без готовности */
  start(c: Conn, again = false): void {
    const room = this.hostRoom(c);
    if (room.row.state !== 'lobby') throw new RoomError('not-ready', 'Бой уже идёт');
    if (!again && room.members.some((m) => m.playerId !== room.row.host_id && (!m.ready || !m.conn))) throw new RoomError('not-ready', 'Не все готовы');
    const now = this.now();
    room.row.state = 'battle';
    room.row.seed = randomInt(1, 2 ** 31 - 1);
    room.matchId = newId();
    const matchId = room.matchId;
    tx(this.d.db, () => {
      this.saveRoom(room, false);
      this.d.matches.start(matchId, room.row.id, room.row.map, room.row.seed, room.members.map((m) => ({ playerId: m.playerId, seat: m.seat })), now);
    });
    // серверный бой: мир с героями партии по их профилям
    const map = this.d.maps.load(room.row.map);
    if (!map) throw new RoomError('bad-map', `Нет карты ${room.row.map}`);
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

  // ---------- Бой ----------

  /** Место игрока в матче (вход на `/game`); null — не в этом бою */
  seatOf(matchId: string, playerId: string): number | null {
    const room = [...this.byId.values()].find((r) => r.matchId === matchId);
    const m = room?.members.find((x) => x.playerId === playerId);
    return m ? m.seat : null;
  }

  /** Профиль героя для серверного боя: из базы, нет — стартовый */
  private profileOf(playerId: string): ProfileData {
    const p = this.d.profiles.get(playerId);
    return p ? (p.data as ProfileData) : Profile.starter();
  }

  /**
   * Матч кончился (куст отбит, засох или все ушли): матч в историю, награды с потолком по карте — в профили героев партии,
   * комната — снова лобби
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

  // ---------- Обслуживание ----------

  /** Раз в секунду: освободить места с вышедшим сроком, удалить старые закрытые комнаты */
  sweep(): void {
    const now = this.now();
    for (const room of [...this.byId.values()]) {
      for (const m of [...room.members]) if (m.deadline !== null && m.deadline <= now) this.removeMember(room, m);
    }
    this.d.rooms.purge(now - PURGE_MS);
  }

  /** Публичные комнаты с местами — для списка в лагере (и в идущий бой можно войти) */
  list(): RoomInfo[] {
    return [...this.byId.values()].filter((r) => r.row.state !== 'closed' && !r.row.private && r.members.length < r.row.max).map((r) => this.info(r));
  }

  /** Комната игрока — для тестов и отладки */
  roomOfPlayer(playerId: string): RoomInfo | null {
    const r = this.byPlayer.get(playerId);
    return r ? this.info(r) : null;
  }

  // ---------- Внутреннее ----------

  /** После перезапуска: бои прерваны, лобби остаются, все игроки — отключены */
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
   * Место освободилось: герой уходит из матча; ушёл хост — хостом становится следующий (в бою — только корона).
   * Никого не осталось — комната закрыта, матч прерван
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

  /** Бой кончился: комната снова лобби, готовность заново */
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
    if (!r) throw new RoomError('no-room', 'Ты не в комнате');
    return r;
  }

  private hostRoom(c: Conn): Room {
    const r = this.roomOf(c);
    if (r.row.host_id !== c.playerId) throw new RoomError('not-host', 'Это может только хост');
    return r;
  }

  private member(room: Room, playerId: string): Member {
    const m = room.members.find((x) => x.playerId === playerId);
    if (!m) throw new Error(`Нет ${playerId} в комнате ${room.row.id}`);
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
