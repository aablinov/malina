import type { Transport } from './transport.ts';

/**
 * Канал поверх транспорта — по образцу netchan Quake 3: в одном кадре надёжная полоса (упорядоченная, с подтверждением
 * и повтором: команды комнаты, чат, постройки, действия) и ненадёжная (последний побеждает: ввод и снимки).
 * `seq` — номер кадра, `ack` — последний полученный кадр встречной стороны; `rseq`/`rack` — надёжные сообщения.
 * WebSocket и так не теряет, но семантика нужна дельтам снимков, петле с потерями в тестах и будущему транспорту без TCP
 */
export interface Frame<R = unknown, U = unknown> {
  seq: number;
  ack: number;
  /** Надёжные сообщения, ещё не подтверждённые встречной стороной: номер и само сообщение */
  r?: { n: number; m: R }[];
  /** Сколько надёжных сообщений встречной стороны получено подряд */
  rack: number;
  /** Ненадёжная часть кадра */
  u?: U;
}

export interface ChannelOpts {
  /** Часы, мс — для повтора надёжных */
  clock: () => number;
  /** Повторять неподтверждённое надёжное через столько мс */
  resendMs?: number;
  /** Окно надёжных без подтверждения; больше — sendReliable вернёт false */
  window?: number;
}

export interface ChannelStats { sent: number; received: number; stale: number; resent: number }

export class Channel<R = unknown, U = unknown> {
  onReliable: ((m: R) => void) | null = null;
  onUnreliable: ((m: U, seq: number) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  readonly stats: ChannelStats = { sent: 0, received: 0, stale: 0, resent: 0 };
  /** Последний кадр, который встречная сторона подтвердила получением (наш seq) */
  peerAck = 0;
  /** Последний принятый кадр встречной стороны */
  lastRecv = 0;
  private seq = 0;
  private readonly t: Transport;
  private readonly o: Required<ChannelOpts>;
  /** Надёжные в пути: номер, сообщение, когда отправлено */
  private readonly out: { n: number; m: R; at: number }[] = [];
  private rseq = 0;
  /** Сколько надёжных встречной стороны принято подряд */
  private rack = 0;
  /** Надёжные, пришедшие раньше своей очереди */
  private readonly early = new Map<number, R>();
  /** Приняли надёжное — на ближайшем flush уйдёт кадр с подтверждением, даже если сказать нечего */
  private ackDue = false;
  closed = false;

  constructor(transport: Transport, o: ChannelOpts) {
    this.t = transport;
    this.o = { clock: o.clock, resendMs: o.resendMs ?? 200, window: o.window ?? 64 };
    transport.onMessage = (f) => this.receive(f);
    transport.onClose = (c) => { this.closed = true; this.onClose?.(c); };
  }

  /** В пути надёжных сообщений */
  get pending(): number { return this.out.length; }

  /** Надёжно: уйдёт сейчас и будет повторяться до подтверждения; false — окно полно */
  sendReliable(m: R): boolean {
    if (this.out.length >= this.o.window) return false;
    this.out.push({ n: ++this.rseq, m, at: this.o.clock() });
    this.emit(undefined);
    return true;
  }

  /** Ненадёжно: один кадр, вместе с ним — всё надёжное в пути. Вернёт seq кадра */
  sendUnreliable(u: U): number { return this.emit(u); }

  /** Повторить надёжное, которому вышел срок (вызывать с кадром сервера или rAF) */
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
    // подтверждения: наши кадры и наши надёжные
    if (f.ack > this.peerAck) this.peerAck = f.ack;
    while (this.out.length && this.out[0].n <= f.rack) this.out.shift();
    // надёжные встречной стороны — строго по порядку, дубликаты молча
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
    // ненадёжная часть — только из нового кадра
    if (f.seq <= this.lastRecv) { this.stats.stale++; return; }
    this.lastRecv = f.seq;
    if (f.u !== undefined) this.onUnreliable?.(f.u, f.seq);
  }
}
