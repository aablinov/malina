import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Channel } from '../../src/net/channel.ts';
import { CLOSE, NET_LIMITS, PROTOCOL } from '../../src/net/protocol.ts';
import type { GameClientMsg } from '../../src/net/game-protocol.ts';
import { WebSocketTransport } from '../../src/net/ws-transport.ts';
import type { GameChannel } from '../../src/game/match.ts';
import type { Auth } from '../auth.ts';
import type { MatchRunner } from './runner.ts';

/**
 * WebSocket боя `/game` (wiki/design-multiplayer.md, раздел 7): каждое соединение — `Channel` над транспортом;
 * первое надёжное сообщение — `hello` с токеном и матчем, дальше канал отдаётся матчу (`Match.attach`).
 * Лобби, чат и профили живут на `/ws` (server/hub.ts)
 */
const HELLO_MS = 15_000;
export const DEFLATE = { threshold: 64, serverNoContextTakeover: false, clientNoContextTakeover: false, serverMaxWindowBits: 15, clientMaxWindowBits: 15, zlibDeflateOptions: { level: 6, memLevel: 8 }, concurrencyLimit: 4 };

export interface GameHubDeps {
  auth: Auth;
  runner: MatchRunner;
  /** Место игрока в матче; null — не в нём */
  seatOf: (matchId: string, playerId: string) => number | null;
  now?: () => number;
}

export class GameHub {
  readonly wss: WebSocketServer;
  private readonly d: GameHubDeps;
  private closing = false;

  constructor(deps: GameHubDeps) {
    this.d = deps;
    // permessage-deflate с общим контекстом: снимки похожи от кадра к кадру, сжимаются в разы; порог низкий — кадры мелкие
    this.wss = new WebSocketServer({ noServer: true, maxPayload: NET_LIMITS.maxMessage, perMessageDeflate: DEFLATE });
    this.wss.on('connection', (ws: WebSocket) => this.greet(ws));
  }

  close(): void {
    this.closing = true;
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  private greet(ws: WebSocket): void {
    const now = this.d.now ?? Date.now;
    const chan: GameChannel = new Channel(new WebSocketTransport(ws as unknown as ConstructorParameters<typeof WebSocketTransport>[0]), { clock: now });
    const timer = setTimeout(() => chan.close(CLOSE.hello), HELLO_MS);
    chan.onReliable = (m) => {
      const h = m as GameClientMsg;
      if (!h || h.t !== 'hello') return;
      clearTimeout(timer);
      if (h.protocol !== PROTOCOL) { chan.close(CLOSE.protocol); return; }
      const p = this.d.auth.check(String(h.token ?? ''));
      if (!p) { chan.close(CLOSE.auth); return; }
      const match = this.d.runner.get(String(h.matchId ?? ''));
      const seat = match ? this.d.seatOf(match.id, p.id) : null;
      if (!match || seat === null) { chan.sendReliable({ t: 'error', text: 'Нет такого боя' }); chan.flush(); chan.close(4004); return; }
      // дальше канал ведёт матч: он перепишет обработчики
      if (!this.closing) match.attach(seat, chan);
    };
    chan.onClose = () => clearTimeout(timer);
  }

  /** Апгрейд HTTP → WebSocket боя */
  upgrade(req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  }
}
