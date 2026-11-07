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
 * Battle WebSocket `/game` (wiki/design-multiplayer.md, section 7): each connection is a `Channel` over a transport;
 * the first reliable message is `hello` with a token and a match, then the channel is handed to the match (`Match.attach`).
 * Lobby, chat and profiles live on `/ws` (server/hub.ts)
 */
const HELLO_MS = 15_000;
/**
 * Client parameters (client_max_window_bits, *_no_context_takeover) are not forced: Safari offers bare
 * `permessage-deflate`, and `ws` with a hard clientMaxWindowBits rejected every offer — 400 and no connection
 */
export const DEFLATE = { threshold: 64, serverMaxWindowBits: 15, zlibDeflateOptions: { level: 6, memLevel: 8 }, concurrencyLimit: 4 };

export interface GameHubDeps {
  auth: Auth;
  runner: MatchRunner;
  /** Player's seat in the match; null — not in it */
  seatOf: (matchId: string, playerId: string) => number | null;
  now?: () => number;
}

export class GameHub {
  readonly wss: WebSocketServer;
  private readonly d: GameHubDeps;
  private closing = false;

  constructor(deps: GameHubDeps) {
    this.d = deps;
    // permessage-deflate with a shared context: snapshots look alike frame to frame and compress several times over; low threshold — frames are small
    this.wss = new WebSocketServer({ noServer: true, maxPayload: NET_LIMITS.maxGameFrame, perMessageDeflate: DEFLATE });
    this.wss.on('connection', (ws: WebSocket) => this.greet(ws));
  }

  close(): void {
    this.closing = true;
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  private greet(ws: WebSocket): void {
    // without a listener a socket error (oversized frame — 1009, bad deflate) is thrown and kills the process; ws closes the socket itself
    ws.on('error', (e) => console.warn(`game ws: ${e.message}`));
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
      if (!match || seat === null) { chan.sendReliable({ t: 'error', text: 'No such battle' }); chan.flush(); chan.close(4004); return; }
      // from here on the match drives the channel: it overrides the handlers
      if (!this.closing) match.attach(seat, chan);
    };
    chan.onClose = () => clearTimeout(timer);
  }

  /** HTTP → battle WebSocket upgrade */
  upgrade(req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  }
}
