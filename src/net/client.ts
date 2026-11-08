import { t } from '../i18n/i18n.ts';
import type { Profile, ProfileData } from '../items.ts';
import {
  CLOSE, NET_LIMITS, PROTOCOL,
  type AuthReply, type ClientMsg, type FriendInfo, type MatchSummary, type ProfileReply, type RoomInfo, type SeatInfo, type ServerMsg,
} from './protocol.ts';

/**
 * Browser client of the network game server (server/, wiki/design-multiplayer.md): login by name, the hero profile
 * on the server, camp rooms; the battle itself goes over `/game` (src/cgame/net-battle.ts).
 *
 * Server address: `?server=http://…` (remembered), else the stored one, else the same origin if the server itself served the game
 * (`STATIC=dist npm run server`), else http://localhost:8787.
 *
 * Profile: the server is the master. The client remembers the version of the last sync; if the server's version is newer
 * (battle rewards, another browser) the server profile is taken, otherwise the local one goes to the server
 */
const AUTH_KEY = 'malina.net';
const SERVER_KEY = 'malina.server';
const VERSION_KEY = 'malina.net.version';
/** The battle the room went into: seat, seed, host — read by the battle page */
const BATTLE_KEY = 'malina.net.battle';
/** The last room the player went into battle with — survives closing the tab: the room list offers "Return" */
const LAST_KEY = 'malina.net.last';
export const DEFAULT_SERVER = 'http://localhost:8787';
/** Ping in battle — once per this many ms */
const PING_BATTLE_MS = 2000;

export interface NetAuth { playerId: string; name: string; token: string }
export interface RoomView { room: RoomInfo; seats: SeatInfo[]; you: number }
export interface LastRoom { code: string; matchId: string }
export interface NetBattle { matchId: string; code: string; map: string; players: number; seed: number; hostSeat: number; seat: number; seats: SeatInfo[] }

const read = <T>(store: Storage, key: string): T | null => {
  try { const raw = store.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
};
const write = (store: Storage, key: string, v: unknown): void => {
  try { if (v === null) store.removeItem(key); else store.setItem(key, JSON.stringify(v)); } catch { /* storage closed */ }
};

export function serverUrl(): string {
  const q = new URLSearchParams(window.location.search).get('server');
  if (q) { write(localStorage, SERVER_KEY, q); return q.replace(/\/$/, ''); }
  const saved = read<string>(localStorage, SERVER_KEY);
  if (saved) return saved;
  const { protocol, origin, port } = window.location;
  return (protocol === 'http:' || protocol === 'https:') && port !== '5173' ? origin : DEFAULT_SERVER;
}

/** The room's battle, if the page was opened from the network camp */
export function netBattle(): NetBattle | null { return read<NetBattle>(sessionStorage, BATTLE_KEY); }

export class NetClient {
  readonly base: string;
  /** The server answered /api/health */
  available = false;
  auth: NetAuth | null = read<NetAuth>(localStorage, AUTH_KEY);
  /** The room the player is in */
  room: RoomView | null = null;
  /** Connection open and login confirmed */
  online = false;
  /** Error from the server or the network — show in the camp */
  onError?: (text: string) => void;
  /** The room asks for a password (need-password) or it was wrong (bad) — the camp opens the field for that code */
  onPassword?: (code: string, bad: boolean) => void;
  /** Code of the last room.join — for the password answer */
  private joining = '';
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<(m: ServerMsg) => void>();
  private ping = 0;
  /** Ping to the server, ms (from the last pong; in battle measured once per PING_BATTLE_MS) */
  rtt = 0;
  private pingAt = 0;
  /** Measure ping more often — the player list in battle */
  private fastPing = false;
  private retry = 0;
  private stopped = false;
  private profile: Profile | null = null;
  private pushTimer = 0;
  /** The client itself is changing the profile (it came from the server) — do not send it back */
  private taking = false;

  constructor(base = serverUrl()) { this.base = base; }

  // ---------- REST ----------

  /** Check the server (no longer than 5 s: the page may be busy) */
  async probe(): Promise<boolean> {
    try {
      const r = await fetch(`${this.base}/api/health`, { signal: AbortSignal.timeout(5000) });
      this.available = r.ok && ((await r.json()) as { protocol?: number }).protocol === PROTOCOL;
    } catch { this.available = false; }
    return this.available;
  }

  async list(): Promise<RoomInfo[]> {
    if (!this.available) return [];
    const r = await this.api('GET', '/api/rooms');
    return r.ok ? ((await r.json()) as RoomInfo[]) : [];
  }

  /** Log in by name; null — the name is taken or bad (the error text goes to onError) */
  async login(name: string): Promise<NetAuth | null> {
    const r = await this.api('POST', '/api/auth', { name });
    const body = (await r.json()) as AuthReply & { error?: string };
    if (!r.ok) { this.onError?.(body.error ? t(body.error) : t('Could not log in')); return null; }
    if (this.auth?.playerId !== body.playerId) write(localStorage, VERSION_KEY, null);
    this.auth = { playerId: body.playerId, name: body.name, token: body.token };
    write(localStorage, AUTH_KEY, this.auth);
    return this.auth;
  }

  /** Forget the login (the hero stays on the server, but cannot be returned to without the token) */
  logout(): void {
    this.stop();
    this.auth = null;
    write(localStorage, AUTH_KEY, null);
    write(localStorage, VERSION_KEY, null);
  }

  /** Friends: whether online and in which room */
  async friends(): Promise<FriendInfo[]> {
    if (!this.auth) return [];
    const r = await this.api('GET', '/api/friends');
    return r.ok ? ((await r.json()) as FriendInfo[]) : [];
  }

  /** Add a friend by name; false — no such player (the text goes to onError) */
  async addFriend(name: string): Promise<boolean> {
    const r = await this.api('POST', '/api/friends', { name });
    if (!r.ok) { const e = ((await r.json().catch(() => ({}))) as { error?: string }).error; this.onError?.(e ? t(e) : t('Could not add')); }
    return r.ok;
  }

  async removeFriend(playerId: string): Promise<void> { await this.api('DELETE', `/api/friends?id=${encodeURIComponent(playerId)}`); }

  async matches(limit = 20): Promise<MatchSummary[]> {
    const r = await this.api('GET', `/api/matches?limit=${limit}`);
    return r.ok ? ((await r.json()) as MatchSummary[]) : [];
  }

  /**
   * Link the hero profile with the server: newer on the server — take it, otherwise send ours.
   * From then on profile changes (in the camp) go to the server with a delay
   */
  async syncProfile(profile: Profile): Promise<void> {
    if (!this.auth) return;
    this.profile = profile;
    const r = await this.api('GET', '/api/profile');
    const known = read<number>(localStorage, VERSION_KEY) ?? 0;
    if (r.ok) {
      const srv = (await r.json()) as ProfileReply;
      if (srv.version > known) this.takeProfile(srv);
      else await this.pushProfile();
    } else if (r.status === 404) {
      write(localStorage, VERSION_KEY, 0);
      await this.pushProfile();
    }
    profile.onChange(() => {
      if (this.taking) return;
      window.clearTimeout(this.pushTimer);
      this.pushTimer = window.setTimeout(() => void this.pushProfile(), 800);
    });
  }

  private async pushProfile(): Promise<void> {
    const p = this.profile;
    if (!p || !this.auth) return;
    const version = read<number>(localStorage, VERSION_KEY) ?? 0;
    const r = await this.api('PUT', '/api/profile', { version, data: p.data });
    if (r.ok || r.status === 409) this.takeProfile((await r.json()) as ProfileReply, r.ok);
    else { const e = ((await r.json().catch(() => ({}))) as { error?: string }).error; this.onError?.(e ? t(e) : t('The profile was not saved on the server')); }
  }

  /** Server profile into the hero; mine — it is ours anyway, only remember the version */
  private takeProfile(srv: ProfileReply, mine = false): void {
    // the battle page does not link the profile: the camp takes the server one by version
    const p = this.profile;
    if (!p) return;
    write(localStorage, VERSION_KEY, srv.version);
    if (mine) return;
    p.data = srv.data as ProfileData;
    p.data.equip.aura ??= null;
    this.taking = true;
    p.save();
    this.taking = false;
  }

  private api(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.auth) headers.Authorization = `Bearer ${this.auth.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  // ---------- WebSocket ----------

  /** Ping once per pingMs (in battle more often, for the player list) */
  private startPing(): void {
    window.clearInterval(this.ping);
    const tick = (): void => { this.pingAt = performance.now(); this.send({ t: 'ping' }); };
    tick();
    this.ping = window.setInterval(tick, this.fastPing ? PING_BATTLE_MS : NET_LIMITS.pingMs);
  }

  /** Battle page: ping more often */
  battlePing(): void { this.fastPing = true; if (this.online) this.startPing(); }

  /** Subscribe to server messages; returns the unsubscribe */
  on(f: (m: ServerMsg) => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  connect(): void {
    if (!this.auth || this.ws) return;
    this.stopped = false;
    const ws = new WebSocket(`${this.base.replace(/^http/, 'ws')}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.send({ t: 'hello', token: this.auth?.token ?? '', protocol: PROTOCOL }); };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try { m = JSON.parse(String(e.data)) as ServerMsg; } catch { return; }
      this.handle(m);
    };
    ws.onclose = (e) => {
      this.ws = null;
      this.online = false;
      window.clearInterval(this.ping);
      this.emit({ t: 'room.left', reason: 'closed' });
      if (e.code === CLOSE.auth) { this.onError?.(t('The server did not recognise the hero — log in again')); this.logout(); return; }
      if (e.code === CLOSE.protocol) { this.onError?.(t('The game version does not match the server — reload the page')); return; }
      if (e.code === CLOSE.replaced || this.stopped) return;
      // dropped — reconnect: the seat in the room is held for NET_LIMITS.graceMs
      this.retry = Math.min(this.retry + 1, 5);
      window.setTimeout(() => this.connect(), 500 * 2 ** this.retry);
    };
  }

  stop(): void {
    this.stopped = true;
    window.clearInterval(this.ping);
    this.ws?.close();
    this.ws = null;
    this.online = false;
  }

  send(m: ClientMsg): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  /** password '' — an open room */
  createRoom(map: string, password: string, max = 4): void { this.send({ t: 'room.create', map, max, password }); }
  joinRoom(code: string, password?: string): void { this.joining = code; this.send(password ? { t: 'room.join', code, password } : { t: 'room.join', code }); }
  /** The last room the player was in battle with (the room list offers "Return") */
  get lastRoom(): LastRoom | null { return read<LastRoom>(localStorage, LAST_KEY); }
  leaveRoom(): void { this.send({ t: 'room.leave' }); this.room = null; }
  setReady(ready: boolean): void { this.send({ t: 'room.ready', ready }); }
  setMap(map: string): void { this.send({ t: 'room.map', map }); }
  kick(playerId: string): void { this.send({ t: 'room.kick', playerId }); }
  startBattle(): void { this.send({ t: 'room.start' }); }
  /** "Again" after a battle — host: with the same party */
  again(): void { this.send({ t: 'room.again' }); }
  chat(text: string): void { if (text.trim()) this.send({ t: 'chat', text }); }
  get isHost(): boolean { return !!this.room && this.room.room.hostId === this.auth?.playerId; }

  private handle(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.online = true;
        this.retry = 0;
        this.startPing();
        break;
      case 'room.state': this.room = { room: m.room, seats: m.seats, you: m.you }; break;
      case 'room.left': this.room = null; if (m.reason !== 'closed') write(localStorage, LAST_KEY, null); break;
      case 'error':
        if ((m.code === 'need-password' || m.code === 'bad-password') && this.onPassword) {
          this.onPassword(this.joining, m.code === 'bad-password');
          if (m.code === 'need-password') break;
        }
        this.onError?.(t(m.text));
        break;
      case 'profile.updated': this.takeProfile({ version: m.version, data: m.data }); break;
      case 'battle.start':
        write(sessionStorage, BATTLE_KEY, { matchId: m.matchId, code: this.room?.room.code ?? '', map: m.map, players: m.players, seed: m.seed, hostSeat: m.hostSeat, seat: this.room?.you ?? 0, seats: m.seats } satisfies NetBattle);
        write(localStorage, LAST_KEY, { code: this.room?.room.code ?? '', matchId: m.matchId } satisfies LastRoom);
        break;
      case 'battle.over': write(sessionStorage, BATTLE_KEY, null); write(localStorage, LAST_KEY, null); break;
      case 'pong': this.rtt = Math.round(performance.now() - this.pingAt); break;
      default: break;
    }
    this.emit(m);
  }

  private emit(m: ServerMsg): void { for (const f of this.listeners) f(m); }
}
