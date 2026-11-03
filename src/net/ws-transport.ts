import type { Transport } from './transport.ts';

/** Что нужно от WebSocket — есть и у браузерного, и у пакета `ws` */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
}

/** Транспорт над открытым WebSocket (readyState OPEN = 1) */
export class WebSocketTransport implements Transport {
  onMessage: ((frame: string) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  private readonly ws: SocketLike;

  constructor(ws: SocketLike) {
    this.ws = ws;
    ws.onmessage = (e) => { this.onMessage?.(String(e.data)); };
    ws.onclose = (e) => { this.onClose?.(e.code); };
  }

  send(frame: string): void { if (this.ws.readyState === 1) this.ws.send(frame); }
  close(code = 1000): void { this.ws.close(code); }
}
