import type { Profile, ProfileData } from '../items.ts';
import {
  CLOSE, NET_LIMITS, PROTOCOL,
  type AuthReply, type ClientMsg, type FriendInfo, type MatchSummary, type ProfileReply, type RoomInfo, type SeatInfo, type ServerMsg,
} from './protocol.ts';

/**
 * Браузерный клиент сервера сетевой игры (server/, wiki/design-multiplayer.md): вход по имени, профиль героя
 * на сервере, комнаты лагеря; сам бой — по `/game` (src/cgame/net-battle.ts).
 *
 * Адрес сервера: `?server=http://…` (запоминается), иначе сохранённый, иначе тот же адрес, если игру отдал сам сервер
 * (`STATIC=dist npm run server`), иначе http://localhost:8787.
 *
 * Профиль: сервер — главный. Версию последней синхронизации клиент помнит; если на сервере версия новее
 * (награды боя, другой браузер) — берётся серверный профиль, иначе на сервер уходит локальный
 */
const AUTH_KEY = 'malina.net';
const SERVER_KEY = 'malina.server';
const VERSION_KEY = 'malina.net.version';
/** Бой, в который ушла комната: место, сид, хост — читает страница боя */
const BATTLE_KEY = 'malina.net.battle';
export const DEFAULT_SERVER = 'http://localhost:8787';
/** Пинг в бою — раз в столько мс */
const PING_BATTLE_MS = 2000;

export interface NetAuth { playerId: string; name: string; token: string }
export interface RoomView { room: RoomInfo; seats: SeatInfo[]; you: number }
export interface NetBattle { matchId: string; code: string; map: string; players: number; seed: number; hostSeat: number; seat: number; seats: SeatInfo[] }

const read = <T>(store: Storage, key: string): T | null => {
  try { const raw = store.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
};
const write = (store: Storage, key: string, v: unknown): void => {
  try { if (v === null) store.removeItem(key); else store.setItem(key, JSON.stringify(v)); } catch { /* закрытое хранилище */ }
};

export function serverUrl(): string {
  const q = new URLSearchParams(window.location.search).get('server');
  if (q) { write(localStorage, SERVER_KEY, q); return q.replace(/\/$/, ''); }
  const saved = read<string>(localStorage, SERVER_KEY);
  if (saved) return saved;
  const { protocol, origin, port } = window.location;
  return (protocol === 'http:' || protocol === 'https:') && port !== '5173' ? origin : DEFAULT_SERVER;
}

/** Бой из комнаты, если страница открыта из сетевого лагеря */
export function netBattle(): NetBattle | null { return read<NetBattle>(sessionStorage, BATTLE_KEY); }

export class NetClient {
  readonly base: string;
  /** Сервер ответил на /api/health */
  available = false;
  auth: NetAuth | null = read<NetAuth>(localStorage, AUTH_KEY);
  /** Комната, в которой сидит игрок */
  room: RoomView | null = null;
  /** Соединение открыто и вход подтверждён */
  online = false;
  /** Ошибка от сервера или сети — показать в лагере */
  onError?: (text: string) => void;
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<(m: ServerMsg) => void>();
  private ping = 0;
  /** Пинг до сервера, мс (по последнему pong; в бою меряется раз в PING_BATTLE_MS) */
  rtt = 0;
  private pingAt = 0;
  /** Чаще мерить пинг — список игроков в бою */
  private fastPing = false;
  private retry = 0;
  private stopped = false;
  private profile: Profile | null = null;
  private pushTimer = 0;
  /** Профиль меняет сам клиент (пришёл с сервера) — обратно не отправлять */
  private taking = false;

  constructor(base = serverUrl()) { this.base = base; }

  // ---------- REST ----------

  /** Проверить сервер (не дольше 5 с: страница может быть занята) */
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

  /** Войти под именем; null — имя занято или плохое (текст ошибки — в onError) */
  async login(name: string): Promise<NetAuth | null> {
    const r = await this.api('POST', '/api/auth', { name });
    const body = (await r.json()) as AuthReply & { error?: string };
    if (!r.ok) { this.onError?.(body.error ?? 'Не удалось войти'); return null; }
    if (this.auth?.playerId !== body.playerId) write(localStorage, VERSION_KEY, null);
    this.auth = { playerId: body.playerId, name: body.name, token: body.token };
    write(localStorage, AUTH_KEY, this.auth);
    return this.auth;
  }

  /** Забыть вход (герой на сервере остаётся, но вернуться к нему без токена нельзя) */
  logout(): void {
    this.stop();
    this.auth = null;
    write(localStorage, AUTH_KEY, null);
    write(localStorage, VERSION_KEY, null);
  }

  /** Друзья: на связи ли и в какой комнате */
  async friends(): Promise<FriendInfo[]> {
    if (!this.auth) return [];
    const r = await this.api('GET', '/api/friends');
    return r.ok ? ((await r.json()) as FriendInfo[]) : [];
  }

  /** Добавить друга по имени; false — нет такого (текст — в onError) */
  async addFriend(name: string): Promise<boolean> {
    const r = await this.api('POST', '/api/friends', { name });
    if (!r.ok) this.onError?.(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Не удалось добавить');
    return r.ok;
  }

  async removeFriend(playerId: string): Promise<void> { await this.api('DELETE', `/api/friends?id=${encodeURIComponent(playerId)}`); }

  async matches(limit = 20): Promise<MatchSummary[]> {
    const r = await this.api('GET', `/api/matches?limit=${limit}`);
    return r.ok ? ((await r.json()) as MatchSummary[]) : [];
  }

  /**
   * Связать профиль героя с сервером: на сервере новее — взять его, иначе отправить свой.
   * Дальше изменения профиля (в лагере) уходят на сервер с задержкой
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
    else this.onError?.(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Профиль не сохранился на сервере');
  }

  /** Серверный профиль — в героя; mine — это и так наш, только запомнить версию */
  private takeProfile(srv: ProfileReply, mine = false): void {
    // страница боя профиль не связывает: серверный заберёт лагерь по версии
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

  /** Пинг раз в pingMs (в бою — чаще, для списка игроков) */
  private startPing(): void {
    window.clearInterval(this.ping);
    const tick = (): void => { this.pingAt = performance.now(); this.send({ t: 'ping' }); };
    tick();
    this.ping = window.setInterval(tick, this.fastPing ? PING_BATTLE_MS : NET_LIMITS.pingMs);
  }

  /** Страница боя: пинг чаще */
  battlePing(): void { this.fastPing = true; if (this.online) this.startPing(); }

  /** Подписка на сообщения сервера; вернёт отписку */
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
      if (e.code === CLOSE.auth) { this.onError?.('Сервер не узнал героя — войди заново'); this.logout(); return; }
      if (e.code === CLOSE.protocol) { this.onError?.('Версия игры не совпадает с сервером — обнови страницу'); return; }
      if (e.code === CLOSE.replaced || this.stopped) return;
      // обрыв — переподключиться: место в комнате держится NET_LIMITS.graceMs
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

  createRoom(map: string, priv: boolean, max = 4): void { this.send({ t: 'room.create', map, max, private: priv }); }
  joinRoom(code: string): void { this.send({ t: 'room.join', code }); }
  leaveRoom(): void { this.send({ t: 'room.leave' }); this.room = null; }
  setReady(ready: boolean): void { this.send({ t: 'room.ready', ready }); }
  setMap(map: string): void { this.send({ t: 'room.map', map }); }
  kick(playerId: string): void { this.send({ t: 'room.kick', playerId }); }
  startBattle(): void { this.send({ t: 'room.start' }); }
  /** «Ещё раз» после боя — хост: тем же составом */
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
      case 'room.left': this.room = null; break;
      case 'error': this.onError?.(m.text); break;
      case 'profile.updated': this.takeProfile({ version: m.version, data: m.data }); break;
      case 'battle.start':
        write(sessionStorage, BATTLE_KEY, { matchId: m.matchId, code: this.room?.room.code ?? '', map: m.map, players: m.players, seed: m.seed, hostSeat: m.hostSeat, seat: this.room?.you ?? 0, seats: m.seats } satisfies NetBattle);
        break;
      case 'battle.over': write(sessionStorage, BATTLE_KEY, null); break;
      case 'pong': this.rtt = Math.round(performance.now() - this.pingAt); break;
      default: break;
    }
    this.emit(m);
  }

  private emit(m: ServerMsg): void { for (const f of this.listeners) f(m); }
}
