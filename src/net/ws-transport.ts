import type { Transport } from './transport.ts';

/** What we need from a WebSocket — present in both the browser one and the `ws` package */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
}

/** Client event queue (src/cgame/events.ts): a network frame is delivered when the queue is drained, before the ticks, not in `onmessage` */
export interface NetSink { push(e: { kind: 'net'; deliver: () => void }): void }

/** Transport over an open WebSocket (readyState OPEN = 1); with a queue — frames and the close go through it */
export class WebSocketTransport implements Transport {
  onMessage: ((frame: string) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  private readonly ws: SocketLike;

  constructor(ws: SocketLike, queue?: NetSink) {
    this.ws = ws;
    ws.onmessage = (e) => { const f = String(e.data); if (queue) queue.push({ kind: 'net', deliver: () => this.onMessage?.(f) }); else this.onMessage?.(f); };
    ws.onclose = (e) => { if (queue) queue.push({ kind: 'net', deliver: () => this.onClose?.(e.code) }); else this.onClose?.(e.code); };
  }

  send(frame: string): void { if (this.ws.readyState === 1) this.ws.send(frame); }
  close(code = 1000): void { this.ws.close(code); }
}
