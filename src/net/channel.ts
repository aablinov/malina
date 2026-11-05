import type { Transport } from './transport.ts';

/**
 * Channel over a transport — modelled on Quake 3's netchan: one frame carries a reliable lane (ordered, acknowledged
 * and resent: room commands, chat, builds, actions) and an unreliable one (last wins: input and snapshots).
 * `seq` — frame number, `ack` — last frame received from the other side; `rseq`/`rack` — reliable messages.
 * WebSocket does not lose anyway, but the semantics are needed by snapshot deltas, the lossy loopback in tests and a future non-TCP transport
 */
export interface Frame<R = unknown, U = unknown> {
  seq: number;
  ack: number;
  /** Reliable messages not yet acknowledged by the other side: number and the message itself */
  r?: { n: number; m: R }[];
  /** How many of the other side's reliable messages were received in a row */
  rack: number;
  /** Unreliable part of the frame */
  u?: U;
}

export interface ChannelOpts {
  /** Clock, ms — for resending reliables */
  clock: () => number;
  /** Resend an unacknowledged reliable after this many ms */
  resendMs?: number;
  /** Window of unacknowledged reliables; beyond it sendReliable returns false */
  window?: number;
}

export interface ChannelStats { sent: number; received: number; stale: number; resent: number }

export class Channel<R = unknown, U = unknown> {
  onReliable: ((m: R) => void) | null = null;
  onUnreliable: ((m: U, seq: number) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  readonly stats: ChannelStats = { sent: 0, received: 0, stale: 0, resent: 0 };
  /** Last frame the other side acknowledged receiving (our seq) */
  peerAck = 0;
  /** Last frame received from the other side */
  lastRecv = 0;
  private seq = 0;
  private readonly t: Transport;
  private readonly o: Required<ChannelOpts>;
  /** Reliables in flight: number, message, when sent */
  private readonly out: { n: number; m: R; at: number }[] = [];
  private rseq = 0;
  /** How many of the other side's reliables were received in a row */
  private rack = 0;
  /** Reliables that arrived ahead of their turn */
  private readonly early = new Map<number, R>();
  /** A reliable was received — the next flush sends a frame with the ack even if there is nothing to say */
  private ackDue = false;
  closed = false;

  constructor(transport: Transport, o: ChannelOpts) {
    this.t = transport;
    this.o = { clock: o.clock, resendMs: o.resendMs ?? 200, window: o.window ?? 64 };
    transport.onMessage = (f) => this.receive(f);
    transport.onClose = (c) => { this.closed = true; this.onClose?.(c); };
  }

  /** Reliable messages in flight */
  get pending(): number { return this.out.length; }
  /** The transport loses frames — unreliables are worth duplicating (over TCP duplicates only waste bandwidth) */
  get lossy(): boolean { return this.t.lossy ?? false; }

  /** Reliably: goes out now and is resent until acknowledged; false — the window is full */
  sendReliable(m: R): boolean {
    if (this.out.length >= this.o.window) return false;
    this.out.push({ n: ++this.rseq, m, at: this.o.clock() });
    this.emit(undefined);
    return true;
  }

  /** Unreliably: one frame, carrying every reliable in flight with it. Returns the frame's seq */
  sendUnreliable(u: U): number { return this.emit(u); }

  /** Resend reliables that are overdue (call with the server frame or rAF) */
  flush(): void {
    const now = this.o.clock();
    const due = this.out.some((x) => now - x.at >= this.o.resendMs);
    if (due) this.stats.resent++;
    if (due || this.ackDue) this.emit(undefined);
  }

  close(code = 1000): void { this.t.close(code); }

  private emit(u: U | undefined): number {
    if (this.closed) return this.seq;
    const now = this.o.clock();
    const f: Frame<R, U> = { seq: ++this.seq, ack: this.lastRecv, rack: this.rack };
    if (this.out.length) { f.r = this.out.map((x) => ({ n: x.n, m: x.m })); for (const x of this.out) x.at = now; }
    if (u !== undefined) f.u = u;
    this.ackDue = false;
    this.stats.sent++;
    this.t.send(JSON.stringify(f));
    return f.seq;
  }

  private receive(raw: string): void {
    let f: Frame<R, U>;
    try { f = JSON.parse(raw) as Frame<R, U>; } catch { return; }
    if (typeof f.seq !== 'number' || typeof f.ack !== 'number' || typeof f.rack !== 'number') return;
    this.stats.received++;
    // acks: our frames and our reliables
    if (f.ack > this.peerAck) this.peerAck = f.ack;
    while (this.out.length && this.out[0].n <= f.rack) this.out.shift();
    // the other side's reliables — strictly in order, duplicates silently
    if (f.r) {
      this.ackDue = true;
      for (const { n, m } of f.r) if (n > this.rack && !this.early.has(n)) this.early.set(n, m);
      for (;;) {
        const m = this.early.get(this.rack + 1);
        if (m === undefined && !this.early.has(this.rack + 1)) break;
        this.early.delete(++this.rack);
        this.onReliable?.(m as R);
      }
    }
    // the unreliable part — only from a new frame
    if (f.seq <= this.lastRecv) { this.stats.stale++; return; }
    this.lastRecv = f.seq;
    if (f.u !== undefined) this.onUnreliable?.(f.u, f.seq);
  }
}
