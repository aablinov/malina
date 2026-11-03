/**
 * Транспорт сетевого канала (wiki/design-multiplayer.md): текстовые кадры в обе стороны, без разбора.
 * Реализации: WebSocket (браузер и сервер, `ws-transport.ts`) и петля в памяти для тестов и одиночной игры (`loopback.ts`).
 */
export interface Transport {
  send(frame: string): void;
  onMessage: ((frame: string) => void) | null;
  onClose: ((code: number) => void) | null;
  close(code?: number): void;
}
