import type { Transport } from './transport.ts';

/** Что нужно от WebSocket — есть и у браузерного, и у пакета `ws` */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
}

/** Очередь событий клиента (src/cgame/events.ts): кадр сети доставляется при её разборе, перед тактами, а не в `onmessage` */
export interface NetSink { push(e: { kind: 'net'; deliver: () => void }): void }

/** Транспорт над открытым WebSocket (readyState OPEN = 1); с очередью — кадры и закрытие идут через неё */
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
