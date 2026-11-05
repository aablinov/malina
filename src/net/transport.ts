/**
 * Network channel transport (wiki/design-multiplayer.md): text frames both ways, no parsing.
 * Implementations: WebSocket (browser and server, `ws-transport.ts`) and an in-memory loopback for tests and single player (`loopback.ts`).
 */
export interface Transport {
  /** Frames may be lost (UDP-like transport, lossy loopback): the client duplicates commands, like cl_packetdup */
  readonly lossy?: boolean;
  send(frame: string): void;
  onMessage: ((frame: string) => void) | null;
  onClose: ((code: number) => void) | null;
  close(code?: number): void;
}
