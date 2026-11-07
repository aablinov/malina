import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { CLOSE, NET_LIMITS, PROTOCOL, type ClientMsg, type ServerMsg } from '../src/net/protocol.ts';
import type { Auth } from './auth.ts';
import type { Players } from './repo/players.ts';
import { RoomError, type Conn, type RoomManager } from './rooms.ts';
import { checkClientMsg } from './validate.ts';

/**
 * WebSocket connections: the first message is `hello` with a token, then `ClientMsg` parsing and hand-off to the room manager.
 * Limits: size — `maxPayload` (ws closes on its own), rate — NET_LIMITS.perSecond, two consecutive seconds over the limit —
 * close with CLOSE.flood. The battle runs over a separate WebSocket `/game` (server/game/game-hub.ts)
 */
const HELLO_MS = 15_000;

class Client implements Conn {
  readonly playerId: string;
  readonly name: string;
  readonly ws: WebSocket;
  /** Counters of the current second */
  windowStart = 0;
  count = 0;
  strikes = 0;
  /** Last chat message — no more often than NET_LIMITS.chatMs */
  chatAt = -Infinity;

  constructor(ws: WebSocket, playerId: string, name: string) { this.ws = ws; this.playerId = playerId; this.name = name; }

  send(msg: ServerMsg): void { if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg)); }
}

export interface HubDeps { auth: Auth; players: Players; rooms: RoomManager; now?: () => number }

export class Hub {
  readonly wss: WebSocketServer;
  private readonly d: HubDeps;
  private readonly now: () => number;
  private readonly online = new Map<string, Client>();
  /** Server is shutting down: connection closes no longer touch rooms (the database closes right after) */
  private closing = false;

  constructor(deps: HubDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: NET_LIMITS.maxMessage });
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => this.greet(ws, req));
  }

  /** Player is online (for friends) */
  isOnline(playerId: string): boolean { return this.online.has(playerId); }

  /** How many players are online */
  get size(): number { return this.online.size; }

  close(): void {
    this.closing = true;
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  private greet(ws: WebSocket, _req: IncomingMessage): void {
    const timer = setTimeout(() => ws.close(CLOSE.hello, 'hello'), HELLO_MS);
    ws.once('message', (raw: RawData) => {
      clearTimeout(timer);
      const msg = parse(raw);
      if (!msg || msg.t !== 'hello') { ws.close(CLOSE.auth, 'hello'); return; }
      if (msg.protocol !== PROTOCOL) { ws.close(CLOSE.protocol, `protocol ${PROTOCOL}`); return; }
      const p = this.d.auth.check(msg.token);
      if (!p) { ws.close(CLOSE.auth, 'token'); return; }
      this.d.players.touch(p.id, this.now());
      // same player from another tab — close the old connection
      const old = this.online.get(p.id);
      if (old) { this.d.rooms.detach(old); old.ws.close(CLOSE.replaced, 'replaced'); }
      const c = new Client(ws, p.id, p.name);
      this.online.set(p.id, c);
      c.send({ t: 'welcome', playerId: p.id, name: p.name });
      this.d.rooms.attach(c);
      ws.on('message', (data: RawData) => this.onMessage(c, data));
      ws.on('close', () => {
        if (this.online.get(c.playerId) === c) this.online.delete(c.playerId);
        if (!this.closing) this.d.rooms.detach(c);
      });
    });
  }

  private onMessage(c: Client, raw: RawData): void {
    const now = this.now();
    if (now - c.windowStart >= 1000) {
      c.strikes = c.count > NET_LIMITS.perSecond ? c.strikes + 1 : 0;
      c.windowStart = now; c.count = 0;
    }
    if (++c.count > NET_LIMITS.perSecond) {
      if (c.strikes >= 1) c.ws.close(CLOSE.flood, 'flood');
      return;
    }
    const msg = parse(raw);
    if (!msg) { c.send({ t: 'error', code: 'bad-message', text: 'Unrecognised message' }); return; }
    try {
      this.dispatch(c, msg);
    } catch (e) {
      if (e instanceof RoomError) c.send({ t: 'error', code: e.code, text: e.message });
      else throw e;
    }
  }

  private dispatch(c: Client, m: ClientMsg): void {
    const R = this.d.rooms, now = this.now;
    switch (m.t) {
      case 'hello': break;
      case 'ping': c.send({ t: 'pong' }); break;
      case 'room.create': R.create(c, m.map, m.max, m.private); break;
      case 'room.join': R.join(c, m.code); break;
      case 'room.leave': R.leave(c, 'leave'); break;
      case 'room.ready': R.ready(c, m.ready); break;
      case 'room.map': R.setMap(c, m.map); break;
      case 'room.kick': R.kick(c, m.playerId); break;
      case 'room.start': R.start(c); break;
      case 'room.again': R.start(c, true); break;
      case 'rtc': R.rtc(c, m.to, m.data); break;
      case 'voice': R.voice(c, m.on); break;
      case 'chat': {
        if (now() - c.chatAt < NET_LIMITS.chatMs) return;
        c.chatAt = now();
        R.chat(c, m.text);
        break;
      }
    }
  }
}

function parse(raw: RawData): ClientMsg | null {
  try { return checkClientMsg(JSON.parse(raw.toString())); } catch { return null; }
}
